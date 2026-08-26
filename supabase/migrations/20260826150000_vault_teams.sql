-- Vault sharing: a teammate can view/edit a shared note or a shared folder's
-- whole subtree, via the same pf_teams/pf_team_members model PathFinder uses
-- (20260826120000_pf_teams.sql). Additive only — every vault_* table's
-- existing `owner_all` policy (verified live on 2026-08-26 against project
-- efxmzsdisaymtpebaxlp: `for all to public using/with check
-- (user_id = (select auth.uid())::text)`) is untouched; team policies are
-- OR'd alongside it, same shape as pf_teams' `team_all` on pf_tasks/pf_plans.
-- (apps/Vault/Vault/DEPLOY.md claims these tables are still on a permissive
-- anon_all policy pending a migration — that claim is stale; ignore it.)
--
-- Column types verified live via information_schema.columns: every id /
-- node_id / from_id / to_id / source_node_id column below is TEXT, not uuid
-- (vault_nodes.id, vault_edges.from_id/to_id, vault_content.node_id,
-- vault_journals.node_id, vault_records.source_node_id). Only the new
-- vault_nodes.team_id column is uuid (references pf_teams.id). No ::uuid
-- casts appear below for that reason — comparisons are text = text.
--
-- Two traps this design routes around, both already hit once by pf_teams:
--  1. DELETE is governed only by USING, never WITH CHECK — so "teammate can
--     edit but not delete" needs separate FOR SELECT/INSERT/UPDATE policies,
--     not one FOR ALL with a carved-out check. No FOR DELETE team policy is
--     added anywhere below: only the owner's `owner_all` can delete a shared
--     row, on any table.
--  2. vault_content.node_id / vault_journals.node_id are NOT always a real
--     node id. Suffix rows — "<id>_hl" (readHighlighters/saveHighlighters),
--     "<id>_annot", "<id>_textannot", "<id>_bookmarks", "<id>_margins" — share
--     the same storage table but aren't FK'd to vault_nodes (deliberate, see
--     CLAUDE.md: it's what lets an annotation layer key off a note it doesn't
--     own a column on). A parent-node lookup must strip the suffix with
--     split_part(node_id, '_', 1) — node ids are crypto.randomUUID(), which
--     never contains '_', so this is always safe. Getting this wrong makes
--     every shared PDF's annotations/highlights invisible to the teammate
--     (empty set, not an error — this codebase's signature failure mode).

-- ── 1. Sharing column ────────────────────────────────────────────────────────

alter table vault_nodes add column if not exists team_id uuid references pf_teams(id) on delete set null;
create index if not exists vault_nodes_team_id_idx on vault_nodes (team_id) where team_id is not null;

-- ── 2. Additive team policies ────────────────────────────────────────────────
-- View + edit for teammates; delete stays owner-only everywhere (no FOR
-- DELETE policy is created on any table in this migration).

do $$
begin
  -- vault_nodes: no team_shared_insert — a shared node is created by
  -- createNode() as owner, then explicitly shared (see shareNode/shareFolder
  -- in api.ts). A teammate never inserts a vault_nodes row on someone else's
  -- behalf.
  if not exists (select 1 from pg_policies where tablename = 'vault_nodes' and policyname = 'team_shared_select') then
    create policy team_shared_select on vault_nodes for select to public
      using (team_id is not null and pf_is_team_member(team_id));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_nodes' and policyname = 'team_shared_update') then
    create policy team_shared_update on vault_nodes for update to public
      using (team_id is not null and pf_is_team_member(team_id))
      with check (team_id is not null and pf_is_team_member(team_id));
  end if;

  -- vault_edges: visibility/write follows the FROM node's team (an edge
  -- belongs to its source node's sharing state). A teammate's own edge rows
  -- (e.g. attaching their own new node under a shared folder) are already
  -- visible to them via owner_all; team_shared_select is what lets the
  -- ORIGINAL owner see edges the teammate created inside that shared folder.
  if not exists (select 1 from pg_policies where tablename = 'vault_edges' and policyname = 'team_shared_select') then
    create policy team_shared_select on vault_edges for select to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = vault_edges.from_id
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_edges' and policyname = 'team_shared_insert') then
    create policy team_shared_insert on vault_edges for insert to public
      with check (exists (
        select 1 from vault_nodes n
        where n.id = vault_edges.from_id
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_edges' and policyname = 'team_shared_update') then
    create policy team_shared_update on vault_edges for update to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = vault_edges.from_id
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ))
      with check (exists (
        select 1 from vault_nodes n
        where n.id = vault_edges.from_id
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  -- vault_content: parent lookup strips a "<id>_suffix" key down to the real
  -- node id first (see header comment).
  if not exists (select 1 from pg_policies where tablename = 'vault_content' and policyname = 'team_shared_select') then
    create policy team_shared_select on vault_content for select to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_content' and policyname = 'team_shared_insert') then
    create policy team_shared_insert on vault_content for insert to public
      with check (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_content' and policyname = 'team_shared_update') then
    create policy team_shared_update on vault_content for update to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ))
      with check (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  -- vault_journals: same shape as vault_content.
  if not exists (select 1 from pg_policies where tablename = 'vault_journals' and policyname = 'team_shared_select') then
    create policy team_shared_select on vault_journals for select to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_journals.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_journals' and policyname = 'team_shared_insert') then
    create policy team_shared_insert on vault_journals for insert to public
      with check (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_journals.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_journals' and policyname = 'team_shared_update') then
    create policy team_shared_update on vault_journals for update to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_journals.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ))
      with check (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_journals.node_id, '_', 1)
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  -- vault_records: parent column is source_node_id, no suffix convention.
  -- Note this only grants VISIBILITY of a teammate's own or the shared
  -- node's records via RLS — readRecordsForSources also drops its
  -- client-side user_id filter (see api.ts) so the broadened set actually
  -- reaches the UI.
  if not exists (select 1 from pg_policies where tablename = 'vault_records' and policyname = 'team_shared_select') then
    create policy team_shared_select on vault_records for select to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = vault_records.source_node_id
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'vault_records' and policyname = 'team_shared_insert') then
    create policy team_shared_insert on vault_records for insert to public
      with check (exists (
        select 1 from vault_nodes n
        where n.id = vault_records.source_node_id
          and n.team_id is not null and pf_is_team_member(n.team_id)
      ));
  end if;

  -- vault_tag_colors, vault_book_sources: no team policy, deliberately.
  -- Tag colors are per-viewer (a shared node's tags may render uncolored for
  -- the other user — known v1 limitation). Book sources are a per-user
  -- reading-list index, not shared note content.
end $$;

-- ── 3. Ownership-forcing trigger ─────────────────────────────────────────────
-- Without this, a teammate's save flips vault_content/vault_journals'
-- user_id to their own uid — rawSaveContent/rawSaveJournal always write
-- user_id: getUserId() on every upsert, including updates to an existing
-- row. Mirrors pf_task_subtype_owner() (20260820130000_pf_task_isa_hierarchy.sql).

create or replace function vault_content_force_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_owner text;
begin
  select n.user_id into parent_owner
  from vault_nodes n
  where n.id = split_part(NEW.node_id, '_', 1);

  if parent_owner is not null then
    NEW.user_id := parent_owner;
  end if;

  return NEW;
end;
$$;

drop trigger if exists vault_content_force_owner_trg on vault_content;
create trigger vault_content_force_owner_trg
before insert or update on vault_content
for each row execute function vault_content_force_owner();

drop trigger if exists vault_journals_force_owner_trg on vault_journals;
create trigger vault_journals_force_owner_trg
before insert or update on vault_journals
for each row execute function vault_content_force_owner();
