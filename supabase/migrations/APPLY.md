# Applying the productivity-stack migrations

These files are **not applied by the code that wrote them**. The NEXUS project
(`efxmzsdisaymtpebaxlp`, `eu-north-1`) is live, shared, and the only copy — there
is no staging database. Apply them yourself, in order, and run the verification
query after each.

## Files, in order

| # | File | Adds |
|---|------|------|
| 1 | `20260805120000_blocking_state.sql` | `blocking_state` table (no seed row — see below) |
| 2 | `20260805120100_pomodoro_config.sql` | `pomodoro_config` table + seed `'default'` row |
| 3 | `20260805120200_schedule_block_targets.sql` | `schedule_block_apps`, `schedule_block_sites` |
| 4 | `20260805120300_unlock_rules_enabled_and_evaluator_indexes.sql` | `unlock_rules.enabled` + three evaluator indexes |

Files 1–3 are independent of each other and of file 4. File 4 has an **internal**
ordering requirement (the `ALTER` must precede the index that uses the new
column); both statements are in that one file in the right order, so applying the
file as a whole is always correct.

File 3 requires `focus_blocks` to already exist — it does, live since the
TimeTracker era.

Every file is forward-only and re-runnable: `CREATE TABLE IF NOT EXISTS`,
`CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `INSERT … ON CONFLICT
DO NOTHING`, and `DROP POLICY IF EXISTS` before each `CREATE POLICY` (Postgres
has no `CREATE POLICY IF NOT EXISTS`). Re-applying the whole batch is harmless.

## Option A — Supabase CLI

```bash
cd /Users/bastianthomsen/Repositories/Nexus
supabase link --project-ref efxmzsdisaymtpebaxlp
supabase db push
```

`db push` applies every file in `supabase/migrations/` that is not yet recorded
in `supabase_migrations.schema_migrations`, in filename order. To preview first:

```bash
supabase db push --dry-run
```

## Option B — Dashboard SQL editor

Supabase dashboard → project `efxmzsdisaymtpebaxlp` → SQL Editor → New query.
Paste **one file at a time**, in the numbered order above, and run it. Confirm
each with its verification query before moving on.

## Verification

Run each after applying the corresponding file.

### 1. `blocking_state`

```sql
select * from public.blocking_state;
```

Expect **0 rows** — deliberate. `focus-evaluate` creates the `'default'` row on
its first run. A missing row means "no verdict has ever been computed", which is
genuinely different from "computed, nothing is blocked"; seeding zeros would
collapse the two and hand clients a `computed_at` that looks fresh. Clients must
treat a missing row as "no verdict yet" and block nothing.

Confirm the table shape instead:

```sql
select column_name, data_type, column_default, is_nullable
from   information_schema.columns
where  table_schema = 'public' and table_name = 'blocking_state'
order  by ordinal_position;
```

Expect `user_id text 'default'::text NO`, `effective_domains jsonb '[]'::jsonb
NO`, `effective_processes jsonb '[]'::jsonb NO`, `reasons jsonb '{}'::jsonb NO`,
`today_minutes integer 0 NO`, `computed_at timestamptz now() NO`.

### 2. `pomodoro_config`

```sql
select * from public.pomodoro_config;
```

Expect one row: `default / false / 25 / 5 / 15 / 4`.

### 3. `schedule_block_apps` and `schedule_block_sites`

```sql
select * from public.schedule_block_apps;
select * from public.schedule_block_sites;
```

Both empty (0 rows) — correct; nothing writes them until work unit 6. Confirm the
tables and their upsert targets exist:

```sql
select c.relname as tbl, con.conname, pg_get_constraintdef(con.oid) as def
from   pg_constraint con
join   pg_class     c on c.oid = con.conrelid
join   pg_namespace n on n.oid = c.relnamespace
where  n.nspname = 'public'
  and  c.relname in ('schedule_block_apps', 'schedule_block_sites')
order  by 1, 2;
```

Expect, per table: a `PRIMARY KEY (id)`, a `UNIQUE (block_id, process_name)`
(resp. `UNIQUE (block_id, domain)`), and a
`FOREIGN KEY (block_id) REFERENCES focus_blocks(id) ON DELETE CASCADE`.

### 4. `unlock_rules.enabled` + indexes

`select *` will not obviously show a new column on an empty-ish table, so check
the catalog:

```sql
select column_name, data_type, column_default, is_nullable
from   information_schema.columns
where  table_schema = 'public'
  and  table_name   = 'unlock_rules'
  and  column_name  = 'enabled';
```

Expect one row: `enabled / boolean / true / NO`. Then confirm existing rows were
backfilled to enabled:

```sql
select enabled, count(*) from public.unlock_rules group by enabled;
```

And the three indexes:

```sql
select tablename, indexname
from   pg_indexes
where  schemaname = 'public'
  and  indexname in (
         'time_entries_user_id_start_time_idx',
         'focus_blocks_user_id_enabled_idx',
         'unlock_rules_user_id_enabled_idx',
         'schedule_block_apps_block_id_idx',
         'schedule_block_sites_block_id_idx'
       )
order  by 1, 2;
```

Expect all five (the last two land with file 3).

### RLS, all new tables

```sql
select tablename, rowsecurity from pg_tables
where  schemaname = 'public'
  and  tablename in ('blocking_state','pomodoro_config',
                     'schedule_block_apps','schedule_block_sites');

select tablename, policyname, roles::text, cmd, qual, with_check
from   pg_policies
where  schemaname = 'public'
  and  tablename in ('blocking_state','pomodoro_config',
                     'schedule_block_apps','schedule_block_sites')
order  by tablename;
```

Expect `rowsecurity = true` on all four, and one `"anon full access"` policy each
— `{anon}`, `ALL`, `qual = true`, `with_check = true`.

This permissive posture is deliberate and matches every existing table in the
productivity stack. Every current client writes `user_id = 'default'` with the
anon key and no JWT; tightening to `auth.uid()` now breaks all of them. Tighten
when ecosystem auth reaches these tables — not before.

## Upsert targets (state these in client code)

PostgREST defaults `on_conflict` to the primary key, and the real unique
violation then surfaces as an opaque HTTP 409. Writers must send:

| Table | `on_conflict=` |
|-------|----------------|
| `blocking_state` | `user_id` |
| `pomodoro_config` | `user_id` |
| `schedule_block_apps` | `block_id,process_name` |
| `schedule_block_sites` | `block_id,domain` |

## After applying

The `focus-evaluate` edge function is a separate deploy and is **not** created by
these migrations:

```bash
supabase functions deploy focus-evaluate --project-ref efxmzsdisaymtpebaxlp
```

Its pg_cron schedule is likewise not created here — see work unit 8.

## Rollback

Forward-only by policy. If you must undo, do it by hand and note that dropping
`blocking_state` loses the current verdict (the next `focus-evaluate` run
rebuilds it), dropping `pomodoro_config` loses the user's durations, and dropping
`schedule_block_apps` / `schedule_block_sites` loses every focus-block payload
with no way to rebuild it:

```sql
-- destructive; only with intent
drop table if exists public.schedule_block_apps;
drop table if exists public.schedule_block_sites;
drop table if exists public.pomodoro_config;
drop table if exists public.blocking_state;
drop index if exists public.unlock_rules_user_id_enabled_idx;
alter table public.unlock_rules drop column if exists enabled;
drop index if exists public.focus_blocks_user_id_enabled_idx;
drop index if exists public.time_entries_user_id_start_time_idx;
```
