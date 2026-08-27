-- Vault-only tags on PathFinder tasks.
--
-- The point of this table is what it is NOT: it is not a column on pf_tasks.
-- These tags exist so a note can slice PathFinder's tasks by a vocabulary that
-- means something in Vault — "reading", "chapter-3", "ask Josefine" — without
-- that vocabulary appearing in PathFinder, in its widgets, or in anybody else's
-- copy of a shared task. Adding a `tags text[]` column to pf_tasks would have
-- been fewer lines and would have leaked all three.
--
-- ── Three deliberate choices ────────────────────────────────────────────────
--
--  1. **Keyed by (user_id, task_id, tag), so tags are PER PERSON.** pf_tasks
--     carries a `team_all` policy — a teammate's shared task is legitimately
--     readable and writable by both of you. A tag is a private annotation, so
--     two people tagging the same shared task get two independent sets, and
--     neither sees the other's. That falls out of the primary key rather than
--     needing a rule.
--
--  2. **`user_id` is TEXT, not uuid, and the policy casts.** Verified live on
--     2026-08-27 against efxmzsdisaymtpebaxlp: every pf_* and vault_* table
--     stores user_id as text and its `owner_all` policy reads
--     `user_id = (select auth.uid())::text`. Declaring uuid here would compare
--     cleanly in isolation and then fail to join against anything.
--
--  3. **No anon policy at all.** Same posture as `usage_intervals` and
--     `mail_messages`, and the opposite of the thirteen permissive productivity
--     tables in SECURITY_RLS_MIGRATION.md. The anon key is committed and the
--     repo is public; pf_tasks itself is auth.uid()-scoped, so a tag table
--     readable by anon would publish the shape of a private task list. Vault
--     reads this with its session client (`supabase`), which already has a JWT.
--
-- ⚠️ The FK is `on delete cascade` on purpose. Deleting a task in PathFinder
-- must not leave tags pointing at an id that will later be reused by a new
-- task — bigint identity columns do not reuse ids today, but an orphan row that
-- silently reattaches is not a failure mode worth leaving open. Cascade is also
-- the only cleanup path: PathFinder knows nothing about this table and will
-- never delete from it.
--
-- Additive in every direction: no deployed code reads or writes it, so applying
-- this before or after any Vault build is safe. A Vault build that runs BEFORE
-- it is applied degrades to "tags unavailable" rather than failing the whole
-- block — see lib/vaultTaskTags.ts, which treats a missing table as a state of
-- its own rather than letting the read reject the task snapshot with it.

-- `auth.uid()::text` and not `(select auth.uid())::text`: the `select` wrapper is
-- the RLS-policy optimisation (it makes the call a one-time InitPlan instead of
-- per-row), and a column DEFAULT cannot contain a subquery at all — Postgres
-- rejects the CREATE TABLE outright.
create table if not exists vault_task_tags (
  user_id    text        not null default auth.uid()::text,
  task_id    bigint      not null references pf_tasks (id) on delete cascade,
  tag        text        not null,
  created_at timestamptz not null default now(),
  primary key (user_id, task_id, tag)
);

-- "Which tasks carry this tag" — the filter's hot path. The PK already covers
-- "which tags does this task carry" from the left.
create index if not exists vault_task_tags_user_tag_idx on vault_task_tags (user_id, tag);
-- Supports the FK's cascade delete without a sequential scan.
create index if not exists vault_task_tags_task_idx on vault_task_tags (task_id);

alter table vault_task_tags enable row level security;

drop policy if exists owner_all on vault_task_tags;
create policy owner_all on vault_task_tags
  for all
  using (user_id = (select auth.uid())::text)
  with check (user_id = (select auth.uid())::text);

-- ── Bulk tag operations ─────────────────────────────────────────────────────
--
-- Renaming a tag across a few hundred rows is one statement here and N round
-- trips from the client, and the client version is not atomic: a rename that
-- fails halfway leaves the tag existing under both names. `vault_rename_tag`
-- and `vault_delete_tag` already exist for note tags for exactly this reason;
-- these are their task-tag siblings.
--
-- `security invoker` (the default) is load-bearing — a `security definer`
-- function here would bypass the RLS policy above and let any caller rewrite
-- anyone's tags. It is stated explicitly so nobody "fixes" it later.

create or replace function vault_rename_task_tag(p_old text, p_new text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  if p_new is null or btrim(p_new) = '' then
    raise exception 'vault_rename_task_tag: new tag must not be blank';
  end if;

  -- Merge rather than collide: a task already carrying both names ends with
  -- one row, not a primary-key violation that aborts the whole rename.
  delete from vault_task_tags t
   where t.user_id = (select auth.uid())::text
     and t.tag = p_old
     and exists (
       select 1 from vault_task_tags e
        where e.user_id = t.user_id and e.task_id = t.task_id and e.tag = p_new
     );

  update vault_task_tags
     set tag = p_new
   where user_id = (select auth.uid())::text
     and tag = p_old;

  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function vault_delete_task_tag(p_tag text)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  n integer;
begin
  delete from vault_task_tags
   where user_id = (select auth.uid())::text
     and tag = p_tag;
  get diagnostics n = row_count;
  return n;
end;
$$;
