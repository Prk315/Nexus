//! The usage store: append-only JSONL of completed time intervals, one file per
//! local day.
//!
//! ```text
//! ~/.nexuslocal/usage/2026-08-07.jsonl
//!   {"kind":"app","name":"Google Chrome","start":"…","end":"…","seconds":42}
//!   {"kind":"web","host":"github.com","url":"…","title":"…","start":"…","end":"…","seconds":30}
//! ```
//!
//! # Why local files and not Supabase
//!
//! This is the one dataset in the repo that must never leave the machine. The
//! repo is public, the anon key is hardcoded in `config.rs`, and every table the
//! productivity stack uses carries a permissive `USING (true)` RLS policy — so a
//! row written there is world-readable. "Which apps and websites this person
//! used, minute by minute" is exactly the shape of data that cannot be published
//! by accident, so there is deliberately no network code anywhere in this file.
//!
//! TODO(auth): sync only after RLS is scoped to auth.uid().
//!
//! # Why two processes read and write it
//!
//! On macOS the **daemon** owns the tracker (`modules/usage_tracker.rs`) and the
//! ingest endpoint (`usage_ingest.rs`); the desktop app is only a UI and spawns
//! no grid. The JSONL file *is* the channel between them: the daemon appends,
//! the app reads. That is why every read here is tolerant of a file being
//! written to at this exact moment.
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

// On iOS only the *reading* half of this module is reachable: `tt_usage_today`
// still compiles and still answers (with nothing, since no day file is ever
// written there), but there is no daemon, no tracker and no ingest listener, so
// every writer and the whole token path is genuinely unused. Scoped to iOS on
// purpose rather than blanket-allowed — real dead code on macOS, which is where
// `cargo check` and the test suite actually run, still warns.
#![cfg_attr(target_os = "ios", allow(dead_code))]

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
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
pub fn usage_dir() -> PathBuf {
    let dir = crate::config::state_dir().join("usage");
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

fn day_path(local_date: &str) -> Option<PathBuf> {
    is_valid_day(local_date).then(|| usage_dir().join(format!("{local_date}.jsonl")))
}

// ── writing ─────────────────────────────────────────────────────────────────

/// Serialises appends within this process.
///
/// `O_APPEND` gives atomicity per `write(2)` for small writes, but the tracker
/// tick and the ingest endpoint are two tasks in the same daemon and a web entry
/// carrying a long URL is not guaranteed small. One mutex is cheaper than a
/// class of interleaved lines that [`read_day`] would then have to throw away.
fn append_lock() -> &'static std::sync::Mutex<()> {
    static LOCK: std::sync::OnceLock<std::sync::Mutex<()>> = std::sync::OnceLock::new();
    LOCK.get_or_init(|| std::sync::Mutex::new(()))
}

/// Append one completed interval to its day file.
///
/// The file is chosen by the interval's **start**, not its end, so an interval
/// running across midnight lands wholly in the day it began — one interval is
/// one line in one file, and nothing has to be reconciled across two. The
/// tracker separately closes and reopens its interval at a date change, so in
/// practice the spill is at most one tick.
///
/// Unconditional: the tracker is the only caller and it never replays an
/// interval. Anything that might replay one wants [`append_deduped`].
pub fn append(entry: &UsageEntry) -> Result<(), String> {
    let day = day_of(entry)?;
    let _guard = append_lock().lock().unwrap_or_else(|e| e.into_inner());
    write_line(&day, entry)
}

