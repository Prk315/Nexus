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

use chrono::Timelike;
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
    /// Foreground app seconds per local hour, always 24 entries indexed 0..=23.
    pub hours: Vec<i64>,
    /// One entry per day in the requested range, oldest first. A single
    /// element for `"today"`. Days with no data are present with zero
    /// rather than omitted, so the strip renders a gap honestly.
    pub days: Vec<DayTotal>,
}

/// One day's total, for the week strip.
#[derive(Debug, Clone, Serialize)]
pub struct DayTotal {
    /// `YYYY-MM-DD`, local.
    pub date: String,
    pub seconds: i64,
}

/// How many days a `"week"` range covers, counting today.
const WEEK_DAYS: i64 = 7;

/// Seconds of foreground app time falling in each local hour, 0..=23.
///
/// Intervals are **split across hour boundaries** rather than attributed whole
/// to their start hour. A session from 09:50 to 10:20 is 10 minutes in hour 9
/// and 20 in hour 10; billing all 30 to hour 9 would put a visible spike at the
/// start of every long session and leave the hours it actually spanned empty,
/// which is precisely the shape this chart exists to show.
fn hourly_buckets(entries: &[usage::UsageEntry]) -> Vec<i64> {
    let mut hours = vec![0i64; 24];
    for entry in entries.iter().filter(|e| e.is_app()) {
        let (Some(start), Some(end)) = (parse_local(entry.start()), parse_local(entry.end())) else {
            continue;
        };
        if end <= start {
            continue;
        }
        let mut cursor = start;
        while cursor < end {
            // Start of the next hour, derived by truncating rather than by
            // adding 3600s: an interval that spans a DST change would otherwise
            // drift a whole hour off.
            let next_hour = (cursor + chrono::Duration::hours(1))
                .with_minute(0)
                .and_then(|t| t.with_second(0))
                .and_then(|t| t.with_nanosecond(0))
                .unwrap_or(end);
            let segment_end = next_hour.min(end);
            let seconds = (segment_end - cursor).num_seconds().max(0);
            let hour = cursor.hour() as usize;
            if hour < 24 {
                hours[hour] += seconds;
            }
            // Guard against a zero-length step wedging the loop if a timezone
            // transition ever makes `next_hour` land on `cursor`.
            if segment_end <= cursor {
                break;
            }
            cursor = segment_end;
        }
    }
    hours
}

/// An RFC3339 timestamp as a wall-clock time in [`usage::LOCAL_TZ`].
fn parse_local(ts: &str) -> Option<chrono::DateTime<chrono_tz::Tz>> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|t| t.with_timezone(&usage::LOCAL_TZ))
}

/// The local dates in a range, oldest first.
///
/// Walks back from today in whole local days rather than subtracting 24h from
/// `now` repeatedly — the latter drifts across a DST boundary and would either
/// skip a day or emit one twice.
fn range_days(days: i64) -> Vec<String> {
    let today = chrono::Utc::now();
    let mut out: Vec<String> = (0..days)
        .map(|back| usage::local_date_of(today - chrono::Duration::days(back)))
        .collect();
    out.dedup();
    out.reverse();
    out
}

/// Totals for a range, read from disk.
///
/// `range` is `"today"` or `"week"`; anything else is treated as `"today"`
/// rather than erroring, because this is a display command and an unknown
/// string should degrade to the narrower, safer view.
///
/// Infallible by design: a day with no file is a day with no usage — the normal
/// state of every morning — and a read error should leave the panel showing
/// "nothing yet" rather than an error box that is indistinguishable from one.
#[tauri::command]
pub fn tt_usage_range(range: Option<String>) -> UsageToday {
    let days = match range.as_deref() {
        Some("week") => range_days(WEEK_DAYS),
        _ => vec![usage::today_local()],
    };

    // Per-day totals BEFORE flattening, so the strip can show an empty day as a
    // zero rather than omitting it — a gap in a bar chart reads as "no data
    // recorded", which is a different claim from "nothing was used".
    let mut per_day = Vec::with_capacity(days.len());
    let mut entries = Vec::new();
    for day in &days {
        let day_entries = usage::read_day(day).unwrap_or_default();
        per_day.push(DayTotal {
            date: day.clone(),
            seconds: day_entries
                .iter()
                .filter(|e| e.is_app())
                .map(|e| e.seconds().max(0))
                .sum(),
        });
        entries.extend(day_entries);
    }

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
        hours: hourly_buckets(&entries),
        days: per_day,
    }
}

/// Today's totals, read from disk.
///
/// Kept as its own command rather than folded into `tt_usage_range`: it is the
/// stable contract other callers may already use, and `range` defaulting to
/// today makes them identical anyway.
#[tauri::command]
pub fn tt_usage_today() -> UsageToday {
    let today = usage::today_local();
    let entries = usage::read_day(&today).unwrap_or_default();

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
        hours: hourly_buckets(&entries),
        days: vec![DayTotal { date: today, seconds: total_seconds }],
    }
}

