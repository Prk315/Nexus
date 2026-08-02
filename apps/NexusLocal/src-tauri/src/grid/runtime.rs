//! The grid host: owns the registered modules and drives them — startup hooks,
//! per-module tick loops, and the Supabase command-queue poll/dispatch loop.

use super::supabase::NodePresence;
use super::{ModuleContext, ModuleManifest, NexusModule};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

pub struct Grid {
    modules: Vec<Arc<dyn NexusModule>>,
}

impl Grid {
    pub fn new(modules: Vec<Arc<dyn NexusModule>>) -> Self {
        Self { modules }
    }

    pub fn manifests(&self) -> Vec<ModuleManifest> {
        self.modules.iter().map(|m| m.manifest()).collect()
    }

    /// Launch every background loop on the current (tokio) runtime and return.
    pub fn spawn(self, ctx: ModuleContext, poll_secs: u64) {
        let manifests = self.manifests();
        let by_id: Arc<HashMap<String, Arc<dyn NexusModule>>> = Arc::new(
            self.modules
                .iter()
                .map(|m| (m.manifest().id, Arc::clone(m)))
                .collect(),
        );

        // Startup hooks + per-module tick loops.
        for module in &self.modules {
            let module = Arc::clone(module);
            let ctx = ctx.clone();
            let manifest = module.manifest();
            tokio::spawn(async move {
                if let Err(e) = module.on_start(&ctx).await {
                    eprintln!("[grid] {} on_start failed: {e}", manifest.id);
                }
                if let Some(interval) = manifest.tick_interval_secs {
                    let mut ticker = tokio::time::interval(Duration::from_secs(interval));
                    loop {
                        ticker.tick().await;
                        if let Err(e) = module.tick(&ctx).await {
                            eprintln!("[grid] {} tick failed: {e}", manifest.id);
                        }
                    }
                }
            });
        }

        // Heartbeat + command-queue poll loop.
        tokio::spawn(async move {
            let module_ids: Vec<String> = manifests.iter().map(|m| m.id.clone()).collect();
            let modules_json = serde_json::to_value(&manifests).unwrap_or_default();
            let mut ticker = tokio::time::interval(Duration::from_secs(poll_secs.max(2)));
            loop {
                ticker.tick().await;
                if !ctx.supabase.is_configured() {
                    continue;
                }

                let presence = NodePresence {
                    device_id: &ctx.device_id,
                    user_id: &ctx.user_id,
                    platform: crate::device::platform(),
                    hostname: &crate::device::hostname(),
                    version: env!("CARGO_PKG_VERSION"),
                    modules: modules_json.clone(),
                };
                if let Err(e) = ctx.supabase.heartbeat(&presence).await {
                    eprintln!("[grid] heartbeat failed: {e}");
                }

                match ctx.supabase.claim_pending(&ctx.device_id, &module_ids).await {
                    Ok(commands) => {
                        for cmd in commands {
                            dispatch(Arc::clone(&by_id), ctx.clone(), cmd);
                        }
                    }
                    Err(e) => eprintln!("[grid] claim_pending failed: {e}"),
                }
            }
        });
    }
}

/// Run one claimed command on its module and write the result back. Each command
/// runs in its own task so a slow module (e.g. Garmin) never stalls the poller.
fn dispatch(
    by_id: Arc<HashMap<String, Arc<dyn NexusModule>>>,
    ctx: ModuleContext,
    cmd: super::supabase::Command,
) {
    tokio::spawn(async move {
        let Some(module) = by_id.get(&cmd.module) else {
            let _ = ctx
                .supabase
                .fail(&cmd.id, &format!("no module '{}' installed on this node", cmd.module))
                .await;
            return;
        };

        match module.handle(&cmd.action, &cmd.payload, &ctx).await {
            Ok(result) => {
                if let Err(e) = ctx.supabase.complete(&cmd.id, &result).await {
                    eprintln!("[grid] failed to write result for {}: {e}", cmd.id);
                }
            }
            Err(err) => {
                let _ = ctx.supabase.fail(&cmd.id, &err).await;
            }
        }
    });
}