/// Append, unless this exact interval is already on file. `Ok(false)` means it
/// was a duplicate and nothing was written.
///
/// # Why the endpoint needs this and the tracker does not
///
/// The browser extension's delivery is **at-least-once**: it dequeues a record
/// only after a successful POST, so a service worker killed mid-flush re-sends
/// rather than loses the interval. That is the right trade — losing usage is
/// worse than repeating it — but it makes duplicates a normal, expected event
/// rather than a bug, and double-counting an hour of one site is exactly the
/// kind of quiet wrongness that makes a whole panel untrustworthy.
///
/// Deduplicating is strictly better than rejecting here. A 409 would tell the
/// extension the record failed, so it would keep the record queued and retry it
/// forever — a permanent stuck head on a record that was in fact delivered.
/// Skipping and answering 200 lets the queue drain.
///
/// The natural key is `(start, end, url)`: two genuinely distinct visits cannot
/// share all three, and the extension closes an interval on every URL change, so
/// the same host legitimately appears many times in a day with different keys.
pub fn append_deduped(entry: &UsageEntry) -> Result<bool, String> {
    let day = day_of(entry)?;
    let Some(key) = web_key(entry) else {
        // App intervals have no replaying producer; nothing to dedupe against.
        let _guard = append_lock().lock().unwrap_or_else(|e| e.into_inner());
        return write_line(&day, entry).map(|_| true);
    };

    // One lock over the check and the write: two flushes arriving together must
    // not both find the key absent and both write it.
    let _guard = append_lock().lock().unwrap_or_else(|e| e.into_inner());
    let mut cache = seen_web_keys().lock().unwrap_or_else(|e| e.into_inner());
    let seen = match cache.as_mut() {
        Some(c) if c.day == day => c,
        // First write of the process, or the day rolled over. Rebuilt **from the
        // file**, so a daemon restarted between the extension's send and its
        // retry still recognises the record it already stored — an in-memory-only
        // guard would let every restart admit one duplicate per queued record.
        _ => {
            *cache = Some(SeenKeys {
                day: day.clone(),
                keys: read_day(&day)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(web_key)
                    .collect(),
            });
            cache.as_mut().expect("just set")
        }
    };

    if seen.keys.contains(&key) {
        return Ok(false);
    }
    write_line(&day, entry)?;
    seen.keys.insert(key);
    Ok(true)
}

fn day_of(entry: &UsageEntry) -> Result<String, String> {
    local_date_of_rfc3339(entry.start())
        .ok_or_else(|| format!("usage entry has an unparseable start: {}", entry.start()))
}

