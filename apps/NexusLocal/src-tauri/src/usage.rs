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
//! # The read half lives in `nexus-core`
//!
//! `UsageEntry`, the wire format, and everything that only *reads* a day file
//! (`read_day`, `parse_lines`, the local-day math, `usage_dir`) moved to
//! `packages/nexus-core/crate/src/usage_store.rs` so PathFinder's
//! `pf_usage_spans` can read this exact file without a second parser that can
//! drift from this one. Every moved item is re-exported below, so this
//! module's public surface — and every caller of it in this crate — is
//! unchanged. The two properties that matter (a corrupt line never costs the
//! day; the day boundary is Europe/Copenhagen, not the machine's timezone) are
//! documented on [`nexus_core::usage_store`] now, not here.
//!
//! The **writers** — `append`, `append_deduped`, the dedupe caches, the
//! browser token — stay here. They are ingest-side and specific to this
//! daemon; nothing else in the workspace should ever write this file.

// On iOS only the *reading* half of this module is reachable: `tt_usage_today`
// still compiles and still answers (with nothing, since no day file is ever
// written there), but there is no daemon, no tracker and no ingest listener, so
// every writer and the whole token path is genuinely unused. Scoped to iOS on
// purpose rather than blanket-allowed — real dead code on macOS, which is where
// `cargo check` and the test suite actually run, still warns.
#![cfg_attr(target_os = "ios", allow(dead_code))]

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;

// The read side: the wire format and everything that only ever reads a day
// file. Moved to nexus-core so PathFinder can read the same files without a
// second parser. Re-exported so nothing below (or in `usage_cmd.rs`,
// `usage_ingest.rs`, `usage_sync.rs`, `modules/usage_tracker.rs`) has to change.
pub use nexus_core::usage_store::{
    day_path, local_date_of, local_date_of_rfc3339, read_day, today_local, usage_dir, UsageEntry,
    LOCAL_TZ, MIN_INTERVAL_SECS,
};

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

// ── totals ──────────────────────────────────────────────────────────────────

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
    use chrono::{DateTime, Utc};

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s)
            .expect("fixture timestamp")
            .with_timezone(&Utc)
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

    #[test]
    fn several_short_visits_to_one_host_sum_into_one_row() {
        // The extension closes an interval on every URL change, not just a host
        // change, so one visit to a site arrives as a run of short intervals.
        // Totals are grouped by host; anything that assumed one interval per
        // host per visit would report a fraction of the real time.
        let entries: Vec<UsageEntry> = (0..6)
            .map(|i| {
                UsageEntry::Web {
                    host: "github.com".into(),
                    url: format!("https://github.com/page/{i}"),
                    title: String::new(),
                    start: "2099-11-04T09:00:00.000Z".into(),
                    end: "2099-11-04T09:00:20.000Z".into(),
                    seconds: 20,
                }
            })
            .collect();
        assert_eq!(totals(&entries, None), vec![("github.com".to_string(), 120)]);
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
}
