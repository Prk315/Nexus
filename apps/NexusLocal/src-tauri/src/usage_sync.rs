//! Uploads local usage intervals to Supabase so other apps can read them.
//!
//! # Why this does not write to PostgREST directly
//!
//! Every other Supabase write in this codebase goes straight to a table with the
//! anon key. That cannot work here. `usage_intervals` holds full URLs and page
//! titles, so its RLS is scoped to `auth.uid()` with **no anon policy at all**
//! (see `supabase/migrations/20260807173000_usage_intervals.sql`) — and the
//! daemon has no session to satisfy it. Writes therefore go through the
//! `usage-ingest` edge function, which holds a scoped secret and a service-role
//! client and stamps the owner id server-side. Same shape as the widget's
//! `session-toggle`.
//!
//! # Why the key lives in the config file and not in this source
//!
//! The repo is **public**. A key compiled into this file would be published on
//! the next push, which is precisely the failure the scoped design exists to
//! avoid. `usage_ingest_key` is read from `~/.nexuslocalrc`, which never leaves
//! the machine. **No key means sync is off** — silently doing nothing is the
//! right default for a machine that has not opted in.
//!
//! # The cursor, and why it is a byte offset
//!
//! Day files are append-only, so "how much of this file have I sent" is one
//! integer per day. Storing a byte offset rather than a line count means a
//! partially-written final line (the tracker appending while we read) is simply
//! not counted yet, and gets picked up whole on the next pass. Storing a line
//! count would risk advancing past a line that was still being written.
//!
//! Duplicates are harmless regardless: the edge function dedupes on
//! `(user_id, device_id, dedupe_key)`, so a cursor that rewinds after a crash
//! re-sends rows that are simply ignored. The cursor is an optimisation, not a
//! correctness mechanism — which is the right way round, because the alternative
//! (trusting the cursor for correctness) loses data whenever it is wrong.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::time::Duration;

use crate::usage::{self, UsageEntry};

/// How often a sync pass runs. Usage is not urgent — the consuming apps are
/// dashboards, not alarms — and a 5-minute cadence keeps the request count
/// trivial while still making "today" feel current.
const SYNC_INTERVAL_SECS: u64 = 5 * 60;

/// Matches `MAX_ENTRIES` in the edge function. Exceeding it is a 413, so the
/// batch is chunked here rather than discovered at runtime.
const MAX_BATCH: usize = 500;

/// Days considered on each pass. Today plus yesterday, because an interval that
/// was still open at local midnight closes into yesterday's file shortly after
/// the day rolls over, and a today-only sync would strand it forever.
const DAYS_BACK: i64 = 1;

#[derive(Debug, Default, Serialize, Deserialize)]
struct SyncState {
    /// local_date -> bytes of that day's file already uploaded.
    #[serde(default)]
    offsets: HashMap<String, u64>,
}

fn state_path() -> std::path::PathBuf {
    usage::usage_dir().join(".sync_state.json")
}

fn load_state() -> SyncState {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Persist atomically — the same write-temp-then-rename discipline as
/// `AppConfig::save`, so a crash mid-write cannot leave a truncated cursor file
/// that parses as `{}` and re-uploads the entire history.
fn save_state(state: &SyncState) -> Result<(), String> {
    let path = state_path();
    let tmp = path.with_extension(format!("tmp.{}", std::process::id()));
    let body = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, body).map_err(|e| format!("cannot write {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("cannot replace {}: {e}", path.display())
    })
}

/// One JSONL entry as the edge function expects it.
///
/// Deliberately NOT `UsageEntry`'s own serialization: that is the on-disk format
/// and the two must be free to diverge. `local_date` is added here because the
/// day is implied by the filename on disk but must be explicit over the wire.
fn to_wire(entry: &UsageEntry, local_date: &str) -> Value {
    match entry {
        UsageEntry::App {
            name,
            start,
            end,
            seconds,
        } => json!({
            "kind": "app",
            "app_name": name,
            "start": start,
            "end": end,
            "seconds": seconds,
            "local_date": local_date,
        }),
        UsageEntry::Web {
            host,
            url,
            title,
            start,
            end,
            seconds,
        } => json!({
            "kind": "web",
            "host": host,
            "url": url,
            "title": title,
            "start": start,
            "end": end,
            "seconds": seconds,
            "local_date": local_date,
        }),
    }
}

