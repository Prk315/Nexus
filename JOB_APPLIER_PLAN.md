# Automatic job applier — plan

An n8n pipeline that discovers compatible job posts, evaluates them with a local
Qwen, and assembles an application from **pre-written modules**. Same shape as mail
triage: the Mac does the work, Supabase holds the state, every client reads a row.

```
Jobindex RSS ─┐
TheHub sitemap ┼─> n8n (Mac) ─> JSON-LD extract ─> gate ─> Qwen ─> job-ingest ─> Supabase
Gmail alerts ─┘                                                                      │
                                    NexusHeader / JobsPanel <──── reads ─────────────┘
```

**Status: phase 1 (ingestion) is the agreed scope.** Submission autonomy is
deliberately undecided until there is a real queue of scored jobs to look at.

---

## 1. What was verified, 2026-08-24

Every source claim below was probed, not assumed. Re-probe before trusting any of
it in six months — job boards change their minds.

| Source | Result |
|---|---|
| **Jobindex RSS** | ✅ `https://www.jobindex.dk/jobsoegning.rss?q=<query>` → 200, `application/rss+xml`, 20 items. |
| **TheHub** | ✅ `sitemap-jobs.xml` → 1198 `<loc>` job URLs, robots-allowed. Each job page carries schema.org `JobPosting` JSON-LD. |
| **Jobnet** | ❌ Everything under `job.jobnet.dk` 307s into a NemLog-in/MitID SAML flow. The old public `SearchJson` endpoint is gone behind a WAF (`Myra`). No unauthenticated surface. |
| **Indeed** | ❌ Publisher API closed to new applicants. Reachable only as inbound alert email. |
| **Ollama** | ✅ Up on `:11434` with `qwen2.5:latest` (7.6B Q4_K_M) and `qwen2.5:3b`, both `tools`-capable, 32k context. |
| **n8n** | ✅ 200 on `:5678`. |

