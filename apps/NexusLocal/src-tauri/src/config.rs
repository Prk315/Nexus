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
    /// Scoped secret for the `usage-ingest` edge function. Empty = usage stays
    /// on this Mac and nothing is uploaded.
    ///
    /// Lives here rather than in the source because **the repo is public**: a
    /// key compiled into the binary would be published on the next push, which
    /// is exactly what the scoped-function design exists to prevent. This file
    /// is in `$HOME` and never leaves the machine.
    #[serde(default)]
    pub usage_ingest_key: String,
    /// Which Supabase account usage is exported to — an `auth.users` uid.
    ///
    /// Written by the app when you switch profile, read by the daemon on every
    /// sync pass. It exists because the two processes have no IPC: the app knows
    /// who is signed in, the daemon is the one that uploads, and this file is
    /// how that fact crosses the boundary (same channel as `blocking_enabled`).
    ///
    /// Empty means "whoever the edge function defaults to", which keeps a config
    /// written before this field existed working unchanged.
    #[serde(default)]
    pub active_user_id: String,
    /// Scoped secret for the `garmin-import` edge function. Empty = the manual
    /// Garmin sync can pull but not import.
    ///
    /// In this file rather than the source for the same reason as
    /// `usage_ingest_key`: the repo is public.
    #[serde(default)]
    pub garmin_import_key: String,
    /// Every key this binary does not recognise, preserved verbatim.
    ///
    /// `load()` persists on read, so without this a binary that predates a field
    /// **silently deletes it**: it deserializes the file, the unknown key has
    /// nowhere to go, and `save()` writes back the reduced struct. That is not
    /// hypothetical — adding `usage_ingest_key` and leaving an older daemon
    /// running during the rebuild wiped the key within seconds, and the only
    /// symptom was a log line saying sync was disabled.
    ///
    /// Two processes share this file (the app and the daemon) and they are not
    /// always the same build, so round-tripping unknown keys is the only way a
    /// hand-edited or newer setting survives an older writer.
    #[serde(flatten)]
    pub extra: serde_json::Map<String, serde_json::Value>,
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

/// The anon key, supplied **at compile time** rather than written here.
///
/// It used to be a literal in this file. The repo is public, so that published
/// the key on every push — the same reason `usage_ingest_key` and
/// `garmin_import_key` live in `~/.nexuslocalrc` instead of in the source.
///
/// Where each build gets it:
/// - **macOS** — from `~/.nexuslocalrc`, which every existing install already
///   has. This constant is never consulted there unless the file lacks a key.
/// - **iOS** — from the `SUPABASE_ANON_KEY` repo secret, baked in by CI at
///   build time (`nexuslocal-ios.yml`, "Build unsigned IPA"). A sideloaded IPA
///   has no `~/.nexuslocalrc` to read, so the phone genuinely needs it compiled
///   in. This is the same channel the widgets' `Secrets.swift` already uses.
///
/// Empty is a legitimate state — a local `cargo build` without the env var set
/// produces a binary that reads its key from the config file, which is exactly
/// what the daemon does anyway. It is only fatal when *neither* source has one,
/// and [`AppConfig::load`] says so loudly rather than handing out a client that
/// 401s on every call.
///
/// ⚠️ Removing the literal does **not** shrink the exposure on its own: the key
/// remains in git history, and is still hardcoded in `TimeTrackerApp`,
/// `packages/nexus-core`'s `ClockDropdown.tsx` and Vault's `conceptmap.html`.
/// It only stops being reachable once all four are gone *and* the key is
/// rotated. See `SECURITY_RLS_MIGRATION.md`.
const DEFAULT_SUPABASE_KEY: &str = match option_env!("SUPABASE_ANON_KEY") {
    Some(k) => k,
    None => "",
};

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
            usage_ingest_key: String::new(),
            active_user_id: String::new(),
            garmin_import_key: String::new(),
            extra: serde_json::Map::new(),
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

        // Neither the config file nor the build supplied a key. Every PostgREST
        // call will 401, and a 401 on a `select` is indistinguishable from "no
        // rows" once it has been through a client that swallows it — the same
        // empty-set trap that governs the RLS migration. Say so once, here,
        // rather than let it surface as a day with no data.
        if config.supabase.key.is_empty() {
            eprintln!(
                "nexus-local: no Supabase anon key. Add `supabase.key` to {} \
                 (or build with SUPABASE_ANON_KEY set). Every request will fail \
                 until then.",
                config_path().display()
            );
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

    /// Read the export target without `load`'s persist-on-read side effect.
    ///
    /// Polled by the daemon's sync pass, so it must not rewrite the file — and
    /// `None` (unreadable, mid-write) must leave the caller's current value
    /// alone rather than silently reverting the export target to the default
    /// account, which would file one person's usage under the other's name.
    pub fn read_active_user_id() -> Option<String> {
        let raw = fs::read_to_string(config_path()).ok()?;
        let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
        Some(parsed.get("active_user_id")?.as_str()?.to_string())
    }

    /// Set the export target and persist it.
    pub fn set_active_user_id(uid: &str) -> Result<(), String> {
        let mut config = AppConfig::load();
        config.active_user_id = uid.to_string();
        config.save()
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
    fn an_older_binary_does_not_delete_a_field_it_does_not_know() {
        // The real incident: `usage_ingest_key` was hand-written into the config,
        // an older daemon was still running, its `load()` round-tripped the file
        // through a struct without that field, and `save()` wrote it back gone.
        // The only symptom was "[usage-sync] disabled" in a log nobody was
        // watching. `#[serde(flatten)] extra` is what makes this survive.
        let raw = r#"{
            "user_id": "default",
            "poll_secs": 10,
            "blocking_enabled": true,
            "a_field_from_a_newer_build": "must survive",
            "nested_future_setting": {"enabled": true, "n": 3}
        }"#;
        let parsed: AppConfig = serde_json::from_str(raw).expect("parses");
        assert!(parsed.blocking_enabled, "known fields still bind");
        assert_eq!(
            parsed.extra.get("a_field_from_a_newer_build").and_then(|v| v.as_str()),
            Some("must survive"),
        );

        let round_tripped = serde_json::to_string(&parsed).expect("serializes");
        assert!(round_tripped.contains("a_field_from_a_newer_build"));
        assert!(round_tripped.contains("nested_future_setting"));
        // And the unknown keys must sit at the top level, not nested under
        // "extra" — otherwise the newer build stops finding them.
        let back: serde_json::Value = serde_json::from_str(&round_tripped).unwrap();
        assert!(back.get("extra").is_none(), "flatten must not emit an `extra` key");
        assert_eq!(back["nested_future_setting"]["n"], 3);
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
