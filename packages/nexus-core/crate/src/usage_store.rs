//! The usage store's **read** side: parsing the JSONL usage log NexusLocal's
//! daemon appends to, one file per local day.
//!
//! ```text
//! ~/.nexuslocal/usage/2026-08-07.jsonl
//!   {"kind":"app","name":"Google Chrome","start":"…","end":"…","seconds":42}
//!   {"kind":"web","host":"github.com","url":"…","title":"…","start":"…","end":"…","seconds":30}
//! ```
//!
//! Shared so that anything which only ever *reads* this file — PathFinder's
//! `pf_usage_spans`, today — does not grow a second parser for the same wire
//! format that can silently drift from this one. The **writers** —
//! `append`, `append_deduped`, the dedupe caches, the browser token, every
//! token function — stay in `apps/NexusLocal/src-tauri/src/usage.rs`, which
//! re-exports everything in this module so its own public surface (and every
//! caller of it: `usage_cmd.rs`, `usage_ingest.rs`, `usage_sync.rs`,
//! `modules/usage_tracker.rs`) is unchanged.
//!
//! # The two properties that matter
//!
//! 1. **A corrupt line never costs the day.** Appends are not transactional: a
//!    crash or a full disk mid-write leaves a truncated last line, and a reader
//!    that aborted on it would lose every earlier interval of that day too.
//!    [`read_day`] skips what it cannot parse and keeps going.
//! 2. **The day boundary is Europe/Copenhagen, not the machine's timezone.**
//!    `chrono::Local` follows the OS setting, so a laptop taken to another
//!    country would start filing intervals against a different midnight than the
//!    `SESSION_LOCAL_TZ` the edge functions use, and "today" would disagree
//!    between the panel and everything else.

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// The project's local day boundary. Matches the `SESSION_LOCAL_TZ` secret the
/// edge functions run with — see the root `CLAUDE.md`.
pub const LOCAL_TZ: Tz = chrono_tz::Europe::Copenhagen;

/// Intervals shorter than this are noise, not usage.
///
/// A 5s sampling tick plus alt-tabbing through three windows to find one would
/// otherwise fill the day with one-second slivers of every app on the machine,
/// and the totals would read as "you used 40 apps today". Applies to what the
/// tracker records; the browser extension applies its own minimum.
pub const MIN_INTERVAL_SECS: i64 = 2;

/// One completed interval.
///
/// The wire format is frozen: a browser extension is written against this exact
/// shape, and it appends to the same files. `#[serde(tag = "kind")]` puts
/// `"kind"` first and the declared fields after it, which is the documented
/// layout. Adding a field is safe (readers default it); renaming one is not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum UsageEntry {
    /// A foreground macOS application.
    App {
        name: String,
        start: String,
        end: String,
        seconds: i64,
    },
    /// A website, reported by the browser extension over the localhost endpoint.
    ///
    /// `url` and `title` default rather than being required: an extension that
    /// cannot read the tab's title (a permission the user may not have granted)
    /// should still be able to report the host, which is the only field the
    /// totals are keyed on.
    Web {
        host: String,
        #[serde(default)]
        url: String,
        #[serde(default)]
        title: String,
        start: String,
        end: String,
        seconds: i64,
    },
}

impl UsageEntry {
    /// The key totals are grouped under: the app name, or the site's host.
    pub fn label(&self) -> &str {
        match self {
            UsageEntry::App { name, .. } => name,
            UsageEntry::Web { host, .. } => host,
        }
    }

    pub fn seconds(&self) -> i64 {
        match self {
            UsageEntry::App { seconds, .. } | UsageEntry::Web { seconds, .. } => *seconds,
        }
    }

    pub fn start(&self) -> &str {
        match self {
            UsageEntry::App { start, .. } | UsageEntry::Web { start, .. } => start,
        }
    }

    pub fn end(&self) -> &str {
        match self {
            UsageEntry::App { end, .. } | UsageEntry::Web { end, .. } => end,
        }
    }

    pub fn is_app(&self) -> bool {
        matches!(self, UsageEntry::App { .. })
    }

    /// Build an app interval, or `None` if it is too short to be worth recording.
    ///
    /// `end` is clamped to `start`: the tracker closes an interval at the moment
    /// input stopped, which is derived from a separately-sampled idle counter and
    /// can land marginally *before* the interval began (a switch that happened
    /// inside the idle window). A negative duration must never reach the file.
    pub fn app(name: &str, start: DateTime<Utc>, end: DateTime<Utc>) -> Option<Self> {
        let end = end.max(start);
        let seconds = (end - start).num_seconds();
        if seconds < MIN_INTERVAL_SECS {
            return None;
        }
        Some(UsageEntry::App {
            name: name.to_string(),
            start: start.to_rfc3339(),
            end: end.to_rfc3339(),
            seconds,
        })
    }
}