> CLAUDE.md says "Ollama is not installed" under *Two preconditions the user owns*.
> That is **stale** — it is installed and serving two models. The other precondition
> (n8n's Gmail credential) is still unverified.

### Jobindex RSS item shape

```
title       "Junior Project Manager, Ellab A/S"   <- company follows the last comma
link        https://www.jobindex.dk/vis-job/h1691819   <- redirector, not the employer
description HTML blob of the search-result card
category    "Systemudvikling og programmering"    <- repeated; a real DK taxonomy
pubDate     Mon, 24 Aug 2026 00:00:00 +0200
guid        https://www.jobindex.dk/1691819
```

Two things to do something about:

- **The feed declares `ISO-8859-1`.** The probed sample was in fact pure ASCII with
  non-ASCII escaped as XML entities (`st&#xF8;rste`), so a *compliant* XML parser
  handles it. The hazard is a naive UTF-8 read of any raw latin-1 byte that does
  appear — then every `ø`, `æ` and `å` in a Danish job title becomes mojibake in
  Postgres, permanently, and the damage is invisible until someone reads a company
  name. Honour the declared charset rather than assuming either encoding.
- **`category` is free structured signal.** `Systemudvikling og programmering`,
  `IT-ledelse`, `Elektroteknik` — the cheap gate can drop most of the feed on this
  alone, before Qwen is ever woken.

---

## 2. The architecture decision: three discoverers, two extractors

> ⚠️ **Corrected 2026-08-24 after building it.** This section originally claimed
> *one* generic extractor, on the reasoning that Google Jobs requires schema.org
> `JobPosting` so every board emits it. That is true for TheHub and **false for
> Jobindex**, which is half the point of the project. What was actually found:
>
> | Page | JSON-LD |
> |---|---|
> | TheHub job page | ✅ one `JobPosting` block |
> | Jobindex `/vis-job/` | ❌ `@type` is `WebSite` |
> | The employer ATS behind a Jobindex ad (HR-Manager, SuccessFactors) | ❌ none |
>
> So following the ad out to the employer does not rescue it either. Jobindex is a
> genuine HTML scrape and has its own path. The generic JSON-LD extractor is still
> right for TheHub and will still pay off for Teamtailor/Greenhouse/Lever/Workday
> when those are added — it is just not universal.

The instinct is to write a scraper per site. Mostly resist it: Google Jobs requires
schema.org `JobPosting` for a listing to be indexed, so most modern boards and ATS
vendors emit it. Verified on TheHub: one `<script type="application/ld+json">` per
job page with `title`, `description`, `datePosted`, `validThrough`,
`hiringOrganization`, `employmentType`, `jobLocation`, `directApply`.

**A Jobindex `/vis-job/` page is a stub, not an ad**: a banner image, an `<h4>`
title link, a location span, and a link out. `og:description` carries only the
opening sentence (~160 chars). The body is one fetch further on — at either the
employer's site or a `jobindex.dk/jobannonce/` page Jobindex hosts itself.

So the pipeline splits in two, and only the top half is source-specific:

**Discoverers** — cheap, produce nothing but *candidate URLs*:

| Kind | Mechanism | Notes |
|---|---|---|
| `jobindex_rss` | one feed per saved search | 20 items, so poll often rather than deeply |
| `thehub_sitemap` | `sitemap-jobs.xml`, diffed against seen URLs | 1198 URLs — see the rate-limit trap |
| `gmail_alert` | Gmail node → extract links from LinkedIn/Indeed alert mails | the only legitimate route to those two |

**One extractor** — fetch URL, parse JSON-LD `JobPosting`, normalize. Falls back to
a text dump handed to Qwen when a page has no JSON-LD. Adding a source later means
adding a discoverer, not a parser.

### Why LinkedIn and Indeed are ingest-only, forever

Automating submission on either violates their ToS and gets accounts restricted,
and their forms are the least stable surface available to build on. Their **job
alert emails** carry the same postings and arrive in Gmail, where there is already
a working ingestion workflow and a mail bus. Take the free path.

---

## 3. Schema (phase 1)

New tables, `job_` prefix. RLS is `auth.uid()`-scoped with **no anon policy**,
exactly like `mail_messages` — these rows carry a person's job search. Read them
with the authenticated `supabase` client, **never `supabasePublic`**; getting that
backwards returns an empty set rather than an error, which looks identical to "no
jobs found".

### `job_profiles` — this is where "modular" lives

The target categories are **rows, not code**. Seeded with Game Dev, AI Engineering
and Data Science; adding a fourth is an insert.

```
id, user_id, name, enabled, sort
keywords        text[]     -- feeds the Jobindex query and the gate
exclude_terms   text[]     -- hard deal-breakers
locations       text[]     -- 'Copenhagen', 'Remote', 'Denmark'
languages       text[]     -- 'da', 'en'
seniority_min / seniority_max
category_allow  text[]     -- Jobindex taxonomy strings
notes           text       -- free context handed to Qwen in the scoring prompt
```

### `job_sources` — one row per discoverer instance

```
id, user_id, profile_id -> job_profiles, kind, enabled
config      jsonb   -- {feed_url} | {sitemap_url} | {gmail_query}
last_run_at, last_status, last_error, seen_cursor
```

### `job_postings` — the normalized ad, one row per real job

```
id, user_id, source_kind, url, canonical_url
external_id   text  -- stable per source
dedupe_key    text  -- see the cross-source dedup trap
title, company, location, remote, employment_type, lang
posted_at, valid_through
description   text
ld_json       jsonb -- the raw JobPosting, kept whole
apply_channel text  -- 'email' | 'ats' | 'board' | 'unknown'
apply_email, ats_vendor
discovered_at, status
```

### `job_matches` — job × profile, because one ad can match two profiles

Kept separate from `job_postings` on purpose. A Unity gameplay role can be a 90 for
Game Dev and a 40 for Data Science, and those are two different verdicts about one
row — collapsing them into a single `score` column on the posting loses that and
makes the number meaningless the moment a second profile exists.

```
id, user_id, posting_id, profile_id
gate_verdict  text  -- 'pass' | 'dropped'
gate_reason   text
score         integer check (score between 0 and 100)
required_skills text[], matched_skills text[], missing_skills text[]
reasoning     text
model         text, evaluated_at timestamptz
status        text  -- 'new' | 'shortlisted' | 'dismissed'
```

`score`/`evaluated_at` are **nullable and stay that way**. Same reasoning as
`mail_messages.priority`: nothing is evaluated while the Mac sleeps, and un-scored
must sort to the *top* of a review list, not be buried at the bottom where a
`default 0` would put it.

### Plumbing

- **`job-ingest` edge function** — the only write path into `job_postings`. Clone
  `n8n-ingest`'s five invariants verbatim: POST-only, fail-closed under 32 chars,
  constant-time compare, service-role client, server-side owner re-check. Secret
  `JOB_INGEST_KEY`, header `X-Job-Key`.
- **`n8n_requests.ALLOWED_KINDS`** gains `job_sync` and `job_evaluate` now;
  `job_assemble` and `job_submit` when phase 2 is decided.
- **Freshness** comes from the newest `job_sync` row with `status = 'done'`, never
  from `count(job_postings)`. Zero rows means "nothing matched" *or* "n8n has never
  run", and a panel rendering both as "No new jobs ✓" is lying half the time.

---

## 4. The harvest workflow, node by node

Triggered two ways — a 4-hourly schedule, and a claim against `n8n_requests`
`kind = job_sync` so the panel's "sync now" button works.

1. **Trigger** — Schedule (4h) ∪ Queue claim.
2. **Load config** — enabled `job_sources` + `job_profiles` from Supabase.
3. **Switch on `kind`** → three discoverer branches → each emits `{url, source_kind, hint_title}`.
4. **Merge + dedup against `job_postings`** on `canonical_url` and `dedupe_key`. Only survivors get fetched.
5. **Rate-limited fetch** — HTTP node with a delay, capped per run (see trap).
6. **Extract** — Code node pulls `application/ld+json`, picks the `JobPosting`, normalizes. No JSON-LD → text-dump fallback flagged `needs_llm_extract`.
7. **Cheap gate** — Code, no model: language, location, `category_allow`, `exclude_terms`, `valid_through` in the past. Writes `gate_verdict`/`gate_reason` so a drop is auditable.
8. **Qwen** — HTTP to `http://host.docker.internal:11434/api/generate`, `format: "json"`. Two calls: extract requirements (3b), then score per surviving profile (7b).
9. **POST batch → `job-ingest`.**
10. **Complete the queue row** via `n8n-requests`.

---

## 4b. What phase 1 shipped, and the two bugs the dry run caught

Built 2026-08-24: `n8n/job-applier/` (extractor + 29 tests + workflow generator +
live dry-run harness), `supabase/migrations/20260824120000_job_pipeline.sql`, and
the `job-ingest` edge function. See that folder's README to set it up.

Two bugs were invisible to the fixture tests and obvious the moment the pipeline
ran against live listings. Both are worth remembering because both are the kind
that produce *plausible* output rather than an error:

1. **The gate matched substrings, not words.** A chef and a Head of Legal passed
   as *AI Engineering*, because `ai` occurs inside "available", "training" and
   "maintenance", and `engine` inside "Engineer". Short keywords — `ai`, `ml`,
   `go`, `c#` — are the normal case in a profile and every one is a substring of
   ordinary English. 7 of 8 postings passed. After the fix: 1 of 11. Note `\b` is
   unusable here, since it fails immediately after `+` or `#`.
2. **The "apply" link is often an application form, not the ad.**
   `hr-manager.net/ApplicationInit.aspx` is a live example. Taking the last
   successful extraction replaced a 161-char `og:description` lead with 34
   characters of form furniture; descriptions came back at 34–65 chars. Picking
   the longest candidate fixed it — they now range 108–9,492.

The lesson generalizes: **fixtures test the parser, the dry run tests the
pipeline.** Run `node harvest-dryrun.mjs` after any extractor change.

## 5. Traps

- **`localhost` inside the container is the container.** Ollama is
  `http://host.docker.internal:11434`, and Ollama itself must bind `0.0.0.0`
  (`launchctl setenv OLLAMA_HOST 0.0.0.0`) or it refuses the Docker bridge. This
  one bites *after* you fix the hostname, so it reads like the fix failed.
- **Cross-source dedup, not per-source dedup.** The same ad appears on Jobindex,
  TheHub and in a LinkedIn alert with three different URLs. Keying on URL alone
  produces triplicates and three applications to one company. `dedupe_key` =
  normalized `(company, title)` + posted-date proximity; URL is only the
  within-source key.
- **Don't fetch 1198 TheHub pages on the first run.** Diff the sitemap against
  seen URLs and cap new fetches per run (~40) with a delay between them. The first
  run is the dangerous one because *everything* is new. Being rate-limited or
  blocked costs the source permanently.
- **ISO-8859-1 on the Jobindex feed** (above). Decode at the edge.
- **Un-scored ≠ low-scored.** Nullable `score`, sorted `nulls first`.
- **Row count is not a freshness signal.** Use the `job_sync` request row.
- **n8n stops when the Mac sleeps** — by the repo's own rule that is acceptable
  here, because job discovery is *nice to happen*. But a **closing date is not**:
  `valid_through` becomes a `pf_tasks` row so PathFinder nags, rather than living
  in a workflow that might not run.
- **Qwen writes no prose.** It extracts and scores; the application text comes
  from human-written modules. A Q4 7B model's cover letter is not sendable, and a
  missing skill must render as a visible gap, not a hallucinated sentence.
- **The machine is 8-core with `jobs = 2` pinned in cargo.** 7B inference competes
  with builds; measure per-posting latency before choosing a batch size.

---

## 6. Phase 2 sketch — not agreed, do not build yet

Modules (`job_modules`: kind, language, tags, text, word budget) + deterministic
assembly: pick a covering set of modules for the required skills under a length
budget. Three submission tiers — email (fully automatable), ATS (assemble +
prefill, human presses submit), LinkedIn/Indeed (never). Decide autonomy after
looking at a real scored queue.

---

## 7. Open questions

1. Which Jobindex saved searches per profile — exact query strings?
2. Is n8n's Gmail credential actually authenticated? (blocks the `gmail_alert` discoverer only)
3. Anything to replace Jobnet's DK-wide coverage, or is Jobindex enough?