/// Serialize and append one line. Caller holds [`append_lock`].
fn write_line(day: &str, entry: &UsageEntry) -> Result<(), String> {
    let path = day_path(day).ok_or_else(|| format!("refusing to write day '{day}'"))?;
    let line = serde_json::to_string(entry).map_err(|e| format!("cannot serialize entry: {e}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("cannot open {}: {e}", path.display()))?;
    writeln!(file, "{line}").map_err(|e| format!("cannot append to {}: {e}", path.display()))
}

/// Natural key of a web interval, `start\u{1f}end\u{1f}url`. `None` for app
/// intervals. The unit separator cannot occur in an RFC3339 timestamp or a URL,
/// so two different triples cannot collide into one key.
fn web_key(entry: &UsageEntry) -> Option<String> {
    match entry {
        UsageEntry::App { .. } => None,
        UsageEntry::Web { start, end, url, .. } => Some(format!("{start}\u{1f}{end}\u{1f}{url}")),
    }
}

struct SeenKeys {
    day: String,
    keys: std::collections::HashSet<String>,
}

/// Web keys already on file for one day — an index over the day file, not a
/// source of truth. Rebuilt from disk whenever the day changes or the process
/// restarts, so it can never be the reason a duplicate slips through.
fn seen_web_keys() -> &'static std::sync::Mutex<Option<SeenKeys>> {
    static SEEN: std::sync::OnceLock<std::sync::Mutex<Option<SeenKeys>>> =
        std::sync::OnceLock::new();
    SEEN.get_or_init(|| std::sync::Mutex::new(None))
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

/// Seconds per label for a local day, largest first.
///
/// Ties break on the label so the order is stable between polls — a top-apps
/// list that reshuffles itself every 15 seconds because two apps are level looks
/// broken even though the numbers are right.
pub fn totals_for_day(local_date: &str) -> Vec<(String, i64)> {
    totals(&read_day(local_date).unwrap_or_default(), None)
}

/// What [`totals_for_day`] does, over entries you already have.
///
/// `kind` filters: `Some(true)` for apps only, `Some(false)` for sites only,
/// `None` for everything. Kept as one function because the sort and the tie-break
/// are the part that has to stay identical between the two lists.
pub fn totals(entries: &[UsageEntry], apps_only: Option<bool>) -> Vec<(String, i64)> {
    let mut acc: std::collections::HashMap<&str, i64> = std::collections::HashMap::new();
    for entry in entries {
        if let Some(want_app) = apps_only {
            if entry.is_app() != want_app {
                continue;
            }
        }
        // A negative `seconds` can only come from a hand-edited file or a
        // misbehaving extension; clamping keeps one bad line from making a
        // total go backwards.
        *acc.entry(entry.label()).or_insert(0) += entry.seconds().max(0);
    }
    let mut out: Vec<(String, i64)> = acc.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
    out.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    out
}

// ── the browser token ───────────────────────────────────────────────────────

/// Minimum length a stored token may have and still be honoured.
///
/// Fail-closed: a truncated, empty or hand-cleared token file must reject every
/// request rather than accidentally authorising one. Same posture as the widget
/// edge functions' scoped secrets.
pub const MIN_TOKEN_LEN: usize = 32;

/// Length of a freshly generated token.
const TOKEN_LEN: usize = 48;

pub fn token_path() -> PathBuf {
    crate::config::state_dir().join("browser_token")
}

/// Read the stored token, or `None` if there isn't a usable one.
///
/// Missing, unreadable and too-short all collapse to `None` on purpose — every
/// one of them means "we cannot authenticate anybody", and the caller must
/// reject rather than fall back.
pub fn read_browser_token() -> Option<String> {
    let raw = std::fs::read_to_string(token_path()).ok()?;
    let token = raw.trim().to_string();
    (token.len() >= MIN_TOKEN_LEN).then_some(token)
}

/// Read the token, generating one if there isn't a usable one yet.
///
/// Called once from `run_daemon()` so the file exists before the listener does,
/// and from `tt_usage_token` so the UI can show it without the daemon having
/// been started first. Both landing at once is harmless: the endpoint re-reads
/// the file on every request rather than caching it at startup, so the loser of
/// the race is never left validating against a token nobody has.
pub fn ensure_browser_token() -> Result<String, String> {
    if let Some(existing) = read_browser_token() {
        return Ok(existing);
    }
    let token = generate_token();
    let path = token_path();
    std::fs::write(&path, &token).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    // Owner-only. The token is the single thing standing between any web page on
    // the machine and an append into this user's usage history.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(token)
}

/// 48 hex characters, from two v4 UUIDs (32 hex each) truncated to length.
fn generate_token() -> String {
    let mut token = uuid::Uuid::new_v4().simple().to_string();
    token.push_str(&uuid::Uuid::new_v4().simple().to_string());
    token.truncate(TOKEN_LEN);
    token
}

/// Constant-time byte comparison.
///
/// A `==` on the token would return as soon as two bytes differed, and the time
/// that takes leaks how many leading characters a guess got right — enough to
/// recover the token one character at a time from a page that can retry freely.
/// Differing lengths short-circuit: the length is not the secret.
///
/// Compiled out on iOS along with everything else that authenticates the ingest
/// endpoint — there is no daemon and no listener on the phone.
#[cfg(any(not(target_os = "ios"), test))]
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Does a presented token authorise a request, given what is on disk?
///
/// Split out from the file read so every fail-closed case is testable. `stored`
/// is `None` when the file is missing or unreadable.
#[cfg(any(not(target_os = "ios"), test))]
pub fn token_is_valid(stored: Option<&str>, presented: &str) -> bool {
    let Some(stored) = stored else {
        return false;
    };
    let stored = stored.trim();
    // Both sides: a short *stored* token is a broken install, a short
    // *presented* one is a guess. Neither may pass.
    if stored.len() < MIN_TOKEN_LEN || presented.len() < MIN_TOKEN_LEN {
        return false;
    }
    constant_time_eq(stored.as_bytes(), presented.as_bytes())
}

/// [`token_is_valid`] against the token file as it is right now.
///
/// Re-read per request rather than cached at startup, so rotating the file takes
/// effect without restarting the daemon — and so the app and the daemon racing
/// to create it cannot leave the listener holding a stale value forever.
#[cfg(not(target_os = "ios"))]
pub fn browser_token_authorises(presented: &str) -> bool {
    token_is_valid(read_browser_token().as_deref(), presented)
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

    // ── totals ──────────────────────────────────────────────────────────────

    fn app_line(name: &str, seconds: i64) -> UsageEntry {
        UsageEntry::App {
            name: name.into(),
            start: "2026-08-07T09:00:00+00:00".into(),
            end: "2026-08-07T09:00:00+00:00".into(),
            seconds,
        }
    }

    fn web_line(host: &str, seconds: i64) -> UsageEntry {
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
    fn totals_accumulate_per_label_and_sort_descending() {
        let entries = vec![
            app_line("Chrome", 100),
            app_line("Ghostty", 300),
            app_line("Chrome", 250),
            web_line("github.com", 60),
        ];
        assert_eq!(
            totals(&entries, None),
            vec![
                ("Chrome".to_string(), 350),
                ("Ghostty".to_string(), 300),
                ("github.com".to_string(), 60),
            ]
        );
    }

    #[test]
    fn totals_filter_by_kind() {
        let entries = vec![app_line("Chrome", 100), web_line("github.com", 60)];
        assert_eq!(totals(&entries, Some(true)), vec![("Chrome".to_string(), 100)]);
        assert_eq!(
            totals(&entries, Some(false)),
            vec![("github.com".to_string(), 60)]
        );
    }

    #[test]
    fn equal_totals_break_ties_on_the_label() {
        // Without a deterministic tie-break the panel reshuffles level entries on
        // every 15s poll, which reads as a bug.
        let entries = vec![app_line("Zed", 60), app_line("Arc", 60), app_line("Mail", 60)];
        let names: Vec<String> = totals(&entries, None).into_iter().map(|(n, _)| n).collect();
        assert_eq!(names, vec!["Arc", "Mail", "Zed"]);
    }

    #[test]
    fn a_negative_seconds_line_cannot_drag_a_total_down() {
        let entries = vec![app_line("Chrome", 100), app_line("Chrome", -1000)];
        assert_eq!(totals(&entries, None), vec![("Chrome".to_string(), 100)]);
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

    // ── the browser token ───────────────────────────────────────────────────

    #[test]
    fn a_missing_token_file_authorises_nothing() {
        // Fail closed. Anything else means a machine with no token file accepts
        // whatever the first web page to guess sends.
        assert!(!token_is_valid(None, &"a".repeat(48)));
        assert!(!token_is_valid(None, ""));
    }

    #[test]
    fn a_short_stored_token_is_refused_even_when_it_matches() {
        // A truncated or hand-cleared file must not become a trivially guessable
        // credential just because both sides agree on it.
        let short = "abc";
        assert!(!token_is_valid(Some(short), short));
        let thirty_one = "a".repeat(MIN_TOKEN_LEN - 1);
        assert!(!token_is_valid(Some(&thirty_one), &thirty_one));
        let thirty_two = "a".repeat(MIN_TOKEN_LEN);
        assert!(token_is_valid(Some(&thirty_two), &thirty_two), "32 is the floor, not below it");
    }

    #[test]
    fn a_wrong_or_empty_presented_token_is_refused() {
        let stored = generate_token();
        assert!(!token_is_valid(Some(&stored), ""));
        assert!(!token_is_valid(Some(&stored), "wrong"));
        // Right length, wrong value.
        assert!(!token_is_valid(Some(&stored), &"0".repeat(TOKEN_LEN)));
        // A prefix must not pass — this is the guess a timing attack builds on.
        assert!(!token_is_valid(Some(&stored), &stored[..TOKEN_LEN - 1]));
        assert!(token_is_valid(Some(&stored), &stored));
    }

    #[test]
    fn a_stored_token_is_matched_after_trimming_whitespace() {
        // `echo` into the file adds a newline; that must not lock the user out.
        let stored = generate_token();
        assert!(token_is_valid(Some(&format!("{stored}\n")), &stored));
    }

    #[test]
    fn generated_tokens_are_long_and_not_repeated() {
        let a = generate_token();
        let b = generate_token();
        assert_eq!(a.len(), TOKEN_LEN);
        assert!(a.len() >= MIN_TOKEN_LEN);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn constant_time_eq_still_answers_the_question_correctly() {
        assert!(constant_time_eq(b"abc", b"abc"));
        assert!(!constant_time_eq(b"abc", b"abd"));
        assert!(!constant_time_eq(b"abc", b"ab"));
        assert!(constant_time_eq(b"", b""));
    }

    // ── the round trip through the filesystem ───────────────────────────────

    #[test]
    fn append_then_read_day_round_trips() {
        // Uses the real state dir (as every other filesystem test in this crate
        // does) but a date far enough out that it cannot collide with a real
        // day file.
        let day = "2099-12-31";
        let path = day_path(day).expect("valid day");
        let _ = std::fs::remove_file(&path);

        let entry = UsageEntry::app(
            "Ghostty",
            utc("2099-12-31T09:00:00Z"),
            utc("2099-12-31T09:10:00Z"),
        )
        .expect("10 minutes");
        append(&entry).expect("append");
        append(&entry).expect("append twice");

        let back = read_day(day).expect("read");
        assert_eq!(back.len(), 2);
        assert_eq!(back[0], entry);
        assert_eq!(totals_for_day(day), vec![("Ghostty".to_string(), 1200)]);

        // A half-written third line must not cost the first two.
        {
            use std::io::Write as _;
            let mut f = OpenOptions::new().append(true).open(&path).expect("reopen");
            write!(f, r#"{{"kind":"app","name":"Xco"#).expect("torn write");
        }
        assert_eq!(read_day(day).expect("read").len(), 2);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_day_with_no_file_reads_as_empty() {
        assert_eq!(read_day("2098-01-01").expect("no error"), Vec::new());
        assert!(totals_for_day("2098-01-01").is_empty());
    }

    // ── at-least-once delivery ──────────────────────────────────────────────

    fn web_at(url: &str, start: &str, end: &str, seconds: i64) -> UsageEntry {
        UsageEntry::Web {
            host: "github.com".into(),
            url: url.into(),
            title: "t".into(),
            start: start.into(),
            end: end.into(),
            seconds,
        }
    }

    #[test]
    fn a_replayed_web_interval_is_stored_once() {
        // The extension dequeues a record only after a successful POST, so a
        // service worker killed mid-flush re-sends it. Storing it twice would
        // double-count the interval; rejecting it would leave the record stuck
        // at the head of the extension's queue forever.
        let day = "2099-11-01";
        let path = day_path(day).expect("valid day");
        let _ = std::fs::remove_file(&path);

        let entry = web_at(
            "https://github.com/a",
            "2099-11-01T09:00:00.000Z",
            "2099-11-01T09:00:30.000Z",
            30,
        );
        assert!(append_deduped(&entry).expect("first"), "first delivery must store");
        assert!(!append_deduped(&entry).expect("replay"), "replay must be skipped");
        assert!(!append_deduped(&entry).expect("replay again"));
        assert_eq!(read_day(day).expect("read").len(), 1);

        // A *different* interval on the same host still lands — the key is
        // (start, end, url), and the extension closes an interval on every URL
        // change, so one host produces many keys in a row.
        let next = web_at(
            "https://github.com/b",
            "2099-11-01T09:00:30.000Z",
            "2099-11-01T09:01:00.000Z",
            30,
        );
        assert!(append_deduped(&next).expect("distinct interval"));
        assert_eq!(read_day(day).expect("read").len(), 2);
        assert_eq!(totals_for_day(day), vec![("github.com".to_string(), 60)]);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_duplicate_guard_survives_a_process_restart() {
        // The in-memory key set is an index over the file, not the source of
        // truth. If it were the source of truth, every daemon restart would
        // admit one duplicate per record still queued in the extension.
        let day = "2099-11-02";
        let path = day_path(day).expect("valid day");
        let _ = std::fs::remove_file(&path);

        let entry = web_at(
            "https://github.com/a",
            "2099-11-02T09:00:00.000Z",
            "2099-11-02T09:00:30.000Z",
            30,
        );
        assert!(append_deduped(&entry).expect("first"));

        // Simulate a restart: drop everything the process remembered.
        *seen_web_keys().lock().expect("lock") = None;
        assert!(!append_deduped(&entry).expect("replay after restart"));
        assert_eq!(read_day(day).expect("read").len(), 1);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn app_intervals_are_never_deduplicated() {
        // Two genuine visits to one app can share nothing but the app name, and
        // the tracker has no replay path — a dedupe here would only ever throw
        // away real usage.
        let day = "2099-11-03";
        let path = day_path(day).expect("valid day");
        let _ = std::fs::remove_file(&path);

        let entry = UsageEntry::App {
            name: "Ghostty".into(),
            start: "2099-11-03T09:00:00+00:00".into(),
            end: "2099-11-03T09:10:00+00:00".into(),
            seconds: 600,
        };
        assert!(append_deduped(&entry).expect("first"));
        assert!(append_deduped(&entry).expect("second"));
        assert_eq!(read_day(day).expect("read").len(), 2);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn several_short_visits_to_one_host_sum_into_one_row() {
        // The extension closes an interval on every URL change, not just a host
        // change, so one visit to a site arrives as a run of short intervals.
        // Totals are grouped by host; anything that assumed one interval per
        // host per visit would report a fraction of the real time.
        let entries: Vec<UsageEntry> = (0..6)
            .map(|i| {
                web_at(
                    &format!("https://github.com/page/{i}"),
                    "2099-11-04T09:00:00.000Z",
                    "2099-11-04T09:00:20.000Z",
                    20,
                )
            })
            .collect();
        assert_eq!(totals(&entries, None), vec![("github.com".to_string(), 120)]);
    }

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
