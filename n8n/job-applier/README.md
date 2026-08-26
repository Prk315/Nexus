# Job applier — harvest pipeline

Discovers Danish job postings from **Jobindex**, **TheHub** and **job-alert
emails already arriving in Gmail**, screens them against rule-only profiles, and
writes them to Supabase for the header panel to read. Phase 1 of
`JOB_APPLIER_PLAN.md`; scoring with a local Qwen is phase 2.

```
Jobindex RSS ──┐
TheHub sitemap ─┼─ n8n (Mac) ─ extract ─ gate ─ job-ingest ─ Supabase ─ panel
Gmail alerts ──┘
```

## Layout

| File | What |
|---|---|
| `extract.js` | **the canonical extractor** — pure, dependency-free, 56 tests |
| `extract.test.js` | `node --test extract.test.js` |
| `harvest-dryrun.mjs` | runs the whole chain against the live sources, writes nothing |
| `build-workflow.mjs` | injects `extract.js` into the workflow template |
| `patch-deploy.mjs` | copies the built workflow to `~/docker/n8n/workflows/`, re-applying the two deploy-only patches |
| `exec-forensics.mjs` | **item counts per node** for a past n8n run — start here when a run stores too few rows |
| `workflows/job-harvest.template.json` | the workflow, with `__EXTRACT_JS__` placeholders |
| `workflows/job-harvest.json` | **generated — do not hand-edit** |
| `fixtures/` | real pages (2026-08-24) and real alert emails (2026-08-25) |

⚠️ **The alert-email fixtures are redacted.** LinkedIn stamps a per-recipient
`otpToken` (which signs the recipient *into* linkedin.com), `midToken` and
`midSig` onto every link — around 30 copies per email. Those three parameters are
replaced with `REDACTED`; everything else is byte-verbatim. This repo is public.
Re-capture the same way if you ever refresh them.

This folder sits outside the npm workspace globs (`apps/*`, `packages/*`) on
purpose: it has no dependencies and must never be able to break an app build.

## The one rule

**Never edit `workflows/job-harvest.json` by hand.** n8n Code nodes have no
module system, so the extractor has to be pasted into eight separate node bodies.
Editing those copies puts eight untested forks of the parsing rules in the tree —
the exact failure CLAUDE.md records for the stale Garmin bridge and the duplicated
BIA constants.

```bash
# edit extract.js or the template, then:
node --test extract.test.js && node build-workflow.mjs && node patch-deploy.mjs
docker exec n8n n8n import:workflow --input=/home/node/workflows/job-harvest.json
```

Commit `extract.js` and the regenerated `job-harvest.json` together.

**The deployed copy is not the repo copy**, and `patch-deploy.mjs` is what keeps
the difference honest. `~/docker/n8n/workflows/job-harvest.json` needs two things
that must never be in a public repo or a portable template: the Gmail credential
id (local to this n8n instance — the repo carries the placeholder
`GMAIL_CREDENTIAL_ID`), and a `CLI Trigger` node, because `n8n execute --id`
refuses a workflow whose only entry point is a schedule trigger. Both used to be
re-applied by hand after every regeneration, which quietly invites *editing the
deploy copy directly* — an edit no test can see and the next `build-workflow.mjs`
silently discards. `node patch-deploy.mjs --check` verifies the deployed copy is
current without writing.

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

## Gmail alerts — the third lane

Alerts you already subscribed to are the cheapest discoverer there is: someone
else runs the search, and the result is sitting in the inbox. This lane reads
them instead of crawling.

**Only LinkedIn is parsed, and that is a finding rather than a shortcut.** The
inbox was surveyed on 2026-08-25:

| Sender | In the inbox | Built? |
|---|---|---|
| `jobalerts-noreply@linkedin.com` | **17 in the last 7 days**, ~2/day | ✅ `parseLinkedInAlertEmail` |
| `mailservice@jobindex.dk` jobagent | **0 in 180 days** — last one 2025-01-14 | ❌ |
| `alert@indeed.com` | **0 in 400 days** — last one 2024-05-24 | ❌ |