/// One recorded foreground interval, for the day-coverage timeline.
#[derive(Debug, Clone, Serialize)]
pub struct UsageInterval {
    pub name: String,
    /// RFC3339 UTC, exactly as the store holds it.
    pub start: String,
    pub end: String,
    pub seconds: i64,
}

/// The day's app intervals, oldest first — shared by `tt_usage_intervals`
/// and `tt_usage_spans_range` so the two can never disagree on filtering.
fn app_intervals(day: &str) -> Vec<UsageInterval> {
    let mut out: Vec<UsageInterval> = usage::read_day(day)
        .unwrap_or_default()
        .iter()
        .filter(|e| e.is_app() && e.seconds() > 0)
        .map(|e| UsageInterval {
            name: e.label().to_string(),
            start: e.start().to_string(),
            end: e.end().to_string(),
            seconds: e.seconds(),
        })
        .collect();
    out.sort_by(|a, b| a.start.cmp(&b.start));
    out
}

/// The day's raw app intervals, oldest first.
///
/// Exists because the aggregate commands above deliberately collapse intervals
/// into totals and hour buckets — a timeline needs the actual spans. App
/// entries only: a site's interval is a subset of its browser's, and painting
/// both would double-cover every browser minute.
///
/// Same infallibility contract as the rest of this file: a missing or malformed
/// day reads as an empty list, and a junk timestamp drops that row rather than
/// the day. `date` is `YYYY-MM-DD` local; anything else resolves to an empty
/// day rather than an error.
#[tauri::command]
pub fn tt_usage_intervals(date: Option<String>) -> Vec<UsageInterval> {
    app_intervals(&date.unwrap_or_else(usage::today_local))
}

/// One local day's recorded app spans, for the coverage history strip.
#[derive(Debug, Clone, Serialize)]
pub struct DaySpans {
    /// `YYYY-MM-DD`, local.
    pub date: String,
    pub spans: Vec<UsageInterval>,
}

/// How many days `tt_usage_spans_range` returns by default.
const SPANS_RANGE_DEFAULT_DAYS: u32 = 30;

/// The most days `tt_usage_spans_range` will ever return, however large the
/// caller asks for — a display command should degrade, not build an
/// unbounded response.
const SPANS_RANGE_MAX_DAYS: u32 = 60;

/// Every app interval for a range of local days, oldest first, in one call.
///
/// Phase B's 30-day coverage strip needs a whole month of spans to paint the
/// history view; asking `tt_usage_intervals` once per day would be 30
/// round-trips through Tauri's IPC for a panel that renders on open. This
/// walks the same `range_days` used by `tt_usage_range` and batches the reads
/// into one call instead.
///
/// `days` defaults to 30 and is clamped to `1..=60`, silently — same posture
/// as `tt_usage_range`: this is a display command, so a wild input degrades
/// to the nearest sane range rather than erroring.
///
/// One `DaySpans` per date, **including days with no file** (empty `spans`).
/// Omitting those days would make the strip render a gap as "no column"
/// instead of "0%", which is a different claim — the same reasoning as the
/// zero-filled days in `tt_usage_range`.
#[tauri::command]
pub fn tt_usage_spans_range(days: Option<u32>) -> Vec<DaySpans> {
    let days = days
        .unwrap_or(SPANS_RANGE_DEFAULT_DAYS)
        .clamp(1, SPANS_RANGE_MAX_DAYS);
    range_days(days as i64)
        .into_iter()
        .map(|date| {
            let spans = app_intervals(&date);
            DaySpans { date, spans }
        })
        .collect()
}

/// Which account the daemon currently exports usage to.
///
/// Read from the config file rather than from the app's own auth session on
/// purpose: the session says who is *signed in here*, and this says where the
/// *daemon* is actually sending data. They can disagree — the app signs in
/// instantly, the daemon picks the change up on its next pass — and a switcher
/// that showed the session while claiming to show the export target would be
/// lying at exactly the moment it matters.
#[tauri::command]
pub fn tt_active_profile_get() -> String {
    crate::config::AppConfig::read_active_user_id().unwrap_or_default()
}

