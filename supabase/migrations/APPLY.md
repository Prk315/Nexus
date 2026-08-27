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
| 5 | `20260823120000_n8n_mail_bus.sql` | `mail_messages`, `n8n_requests` — **apply before deploying `n8n-ingest` / `n8n-requests`, or both 500 on every call** |
| 6 | `20260824120000_job_pipeline.sql` | `job_profiles`, `job_sources`, `job_postings`, `job_matches` — **apply before deploying `job-ingest`, or it 500s on every call** |
| 7 | `20260825120000_job_evaluation.sql` | `job_app_modules`, `job_applications`, `job_matches.module_plan` — **apply before deploying `job-ingest` v4** |
| 8 | `20260826120000_job_apply.sql` | `job_profiles.approval_threshold`, nine approval/submission columns on `job_applications`, `job_submission_attempts` — **apply before deploying `job-ingest` v5 / `job-approve`** |
| 9 | `20260827120000_vault_live_coedit.sql` | `vault_ydoc`, `vault_can_coedit()`, two `realtime.messages` policies — **apply before deploying any Vault build that reads `vault_ydoc`, and see §9 for the two manual steps that are not SQL** |
| 10 | `20260827140000_vault_task_tags.sql` | `vault_task_tags` + `vault_rename_task_tag()` / `vault_delete_task_tag()` — **already applied live on 2026-08-27**; see §10 |
| 11 | `20260827160000_vault_content_versions.sql` | `vault_content_versions` + a snapshot trigger on `vault_content` and a byte-budgeted retention trigger — Vault's note history. **Already applied live on 2026-08-27**; the only file here that adds a trigger to an existing hot write path — see §11 |
| 12 | `20260827180000_vault_updated_by.sql` | `updated_by` on `vault_content` / `vault_journals` / `vault_content_versions`, stamped from `auth.uid()` — who actually wrote a document last. **Already applied live on 2026-08-27**; see §12 |

⚠️ **File 10 is the one exception to "not applied by the code that wrote it"** —
it was applied to `efxmzsdisaymtpebaxlp` at the time it was written, and the file
is committed so `supabase db push` and a future rebuild stay in step. It is
re-runnable like every other file here, so applying it again is harmless.

Unlike files 5–9, it has **no deploy-ordering requirement in either direction**.
Nothing on `main` reads or writes `vault_task_tags`, and the Vault build that
does treats a missing table as "tags unavailable" rather than an error — see
`apps/Vault/Vault/src/lib/vaultTaskTags.ts`. A build shipped before the migration
loses its tag controls and keeps every other part of a task block working.

Files 1–3 are independent of each other and of file 4. File 4 has an **internal**
ordering requirement (the `ALTER` must precede the index that uses the new
column); both statements are in that one file in the right order, so applying the
file as a whole is always correct.

File 3 requires `focus_blocks` to already exist — it does, live since the
TimeTracker era.

File 5 is not part of the productivity stack — it is the mail bus behind
`NexusHeader`'s mail panel (see CLAUDE.md, "Mail triage: n8n on the Mac, Supabase
as the bus"). It depends on nothing in files 1–4 and can be applied on its own.
Its RLS posture is deliberately the **opposite** of theirs; verify it with §5
below, not with the "RLS, all new tables" section.

File 6 is the job applier's ingestion tables (see `JOB_APPLIER_PLAN.md` and
`n8n/job-applier/README.md`). Like file 5 it depends on nothing in files 1–4 and
can be applied on its own, and like file 5 its RLS is `auth.uid()`-scoped with no
anon policy — verify it the same way, not with the "RLS, all new tables" section.
It seeds **nothing**: `job_profiles` and `job_sources` are user-scoped and a
migration has no session to attribute rows to, so the first profile is inserted by
hand or by the panel.

Files 7 and 8 are the job applier's later phases and **must follow file 6**, in
order — 7 adds `job_applications`, and 8 adds columns to it. Both are additive, so
the LIVE `job-ingest` keeps working unchanged between applying them and deploying
the function that uses them; that window is deliberate and is why file 8's
`approval_token` is `NOT NULL DEFAULT gen_random_uuid()` rather than backfilled
(a draft written by the old code during the window is still reviewable).

