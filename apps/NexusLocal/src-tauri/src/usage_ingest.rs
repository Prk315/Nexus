//! Localhost ingest for web usage — the browser extension's way in.
//!
//! The tracker (`modules/usage_tracker.rs`) can see that Chrome was in front for
//! 40 minutes; it cannot see which sites those minutes went to, and the ways of
//! finding out from outside the browser all require Accessibility or Automation
//! permissions and read every window's contents. A browser extension already
//! knows, exactly, and only about the browser. So it reports in over a loopback
//! HTTP endpoint and the entries land in the same JSONL day files.
//!
//! ```text
//! POST http://127.0.0.1:1431/usage/web     X-Nexus-Token: <48 hex chars>
//!   {"url":"…","title":"…","host":"github.com","seconds":30,"start":"…","end":"…"}
//! GET  http://127.0.0.1:1431/usage/health  → 200 {"ok":true}
//! ```
//!
//! # Why this needs a token at all
//!
//! **Any web page open in the browser can POST to localhost.** A cross-origin
//! `fetch` with `mode: "no-cors"` is sent, and the sender cannot read the
//! response but does not need to — it is writing, not reading. So without
//! authentication, `evil.example` could quietly write "you spent 8 hours on
//! <embarrassing host>" into this user's history, or flood the day file until
//! the disk filled. The token is the entire defence, and it lives in a
//! `0600` file in the state dir that only a process running as this user can
//! read — which a web page is not.
//!
//! Everything about it fails closed: missing file, unreadable file, or a stored
//! token under [`usage::MIN_TOKEN_LEN`] characters all reject **every** request,
//! rather than degrading to "no token configured, allow anything". Same posture
//! as the widget edge functions' scoped secrets, and the same constant-time
//! compare, so a page cannot recover the token a character at a time by timing.
//!
//! `/usage/health` deliberately needs no token: the extension shows a
//! connected/disconnected dot, and requiring a credential to answer "is the
//! daemon up" would mean a misconfigured token looked identical to a stopped
//! daemon. It returns a constant and reveals nothing that the open port has not
//! already revealed.
//!
//! # Why 127.0.0.1 and not 0.0.0.0
//!
//! Binding the wildcard address would put this user's browsing history one
//! request away from every other machine on the café wifi, with a bearer token
//! as the only thing between them. There is exactly one literal in this file
//! that can be bound, and a test asserts it is loopback.
//!
//! # CORS
//!
//! There is none, on purpose. An extension with `host_permissions` for
//! `http://127.0.0.1:1431/*` bypasses CORS for its background fetches, so it
//! does not need any — while adding permissive CORS headers would hand ordinary
//! web pages the ability to *read* replies from this endpoint, which is strictly
//! more than they can do today.
//!
//! Nothing here is written to Supabase. See the privacy note in `usage.rs`.
//! TODO(auth): sync only after RLS is scoped to auth.uid().

use axum::{
    extract::DefaultBodyLimit,
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::usage::{self, UsageEntry};

/// Loopback only. Never `0.0.0.0`.
pub const BIND_ADDR: &str = "127.0.0.1:1431";

/// The header the extension presents its token in.
pub const TOKEN_HEADER: &str = "X-Nexus-Token";

/// Longest body accepted. A URL and a page title, generously — anything larger
/// is a bug or an attempt to fill the disk, and it should be refused before it
/// is buffered rather than after.
const MAX_BODY_BYTES: usize = 16 * 1024;

/// Longest interval a single report may claim, in seconds.
///
/// A day. A tab reporting a week of attention is a clock jump or a bad
/// subtraction on the extension's side, and silently accepting it makes every
/// total meaningless with no way to tell which line did it.
const MAX_REPORT_SECS: i64 = 24 * 60 * 60;

/// One interval as the extension reports it.
#[derive(Debug, Clone, Deserialize)]
pub struct WebReport {
    pub host: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub title: String,
    pub seconds: i64,
    pub start: String,
    pub end: String,
}

/// Start the ingest listener. Call from inside a tokio runtime.
///
/// A bind failure is logged and the task ends: the most likely cause is a second
/// daemon already listening, and killing this process over it would take
/// enforcement and app tracking down with it. Web usage stops; nothing else does.
pub fn spawn() {
    tokio::spawn(async {
        let app = router();

        let listener = match tokio::net::TcpListener::bind(BIND_ADDR).await {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[usage] cannot bind {BIND_ADDR} ({e}) — web usage will not be recorded");
                return;
            }
        };
        eprintln!("[usage] ingest listening on http://{BIND_ADDR}");
        if let Err(e) = axum::serve(listener, app).await {
            eprintln!("[usage] ingest server stopped: {e}");
        }
    });
}