/// Point the daemon's usage export at a different account.
///
/// Takes effect on the daemon's next sync pass (within ~5 minutes); intervals
/// already uploaded stay with the account that owned them at the time, which is
/// correct — they were that person's.
///
/// The uid must be allowlisted server-side (`USAGE_ALLOWED_UIDS`), so writing a
/// stranger's uid here does not let this Mac file usage under their account; the
/// edge function 403s instead.
#[tauri::command]
pub fn tt_active_profile_set(user_id: String) -> Result<(), String> {
    let trimmed = user_id.trim();
    // A blank uid means "back to the function's default owner" and is allowed —
    // that is what signing out leaves behind.
    if !trimmed.is_empty() && trimmed.len() < 32 {
        return Err(format!("'{trimmed}' is not a plausible user id"));
    }
    crate::config::AppConfig::set_active_user_id(trimmed)
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
    fn intervals_for_a_day_with_no_file_are_empty_not_an_error() {
        // Same contract as the aggregate commands: a missing day is an empty
        // day. The panel renders "no screen time" rather than an error box.
        assert!(tt_usage_intervals(Some("2097-03-04".into())).is_empty());
        // And a nonsense date degrades the same way.
        assert!(tt_usage_intervals(Some("not-a-date".into())).is_empty());
    }

    // ── tt_usage_spans_range ────────────────────────────────────────────────

    #[test]
    fn the_default_range_is_thirty_ascending_days_ending_today() {
        let spans = tt_usage_spans_range(None);
        assert_eq!(spans.len(), 30);
        for pair in spans.windows(2) {
            assert!(pair[0].date < pair[1].date, "dates must be strictly ascending");
        }
        assert_eq!(spans.last().unwrap().date, usage::today_local());
    }

    #[test]
    fn a_requested_count_of_zero_clamps_up_to_one_day() {
        assert_eq!(tt_usage_spans_range(Some(0)).len(), 1);
    }

    #[test]
    fn a_huge_requested_count_clamps_down_to_sixty_days() {
        assert_eq!(tt_usage_spans_range(Some(999)).len(), 60);
    }

    #[test]
    fn every_day_is_present_even_when_its_file_does_not_exist() {
        // Most of these day files don't exist on a test machine — this reads
        // the real `~/.nexuslocal/usage/` directory, not a fixture, so the
        // dev machine's own tracker may have written today's file. That's
        // fine: the property under test is the *count* of entries, which
        // must equal the requested day count regardless of which files
        // happen to exist, not that every entry is empty. An omitted element
        // would render as "no column" instead of "0%", a different claim.
        let spans = tt_usage_spans_range(Some(10));
        assert_eq!(spans.len(), 10);
        let dates: std::collections::HashSet<_> = spans.iter().map(|d| d.date.clone()).collect();
        assert_eq!(dates.len(), 10, "every entry is a distinct date");
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

    // ── hourly bucketing ────────────────────────────────────────────────────

    /// An app interval given as local wall-clock times, converted to the RFC3339
    /// UTC the store actually holds — so these tests exercise the same parsing
    /// path as real data rather than a convenient fiction.
    fn local_app(name: &str, start_local: &str, end_local: &str) -> usage::UsageEntry {
        use chrono::TimeZone;
        let parse = |s: &str| {
            let naive = chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").unwrap();
            usage::LOCAL_TZ
                .from_local_datetime(&naive)
                .single()
                .unwrap()
                .with_timezone(&chrono::Utc)
        };
        usage::UsageEntry::app(name, parse(start_local), parse(end_local)).unwrap()
    }

    #[test]
    fn an_interval_is_split_across_the_hours_it_spans() {
        // 09:50 -> 10:20 is 10 minutes in hour 9 and 20 in hour 10. Attributing
        // all 30 to the start hour would spike the beginning of every long
        // session and leave the hours it covered empty.
        let hours = hourly_buckets(&[local_app("Ghostty", "2026-08-09 09:50:00", "2026-08-09 10:20:00")]);
        assert_eq!(hours[9], 10 * 60);
        assert_eq!(hours[10], 20 * 60);
        assert_eq!(hours.iter().sum::<i64>(), 30 * 60, "no seconds invented or lost");
    }

    #[test]
    fn a_multi_hour_interval_fills_every_hour_it_covers() {
        let hours = hourly_buckets(&[local_app("Xcode", "2026-08-09 08:30:00", "2026-08-09 12:15:00")]);
        assert_eq!(hours[8], 30 * 60);
        assert_eq!(hours[9], 3600);
        assert_eq!(hours[10], 3600);
        assert_eq!(hours[11], 3600);
        assert_eq!(hours[12], 15 * 60);
        assert_eq!(hours.iter().sum::<i64>(), (3 * 60 + 45) * 60);
    }

    #[test]
    fn web_entries_are_excluded_so_browser_time_is_not_double_counted() {
        // Site time happens *inside* an app interval. Counting both would make
        // an hour add up to more than 3600 seconds.
        let entries = vec![
            local_app("Google Chrome", "2026-08-09 14:00:00", "2026-08-09 14:30:00"),
            usage::UsageEntry::Web {
                host: "example.com".into(),
                url: String::new(),
                title: String::new(),
                start: "2026-08-09T12:00:00+00:00".into(),
                end: "2026-08-09T12:30:00+00:00".into(),
                seconds: 1800,
            },
        ];
        assert_eq!(hourly_buckets(&entries).iter().sum::<i64>(), 30 * 60);
    }

    #[test]
    fn buckets_are_always_24_long_and_junk_timestamps_are_skipped() {
        // A day with nothing still has to render 24 bars, and one unparseable
        // row must not take the chart down with it.
        let empty = hourly_buckets(&[]);
        assert_eq!(empty.len(), 24);
        assert!(empty.iter().all(|&s| s == 0));

        let junk = usage::UsageEntry::App {
            name: "Broken".into(),
            start: "not a timestamp".into(),
            end: "also not".into(),
            seconds: 60,
        };
        assert_eq!(hourly_buckets(&[junk]).iter().sum::<i64>(), 0);
    }
}
