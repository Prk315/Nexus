-- Vault-only custom field values on PathFinder tasks.
--
-- The sibling of vault_task_tags (20260827140000), and it makes the same three
-- choices for the same reasons — read that file's header first; this one only
-- records what differs.
--
-- ── The value is TEXT, and the TYPE is not stored here ──────────────────────
--
-- A column's type ("this is a number", "this is a checkbox") lives in the
-- BLOCK SPEC, in the note, not in this table. That is deliberate:
--
--  * The type is a property of the COLUMN, not of the value. Two notes can
--    show the same key — `budget` — one as a number and one as free text, and
--    neither is wrong. A typed column here would have to pick a winner.
--
--  * It makes the type a LENS rather than a constraint, so changing a column
--    from number to text and back never destroys a value. A typed column would
--    reject or truncate on the way in, and the user would discover it after
--    the fact.
--
--  * There is nothing to migrate when a type changes. A `value_number` /
--    `value_text` pair would need a data migration per type change, on a table
--    the client cannot lock.
--
-- The cost is that this table cannot enforce or index by type, and that the
-- client coerces on read. Both are fine: a person's custom fields are tens of
-- rows, not millions, and coercion is where the "empty means null, not zero"
-- rule belongs anyway.
--
-- ── Per person, like tags ───────────────────────────────────────────────────
-- Keyed by (user_id, task_id, key). pf_tasks carries a `team_all` policy, so a
-- teammate's shared task is legitimately writable by both of you — but a custom
-- field is a private annotation, so two people annotating the same shared task
-- get two independent sets. That falls out of the primary key rather than
-- needing a rule.
--
-- Additive in every direction. A Vault build that runs before this is applied
-- degrades to "custom fields unavailable" rather than failing the block — see
-- lib/vaultTaskFields.ts, which treats a missing table as a state of its own.
--
-- APPLIED 2026-08-28 to efxmzsdisaymtpebaxlp.

-- `auth.uid()::text` without the `select` wrapper: a column DEFAULT cannot
-- contain a subquery — Postgres rejects the CREATE TABLE outright. The wrapper
-- is only an RLS optimisation, and it is used in the policy below.
create table if not exists vault_task_fields (
  user_id    text        not null default auth.uid()::text,
  task_id    bigint      not null references pf_tasks (id) on delete cascade,
  -- The column key, as the block spec names it. Normalised client-side the same
  -- way tags are: a key that differs only by case would be a second column that
  -- looks like the first.
  key        text        not null,
  -- Everything, as text. See the header.
  value      text        not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, task_id, key)
);

-- "Every value this person has for this key", which is what a column read wants.
-- The PK already covers "every field on this task" from the left.
create index if not exists vault_task_fields_user_key_idx on vault_task_fields (user_id, key);
-- Supports the FK's cascade delete without a sequential scan.
create index if not exists vault_task_fields_task_idx on vault_task_fields (task_id);

alter table vault_task_fields enable row level security;

-- No anon policy at all, same posture as vault_task_tags and usage_intervals:
-- the anon key is committed and the repo is public, and these values annotate a
-- private task list. Vault reads this with its session client.
drop policy if exists owner_all on vault_task_fields;
create policy owner_all on vault_task_fields
  for all
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

-- Renaming a column in a note should carry its values across, and doing it
-- client-side is N round trips that are not atomic — a rename failing halfway
-- leaves the values split between two keys. Same reasoning as
-- vault_rename_task_tag.
--
-- `security invoker` (the default) is load-bearing: a security definer function
-- here would bypass the policy above and let any caller rewrite anyone's values.
create or replace function vault_rename_task_field(p_old text, p_new text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  if p_old is null or p_new is null or btrim(p_new) = '' or p_old = p_new then
    return 0;
  end if;
  -- A row already under the new key wins: the target column is the one the user
  -- is looking at, and silently overwriting it with the old column's value
  -- would be a data loss disguised as a rename.
  delete from vault_task_fields old
  where old.key = p_old
    and exists (
      select 1 from vault_task_fields cur
      where cur.user_id = old.user_id and cur.task_id = old.task_id and cur.key = p_new
    );
  update vault_task_fields set key = p_new, updated_at = now() where key = p_old;
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function vault_delete_task_field(p_key text)
returns integer
language plpgsql
set search_path = public
as $$
declare
  n integer;
begin
  delete from vault_task_fields where key = p_key;
  get diagnostics n = row_count;
  return n;
end $$;