⚠️ **File 8 has an ordering requirement in the other direction too.** Apply it
BEFORE deploying `job-ingest` v5 or `job-approve` — both query columns that do
not exist until it lands, and PostgREST answers a missing column with an error,
so every `notify_queue` and every review link fails. Nothing is at risk of being
*sent* early: `apply_queue` reads `status = 'approved'`, and no row can reach that
status until a human has clicked through `job-approve`.

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

### 5. `mail_messages` and `n8n_requests`

```sql
select * from public.mail_messages;
select * from public.n8n_requests;
```

Expect **0 rows in both** — deliberate, and for the same reason `blocking_state`
has no seed row. An empty `mail_messages` must be readable as "n8n has never
run", which is not the same fact as "the inbox is clean"; last-synced is read
from the newest `n8n_requests` row with `kind = 'mail_sync'` and
`status = 'done'`, never from a row count.

Confirm the shapes and the upsert target instead:

```sql
select table_name, column_name, data_type, is_nullable
from   information_schema.columns
where  table_schema = 'public'
  and  table_name in ('mail_messages', 'n8n_requests')
order  by table_name, ordinal_position;
```

Expect `user_id` to be **`uuid NO`** on both — not the legacy `text default
'default'` the productivity tables use — and `priority`, `category`,
`suggested_reply`, `triaged_at` on `mail_messages` all **nullable** (`YES`).
NULL means "not yet triaged", which the panel sorts to the top; a `not null
default 0` would bury un-triaged mail at the bottom.

```sql
select indexname, indexdef
from   pg_indexes
where  schemaname = 'public'
  and  tablename in ('mail_messages', 'n8n_requests')
order  by 1;
```

Expect `mail_messages_user_external` to be **UNIQUE and not partial** — it is the
`on_conflict` target for the ingest upsert, and PostgREST cannot infer a partial
index, which surfaces at runtime as an opaque 409 on every write rather than at
deploy time. `n8n_requests_queued` *is* partial, and safely so: nothing upserts
onto that table.

RLS — note this is the inverse of every table above:

```sql
select tablename, rowsecurity from pg_tables
where  schemaname = 'public'
  and  tablename in ('mail_messages', 'n8n_requests');

select tablename, policyname, roles::text, cmd, qual, with_check
from   pg_policies
where  schemaname = 'public'
  and  tablename in ('mail_messages', 'n8n_requests')
order  by tablename;
```

Expect `rowsecurity = true` on both and exactly **one** policy each —
`{authenticated}`, `ALL`, `qual = with_check = (user_id = auth.uid())`. **A row
with `{anon}` in `roles` is a bug**, not a convenience: these tables hold
senders, subjects, body snippets and draft replies, and the anon key is
committed in a public repo. The omission is the security model — same reasoning
as `usage_intervals`. Writes get in via the service-role client inside the edge
functions, which bypasses RLS by design.

### RLS, all new tables (files 1–4 only)

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
| `mail_messages` | `user_id,external_id` |

## After applying

The `focus-evaluate` edge function is a separate deploy and is **not** created by
these migrations:

```bash
supabase functions deploy focus-evaluate --project-ref efxmzsdisaymtpebaxlp
```

Its pg_cron schedule is likewise not created here — see work unit 8.

Likewise for file 5's two functions, which will 500 on every call until the
migration is applied:

```bash
supabase functions deploy n8n-ingest   --project-ref efxmzsdisaymtpebaxlp
supabase functions deploy n8n-requests --project-ref efxmzsdisaymtpebaxlp
```

Each needs its own scoped secret set separately (`npx supabase secrets set`) —
n8n has no Supabase session and cannot satisfy `auth.uid()`, exactly like the
Rust daemon and `usage-ingest`. Never put a key in the repo; it is public.

## Rollback

Forward-only by policy. If you must undo, do it by hand and note that dropping
`blocking_state` loses the current verdict (the next `focus-evaluate` run
rebuilds it), dropping `pomodoro_config` loses the user's durations, and dropping
`schedule_block_apps` / `schedule_block_sites` loses every focus-block payload
with no way to rebuild it.

