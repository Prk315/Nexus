-- 20260823120000_n8n_mail_bus.sql
--
-- The mail bus: four tables that let a locally-hosted n8n instance do Gmail
-- triage for a header panel it can never talk to directly.
--
--   mail_categories  the category vocabulary (config, seeded)
--   mail_rules       user-defined inbox rules — the customisation surface
--   mail_messages    triaged mail: the model's evidence and the verdict
--   n8n_requests     the action queue back the other way
--
-- Created in that order because `mail_messages` FK-references `mail_rules`
-- (`rule_id`). It does NOT reference `mail_categories` — categories are matched
-- by name with no FK, exactly as `pf_cal_blocks.category` is; the ordering is
-- only for readability there.
--
-- This file also references `public.pf_tasks`, which is not created by any
-- migration in this directory — it predates it, as every `pf_task_*` migration
-- here already assumes. On a from-scratch database that FK is the first thing
-- that will fail, and the fix is to restore the PathFinder baseline first, not
-- to drop the constraint.
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
--   Gmail -> n8n (Mac) -> local Qwen -> rules -> n8n-ingest edge fn -> here
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
-- These tables hold mail: sender addresses, subjects, snippets of message
-- bodies, and a draft reply written in the user's voice. Strictly more
-- sensitive than the browsing data `usage_intervals` was locked down for. So,
-- exactly as in `20260807173000_usage_intervals.sql`, there is deliberately
-- **no anon policy anywhere in this file**, and `user_id` is a real
-- `uuid references auth.users(id)` rather than the legacy `text default
-- 'default'`. That omission is the entire security model. Do not add one "for
-- consistency" with the tables next door; adding a 14th world-writable table is
-- the specific thing that document asks people to stop doing.
--
-- Note this is why `mail_categories` does NOT copy `coverage_categories`'
-- ownership even though it copies its shape: that table is `user_id text
-- default 'default'` under an anon policy, and inheriting that here would drag
-- the mail tables back over the line. Shape yes, RLS no.
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
-- clean", and a panel that renders both as "Inbox zero" is lying half the time
-- — the same failure mode as seeding `blocking_state` with zeros.
--
-- So `mail_messages` and `n8n_requests` are **not seeded**, and freshness is
-- read explicitly from the queue rather than inferred: the most recent
-- `n8n_requests` row with `kind = 'mail_sync'` and `status = 'done'` carries
-- the `finished_at` that is the real "last synced" timestamp. No such row =
-- never synced = *unknown*, and consumers must say so rather than claim an
-- empty inbox. `n8n_requests_user_kind_finished` makes that read cheap.
--
-- `mail_categories` IS seeded, because it is configuration rather than a
-- verdict — an empty vocabulary means "nothing to pick from", which is not a
-- claim about the world.


-- ===========================================================================
-- Guard: refuse to run on top of a half-applied earlier draft
-- ===========================================================================
--
-- An earlier revision of this file (timestamped 20260822120000, on the PR
-- branch, never applied to this project) created `mail_messages` with a
-- `priority integer` column and none of the score/importance/urgency/rule_id/
-- category/due_date/time_estimate/task_id columns below. If someone pasted
-- that draft into the SQL editor, `create table if not exists` here is a
-- silent no-op: the new tables would be created, `mail_messages` would keep
-- the old shape, and the first `create index ... (score ...)` would abort —
-- leaving `mail_rules` present, `mail_messages.rule_id` absent, and PostgREST
-- returning `column mail_messages.score does not exist` on the panel's
-- primary read.
--
-- Fail loudly instead. The old table never held data, so the fix is to drop it.
-- Probed through pg_catalog rather than information_schema on purpose:
-- `information_schema.columns` is privilege-filtered, so if the draft table
-- were created by a different role it would return nothing and this guard
-- would pass silently — failing open, on the one check whose whole job is to
-- fail closed.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute a
    where a.attrelid = to_regclass('public.mail_messages')
      and a.attname  = 'priority'
      and a.attnum   > 0
      and not a.attisdropped
  ) then
    raise exception using
      message = 'mail_messages exists in its pre-amendment shape (has `priority`, lacks `score`).',
      hint    = 'The 20260822120000 draft was applied by hand. It never held data: `drop table public.mail_messages cascade;` then re-run this file.';
  end if;
