-- 20260824120000_job_pipeline.sql
--
-- The job applier: four tables that let a locally-hosted n8n instance discover
-- Danish job postings, score them against a local Qwen, and hand the result to a
-- header panel it can never talk to directly.
--
--   job_profiles   what you are looking for — the modularity surface
--   job_sources    where to look — one row per discoverer instance
--   job_postings   the normalized ad
--   job_matches    posting x profile: the gate verdict and the model's score
--
-- Created in that order because of the FK chain: sources -> profiles, matches ->
-- postings and profiles.
--
-- # Why a table at all
--
-- Identical reasoning to `20260823120000_n8n_mail_bus.sql`, which should be read
-- first. Vault / PathFinder / Protocol are HTTPS pages on Vercel and structurally
-- cannot fetch `http://localhost:5678`; the phone is not on the Mac's loopback at
-- all. So n8n pushes its findings into Postgres and every client reads a row.
--
--   Jobindex RSS / TheHub sitemap -> n8n (Mac) -> local Qwen -> job-ingest -> here
--
-- # Why these tables are not seeded
--
-- `job_profiles` and `job_sources` carry no seed rows. Both are `user_id`-scoped
-- to `auth.users`, and a migration has no session to attribute rows to. The panel
-- creates them on first use. This is also why there is no "default profile" — a
-- profile that silently matched everything would make the gate look broken.

-- ---------------------------------------------------------------------------
-- job_profiles
-- ---------------------------------------------------------------------------
--
-- The target categories — Game Dev, AI Engineering, Data Science — are ROWS, not
-- an enum and not code. That is the whole of what "modular" means here: adding a
-- fourth focus is an insert, and every gate rule and (later) module set hangs off
-- the profile rather than off a branch in a workflow.