Dropping `mail_messages` loses the triage history and the `raw` Gmail payloads a
re-triage would have replayed; dropping `n8n_requests` loses both the queued work
and the only "last synced" signal. And both are read by deployed code the moment
the header ships — **stop reading it → merge → deploy → then drop**, per the
`pf_reminders` incident in CLAUDE.md.

```sql
-- destructive; only with intent
drop table if exists public.n8n_requests;
drop table if exists public.mail_messages;
drop function if exists public.mail_messages_touch();
drop table if exists public.schedule_block_apps;
drop table if exists public.schedule_block_sites;
drop table if exists public.pomodoro_config;
drop table if exists public.blocking_state;
drop index if exists public.unlock_rules_user_id_enabled_idx;
alter table public.unlock_rules drop column if exists enabled;
drop index if exists public.focus_blocks_user_id_enabled_idx;
drop index if exists public.time_entries_user_id_start_time_idx;
```


## §9 — Vault live co-editing (`20260827120000_vault_live_coedit.sql`)

File 9 adds live collaborative editing for **shared Vault notes**: a Yjs CRDT
document per note (`vault_ydoc`), synced peer-to-peer over a private Supabase
Realtime broadcast channel. It builds on `20260826150000_vault_teams.sql` and
depends on nothing in files 1–8.

**Two of the four steps are not SQL, and skipping either one is silent.**

### 1. Apply the migration

Before any Vault build that reads `vault_ydoc` ships. PostgREST answers a missing
table with an error rather than an empty result, so an un-migrated database turns
every shared-note open into a hard failure — the same ordering trap as
`job-ingest` v5 above.

### 2. ⚠️ Turn OFF "Allow public access"

Dashboard → Project Settings → **Realtime → Settings** → *Allow public access* → **off**.

**The RLS policies in section 3 of the migration do nothing until this is done.**
Realtime routes broadcast by *topic*, and `private: true` is a per-client join
flag — a client that joins `vault:doc:<uuid>` without it never has those policies
evaluated and receives every document delta anyway. The anon key is committed in
this repo and the repo is public, so that is not a theoretical attacker.

Verified 2026-08-27: there is not one `.channel(` call site anywhere else in this
monorepo and no `supabase_realtime` publication, so turning it off project-wide
breaks nothing.

### 3. Verify

```sql
-- Expect exactly 4 policies, and no team DELETE policy: only owner_all (ALL)
-- may delete. A team DELETE policy here is a bug, not a convenience — deleting
-- the row while a teammate is editing resets the note to whatever
-- vault_content last projected.
select policyname, roles::text, cmd from pg_policies
where schemaname = 'public' and tablename = 'vault_ydoc' order by policyname;

-- Expect exactly 2, both {authenticated}. Zero means every private channel
-- denies and co-editing silently never connects.
select policyname, roles::text, cmd from pg_policies
where schemaname = 'realtime' and tablename = 'messages' order by policyname;

-- Must be 0 before the writer is enabled anywhere (step 4). Non-zero means a
-- client is already writing CRDT state, and the guard rollout below is moot.
select count(*) from public.vault_ydoc;

-- Fail-closed on nonsense input rather than erroring.
select public.vault_can_coedit('does-not-exist');   -- false
```

### 4. Roll the clients out in two phases, in opposite orders

The vector this guards against: a Vault build that does not know about
`vault_ydoc` opens a co-edited note, reads the `vault_content` projection (which
the co-editing clients keep freshly written, so it looks perfectly healthy),
edits it and saves the whole document. The CRDT never sees the edit, the next
projection flush overwrites it, and `vault_content` keeps no history.

**Phase 0 — the guard.** `saveContent` refuses to write a note that has a
`vault_ydoc` row, showing *"this note is being co-edited; update Vault to edit
it"*. Ship it with `VITE_VAULT_COLLAB` **unset**, so nothing writes CRDT state
yet. Order: **iOS → Mac → web.** Counter-intuitive, but the iPad installs over a
cable on ~7-day certificates and is the client most likely to still be old, so it
needs the guard earliest; Vercel is instant and can always catch up.

**Phase 1 — the writer.** Set `VITE_VAULT_COLLAB=1` and redeploy. Order:
**web → Mac → iOS** — the reverse — because web is the one that rolls back in a
minute.