end
$$;


-- ===========================================================================
-- mail_categories
-- ===========================================================================
--
-- A real table rather than free text on the row, so the panel can show a
-- stable colour/emoji per category and the user can add their own.
--
-- Modelled on `coverage_categories` (20260821120000): same columns, same
-- `unique (user_id, name)`, same seed-with-`on conflict do nothing` so a
-- re-apply preserves user edits.
--
-- ⚠️ It is deliberately NOT the same table as `coverage_categories`, and the
-- two lists must not be merged. Those are *activity* categories — Deep work,
-- Training, Rest — the vocabulary a day is spent in. These are *mail* kinds —
-- Action needed, Receipt, Newsletter. One list cannot serve both without
-- becoming a junk drawer that is wrong for each. The coverage migration
-- carries the same "do not unify" note about `pf_tasks.category`; this is that
-- note applied one table over.

create table if not exists public.mail_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null,
  color      text not null,
  emoji      text,
  sort       integer not null default 0,
  -- Config flags, so `not null default` is correct here and is NOT the
  -- defaulting mistake this file avoids elsewhere: the no-default rule applies
  -- to the *verdict* columns on mail_messages, where absent has to stay
  -- distinguishable from a value. "Is this category switched on" has no third
  -- state, and a nullable boolean would put three-valued logic in every filter.
  enabled    boolean not null default true,
  created_at timestamptz not null default now(),
  constraint mail_categories_unique unique (user_id, name)
);

create index if not exists mail_categories_user_sort
  on public.mail_categories (user_id, sort);

alter table public.mail_categories enable row level security;

drop policy if exists mail_categories_owner on public.mail_categories;
create policy mail_categories_owner on public.mail_categories
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Seed the default vocabulary. These names MUST match the `MAIL_CATEGORIES`
-- constant the panel ships verbatim — `mail_messages.category` is matched by
-- name, exactly as `pf_cal_blocks.category` is, so a rename on one side
-- silently orphans rows on the other.
--
-- Cross-joined over `auth.users` rather than written against a literal owner,
-- because `user_id` is a real FK here and there is no `'default'` sentinel to
-- seed against. Re-runnable, and `do nothing` preserves edited colours.
--
-- Two consequences worth knowing:
--
-- 1. An account created *after* this migration is applied gets no seed. The
--    panel unit is responsible for seeding on first open. An empty list must
--    therefore render as "no categories yet", never as an error.
-- 2. `do nothing` preserves edits to rows that still exist, but it cannot tell
--    "deleted on purpose" from "never inserted" — so re-running this file
--    resurrects a seed category the user deleted. That is why `enabled` exists:
--    switching a category off is the supported way to retire one, and it
--    survives a re-apply. The guard block above tells an operator to re-run the
--    whole file, so this is not hypothetical.
insert into public.mail_categories (user_id, name, color, emoji, sort)
select u.id, c.name, c.color, c.emoji, c.sort
from auth.users u
cross join (values
  ('Action needed', 'red',    '🔥', 0),
  ('Awaiting reply','amber',  '⏳', 1),
  ('Meeting',       'blue',   '📅', 2),
  ('Bill',          'orange', '💳', 3),
  ('Receipt',       'teal',   '🧾', 4),
  ('Newsletter',    'violet', '📰', 5),
  ('Notification',  'slate',  '🔔', 6),
  ('Personal',      'pink',   '💬', 7)
) as c(name, color, emoji, sort)
on conflict (user_id, name) do nothing;

comment on table public.mail_categories is
  'Category vocabulary for triaged mail. Config, seeded, owner-scoped. NOT the same list as coverage_categories (activity categories) — do not unify.';


