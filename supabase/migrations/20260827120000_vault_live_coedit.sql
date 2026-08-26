-- Live co-editing for SHARED notes: a Yjs CRDT document per shared note, synced
-- over a PRIVATE Supabase Realtime broadcast channel and persisted to a new
-- vault_ydoc table. Additive only — no existing policy is changed.
--
-- Scope is the Tiptap NoteEditor and nothing else. Canvas, PDF ink, Journal,
-- Workbook, Bookshelf and ParsedViewer keep the sync-on-save + conflict-warning
-- path from 20260826150000_vault_teams.sql, and so do private notes.
--
-- Conventions inherited from that migration, all deliberate:
--   * vault_nodes.id is TEXT (verified via information_schema), so
--     vault_ydoc.node_id is TEXT. Only vault_nodes.team_id is uuid, and it is
--     only ever handed to pf_is_team_member(uuid). No ::uuid casts below.
--   * DELETE is governed only by USING, never WITH CHECK, so "a teammate can
--     edit but not delete" needs separate FOR SELECT/INSERT/UPDATE policies.
--     There is NO team DELETE policy here either.
--   * No split_part() here, and its absence is load-bearing. vault_content and
--     vault_journals need it because "<id>_hl" / "_annot" / "_textannot" /
--     "_bookmarks" / "_margins" share those tables. A vault_ydoc row is ALWAYS
--     keyed by a real node id — co-editing covers the note body only — and
--     writing a split_part here would quietly accept a suffix key and hand it
--     the parent note's permissions.
--
-- ⚠️ THIS FILE IS NOT SUFFICIENT ON ITS OWN. Realtime routes broadcast by
-- TOPIC, and `private` is a per-client JOIN flag. A client that joins
-- `vault:doc:<uuid>` WITHOUT {config:{private:true}} never has the policies in
-- section 3 evaluated and receives every document delta regardless. The anon
-- key is committed in this repo and the repo is public, so those policies buy
-- nothing until "Allow public access" is turned OFF in
--   Dashboard → Project Settings → Realtime → Settings.
-- Verified 2026-08-27: there is not one `.channel(` call site anywhere else in
-- this monorepo and no `supabase_realtime` publication, so flipping it
-- project-wide breaks nothing. Do it BEFORE deploying a client that broadcasts.
--
-- ⚠️ realtime.messages is owned by supabase_realtime_admin, and `postgres` is
-- not a member of that role, yet CREATE POLICY on it succeeds as postgres on
-- Supabase. If a future platform change breaks that, the error is "must be
-- owner of table messages" — apply section 3 from the dashboard SQL editor.
-- Sections 1 and 2 are ordinary public-schema DDL and always work.
--
-- ⚠️ APPLY THIS BEFORE the client that reads vault_ydoc ships. PostgREST
-- answers a missing table with an error, so an un-migrated database would turn
-- every shared-note open into a hard failure rather than a degraded one — the
-- same ordering trap APPLY.md records for job-ingest v5.

-- ── 1. Who may co-edit ───────────────────────────────────────────────────────
-- One definition, consulted by both the storage policies (section 2) and the
-- transport policies (section 3), so the two can never drift into disagreeing
-- about who is allowed to see a document.
--
-- SECURITY DEFINER so it reads vault_nodes without re-entering that table's own
-- RLS, exactly like pf_is_team_member.
--
-- Note it requires team_id IS NOT NULL even for the node's OWNER, which is the
-- point rather than an oversight: co-editing is a property of a SHARED note. An
-- unshared note is co-editable by nobody, so it opens no channel and gets no
-- CRDT row — enforced in the database rather than only by client-side
-- branching. Both seeded accounts are members of the one seeded pf_teams row,
-- so an owner of a shared note passes.

create or replace function vault_can_coedit(nid text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from vault_nodes n
    where n.id = nid
      and n.team_id is not null
      and pf_is_team_member(n.team_id)
  );
$$;

-- ── 2. CRDT state ────────────────────────────────────────────────────────────
-- One row per co-edited note. `state` is base64(Y.encodeStateAsUpdate(doc)) —
-- text rather than bytea because PostgREST returns bytea as a \x hex string
-- anyway (same ~2x inflation, worse ergonomics), and every other payload column
-- in this schema is text.
--
-- Deliberately NO user_id column and NO owner-forcing trigger, unlike
-- vault_content. That trigger exists only because rawSaveContent writes
-- user_id: getUserId() on every upsert, including updates to a row it does not
-- own, so a teammate's save would silently steal ownership. A new table has no
-- such legacy: every policy below derives ownership from the parent vault_nodes
-- row, which removes the column the trigger existed to defend.
--
-- vault_content.data keeps being written alongside this, as a JSON projection.
-- vault_ydoc is the truth while a note is co-edited; vault_content is the
-- readable shadow that noteSchemaGuard audits, PDF export and WorkbookEditor
-- read, and any client too old to know about CRDTs still sees.
--
-- No FK to vault_nodes, matching vault_content/vault_journals. deleteNode() and
-- unshareNode() in lib/api.ts clean these rows up explicitly.