Do not start Phase 1 until steps 1–3 are done and Phase 0 is confirmed live on
all three targets.

**Rollback:** unset `VITE_VAULT_COLLAB` and redeploy. Clients revert to the
guarded save path, and existing `vault_ydoc` rows make those notes read-only —
loud and safe rather than silently lossy. A full revert is
`delete from public.vault_ydoc` with nobody editing; `vault_content` is current
to within about two seconds and becomes the truth again.

### Rolling back the schema

`vault_ydoc` holds the live document for any note being co-edited. Dropping it
while `VITE_VAULT_COLLAB` is on loses every edit made since the last projection
write (up to ~2 s), and re-seeds from `vault_content` on the next open. Turn the
flag off first.

```sql
-- destructive; only with intent, and only with the writer disabled
drop policy if exists vault_doc_broadcast_read on realtime.messages;
drop policy if exists vault_doc_broadcast_write on realtime.messages;
drop table if exists public.vault_ydoc;
drop function if exists public.vault_can_coedit(text);
```

---

## §10 — Vault task tags (`20260827140000_vault_task_tags.sql`)

Vault-only tags on PathFinder tasks. Applied live on 2026-08-27; recorded here
so the file is not mistaken for pending work.

### Verify

```sql
-- RLS on, exactly one owner-scoped policy, and NO anon policy.
select c.relrowsecurity as rls_on, p.policyname, p.cmd, p.roles::text, p.qual
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policies p on p.schemaname = 'public' and p.tablename = c.relname
 where n.nspname = 'public' and c.relname = 'vault_task_tags';
```

Expect one row: `rls_on = t`, `owner_all`, `ALL`, `{public}`,
`(user_id = ((select auth.uid()))::text)`. **More than one row means someone
added an anon policy** — this table holds the shape of a private task list and
the anon key is committed. Remove it rather than working around it.

```sql
-- The FK must cascade: PathFinder knows nothing about this table and will never
-- clean up after itself, so a deleted task would otherwise leave orphan tags.
select pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'vault_task_tags'::regclass and contype = 'f';
```

Expect `FOREIGN KEY (task_id) REFERENCES pf_tasks(id) ON DELETE CASCADE`.

### Two things to know

- **`user_id` is TEXT, not uuid.** Every `pf_*` and `vault_*` table stores it as
  text with an `(select auth.uid())::text` policy; declaring uuid here would
  compare cleanly in isolation and fail to join against anything.
- **Both RPCs are `security invoker`**, stated explicitly in the file. A
  `security definer` function here would bypass the policy above and let any
  caller rewrite anyone's tags. Do not "optimise" it.

### Rollback

Nothing on `main` reads this, so dropping it is safe at any time — it costs the
tags themselves, which exist nowhere else.

```sql
drop function if exists public.vault_rename_task_tag(text, text);
drop function if exists public.vault_delete_task_tag(text);
drop table if exists public.vault_task_tags;
```

---

## §11 — Vault note history (`20260827160000_vault_content_versions.sql`)

Gives `vault_content` the history it has never had, and gives a sync conflict a
second exit. Depends on `20260826150000_vault_teams.sql` (for
`pf_is_team_member`); independent of files 9 and 10.

**Applied and verified live on 2026-08-27.** Like file 10, recorded here so it is
not mistaken for pending work.

### Ordering — genuinely relaxed, unlike files 5–9

Either order is safe, and it is worth saying why because most entries above say
the opposite. The History panel is the only reader, and it catches the missing
table and renders *"History is unavailable"* naming the file — visible, scoped to
a panel, and touching no save path. In the other direction the trigger records
history for clients that know nothing about it, which is strictly what you want.

### ⚠️ The only trigger this repo puts on a hot write path

`vault_content` is rewritten on a 400 ms debounce by every open editor, and every
2 s by *both* clients of a co-edited note, so the `BEFORE UPDATE` trigger runs
thousands of times a day. Three properties keep that cheap, and all three are
load-bearing:

* It returns early on `NEW.data is not distinct from OLD.data` — a no-op write
  costs one comparison.
