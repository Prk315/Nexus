-- Version history for note content, and the thing that makes a sync conflict
-- recoverable instead of a coin toss.
--
-- ─── Why this table exists ───────────────────────────────────────────────────
-- Every surface in Vault rewrites a node's ENTIRE document into one
-- vault_content row on a 400 ms debounce, and that row has no history. That is
-- fine while a note has one author on one device, and it is the reason several
-- comments in this repo say "vault_content keeps no history" as a warning about
-- how much a single bad write costs:
--
--   * lib/noteSchemaGuard.ts — an unknown node type blanks a document, and the
--     first keystroke autosaves the blank over the original;
--   * lib/api.ts CollabOnlyError — an old client's whole-document save silently
--     discards what the CRDT holds;
--   * collab/slot.ts — a stale seed made note B's content a copy of note A's.
--
-- All three were fixed by preventing the write. This table is the other half:
-- when a write does land wrongly anyway, the previous document is still here.
-- It is also what lets the UI offer a real choice on a conflict — the pane used
-- to offer "Reload" (discard mine) and nothing else, so "keep mine" meant
-- overwriting the other person with no way back for them.
--
-- ─── Snapshots are taken by a TRIGGER, not by the client ─────────────────────
-- The trigger captures OLD.data — the document as it was BEFORE the write. A
-- client-side "save a copy alongside each save" captures the NEW document, so
-- the state you actually want back (what it looked like when you opened it) is
-- exactly the one never recorded. It also puts the rule in one place for every
-- writer: the web app, the Mac app, the iPad, the JSON projection written by
-- the co-editing runtime, and any future job.
--
-- The 5-minute gate is what keeps this from being a second write per keystroke.
-- Under live co-editing vault_content is rewritten every couple of seconds by
-- BOTH clients; without the gate a two-person editing session would insert
-- thousands of rows an hour.
--
-- ─── Ordering ────────────────────────────────────────────────────────────────
-- Purely additive: a new table, a new trigger on vault_content, no policy
-- changed. Deployed code that knows nothing about it keeps working — an app
-- without the History panel simply never selects from it. Safe to apply before
-- or after the client ships, unlike the removals APPLY.md warns about.

-- ── 1. The table ─────────────────────────────────────────────────────────────
-- node_id mirrors vault_content.node_id exactly, INCLUDING the suffix keys
-- ("<id>_annot", "<id>_hl", "<id>_margins", …) that share that table. The
-- trigger does not filter them out and should not: a wiped PDF annotation layer
-- is worth recovering for the same reasons a wiped note is. Every policy below
-- therefore uses split_part(node_id, '_', 1) to find the parent node, matching
-- vault_content's own policies in 20260826150000_vault_teams.sql.

create table if not exists vault_content_versions (
  id         bigint generated always as identity primary key,
  node_id    text        not null,
  data       text        not null,
  -- GENERATED, so it is one definition that cannot disagree with `data` and
  -- that no client can get wrong. It exists at all because the history list is
  -- selected WITHOUT `data` — forty versions of a note is forty whole
  -- documents, and pulling megabytes to draw a sidebar of timestamps is not a
  -- list, it is a download. octet_length rather than length(): the UI renders
  -- this as kB, and characters are not bytes the moment a note contains an
  -- emoji or a Danish vowel.
  byte_len   integer     generated always as (octet_length(data)) stored,
  -- Who wrote the version being REPLACED, i.e. the author of this snapshot's
  -- content — copied from the vault_content row rather than from auth.uid(),
  -- which would name whoever happened to trigger the overwrite.
  user_id    text        not null default '',
  -- autosave  — the periodic trigger below
  -- conflict  — captured before one client saved over another's newer row
  -- restore   — captured before an older version was restored over the current
  -- overwrite — captured before "keep mine" replaced the server copy
  -- manual    — the user asked for a checkpoint
  origin     text        not null default 'autosave',
  created_at timestamptz not null default now()
);

-- The only access pattern: newest-first for one node. Also what the retention
-- trigger scans.
create index if not exists vault_content_versions_node_idx
  on vault_content_versions (node_id, created_at desc, id desc);

