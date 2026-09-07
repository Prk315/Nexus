-- 20260906120000_housing_pipeline.sql
--
-- The housing finder: five tables that let a locally-hosted n8n instance discover
-- cheap rooms and flats near Nørre Campus, keep a register of the waiting lists
-- he is actually on, and hand both to a panel it can never talk to directly.
--
--   housing_criteria            what he is looking for — the modularity surface
--   housing_sources             where to look — one row per discoverer instance
--   housing_buildings           Lane A: a building you QUEUE for
--   housing_waitlist_positions  Lane A: the seniority asset register
--   housing_listings            Lane B: a listing you RACE for
--
-- Created in that order because of the FK chain: sources -> criteria,
-- waitlist_positions -> buildings, listings -> sources.
--
-- # Why a table at all
--
-- Identical reasoning to `20260823120000_n8n_mail_bus.sql` and
-- `20260824120000_job_pipeline.sql`, which should be read first. Vault /
-- PathFinder / Protocol are HTTPS pages on Vercel and structurally cannot fetch
-- `http://localhost:5678`; the phone is not on the Mac's loopback at all. So n8n
-- pushes its findings into Postgres and every client reads a row.
--
--   mit.s.dk JSON / lejebolig JSON-LD / boligzonen sitemap / Gmail alerts
--     -> n8n (Mac) -> local Qwen -> housing-ingest -> here
--
-- # The two-lane split, and why it is TWO TABLES and not one
--
-- `HOUSING_PLAN.md` §2 establishes this and it is the single most consequential
-- decision in the file. Lane A and Lane B are not two speeds of the same thing,
-- they are two different data models:
--
--   | | Lane A — housing_buildings | Lane B — housing_listings |
--   |---|---|---|
--   | the unit | a BUILDING you queue for | a LISTING that exists for hours |
--   | appears/vanishes? | no — Den Grønne Trekant is there next year | yes |
--   | what moves | your queue position, the building's wait time | the SET itself |
--   | what speed buys | nothing. 15-minute polling is pure waste | everything |
--
-- Forcing a building into `housing_listings` would give it a `posted_at` it does
-- not have, a `status` lifecycle it never traverses, and a `first_seen_at` that
-- is the only date it will ever carry. And it would make the panel render "95
-- available at Industri Kollegiet" — which is a lie: `tenancies_count` is the
-- number of UNITS in the building, and Lane A publishes no vacancies at all.
--
-- # Why these tables are not seeded
--
-- No seed rows anywhere. Every table is `user_id`-scoped to `auth.users` and a
-- migration has no session to attribute rows to. The panel creates criteria and
-- sources on first use. This is also why there is no "default criterion" — a
-- criterion that silently matched everything would make the gate look broken
-- rather than absent.

-- ---------------------------------------------------------------------------
-- housing_criteria
-- ---------------------------------------------------------------------------
--
-- The profile, as ROWS, not code. That is the whole of what "modular" means
-- here, and it is the `job_profiles` lesson applied a second time: adding
-- "I'd also take Frederiksberg under 7k" is an INSERT, not a workflow edit and
-- not a branch in an edge function. Every gate rule hangs off a criterion row.
--
-- ## Geography is a centre and a radius, not a postcode list
--
-- The thing he actually cares about is "how far is this from Universitetsparken",
-- and a postcode list answers that only by proxy — 2200 contains addresses 900 m
-- and 3.5 km from the campus and cannot tell them apart. A centre plus a radius
-- is the honest spelling, it is one haversine away from a real number, and
-- widening the search is editing one column instead of curating a list.
--
-- `center_lat`/`center_lng` are `double precision` (they are coordinates, and
-- `numeric` trig would be a cast on every evaluation); `radius_km` is `numeric`
-- because it is a quantity a human types.

