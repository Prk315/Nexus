//! Tauri commands for the usage panel.
//!
//! # These run in the wrong process, and that is the point
//!
//! On macOS the **daemon** owns the grid: it runs the tracker and the ingest
//! listener, and the desktop app spawns no modules at all (see `lib.rs`). So the
//! app cannot ask the tracker anything — there is no tracker in this process to
//! ask, and there is no IPC channel to the one that exists.
//!
//! What there is, is the JSONL day file both processes agree on. The daemon
//! appends; this reads. That is the same shape as the enforcement toggle
//! crossing the boundary through `~/.nexuslocalrc`: a file, polled, rather than
//! a socket. It also means the panel keeps working when the daemon is stopped —
//! it shows the day so far and says nothing is being recorded, which is the
//! honest answer rather than an error.
//!
//! Nothing here is written to Supabase. See the privacy note in `usage.rs`.
//! TODO(auth): sync only after RLS is scoped to auth.uid().

use serde::Serialize;

use crate::usage;

/// How many rows the panel gets. Enough to be a useful summary, few enough that
/// the tail of one-minute-each apps doesn't bury the four that matter.
const TOP_N: usize = 8;

#[derive(Debug, Clone, Serialize)]
pub struct AppUsage {
    pub name: String,
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiteUsage {
    pub host: String,
    pub seconds: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageToday {
    pub apps: Vec<AppUsage>,
    pub sites: Vec<SiteUsage>,
    /// Every app second recorded today. Deliberately **not** apps + sites: the
    /// browser's time is already counted as app time, and adding the sites on
    /// top would double-count every minute spent in a browser and produce a
    /// total larger than the day.
    pub total_seconds: i64,
    /// Whether anything is recording right now. False means the numbers below
    /// are a historical read of the day so far, not a live one.
    pub tracking: bool,
}

/// Today's totals, read from disk.
///
/// Infallible by design: a day with no file is a day with no usage — the normal
/// state of every morning — and a read error should leave the panel showing
/// "nothing yet" rather than an error box that is indistinguishable from one.
#[tauri::command]
pub fn tt_usage_today() -> UsageToday {
    let entries = usage::read_day(&usage::today_local()).unwrap_or_default();

    let apps: Vec<AppUsage> = usage::totals(&entries, Some(true))
        .into_iter()
        .take(TOP_N)
        .map(|(name, seconds)| AppUsage { name, seconds })
        .collect();
    let sites: Vec<SiteUsage> = usage::totals(&entries, Some(false))
        .into_iter()
        .take(TOP_N)
        .map(|(host, seconds)| SiteUsage { host, seconds })
        .collect();
    // Summed over every app entry, not over the truncated top-N above, so the
    // total doesn't shrink as the tail grows.
    let total_seconds = entries
        .iter()
        .filter(|e| e.is_app())
        .map(|e| e.seconds().max(0))
        .sum();

    UsageToday {
        apps,
        sites,
        total_seconds,
        tracking: tracking_now(),
    }
}

/// The token the browser extension authenticates with, for the one-time setup.
///
/// Generates it if it does not exist yet, so the setup instructions are readable
/// before the daemon has ever been started. That cannot race the daemon into an
/// unusable state: the endpoint re-reads the file on every request rather than
/// caching it at startup (see `usage_ingest.rs`).
///
/// Returns an empty string on iOS, where there is no daemon and no listener —
/// the command is registered on every platform because cfg-ing the
/// `generate_handler!` list is how you get a command that silently 404s.
#[tauri::command]
pub fn tt_usage_token() -> String {
    #[cfg(target_os = "ios")]
    {
        String::new()
    }
    #[cfg(not(target_os = "ios"))]
    {
        usage::ensure_browser_token().unwrap_or_default()
    }
}

/// Is anything actually recording?
///
/// The same question `EnforcementPanel` asks, answered the same way: ask the OS
/// for a live `--daemon` process rather than launchd for a job. A job stays
/// listed through a crash loop and while throttled, and the panel needs to say
/// whether time is being recorded *this second*, not whether it is configured to
/// be. False everywhere that has no daemon.
fn tracking_now() -> bool {
    crate::enforcement::daemon_running()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::usage::UsageEntry;

    fn app(name: &str, seconds: i64) -> UsageEntry {
        UsageEntry::App {
            name: name.into(),
            start: "2026-08-07T09:00:00+00:00".into(),
            end: "2026-08-07T09:00:00+00:00".into(),
            seconds,
        }
    }

    fn web(host: &str, seconds: i64) -> UsageEntry {
        UsageEntry::Web {
            host: host.into(),
            url: String::new(),
            title: String::new(),
            start: "2026-08-07T09:00:00+00:00".into(),
            end: "2026-08-07T09:00:00+00:00".into(),
            seconds,
        }
    }

    #[test]
    fn the_total_counts_apps_only_so_browser_time_is_not_doubled() {
        // A site's seconds are a subset of the browser app's seconds. Summing
        // both would report more hours than the day contains.
        let entries = vec![app("Google Chrome", 600), web("github.com", 400)];
        let total: i64 = entries
            .iter()
            .filter(|e| e.is_app())
            .map(|e| e.seconds().max(0))
            .sum();
        assert_eq!(total, 600);
    }

    #[test]
    fn the_two_lists_are_split_by_kind_and_keyed_differently() {
        let entries = vec![app("Ghostty", 900), web("github.com", 400)];
        let apps = usage::totals(&entries, Some(true));
        let sites = usage::totals(&entries, Some(false));
        assert_eq!(apps, vec![("Ghostty".to_string(), 900)]);
        assert_eq!(sites, vec![("github.com".to_string(), 400)]);
    }

    #[test]
    fn only_the_top_rows_are_returned_but_the_total_still_counts_everything() {
        // Truncating both would make the total shrink as the tail of tiny apps
        // grew, which looks like time going missing.
        let entries: Vec<UsageEntry> = (0..20)
            .map(|i| app(&format!("App{i:02}"), 100 - i as i64))
            .collect();
        let shown = usage::totals(&entries, Some(true)).into_iter().take(TOP_N).count();
        let total: i64 = entries.iter().map(|e| e.seconds()).sum();
        assert_eq!(shown, TOP_N);
        assert!(total > usage::totals(&entries, Some(true))[..TOP_N].iter().map(|(_, s)| s).sum());
    }

    #[test]
    fn a_day_with_no_file_reads_as_an_empty_panel_not_an_error() {
        // Every morning starts here. The command must not surface this as a
        // failure — the panel would show an error box on a perfectly healthy
        // machine.
        assert!(usage::read_day("2097-03-04").expect("no error").is_empty());
        let today = tt_usage_today();
        assert!(today.total_seconds >= 0);
        assert!(today.apps.len() <= TOP_N);
        assert!(today.sites.len() <= TOP_N);
    }

    #[test]
    fn the_token_command_returns_something_the_endpoint_would_accept() {
        let token = tt_usage_token();
        #[cfg(not(target_os = "ios"))]
        {
            assert!(token.len() >= usage::MIN_TOKEN_LEN, "got {:?}", token);
            assert!(usage::token_is_valid(Some(&token), &token));
        }
        #[cfg(target_os = "ios")]
        assert!(token.is_empty());
    }
}
