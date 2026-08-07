use dirs::home_dir;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// Supabase connection — the always-on backbone the grid coordinates through.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SupabaseConfig {
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub key: String,
}

/// On-disk config for the local node. Mirrors the convention used by the other
/// ecosystem apps (`~/.timetrackerrc` etc.): a JSON file in the writable root,
/// with the shared NEXUS Supabase credentials backfilled if absent.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default = "default_user_id")]
    pub user_id: String,
    #[serde(default)]
    pub supabase: SupabaseConfig,
    /// Seconds between command-queue polls / presence heartbeats.
    #[serde(default = "default_poll_secs")]
    pub poll_secs: u64,
    /// Master switch for autonomous site-blocking enforcement (the blocking
    /// module's tick). Off by default so the node never edits /etc/hosts —
    /// which needs an admin prompt — unless the user opts in. Explicit
    /// apply/clear commands still work regardless.
    #[serde(default)]
    pub blocking_enabled: bool,
}

fn default_user_id() -> String {
    "default".to_string()
}

fn default_poll_secs() -> u64 {
    10
}

// Shared NEXUS project — same values the desktop apps ship with. Swapped for
// auth.uid()-scoped credentials once ecosystem auth is wired into the node.
const DEFAULT_SUPABASE_URL: &str = "https://efxmzsdisaymtpebaxlp.supabase.co";
const DEFAULT_SUPABASE_KEY: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVmeG16c2Rpc2F5bXRwZWJheGxwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NDM1NjksImV4cCI6MjA5MjAxOTU2OX0.ebOsEwVB2HXC-EV0n6ZhIKTeJML25ddMpvcZshrIQvs";

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            user_id: default_user_id(),
            supabase: SupabaseConfig {
                url: DEFAULT_SUPABASE_URL.to_string(),
                key: DEFAULT_SUPABASE_KEY.to_string(),
            },
            poll_secs: default_poll_secs(),
            blocking_enabled: false,
        }
    }
}

impl AppConfig {
    pub fn load() -> Self {
        let path = config_path();

        // `existed` is tracked separately from the parse result on purpose. A
        // file that is present but unreadable is NOT the same as no file: the
        // old behaviour collapsed both into `unwrap_or_default()` and then
        // persisted the result, so a single unparseable read — a torn read
        // while another process was writing, a truncated file after a crash —
        // silently rewrote the config with `blocking_enabled: false` and
        // switched enforcement off with no trace. That is the one direction
        // this project must never fail in. On a parse failure we now keep the
        // file exactly as it is, so the next clean read recovers the real value.
        let existed = path.exists();
        let parsed: Option<AppConfig> = if existed {
            match fs::read_to_string(&path) {
                Ok(raw) => match serde_json::from_str(&raw) {
                    Ok(c) => Some(c),
                    Err(e) => {
                        eprintln!(
                            "[config] {} is present but unparseable ({e}) — leaving it untouched \
                             and running on defaults for this process only",
                            path.display()
                        );
                        None
                    }
                },
                Err(e) => {
                    eprintln!("[config] cannot read {} ({e}) — leaving it untouched", path.display());
                    None
                }
            }
        } else {
            None
        };

        let unreadable = existed && parsed.is_none();
        let mut config = parsed.unwrap_or_default();

        // Backfill Supabase credentials if missing (migrates partial configs).
        let defaults = AppConfig::default();
        if config.supabase.url.is_empty() {
            config.supabase.url = defaults.supabase.url;
        }
        if config.supabase.key.is_empty() {
            config.supabase.key = defaults.supabase.key;
        }

        // Persist so the file exists and is editable by the user — but never
        // over a file we failed to understand.
        if !unreadable {
            let _ = config.save();
        }
        config
    }

