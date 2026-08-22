-- 20260822120000_n8n_mail_bus.sql
--
-- The mail bus: two tables that let a locally-hosted n8n instance do Gmail
-- triage for a header panel it can never talk to directly.
--
--   mail_messages  triaged mail — one row per Gmail message, with the priority
--                  and suggested reply a local Qwen produced for it.
--   n8n_requests   the action queue — work the UI asks n8n to do (sync now,
--                  send this reply, archive that thread).
--
-- # Why a table at all
--
-- Vault / PathFinder / Protocol are HTTPS pages served by Vercel. They
-- structurally cannot fetch `http://localhost:5678` (mixed content), and the
-- iPhone and iPad are not even on the same host. So NexusHeader never speaks to
-- n8n. Instead n8n pushes its verdict into Postgres and every client reads a
-- row — the same split as `focus-evaluate` -> `blocking_state`, and
-- `usage-ingest` -> `usage_intervals`: the machine that can do the work does it
-- on a schedule, and the devices only read.
--
--   Gmail -> n8n (Mac) -> local Qwen -> n8n-ingest edge fn -> here -> header
--
-- # Why this file's RLS looks nothing like the productivity tables
--
-- `blocked_sites`, `time_entries`, `focus_blocks` and ten of their neighbours
-- carry `USING (true)` for ALL commands against the anon role. The repo is
-- public and the anon key is committed in `apps/NexusLocal/src-tauri/src/
-- config.rs`, so those tables are, in practice, world-writable.
-- `SECURITY_RLS_MIGRATION.md` documents that as a known defect being migrated
-- away from — not as a convention to copy.
--
-- This table holds mail: sender addresses, subjects, snippets of message
-- bodies, and a draft reply written in the user's voice. It is strictly more
-- sensitive than the browsing data `usage_intervals` was locked down for. So,
-- exactly as in `20260807173000_usage_intervals.sql`, there is deliberately
-- **no anon policy anywhere in this file**, and `user_id` is a real
-- `uuid references auth.users(id)` rather than the legacy `text default
-- 'default'`. That omission is the entire security model. Do not add one "for
-- consistency" with the tables next door; adding a 14th world-writable table is
-- the specific thing that document asks people to stop doing.
--
-- # How writes get in
--
-- n8n has no Supabase session, so it cannot satisfy `auth.uid()` any more than
-- the Rust daemon can. Writes go through the `n8n-ingest` edge function, which
-- holds a scoped secret and a service-role client and stamps the owner id
-- server-side. Service role bypasses RLS by design; the policies below govern
-- the browser and the widgets, which is where untrusted keys actually live.
--
-- # The freshness signal, and why it is not row count
--
-- CLAUDE.md's load-bearing invariant: an empty or missing row must never be
-- indistinguishable from "computed, and there was nothing". Zero rows in
-- `mail_messages` means "n8n has never successfully run" *or* "the inbox is
-- clean", and a panel that renders both as "Inbox zero ✓" is lying half the
-- time — the same failure mode as seeding `blocking_state` with zeros.
--
-- So these tables are **not seeded**, and freshness is read explicitly from the
-- queue rather than inferred: the most recent `n8n_requests` row with
-- `kind = 'mail_sync'` and `status = 'done'` carries the `finished_at` that is
-- the real "last synced" timestamp. No such row = never synced = *unknown*, and
-- consumers must say so rather than claim an empty inbox.
-- `n8n_requests_user_kind_finished` below exists to make that read cheap.

-- ---------------------------------------------------------------------------
-- mail_messages
-- ---------------------------------------------------------------------------

