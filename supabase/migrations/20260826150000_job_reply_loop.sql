-- 20260826150000_job_reply_loop.sql
--
-- Phase 4 of the job applier: closing the loop. An employer replies, and the
-- application moves `submitted` -> `response` on its own.
--
--   job_submission_attempts.thread_id   the join key, promoted out of `proof`
--   job_applications.responded_at       when they answered
--   public.job_mail_reply_match()       the trigger that notices
--
-- Additive only. Nothing here drops or narrows anything — the rule that matters
-- most in this repo (CLAUDE.md, "One database, every branch"): phases 1-3 are
-- LIVE, and the harvest and apply workflows are calling `job-ingest` against
-- these exact tables while this file is being applied.
--
-- # Why this is machinery we already own
--
-- The mail pipeline reads this inbox every few minutes, writes every message to
-- `mail_messages`, and stores Gmail's `thread_id` on each row. `apply_result`
-- already stores Gmail's `thread_id` in `job_submission_attempts.proof` as part
-- of the proof of what was sent. A reply lands in the SAME Gmail thread. So the
-- fact "they answered" is already sitting in this database twice; nobody had
-- written the join.
--
-- That is the whole design. No second Gmail credential, no second poller, no new
-- OAuth token to notice has expired six weeks later.
--
-- # Why the thread id and not the sender
--
-- The obvious alternative — match the reply's sender domain against the address
-- we applied to — is wrong more often than it is right, and wrong in the
-- direction that hurts. Recruiters reply from their ATS: you write to
-- `jobs@company.dk` and the answer arrives from `no-reply@teamtailor.com`,
-- `notifications@greenhouse.io`, or a personal `@gmail.com`. Domain matching
-- would silently miss exactly the replies that came through a real hiring
-- system, which is most of them.
--
-- The thread id has none of that fragility: it is Gmail's own identity for the
-- conversation, assigned when our message was sent, and every reply to it
-- carries the same one regardless of who typed it or what domain it left from.
--
-- # What this does NOT do
--
-- It does not read, classify or judge the reply. `response` means "somebody
-- answered", not "good news" — a rejection is a response. Deciding which is
-- which is the triage model's job on the `mail_messages` row, and the two facts
-- are kept separate on purpose: the state machine should not depend on a local
-- LLM having been awake.
--
-- It never writes to `mail_messages`. That table belongs to the mail pipeline;
-- this migration only reads it, in an AFTER trigger that returns NULL.

-- ---------------------------------------------------------------------------
-- job_submission_attempts.thread_id
-- ---------------------------------------------------------------------------
--
-- `proof` is jsonb because it records what an external system said and its shape
-- is not ours to fix (see 20260826120000). `thread_id` is the one key inside it
-- that has become a RELATION — something joined on, on a hot path, by a trigger
-- that fires on every ingested mail row. `proof->>'thread_id'` cannot use an
-- index the planner will pick for that, and the alternative (an expression index
-- on the jsonb extraction) buys the same thing while leaving the join key
-- invisible to anyone reading the table definition.
--
-- The value stays in `proof` as well. The audit log records what was said; this
-- column is a derived index key. Deleting the original to avoid duplication
-- would be editing evidence.

alter table public.job_submission_attempts
  add column if not exists thread_id text;

comment on column public.job_submission_attempts.thread_id is
  'Gmail thread id of the sent application, promoted out of proof->>''thread_id'' '
  'so the reply-matching trigger on mail_messages can use an index. Derived by '
  'job_attempt_thread_id() when the writer does not set it.';

-- Backfill. Written as `is not null` rather than `proof ? ''thread_id''` so this
-- file survives being pasted into any client that treats a bare `?` as a bind
-- placeholder — the same defensive habit as spelling out `on_conflict` columns.
update public.job_submission_attempts
   set thread_id = proof ->> 'thread_id'
 where thread_id is null
   and proof ->> 'thread_id' is not null;

-- Derive it for anything that writes an attempt without setting the column.
--
-- This is not redundant with the edge function also setting it: a migration is
-- applied BEFORE the function that pairs with it is deployed, and applications
-- sent in that window must still be matchable when their reply arrives. It is
-- also the guarantee that a future writer — a second channel, a manual INSERT
-- from the SQL editor while debugging — cannot produce an attempt that the reply
-- loop silently cannot see.
--
-- BEFORE INSERT only. The table is append-only by construction (nothing rewrites
-- an attempt; a retry is a new row), so an UPDATE branch would advertise a
-- mutability that must not exist.
--
-- `set search_path = ''` per the linter rule and for the reason
-- `job_touch_updated_at` has it: the body cannot then be hijacked by a schema on
-- someone else's path. `->>` resolves out of pg_catalog, which is always present.
create or replace function public.job_attempt_thread_id()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  if new.thread_id is null and new.proof is not null then
    new.thread_id := new.proof ->> 'thread_id';
  end if;
  return new;