* It skips documents over 2 MB, the app's own `MAX_CONTENT_BYTES`. Those are
  frozen: the client refuses to write them at all.
* The five-minute gate is an `EXISTS` covered exactly by
  `vault_content_versions_node_idx`. Without that index it would be a sequential
  scan of every version of every note on every keystroke.

**If note saving ever becomes slow, that index is the first thing to check.**

### Retention is byte-budgeted, and the live data is why

A plain "keep the newest 40" is the obvious rule and it was wrong here. Measured
on this database before applying, against a 96 MB total:

| rows | size band | 40 versions each |
|---|---|---|
| 87 | under 10 kB | ≈ 3.8 MB |
| 16 | 10–100 kB | ≈ 20 MB |
| 4 | 100 kB – 2 MB | ≈ 94 MB |
| 3 | over the 2 MB app cap (frozen Canvases) | ≈ 791 MB |

No single count serves a distribution that wide, and one low enough for the 2 MB
documents would leave the 5 kB notes — the ones edited all day, and the ones the
feature is for — with almost no history. So the prune keeps the newest entries
while their cumulative `byte_len` stays under **8 MB per node**, capped at 40 and
floored at 2. The floor matters: without it a document bigger than the whole
budget would prune away the snapshot just taken.

### Verify

```sql
-- Expect exactly 3: owner_all (ALL), team_shared_insert, team_shared_select.
-- NO update policy for anyone — a version is a fact about what the document once
-- was, and an editable history is not a history. No team DELETE either: a
-- teammate must not be able to erase the evidence of an overwrite.
select policyname, roles::text, cmd from pg_policies
where schemaname = 'public' and tablename = 'vault_content_versions'
order by policyname;

-- Expect vault_content_snapshot_trg (alongside the pre-existing
-- vault_content_force_owner_trg) and vault_content_versions_prune_trg.
select tgrelid::regclass::text, tgname from pg_trigger
where tgrelid in ('public.vault_content'::regclass,
                  'public.vault_content_versions'::regclass)
  and not tgisinternal
order by 1, 2;
```

Behaviour was verified end to end against a scratch node, which was then removed:
a real change snapshots the PREVIOUS document; a second change within five
minutes does not; a no-op write does not; a 3 MB → 3 MB change is skipped; six
2 MB entries prune to four (7813 kB, under the 8 MB budget); and a single 10 MB
entry survives on the floor of 2.

### A note on the security advisor

`get_advisors` flags `vault_content_snapshot()` and
`vault_content_versions_prune()` under *"Public Can Execute SECURITY DEFINER
Function"*. It is a **false positive for trigger functions**, and it already
fires for eight pre-existing ones here (`vault_content_force_owner`,
`pf_tasks_sync_subtype`, `pf_task_subtype_guard`, …). Verified rather than
assumed — invoking one directly returns:

```
trigger functions can only be called as triggers
```

Postgres refuses before permissions are even consulted, so there is nothing to
revoke. Do not "fix" it by switching them to `security invoker`: that would
subject the snapshot insert to the versions table's own RLS, and the failure
direction becomes "the write succeeded but nothing was preserved" — exactly what
the table exists to prevent.

### Rolling back

Purely additive; a rollback costs only the history itself.

```sql
-- destructive: this is the history
drop trigger if exists vault_content_snapshot_trg on public.vault_content;
drop trigger if exists vault_content_versions_prune_trg on public.vault_content_versions;
drop function if exists public.vault_content_snapshot();
drop function if exists public.vault_content_versions_prune();
drop table if exists public.vault_content_versions;
```

Dropping only `vault_content_snapshot_trg` is the lighter option if the concern
is write throughput rather than the feature: the panel keeps working and simply
stops gaining new entries.

---

## §12 — Who wrote it last (`20260827180000_vault_updated_by.sql`)

Adds `updated_by` to `vault_content`, `vault_journals` and
`vault_content_versions`. Depends on file 11 (for the versions table) and on
20260826150000_vault_teams (for the trigger it works alongside).

**Applied and verified live on 2026-08-27.**

### The column that looked right and was not

`vault_content.user_id` looks like the author. It is not, and nothing in the
schema said so. `vault_content_force_owner()` — correct, and it must stay —
rewrites it on **every** insert and update:

```sql
NEW.user_id := <owner of the parent vault_nodes row>
```

So it answers "who owns this note", on every row, forever. Josefine editing
Bastian's shared note leaves `user_id = Bastian`.

That is why the History panel shipped in file 11 was displaying the **owner's**
name against every version, including versions the owner did not write —
confidently wrong on exactly the screen you consult to decide whose work to
keep. This file is the fix for that as much as it is a new feature.

### Stamped server-side, never sent by the client

A separate `BEFORE` trigger, not an extra line inside `force_owner()`: that
function's contract is *ownership follows the node*, and ownership and
authorship are now different questions. Both triggers touch different columns,
so their firing order does not matter.

`vault_stamp_updated_by()` is **SECURITY INVOKER** (the default), which is the
opposite of the choice made for the snapshot trigger and is deliberate:
`auth.uid()` must resolve against the caller's JWT. It would on Supabase under
`SECURITY DEFINER` too — the claim lives in a request setting, not the session
role — but relying on that is relying on an implementation detail for a value
whose entire purpose is to be attributable.

It `coalesce`s rather than assigning outright, so a write with no JWT (a
service-role job, a future edge function) leaves a known author alone instead of
stamping NULL over it.

### Nullable, no backfill — on purpose

Every row written before this migration has an author nobody recorded, and NULL
says that honestly. Backfilling from `user_id` would manufacture precisely the
false attribution the file exists to remove. Clients render NULL as
**"unknown author"**, never as the owner.

### Verify

```sql
-- Three columns, all nullable.
select table_name, column_name, is_nullable
from information_schema.columns
where table_schema = 'public' and column_name = 'updated_by'
  and table_name in ('vault_content','vault_journals','vault_content_versions')
order by table_name;

-- Both stamp triggers, alongside the pre-existing force_owner ones.
select tgrelid::regclass::text, tgname from pg_trigger
where tgrelid in ('public.vault_content'::regclass, 'public.vault_journals'::regclass)
  and not tgisinternal
order by 1, 2;
```

End to end, with a simulated JWT — this is the check that matters, because the
service-role connection the dashboard and MCP use has `auth.uid() = NULL` and
would show nothing:

```sql
do $$
declare
  owner  constant text := '<a user id>';
  editor constant text := '<a DIFFERENT user id>';
  got_owner text; got_author text;
begin
  insert into vault_nodes (id, name, kind, tags, user_id)
  values ('zztest-updatedby', 'scratch', '{"type":"Note"}'::jsonb, '{}', owner);

  perform set_config('request.jwt.claims', json_build_object('sub', owner)::text, true);
  insert into vault_content (node_id, data, user_id) values ('zztest-updatedby', 'first', owner);

  perform set_config('request.jwt.claims', json_build_object('sub', editor)::text, true);
  update vault_content set data = 'edited by the teammate' where node_id = 'zztest-updatedby';

  select user_id, updated_by into got_owner, got_author
  from vault_content where node_id = 'zztest-updatedby';

  -- Raising rolls the whole block back, so the scratch rows clean themselves up.
  raise exception 'owner=% author=% owner_ok=% author_ok=%',
    got_owner, got_author, (got_owner = owner), (got_author = editor);
end $$;
```

Expect `owner_ok=t author_ok=t` — the owner unchanged by a teammate's write, and
the author naming the teammate. Both were `t` when this was applied.

### Rolling back

Additive; a rollback costs only the attribution.

```sql
drop trigger if exists vault_content_stamp_updated_by_trg on public.vault_content;
drop trigger if exists vault_journals_stamp_updated_by_trg on public.vault_journals;
drop function if exists public.vault_stamp_updated_by();
alter table public.vault_content          drop column if exists updated_by;
alter table public.vault_journals         drop column if exists updated_by;
alter table public.vault_content_versions drop column if exists updated_by;
```

⚠️ Dropping the columns requires the clients to stop selecting them **first** —
PostgREST answers a missing column with an error, not an empty value, so the
save path would fail outright. This is the ordered-removal rule from the top of
this file, and it applies to this one where it did not apply to files 11 and 12
going in.