// ── paths ───────────────────────────────────────────────────────────────────

/// `~/.nexuslocal/usage/`. Created on demand.
///
/// Reimplements NexusLocal's `config::writable_root()`/`state_dir()` path
/// resolution rather than depending on that crate — nexus-core sits below
/// every app, not above one, so the dependency can only run this direction.
/// On iOS `home_dir()` returns the app container root, which is read-only;
/// the writable area is `Documents/` instead. That redirect must match the
/// daemon's own resolution byte for byte or the phone build silently reads
/// (or writes, from the NexusLocal side) the wrong directory.
pub fn usage_dir() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    let writable_root = if cfg!(target_os = "ios") { home.join("Documents") } else { home };
    let dir = writable_root.join(".nexuslocal").join("usage");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// `YYYY-MM-DD` in [`LOCAL_TZ`].
pub fn local_date_of(instant: DateTime<Utc>) -> String {
    instant.with_timezone(&LOCAL_TZ).format("%Y-%m-%d").to_string()
}

/// `YYYY-MM-DD` for an RFC3339 timestamp in any offset. `None` if unparseable.
pub fn local_date_of_rfc3339(ts: &str) -> Option<String> {
    let parsed = DateTime::parse_from_rfc3339(ts).ok()?;
    Some(local_date_of(parsed.with_timezone(&Utc)))
}

/// Today, in [`LOCAL_TZ`].
pub fn today_local() -> String {
    local_date_of(Utc::now())
}

/// Reject anything that is not a bare `YYYY-MM-DD`.
///
/// The date is interpolated straight into a filename and reaches this crate from
/// a Tauri command, so `../../.ssh/id_rsa` must not be a readable "day".
fn is_valid_day(local_date: &str) -> bool {
    local_date.len() == 10
        && local_date.as_bytes().iter().enumerate().all(|(i, b)| match i {
            4 | 7 => *b == b'-',
            _ => b.is_ascii_digit(),
        })
}

/// Build the path to one local day's JSONL file, or `None` if `local_date`
/// isn't a valid bare date.
///
/// `pub`: NexusLocal's writers (`write_line` in `usage.rs`) need the identical
/// path resolution the readers use here — one function computing the path, not
/// two copies that could drift apart.
pub fn day_path(local_date: &str) -> Option<PathBuf> {
    is_valid_day(local_date).then(|| usage_dir().join(format!("{local_date}.jsonl")))
}

// ── reading ─────────────────────────────────────────────────────────────────

/// Every interval recorded on a local day, oldest first.
///
/// A day with no file is `Ok(vec![])`, not an error: no usage yet is the normal
/// state of every day before the first app switch, and the panel would otherwise
/// show an error every morning.
///
/// Lines that do not parse are **skipped silently**. The last line of a file
/// being written to right now is routinely half-formed, and one truncated write
/// must never take the rest of the day with it.
pub fn read_day(local_date: &str) -> Result<Vec<UsageEntry>, String> {
    let path = day_path(local_date).ok_or_else(|| format!("invalid day '{local_date}'"))?;
    let raw = match std::fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("cannot read {}: {e}", path.display())),
    };
    Ok(parse_lines(&raw))
}