create table if not exists vault_ydoc (
  node_id    text primary key,
  state      text        not null default '',
  updated_at timestamptz not null default now()
);

alter table vault_ydoc enable row level security;

do $$
begin
  -- Owner: everything, including DELETE. That DELETE is not incidental — it is
  -- the documented recovery path for a Yjs state that has grown too large
  -- (delete the row while nobody is editing; the next open re-seeds from the
  -- vault_content projection), and it is what lets unshareNode clean up.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vault_ydoc' and policyname = 'owner_all') then
    create policy owner_all on vault_ydoc for all to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = vault_ydoc.node_id
          and n.user_id = (select auth.uid())::text
      ))
      with check (exists (
        select 1 from vault_nodes n
        where n.id = vault_ydoc.node_id
          and n.user_id = (select auth.uid())::text
      ));
  end if;

  -- Teammate: read, seed and flush. Not delete.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vault_ydoc' and policyname = 'team_shared_select') then
    create policy team_shared_select on vault_ydoc for select to public
      using (vault_can_coedit(node_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vault_ydoc' and policyname = 'team_shared_insert') then
    create policy team_shared_insert on vault_ydoc for insert to public
      with check (vault_can_coedit(node_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vault_ydoc' and policyname = 'team_shared_update') then
    create policy team_shared_update on vault_ydoc for update to public
      using (vault_can_coedit(node_id))
      with check (vault_can_coedit(node_id));
  end if;
end $$;

-- Grants stay at Supabase's public-schema default (anon + authenticated), same
-- as every other vault_* table. anon is fail-closed here: it has no auth.uid(),
-- so both policies above evaluate false.

-- ── 3. Realtime Authorization ────────────────────────────────────────────────
-- realtime.messages is RLS-enabled with ZERO policies on this project as of
-- 2026-08-27 (verified), i.e. every private channel currently denies. These two
-- policies open exactly one topic shape and nothing else.
--
-- Topic grammar: 'vault:doc:<vault_nodes.id>'. realtime.topic() returns the
-- topic WITHOUT the 'realtime:' prefix realtime-js prepends internally, so it
-- matches the string passed to supabase.channel() verbatim.
--
-- split_part on ':' is exact here: node ids are crypto.randomUUID(), which
-- contains only hex and '-'. A malformed topic yields '', which matches no node
-- id, so vault_can_coedit('') is false and the join is denied rather than
-- erroring.
--
-- Realtime evaluates these at JOIN time by running the query and rolling it
-- back; no row is ever stored in realtime.messages.
--
-- Only extension = 'broadcast'. Presence is deliberately NOT authorized: Yjs
-- awareness (which is what drives the remote carets) rides the same broadcast
-- channel under its own event name, and Supabase Presence would add a second
-- quota class — 20 events/s on the free plan against broadcast's 100 — for
-- liveness that y-protocols' own 30s outdatedTimeout already provides.
--
-- `to authenticated` explicitly: anon also holds grants on realtime.messages,
-- and while auth.uid() is null for it and vault_can_coedit would return false
-- anyway, naming the role is the difference between secure and secure by
-- accident.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'vault_doc_broadcast_read') then
    create policy vault_doc_broadcast_read on realtime.messages for select to authenticated
      using (
        realtime.messages.extension in ('broadcast')
        and split_part((select realtime.topic()), ':', 1) = 'vault'
        and split_part((select realtime.topic()), ':', 2) = 'doc'
        and public.vault_can_coedit(split_part((select realtime.topic()), ':', 3))
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'vault_doc_broadcast_write') then
    create policy vault_doc_broadcast_write on realtime.messages for insert to authenticated
      with check (
        realtime.messages.extension in ('broadcast')
        and split_part((select realtime.topic()), ':', 1) = 'vault'
        and split_part((select realtime.topic()), ':', 2) = 'doc'
        and public.vault_can_coedit(split_part((select realtime.topic()), ':', 3))
      );
  end if;
end $$;
