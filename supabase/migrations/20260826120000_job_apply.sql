-- 20260826120000_job_apply.sql
--
-- Phase 3 of the job applier: the human-approval and submission state machine.
--
--   job_profiles.approval_threshold   per-profile "worth asking about" score
--   job_applications.*                the approval + submission columns
--   job_submission_attempts           the append-only proof log
--
-- Additive only. Nothing here drops or narrows anything, which is the rule that
-- matters most in this repo: there is one database behind every branch
-- (CLAUDE.md, "One database, every branch"), phases 1 and 2 are LIVE in
-- production, and the harvest workflow calls `job-ingest` every 30 minutes
-- against these exact tables while this file is being applied.
--
-- # The invariant this phase exists to protect
--
-- **Nothing is ever sent without an explicit human approval.** Not "nothing
-- high-risk", not "nothing below a threshold" — nothing. Every column below is
-- either part of recording that a human said yes, or part of proving what was
-- sent afterwards.
--
-- That is why approval is a *state transition*, not a boolean. A boolean can be
-- set by any writer at any time and carries no evidence; a transition guarded on
-- its predecessor (`update ... where status = 'needs_approval'`) can only be made
-- once, from one place, and leaves `approved_at` / `approved_via` behind as the
-- record. The guard lives in the edge functions' WHERE clauses rather than in a
-- trigger, for the same reason PathFinder's scheduling gate lives in
-- `setTaskStage`: the predicate spans several tables and taxing every unrelated
-- write with it buys nothing.
--
-- # The status domain
--
-- `status` stays free text, exactly like `job_sources.kind`, `job_postings.status`
-- and `n8n_requests.kind`. The allow-list lives in the edge functions, where it
-- can change without a migration against a database every branch shares. The
-- domain, documented here because there is nowhere else to document it:
--
--   draft            assembled by `evaluate_result`; not yet shown to a human
--     -> needs_approval   a decision email was sent (`notify_result` ok:true)
--       -> approved       the human clicked Approve on the review page
--         -> queued       `apply_queue` handed it to n8n, all guards re-passed
--           -> submitted  n8n sent it; `job_submission_attempts` holds the proof
--
-- Side exits, none of which return:
--
--   cancelled   the human clicked Reject, or a duplicate application to the same
--               company was already submitted
--   expired     the ad's `valid_through` passed before it was sent
--   failed      Gmail refused; `fail_reason` says why, the attempt row has detail
--
-- 'response' is reserved for a later phase (an employer replied). It is named
-- here so the vocabulary is decided before two workflows invent two spellings.
--
-- A row can sit in `approved` indefinitely without being an error: `apply_queue`
-- SKIPS rather than fails when the CV module is still a stub or the ad is not an
-- email-apply channel, because both unblock the moment a human fixes them. Only
-- states nothing can recover from (`expired`, `cancelled`, `failed`) are terminal.

-- ---------------------------------------------------------------------------
-- job_profiles.approval_threshold
-- ---------------------------------------------------------------------------
--
-- Per profile, for the same reason `keywords` is per profile: the threshold is a
-- statement about a *target category*, not about the person. A Game Dev role at
-- 70 may be well worth an email while a Data Science role at 70 is not, and the
-- point of `job_profiles` being rows is that expressing that costs an UPDATE
-- rather than a workflow edit.
--
-- 75 is a deliberate starting position rather than a tuned one. It is high enough
-- that the first week of decision emails is small enough to actually read, which
-- is the only property that matters at the start: a threshold that floods the
-- inbox trains the human to approve without reading, and an approval nobody read
-- is the failure this whole phase is built to prevent.
--
-- NOT NULL with a default so every existing row acquires it atomically. A
-- nullable threshold would need every consumer to decide what null means, and the
-- two plausible answers ("never notify" and "always notify") are opposites.

alter table public.job_profiles
  add column if not exists approval_threshold integer not null default 75;

comment on column public.job_profiles.approval_threshold is
  'Minimum job_matches.score for a draft against this profile to be emailed for '
  'approval. Per-profile because it is a statement about a target category.';