/// Parse a whole day file, dropping anything unreadable. Pure, so the
/// corrupt-line behaviour is testable without touching the filesystem.
fn parse_lines(raw: &str) -> Vec<UsageEntry> {
    raw.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<UsageEntry>(l).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s)
            .expect("fixture timestamp")
            .with_timezone(&Utc)
    }

    // ── the wire format ─────────────────────────────────────────────────────

    #[test]
    fn app_entry_serializes_to_the_documented_shape() {
        // A browser extension is written against this exact JSON. Field names or
        // the `kind` discriminator changing here silently breaks a component
        // that lives in another repo and appends to the same files.
        let entry = UsageEntry::App {
            name: "Google Chrome".into(),
            start: "2026-08-07T09:00:00+00:00".into(),
            end: "2026-08-07T09:00:42+00:00".into(),
            seconds: 42,
        };
        let json = serde_json::to_string(&entry).expect("serializes");
        assert_eq!(
            json,
            r#"{"kind":"app","name":"Google Chrome","start":"2026-08-07T09:00:00+00:00","end":"2026-08-07T09:00:42+00:00","seconds":42}"#
        );
    }

    #[test]
    fn web_entry_round_trips_the_extensions_line() {
        let line = r#"{"kind":"web","host":"github.com","url":"https://github.com/a/b","title":"a/b","start":"2026-08-07T09:00:00+00:00","end":"2026-08-07T09:00:30+00:00","seconds":30}"#;
        let entry: UsageEntry = serde_json::from_str(line).expect("parses");
        assert_eq!(entry.label(), "github.com");
        assert_eq!(entry.seconds(), 30);
        assert!(!entry.is_app());
        assert_eq!(serde_json::to_string(&entry).expect("serializes"), line);
    }

    #[test]
    fn a_web_entry_without_url_or_title_still_parses() {
        // Title needs a permission the user may not have granted. Dropping the
        // whole interval because of it would lose real usage.
        let entry: UsageEntry = serde_json::from_str(
            r#"{"kind":"web","host":"github.com","start":"2026-08-07T09:00:00+00:00","end":"2026-08-07T09:00:30+00:00","seconds":30}"#,
        )
        .expect("parses");
        assert_eq!(entry.label(), "github.com");
    }

    // ── short-interval filtering ────────────────────────────────────────────

    #[test]
    fn sub_two_second_intervals_are_dropped() {
        let start = utc("2026-08-07T09:00:00Z");
        // Alt-tabbing through windows to find one: every app touched on the way
        // would otherwise appear in the day's totals.
        assert_eq!(UsageEntry::app("Finder", start, start), None);
        assert_eq!(
            UsageEntry::app("Finder", start, start + chrono::Duration::seconds(1)),
            None
        );
        assert_eq!(
            UsageEntry::app("Finder", start, start + chrono::Duration::milliseconds(1999)),
            None,
            "1.999s truncates to 1s and is still noise"
        );
    }

    #[test]
    fn exactly_two_seconds_is_recorded() {
        let start = utc("2026-08-07T09:00:00Z");
        let entry = UsageEntry::app("Finder", start, start + chrono::Duration::seconds(2))
            .expect("2s is at the threshold, not below it");
        assert_eq!(entry.seconds(), 2);
    }

    #[test]
    fn a_backwards_interval_cannot_produce_negative_seconds() {
        // The idle path closes an interval at "now minus idle", which can land
        // before the interval started if the switch happened inside the idle
        // window. A negative duration in the file would make totals go backwards.
        let start = utc("2026-08-07T09:00:00Z");
        assert_eq!(
            UsageEntry::app("Finder", start, start - chrono::Duration::minutes(5)),
            None
        );
    }

    // ── corrupt lines ───────────────────────────────────────────────────────

    #[test]
    fn a_truncated_last_line_does_not_lose_the_day() {
        // The exact shape of a crash (or a full disk) mid-append. A reader that
        // aborted here would throw away every interval recorded before it.
        let raw = concat!(
            r#"{"kind":"app","name":"Ghostty","start":"2026-08-07T09:00:00+00:00","end":"2026-08-07T09:10:00+00:00","seconds":600}"#,
            "\n",
            r#"{"kind":"app","name":"Chrome","start":"2026-08-07T09:10:00+00:00","end":"2026-08-07T09:15:00+00:00","seconds":300}"#,
            "\n",
            r#"{"kind":"app","name":"Xcod"#,
        );
        let entries = parse_lines(raw);
        assert_eq!(entries.len(), 2, "the two complete lines must survive");
        assert_eq!(entries[0].label(), "Ghostty");
        assert_eq!(entries[1].label(), "Chrome");
    }

    #[test]
    fn junk_and_blank_lines_are_skipped_not_fatal() {
        let raw = concat!(
            "\n",
            "not json at all\n",
            r#"{"kind":"app","name":"Ghostty","start":"2026-08-07T09:00:00+00:00","end":"2026-08-07T09:10:00+00:00","seconds":600}"#,
            "\n",
            r#"{"kind":"unknown-future-kind","seconds":1}"#,
            "\n",
            "   \n",
            r#"{"kind":"web","host":"github.com","url":"","title":"","start":"2026-08-07T10:00:00+00:00","end":"2026-08-07T10:00:30+00:00","seconds":30}"#,
            "\n",
        );
        let entries = parse_lines(raw);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].label(), "Ghostty");
        assert_eq!(entries[1].label(), "github.com");
    }

    #[test]
    fn an_empty_file_is_an_empty_day_not_an_error() {
        assert!(parse_lines("").is_empty());
        assert!(parse_lines("\n\n").is_empty());
    }

    // ── the local day boundary ──────────────────────────────────────────────

    #[test]
    fn the_day_rolls_over_at_copenhagen_midnight_not_utc_midnight() {
        // Summer: Copenhagen is UTC+2, so 22:30Z is already tomorrow locally.
        // Filing this under the UTC date would put an evening's work on the
        // wrong day and make "today" wrong for two hours every night.
        assert_eq!(local_date_of(utc("2026-08-06T21:59:00Z")), "2026-08-06");
        assert_eq!(local_date_of(utc("2026-08-06T22:00:00Z")), "2026-08-07");
        assert_eq!(local_date_of(utc("2026-08-07T10:00:00Z")), "2026-08-07");
    }

    #[test]
    fn the_offset_follows_dst_rather_than_being_fixed() {
        // Winter is UTC+1, summer UTC+2. A hardcoded offset would be right for
        // half the year and silently an hour out for the other half.
        assert_eq!(local_date_of(utc("2026-01-05T23:30:00Z")), "2026-01-06");
        assert_eq!(local_date_of(utc("2026-01-05T22:30:00Z")), "2026-01-05");
        assert_eq!(local_date_of(utc("2026-07-05T22:30:00Z")), "2026-07-06");
        assert_eq!(local_date_of(utc("2026-07-05T21:30:00Z")), "2026-07-05");
    }

    #[test]
    fn the_day_is_read_off_the_start_so_one_interval_is_one_line() {
        // An interval that crosses midnight belongs to the day it began. The
        // alternative — splitting it — means two lines that have to be
        // reconciled, and a reader that sees only one of them mid-write.
        let entry = UsageEntry::app(
            "Ghostty",
            utc("2026-08-06T21:59:00Z"),
            utc("2026-08-06T22:05:00Z"),
        )
        .expect("6 minutes");
        assert_eq!(
            local_date_of_rfc3339(entry.start()).as_deref(),
            Some("2026-08-06")
        );
    }

    #[test]
    fn timestamps_in_any_offset_resolve_to_the_same_local_day() {
        // The extension may send `Z`, `+00:00` or a local offset — all three are
        // RFC3339 and all three describe the same instant.
        assert_eq!(
            local_date_of_rfc3339("2026-08-06T22:30:00Z").as_deref(),
            Some("2026-08-07")
        );
        assert_eq!(
            local_date_of_rfc3339("2026-08-07T00:30:00+02:00").as_deref(),
            Some("2026-08-07")
        );
        assert_eq!(local_date_of_rfc3339("2026-08-06 22:30:00"), None);
        assert_eq!(local_date_of_rfc3339("garbage"), None);
    }

    #[test]
    fn today_local_agrees_with_the_clock() {
        let now = Utc::now();
        assert_eq!(today_local(), local_date_of(now));
        // Sanity: the helper is timezone-aware, not a UTC format call.
        let midwinter = chrono_tz::Europe::Copenhagen
            .with_ymd_and_hms(2026, 1, 6, 0, 30, 0)
            .single()
            .expect("unambiguous local time");
        assert_eq!(local_date_of(midwinter.with_timezone(&Utc)), "2026-01-06");
    }

    // ── filename safety ─────────────────────────────────────────────────────

    #[test]
    fn only_bare_dates_can_name_a_day_file() {
        // `local_date` arrives from a Tauri command and is interpolated into a
        // path. Traversal must not be a readable "day".
        assert!(is_valid_day("2026-08-07"));
        assert!(!is_valid_day("../../../etc/passwd"));
        assert!(!is_valid_day("2026-08-07.jsonl"));
        assert!(!is_valid_day("2026/08/07"));
        assert!(!is_valid_day(""));
        assert!(read_day("../secrets").is_err());
        assert!(day_path("2026-08-07").is_some());
    }

    // ── millisecond timestamps ──────────────────────────────────────────────

    #[test]
    fn millisecond_z_timestamps_are_accepted_as_readily_as_offset_ones() {
        // The extension emits `2026-08-07T12:00:00.000Z`. Both spellings are
        // RFC3339 and must resolve to the same local day — a stricter format
        // check here would reject every record the extension ever sends.
        assert_eq!(
            local_date_of_rfc3339("2026-08-06T22:30:00.000Z"),
            local_date_of_rfc3339("2026-08-06T22:30:00+00:00")
        );
        assert_eq!(
            local_date_of_rfc3339("2026-08-06T22:30:00.000Z").as_deref(),
            Some("2026-08-07")
        );
    }
}