Both dormant senders were captured and read before being ruled out, and each
turned out to have a second, independent problem — so re-enabling the
subscription is necessary but may not be sufficient:

- **A Jobindex jobagent mail links every job through `jobindex.dk/c?t=…`**, an
  opaque tracking redirect. There is no `/vis-job/` URL and no ad id anywhere
  except inside that redirect, so a posting cannot be given a canonical URL or an
  `external_id` without following it. The **RSS feed already covers Jobindex**
  and gives both directly, which is why this lane is not worth rebuilding.
- **An Indeed alert's job key lives only in `?jk=`**, and the sponsored entries
  have no `jk` at all. Indeed is not a `job_sources` kind anywhere in this
  pipeline, so a parser would have had nothing to feed.

**If you want more inbound, create more alerts** — a LinkedIn job alert per
focus, or a Jobindex jobagent — rather than expecting these parsers to appear.
Nothing in the workflow needs to change for a second LinkedIn alert; it is the
same sender.

### What the branch does

`Fetch Alert Emails` (Gmail, `simple: false`) → `Parse Alert Emails` →
`Needs Enrichment` → `Fetch Job Page` → posting → the same Merge/Gate/ingest path
as everything else. It is routed by a `job_sources` row of kind `gmail_alerts`,
so the query lives in the database like every other source:

```sql
insert into job_sources (user_id, profile_id, kind, config)
values (auth.uid(), null, 'gmail_alerts',
        '{"query":"from:jobalerts-noreply@linkedin.com newer_than:2d"}'::jsonb);
```

With no `query` the node falls back to exactly that string. The Gmail node
carries a **placeholder credential** — `gmailOAuth2`, id `GMAIL_CREDENTIAL_ID`,
name `Gmail OAuth`, matching `~/docker/n8n/workflows/gmail-ingestion.json`. Repoint
it after import. Per CLAUDE.md, n8n currently has **no working Google credential**
at all, so this branch fetches nothing until that is re-authed at
`http://localhost:5678` → Credentials.

### Enrichment, and why it must be allowed to fail

**LinkedIn is deliberately ingest-only.** There is no API, and logged-in pages
are never scraped. The email is the source of truth; the public job page is a
bonus.

Probed live 2026-08-25 against two real ids: `linkedin.com/jobs/view/<id>/`
answers **200 with zero `ld+json` blocks**. The schema.org path that carries
TheHub simply does not exist here, so `extractAlertPageEnrichment` falls back to
`og:description` — the ad's opening ~150 characters, the same shape as a Jobindex
`/vis-job/` lead. In the dry run all five jobs enriched that way (107–193 chars),
which is the difference between the gate reading a job title and reading a job.

`extractReadableText` is **not** used as a third fallback. On a 290 KB
single-page-app shell the largest text block is navigation, not the ad — the same
failure that once made a cookie banner the "description" of a Jobindex ad.

Three rules hold this together, and all three exist because the failure is silent:

- **A failed enrichment never drops the job.** `buildAlertPosting` falls back to
  the email's own title, company, location and canonical URL. Dropping would make
  the lane's yield depend on LinkedIn's mood, and an empty panel looks exactly
  like a quiet week.
- **Politeness caps the fetches, not the jobs.** The first 10 jobs per run are
  enriched; the rest are ingested from the email alone rather than deferred. The
  email already carries everything the gate reads.
- **Nothing is guessed.** `remote` stays null unless schema.org said
  `TELECOMMUTE`; a guessed `remote: false` would be read by the gate as a fact and
  drop an actually-remote job on a location miss.

## Dry run

```bash
node harvest-dryrun.mjs --ji 5 --hub 6
node harvest-dryrun.mjs --mail fixtures/linkedin-alert.html   # the Gmail lane
```

`--mail` reads a **saved email, not the inbox** — the script has no Gmail
credential and is never given one. Everything after the parse is the same code
the n8n branch runs. Watch the `enr` column: `og`/`ld` means the page answered,
`-` means past the cap, and `200/none` or `fail` means the fallback did its job.

