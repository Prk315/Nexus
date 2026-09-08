-- job_cv_entries — the modular CV
-- ===========================================================================
--
-- Additive only: one table, one trigger, one policy, two indexes. Nothing here
-- drops or narrows anything, which matters because there is one database behind
-- every branch (CLAUDE.md, "One database, every branch") — a new table is
-- invisible to deployed code, a removal is not. Re-runnable.
--
-- # Why this is not more rows in `job_app_modules`
--
-- It was the obvious first idea and it is wrong, for two independent reasons.
--
-- **The letter would eat them.** `assembleApplication` concatenates the
-- `content` of every chosen module into `job_applications.body`. `KNOWN_SLOTS`
-- bounds the slot vocabulary, but `knownSlotsOnly` deliberately unions it with
-- *whatever slots the catalog actually uses* — so the moment a `cv_experience`
-- row exists, `cv_experience` is a slot the model may ask for and a CV line
-- could be pasted into the middle of a cover letter. Nothing would error.
--
-- **The prompt would grow.** `action: "pending"` returns every enabled module to
-- the model, and `MAX_CATALOG` is 60. CV entries would crowd the catalog the
-- model actually chooses from, which is the failure `KNOWN_SLOTS` was introduced
-- to stop: an unbounded vocabulary let "name the gaps" become "enumerate the
-- requirements", and the enumeration crowded out the one job it had.
--
-- # And why a CV entry is structured where a module is prose
--
-- A letter paragraph is one blob because that is what it is — a person wrote a
-- paragraph and it is concatenated verbatim. A CV line is not prose: it has a
-- title, an organisation, a date range and bullets, and every renderer needs
-- those parts separately to lay them out. Storing "Instructor — High Performance
-- Programming and Systems, University of Copenhagen, 2026 – Present" as one
-- string means every consumer re-parses it, and they will disagree.
--
-- The rule the two tables share is the one that matters: **the text is written
-- by a person and reproduced verbatim.** Assembly may choose entries and order
-- them. It may not write, merge or summarise one. See `n8n/job-applier/cv.js`.

create table if not exists public.job_cv_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,

  -- Stable handle, e.g. 'work_nexus'. Unique per user, case-insensitively, so a
  -- seed can be re-run and an entry can be updated by name rather than by id.
  name        text not null,

  -- Which block of the document: 'contact' | 'profile' | 'work' | 'experience'
  -- | 'education' | 'skills'. Free text for the same reason `job_app_modules.slot`
  -- is: the renderer knows a fixed order, and an enum would mean a migration
  -- against a shared database every time a section is added.
  section     text not null,

  -- The parts of one entry. All nullable because sections use different ones:
  -- `work` uses title+meta+bullets, `experience` and `education` use
  -- title+org+dates+status+bullets, `skills` uses title+meta, `profile` uses
  -- meta+bullets. A renderer reads what it needs and ignores the rest.
  title       text,
  meta        text,                   -- tech line, or the body of a skills row
  org         text,
  dates       text,
  status      text,                   -- e.g. 'In Progress'
  bullets     text[] not null default '{}',

  -- Anything a section needs that is not worth a column. `contact` keeps its
  -- icon/link list here. Deliberately not columns: exactly one section uses it.
  data        jsonb not null default '{}'::jsonb,

  -- What the entry EVIDENCES, lowercase, and the only thing relevance matches
  -- on. An entry is never tagged with a technology its own text does not
  -- mention: a tag is what makes an entry reachable, and a tag that overstates
  -- is how an ad for something he has not done surfaces an entry claiming he has.
  tags        text[] not null default '{}',
  lang        text not null default 'en',

  -- Never dropped, whatever the posting says. Contact details and a degree are
  -- facts about the person, not claims aimed at an ad, and a CV that loses its
  -- degree to a token-overlap heuristic is worse than one that was never
  -- tailored. Enforced in `assembleCv` via ALWAYS_KEPT as well — this column is
  -- for entries inside an otherwise rankable section.
  pinned      boolean not null default false,

  enabled     boolean not null default true,

  -- Order within a section, and it must be total: a CV whose projects shuffle
  -- between two builds is not reviewable. `(sort, name, id)` is the full key.
  sort        integer not null default 0,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists job_cv_entries_user_name_idx
  on public.job_cv_entries (user_id, lower(name));

create index if not exists job_cv_entries_user_section_idx
  on public.job_cv_entries (user_id, enabled, section, sort);

-- ---------------------------------------------------------------------------
-- updated_at
-- ---------------------------------------------------------------------------
--
-- `public.job_touch_updated_at()` already exists from 20260824120000 with
-- `set search_path = ''` pinned. Reused rather than redefined: a second copy is
-- a second thing to forget to pin.

drop trigger if exists job_cv_entries_touch on public.job_cv_entries;
create trigger job_cv_entries_touch
  before update on public.job_cv_entries
  for each row execute function public.job_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
--
-- `auth.uid()`-scoped, no anon policy — the same posture as `job_app_modules`,
-- and for the same reason sharpened one notch. These rows are a person's home
-- address, phone number and employment history. The repo is public and the anon
-- key ships inside the iOS binary; `USING (true)` here would publish all of it.
--
-- ⚠️ Read with the AUTHENTICATED `supabase` client, never `supabasePublic`. A
-- mismatched JWT returns an EMPTY SET, not an error — and an empty CV catalog
-- renders as a document with a name and nothing else, which looks like a
-- rendering bug rather than an auth one.

alter table public.job_cv_entries enable row level security;

drop policy if exists job_cv_entries_owner on public.job_cv_entries;
create policy job_cv_entries_owner on public.job_cv_entries
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
