-- Let a SIGNED-IN user upload to vault-assets.
--
-- ── The bug ────────────────────────────────────────────────────────────────
--
-- `storage.objects` carried exactly one policy: `anon_all`, FOR ALL TO anon.
-- Vault's web app signs in (`useNexusAuth`), so its client is the
-- **authenticated** role — which had no policy at all, and therefore no
-- permission to insert. Every "Import PDF" since auth landed was denied.
--
-- The evidence, measured before writing this: all 62 objects in the bucket have
-- `owner IS NULL` (uploaded as anon) and the newest is 2026-08-15. Nothing has
-- been uploaded through the app since.
--
-- ⚠️ This is the same trap CLAUDE.md documents for the productivity tables,
-- with Storage in place of a table: a policy written for one role does not
-- merely restrict the other, it EXCLUDES it. And the failure is quiet — the
-- upload throws inside an async event handler, so what the user sees is a node
-- with "PDF not loaded" and no error anywhere.
--
-- ── The policy ─────────────────────────────────────────────────────────────
--
-- Scoped to the user's own folder rather than `USING (true)`. `uploadAsset`
-- already writes `${auth.uid()}/${nodeId}.${ext}` and `uploadCanvasImage`
-- writes `${auth.uid()}/canvas/…`, so the first path segment IS the owner and
-- the check costs nothing. A permissive policy would let any authenticated
-- account overwrite another's files by path — and this bucket is PUBLIC, so
-- the object is readable by URL regardless; write is the only thing worth
-- guarding.
--
-- `anon_all` is deliberately LEFT IN PLACE. Removals are strictly ordered in
-- this project (one database, every branch — see CLAUDE.md), and the desktop
-- and iPad builds have not been audited for whether they upload while signed
-- out. Dropping it is a separate, ordered change: stop relying on anon, deploy
-- everywhere, then drop. This migration is purely additive.
--
-- APPLIED 2026-08-30 to efxmzsdisaymtpebaxlp.

-- Read is separate from write and stays broad: the bucket is public, so a
-- SELECT policy that were narrower than the public URL would be theatre.
drop policy if exists vault_assets_authenticated_read on storage.objects;
create policy vault_assets_authenticated_read on storage.objects
  for select
  to authenticated
  using (bucket_id = 'vault-assets');

-- Write, update and delete are owner-scoped by path prefix.
drop policy if exists vault_assets_authenticated_insert on storage.objects;
create policy vault_assets_authenticated_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'vault-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- UPDATE needs both: USING decides which rows may be updated, WITH CHECK
-- decides what they may become. Without the second, an update could move a
-- file out of the caller's own folder.
drop policy if exists vault_assets_authenticated_update on storage.objects;
create policy vault_assets_authenticated_update on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'vault-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'vault-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ⚠️ DELETE is governed only by USING, never WITH CHECK — the same rule the
-- vault_* team policies are written against.
drop policy if exists vault_assets_authenticated_delete on storage.objects;
create policy vault_assets_authenticated_delete on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'vault-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