-- ===========================================================================
-- mail_rules
-- ===========================================================================
--
-- The customisation surface: "anything from @bank.dk is a Bill and high
-- importance", "newsletters auto-archive".
--
-- # Where these are applied, and why not in n8n
--
-- Rules are evaluated **server-side in the `n8n-ingest` edge function, after
-- the model**, and a rule always wins over the model's verdict. That is the
-- house "no client derives policy" rule (`focus-evaluate` collapsing six tables
-- into one `blocking_state` row is the same shape), and it is what makes an
-- override deterministic: if the rules lived in the n8n workflow instead, the
-- verdict would silently depend on which version of the workflow happened to
-- run, and re-running triage over history would produce different answers than
-- the live pass did. The enforcement lives in another unit; this table is only
-- the storage.
--
-- # Precedence: ALL matching rules apply, ascending `sort`, last write wins
--
-- Not first-match-wins. A rule that only sets a category should not block a
-- later rule that only sets urgency — with first-match-wins the two would be
-- mutually exclusive and the user would have to write the cross product.
-- So every enabled matching rule is applied in order and each non-null action
-- field overwrites what came before, which means the **highest `sort`** among
-- matching rules wins any direct conflict.
--
-- Ties are broken by `created_at` then `id`. That is not decoration: two rules
-- sharing a `sort` would otherwise be applied in whatever order the planner
-- returned them, and a conflicting pair would flip between runs.
--
-- # Matching: columns, not a jsonb blob
--
-- Four nullable match fields, ANDed; a NULL field does not constrain. Columns
-- rather than `jsonb` so the evaluator can push the match into SQL and so a
-- typo'd key is a column error instead of a rule that silently never fires —
-- the failure mode a blob would have.

create table if not exists public.mail_rules (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- Optional label for the UI ("Bank statements"). Not a key.
  name         text,
  enabled      boolean not null default true,
  -- Precedence. See the note above: ascending, last matching write wins.
  sort         integer not null default 0,

  -- --- match (all non-null fields must match) ------------------------------
  -- Full address, compared case-insensitively by the evaluator.
  match_sender  text,
  -- Everything after the '@'. Stored without the '@'.
  match_domain  text,
  -- Substring of the subject, case-insensitive.
  match_subject text,
  -- RFC 2919 List-Id, which is how bulk mail is honestly identified — far more
  -- reliable than "unsubscribe" appearing in the body.
  match_list_id text,

  -- --- actions (at least one) ----------------------------------------------
  -- Category name, matched against mail_categories.name. Text and no FK, same
  -- looseness as pf_cal_blocks.category — see the warning on mail_messages.
  set_category   text,
  -- Both axes CHECK to PathFinder's exact three values. See mail_messages.
  set_importance text check (set_importance in ('high', 'medium', 'low')),
  set_urgency    text check (set_urgency    in ('high', 'medium', 'low')),
  -- Auto-file. Constrained to a subset of mail_messages.status: a rule may
  -- pre-read or archive, but may not claim you 'replied' to something.
  set_status     text check (set_status in ('read', 'archived')),

  created_at   timestamptz not null default now(),

  -- A rule with no match fields matches EVERY message. With `set_status =
  -- 'archived'` that silently empties the inbox, and the symptom — "mail stops
  -- arriving" — points nowhere near the rule. Refuse it at the database.
  constraint mail_rules_has_match check (
    num_nonnulls(match_sender, match_domain, match_subject, match_list_id) >= 1
  ),
  -- And a rule with no actions is a no-op the user will swear is broken.
  constraint mail_rules_has_action check (
    num_nonnulls(set_category, set_importance, set_urgency, set_status) >= 1
  )
);

-- Ordered evaluation: the evaluator pulls one user's enabled rules already in
-- precedence order, including the tie-breakers, so it never sorts in memory
-- and never depends on planner order for a tied pair.
create index if not exists mail_rules_user_order
  on public.mail_rules (user_id, sort, created_at, id)
  where enabled;

alter table public.mail_rules enable row level security;

drop policy if exists mail_rules_owner on public.mail_rules;
create policy mail_rules_owner on public.mail_rules
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.mail_rules is
  'User-defined inbox rules. Applied server-side in n8n-ingest AFTER the model, and a rule always wins. All matching enabled rules apply in ascending sort (ties: created_at, id); each non-null action overwrites, so the highest sort wins a conflict.';


-- ===========================================================================
-- mail_messages
-- ===========================================================================