create table if not exists public.housing_criteria (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  name          text not null,
  enabled       boolean not null default true,
  sort          integer not null default 0,

  -- Gate inputs. All nullable / empty-able, and every one of them means "do not
  -- gate on this" when absent — never "gate everything out". A criterion with
  -- every field null is a deliberate "notify me about everything in the radius".
  max_rent      integer,                              -- DKK/month, inclusive
  center_lat    double precision,
  center_lng    double precision,
  radius_km     numeric,
  types         text[] not null default '{}',         -- kollegie|studio|apartment|room
  min_rooms     numeric,
  max_rooms     numeric,

  -- Free context handed to Qwen in a later phase's scoring prompt. Deliberately
  -- prose: the one place a human can say something the columns cannot express.
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Half a coordinate is not a partial answer, it is a bug — and its symptom is
  -- the radius gate silently switching itself off for that criterion while the
  -- row still looks configured. Refuse it at the door.
  constraint housing_criteria_center_pair
    check ((center_lat is null) = (center_lng is null)),
  constraint housing_criteria_center_range
    check (center_lat is null or (center_lat between -90 and 90)),
  constraint housing_criteria_center_lng_range
    check (center_lng is null or (center_lng between -180 and 180)),
  -- A zero or negative radius reads as "nothing is ever near enough", which is
  -- indistinguishable in the panel from "the harvest found nothing". NULL is how
  -- you say "no distance gate".
  constraint housing_criteria_radius_positive
    check (radius_km is null or radius_km > 0),
  constraint housing_criteria_rooms_ordered
    check (min_rooms is null or max_rooms is null or min_rooms <= max_rooms)
);

create unique index if not exists housing_criteria_user_name_idx
  on public.housing_criteria (user_id, lower(name));

create index if not exists housing_criteria_user_enabled_idx
  on public.housing_criteria (user_id, enabled, sort);