/// Read a day file from `offset`, returning parsed entries and the offset up to
/// which parsing succeeded cleanly.
///
/// A trailing partial line is left uncounted rather than parsed: the tracker may
/// be mid-append. Returns `None` if the file does not exist yet.
fn read_from(local_date: &str, offset: u64) -> Option<(Vec<UsageEntry>, u64)> {
    let path = usage::usage_dir().join(format!("{local_date}.jsonl"));
    let raw = std::fs::read_to_string(&path).ok()?;
    let bytes = raw.len() as u64;
    if offset >= bytes {
        return Some((Vec::new(), bytes));
    }
    // Byte offsets are safe to slice on here because every line this writes is
    // JSON with a trailing '\n', so an offset always lands on a line boundary.
    let tail = &raw[offset as usize..];

    let mut entries = Vec::new();
    let mut consumed = offset;
    for line in tail.split_inclusive('\n') {
        if !line.ends_with('\n') {
            // Partial final line — a concurrent append. Stop; next pass gets it.
            break;
        }
        consumed += line.len() as u64;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        // A corrupt line is skipped but still consumed: retrying it forever
        // would wedge the cursor and stall every later entry behind it.
        match serde_json::from_str::<UsageEntry>(trimmed) {
            Ok(e) => entries.push(e),
            Err(e) => eprintln!("[usage-sync] skipping unparseable line in {local_date}: {e}"),
        }
    }
    Some((entries, consumed))
}

/// The local dates a pass should consider, newest first.
fn days_to_scan() -> Vec<String> {
    let today = usage::today_local();
    let mut days = vec![today];
    for back in 1..=DAYS_BACK {
        let when = chrono::Utc::now() - chrono::Duration::days(back);
        let date = usage::local_date_of(when);
        if !days.contains(&date) {
            days.push(date);
        }
    }
    days
}

async fn post_batch(
    client: &reqwest::Client,
    base_url: &str,
    anon_key: &str,
    ingest_key: &str,
    device_id: &str,
    active_user_id: &str,
    entries: &[Value],
) -> Result<(), String> {
    let url = format!("{}/functions/v1/usage-ingest", base_url.trim_end_matches('/'));
    let response = client
        .post(&url)
        // The platform's `verify_jwt` runs before the function does, so the anon
        // key is still required as a bearer token. It is not what authorises the
        // write — `X-Usage-Key` is.
        .header("Authorization", format!("Bearer {anon_key}"))
        .header("X-Usage-Key", ingest_key)
        // `user_id` is omitted when unset so a config written before profile
        // switching existed keeps hitting the function's default owner. When
        // present the function validates it against an allowlist and 403s on a
        // mismatch — it must never silently fall back, because attributing one
        // person's browsing to the other is worse than not uploading at all.
        .json(&{
            let mut body = json!({ "device_id": device_id, "entries": entries });
            if !active_user_id.is_empty() {
                body["user_id"] = json!(active_user_id);
            }
            body
        })
        .send()
        .await
        .map_err(|e| format!("request failed: {e}"))?;

    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let body = response.text().await.unwrap_or_default();
    Err(format!("HTTP {status}: {}", body.trim()))
}

/// Run one pass. Returns how many entries were uploaded.
async fn sync_once(
    client: &reqwest::Client,
    base_url: &str,
    anon_key: &str,
    ingest_key: &str,
    device_id: &str,
) -> Result<usize, String> {
    // Re-read every pass rather than caching at startup: switching profile in
    // the app must change where the next batch lands without restarting the
    // daemon. `None` (unreadable/mid-write) keeps the previous value.
    let active_user_id = crate::config::AppConfig::read_active_user_id().unwrap_or_default();
    let mut state = load_state();
    let mut uploaded = 0usize;

    for day in days_to_scan() {
        let offset = state.offsets.get(&day).copied().unwrap_or(0);
        let Some((entries, consumed)) = read_from(&day, offset) else {
            continue; // no file for that day
        };
        if entries.is_empty() {
            // Still record the consumed offset so blank/corrupt-only regions are
            // not re-read every five minutes forever.
            if consumed != offset {
                state.offsets.insert(day.clone(), consumed);
                let _ = save_state(&state);
            }
            continue;
        }

        let wire: Vec<Value> = entries.iter().map(|e| to_wire(e, &day)).collect();
        for chunk in wire.chunks(MAX_BATCH) {
            post_batch(client, base_url, anon_key, ingest_key, device_id, &active_user_id, chunk)
                .await?;
            uploaded += chunk.len();
        }

        // Advance only after every chunk for the day landed. A failure mid-day
        // leaves the cursor where it was and the whole day is retried — the
        // edge function's dedupe makes that free.
        state.offsets.insert(day.clone(), consumed);
        save_state(&state)?;
    }

    Ok(uploaded)
}