-- ---------------------------------------------------------------------------
-- job_applications: the approval + submission columns
-- ---------------------------------------------------------------------------
--
-- `approval_token` is the whole authentication story for the review page. The
-- link goes into an email that lands in a normal inbox, opened in a normal
-- browser with no Supabase session; `job-approve` runs with `verify_jwt = false`
-- and the token IS the credential.
--
-- A v4 uuid carries 122 bits of entropy from `gen_random_uuid()`, which is
-- `pgcrypto`'s CSPRNG — not guessable, and not enumerable in any useful sense.
-- What it deliberately is NOT is revocable or expiring on its own: it stops
-- working because the *status* moves off `needs_approval`, which is what makes it
-- single-use. The token is never nulled, so revisiting the link after deciding
-- still renders the current state instead of a 404 — a dead link after clicking
-- Approve reads as "did that work?", and a human who is unsure re-clicks.
--
-- NOT NULL with a default, so every draft written by the LIVE phase-2 function
-- gets one without `job-ingest` being redeployed first. That ordering matters:
-- the migration is applied before the function is deployed, and for the window in
-- between the old code keeps upserting drafts that must still be reviewable.

alter table public.job_applications
  add column if not exists approval_token uuid not null default gen_random_uuid();

-- When the decision email went out. NULL is the queue predicate for
-- `notify_queue` ("never asked"), which is a different fact from
-- `status = 'draft'` (a re-run could reset a status; it cannot un-send an email).
alter table public.job_applications
  add column if not exists approval_requested_at timestamptz;

alter table public.job_applications
  add column if not exists approved_at timestamptz;

-- How the human said yes. 'email_link' today; a panel button or a widget later.
-- Recorded because "who approved this, and through what" is the first question
-- asked about an application nobody remembers approving.
alter table public.job_applications
  add column if not exists approved_via text;

alter table public.job_applications
  add column if not exists queued_at timestamptz;

alter table public.job_applications
  add column if not exists submitted_at timestamptz;

-- 'email' today. Named rather than assumed so an ATS or a form-filling channel
-- later does not have to be inferred from the absence of a Gmail message id.
alter table public.job_applications
  add column if not exists submit_channel text;

-- Why a terminal state is terminal: 'valid_through_passed',
-- 'duplicate_company_application', or a sanitized Gmail error. Short and
-- machine-ish on purpose — the long form lives in `job_submission_attempts.error`.
alter table public.job_applications
  add column if not exists fail_reason text;

comment on column public.job_applications.status is
  'draft -> needs_approval -> approved -> queued -> submitted, with cancelled / '
  'expired / failed as terminal side-exits and ''response'' reserved for a later '
  'phase. Free text; the allow-list lives in job-ingest and job-approve.';

comment on column public.job_applications.approval_token is
  'Bearer credential for the job-approve review page. Unguessable (122-bit v4 '
  'uuid); single-use because the status transition it authorises can only fire '
  'from needs_approval. Never nulled — a revisit must still render state.';

-- The token lookup in `job-approve` is the hot path of a page a human is waiting
-- on, and it is the only query in this project that reaches a row WITHOUT a
-- user_id. Unique because a collision would mean one link opening two
-- applications, which is the one way this design could send the wrong letter.
create unique index if not exists job_applications_approval_token_idx
  on public.job_applications (approval_token);

-- `notify_queue` scans `status = 'draft' and approval_requested_at is null`;
-- `apply_queue` scans `status = 'approved'`. Both are per-user. NOT partial:
-- partial indexes here would have to name every status the queues care about, and
-- this project has already been bitten twice by partial indexes (PostgREST cannot
-- infer one for `on_conflict`). The existing `job_applications_user_status_idx`
-- covers the status half; this adds the submitted-today daily-cap count.
create index if not exists job_applications_user_submitted_idx
  on public.job_applications (user_id, submitted_at desc);