create table if not exists mail_messages (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  -- Gmail's own immutable message id (not the thread id, not the RFC822
  -- Message-ID header). The natural key for the upsert path below: n8n
  -- re-reads an overlapping window of the inbox on every run, so the same
  -- message WILL arrive many times and must land on the same row.
  external_id     text not null,
  -- Gmail thread id, when known. Kept so a reply action can be threaded
  -- correctly; deliberately NOT part of any unique key — a thread has many
  -- messages.
  thread_id       text,

  sender          text not null,
  subject         text,
  snippet         text,
  received_at     timestamptz not null,

  -- --- the model's verdict -------------------------------------------------
  --
  -- All three are nullable, and that is the point: NULL means "the triage step
  -- has not run for this row", which is a different fact from "it ran and
  -- scored this low / found no category / had nothing to suggest". A row can
  -- legitimately exist un-triaged — the ingest function writes the message as
  -- soon as it is fetched, and Qwen is the slow second half of the pipeline.
  --
  -- priority: 0-100, HIGHER IS MORE URGENT. Consumers sort
  -- `priority desc nulls first, received_at desc` — un-triaged mail belongs at
  -- the TOP of a triage list, not silently buried at the bottom, which is
  -- where a `not null default 0` would have put it.
  priority        integer check (priority between 0 and 100),
  -- Free text on purpose. The category vocabulary lives in the triage prompt
  -- and will churn; a check constraint or an FK here would mean a migration
  -- every time the prompt is reworded, and an enum drift bug in between.
  category        text,
  suggested_reply text,
  -- When the model last scored this row. `triaged_at is null` is the per-row
  -- form of the invariant above; it also lets a re-triage pass find rows a
  -- crashed run left half-processed.
  triaged_at      timestamptz,
  -- Which model produced the verdict, e.g. 'qwen2.5:14b'. Scores from two
  -- different models are not comparable, and without this the only way to find
  -- out a local model changed is to notice the numbers got weird.
  triage_model    text,

  -- Where the user is with it. Kept small and checked: this drives filtering,
  -- so a typo'd value silently vanishing from every view is the failure mode.
  status          text not null default 'unread'
                    check (status in ('unread', 'read', 'replied', 'archived')),

  -- The untouched Gmail payload, so a prompt change can be re-run over history
  -- without re-fetching, and so a mis-parse is recoverable rather than lossy.
  raw             jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The natural key, and the `on_conflict` target for the ingest upsert.