-- ---------------------------------------------------------------------------
-- housing_sources
-- ---------------------------------------------------------------------------
--
-- One row per discoverer instance: a lejebolig search bound to a criterion, the
-- boligzonen sitemap, the daily mit.s.dk catalogue pull, the Gmail alert reader.
--
-- `kind` is unconstrained in the database for the same reason `n8n_requests.kind`
-- and `job_sources.kind` are: the allow-list lives in the edge function, where it
-- can change without a migration against a database that every branch shares
-- (CLAUDE.md, "One database, every branch"). The domain, documented here because
-- there is nowhere else to document it:
--
--   sdk_api             mit.s.dk /api/v2/public/buildings/*   -> Lane A, daily
--   lejebolig_jsonld    lejebolig.dk RealEstateListing        -> Lane B, 15 min
--   boligzonen_sitemap  boligzonen.dk sitemap diff            -> Lane B, 30 min
--   mail_alert          BoligAgent / søgeagent / akutbolig    -> Lane B, via mail bus
--
-- The three portals absent from that list — boligportal.dk, akutbolig.dk,
-- findbolig.nu — are absent on purpose and not as an oversight: each either
-- forbids automated collection outright or robots-disallows its whole search
-- surface, and the sanctioned channel for all three is their own email alert,
-- which arrives as `mail_alert`. See HOUSING_PLAN.md §5.

create table if not exists public.housing_sources (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  criteria_id  uuid references public.housing_criteria(id) on delete cascade,
  kind         text not null,
  enabled      boolean not null default true,
  -- {api_base,params} | {sitemap_url} | {search_url} | {gmail_query}
  config       jsonb not null default '{}'::jsonb,

  -- Observability, not correctness. A source that has never run and a source
  -- that ran and found nothing must be distinguishable in the panel — this is
  -- the "absent is never zero" house rule wearing its fourth hat, and the reason
  -- freshness must come from these columns (and from `n8n_requests`) rather than
  -- from `count(housing_listings)`. Zero listings means "nothing matched" OR
  -- "n8n has never run", and a panel rendering both as "No new listings ✓" is
  -- lying half the time.
  last_run_at  timestamptz,
  last_status  text,
  last_error   text,
  seen_count   integer not null default 0,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists housing_sources_user_enabled_idx
  on public.housing_sources (user_id, enabled);

-- ---------------------------------------------------------------------------
-- housing_buildings — Lane A
-- ---------------------------------------------------------------------------
--
-- A building is not a listing (see the header). It has no `posted_at` and no
-- `valid_through`, it never goes away, and its interesting property is a QUEUE.
--
-- The three booleans below are nullable on purpose. `short_wait` and
-- `ssl_eligible` come from endpoints that may not have been called this run, and
-- "we did not ask" must not render as "no" — the same rule that keeps
-- `blocking_state` unseeded and `job_postings.remote` three-valued. A false here
-- would remove a building from the shortlist on the strength of a missing fetch.

create table if not exists public.housing_buildings (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,

  source_kind    text not null,        -- 'sdk_api' | 'manual'
  -- mit.s.dk's `pk` as text, or a KKIK dorm name. Unique WITHIN a source only.
  external_id    text not null,

  name           text not null,
  address        text,
  zipcode        text,
  lat            double precision,
  lng            double precision,

  rent_min       integer,
  rent_max       integer,

  -- Computed by the edge function from the nearest enabled criterion's centre,
  -- never by the harvester — the harvester does not know the criteria. Stays
  -- NULL when the building has no coordinates or no criterion carries a centre.
  -- It is a DISPLAY denormalization: nothing gates on this column, because a
  -- criterion added after the sync would leave it stale.
  distance_km    numeric,

  short_wait     boolean,              -- from /public/buildings/short-wait-time/
  ssl_eligible   boolean,              -- Studiestartslisten, `is_ssl_enabled`
  administrator  jsonb,                -- {name, phone, email}

  -- The upstream record, kept whole for debugging a bad mapping. Bounded in the
  -- edge function (`boundedJson`), not here: a CHECK on the serialized length
  -- would run on every write and cannot be relaxed without a migration against a
  -- shared database. Over-large payloads store NULL rather than failing a batch.
  raw            jsonb,

  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- The `buildings_sync` upsert target. NOT partial: PostgREST cannot infer a
-- partial index for `on_conflict`, the same trap that broke `garmin-import`'s
-- `(user_id, external_id)` and `pf_task_sessions`' `(task_id, cal_block_id)`.
create unique index if not exists housing_buildings_user_source_ext_idx
  on public.housing_buildings (user_id, source_kind, external_id);

create index if not exists housing_buildings_user_seen_idx
  on public.housing_buildings (user_id, last_seen_at desc);

-- ---------------------------------------------------------------------------
-- housing_waitlist_positions
-- ---------------------------------------------------------------------------
--
-- Hand-maintained and panel-editable: one row per list he is actually on. This
-- is the table that makes Lane A worth anything. Without it the system cannot
-- tell "38 candidate buildings" from "38 buildings I am already queued for", and
-- its highest-value output — the one-time enrolment report — would be advice to
-- re-register somewhere he has three years of seniority banked.
--
-- Nothing writes here automatically and nothing should. Every provider in Lane A
-- is either login-walled (findbolig.nu returns 401) or an ASP.NET postback
-- (KKIK), and a scraper carrying his session is the specific thing that gets
-- accounts terminated rather than IPs rate-limited (HOUSING_PLAN.md §5).
--
-- `building_id` is NULLABLE and `ON DELETE SET NULL`, never CASCADE: he is on
-- lists (KAB's ventelistenummer, fsb) that correspond to no building in
-- `housing_buildings` at all, and deleting a catalogue row must never delete the
-- record of years of seniority. Same reasoning as `pf_tasks.goal_id`.

create table if not exists public.housing_waitlist_positions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  building_id   uuid references public.housing_buildings(id) on delete set null,

  -- Free text, and required: it is what identifies the list when there is no
  -- building row behind it ("KAB ventelistenummer", "CIU almindelig venteliste").
  list_name     text not null,

  signed_up_at  date,
  -- Nullable, and it must stay that way. Most providers publish no number at
  -- all, and "we have never been told" is a different fact from "you are #1".
  -- `last_checked` is what says which of the two a null means.
  "position"    integer,
  last_checked  date,
  notes         text,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists housing_waitlist_user_idx
  on public.housing_waitlist_positions (user_id, signed_up_at);

create index if not exists housing_waitlist_building_idx
  on public.housing_waitlist_positions (building_id);

-- ---------------------------------------------------------------------------
-- housing_listings — Lane B
-- ---------------------------------------------------------------------------

create table if not exists public.housing_listings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,

  source_kind     text not null,
  source_id       uuid references public.housing_sources(id) on delete set null,

  -- Unique WITHIN a source. lejebolig's numeric listing id, boligzonen's slug,
  -- a Gmail message id for an alert-derived listing.
  external_id     text not null,

  url             text not null,
  title           text not null,
  address         text,
  zipcode         text,
  lat             double precision,
  lng             double precision,

  -- ⚠️ NULLABLE, and the reason is the house rule: **absent is never zero.**
  -- Danish ads routinely say "pris efter aftale" and the mail alerts often carry
  -- no figure at all. A `not null default 0` would make every price-less ad the
  -- cheapest thing in the database and pass every budget gate as a bargain;
  -- rejecting them at ingest instead would silently lose real listings in the
  -- lane where a missed listing IS the loss. So: null, and the gate treats a null
  -- rent as INCONCLUSIVE — it passes with a flag rather than passing as 0.
  rent            integer,
  rooms           numeric,
  sqm             integer,
  deposit         integer,

  available_from  date,
  posted_at       timestamptz,

  -- 'kollegie' | 'studio' | 'apartment' | 'room'. Nullable: many portals do not
  -- say, and an unknown type must not be gated out of a criterion's `types`.
  housing_type    text,

  -- Bounded in the edge function, not by a CHECK — same reasoning as
  -- `housing_buildings.raw`.
  description     text,

  -- Display only, computed at ingest from the nearest enabled criterion's
  -- centre. `notify_pending` recomputes distance live from `lat`/`lng` and never
  -- reads this column, because a criterion edited after ingest would leave it
  -- stale and a gate reading a stale number is a gate that is quietly wrong.
  distance_km     numeric,

  -- ## `dedupe_key` is computed by the EXTRACTOR and never server-side
  --
  -- Unique ACROSS sources. The same flat appears on lejebolig and on boligzonen
  -- under different ids and different URLs, and boligdeal aggregates both — so a
  -- URL-keyed or id-keyed dedup yields triplicates, and downstream that is three
  -- enquiries to one landlord, which is a worse outcome than a missed listing.
  --
  -- The rule, written here because this comment is the contract and the
  -- extractor's implementation is the thing that must agree with it:
  --
  --     dedupe_key = lower(
  --         normalizeStreet(address)      -- street + number, diacritics folded,
  --                                       -- punctuation and 'st.'/'tv'/'th'
  --                                       -- floor-and-side suffixes removed
  --       + '|' + zipcode                 -- 4 digits, or '' when unknown
  --       + '|' + rent                    -- integer DKK, or '' when unknown
  --     )
  --
  -- It is NEVER recomputed in `housing-ingest`. Two implementations of a matching
  -- rule is the mistake CLAUDE.md already records the cost of twice (garmin's
  -- mapping, the BIA calibration constants), and the failure mode here is
  -- specifically nasty: a drifted key does not error, it produces a second row
  -- for a flat that is already stored. So a listing arriving without a key is
  -- REJECTED with a reason rather than quietly given a locally-invented one.
  dedupe_key      text not null,

  -- discovered -> notified -> contacted, with dismissed / dead as side exits.
  -- Free text for the same reason `job_postings.status` is: the allow-list lives
  -- in the edge function, changeable without a migration against a shared
  -- database. The domain:
  --
  --   discovered  ingested; no email has gone out about it
  --   notified    a decision email was sent (`notify_result` ok:true)
  --   contacted   he wrote to the landlord
  --   dismissed   he said no
  --   dead        the ad 404s, or the search stopped carrying the id
  status          text not null default 'discovered',

  -- Set once, on insert, by the column default — the harvest upsert deliberately
  -- does not carry this column, so a re-harvest cannot rewrite it. See the
  -- clobber note on the unique index below.
  first_seen_at   timestamptz not null default now(),

  -- Stamped by `notify_result`, and nothing clears it. It is the one column that
  -- is a claim about the world ("an email about this listing has left the
  -- machine"), which is why the notify queue keys off it rather than off
  -- `status` alone: a status can be walked back by a bug or a hand-edit, and two
  -- decision emails for one flat is two live review links.
  notified_at     timestamptz,
  -- The Gmail message id `notify_result` reports. A notify that cannot say which
  -- message it went out in is an unfalsifiable claim.
  notify_message_id text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- The harvest upsert target. NOT partial, for the `on_conflict` reason above.
--
-- ⚠️ **The re-harvest clobber, which this pipeline is built to avoid from day
-- one.** `job-ingest` had to be repaired for exactly this: a DO-UPDATE upsert
-- whose payload carried `status: 'discovered'` walked every already-notified row
-- back to un-notified on the next harvest, and Lane B re-harvests the SAME ad
-- every 15 minutes by construction. The fix is structural rather than a WHERE
-- clause: `housing-ingest` simply OMITS `status`, `first_seen_at`, `notified_at`
-- and `notify_message_id` from the upserted payload. PostgREST builds both the
-- INSERT column list and the DO UPDATE SET list from the keys present in the
-- body, so a column that is absent takes its DEFAULT on insert and is left
-- untouched on conflict. Content columns (rent, title, available_from, …) do
-- refresh, which is what a re-harvest is for.
create unique index if not exists housing_listings_user_source_ext_idx
  on public.housing_listings (user_id, source_kind, external_id);

create index if not exists housing_listings_user_dedupe_idx
  on public.housing_listings (user_id, dedupe_key);

-- The `notify_pending` scan: status-filtered, oldest first. In a race lane the
-- backlog must drain in arrival order — a newest-first queue starves the listing
-- that has been waiting longest, which is also the one closest to being gone.
create index if not exists housing_listings_user_status_idx
  on public.housing_listings (user_id, status, first_seen_at desc);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
--
-- A clone of `public.job_touch_updated_at()` rather than a reuse of it. Two
-- pipelines sharing one trigger function couples their deploys for no benefit,
-- and the prefix is what makes the ownership of a database object legible at a
-- glance in a project where seven apps share one schema.
--
-- `set search_path = ''` is not decoration. Supabase's security linter flags a
-- mutable search_path (0011_function_search_path_mutable): a function that
-- resolves names against a caller-controlled path can be aimed at a shadowing
-- object. The body only assigns a timestamp, but `now()` is itself resolved
-- through that path — so pin it, and schema-qualify what remains.

create or replace function public.housing_touch_updated_at()
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
  foreach t in array array[
    'housing_criteria','housing_sources','housing_buildings',
    'housing_waitlist_positions','housing_listings'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format(
      'create trigger %I before update on public.%I
         for each row execute function public.housing_touch_updated_at()',
      t || '_touch', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- `auth.uid()`-scoped, and deliberately WITHOUT an anon policy — the same
-- posture as `job_*`, `mail_messages` and `n8n_requests`, and the opposite of the
-- thirteen permissive productivity tables in SECURITY_RLS_MIGRATION.md. Those
-- thirteen are a defect being migrated away from, not a convention to copy.
--
-- These rows carry where a person is trying to live: the addresses he is looking
-- at, what he can afford, and which waiting lists he is on. The repo is public
-- and the anon key ships inside the iOS binary, so `USING (true)` here would
-- publish exactly that. It is strictly more sensitive than the job search, which
-- already gets this treatment.
--
-- ⚠️ Consequence for every client: read these with the AUTHENTICATED `supabase`
-- client, never `supabasePublic`. A mismatched JWT returns an EMPTY SET, not an
-- error — an empty housing panel is indistinguishable from "nothing matched
-- today", which is the reassuring-looking answer in a lane where the whole
-- product is not missing things.
--
-- n8n has no session and does not read these directly: it goes through the
-- `housing-ingest` edge function with a scoped secret, exactly like `job-ingest`,
-- `n8n-ingest` and `usage-ingest`.

alter table public.housing_criteria            enable row level security;
alter table public.housing_sources             enable row level security;
alter table public.housing_buildings           enable row level security;
alter table public.housing_waitlist_positions  enable row level security;
alter table public.housing_listings            enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'housing_criteria','housing_sources','housing_buildings',
    'housing_waitlist_positions','housing_listings'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_owner', t);
  end loop;
end;
$$;
