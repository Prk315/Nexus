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

⚠️ This section previously said every `vault_*` table starts with a permissive
`anon_all` policy pending a migration. **That was stale as of 2026-08-26** —
verified live against the project (`pg_policies`): every `vault_*` table
already carries an `owner_all` policy scoped to `user_id = auth.uid()`, and
`user_id` holds real uids only (no leftover `'default'` rows). The three-step
migration this section used to describe is already done; don't re-run it.

`20260826150000_vault_teams.sql` adds an **additive** sharing layer on top of
that (a `team_id` column + policies OR'd alongside `owner_all`, reusing
PathFinder's `pf_teams`/`pf_team_members`) — it does not change the base
per-user scoping described above.

The `vault-assets` storage bucket is currently public; asset URLs are
unguessable (UUID paths) but not access-controlled. Tighten to signed URLs when
moving to a fully locked-down setup.

## Live co-editing (shared notes)

Two people can edit the same **shared note** at the same time, with each other's
carets and selections visible. It is off unless the build sets
`VITE_VAULT_COLLAB=1`, and it applies only to Tiptap notes whose `team_id` is
set — Canvas, PDF ink, Journal, Workbook, Bookshelf and every private note keep
the ordinary save-and-warn-on-conflict path untouched.

How it fits together:

- `vault_ydoc.state` is a Yjs CRDT document and is the **truth** while a note is
  being co-edited. `vault_content.data` keeps being written as a JSON
  **projection** — that is what the schema guard audits, what PDF export and
  WorkbookEditor read, and what a client without this build still sees.
- Sync is a **private** Supabase Realtime broadcast channel per note
  (`vault:doc:<nodeId>`). No collaboration server, so nothing depends on the Mac
  being awake.
- The whole stack (yjs, y-protocols, both Tiptap collaboration packages) sits
  behind one dynamic import, so a build with no shared notes never downloads it.

### Before enabling it

Four things, in order, and two of them are not code. They are written out with
their verification queries in `supabase/migrations/APPLY.md` §9:

1. Apply `20260827120000_vault_live_coedit.sql`.
2. ⚠️ Turn **off** "Allow public access" in Project Settings → Realtime →
   Settings. The migration's RLS policies do nothing until you do — Realtime
   routes broadcast by topic and `private` is a per-client join flag, so a client
   that omits it reads every delta without the policies ever being consulted. The
   anon key is committed and this repo is public.
3. Ship the guard build (`VITE_VAULT_COLLAB` unset) to **iOS, then Mac, then
   web**. It refuses to save a note that already has CRDT state, which is what
   stops an out-of-date client silently overwriting a co-edited note.
4. Only then set `VITE_VAULT_COLLAB=1`, **web first, then Mac, then iOS** — the
   reverse, because web rolls back in a minute.

### Known limits

- Yjs state grows monotonically. There is no safe automatic compaction (rebuilding
  the document mints fresh client ids and would collide with a live peer, which is
  the duplication bug the seed election exists to prevent). Recovery is manual:
  with nobody editing, the note's owner deletes its `vault_ydoc` row and the next
  open re-seeds from the projection.
- A note's `width` is restored on open but does not sync between the two of you —
  Yjs syncs the document's content, not the doc node's attributes.
- If both clients close hard within ~1.5 s of the last keystroke, that last
  moment of typing can be lost. There is no `keepalive` path through PostgREST.
