# Deploying Protocol to the web (Vercel)

Protocol is a Vite SPA whose data layer is Supabase-direct (no `invoke`, no
native plugins in the CRUD path), so it runs in a plain browser like Vault and
PathFinder. It uses the **same Supabase project and the same ecosystem
account** — no separate signup.

## Vercel project settings (separate project from Vault)

Vault's root `vercel.json` builds Vault, so Protocol needs its **own** Vercel
project scoped to its folder, same as PathFinder. Create a new project on the
same repo with:

- **Root Directory:** `apps/Protocol`
- Enable **"Include files outside of the Root Directory in the Build Step"**
  (the build reaches up to `packages/nexus-core`, aliased as `@nexus/core`).
- The rest is encoded in `apps/Protocol/vercel.json`:
  - Install: `cd ../.. && npm install` (whole workspace)
  - Build: `cd ../.. && npm run build --workspace=apps/Protocol`
  - Output: `dist` (i.e. `apps/Protocol/dist`)
  - Rewrites: SPA fallback → `/index.html`

If Vercel doesn't pick up the vercel.json build settings, set the same Build /
Output / Install commands in the project's dashboard (Settings → Build & Output).

## Environment variables (same values as Vault/PathFinder)

```
VITE_SUPABASE_URL       = https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY  = <same anon key as Vault/PathFinder>
VITE_VAULT_URL          = <Vault's production URL>
VITE_PATHFINDER_URL     = <PathFinder's production URL>
```
`VITE_`-prefixed → inlined into the client bundle (anon key is public by
design; RLS is the guard). Not "Sensitive". The `VITE_*_URL` vars feed
`NexusHeader`'s cross-app switcher so Protocol can link out to its siblings —
they don't need to be set for Protocol's *own* deploy to work, only for the
switcher UI to be functional.

To make Vault's and PathFinder's switchers show Protocol back (and, as a
pre-existing gap, show each other — neither `VITE_VAULT_URL` nor
`VITE_PATHFINDER_URL` was ever set on either live deployment), add
`VITE_PROTOCOL_URL` to Vault's and PathFinder's own Vercel env vars once
Protocol's URL is known, and redeploy each. That's a separate follow-up, not
part of this deploy.

## Supabase auth

Same shared account as Vault/PathFinder. After deploy, add Protocol's
`*.vercel.app` domain to **Supabase → Authentication → URL Configuration →
Redirect URLs**. Log in with the same email/password you use for the other apps.

## Data + security (already applied)

- All `protocol_*` rows with a `user_id` column migrated from `'default'` to
  the account uid.
- RLS is **owner-only (`user_id = auth.uid()`)** on most root tables, with three
  deliberate exceptions that make Protocol a **shared library**:
  - `protocol_foods`, `protocol_meals` → **shared read-all / write-own**: every
    authenticated user *reads* every food & meal (so anyone can log a food or
    meal another user created), but insert/update/delete are gated to the owner.
  - `protocol_meal_items` → **shared read**, with writes gated on **parent-meal
    ownership** (`EXISTS (… protocol_meals m WHERE m.id = meal_id AND m.user_id =
    auth.uid())`), replacing the old blanket `authenticated_all`.
  - `protocol_exercises` (a child of `protocol_workout_sessions`, no `user_id` of
    its own) is still `authenticated_all` — add a parent-ownership policy like
    `protocol_meal_items` if strict per-user isolation is ever needed.
- `protocol_foods_dk` (the static Danish food reference table) is intentionally
  public-read (`anon_read`, SELECT-only) — shared reference data, not user data.
- Newer config tables — `protocol_data_source_settings` (per-metric Garmin vs
  Oura routing), `protocol_progress_config` (progress-card tracking), and
  `protocol_exercise_aliases` (friendly names for imported Garmin exercises) —
  are owner-only.

## ⚠️ Desktop Protocol must be rebuilt

Flipping RLS to `auth.uid()` means the **old desktop build (no auth) will no
longer read/write** — it used the anon key with `user_id = 'default'`. Rebuild
the desktop app from the updated code (it now shows the same login screen and
uses your account).

## Known gap: Garmin Connect sync is desktop-only

`GarminSyncPanel` (rendered on Biomarkers, Workouts, Running) needs a local
Python subprocess (`garminconnect`) to **fetch** from Garmin — there is no web
equivalent for that step, so it fails gracefully on the web build (inline error
on Sync, not a crash), left unguarded rather than hidden behind `isTauri()`.

What *has* since been built is the server-side **mapping** layer: the
`garmin-import` edge function now owns the raw-Garmin-JSON → `protocol_*`
mapping (idempotent on Garmin's `activityId`, per-metric source gating via
`protocol_data_source_settings`), so the Nexus Local grid daemon can fetch and
import without Protocol running. Do **not** re-implement that mapping in any
client — two drifting copies produce wrong numbers. A fully hands-off web path
would still need a scheduled fetch (the daemon or a paid Garmin API), which
remains a backlog item.
