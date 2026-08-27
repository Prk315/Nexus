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
--
-- APPLIED 2026-08-27 to efxmzsdisaymtpebaxlp, and verified live against a
-- scratch node that was removed afterwards: a real change snapshots the PREVIOUS
-- document; a second change within five minutes does not; a no-op write does
-- not; a 3 MB → 3 MB change is skipped by the size guard; six 2 MB entries prune
-- to four (7813 kB, under the 8 MB budget); a single 10 MB entry survives on the
-- floor of 2. Three policies, no UPDATE policy, both triggers present. See
-- APPLY.md §11 — including why the security advisor's "Public Can Execute
-- SECURITY DEFINER Function" warning is a false positive for trigger functions.

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

  -- Above the app's own save cap (lib/api.ts MAX_CONTENT_BYTES = 2 MB), so the
  -- client REFUSES to write this document at all — it is frozen, and versioning
  -- something nothing can change is pure cost. Measured on this database before
  -- applying: three such rows exist (Canvases of 4.5, 5.3 and 10 MB, all
  -- predating the cap) totalling 20 MB, and versioning them would have been
  -- ~791 MB against a 96 MB database.
  --
  -- Deliberately the same number as MAX_CONTENT_BYTES rather than a separate
  -- knob: the rule is "if the app can save it, the app can version it", and two
  -- independent limits would drift into a band where a document is writable but
  -- silently unversioned.
  if octet_length(OLD.data) > 2000000 then
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
-- waiting to happen, so retention is bounded by BYTES first and count second.
--
-- A plain "keep the newest 40" is the obvious rule and it is wrong here, which
-- the live data says plainly. Measured before applying:
--
--     87 rows under 10 kB    → 40 versions each ≈    3.8 MB   fine
--     16 rows  10–100 kB     → 40 versions each ≈     20 MB   fine
--      4 rows 100 kB–2 MB    → 40 versions each ≈     94 MB   not fine
--
-- against a 96 MB database. One rule cannot serve both ends of a distribution
-- that wide, and picking a count low enough for the 2 MB documents would leave
-- the 5 kB notes — the ones actually edited all day, and the ones this feature
-- is for — with almost no history at all.
--
-- So: keep the newest entries while their cumulative size stays under a budget,
-- capped at 40 and floored at 2. A small note gets its full 40 iterations; a
-- 500 kB canvas gets about 16; a 2 MB one gets 4. Every node is bounded by the
-- same number of megabytes rather than the same number of documents.
--
-- The floor of 2 matters: without it a single document larger than the whole
-- budget would prune away the very snapshot just taken, and the feature would
-- appear to do nothing for exactly the documents where losing work hurts most.
--
-- AFTER INSERT rather than a cron job so retention cannot silently stop
-- running, and SECURITY DEFINER for the same reason as section 2.

create or replace function vault_content_versions_prune()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  byte_budget constant bigint := 8 * 1024 * 1024;  -- per node
  max_keep    constant integer := 40;
  min_keep    constant integer := 2;
begin
  with ranked as (
    select id,
           row_number() over (order by created_at desc, id desc) as rn,
           -- Cumulative size of this entry and every NEWER one. Monotonic in
           -- rn, so "running > budget" always selects a suffix — never a hole
           -- in the middle of the history.
           sum(byte_len) over (order by created_at desc, id desc
                               rows between unbounded preceding and current row) as running
    from vault_content_versions
    where node_id = NEW.node_id
  )
  delete from vault_content_versions v
  using ranked r
  where v.id = r.id
    and r.rn > min_keep
    and (r.rn > max_keep or r.running > byte_budget);
  return null;
end $$;

drop trigger if exists vault_content_versions_prune_trg on vault_content_versions;
create trigger vault_content_versions_prune_trg
after insert on vault_content_versions
for each row execute function vault_content_versions_prune();