/// The two routes, separated from [`spawn`] so tests can serve them on an
/// ephemeral port and exercise the real HTTP path — headers, content types and
/// status codes included — without fighting a running daemon for 1431.
fn router() -> Router {
    Router::new()
        .route("/usage/health", get(health))
        .route("/usage/web", post(ingest_web))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
}

/// Unauthenticated liveness probe — a constant, so it discloses nothing beyond
/// the fact that the port is open, which the connection already established.
async fn health() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// Record one web interval.
///
/// The body is taken as a `String` rather than `Json<WebReport>` so the token is
/// checked **before** anything is parsed: an unauthenticated caller should not
/// be able to tell a malformed body from a valid one, and should not get any
/// work done on its behalf.
async fn ingest_web(headers: HeaderMap, body: String) -> (StatusCode, Json<Value>) {
    let presented = headers
        .get(TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    if !usage::browser_token_authorises(presented) {
        // No detail: "wrong token" and "no token file on this machine" are the
        // same answer to anyone who isn't allowed to know either.
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" })));
    }

    let report: WebReport = match serde_json::from_str(&body) {
        Ok(r) => r,
        Err(e) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": format!("malformed body: {e}") })),
            )
        }
    };

    match to_entry(&report) {
        // `stored: false` is a duplicate, and it is still a 200. The extension's
        // delivery is at-least-once — it dequeues only after a successful POST,
        // so a service worker killed mid-flush re-sends. Answering 409 would
        // tell it the record failed, it would keep the record queued, and it
        // would retry a record we already have forever. See
        // `usage::append_deduped`.
        Ok(entry) => match usage::append_deduped(&entry) {
            Ok(stored) => (StatusCode::OK, Json(json!({ "ok": true, "stored": stored }))),
            Err(e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(json!({ "error": e })),
            ),
        },
        Err(e) => (StatusCode::BAD_REQUEST, Json(json!({ "error": e }))),
    }
}