Fetches live pages, writes nothing, and prints every posting with its description
length and gate verdict. **Run this after any extractor change.** The n8n workflow
cannot be unit-tested, and both of the bugs found on 2026-08-24 — substring
keyword matching and application forms overwriting descriptions — were invisible
to the fixture tests and obvious here.

⚠️ **The dry run's gate verdicts do not predict the live gate's verdicts.** It
carries its own hard-coded `PROFILES` — deliberately broader keywords (`developer`,
`ai`, `engine`) and, critically, `locations: []`. So the location rule never fires
here at all, which is why the dry run reported a healthy 11 postings on the same
day the live run stored 1. Use it to check *extraction*; use `exec-forensics.mjs`
and the `job_matches` table to check *gating*.

## When a run stores fewer rows than expected

Start with the item count per node — not with the workflow JSON:

```bash
node exec-forensics.mjs            # newest run
node exec-forensics.mjs 395 --node Gate
```

Read it as a funnel and find the first big step down. Two counts are misleading by
design: `Post to job-ingest` collapses everything to **1** because it batches, and
the ingest's real verdict is in the `Send` node's response body
(`{"ok":true,"postings":21,"matches":63,"rejected":[]}`) — **a rejected posting
does not fail the run**, so a green run can still have discarded a whole lane.
`--node Send` is the second thing to look at, always.

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
- **The politeness caps are load-bearing.** 25 new Jobindex ads **across all three
  feeds combined** (taken round-robin, so no one feed spends the whole budget) and
  30 TheHub pages per run, three concurrent requests, 1.2 s apart. Each Jobindex
  survivor costs two further fetches, so the cap is a request budget, not a row
  budget. The first run is the
  dangerous one because everything is new; the backlog drains over a few runs.
  Being blocked is a permanent cost against a temporary saving.
- **A Jobindex ad's "apply" link is not always the ad.** It is frequently an
  application form, and once, verifiably, a YouTube recruitment video. The `<h4>`
  title link plus `NON_AD_HOSTS` plus longest-wins description selection are three
  independent guards against that; keep all three.
- **A LinkedIn alert links the same job three times** — logo, wrapper anchor,
  title anchor. Grouping by the id in the href is what stops five jobs being
  ingested as fifteen. The grouping is deliberately not keyed on LinkedIn's
  utility classes (`font-bold text-md …`) or on `data-test-id="job-card"`, both
  of which are generated markup that changes without notice.
- **The alert's tracking URL must never be stored.** It carries an `otpToken`
  that signs the recipient in, and a `trackingId` that rotates daily — so a
  URL-keyed seen-set would treat the same job as new every morning. Only
  `https://www.linkedin.com/jobs/view/<id>/` is kept, and the numeric id is the
  `external_id`. Note `jobid_<id>` also appears inside the `trk` parameter;
  anchoring on `/jobs/view/` is what reads the identity rather than the tracking
  copy.
- **Alert bodies arrive quoted-printable-encoded, and the decode is lossy.** In
  the captured fixtures a stray `=` inside a query string was eaten
  (`?trackingId[hCc7…`). The path survives, which is the whole reason the id is
  taken from the path — but do not trust query values out of an email body.
- **n8n 2.x import fails** on a missing top-level `id` and on `tags` given as
  plain strings. `build-workflow.mjs` asserts both before writing.

### Found on the first live run (2026-08-25) — 60-odd candidates became 1 row

All five were silent. The run exited 0 and n8n showed every node green.

- **`job_postings.source_kind` and `job_sources.kind` are different vocabularies,
  and the alert lane spells itself two ways.** `job-ingest` validates postings
  against `["jobindex_rss","thehub_sitemap","gmail_alert","manual"]` — **singular**
  `gmail_alert` — while the `job_sources` row (and therefore the Route Source
  switch) says **plural** `gmail_alerts`. Sending the plural rejected all 28
  LinkedIn postings with `invalid_source_kind`, reported in the response body
  rather than as a failure. The same plural also made the seen-set key
  (`'<source_kind> <external_id>'`) never match, so the cross-run dedupe guard was
  dead. Posting-side spellings now come from `SOURCE_KIND` in `extract.js`; never
  inline the string in a node body.
