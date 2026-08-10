# Security: the permissive-RLS migration

Deferred deliberately on 2026-08-10. Not urgent, but it is the largest
outstanding risk in this repo, and it is the kind of change that must be done in
order or not at all.

Audited 2026-08-10 against project `efxmzsdisaymtpebaxlp`.

## The problem

`Prk315/Nexus` is **public** and the Supabase anon key is committed in
`apps/NexusLocal/src-tauri/src/config.rs` (also `apps/TimeTrackerApp/src-tauri/src/models/mod.rs`
and `apps/Vault/Vault/public/conceptmap.html`).

An anon key being public is normal — that is what it is for. The bug is that RLS
does not constrain it. Live state:

- **80 tables** correctly scoped to `auth.uid()`
- **36 permissive**, including all 13 productivity/grid tables
- Those 13 have **anon-only policies and zero scoped policies**, `USING (true)`
  for **ALL** commands — so anyone with the key can *delete* your time entries or
  rewrite your block list, not merely read them

The 13: `time_entries`, `active_sessions`, `blocked_sites`, `blocked_apps`,
`focus_blocks`, `unlock_rules`, `blocking_state`, `pomodoro_config`,
`schedule_block_apps`, `schedule_block_sites`, `nexus_local_nodes`,
`nexus_local_commands`, `nexus_ble_captures`.

`usage_intervals` is the one correctly-scoped table (`auth.uid()`, no anon
policy) and is the template to copy.

## The failure mode that governs the whole plan

⚠️ **Reading these tables with a JWT that does not match returns an EMPTY SET,
not an error.**

So a half-finished migration does not fail loudly. Blocking silently stops on the
Mac *and* the phone, and the widget renders "nothing blocked" — indistinguishable
from working correctly. **Never flip a table before every one of its readers and
writers can authenticate.** Verify blocking end-to-end after each table.

## The three anon clients

All must be handled *before* any policy changes.

1. **The daemon** (`nexus-local --daemon`) — no session at all, just the anon key
   from `config.rs`. It is both the primary writer and the thing that enforces
   blocking, so flipping first breaks blocking on the Mac.
2. **The iOS widgets** — cannot get a JWT. `SessionBridge` never lands the
   session in the keychain (`kc sess:no` with `probe:OK`; see
   `apps/NexusLocal/OPEN_ITEMS.md` item 2). They fall back to the anon key.
3. **TimeTrackerApp** — its own hardcoded anon key; writes `time_entries`,
   `active_sessions`, `blocked_sites`, `blocked_apps`.

## Ordered plan

Each step is independently shippable and reversible.

**Step 1 — take the widgets off direct table reads.**
Do *not* try to give them a JWT. Extend the scoped-secret edge-function pattern
that already works four times over (`habit-toggle`, `session-toggle`,
`usage-ingest`, `garmin-import`) to widget **reads**. This deletes blocker 2
without fixing `SessionBridge`, and is safer than shipping a refresh token inside
a sideloaded binary.

✅ **This does not disturb SideStore.** No new entitlement, no App Group, no
`project.yml` change — the fragile iOS signing path is untouched by design, not
by luck. Keep it that way.

**Step 2 — give the daemon a real session.**
Refresh-token flow against `/auth/v1/token`, refresh token in the macOS Keychain,
`Authorization: Bearer` on the PostgREST calls in `grid/supabase.rs`. It already
speaks raw reqwest. Roughly a day. Must keep working against today's permissive
policies so it can ship *before* the flip.

**Step 3 — decide TimeTrackerApp.** Migrate it the same way, or accept that it
stops writing. The user previously asked for it to be left untouched.

**Step 4 — flip one table at a time.** Add the `auth.uid()` policy, backfill
`user_id` from `'default'` to the real uid, verify every consumer, *then* drop
the anon policy. Re-verify blocking after each.

**Step 5 — make `nodeUser.ts` fail hard.** Its `"default"` fallback is only safe
while the tables are permissive. Flip it to a hard failure in the same change as
step 4, or a mismatched id shows an empty day instead of an error. Already noted
in that file's docstring.

## Already done

- **The frontend is threaded** (PR #70, 2026-08-10). `user_id` comes from
  `~/.nexuslocalrc` through 16 call sites; nothing hardcodes `"default"` any
  more. This makes a second account on a second device *coherent* — it does not
  make it *safe*. That is what this migration is for.
- Owner uid is `a33625c2-4dd2-44fa-b2e5-4d455eeac59d`; the second account is
  `870ca14b-2a8a-4634-9c08-2eb2d67207b0`. Both already appear in the
  `USAGE_ALLOWED_UIDS` and `GARMIN_ALLOWED_UIDS` secrets.

## Cheap win, independent of all of the above

Get the anon key out of `config.rs`. The daemon already reads
`~/.nexuslocalrc`, so the hardcoded default is a convenience, not a requirement.
About an hour, touches no RLS, breaks nothing, and removes the automated
GitHub-scraping exposure that makes this urgent at all.

## Do NOT make the repo private

It looks like the cheap mitigation. It is not — it breaks the iOS pipeline in
three places:

1. **GitHub Pages needs a paid plan for private repos.** SideStore's source is
   `https://prk315.github.io/Nexus/apps.json`; private means Pages goes dark and
   the phone silently stops seeing updates.
2. **Release assets on a private repo require auth**, and SideStore fetches the
   IPA URL unauthenticated.
3. **Public repos get unlimited Actions minutes**; private on Free gets
   2,000/month, and `nexuslocal-ios.yml` uses `runs-on: macos-15`, billed at
   **10×** — roughly 13 releases a month.

Going private was only ever mitigation against automated key scraping, and the
key is extractable from the distributed IPA anyway. Repo visibility is
independent of the real fix.