create table if not exists public.mail_messages (
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

  -- ── the evidence ────────────────────────────────────────────────────────
  --
  -- `score` is what the model thought: 0-100, HIGHER IS MORE URGENT.
  --
  -- It is called `score` and not `priority` on purpose. In PathFinder,
  -- `pf_tasks.priority` means **importance** and its domain is
  -- high/medium/low — see `pf_task_isa_hierarchy.sql:58` ("the urgency axis,
  -- complementing pf_tasks.priority (which is importance)"). A 0-100
  -- `priority` column in the same database would be the same word with the
  -- opposite meaning and an incompatible type, which is a bug waiting for
  -- whoever writes the conversion.
  --
  -- These three move together — a score without `triaged_at` is meaningless,
  -- and a score from a different model is not comparable to its neighbours.
  score           integer check (score between 0 and 100),
  -- When the model last scored this row, and which model did. Without the
  -- model name the only way to discover that the local Ollama tag changed is
  -- to notice the numbers went strange.
  triaged_at      timestamptz,
  triage_model    text,

  -- ── the verdict ─────────────────────────────────────────────────────────
  --
  -- The two axes, CHECK-constrained to PathFinder's EXACT three values so the
  -- domains are identical and conversion is lossless:
  --   importance -> pf_tasks.priority           (text, no CHECK in the DB
  --                                              today, but 'high'|'medium'|
  --                                              'low' by convention — see
  --                                              the Priority union in
  --                                              apps/PathFinder/src/types)
  --   urgency    -> pf_task_planning.urgency    (text, checked to the same three)
  --
  -- Unlike the triage triple these are NOT model-only: a rule can set either
  -- without the model ever having run, which is why they are not bundled with
  -- `triaged_at`.
  --
  -- ⚠️ Never `order by importance` / `order by urgency`. Alphabetically 'high'
  -- < 'low' < 'medium', so a text sort silently ranks low above medium. Sort
  -- by `score`, or map the axes to integers in the client.
  importance      text check (importance in ('high', 'medium', 'low')),
  urgency         text check (urgency    in ('high', 'medium', 'low')),

  -- Which rule last wrote importance/urgency (the highest-sort matching rule,
  -- per the precedence note above). NULL = the model's verdict stands
  -- unmodified. This exists so the UI can answer "why is this high urgency?"
  -- instead of presenting an unexplained number; `on delete set null` because
  -- deleting a rule must not delete the mail it touched.
  rule_id         uuid references public.mail_rules(id) on delete set null,

  -- Category name, matched against `mail_categories.name`. Text and no FK, the
  -- same looseness `pf_cal_blocks.category` uses: matching by name keeps
  -- ad-hoc categories possible and a FK would block them.
  --
  -- ⚠️ This must NEVER be written to `pf_tasks.category` during conversion.
  -- That column is the ISA discriminator — `task_type` is
  -- `generated always as (coalesce(category, 'task'))`, and it is CHECK-ed to
  -- ('reminder','chore','shopping'). Putting 'Newsletter' there fails the
  -- check; putting 'reminder' there would *re-type* the task and make the
  -- subtype triggers materialise or drop rows, and demotion is lossy by
  -- construction. A converted mail is a plain task: leave `pf_tasks.category`
  -- NULL. Same "do not unify" warning coverage_categories carries.
  category        text,

  suggested_reply text,

  -- ── conversion targets ──────────────────────────────────────────────────
  --
  -- The model is already reading the body; "reply by Friday" and "this is a
  -- ten-minute job" are the two most useful things in it, and without somewhere
  -- to put them the conversion drops them on the floor.
  --
  -- `due_date` is a real `date` here even though **`pf_tasks.due_date` is
  -- `text`** (verified against the live schema — it predates these
  -- migrations). Storing a date as a date validates the model's output at the
  -- boundary instead of letting 'next Friday' through as a string; the
  -- conversion casts `due_date::text`, which under ISO DateStyle yields the
  -- 'YYYY-MM-DD' PathFinder already stores.
  due_date        date,
  -- Minutes, matching `pf_tasks.time_estimate` (integer). Never write
  -- `aggregate_estimate` on the far side — it is trigger-maintained.
  time_estimate   integer check (time_estimate >= 0),

  -- Set once this mail has become a task, so the panel shows "already a task"
  -- instead of quietly minting duplicates every time someone taps convert.
  --
  -- A real FK is fine here, unlike `pf_task_sessions.cal_block_id`, which
  -- avoids one only because it stores *virtual negative ids* for recurring
  -- occurrences that have no row. `on delete set null`: deleting the task
  -- makes the mail unconverted again, it does not delete the mail.
  --
  -- ⚠️ `pf_tasks.user_id` is `text` (legacy `default 'default'`) while
  -- `mail_messages.user_id` is `uuid`. The conversion must write
  -- `mail.user_id::text`; comparing the two without the cast is an operator
  -- error, and — worse — the FK below does NOT check that the task belongs to
  -- the same person, because a FK cannot see RLS. That check is the
  -- conversion unit's job.
  task_id         bigint references public.pf_tasks(id) on delete set null,

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

-- EVERY field in the two blocks above is nullable, and that is the design.
-- NULL means "nothing has decided this yet", which is a different fact from
-- "decided, and the answer was low / medium / none". A row legitimately exists
-- un-triaged: ingest writes the message the moment it is fetched, and Qwen is
-- the slow second half of the pipeline. Giving `importance`/`urgency` a
-- `not null default 'medium'` — the shape `pf_tasks` and `pf_task_planning`
-- use — would reintroduce exactly the defaulting mistake removed from ingest
-- last round, and 'medium' is indistinguishable from a real verdict. The
-- defaults on the *far* side are PathFinder's business, applied at conversion.

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
  on public.mail_messages (user_id, external_id);

-- The panel's primary read: the triage list, most urgent first, un-triaged
-- ahead of everything. `nulls first` is part of the contract, not a default —
-- mail the model has not scored belongs at the TOP of a triage list, not
-- buried where a `not null default 0` would have put it.
create index if not exists mail_messages_user_score
  on public.mail_messages (user_id, score desc nulls first, received_at desc);

-- The 3x3 importance/urgency matrix lens, mirroring the one PathFinder renders
-- over pf_tasks.priority x pf_task_planning.urgency.
create index if not exists mail_messages_user_axes
  on public.mail_messages (user_id, importance, urgency);

-- Chronological read, for a plain "recent mail" view and for n8n's own
-- "what have I already seen" window query.
create index if not exists mail_messages_user_received
  on public.mail_messages (user_id, received_at desc);

-- Everything still in the tray — unread *and* read-but-not-dealt-with, which
-- is what a triage list shows and what the badge counts. Partial is fine
-- *here* — unlike the unique index above, nothing ever names this one in an
-- `on_conflict`.
create index if not exists mail_messages_user_open
  on public.mail_messages (user_id, received_at desc)
  where status in ('unread', 'read');

alter table public.mail_messages enable row level security;

-- Owner-only. Note again: no `to anon` policy in this file. See the header.
drop policy if exists mail_messages_owner on public.mail_messages;
create policy mail_messages_owner on public.mail_messages
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

drop trigger if exists mail_messages_touch_trg on public.mail_messages;
create trigger mail_messages_touch_trg
  before update on public.mail_messages
  for each row execute function public.mail_messages_touch();

comment on table public.mail_messages is
  'Gmail messages triaged by n8n + a local Qwen, written by the n8n-ingest edge function and read by NexusHeader/MailPanel. Owner-scoped RLS with no anon access: holds senders, subjects, body snippets and draft replies. score (0-100) is the model''s evidence; importance/urgency are the verdict, sharing PathFinder''s exact high|medium|low domain so conversion to pf_tasks is lossless. All are NULLABLE: absent means "not decided", never "low".';


-- ===========================================================================
-- n8n_requests
-- ===========================================================================
--
-- The other direction: the UI cannot reach n8n either, so an action is a row
-- that n8n polls for. Deliberately a plain table and not pg_net/webhooks —
-- n8n runs on a laptop that is asleep half the day, so the queue has to
-- tolerate the worker being absent for hours and the request surviving it.

create table if not exists public.n8n_requests (
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
  on public.n8n_requests (user_id, created_at)
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
  on public.n8n_requests (user_id, kind, status, finished_at desc);

alter table public.n8n_requests enable row level security;

-- Owner-only; no anon policy, as above. A payload can contain the text of a
-- reply about to be sent from the user's own address.
drop policy if exists n8n_requests_owner on public.n8n_requests;
create policy n8n_requests_owner on public.n8n_requests
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.n8n_requests is
  'Action queue from the Nexus apps to the locally-hosted n8n instance (sync mail, send a reply, archive). Polled by n8n via the service-role client; owner-scoped RLS with no anon access. The newest kind=''mail_sync'', status=''done'' row is the authoritative "last synced" signal — mail_messages row count is NOT.';