- **A Code node reading `$input.first()` silently discards every other input
  item.** There are three `jobindex_rss` source rows, so `Parse Feed` receives
  three feed responses — and parsed only one. The broad "alle jobs" feed sorted
  first and ate the entire run, which is why a healthy-looking run contained no AI
  and no Data Science ads. It now loops all inputs, pairs each with **its own**
  source row (reusing source #1's id mis-attributes every ad), and takes the
  global cap **round-robin** so the broadest feed cannot starve the narrow ones.
- **A location that does not match the allow-list is not a location that is out of
  scope.** The allow-list is `["copenhagen","københavn","remote","denmark",
  "danmark"]` and the old test was a substring `includes`, so every Danish
  municipality not literally named "København" failed — and failing to match was
  treated as a positive mismatch. That dropped 32 of 69 postings, including a Data
  Engineer role in Ishøj and a Student Data Engineer in Gentofte. `locationVerdict`
  now returns `allow` / `deny` / **`unknown`**, and only a recognised foreign
  country denies. Same shape as CLAUDE.md's rule that a missing `blocking_state`
  row is not "nothing is blocked": absence of evidence must not become a confident
  negative verdict. An unlisted country reads as unknown and survives, which is the
  safe direction — the keyword rule still has to pass.
- **`neverError` does not cover a dropped connection.** It suppresses HTTP status
  errors only. A `NodeApiError` — "the connection to the server was closed
  unexpectedly" — from one employer's ATS killed an entire run at `Fetch Ad Body`,
  taking all three lanes with it. The per-ad fetches now set
  `onError: "continueRegularOutput"`. **Not `continueErrorOutput`**: the build
  nodes pair items with their metadata **positionally**, so an error branch that
  removes items would silently attach one job's ad body to a different job. The
  regular-output form emits a failed item carrying `error` and no body, which
  parses to an empty description and falls back to the stub's `og:description`
  lead — a thinner row instead of a lost run.
- **Splitting a Jobindex feed title on its last comma breaks whenever the employer's
  own name contains one.** "To studentermedhjælpere søges til Det Kongelige Akademi
  - Arkitektur, Design, Konservering" has no company segment at all, and the split
  stored the employer as "Konservering". Nothing in the feed string distinguishes
  the two shapes, so the fix is not a cleverer split: `extractJobindexStub` reads
  the employer from the ad page's own `jix-toolbar-top__company` toolbar (present
  on all 11 stubs of that run, paid and robot-scraped alike) and the feed split is
  the fallback. `vp-card__name` is the second signal, never the first — it is
  absent on `r`-prefixed robot-scraped ads. `job-card__company` is deliberately
  unused: it is the "more jobs from this employer" sidebar, not this ad's employer.

### Gate precision is profile data, not matcher code

`cheapGate` now records **which keyword matched** on a pass (`gate_reason =
"keyword: unity"`), not just `null`. That one change turns "why on earth did this
pass?" into one query:

```sql
select pr.name, m.gate_reason, p.company, p.title
from job_matches m
  join job_profiles pr on pr.id = m.profile_id
  join job_postings p on p.id = m.posting_id
where m.gate_verdict = 'pass' order by pr.name;
```

It immediately showed that **every** Game Dev false positive on the 2026-08-25 run
came from the single bare keyword `unity`: a school literally named *Unity Skolen*
(a maths teacher and a caretaker), the *Parkinson Unity Walk*, an "apprentice
unity" staff-benefits line, and Databricks' *Unity Catalog* in a data-platform ad.
`termHit`'s word boundaries are correct — the word really is present in all of
them. The term is simply ambiguous, and the fix belongs in the profile row
(`unity3d` / `unity engine`, or `unity skolen` in `exclude_terms`), not in the
matcher. Resist "improving" `termHit` to compensate; it would break `c++` and `c#`,
which are why the lookarounds exist.
- **Inside the container, `localhost` is the container.** Relevant from phase 2:
  Ollama is `http://host.docker.internal:11434`, and it must bind `0.0.0.0`.

## Not built yet

Qwen scoring (`job_evaluate`), the `JobsPanel`, and everything about actually
applying. Autonomy is deliberately undecided until there is a real scored queue
to look at.
