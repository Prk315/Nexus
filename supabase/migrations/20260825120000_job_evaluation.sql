-- 20260825120000_job_evaluation.sql
--
-- Phase 2 of the job applier: the local Qwen scores a harvested posting, and an
-- application is ASSEMBLED from pre-written modules.
--
--   job_app_modules    the human-written paragraphs an application is built from
--   job_applications   one assembled draft per (posting, profile)
--   job_matches.module_plan   the model's plan: which modules, which gaps
--
-- Additive only. Nothing here drops or narrows a column, which matters because
-- there is one database behind every branch (CLAUDE.md, "One database, every
-- branch"): a new table is invisible to deployed code, a removal is not.
--
-- # The load-bearing idea: Qwen never writes prose
--
-- A Q4 7B model's cover letter is not sendable. It is fluent, generic, and — the
-- part that actually costs something — it will happily assert experience that
-- does not exist, because a cover letter is a genre it has memorised and the
-- genre says to sound qualified. Sending that to an employer is worse than
-- sending nothing.
--
-- So the division of labour is: the model **selects**, a human **writes**.
--
--   job_app_modules   rows of prose a human wrote once, tagged with what they
--                     evidence. Reusable across every application.
--   the model         reads the ad and picks a covering set of module ids.
--   assembly          deterministic concatenation of the chosen modules.
--
-- The model's output is therefore a list of uuids, not text. A uuid it invents
-- is dropped on sight (validated in `job-ingest`), and the coverage it was meant
-- to provide reappears as a **gap** — which is the second idea:
--
-- # A missing module is a visible gap, never a hallucinated sentence
--
-- `job_applications.missing_slots` names every slot the plan wanted and no
-- module covers, and the assembled body carries a literal
-- `[GAP: no module for 'project']` marker at that position. The draft is
-- deliberately not sendable until a human either writes the module or deletes
-- the line.
--
-- This is the same rule as `blocking_state` never being seeded: a missing
-- verdict must look missing. The failure mode being designed against is a draft
-- that reads perfectly well and quietly claims a Kubernetes project that never
-- happened — plausible-looking output is worse than visibly absent output,
-- because nothing downstream can tell the difference.

-- ---------------------------------------------------------------------------
-- job_app_modules
-- ---------------------------------------------------------------------------
--
-- Rows, not code — the same reasoning as `job_profiles`. Adding a new paragraph
-- about a Rust project is an insert; no workflow, function or prompt changes.
--
-- `slot` is deliberately free text rather than an enum. The conventional values
-- are 'intro', 'skill', 'project', 'education', 'closing', 'cv_link',
-- 'portfolio_link', but the model is shown the catalog and asked to choose from
-- *it*, so the vocabulary is whatever the rows say it is. An enum here would
-- mean a migration every time a new kind of paragraph is wanted, against a
-- database shared by every branch — the same reason `job_sources.kind` and
-- `n8n_requests.kind` keep their allow-lists in the edge function.
--
-- `tags` is what the module *evidences* (lowercase: 'python', 'pytorch',
-- 'unity'), and is the only thing the model matches against. It is metadata, not
-- prose: `content` is never sent to the model. That keeps the prompt small AND
-- keeps a person's written paragraphs out of a place they have no reason to be.

create table if not exists public.job_app_modules (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  name        text not null,          -- human handle, e.g. 'Intro — AI Engineer'
  slot        text not null,          -- 'intro' | 'skill' | 'project' | ...
  tags        text[] not null default '{}',
  lang        text not null default 'en',

  -- The prose. Written by a person, stored verbatim, concatenated verbatim.
  -- Nothing generated ever lands in this column.
  content     text not null,

  enabled     boolean not null default true,

  -- Assembly order. `(sort, name)` is the total order the assembler uses, and it
  -- must be total: a body whose paragraphs shuffle between two runs is not a
  -- draft, it is a diff nobody can review.
  sort        integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Case-insensitive, like `job_profiles_user_name_idx`. Two modules called
-- 'Intro' and 'intro' is a naming accident, not two modules.
create unique index if not exists job_app_modules_user_name_idx
  on public.job_app_modules (user_id, lower(name));

create index if not exists job_app_modules_user_enabled_idx
  on public.job_app_modules (user_id, enabled, sort);

-- ---------------------------------------------------------------------------
-- job_applications
-- ---------------------------------------------------------------------------
--
-- One draft per (posting, profile), for the same reason `job_matches` is keyed
-- that way: one ad can be applied to as a Game Dev and as an AI Engineer, and
-- those are two different letters made of two different module sets.
--
-- `body` is the assembled text. It is stored rather than recomputed on read
-- because the modules underneath it change: editing an 'intro' module next month
-- must not silently rewrite an application already sent. The draft is a snapshot.

create table if not exists public.job_applications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  posting_id    uuid not null references public.job_postings(id) on delete cascade,
  profile_id    uuid not null references public.job_profiles(id) on delete cascade,

  body          text,

  -- Provenance: exactly which modules produced `body`, in assembly order. A
  -- draft whose sources cannot be named is not reviewable.
  module_ids    uuid[] not null default '{}',

  -- The visible-gap mechanism. Every slot the plan asked for and no module
  -- covers. Non-empty means "do not send this yet"; the panel can surface it as
  -- a to-write list, which is exactly the useful artefact.
  missing_slots text[] not null default '{}',

  status        text not null default 'draft',  -- draft | ready | sent | dismissed

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- The upsert target for `job-ingest`'s `evaluate_result`. NOT partial: PostgREST
-- cannot infer a partial index for `on_conflict` — the trap that broke
-- `garmin-import`'s `(user_id, external_id)` and `pf_task_sessions`'
-- `(task_id, cal_block_id)`, and the reason `job_postings`' own upsert index is
-- written the same way.
create unique index if not exists job_applications_posting_profile_idx
  on public.job_applications (posting_id, profile_id);

create index if not exists job_applications_user_status_idx
  on public.job_applications (user_id, status, updated_at desc);

-- ---------------------------------------------------------------------------
-- job_matches.module_plan
-- ---------------------------------------------------------------------------
--
-- The model's plan verdict, kept beside its score:
--
--   {"job_type": "...",
--    "slots": [{"slot":"intro","module_id":"…"}, {"slot":"project","module_id":null}],
--    "missing_slots": ["project"],
--    "chosen": ["…"]}
--
-- jsonb rather than more columns because it is a *record of what the model said*,
-- not a queryable relation — the queryable facts (which modules, which gaps) are
-- normalized onto `job_applications` by the assembler. Storing it at all is what
-- makes a bad draft debuggable six weeks later without re-running inference.
--
-- Nullable, like `score`. Null means no plan was ever produced, which is a
-- different fact from "planned, chose nothing" (`{"chosen": []}`) — the same
-- distinction `score` is nullable to preserve.

alter table public.job_matches
  add column if not exists module_plan jsonb;

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
--
-- `public.job_touch_updated_at()` already exists from 20260824120000 with
-- `set search_path = ''` pinned. Reused rather than redefined: a second copy is
-- a second thing to forget to pin.

do $$
declare t text;
begin
  foreach t in array array['job_app_modules','job_applications'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.job_touch_updated_at()',
      t || '_touch', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- `auth.uid()`-scoped, no anon policy — identical posture to the four tables in
-- 20260824120000, and for a sharper reason. `job_app_modules.content` is a
-- person's own writing about their own career, and `job_applications.body` is a
-- letter they have not sent yet. The repo is public and the anon key ships
-- inside the iOS binary; `USING (true)` here would publish both.
--
-- ⚠️ Read these with the AUTHENTICATED `supabase` client, never `supabasePublic`.
-- A mismatched JWT returns an EMPTY SET, not an error — an empty module catalog
-- looks exactly like "no modules written yet", and the assembler would then
-- produce a draft that is nothing but gap markers.
--
-- n8n has no session and never touches these directly: it goes through
-- `job-ingest` with the scoped `JOB_INGEST_KEY`, and that function does the
-- owner check itself because the service role bypasses RLS.

alter table public.job_app_modules  enable row level security;
alter table public.job_applications enable row level security;

do $$
declare t text;
begin
  foreach t in array array['job_app_modules','job_applications'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t);
  end loop;
end;
$$;