/// Validate a report and turn it into a storable entry.
///
/// Pure, so every rejection is testable without a listener. The host check is
/// the same lesson as `content_blocker.rs`'s blank-domain bug: an input that
/// yields no hostname must be dropped, not stored as an empty-named bucket that
/// silently accumulates everything the extension failed to parse.
fn to_entry(report: &WebReport) -> Result<UsageEntry, String> {
    let host = report.host.trim().to_ascii_lowercase();
    if host.is_empty() {
        return Err("host is required".to_string());
    }
    if report.seconds <= 0 {
        return Err("seconds must be positive".to_string());
    }
    if report.seconds > MAX_REPORT_SECS {
        return Err(format!("seconds exceeds the {MAX_REPORT_SECS}s cap"));
    }
    // The day file is chosen from `start`, so an unparseable one has nowhere to
    // go. Reject here rather than letting `usage::append` fail with a message
    // the extension cannot act on.
    usage::local_date_of_rfc3339(&report.start)
        .ok_or_else(|| format!("start is not RFC3339: {}", report.start))?;
    usage::local_date_of_rfc3339(&report.end)
        .ok_or_else(|| format!("end is not RFC3339: {}", report.end))?;

    Ok(UsageEntry::Web {
        host,
        url: report.url.clone(),
        title: report.title.clone(),
        start: report.start.clone(),
        end: report.end.clone(),
        seconds: report.seconds,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn report() -> WebReport {
        WebReport {
            host: "github.com".into(),
            url: "https://github.com/Prk315/Nexus".into(),
            title: "Prk315/Nexus".into(),
            seconds: 30,
            start: "2026-08-07T09:00:00+00:00".into(),
            end: "2026-08-07T09:00:30+00:00".into(),
        }
    }

    // ── the bind address ────────────────────────────────────────────────────

    #[test]
    fn the_listener_is_loopback_only() {
        // Binding the wildcard would expose this user's browsing history to
        // every machine on the network, with only a bearer token in the way.
        assert_eq!(BIND_ADDR, "127.0.0.1:1431");
        assert!(!BIND_ADDR.starts_with("0.0.0.0"));
        let parsed: std::net::SocketAddr = BIND_ADDR.parse().expect("a valid socket address");
        assert!(parsed.ip().is_loopback());
        assert_eq!(parsed.port(), 1431);
    }

    // ── auth ────────────────────────────────────────────────────────────────

    #[test]
    fn auth_fails_closed_when_there_is_no_usable_token() {
        // Missing file and truncated file both mean "cannot authenticate
        // anybody" — never "no token configured, allow everything".
        assert!(!usage::token_is_valid(None, &"a".repeat(48)));
        assert!(!usage::token_is_valid(Some("short"), "short"));
        assert!(!usage::token_is_valid(Some(""), ""));
    }

    #[test]
    fn a_missing_header_presents_the_empty_string_and_is_refused() {
        // The exact value `ingest_web` falls back to when the header is absent
        // or not valid UTF-8.
        let stored = "a".repeat(48);
        assert!(!usage::token_is_valid(Some(&stored), ""));
        assert!(usage::token_is_valid(Some(&stored), &stored));
    }

    // ── validation ──────────────────────────────────────────────────────────

    #[test]
    fn a_well_formed_report_becomes_a_web_entry() {
        let entry = to_entry(&report()).expect("accepted");
        assert_eq!(entry.label(), "github.com");
        assert_eq!(entry.seconds(), 30);
        assert!(!entry.is_app());
    }

    #[test]
    fn the_host_is_normalized_so_totals_do_not_split() {
        // `GitHub.com` and `github.com` are one site. Left alone they would be
        // two rows in the panel, each with half the time.
        let mut r = report();
        r.host = "  GitHub.com ".into();
        assert_eq!(to_entry(&r).expect("accepted").label(), "github.com");
    }

    #[test]
    fn a_blank_host_is_rejected_rather_than_bucketed_under_the_empty_string() {
        // Same class of bug as `content_blocker.rs` emitting `.*` for a blank
        // domain: an input that yields no hostname must be dropped, not stored
        // as a nameless bucket that absorbs every parse failure.
        for host in ["", "   ", "\t"] {
            let mut r = report();
            r.host = host.into();
            assert!(to_entry(&r).is_err(), "accepted blank host {host:?}");
        }
    }

    #[test]
    fn nonpositive_and_absurd_durations_are_rejected() {
        for seconds in [0, -1, -3600, MAX_REPORT_SECS + 1, i64::MAX] {
            let mut r = report();
            r.seconds = seconds;
            assert!(to_entry(&r).is_err(), "accepted {seconds}s");
        }
        let mut r = report();
        r.seconds = MAX_REPORT_SECS;
        assert!(to_entry(&r).is_ok(), "the cap itself is allowed");
    }

    #[test]
    fn unparseable_timestamps_are_rejected_at_the_door() {
        // `usage::append` picks the day file from `start`. A report it cannot
        // date has nowhere to go, and failing here gives the extension an error
        // it can actually act on.
        for bad in ["", "2026-08-07 09:00:00", "yesterday"] {
            let mut r = report();
            r.start = bad.into();
            assert!(to_entry(&r).is_err(), "accepted start {bad:?}");
            let mut r = report();
            r.end = bad.into();
            assert!(to_entry(&r).is_err(), "accepted end {bad:?}");
        }
    }

    #[test]
    fn url_and_title_are_optional() {
        // The extension may not have permission to read a tab's title. Dropping
        // the interval over it would lose real usage; the host is what the
        // totals are keyed on.
        let parsed: WebReport = serde_json::from_str(
            r#"{"host":"github.com","seconds":30,"start":"2026-08-07T09:00:00+00:00","end":"2026-08-07T09:00:30+00:00"}"#,
        )
        .expect("parses");
        assert!(to_entry(&parsed).is_ok());
    }

    #[test]
    fn the_documented_request_body_deserializes() {
        // The exact shape the browser extension is written against.
        let parsed: WebReport = serde_json::from_str(
            r#"{"url":"https://github.com/a","title":"a","host":"github.com","seconds":30,"start":"2026-08-07T09:00:00Z","end":"2026-08-07T09:00:30Z"}"#,
        )
        .expect("parses");
        assert_eq!(parsed.host, "github.com");
        assert_eq!(parsed.seconds, 30);
        assert!(to_entry(&parsed).is_ok());
    }

    #[test]
    fn the_request_struct_carries_no_kind_and_the_server_injects_it() {
        // The request body has no `kind` field. Deserializing it straight into
        // `UsageEntry` — which is `#[serde(tag = "kind")]` — would fail on every
        // POST the extension ever makes, and only at runtime, because the
        // extension is the sole client. `WebReport` exists to keep the wire-in
        // shape and the on-disk shape separate.
        let body = r#"{"url":"https://github.com/a","title":"a","host":"github.com","seconds":30,"start":"2026-08-07T09:00:00.000Z","end":"2026-08-07T09:00:30.000Z"}"#;
        assert!(
            serde_json::from_str::<UsageEntry>(body).is_err(),
            "if this ever parses, the two shapes have been collapsed into one"
        );
        let report: WebReport = serde_json::from_str(body).expect("the request struct parses it");
        let line = serde_json::to_string(&to_entry(&report).expect("accepted")).expect("serializes");
        assert!(line.starts_with(r#"{"kind":"web","#), "kind not injected: {line}");
    }

    // ── the endpoint, end to end ────────────────────────────────────────────
    //
    // These drive the real handler against the real state dir, on days far
    // enough out that they cannot collide with recorded usage. Each test owns
    // its own day so they stay independent under the parallel runner.

    fn auth_headers(token: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(TOKEN_HEADER, token.parse().expect("header value"));
        headers
    }

    fn day_file(day: &str) -> std::path::PathBuf {
        usage::usage_dir().join(format!("{day}.jsonl"))
    }

    fn extension_body(day: &str, path: &str) -> String {
        format!(
            r#"{{"url":"https://github.com{path}","title":"Prk315/Nexus","host":"github.com","seconds":30,"start":"{day}T09:00:00.000Z","end":"{day}T09:00:30.000Z"}}"#
        )
    }

    #[tokio::test]
    async fn a_body_with_no_kind_field_lands_as_a_web_line() {
        let day = "2099-10-01";
        let path = day_file(day);
        let _ = std::fs::remove_file(&path);
        let token = usage::ensure_browser_token().expect("token");

        let (status, body) = ingest_web(auth_headers(&token), extension_body(day, "/Prk315/Nexus")).await;
        assert_eq!(status, StatusCode::OK, "{:?}", body.0);
        assert_eq!(body.0["stored"], json!(true));

        let raw = std::fs::read_to_string(&path).expect("day file written");
        assert!(raw.contains(r#""kind":"web""#), "no kind on disk: {raw}");
        assert!(raw.contains(r#""host":"github.com""#), "{raw}");
        let entries = usage::read_day(day).expect("read");
        assert_eq!(entries.len(), 1);
        assert!(!entries[0].is_app());
        assert_eq!(entries[0].label(), "github.com");

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn replaying_the_same_post_yields_one_line_and_still_answers_200() {
        // At-least-once delivery: the extension re-sends anything it could not
        // confirm. A 409 here would stick that record at the head of its queue
        // permanently, so the duplicate is skipped and the answer is still 200.
        let day = "2099-10-02";
        let path = day_file(day);
        let _ = std::fs::remove_file(&path);
        let token = usage::ensure_browser_token().expect("token");
        let body = extension_body(day, "/Prk315/Nexus");

        let (first, first_body) = ingest_web(auth_headers(&token), body.clone()).await;
        let (second, second_body) = ingest_web(auth_headers(&token), body.clone()).await;
        let (third, _) = ingest_web(auth_headers(&token), body).await;

        assert_eq!(first, StatusCode::OK);
        assert_eq!(second, StatusCode::OK, "a duplicate must not be an error");
        assert_eq!(third, StatusCode::OK);
        assert_eq!(first_body.0["stored"], json!(true));
        assert_eq!(second_body.0["stored"], json!(false));

        assert_eq!(usage::read_day(day).expect("read").len(), 1, "duplicate was stored");
        assert_eq!(
            usage::totals_for_day(day),
            vec![("github.com".to_string(), 30)],
            "a replay must not double-count the interval"
        );

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn consecutive_urls_on_one_host_are_all_kept_and_summed() {
        // The extension closes an interval on every URL change, so one visit
        // arrives as a run of short intervals differing only in `url`. The
        // duplicate guard must not mistake those for replays.
        let day = "2099-10-03";
        let path = day_file(day);
        let _ = std::fs::remove_file(&path);
        let token = usage::ensure_browser_token().expect("token");

        for i in 0..4 {
            let body = format!(
                r#"{{"url":"https://github.com/page/{i}","title":"p","host":"github.com","seconds":30,"start":"{day}T09:0{i}:00.000Z","end":"{day}T09:0{i}:30.000Z"}}"#
            );
            let (status, _) = ingest_web(auth_headers(&token), body).await;
            assert_eq!(status, StatusCode::OK);
        }
        assert_eq!(usage::read_day(day).expect("read").len(), 4);
        assert_eq!(
            usage::totals_for_day(day),
            vec![("github.com".to_string(), 120)]
        );

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn an_unauthorized_post_is_refused_and_writes_nothing() {
        let day = "2099-10-04";
        let path = day_file(day);
        let _ = std::fs::remove_file(&path);
        let _ = usage::ensure_browser_token().expect("token");
        let body = extension_body(day, "/Prk315/Nexus");

        // No header at all, a wrong token, and a too-short one.
        for headers in [
            HeaderMap::new(),
            auth_headers(&"0".repeat(48)),
            auth_headers("short"),
        ] {
            let (status, _) = ingest_web(headers, body.clone()).await;
            assert_eq!(status, StatusCode::UNAUTHORIZED);
        }
        assert!(!path.exists(), "an unauthorized POST created a day file");
    }

    #[tokio::test]
    async fn a_malformed_body_is_rejected_after_auth_not_before() {
        let token = usage::ensure_browser_token().expect("token");
        let (status, _) = ingest_web(auth_headers(&token), "{not json".to_string()).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        // …and an unauthenticated caller cannot tell malformed from valid.
        let (status, _) = ingest_web(HeaderMap::new(), "{not json".to_string()).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    /// Serve the real router on an ephemeral port. Returns its base URL.
    async fn serve() -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("ephemeral port");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move {
            let _ = axum::serve(listener, router()).await;
        });
        format!("http://{addr}")
    }

    #[tokio::test]
    async fn the_extensions_exact_request_is_accepted_over_real_http() {
        // Everything above calls the handler directly, which cannot catch a
        // mismatch in the layer above it — and the extension sends
        // `Content-Type: application/json` while the handler takes the body as
        // a `String` (so the token is checked before anything is parsed). If
        // axum ever rejected that pairing, every POST would 4xx at runtime and
        // only on a real machine. This is the contract test for that seam.
        let day = "2099-10-05";
        let path = day_file(day);
        let _ = std::fs::remove_file(&path);
        let token = usage::ensure_browser_token().expect("token");
        let base = serve().await;
        let client = reqwest::Client::new();

        let body = extension_body(day, "/Prk315/Nexus");
        let send = |body: String| {
            client
                .post(format!("{base}/usage/web"))
                .header("Content-Type", "application/json")
                .header(TOKEN_HEADER, token.clone())
                .body(body)
                .send()
        };

        let res = send(body.clone()).await.expect("request");
        assert_eq!(res.status(), 200, "{:?}", res.text().await);
        let stored: Value = res.json().await.expect("json");
        assert_eq!(stored["ok"], json!(true));
        assert_eq!(stored["stored"], json!(true));

        // At-least-once replay, over the wire this time.
        let res = send(body).await.expect("request");
        assert_eq!(res.status(), 200, "a replay must not be an error status");
        assert_eq!(res.json::<Value>().await.expect("json")["stored"], json!(false));
        assert_eq!(usage::read_day(day).expect("read").len(), 1);

        // Wrong token over the wire → 401, which the extension retries rather
        // than dropping the record.
        let res = client
            .post(format!("{base}/usage/web"))
            .header("Content-Type", "application/json")
            .header(TOKEN_HEADER, "0".repeat(48))
            .body(extension_body(day, "/other"))
            .send()
            .await
            .expect("request");
        assert_eq!(res.status(), 401);
        assert_eq!(usage::read_day(day).expect("read").len(), 1);

        let _ = std::fs::remove_file(&path);
    }

    #[tokio::test]
    async fn health_answers_over_real_http_without_a_token() {
        // The extension's options page reads `body.ok === true` off this.
        let base = serve().await;
        let res = reqwest::get(format!("{base}/usage/health")).await.expect("request");
        assert_eq!(res.status(), 200);
        assert_eq!(res.json::<Value>().await.expect("json"), json!({ "ok": true }));
    }

    #[tokio::test]
    async fn health_needs_no_token_and_says_only_that_it_is_up() {
        // The extension shows a connected/disconnected dot. Requiring a
        // credential would make a misconfigured token look exactly like a
        // stopped daemon.
        let Json(body) = health().await;
        assert_eq!(body, json!({ "ok": true }));
    }
}
