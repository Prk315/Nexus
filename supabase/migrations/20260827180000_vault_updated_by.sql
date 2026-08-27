-- Who actually wrote a document last — which nothing in this schema could say.
--
-- ─── Why a new column, rather than reading the one that looks right ──────────
-- `vault_content.user_id` looks like the author and is not. Every insert and
-- update runs through vault_content_force_owner() (20260826150000_vault_teams),
-- which does:
--
--     NEW.user_id := <owner of the parent vault_nodes row>
--
-- That trigger is correct and must stay: without it a teammate's save silently
-- transfers ownership of the row, and `owner_all` is written against exactly
-- that column. But it means `user_id` answers "who owns this note", and answers
-- it on every row, forever. Josefine editing Bastian's shared note leaves
-- `user_id = Bastian`.
--
-- So the UI had no way to say who changed a note last, and — worse — the
-- History panel added in 20260827160000 was already *displaying* that column as
-- the author. It was showing the owner's name against every version, including
-- versions the owner did not write. Confidently wrong, which is the bad kind.
--
-- ─── Server-stamped, never client-supplied ───────────────────────────────────
-- `updated_by` is set from auth.uid() by a trigger, for the same reason
-- force_owner exists: a column a client fills in is a column a client can get
-- wrong, and on a shared note "who wrote this" is exactly the claim that must
-- not be forgeable by the person making it.
--
-- A SEPARATE trigger rather than an extra line inside force_owner(): that
-- function's contract is "ownership follows the node", and ownership and
-- authorship are now different questions. Both are BEFORE triggers touching
-- different columns, so their firing order does not matter.
--
-- ─── Ordering ────────────────────────────────────────────────────────────────
-- Purely additive. Nullable with no backfill and no default, deliberately:
-- every row written before this migration has an author nobody recorded, and
-- NULL says that honestly. Filling it with `user_id` would manufacture exactly
-- the false attribution this file exists to remove. Clients render NULL as
-- "unknown", never as the owner.
--
-- APPLIED 2026-08-27 to efxmzsdisaymtpebaxlp.

-- ── 1. The columns ───────────────────────────────────────────────────────────

alter table vault_content            add column if not exists updated_by text;
alter table vault_journals           add column if not exists updated_by text;
alter table vault_content_versions   add column if not exists updated_by text;

-- ── 2. Stamping ──────────────────────────────────────────────────────────────
-- SECURITY INVOKER (the default) is important here and is the opposite of the
-- choice made for the snapshot trigger: auth.uid() must resolve against the
-- CALLER's JWT. Under SECURITY DEFINER it still would on Supabase — the claim
-- lives in a request setting, not in the session role — but relying on that is
-- relying on an implementation detail for a value whose whole purpose is to be
-- attributable.
--
-- coalesce, not a bare assignment: a write with no JWT (a service-role job, a
-- future edge function) leaves whatever was there rather than stamping NULL
-- over a known author.

create or replace function vault_stamp_updated_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  NEW.updated_by := coalesce((select auth.uid())::text, NEW.updated_by);
  return NEW;
end $$;

drop trigger if exists vault_content_stamp_updated_by_trg on vault_content;
create trigger vault_content_stamp_updated_by_trg
before insert or update on vault_content
for each row execute function vault_stamp_updated_by();

drop trigger if exists vault_journals_stamp_updated_by_trg on vault_journals;
create trigger vault_journals_stamp_updated_by_trg
before insert or update on vault_journals
for each row execute function vault_stamp_updated_by();

-- ── 3. Carry the author into the history ─────────────────────────────────────
-- Same body as 20260827160000's trigger, plus updated_by. Restated in full
-- rather than patched, because `create or replace function` replaces the whole
-- definition and a reader comparing the two files should see one complete
-- version of each rather than have to assemble the current one in their head.

create or replace function vault_content_snapshot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if OLD.data is null or OLD.data = '' or NEW.data is not distinct from OLD.data then
    return NEW;
  end if;

  -- Above lib/api.ts MAX_CONTENT_BYTES (2 MB): the client refuses to write it,
  -- so it is frozen, and versioning something nothing can change is pure cost.
  if octet_length(OLD.data) > 2000000 then
    return NEW;
  end if;

  -- One snapshot per node per five minutes of activity.
  if exists (
    select 1 from vault_content_versions v
    where v.node_id = OLD.node_id
      and v.created_at > now() - interval '5 minutes'
  ) then
    return NEW;
  end if;

  -- user_id stays the OWNER (that is what it means on vault_content, and the
  -- versions table's own policies are written against it); updated_by is the
  -- author, and is what the panel displays.
  insert into vault_content_versions (node_id, data, user_id, updated_by, origin)
  values (OLD.node_id, OLD.data, coalesce(OLD.user_id, ''), OLD.updated_by, 'autosave');

  return NEW;
end $$;
