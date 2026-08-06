# `session-toggle`

Start and stop a Nexus Local time-tracking session from the iOS home-screen
widget, without launching the app.

A widget extension is the only process iOS wakes while the app is closed, and an
`AppIntent` is the only thing a widget can use to write anything. On a free-tier
sideloaded install the widget cannot receive the user's JWT (App Groups need paid
provisioning — commit `bbf60f1`), so it cannot authenticate as the user. This
function is the scoped write path that replaces doing so, exactly like
[`habit-toggle`](../habit-toggle/index.ts).

## Security posture

- **POST only.** Anything else is `405`.
- **Authenticated by a dedicated secret**, `WIDGET_SESSION_KEY`, sent as the
  `x-widget-key` header. It is **not** the anon key, grants no read access beyond
  the session state it returns (which the anon key can already read anyway), and
  is revoked by rotating one env var plus rebuilding the widget.
- **Fails closed.** If `WIDGET_SESSION_KEY` is unset or shorter than 32
  characters the function returns `500 server_misconfigured` and does nothing. An
  empty value compiles and deploys perfectly cleanly and would otherwise make
  `x-widget-key: ""` a valid credential.
- **Constant-time comparison** of the secret, so a wrong key can't be recovered
  by timing.
- **Every input shape validated**: `action` must be `start` or `stop`, task name
  must be a non-empty string of ≤120 characters after trimming, project is
  optional and blank-normalised to `null`.
- **Service-role client** with the row set pinned server-side to
  `user_id = 'default'`.

### Residual risk, stated plainly

The secret ships inside a distributed binary, so it is extractable. What this
design buys is a blast radius of *"can start and stop this user's timer"* instead
of *"can read and write everything the anon role can reach"*.

### The owner check is weaker here than in `habit-toggle` — read this

`habit-toggle` takes a caller-supplied habit id and refuses ids that don't belong
to `OWNER_UID`, so a leaked key still cannot touch another account's rows.

There is no caller-supplied id here. The TimeTracker tables predate auth and key
every row on the literal `user_id = 'default'` (see `kTimeTrackerUserID` in
`WidgetData.swift` and `timetracker/mod.rs`). `OWNER_USER_ID` in `index.ts` is
therefore a **scoping constant** — it guarantees the function can only ever
address the one row set the widget also reads — not the uid ownership proof
`habit-toggle` performs. When these tables move to `auth.uid()` it becomes a real
ownership check for free. Until then, do not read it as one.

## Actions

### `start`

Creates the `active_sessions` row. `active_sessions` has `UNIQUE(user_id)`, so
there is exactly one active session per user across every device.

**Idempotent** — starting while a session already runs returns the existing
session untouched with `alreadyRunning: true`, rather than erroring or clobbering
it. This is a select-then-insert rather than an upsert on purpose: a
`merge-duplicates` upsert would preserve a paused row's `paused_at` and stale
`elapsed_seconds`, and the widget (which decides `running` purely from
`paused_at != nil`) would render the brand-new session as permanently paused.

A concurrent start from another device trips `UNIQUE(user_id)`; that is the same
idempotent case arriving a moment late, so the winner is reported instead of a
`500`.

### `stop`

Writes the `time_entries` row, then deletes the `active_sessions` row — that
order, so a failed write leaves the session recoverable instead of losing it and
the time with it. The insert is an upsert on the natural key
`(device_id, start_time, task_name)`, every component of which comes from the
session row, so a retry after a partial failure cannot double-count.
`tags`, `notes`, `billable` and `hourly_rate` are copied across rather than
dropped — the desktop app writes them.

The delete is a **compare-and-swap on the row `id`**, not just `user_id`.
`active_sessions` is keyed by `user_id` alone, so between the read and the delete
another device can stop that session and start a *different* one under the same
key; without the `id` clause this would delete the newcomer. A zero-row match is
still a success — the entry is durable and the session is either gone or one this
request must not touch. This mirrors `session.rs::tt_session_stop`.

`duration_seconds` is `end - start_time` clamped `>= 0`, where `end` is
`paused_at` if the session was paused and `now` otherwise. `end_time` is that
same instant.

This is deliberately the **same single formula** as `session.rs`, not a separate
`elapsed_seconds` branch. Elapsed time is *derived*, not stored: `pause` writes
`paused_at` and `elapsed_seconds` from one clock read, so
`paused_at - start_time == elapsed_seconds` holds by construction and the two
agree. Where they could ever diverge, two writers to the same table disagreeing
about a duration is worse than either formula's edge case. Taking `end` from
`paused_at` is what stops a session paused at 17:00 and stopped the next morning
from billing the whole night. `now` is sampled exactly once per request.

**Idempotent** — stopping when nothing is running is a no-op success with
`alreadyStopped: true`, not a `500`. A widget whose timeline is a few minutes
stale will do exactly this, and an error there would clear the optimistic
override into a state that was already correct.

## Timestamps

Everything written is RFC3339 UTC at **second** precision — the `.mmm` that
`toISOString()` emits is deliberately stripped. `ISO8601DateFormatter()` in the
widget defaults to `.withInternetDateTime`, which *rejects* fractional seconds,
so a `start_time` with them decodes to `nil` and the widget renders a running
timer as paused.

> **Note for the Rust side:** `timetracker/mod.rs`'s `now_rfc3339()` uses
> `chrono`'s fractional-second, `+00:00`-offset form, which the widget's reader
> could not parse either. `TimeTrackerWidget.swift` now falls back to a
> fractional-seconds formatter so both are readable.

### Known cross-writer risks (not settled by this unit)

Two distinct ones, with different mechanisms.

