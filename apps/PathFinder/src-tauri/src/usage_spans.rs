//! PathFinder's Rust side has been dormant since the Supabase migration (the
//! frontend stopped invoking it — see the root `CLAUDE.md`'s "PathFinder:
//! Supabase Backend" section). This command deliberately revives it: the Week
//! view wants the day's screen-time spans to render locally, and that data
//! must never leave the machine (see `nexus_core::usage_store`'s module docs
//! and NexusLocal's `usage.rs`), so it cannot go through Supabase like
//! everything else PathFinder reads. Rust is the only place PathFinder can
//! reach `~/.nexuslocal/usage/` at all.
//!
//! This reads the file NexusLocal's daemon writes; PathFinder never writes to
//! it. The privacy stance is the same one NexusLocal documents: the data
//! stays on this machine, this command only lets the Week view render it
//! locally, and nothing here uploads anything anywhere.

use nexus_core::usage_store::{today_local, read_day};

/// One recorded foreground app interval, for the Week view's screen-time
/// rendering.
#[derive(Debug, Clone, serde::Serialize)]
pub struct PfUsageSpan {
    pub name: String,
    /// RFC3339 UTC, exactly as the store holds it.
    pub start: String,
    pub end: String,
    pub seconds: i64,
}

/// The day's app usage spans, oldest first.
///
/// Semantics mirror NexusLocal's own `app_intervals` (`usage_cmd.rs`) exactly,
/// since both read the same files through the same shared `read_day`: `date`
/// defaults to today (local, Europe/Copenhagen), only app entries with a
/// positive duration count (a site's interval is a subset of its browser's —
/// counting both would double-cover every browser minute), and the result is
/// sorted by start. Infallible: a missing file, a garbage date, or a corrupt
/// line all resolve to an empty vec rather than an error, so the Week view
/// renders "no screen time" instead of an error state.
#[tauri::command]
pub fn pf_usage_spans(date: Option<String>) -> Vec<PfUsageSpan> {
    let day = date.unwrap_or_else(today_local);
    let mut spans: Vec<PfUsageSpan> = read_day(&day)
        .unwrap_or_default()
        .iter()
        .filter(|e| e.is_app() && e.seconds() > 0)
        .map(|e| PfUsageSpan {
            name: e.label().to_string(),
            start: e.start().to_string(),
            end: e.end().to_string(),
            seconds: e.seconds(),
        })
        .collect();
    spans.sort_by(|a, b| a.start.cmp(&b.start));
    spans
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_far_future_date_returns_empty_not_an_error() {
        // Same contract as NexusLocal's `intervals_for_a_day_with_no_file...`
        // test: a day with no file on disk is "no usage yet", not a failure.
        assert!(pf_usage_spans(Some("2097-03-04".into())).is_empty());
    }
}