create table if not exists public.job_profiles (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  name           text not null,
  enabled        boolean not null default true,
  sort           integer not null default 0,

  -- Gate inputs. Arrays rather than a rules table: unlike `mail_rules` these are
  -- not independently orderable objects with their own actions, they are five
  -- flat lists consumed by one pure function (`extract.js` cheapGate).
  keywords       text[] not null default '{}',
  exclude_terms  text[] not null default '{}',
  locations      text[] not null default '{}',
  languages      text[] not null default '{}',
  category_allow text[] not null default '{}',

  -- Free context handed to Qwen in the scoring prompt. Deliberately prose: it is
  -- the one place a human can say something the arrays cannot express.
  notes          text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists job_profiles_user_name_idx
  on public.job_profiles (user_id, lower(name));

-- ---------------------------------------------------------------------------
-- job_sources
-- ---------------------------------------------------------------------------
--
-- One row per discoverer instance, e.g. three Jobindex feeds (one per profile)
-- plus one TheHub sitemap. `kind` is unconstrained here for the same reason
-- `n8n_requests.kind` is: the allow-list lives in the edge function, where it can
-- be changed without a migration against a database shared by every branch.

create table if not exists public.job_sources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  profile_id   uuid references public.job_profiles(id) on delete cascade,
  kind         text not null,          -- 'jobindex_rss' | 'thehub_sitemap'
  enabled      boolean not null default true,
  config       jsonb not null default '{}'::jsonb,  -- {feed_url} | {sitemap_url}

  -- Observability, not correctness. A source that has never run and a source that
  -- ran and found nothing must be distinguishable in the panel.
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  seen_count   integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists job_sources_user_enabled_idx
  on public.job_sources (user_id, enabled);

-- ---------------------------------------------------------------------------
-- job_postings
-- ---------------------------------------------------------------------------

create table if not exists public.job_postings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  source_kind     text not null,
  source_id       uuid references public.job_sources(id) on delete set null,

  url             text not null,
  -- Where the actual ad text was read from. For Jobindex this is one hop past
  -- `url`: a /vis-job/ page is a stub carrying a banner and a link, and the body
  -- lives either on the employer's site or on jobindex.dk/jobannonce/.
  source_url      text,

  -- Unique WITHIN a source. Jobindex's 'h1691748', TheHub's JSON-LD identifier.
  external_id     text not null,

  -- Unique ACROSS sources. The same ad arrives from Jobindex, from TheHub and
  -- later from a LinkedIn alert under three different URLs, so a URL-keyed dedup
  -- yields triplicates — and three applications to one company, which is a worse
  -- outcome than a missed one. Derived as normalized company + title; see
  -- `dedupeKey` in n8n/job-applier/extract.js, which must agree with this column.
  dedupe_key      text not null,

  title           text not null,
  company         text,
  location        text,
  remote          boolean,          -- null = unknown, NOT false
  employment_type text,
  lang            text,

  posted_at       timestamptz,
  valid_through   timestamptz,

  description     text,
  ld_json         jsonb,            -- the raw JobPosting where one existed

  apply_channel   text,             -- 'email' | 'ats' | 'board' | 'unknown'
  apply_email     text,
  apply_url       text,
  ats_vendor      text,

  -- 'discovered' -> gate ran -> Qwen scored. Kept on the posting because it is a
  -- property of our pipeline's progress, not of any one profile's opinion.
  status          text not null default 'discovered',

  discovered_at   timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The ingest upsert target. NOT partial: PostgREST cannot infer a partial index
-- for `on_conflict`, the same trap that broke `garmin-import`'s
-- `(user_id, external_id)` and `pf_task_sessions`' `(task_id, cal_block_id)`.
create unique index if not exists job_postings_user_source_ext_idx
  on public.job_postings (user_id, source_kind, external_id);

create index if not exists job_postings_user_dedupe_idx
  on public.job_postings (user_id, dedupe_key);
create index if not exists job_postings_user_status_idx
  on public.job_postings (user_id, status, discovered_at desc);

-- ---------------------------------------------------------------------------
-- job_matches
-- ---------------------------------------------------------------------------
--
-- Kept separate from `job_postings` on purpose. A Unity gameplay role is a 90 for
-- the Game Dev profile and a 40 for Data Science: those are two verdicts about
-- one ad. Collapsing them into a single `score` column on the posting loses the
-- distinction and makes the number meaningless the moment a second profile
-- exists — and the second profile is the entire point of `job_profiles`.

create table if not exists public.job_matches (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  posting_id      uuid not null references public.job_postings(id) on delete cascade,
  profile_id      uuid not null references public.job_profiles(id) on delete cascade,

  -- Written by the rule-only gate, before any model runs. A drop ALWAYS carries a
  -- reason: an unexplained drop is indistinguishable from a crawler bug, and the
  -- gate is the component most likely to be silently over-eager.
  gate_verdict    text not null default 'pass',
  gate_reason     text,

  -- Nullable, and it must stay that way. Nothing is scored while the Mac is
  -- asleep, so "not yet evaluated" is a real and common state. A `default 0`
  -- would make un-scored sort as worst; the panel instead sorts
  -- `score desc nulls first` so un-triaged work lands at the TOP of the list.
  -- Same rule as `mail_messages.priority` and the never-seeded `blocking_state`.
  score           integer check (score between 0 and 100),
  required_skills text[] not null default '{}',
  matched_skills  text[] not null default '{}',
  missing_skills  text[] not null default '{}',
  reasoning       text,
  model           text,
  evaluated_at    timestamptz,

  status          text not null default 'new',  -- new | shortlisted | dismissed

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index if not exists job_matches_posting_profile_idx
  on public.job_matches (posting_id, profile_id);
create index if not exists job_matches_user_score_idx
  on public.job_matches (user_id, score desc nulls first);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------

-- `set search_path = ''` is not decoration. Supabase's security linter flags a
-- mutable search_path (0011_function_search_path_mutable): a function that
-- resolves names against a caller-controlled path can be aimed at a shadowing
-- object. The body only assigns a timestamp, but `now()` is itself resolved
-- through that path — so pin it, and schema-qualify what remains.
--
-- The older `public.set_updated_at` in this database still carries the warning.
-- New functions should not add to it.
create or replace function public.job_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$fn$;

do $$
declare t text;
begin
  foreach t in array array['job_profiles','job_sources','job_postings','job_matches'] loop
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
-- `auth.uid()`-scoped, and deliberately WITHOUT an anon policy — the same posture
-- as `mail_messages` / `n8n_requests` and the opposite of the thirteen permissive
-- productivity tables in SECURITY_RLS_MIGRATION.md. Those thirteen are a defect
-- being migrated away from, not a convention to copy.
--
-- These rows are a person's job search: which companies they are looking at and
-- which they were judged a poor fit for. The repo is public and the anon key ships
-- inside the iOS binary, so `USING (true)` here would publish exactly that.
--
-- ⚠️ Consequence for every client: read these with the AUTHENTICATED `supabase`
-- client, never `supabasePublic`. A mismatched JWT returns an EMPTY SET, not an
-- error — an empty jobs panel is indistinguishable from "nothing matched today".
--
-- n8n has no session and does not read these directly: it goes through the
-- `job-ingest` edge function with a scoped secret, exactly like `usage-ingest`
-- and `n8n-ingest`.

alter table public.job_profiles enable row level security;
alter table public.job_sources  enable row level security;
alter table public.job_postings enable row level security;
alter table public.job_matches  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['job_profiles','job_sources','job_postings','job_matches'] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t);
  end loop;
end;
$$;