alter table vault_content_versions enable row level security;

do $$
begin
  -- Owner: everything, including DELETE. Pruning your own history is yours to
  -- do; a teammate must not be able to erase the evidence of an overwrite,
  -- which is the entire point of the table. Same "no team DELETE policy"
  -- posture as vault_ydoc.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vault_content_versions' and policyname = 'owner_all') then
    create policy owner_all on vault_content_versions for all to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content_versions.node_id, '_', 1)
          and n.user_id = (select auth.uid())::text
      ))
      with check (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content_versions.node_id, '_', 1)
          and n.user_id = (select auth.uid())::text
      ));
  end if;

  -- Teammate on a SHARED node: read the history and add to it. Reading is what
  -- makes "see earlier iterations" work for the person who did NOT own the
  -- note, and they are usually the one who needs it.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vault_content_versions' and policyname = 'team_shared_select') then
    create policy team_shared_select on vault_content_versions for select to public
      using (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content_versions.node_id, '_', 1)
          and n.team_id is not null
          and pf_is_team_member(n.team_id)
      ));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vault_content_versions' and policyname = 'team_shared_insert') then
    create policy team_shared_insert on vault_content_versions for insert to public
      with check (exists (
        select 1 from vault_nodes n
        where n.id = split_part(vault_content_versions.node_id, '_', 1)
          and n.team_id is not null
          and pf_is_team_member(n.team_id)
      ));
  end if;

  -- No UPDATE policy at all, for anybody. A version is a fact about what the
  -- document once was; an editable history is not a history.
end $$;

-- ── 2. Automatic snapshots ───────────────────────────────────────────────────
-- SECURITY DEFINER so the insert is not subject to vault_content_versions' own
-- policies. That is not a shortcut: the row being snapshotted has ALREADY
-- passed vault_content's RLS (this trigger only runs on an update that was
-- allowed), so re-deriving permission here could only ever produce a DIFFERENT
-- answer than the write itself got — and the failure direction would be "the
-- write succeeded but nothing was preserved", which is precisely the outcome
-- the table exists to prevent.

create or replace function vault_content_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Nothing to preserve: a no-op write, or a row that was empty anyway.
  if OLD.data is null or OLD.data = '' or NEW.data is not distinct from OLD.data then
    return NEW;
  end if;

  -- Rate limit. Under live co-editing this row is rewritten every couple of
  -- seconds by both clients; one snapshot per 5 minutes of activity is a
  -- history, one per write is a denial-of-service against your own database.
  if exists (
    select 1 from vault_content_versions v
    where v.node_id = OLD.node_id
      and v.created_at > now() - interval '5 minutes'
  ) then
    return NEW;
  end if;

  insert into vault_content_versions (node_id, data, user_id, origin)
  values (OLD.node_id, OLD.data, coalesce(OLD.user_id, ''), 'autosave');

  return NEW;
end $$;

drop trigger if exists vault_content_snapshot_trg on vault_content;
create trigger vault_content_snapshot_trg
before update on vault_content
for each row execute function vault_content_snapshot();

-- ── 3. Retention ─────────────────────────────────────────────────────────────
-- Unbounded history on a table whose rows are whole documents is a disk problem
-- waiting to happen — the content cap is 2 MB (lib/api.ts MAX_CONTENT_BYTES),
-- so an unpruned node could reach gigabytes on its own.
--
-- Count-based rather than age-based: a note edited once a year should still
-- keep its history, and a note edited all day should not keep a year of it. 40
-- entries at >= 5 minutes apart spans a long working session and then some.
--
-- AFTER INSERT rather than a cron job so retention cannot silently stop
-- running, and SECURITY DEFINER for the same reason as above.

create or replace function vault_content_versions_prune()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from vault_content_versions v
  where v.node_id = NEW.node_id
    and v.id not in (
      select id from vault_content_versions
      where node_id = NEW.node_id
      order by created_at desc, id desc
      limit 40
    );
  return null;
end $$;

drop trigger if exists vault_content_versions_prune_trg on vault_content_versions;
create trigger vault_content_versions_prune_trg
after insert on vault_content_versions
for each row execute function vault_content_versions_prune();
