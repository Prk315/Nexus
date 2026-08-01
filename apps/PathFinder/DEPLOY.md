# Deploying PathFinder to the web (Vercel)

PathFinder is a Vite SPA whose data layer is Supabase-direct (no `invoke`, no
native plugins), so it runs in a plain browser like Vault. It uses the **same
Supabase project and the same ecosystem account** — no separate signup.

## Vercel project settings (separate project from Vault)

Vault's root `vercel.json` builds Vault, so PathFinder needs its **own** Vercel
project scoped to its folder. Create a new project on the same repo with:

- **Root Directory:** `apps/PathFinder`
- Enable **"Include files outside of the Root Directory in the Build Step"**
  (the build reaches up to `packages/nexus-core`, aliased as `@nexus/core`).
- The rest is encoded in `apps/PathFinder/vercel.json`:
  - Install: `cd ../.. && npm install` (whole workspace)
  - Build: `cd ../.. && npm run build --workspace=apps/PathFinder`
  - Output: `dist` (i.e. `apps/PathFinder/dist`)
  - Rewrites: SPA fallback → `/index.html`

If Vercel doesn't pick up the vercel.json build settings, set the same Build /
Output / Install commands in the project's dashboard (Settings → Build & Output).

## Environment variables (same values as Vault)

```
VITE_SUPABASE_URL       = https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY  = <same anon key as Vault>
```
`VITE_`-prefixed → inlined into the client bundle (anon key is public by design;
RLS is the guard). Not "Sensitive".

## Supabase auth

Same shared account as Vault. After deploy, add PathFinder's `*.vercel.app`
domain to **Supabase → Authentication → URL Configuration → Redirect URLs**.
Log in with the same email/password you use for Vault.

## Data + security (already applied)

- All `pf_*` rows migrated from `user_id = 'default'` to the account uid.
- RLS locked down: 32 root tables (with `user_id`) → `owner_all`
  (`user_id = auth.uid()`); 21 child tables (no `user_id`) → `authenticated`-only
  (denies anonymous). Single-user, so child tables aren't per-user isolated yet;
  add `user_id` + `auth.uid()` policies there if PathFinder ever goes multi-user.

## ⚠️ Desktop PathFinder must be rebuilt

Flipping RLS to `auth.uid()` means the **old desktop build (no auth) will no
longer read/write** — it used the anon key with `user_id = 'default'`. Rebuild
the desktop app from the updated code (it now shows the same login screen and
uses your account).