**1. Normalisation divergence vs. the NexusLocal Rust path → duplicate rows.**
`session.rs::tt_session_stop` **normalises** the session's `start_time` through
`chrono`'s `to_rfc3339()` before writing it onto the `time_entries` row; this
function passes it through **verbatim**. For a session the widget started, that
is `...:30Z` here and `...:30+00:00` there — different strings, therefore
different `(device_id, start_time, task_name)` conflict keys, therefore two rows
and double-counted time if both stop the same session. The compare-and-swap
protects the `active_sessions` row, not the entry.

Passing through verbatim is what keeps *this* function's own retries idempotent
(the value is identical on every retry because it comes from the session row), so
it is the right local choice. Agreeing one canonical normalisation across both
writers is a cross-unit decision.

**2. Stopping from the widget does not stop a *desktop* timer → silent
overwrite.** This function deletes the cloud `active_sessions` row, which
TimeTrackerApp maps to `RemoteGone`; it then falls back to its **local SQLite**,
where the session is still running. When the user later stops it there, the entry
it writes shares the same natural key and `sync/supabase.rs` pushes it with
`on_conflict=device_id,start_time,task_name` and `merge-duplicates` — so it
**overwrites** this function's row with the full, over-long duration. Note this
is a merge on the *same* key, not the duplicate-row mechanism above.

Properly fixing this needs a change inside TimeTrackerApp, which this unit is
scoped not to modify.

## Required secrets

| Secret | Where | Notes |
|---|---|---|
| `WIDGET_SESSION_KEY` | Supabase project | ≥32 chars. Must match `Secrets.widgetSessionKey` in the widget build. |
| `SESSION_LOCAL_TZ` | Supabase project | **Should be set.** IANA zone, default `UTC`. See below. |
| `SUPABASE_URL` | injected by the platform | |
| `SUPABASE_SERVICE_ROLE_KEY` | injected by the platform | |

### `SESSION_LOCAL_TZ` — set this, or desktop-started sessions record 0 seconds

TimeTrackerApp's desktop timer writes
`Local::now().format("%Y-%m-%dT%H:%M:%S%.3f")` — **a local wall clock with no
offset** — on every `start_timer` (`db/timer.rs:107`) and syncs it verbatim into
`active_sessions.start_time`. That is the format nearly every existing row has;
it is not a legacy concern, and nothing rewrites it (this function copies
`start_time` through verbatim and then deletes the session row).

This function runs in an edge runtime pinned to UTC. A session started at 11:15
in Copenhagen therefore parses as `11:15Z` — two hours in the *future* — so
`now - start` goes negative, the `>= 0` clamp records a **0-second entry**, and
the session row is then deleted, making the loss unrecoverable.

```bash
supabase secrets set SESSION_LOCAL_TZ=Europe/Copenhagen --project-ref efxmzsdisaymtpebaxlp
```

The offset is resolved per instant via `Intl`, so DST is handled rather than
assumed. Timestamps that already carry `Z` or an offset are unaffected. The `UTC`
default preserves the previous behaviour for anyone who has not set it.

```bash
# Generate and set (32 bytes → 43 base64url chars)
KEY=$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-43)
supabase secrets set WIDGET_SESSION_KEY="$KEY" --project-ref efxmzsdisaymtpebaxlp
```

The same value must reach the widget. Locally that is `Secrets.swift` (gitignored
— see `Secrets.swift.template`); in CI it is the `WIDGET_SESSION_KEY` repo
secret, consumed by `.github/workflows/nexuslocal-ios.yml`.

## Deploy

```bash
supabase functions deploy session-toggle --project-ref efxmzsdisaymtpebaxlp
```

`--no-verify-jwt` is **not** needed and must not be used as a substitute for the
widget key: the function does its own authentication and the widget sends no JWT.
If the platform rejects the unauthenticated call, add the anon key as a plain
`Authorization` bearer at the gateway — the widget key remains the thing that
actually authorises the write.

## Manual verification

```bash
KEY=<the WIDGET_SESSION_KEY value>
URL=https://efxmzsdisaymtpebaxlp.supabase.co/functions/v1/session-toggle

# start
curl -sS -X POST "$URL" \
  -H "x-widget-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","taskName":"Deep work","project":"Nexus"}' | jq

# start again — idempotent, returns the same session with alreadyRunning:true
curl -sS -X POST "$URL" \
  -H "x-widget-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"start","taskName":"Something else"}' | jq

# stop
curl -sS -X POST "$URL" \
  -H "x-widget-key: $KEY" \
  -H "Content-Type: application/json" \
  -d '{"action":"stop"}' | jq

# stop again — idempotent no-op success with alreadyStopped:true
curl -sS -X POST "$URL" \
  -H "x-widget-key: $KEY" \
  -H "Content-Type: application/json" -d '{"action":"stop"}' | jq

# wrong key → 401
curl -sS -o /dev/null -w '%{http_code}\n' -X POST "$URL" \
  -H "x-widget-key: nope" -H "Content-Type: application/json" -d '{"action":"stop"}'

# GET → 405
curl -sS -o /dev/null -w '%{http_code}\n' "$URL" -H "x-widget-key: $KEY"

# bad input → 400
curl -sS -X POST "$URL" \
  -H "x-widget-key: $KEY" -H "Content-Type: application/json" \
  -d '{"action":"start","taskName":"   "}' | jq
```

## Tests

Pure logic (secret validation including the unset/too-short cases, input
validation, duration derivation, and the projections both idempotency paths rely
on) lives in `logic.ts` and is covered by `logic.test.ts`:

```bash
deno test supabase/functions/session-toggle/logic.test.ts
deno check supabase/functions/session-toggle/index.ts
```