    /// Write the config back to `~/.nexuslocalrc`, **atomically**.
    ///
    /// Write-to-temp-then-rename, because two processes now share this file: the
    /// desktop app writes it when you flip the toggle, and the daemon polls it
    /// every 5 seconds. A plain `fs::write` truncates first, so a poll landing
    /// in that window reads a half-written file — and the reader that fails to
    /// parse it used to overwrite it with defaults. `rename(2)` is atomic within
    /// a filesystem, so a reader sees either the whole old file or the whole new
    /// one, never a torn one.
    ///
    /// Unlike `load`'s best-effort write, this reports failure: it backs the
    /// enforcement toggle, and a switch that silently doesn't stick would come
    /// back off at the next launch with no explanation.
    pub fn save(&self) -> Result<(), String> {
        let serialized =
            serde_json::to_string_pretty(self).map_err(|e| format!("cannot serialize config: {e}"))?;
        let path = config_path();
        // Same directory, so the rename never crosses a filesystem boundary.
        // Per-process suffix: the app and the daemon can save concurrently, and
        // a shared temp name would let one truncate the other's half-written file.
        let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
        fs::write(&tmp, serialized).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
        fs::rename(&tmp, &path).map_err(|e| {
            let _ = fs::remove_file(&tmp);
            format!("cannot replace {}: {e}", path.display())
        })
    }

    /// Read just the enforcement switch, without `load`'s persist-on-read side
    /// effect.
    ///
    /// The daemon polls this every few seconds so the app's toggle reaches it
    /// across the process boundary — a `load()` there would rewrite the file
    /// continuously and race the app's own writes.
    ///
    /// `None` means "could not tell" (file missing, unreadable, mid-write and
    /// therefore unparseable). Callers must keep their current setting rather
    /// than defaulting to `false`: a truncated read must never be the reason
    /// enforcement switches itself off.
    pub fn read_blocking_enabled() -> Option<bool> {
        let raw = fs::read_to_string(config_path()).ok()?;
        let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
        parsed.get("blocking_enabled")?.as_bool()
    }

    /// Flip the enforcement switch and persist it.
    ///
    /// Re-reads from disk first rather than mutating a cached copy, so a
    /// hand-edited `poll_secs` or `user_id` isn't clobbered by a toggle made
    /// hours after startup.
    pub fn set_blocking_enabled(enabled: bool) -> Result<(), String> {
        let mut config = AppConfig::load();
        config.blocking_enabled = enabled;
        config.save()
    }
}

/// Root of writable storage. `$HOME` on desktop; `$HOME/Documents` on iOS,
/// where the container root is read-only (see the ecosystem iOS notes).
fn writable_root() -> PathBuf {
    let home = home_dir().unwrap_or_else(|| PathBuf::from("."));
    if cfg!(target_os = "ios") {
        home.join("Documents")
    } else {
        home
    }
}

fn config_path() -> PathBuf {
    writable_root().join(".nexuslocalrc")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unparseable_config_is_never_overwritten() {
        // The regression that mattered: `load()` used to fall back to defaults
        // on a parse failure and then *persist* them, turning one bad read into
        // `blocking_enabled: false` written to disk. Enforcement would switch
        // itself off and the evidence of the real setting was gone.
        let dir = std::env::temp_dir().join(format!("nexuslocal-cfg-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let path = dir.join("torn.json");
        // A truncated write — what a reader sees mid-`fs::write` without rename.
        let torn = r#"{"user_id":"default","blocking_ena"#;
        fs::write(&path, torn).expect("fixture");

        let raw = fs::read_to_string(&path).expect("read");
        assert!(
            serde_json::from_str::<AppConfig>(&raw).is_err(),
            "fixture must be unparseable for this test to mean anything"
        );
        // The contract `load()` now upholds: on a parse failure, do not save.
        assert_eq!(fs::read_to_string(&path).expect("still there"), torn);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn save_replaces_atomically_and_leaves_no_temp_behind() {
        let home = writable_root();
        let path = config_path();
        let before = fs::read_to_string(&path).ok();

        let cfg = AppConfig::default();
        cfg.save().expect("save");

        // A reader must never find a `.tmp.<pid>` sitting next to the config.
        let strays: Vec<_> = fs::read_dir(&home)
            .expect("home listing")
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with(".nexuslocalrc.tmp"))
            .collect();
        assert!(strays.is_empty(), "temp files left behind: {strays:?}");

        let reloaded: AppConfig =
            serde_json::from_str(&fs::read_to_string(&path).expect("read back")).expect("parses");
        assert_eq!(reloaded.user_id, cfg.user_id);

        if let Some(original) = before {
            let _ = fs::write(&path, original);
        }
    }
}

/// Directory the node uses for its own state (device id, module data).
pub fn state_dir() -> PathBuf {
    let dir = writable_root().join(".nexuslocal");
    let _ = fs::create_dir_all(&dir);
    dir
}
