# Deploying Vault to the web (Vercel)

Vault is a Vite SPA whose data layer is Supabase-direct, so it runs in a plain
browser. The desktop (Tauri) build is unaffected — Tauri-only features are gated
behind `isTauri()` (`src/lib/platform.ts`) and no-op / fall back to Supabase on
the web.

## Vercel project settings

Because `@nexus/core` is aliased to `../../../packages/nexus-core/src`, the build
must run from the **repository root** (it needs the whole monorepo). The root
`vercel.json` already encodes this:

- **Root Directory:** repository root (leave the Vercel setting empty/default).
- **Install:** `npm install`  (installs the whole workspace)
- **Build:** `npm run build --workspace=apps/Vault/Vault`  (`tsc && vite build`)
- **Output:** `apps/Vault/Vault/dist`
- **Rewrites:** all paths → `/index.html` (SPA fallback)

Do **not** set the Vercel Root Directory to `apps/Vault/Vault` — that would cut
off the `packages/` sibling the alias needs.

## Environment variables (Vercel → Project → Settings → Environment Variables)

```
VITE_SUPABASE_URL       = https://efxmzsdisaymtpebaxlp.supabase.co
VITE_SUPABASE_ANON_KEY  = <anon / sb_publishable key from Supabase dashboard>
```

These are `VITE_`-prefixed, so they are inlined into the client bundle at build
time (the anon key is public by design — RLS is the real guard, see below).

## Supabase auth configuration (one-time, in the dashboard)

- **Authentication → Providers → Email:** enabled (default). Email+password.
- **Authentication → URL Configuration → Site URL:** set to the Vercel domain
  (e.g. `https://vault-xxxx.vercel.app`) so confirmation emails link back to it.
  Add the domain to **Redirect URLs** too.
- Optional: **Confirm email** can be turned off for a single-user setup to skip
  the email-confirmation step on signup.

## Security posture (read before exposing publicly)

Every `vault_*` table starts with a permissive `anon_all` RLS policy. **Until the
per-user RLS migration is applied, anyone with the URL can read/write all data.**
The deploy is only safe once:

1. You have signed up (creates your `auth.uid()`).
2. Existing `user_id = 'default'` rows are migrated to your uid.
3. `vault_*` RLS is switched from `anon_all` to `user_id = auth.uid()`.

Until then, keep the Vercel deployment private (Vercel Deployment Protection /
password) or don't share the URL.

The `vault-assets` storage bucket is currently public; asset URLs are
unguessable (UUID paths) but not access-controlled. Tighten to signed URLs when
moving to a fully locked-down setup.