end;
$fn$;

drop trigger if exists job_submission_attempts_thread on public.job_submission_attempts;
create trigger job_submission_attempts_thread
  before insert on public.job_submission_attempts
  for each row execute function public.job_attempt_thread_id();

-- The reply trigger's only lookup, and the reason it is cheap.
--
-- Leading with `thread_id` because that is the selective column: a thread id
-- identifies one conversation, while `user_id` on a single-user install selects
-- everything. The probe for a mail row whose thread we never wrote to ends at
-- the first index page and returns nothing.
--
-- PARTIAL, and that is safe HERE. The repo's scar tissue about partial indexes
-- (`garmin-import`'s `(user_id, external_id)`, `pf_task_sessions`'
-- `(task_id, cal_block_id)`, `mail_messages_user_external`) is specifically about
-- indexes named in an `on_conflict`, which PostgREST cannot infer. Nothing
-- upserts on this one — it exists for one read path — so excluding the attempts
-- that carry no thread id (every failed send, and every future non-email
-- channel) just keeps it small. Same call as `mail_messages_user_open`.
create index if not exists job_submission_attempts_thread_idx
  on public.job_submission_attempts (thread_id, user_id)
  where thread_id is not null;

-- ---------------------------------------------------------------------------
-- job_applications.responded_at
-- ---------------------------------------------------------------------------
--
-- Stamped with the REPLY'S `received_at`, not with `now()`. The interesting
-- number is how long the company took to answer, and `now()` measures how long
-- the Mac was asleep before the mail pipeline caught up — mail that arrives
-- overnight is not triaged until the machine wakes (CLAUDE.md, "Why a local Qwen,
-- and what it costs"), so the two can differ by a working day.
--
-- Nullable, with no default, like every other timestamp in this pipeline: NULL
-- means "nobody has answered", which is a different fact from any value.

alter table public.job_applications
  add column if not exists responded_at timestamptz;

comment on column public.job_applications.responded_at is
  'received_at of the first inbox message landing in the sent application''s '
  'Gmail thread. Set once, by job_mail_reply_match(); a later message in the '
  'same thread does not move it.';

-- The panel's "what came back" read, and the only way this column is queried.
create index if not exists job_applications_user_responded_idx
  on public.job_applications (user_id, responded_at desc)
  where responded_at is not null;

-- ---------------------------------------------------------------------------
-- The reply trigger
-- ---------------------------------------------------------------------------
--
-- # Trigger, not pg_cron, and the trade that decides it
--
-- A 15-minute `UPDATE ... FROM` on pg_cron would work and would be simpler to
-- reason about. It is not what this uses, for two reasons:
--
--   1. The cron job would run ~96 times a day to find something a handful of
--      times a month. The trigger runs only when mail actually lands, and its
--      steady-state cost is one index probe that returns nothing.
--   2. A cron job is a second thing that can be silently not-installed. Half of
--      this feature already lives in the mail pipeline; hanging the other half
--      off a schedule nobody looks at is how "it worked in testing" happens.
--
-- The hazard checked before choosing it: the mail ingest writes in BULK, via
-- `upsert` on `(user_id, external_id)`. So the cost profile matters.
--
-- ## Cost profile, per ingested mail row
--
--   INSERT (a message never seen before)
--     WHEN clause rejects rows with a null `thread_id` before the function is
--     entered at all. Otherwise: ONE btree probe of
--     `job_submission_attempts_thread_idx`. That index covers only sent
--     applications — tens of rows after a year of applying, one or two pages,
--     permanently in cache. No match is the 99.9% case and costs nothing beyond
--     the probe.
--
--   UPDATE (the same message re-ingested — n8n re-reads an overlapping window of
--   the inbox on EVERY run, so this is the common case, not the rare one)
--     `ON CONFLICT DO UPDATE` fires UPDATE triggers, not INSERT ones. The UPDATE
--     trigger's WHEN clause additionally requires `thread_id` to have CHANGED,
--     which for a re-ingested message it has not. The function is never entered.
--     That is the difference between "cheap on re-fire" and "not re-fired".
--
-- And if it did re-fire, it is idempotent: the UPDATE is guarded on
-- `status = 'submitted'`, and 'response' is not 'submitted', so the second pass
-- matches no rows. Which is also what makes the transition ONE-WAY — a thread
-- with a five-message conversation in it moves the application exactly once, on
-- the first reply, and `responded_at` keeps the first answer's timestamp.
--
-- ## Race safety
--
-- `where a.status = 'submitted'` inside the UPDATE is the whole mechanism, the
-- same shape as every other transition in this pipeline (`notify_result`'s
-- `eq("status","draft")`, `apply_queue`'s `eq("status","approved")`). Two
-- concurrent mail inserts in the same thread serialise on the application row's
-- lock; the loser re-evaluates the predicate against the committed row, sees
-- 'response', and updates nothing.
--
-- ## Why `submitted_at < received_at`
--
-- Without it, ingesting old mail — a backfill, a widened sync window — could
-- match a conversation that predates the application entirely (we replied INTO
-- an existing thread, or Gmail stitched a thread on subject). A reply cannot
-- precede the thing it replies to.
--
-- ## Why `s.ok is true`
--
-- `ok is null` means "n8n never reported back" — a run the Mac slept through
-- (see the column's comment in 20260826120000). An attempt we cannot confirm
-- left the machine is not proof of a conversation. The application would still
-- be sitting in `queued` in that case and would fail the status guard anyway;
-- this makes the intent explicit rather than incidental.

create or replace function public.job_mail_reply_match()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  -- Driven FROM the attempts index, not from job_applications: starting at
  -- `status = 'submitted'` would scan every application this user has ever sent
  -- on every single ingested mail row.
  --
  -- If one application has several attempts sharing a thread (a retry into the
  -- same conversation), the join yields several source rows. Postgres updates
  -- the target row once, picking one source arbitrarily — harmless here because
  -- every source produces identical SET values.
  update public.job_applications a
     set status       = 'response',
         responded_at = new.received_at,
         -- Cleared for the same reason `apply_result` clears it on success: a row
         -- that failed, was re-approved, went out and then got an answer must not
         -- keep advertising a reason it no longer has.
         fail_reason  = null
    from public.job_submission_attempts s
   where s.thread_id      = new.thread_id
     and s.user_id        = new.user_id
     -- `is true`, not `= true`: `ok` is nullable and NULL must read as "no".
     -- Written this way rather than with coalesce() because COALESCE is a
     -- grammar construct and cannot be schema-qualified, which under
     -- `search_path = ''` is a distinction worth not having to think about.
     and s.ok is true
     and a.id             = s.application_id
     and a.user_id        = new.user_id
     and a.status         = 'submitted'
     and a.submitted_at is not null
     and a.submitted_at   < new.received_at;

  -- AFTER trigger: the return value is discarded, and NULL makes that explicit.
  -- Nothing here writes to mail_messages — that table belongs to the mail
  -- pipeline, and a job trigger mutating its rows would be the kind of hidden
  -- cross-feature coupling nobody finds until it misbehaves.
  return null;
end;
$fn$;

comment on function public.job_mail_reply_match() is
  'Moves a job application submitted -> response when an inbox message lands in '
  'the same Gmail thread the application was sent in. Read-only against '
  'mail_messages; one-way (guarded on status = ''submitted'').';

-- Two triggers, one function, because the WHEN clauses differ.
--
-- INSERT: a message we have never seen. Fire whenever it has a thread.
drop trigger if exists mail_messages_job_reply_ins on public.mail_messages;
create trigger mail_messages_job_reply_ins
  after insert on public.mail_messages
  for each row
  when (new.thread_id is not null)
  execute function public.job_mail_reply_match();

-- UPDATE: only when the thread id actually appears or changes. This is what
-- makes the re-ingest path free — the mail sync upserts the same messages every
-- run, and an unchanged `thread_id` never enters the function. It still catches
-- the real case it exists for: a row first written without a thread id (an
-- ingest that could not read one) acquiring one later.
--
-- `after update of thread_id` narrows it further: an UPDATE that does not
-- mention the column — the triage pass writing `score` / `importance` /
-- `urgency`, which is most updates this table sees — does not evaluate the WHEN
-- clause at all.
drop trigger if exists mail_messages_job_reply_upd on public.mail_messages;
create trigger mail_messages_job_reply_upd
  after update of thread_id on public.mail_messages
  for each row
  when (new.thread_id is not null and new.thread_id is distinct from old.thread_id)
  execute function public.job_mail_reply_match();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Nothing to add. Both tables already carry their `auth.uid()`-scoped owner
-- policies, and neither new column changes who may read what.
--
-- One thing worth being explicit about, because it looks like a hole and is not:
-- the trigger function is NOT `security definer`. It does not need to be. A
-- trigger body runs as part of the statement that fired it, and RLS does not
-- apply to a table's own trigger execution — the mail pipeline's service-role
-- insert is what fires this, and it already bypasses RLS. Adding
-- `security definer` would grant the function the ability to update ANY user's
-- applications from a row an ordinary session inserted, which is precisely the
-- privilege it must not have. The `user_id` equality on both sides of the join
-- is what keeps one user's mail from ever touching another's applications, and
-- with an invoker-rights function that check is real rather than decorative.

-- ---------------------------------------------------------------------------
-- Verification recipe
-- ---------------------------------------------------------------------------
--
-- Run this AFTER applying the migration, in the SQL editor. It creates a
-- throwaway profile / posting / application / attempt, drops a fake inbox message
-- into the thread, asserts the transition happened, and rolls the lot back. It
-- writes nothing that survives, so it is safe against the live database — but it
-- does fire the real triggers, which is the entire point.
--
-- Uncomment to run.
--
-- begin;
-- do $$
-- declare
--   _uid  uuid;
--   _prof uuid;
--   _post uuid;
--   _app  uuid;
--   _tid  text := 'reply-loop-selftest-' || gen_random_uuid()::text;
--   _st   text;
--   _at   timestamptz;
-- begin
--   select id into _uid from auth.users order by created_at limit 1;
--   if _uid is null then raise exception 'no auth user to test with'; end if;
--
--   insert into public.job_profiles (user_id, name)
--        values (_uid, 'reply-loop-selftest')
--     returning id into _prof;
--
--   insert into public.job_postings
--          (user_id, source_kind, url, external_id, dedupe_key, title)
--        values (_uid, 'selftest', 'test://reply-loop/1', 'selftest-1',
--                'selftest-reply-loop', 'Test Posting')
--     returning id into _post;
--
--   insert into public.job_applications
--          (user_id, posting_id, profile_id, status, submitted_at, fail_reason)
--        values (_uid, _post, _prof, 'submitted', now() - interval '2 days',
--                'stale_reason_that_must_be_cleared')
--     returning id into _app;
--
--   -- proof only: the BEFORE INSERT trigger must derive the column.
--   insert into public.job_submission_attempts (user_id, application_id, ok, proof)
--        values (_uid, _app, true,
--                jsonb_build_object('gmail_message_id', 'm1', 'thread_id', _tid));
--
--   assert (select thread_id from public.job_submission_attempts
--            where application_id = _app) = _tid,
--          'thread_id was not derived from proof';
--
--   -- 1. an unrelated message must not move anything
--   insert into public.mail_messages (user_id, external_id, thread_id, sender, received_at)
--        values (_uid, 'selftest-noise', 'some-other-thread',
--                'newsletter@example.com', now());
--   assert (select status from public.job_applications where id = _app) = 'submitted',
--          'an unrelated thread moved the application';
--
--   -- 2. the reply
--   insert into public.mail_messages (user_id, external_id, thread_id, sender, received_at)
--        values (_uid, 'selftest-reply-1', _tid, 'no-reply@teamtailor.com',
--                now() - interval '1 hour');
--
--   select status, responded_at into _st, _at
--     from public.job_applications where id = _app;
--   assert _st = 'response', 'status did not move to response (got ' || _st || ')';
--   assert _at is not null,  'responded_at was not stamped';
--   assert (select fail_reason from public.job_applications where id = _app) is null,
--          'fail_reason was not cleared';
--
--   -- 3. one-way: a second message in the same thread changes nothing
--   insert into public.mail_messages (user_id, external_id, thread_id, sender, received_at)
--        values (_uid, 'selftest-reply-2', _tid, 'someone@company.dk', now());
--   assert (select responded_at from public.job_applications where id = _app) = _at,
--          'a later message in the thread rewrote responded_at';
--
--   -- 4. re-ingest of the same message (the upsert path) is a no-op
--   insert into public.mail_messages (user_id, external_id, thread_id, sender, received_at)
--        values (_uid, 'selftest-reply-1', _tid, 'no-reply@teamtailor.com',
--                now() - interval '1 hour')
--   on conflict (user_id, external_id) do update set snippet = 'reingested';
--   assert (select responded_at from public.job_applications where id = _app) = _at,
--          're-ingest changed responded_at';
--
--   raise notice 'reply loop OK — status=% responded_at=%', _st, _at;
-- end;
-- $$;
-- rollback;
--
-- ## Recovering a miss
--
-- There is one ordering the trigger cannot catch: a reply ingested into
-- `mail_messages` BEFORE the attempt row carrying its thread id exists. That
-- window is the seconds between n8n handing the message to Gmail and n8n
-- reporting `apply_result`, so in practice it needs the employer to answer
-- inside that window. If it ever happens, this is the reconcile — same predicate,
-- driven from the other side:
--
-- update public.job_applications a
--    set status = 'response',
--        responded_at = m.received_at,
--        fail_reason = null
--   from public.job_submission_attempts s
--   join public.mail_messages m
--     on m.thread_id = s.thread_id and m.user_id = s.user_id
--  where a.id = s.application_id
--    and a.user_id = s.user_id
--    and a.status = 'submitted'
--    and s.ok is true
--    and a.submitted_at is not null
--    and a.submitted_at < m.received_at;