-- ---------------------------------------------------------------------------
-- job_submission_attempts
-- ---------------------------------------------------------------------------
--
-- The audit trail. One row per attempt to actually send an application.
--
-- # Why this is not a column on job_applications
--
-- One application can fail and be retried. Gmail refuses for reasons that are
-- transient (rate limit, expired OAuth) and reasons that are not (malformed
-- recipient), and collapsing every attempt into `job_applications.fail_reason`
-- keeps only the last one — so the row that failed four times looks exactly like
-- the row that failed once, and "is this address rejecting us or was that a
-- blip?" becomes unanswerable.
--
-- # Why `proof` matters more than the status column does
--
-- `job_applications.status = 'submitted'` is a claim this system makes about
-- itself. `proof` is the evidence: the Gmail message id, the thread id, and
-- whatever else n8n can name about what left the machine. The question it exists
-- to answer is "what EXACTLY did we send this company" — asked, in practice,
-- when a recruiter replies quoting a sentence nobody recognises, or when the
-- same company appears twice and someone needs to know whether the first letter
-- actually went out.
--
-- jsonb rather than columns because it is a record of what an external system
-- said, not a queryable relation — identical reasoning to `job_matches.
-- module_plan`. Bounded in the edge function, like `ld_json`.
--
-- # Append-only, and therefore no updated_at trigger
--
-- Nothing rewrites an attempt. A retry is a new row; that is the entire point.
-- Giving it an `updated_at` would advertise a mutability that must not exist.

create table if not exists public.job_submission_attempts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  application_id uuid not null references public.job_applications(id) on delete cascade,

  started_at     timestamptz not null default now(),
  finished_at    timestamptz,

  -- Nullable, deliberately, and for the same reason `job_matches.score` is: an
  -- attempt that started and never reported back is a real and distinguishable
  -- state. `ok = false` means "we know it failed"; `ok is null` means "we never
  -- heard", which is the shape of an n8n run the Mac slept through. Defaulting it
  -- to false would turn every lost report into a recorded failure, and the whole
  -- point of this table is that it does not guess.
  ok             boolean,

  proof          jsonb,
  error          text,

  created_at     timestamptz not null default now()
);

-- "What happened to this application, most recent first" — the only way this
-- table is ever read.
create index if not exists job_submission_attempts_app_idx
  on public.job_submission_attempts (application_id, started_at desc);

create index if not exists job_submission_attempts_user_idx
  on public.job_submission_attempts (user_id, started_at desc);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
--
-- `job_applications` already carries its `_touch` trigger from 20260825120000,
-- and `job_profiles` from 20260824120000. Neither needs re-creating; adding a
-- column does not disturb a trigger.
--
-- `job_submission_attempts` gets none. It is append-only (see above), and
-- `public.job_touch_updated_at()` would fail on it anyway — there is no
-- `updated_at` column to assign.

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- Identical posture to the six tables before it: `auth.uid()`-scoped, no anon
-- policy. Same DO-loop so the policy text cannot drift between tables.
--
-- The stakes are higher here than anywhere else in the pipeline. `proof` names
-- which companies were actually applied to and when — a complete record of a
-- private job search, on a public repo whose anon key ships inside an iOS binary.
-- `USING (true)` would publish it.
--
-- ⚠️ Read with the AUTHENTICATED `supabase` client, never `supabasePublic`. A
-- mismatched JWT returns an EMPTY SET, not an error, and an empty attempt log is
-- indistinguishable from "nothing has been sent" — which is precisely the
-- reassuring-looking answer this table exists to be able to contradict.
--
-- ## The one table read without a session, and why that is not a hole
--
-- `job-approve` looks `job_applications` up by `approval_token` alone, with no
-- `user_id` in the query. It runs service-role, so RLS is bypassed and this
-- policy is not what protects that path — the token's own unguessability is. The
-- distinction to hold onto: RLS scopes what a *session* may read, and the review
-- page has no session by design. Every other function in this pipeline matches
-- `user_id` on every query because it *can*; `job-approve` cannot, which is why
-- the token is a uuid from a CSPRNG and why the transitions it can drive are
-- guarded on `status = 'needs_approval'` and nothing else.

alter table public.job_submission_attempts enable row level security;

do $$
declare t text;
begin
  foreach t in array array['job_submission_attempts'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t);
  end loop;
end;
$$;
