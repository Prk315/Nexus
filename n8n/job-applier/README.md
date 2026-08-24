# Job applier — harvest pipeline

Discovers Danish job postings from **Jobindex** and **TheHub**, screens them
against rule-only profiles, and writes them to Supabase for the header panel to
read. Phase 1 of `JOB_APPLIER_PLAN.md`; scoring with a local Qwen is phase 2.

```
Jobindex RSS ─┐
              ├─ n8n (Mac) ─ extract ─ gate ─ job-ingest ─ Supabase ─ panel
TheHub sitemap┘
```

## Layout

| File | What |
|---|---|
| `extract.js` | **the canonical extractor** — pure, dependency-free, 29 tests |
| `extract.test.js` | `node --test extract.test.js` |
| `harvest-dryrun.mjs` | runs the whole chain against the live sources, writes nothing |
| `build-workflow.mjs` | injects `extract.js` into the workflow template |
| `workflows/job-harvest.template.json` | the workflow, with `__EXTRACT_JS__` placeholders |
| `workflows/job-harvest.json` | **generated — do not hand-edit** |
| `fixtures/` | real pages captured 2026-08-24, for the tests |

This folder sits outside the npm workspace globs (`apps/*`, `packages/*`) on
purpose: it has no dependencies and must never be able to break an app build.

## The one rule

**Never edit `workflows/job-harvest.json` by hand.** n8n Code nodes have no
module system, so the extractor has to be pasted into five separate node bodies.
Editing those copies puts five untested forks of the parsing rules in the tree —
the exact failure CLAUDE.md records for the stale Garmin bridge and the duplicated
BIA constants.

```bash
# edit extract.js, then:
node --test extract.test.js && node build-workflow.mjs
```

Commit `extract.js` and the regenerated `job-harvest.json` together.

## Setup

### 1. Apply the migration — ✅ already applied 2026-08-24

`supabase/migrations/20260824120000_job_pipeline.sql` — see
`supabase/migrations/APPLY.md`. Deploying the function does **not** create the
tables, and `job-ingest` returns 500 against a project where they are missing.

Applied to `efxmzsdisaymtpebaxlp` and verified: four tables, RLS on, one
`{authenticated}`-only policy each (`user_id = auth.uid()` on both `USING` and
`WITH CHECK`), both unique indexes non-partial, `updated_at` triggers firing,
`score` CHECK enforced, anon confirmed unable to read or insert. The Supabase
security linter reports **no findings** against these tables.

The file is re-runnable (`create table if not exists`, `create or replace`,
`drop policy if exists`), so applying it again is harmless.

Two notes for anyone verifying by hand:

- `job_matches_user_score_idx` reads back as `(user_id, score DESC)` with no
  `nulls first`. Nothing was lost — **`DESC` already implies `NULLS FIRST`** in
  Postgres, so it drops the redundant clause. Un-scored still sorts to the top.
- Testing the `updated_at` trigger by comparing `now()` before and after **does
  not work**: `now()` is `transaction_timestamp()` and is constant within a
  transaction, so both reads are identical and the trigger looks dead. Write a
  deliberately stale `updated_at` in an UPDATE and check it gets overridden.

### 2. Deploy the function and set its secret

```bash
npx supabase functions deploy job-ingest --project-ref efxmzsdisaymtpebaxlp
npx supabase secrets set JOB_INGEST_KEY="$(openssl rand -hex 32)" --project-ref efxmzsdisaymtpebaxlp
```

Under 32 characters is rejected at boot as `server_misconfigured`, deliberately —
an unset secret must never mean "allow everyone".

### 3. Create a profile and a source

The migration seeds nothing: both tables are `auth.uid()`-scoped and a migration
has no session to attribute rows to. Until the panel exists, insert by hand in the
SQL editor (`auth.uid()` resolves to you there):

```sql
insert into job_profiles (user_id, name, keywords, exclude_terms, locations)
values (auth.uid(), 'Game Dev',
        array['unity','unreal','gameplay','game engine','c++','c#'],
        array['security clearance'],
        array['copenhagen','remote','denmark']);

insert into job_sources (user_id, profile_id, kind, config)
select auth.uid(), id, 'jobindex_rss',
       '{"feed_url":"https://www.jobindex.dk/jobsoegning.rss?q=unity+developer"}'::jsonb
from job_profiles where name = 'Game Dev';

insert into job_sources (user_id, profile_id, kind, config)
values (auth.uid(), null, 'thehub_sitemap',
        '{"sitemap_url":"https://thehub.io/sitemap-jobs.xml"}'::jsonb);
```

### 4. Import the workflow

n8n → Import from File → `workflows/job-harvest.json`. Set three environment
variables on the n8n container (`NEXUS_SUPABASE_URL`, `NEXUS_USER_ID`,
`JOB_INGEST_KEY`) and restart it — n8n reads `$env` at process start.

Run it manually once before enabling the schedule.

## Dry run

```bash
node harvest-dryrun.mjs --ji 5 --hub 6
```

Fetches live pages, writes nothing, and prints every posting with its description
length and gate verdict. **Run this after any extractor change.** The n8n workflow
cannot be unit-tested, and both of the bugs found on 2026-08-24 — substring
keyword matching and application forms overwriting descriptions — were invisible
to the fixture tests and obvious here.

## Traps

- **`job_postings` / `job_matches` are `auth.uid()`-scoped with no anon policy.**
  Read them with the authenticated `supabase` client, never `supabasePublic`. The
  wrong client returns an **empty set, not an error** — an empty jobs panel is
  indistinguishable from "nothing matched today". Same trap as `mail_messages`,
  opposite polarity to the thirteen permissive productivity tables.
- **n8n never gets a service-role key.** It reads config through `job-ingest`'s
  `action: "config"` using the same scoped secret, so the blast radius stays "this
  user's job search" rather than "every table in the project".
- **`score` is nullable and sorts `nulls first`.** Nothing is scored while the Mac
  is asleep. A `default 0` would make never-scored look like scored-badly.
- **Jobindex declares ISO-8859-1.** Decode at the fetch boundary by the declared
  charset (`harvest-dryrun.mjs` shows the pattern). Mojibake stored once is
  permanent.
- **The politeness caps are load-bearing.** 25 new Jobindex ads and 30 TheHub
  pages per run, three concurrent requests, 1.2 s apart. The first run is the
  dangerous one because everything is new; the backlog drains over a few runs.
  Being blocked is a permanent cost against a temporary saving.
- **A Jobindex ad's "apply" link is not always the ad.** It is frequently an
  application form, and once, verifiably, a YouTube recruitment video. The `<h4>`
  title link plus `NON_AD_HOSTS` plus longest-wins description selection are three
  independent guards against that; keep all three.
- **n8n 2.x import fails** on a missing top-level `id` and on `tags` given as
  plain strings. `build-workflow.mjs` asserts both before writing.
- **Inside the container, `localhost` is the container.** Relevant from phase 2:
  Ollama is `http://host.docker.internal:11434`, and it must bind `0.0.0.0`.

## Not built yet

Qwen scoring (`job_evaluate`), the `JobsPanel`, the Gmail-alert discoverer, and
everything about actually applying. Autonomy is deliberately undecided until
there is a real scored queue to look at.