--
-- NAMED COLUMNS, and NOT PARTIAL. Both matter. PostgREST cannot infer a
-- partial index for `on_conflict` — it does not fail at deploy time, it fails
-- at runtime as an opaque 409 on every single write. This repo has been bitten
-- by exactly this twice already: `garmin-import`'s (user_id, external_id) and
-- `pf_task_sessions`' (task_id, cal_block_id). A `where external_id is not
-- null` here would buy nothing anyway, since NULLs are distinct in a unique
-- index regardless.
create unique index if not exists mail_messages_user_external
  on mail_messages (user_id, external_id);

-- The panel's primary read: the triage list, most urgent first, un-triaged
-- ahead of everything (see the priority note above — `nulls first` is part of
-- the contract, not a default).
create index if not exists mail_messages_user_priority
  on mail_messages (user_id, priority desc nulls first, received_at desc);

-- Chronological read, for a plain "recent mail" view and for n8n's own
-- "what have I already seen" window query.
create index if not exists mail_messages_user_received
  on mail_messages (user_id, received_at desc);

-- Everything still in the tray — unread *and* read-but-not-dealt-with, which
-- is what a triage list shows and what the badge counts. Partial is fine
-- *here* — unlike the index above, nothing ever names this one in an
-- `on_conflict`.
create index if not exists mail_messages_user_open
  on mail_messages (user_id, received_at desc)
  where status in ('unread', 'read');

alter table mail_messages enable row level security;

-- Owner-only. Note again: no `to anon` policy in this file. See the header.
drop policy if exists mail_messages_owner on mail_messages;
create policy mail_messages_owner on mail_messages
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- `updated_at` is what tells a client its cached list is stale, so leaving it
-- to every writer to remember is how it ends up permanently equal to
-- `created_at`. Trigger-maintained instead, same reasoning as
-- `pf_tasks.aggregate_estimate`: a derived column nobody writes by hand.
create or replace function public.mail_messages_touch()
returns trigger
language plpgsql
-- Empty search_path so the body cannot be hijacked by a schema on someone
-- else's path (Supabase's advisor flags functions without it). Nothing here
-- needs resolution beyond `now()`, which lives in the always-present
-- pg_catalog.
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists mail_messages_touch_trg on mail_messages;
create trigger mail_messages_touch_trg
  before update on mail_messages
  for each row execute function public.mail_messages_touch();

comment on table mail_messages is
  'Gmail messages triaged by n8n + a local Qwen, written by the n8n-ingest edge function and read by NexusHeader/MailPanel. Owner-scoped RLS with no anon access: holds senders, subjects, body snippets and draft replies. NULL priority/triaged_at means "not yet triaged", never "scored low".';

-- ---------------------------------------------------------------------------
-- n8n_requests
-- ---------------------------------------------------------------------------
--
-- The other direction: the UI cannot reach n8n either, so an action is a row
-- that n8n polls for. Deliberately a plain table and not pg_net/webhooks —
-- n8n runs on a laptop that is asleep half the day, so the queue has to
-- tolerate the worker being absent for hours and the request surviving it.

create table if not exists n8n_requests (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- What to do, e.g. 'mail_sync', 'send_reply', 'archive', 'retriage'. Free
  -- text for the same reason `category` is: the set of workflows changes
  -- whenever a workflow is added in the n8n UI, and a check constraint here
  -- would make that a database migration. An unknown kind is ignored by the
  -- poller, which is the safe failure.
  kind        text not null,
  -- Arguments for the workflow: `{"message_id": "...", "body": "..."}`.
  payload     jsonb not null default '{}'::jsonb,

  -- queued  -> nobody has picked it up
  -- claimed -> a worker took it; `claimed_at` is set
  -- done    -> finished; `finished_at` is set
  -- error   -> finished badly; `finished_at` AND `error` are set
  --
  -- Checked, unlike `kind`: these four are the state machine every consumer
  -- switches on, and a fifth value appearing would strand rows invisibly.
  status      text not null default 'queued'
                check (status in ('queued', 'claimed', 'done', 'error')),

  created_at  timestamptz not null default now(),
  -- Set when a worker claims the row. This is also the stranded-work signal:
  -- if the Mac sleeps mid-run the row stays 'claimed' forever, so a reaper (or
  -- a human) re-queues rows whose `claimed_at` is older than the longest
  -- plausible workflow. There is no lease column — one timestamp is enough for
  -- a single-worker queue, and this is a single-worker queue.
  claimed_at  timestamptz,
  finished_at timestamptz,
  -- Populated only for status = 'error'. An empty error on an errored row is a
  -- bug in the worker, not "it failed for no reason" — same distinction the
  -- garmin-import skips draw: "0 imported because Oura owns it" and "0
  -- imported because it broke" must not look the same.
  error       text
);

-- The poller's index: "give me the oldest queued work". Partial, and safely so
-- — nothing upserts onto this table, rows are inserted with fresh uuids.
create index if not exists n8n_requests_queued
  on n8n_requests (user_id, created_at)
  where status = 'queued';

-- The freshness read described in the header: latest completed run of a given
-- kind. `MailPanel` uses (kind = 'mail_sync', status = 'done') to distinguish
-- "inbox is empty" from "n8n has never run", which zero rows in
-- `mail_messages` cannot do on its own.
--
-- `status` is a leading column rather than a `where status = 'done'` predicate
-- so the same index also answers "is a sync already queued or claimed?" — the
-- other question that panel asks, and the reason a partial index would have
-- been the wrong tightening. It also keeps unfinished rows (`finished_at is
-- null`, which sorts first under `desc`) out of the way of the newest done row.
create index if not exists n8n_requests_user_kind_finished
  on n8n_requests (user_id, kind, status, finished_at desc);

alter table n8n_requests enable row level security;

-- Owner-only; no anon policy, as above. A payload can contain the text of a
-- reply about to be sent from the user's own address.
drop policy if exists n8n_requests_owner on n8n_requests;
create policy n8n_requests_owner on n8n_requests
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table n8n_requests is
  'Action queue from the Nexus apps to the locally-hosted n8n instance (sync mail, send a reply, archive). Polled by n8n via the service-role client; owner-scoped RLS with no anon access. The newest kind=''mail_sync'', status=''done'' row is the authoritative "last synced" signal — mail_messages row count is NOT.';
