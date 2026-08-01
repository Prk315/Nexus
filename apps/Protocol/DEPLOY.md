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
- RLS locked down: 14 root tables (with `user_id`) → `owner_all`
  (`user_id = auth.uid()`); 2 child tables (`protocol_exercises`,
  `protocol_meal_items` — no `user_id` of their own) → `authenticated`-only
  (denies anonymous). Single-user, so child tables aren't per-user isolated
  yet — add `user_id` + `auth.uid()` policies there if Protocol ever goes
  multi-user. `protocol_foods_dk` (the static Danish food reference table) is
  intentionally left public-read (`anon_read`, SELECT-only) — it's shared
  reference data, not user data.

## ⚠️ Desktop Protocol must be rebuilt

Flipping RLS to `auth.uid()` means the **old desktop build (no auth) will no
longer read/write** — it used the anon key with `user_id = 'default'`. Rebuild
the desktop app from the updated code (it now shows the same login screen and
uses your account).

## Known gap: Garmin Connect sync is desktop-only

`GarminSyncPanel` (rendered on Biomarkers, Workouts, Running) calls into a
Tauri command that shells out to a local Python subprocess — there is no web
equivalent. It fails gracefully on the web build (shows an inline error if a
user clicks Sync, not a crash), and is intentionally left unguarded rather
than hidden behind an `isTauri()` check. Building real server-side sync (a
Supabase Edge Function + pg_cron, since Python's `garminconnect` library
doesn't run in Deno) is a separate future backlog item, not part of this
deploy.
