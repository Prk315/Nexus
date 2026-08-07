# Nexus Web Usage (Chrome extension)

A Manifest V3 extension that measures how long you actively spend on each
website and posts completed intervals to the Nexus Local daemon running on
`127.0.0.1:1431`.

No build step, no npm, no bundler. Load the folder as-is.

---

## Install

1. Open `chrome://extensions` in Chrome (or any Chromium browser: Brave, Edge, Arc).
2. Turn on **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this folder:
   `apps/NexusLocal/extensions/chrome-usage`
5. The extension appears as **Nexus Web Usage**. Click its toolbar icon (or
   **Details -> Extension options**) to open the settings page.

Because it is loaded unpacked, Chrome will show the usual "Developer mode
extensions" warning on startup. That is expected.

## Pairing token

Uploads are authenticated with a 48-character token sent as the
`X-Nexus-Token` header.

1. Open the **Nexus Local** app.
2. Go to the **Usage** panel — the token is displayed there.
3. Paste it into the token field on the extension's settings page and click
   **Save token**.
4. Flip **Tracking** on. The switch is disabled, and tracking defaults to off,
   until a token has been saved.

Use **Test connection** to confirm the daemon is reachable. The health check
does not validate the token; if the token is wrong, uploads fail with a 401 and
the reason shows under **Queue**.

## What data leaves the browser

For each completed interval, one JSON object is POSTed to
`http://127.0.0.1:1431/usage/web`:

```json
{
  "url": "https://example.com/page",
  "title": "Page title",
  "host": "example.com",
  "seconds": 30,
  "start": "2026-08-07T12:00:00.000Z",
  "end": "2026-08-07T12:00:30.000Z"
}
```

**Everything stays on this Mac.** `127.0.0.1` is the loopback interface — those
requests never reach a network interface, a router, or the internet. There is
no cloud sync path in this extension, no analytics, no telemetry, and no
third-party endpoint. The only host permission the extension requests is
`http://127.0.0.1:1431/*`, so Chrome itself will block it from contacting any
other origin.

(This matters here: the project's Supabase instance is world-readable, so
browsing history must never be synced to it.)

### What is *not* collected

- Page content, form data, cookies, or anything inside the page. The extension
  injects no content scripts and requests **no** `<all_urls>` host permission.
  The `tabs` permission alone provides the active tab's URL and title, which is
  all it needs.
- `chrome://`, `chrome-extension://`, `about:`, `file://`, `view-source:`,
  `data:` and every other non-`http(s)` scheme — these are skipped entirely.
- Background tabs, and any tab in a window that does not have OS focus.

## How the measurement works

An interval is open only while **all** of the following hold:

- tracking is on and a token is saved,
- `chrome.idle` reports `active` (60-second detection interval),
- a Chrome window currently has OS focus (`windows.getLastFocused().focused`),
- the active tab in that window has a parseable `http`/`https` URL.

An interval is closed and queued when:

- the active tab's URL changes (this covers host changes, and stops a long
  session on one site being attributed to a single URL),
- the active tab or focused window changes,
- Chrome loses OS focus entirely (`WINDOW_ID_NONE`) — this is what stops the
  clock when you switch to another application,
- `chrome.idle` reports `idle` or `locked`,
- tracking is switched off.

Intervals shorter than **2 seconds** are discarded as tab-flipping noise.

`host` is derived with `new URL(u).hostname` inside a `try`/`catch`; if it
throws, the page is skipped rather than guessed at.

### Bias: under-report, never over-report

Every ambiguous case resolves to "record nothing". Unknown focus state, an
unreadable tab URL, an idle state Chrome will not report, a recovered interval
with a stale heartbeat — all are dropped. Expect the totals to be slightly
lower than reality, never higher.

### Service-worker termination

MV3 kills the background service worker after roughly 30 seconds of inactivity,
which is the usual source of silent bugs in this kind of extension. The
handling here:

- The in-progress interval is persisted to `chrome.storage.session` (falling
  back to `chrome.storage.local`) on **every** state change, so a terminated
  worker does not lose it.
- The record carries a `lastSeenMs` heartbeat, refreshed once a minute by a
  `chrome.alarms` alarm (`setInterval` is useless here — plain timers die with
  the worker; alarms wake it back up).
- On worker startup a recovered interval whose heartbeat is more than
  **10 minutes** old is discarded outright, rather than being reported as a
  bogus multi-hour session.
- When an interval is closed, its end time is clamped to
  `lastSeen + 2 minutes`. If the machine slept for three hours mid-interval,
  the gap is not credited.
- A browser restart (`runtime.onStartup`) always clears any in-progress
  interval.

## Delivery and buffering

Completed intervals go into a queue in `chrome.storage.local` and are flushed
once a minute, and immediately after each interval closes.

- If the daemon is not running the POST fails and the records **stay queued**.
  Nothing is dropped; the next flush retries.
- Retryable: connection refused, 401/403 (bad token), 429, 5xx.
- Dropped as permanently unacceptable: 400 / 413 / 422 (a malformed record
  would otherwise block the head of the queue forever).
- The queue holds at most **5000** records; beyond that the oldest are dropped.
- Delivery is at-least-once. If the worker is killed after a POST succeeds but
  before the record is dequeued, that record is sent again — the daemon should
  tolerate duplicates.
- Tracking never waits on the network: flushes are fired off separately from
  the tracking state machine.

The settings page shows the queued-but-unsent count and the last upload result,
so a daemon that has been down is immediately visible.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | MV3 manifest: `tabs`, `idle`, `storage`, `alarms`; host permission for `http://127.0.0.1:1431/*` only |
| `background.js` | Service worker: focus/idle tracking, interval persistence and recovery, queue and delivery |
| `options.html` | Settings page markup |
| `options.css` | Settings page styling (light and dark) |
| `options.js` | Settings page behaviour: token, tracking switch, health check, queue status |

## Troubleshooting

- **"Not connected"** — the Nexus Local app is not running, or its usage
  endpoint is not listening on port 1431.
- **Queue grows and never empties** — most likely a wrong token (401). Re-copy
  it from the Usage panel.
- **No time recorded at all** — check that tracking is on, and note that a
  Chrome window must have OS focus; time spent with Chrome in the background is
  intentionally not counted.
- **Inspect the worker** — `chrome://extensions` -> Nexus Web Usage ->
  **Service worker**. It is normal for it to show as inactive; it wakes on
  events and alarms.