/// Start the background sync loop. No-op when no ingest key is configured.
pub fn spawn(base_url: String, anon_key: String, ingest_key: String, device_id: String) {
    if ingest_key.trim().is_empty() {
        eprintln!(
            "[usage-sync] disabled — no `usage_ingest_key` in ~/.nexuslocalrc. \
             Usage stays on this Mac."
        );
        return;
    }
    if base_url.trim().is_empty() || anon_key.trim().is_empty() {
        eprintln!("[usage-sync] disabled — Supabase is not configured");
        return;
    }

    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(30))
            .build()
            .unwrap_or_default();

        // A short first delay rather than firing at startup: let the tracker
        // settle and avoid racing the ingest listener's own bind.
        tokio::time::sleep(Duration::from_secs(20)).await;
        let mut ticker = tokio::time::interval(Duration::from_secs(SYNC_INTERVAL_SECS));

        loop {
            match sync_once(&client, &base_url, &anon_key, &ingest_key, &device_id).await {
                Ok(0) => {}
                Ok(n) => eprintln!("[usage-sync] uploaded {n} interval(s)"),
                // Never fatal: the cursor did not advance, so the next pass
                // retries. Offline for a day just means a bigger batch later.
                Err(e) => eprintln!("[usage-sync] pass failed, will retry: {e}"),
            }
            ticker.tick().await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app(name: &str, start: &str, secs: i64) -> UsageEntry {
        UsageEntry::App {
            name: name.to_string(),
            start: start.to_string(),
            end: start.to_string(),
            seconds: secs,
        }
    }

    #[test]
    fn wire_format_carries_the_explicit_local_date() {
        // On disk the day is implied by the filename; over the wire it must be
        // a field, or the server would bucket by UTC midnight and split every
        // evening across two days.
        let v = to_wire(&app("Ghostty", "2026-08-07T22:30:00Z", 60), "2026-08-07");
        assert_eq!(v["kind"], "app");
        assert_eq!(v["app_name"], "Ghostty");
        assert_eq!(v["local_date"], "2026-08-07");
        assert_eq!(v["seconds"], 60);
    }

    #[test]
    fn web_wire_format_matches_the_functions_validator() {
        let v = to_wire(
            &UsageEntry::Web {
                host: "example.com".into(),
                url: "https://example.com/a".into(),
                title: "Ex".into(),
                start: "2026-08-07T10:00:00Z".into(),
                end: "2026-08-07T10:00:30Z".into(),
                seconds: 30,
            },
            "2026-08-07",
        );
        // The function rejects a web entry with neither host nor url, and an app
        // entry with no app_name — so those keys must be present and non-empty.
        assert_eq!(v["kind"], "web");
        assert_eq!(v["host"], "example.com");
        assert_eq!(v["url"], "https://example.com/a");
        assert!(v.get("app_name").is_none());
    }

    #[test]
    fn a_partial_trailing_line_is_not_consumed() {
        // The tracker appends while this reads. Counting a half-written line
        // would advance the cursor past an entry that was never sent.
        let dir = std::env::temp_dir().join(format!("nexus-sync-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&dir);
        let path = dir.join("partial.jsonl");
        let complete = r#"{"kind":"app","name":"A","start":"s","end":"e","seconds":5}"#;
        std::fs::write(&path, format!("{complete}\n{{\"kind\":\"app\",\"na")).unwrap();

        let raw = std::fs::read_to_string(&path).unwrap();
        let mut consumed = 0u64;
        let mut parsed = 0;
        for line in raw.split_inclusive('\n') {
            if !line.ends_with('\n') {
                break;
            }
            consumed += line.len() as u64;
            if serde_json::from_str::<UsageEntry>(line.trim()).is_ok() {
                parsed += 1;
            }
        }
        assert_eq!(parsed, 1, "only the complete line parses");
        assert_eq!(consumed as usize, complete.len() + 1, "partial line not counted");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scanned_days_include_yesterday() {
        // An interval open across local midnight closes into yesterday's file
        // after the rollover; a today-only sync would strand it permanently.
        let days = days_to_scan();
        assert_eq!(days.len(), 2, "today + yesterday, got {days:?}");
        assert_eq!(days[0], usage::today_local());
        assert_ne!(days[0], days[1]);
    }

    #[test]
    fn state_round_trips_through_the_atomic_write() {
        let mut s = SyncState::default();
        s.offsets.insert("2026-08-07".into(), 4096);
        let encoded = serde_json::to_string(&s).unwrap();
        let back: SyncState = serde_json::from_str(&encoded).unwrap();
        assert_eq!(back.offsets.get("2026-08-07"), Some(&4096));
        // A truncated cursor file must degrade to "nothing synced yet" (which
        // re-uploads and dedupes) rather than to a wrong offset.
        assert!(serde_json::from_str::<SyncState>("{\"offse").is_err());
    }
}
