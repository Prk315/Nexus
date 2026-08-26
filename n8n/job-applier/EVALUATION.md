# Job applier — evaluation pipeline

Phase 2. A local Qwen scores each harvested posting against a profile and picks
which **pre-written modules** an application should be built from. The draft is
then assembled by concatenating those modules — the model writes no prose.

```
job_matches (gate_verdict='pass', score IS NULL)
        │
        │  job-ingest  action:"pending"
        ▼
   n8n (Mac) ── prompt ──> Qwen 2.5 on localhost:11434 ── verdict ──┐
                                                                    │
        ┌────── job-ingest  action:"evaluate_result" ───────────────┘
        ▼
  job_matches.score / .module_plan   +   job_applications.body
```

Read `README.md` first for the harvest half, and `MODULES.md` for the module
library the assembler draws on.

## Layout

| File | What |
|---|---|
| `evaluate.js` | **the canonical prompt + parser + planner** — pure, dependency-free, 47 tests |
| `evaluate.test.js` | `node --test evaluate.test.js` |
| `evaluate-dryrun.mjs` | live round-trip against Ollama; writes nothing without `--write` |
| `build-evaluate.mjs` | injects `evaluate.js` into the workflow template |
| `workflows/job-evaluate.template.json` | the workflow, with `__EVALUATE_JS__` placeholders |
| `workflows/job-evaluate.json` | **generated — do not hand-edit** |
| `../../supabase/migrations/20260825120000_job_evaluation.sql` | `job_app_modules`, `job_applications`, `job_matches.module_plan` |
| `../../supabase/functions/job-ingest/` | gains `action: "pending"` and `action: "evaluate_result"` |

Same build rule as the harvest side — n8n Code nodes have no module system, so
the evaluator is pasted into two node bodies by a script rather than by hand:

```bash
node --test evaluate.test.js && node build-evaluate.mjs
```

Commit `evaluate.js` and the regenerated `job-evaluate.json` together.

## The one rule: assembly happens in ONE place, and it is the edge function

`supabase/functions/job-ingest/logic.ts` holds the canonical `assembleApplication`.
It is the only implementation that ever writes a row.

`evaluate.js` has a second copy. That is deliberate and it is **preview-only**:
`evaluate-dryrun.mjs` calls it so you can see the draft a verdict would produce
without writing anything, and the n8n workflow never calls it at all.

The reason the split is safe rather than the usual drift hazard:

- **n8n physically cannot assemble.** `job_app_modules.content` never leaves
  Supabase — `action: "pending"` returns id, name, slot, tags and sort, and no
  prose. The model matches on tags; it has no use for the paragraphs, and a
  person's writing about their own career has no reason to sit in a Docker
  container or in a context window. So the workflow posts a *plan*, and the
  function turns the plan into text it already holds.
- **Only one copy is load-bearing.** Drift costs a wrong preview in a terminal,
  never a wrong stored draft.
- **Drift is loud.** `evaluate.test.js` pins the assembled body verbatim, so a
  change to either implementation shows up as a failing string comparison rather
  than as a draft that quietly reads differently.

The rules both copies implement, stated once:

1. Header: `Application: {title} — {company}`, title alone when the company is unknown.
2. Every chosen module's `content` verbatim, in `(sort, name, id)` order.
3. One `[GAP: no module for '{slot}']` line per missing slot, in plan order.
4. Parts joined by a blank line, and **nothing else is ever written**.

Rule 4 is the load-bearing one. The moment the assembler is allowed to write a
sentence of its own to smooth a join, "did a human write this?" stops having an
answer and the gap markers stop being worth anything.

## The gap principle

A slot the model asked for and no module covers becomes `missing_slots` on
`job_applications` and a literal `[GAP: …]` line in the body. That is the
mechanism, not a placeholder for a better one.

The failure being designed against is not a bad draft — it is a *good-looking*
one. A 7B model asked for a cover letter produces fluent text that asserts
experience the candidate does not have, because "sound qualified" is what the
genre it memorised does. That output is plausible and wrong, and nothing
downstream can tell. Same rule as `blocking_state` never being seeded, `score`
being nullable, and mail `priority` sorting `nulls first`: a missing verdict must
*look* missing.

So an id the model invents is dropped on sight — twice, once in n8n and once
server-side — and the coverage it was meant to provide reappears as a gap. It is
never repaired by substituting a nearby module.

## Framing: intro and closing are a rule, not a model choice

The model chooses `skill` and `project` modules. It does **not** choose the
opening and sign-off paragraphs — those are computed, and it is not even shown
them in the catalog.

This was a fix, not a design instinct. Over the first live runs the model picked
sensible body modules and *erratically* omitted intro and closing: one stored
85-score draft opened with a skill paragraph and carried GAP markers for both,
against a catalog holding five enabled intros and two closings.

Tightening the prompt would have made that rarer, not absent, and rarer is the
worse outcome — a failure that shows up one run in five is one nobody builds a
habit of checking for. The real problem is that it was asked at all: **choosing
an intro is not a judgement about the ad.** Every application has exactly one
intro and exactly one closing, and which one follows from facts already decided.
Anything derivable should be derived.

The rule, applied in `planFromVerdict` and again in `normalizeModulePlan`:

1. candidates = enabled modules in that slot;
2. keep those whose `lang` matches the verdict's, else `'en'`, else all;
3. most tag overlap with the verdict's matched + required skills;
4. `(sort, name, id)`.

**Steps 2 and 3 are both load-bearing, and the real catalog proves it.** The two
closings carry identical tags and differ only by language, so step 3 cannot
separate them. The five intros all carry `sort = 0` and differ only by tags, so
step 4 cannot. Drop either step and one of the two slots silently picks
alphabetically — which is exactly what a live run did before `lang` was added to
the query, sending `intro_ai_da` and `closing_da` to an English-language ad.

Framing runs only when the verdict has **a score and at least one chosen
module**. Both conditions earn their place: no chosen modules means the model
found nothing worth saying, and a letter that is an intro, a gap and a sign-off
is worse than an honest empty; a null score means the model failed, and framing a
failure dresses it up as a considered verdict — the same reason `evaluated_at` is
not stamped without a score.

Body order is by **slot rank** (intro first, closing last, `(sort, name, id)`
within a rank), not by `sort` alone. "The intro comes first" is a property of a
letter, not of a number someone typed into a row, and a module added later with a
careless `sort` must not be able to open the application.

Any intro or closing the model *does* name is stripped before the rule runs, so
the result is exactly one of each no matter what came back. Both implementations
are idempotent: n8n frames the plan it posts, the edge function re-derives the
same plan from the same inputs, and they agree.

## Setup

Ordered. Each step fails in a distinguishable way if the one before it was
skipped, and `evaluate-dryrun.mjs` names which one you are missing.

### 1. Apply the migration

`supabase/migrations/20260825120000_job_evaluation.sql` — see
`supabase/migrations/APPLY.md`. Additive only: two tables, one nullable jsonb
column on `job_matches`, two `updated_at` triggers, two owner-only RLS policies.
Re-runnable (`create table if not exists`, `add column if not exists`,
`drop policy if exists`).

Deploying the function does **not** create the tables, and `action: "pending"`
returns `pending_failed` against a project where they are missing.

### 2. Redeploy `job-ingest`

```bash
npx supabase functions deploy job-ingest --project-ref efxmzsdisaymtpebaxlp
```

The two new actions live in the existing function behind the existing
`X-Job-Key` / `JOB_INGEST_KEY` pair, so there is no new secret to set. Until this
is done, `action: "pending"` falls through to the harvest parser and answers
`postings_not_an_array` — which reads like a bug in the caller and is not.

### 3. Seed the module library

`modules.seed.sql` / `MODULES.md`. Nothing here is seeded by the migration:
`job_app_modules` is `auth.uid()`-scoped and a migration has no session to
attribute rows to.

An empty catalog is not an error — the evaluator handles it, and the draft comes
out as nothing but gap markers, which is the honest answer. It is also useless,
so seed before enabling the schedule.

### 4. Import the workflow

n8n → Import from File → `workflows/job-evaluate.json`. It uses the same three
environment variables as the harvest workflow (`NEXUS_SUPABASE_URL`,
`NEXUS_USER_ID`, `JOB_INGEST_KEY`) and no credentials, so unlike
`job-harvest.json` it needs no `patch-deploy.mjs` pass. If you want to drive it
from the CLI (`n8n execute --id`), add an `executeWorkflowTrigger` by hand in the
n8n editor — a workflow whose only entry point is a schedule trigger is refused.

Run it manually once before enabling the 30-minute schedule.

## Dry run

```bash
node evaluate-dryrun.mjs                     # read-only, qwen2.5:latest
node evaluate-dryrun.mjs --model qwen2.5:3b  # compare the small model
node evaluate-dryrun.mjs --write             # actually POST evaluate_result
```

Calls the real `job-ingest` for the real queue, runs the real prompt against the
real Ollama, and prints the verdict, the plan and the draft that would be stored.
**Run this after any change to `evaluate.js`.** The n8n workflow cannot be
unit-tested, and phase 1 established the pattern twice over: fixtures test the
parser, the dry run tests the pipeline. Substring keyword matching passing a chef
as an AI engineer was invisible to 29 green tests and obvious in one live run.

When the queue is empty — or the migration is not applied, or the function is not
redeployed — it falls back to a built-in Danish AI-engineer ad and a built-in
module catalog, so the Qwen round-trip is still exercised. **The mode is printed
at the top and again in the summary.** A run that silently fell back would tell
you nothing about your real data, which is the whole reason it says so twice.

The built-in catalog is deliberately incomplete (no MLOps/Kubernetes module) so
that a competent verdict has to produce a gap. A sample that covered everything
would leave the one mechanism most worth watching untested.

## What the models actually do — measured 2026-08-25

Sample mode, the built-in Danish ad, four modules in the catalog, on this 8-core
Mac. Prompt was ~5.2k chars (~1.3k tokens).

| | `qwen2.5:latest` (7.6B Q4) | `qwen2.5:3b` (3.1B Q4) |
|---|---|---|
| Valid JSON under `format: "json"` | 5/5 | 3/3 |
| Warm latency per posting | 18–39 s | 18–37 s |
| Cold model load | ~60 s | ~47 s |
| Verdict quality | usable | **not usable** |

Three findings worth keeping:

- **`format: "json"` held on every single call, both models.** Not one fenced or
  prose-wrapped response in eight. `parseEvalResponse` still slices
  first-brace-to-last-brace, because that costs nothing when the response was
  already clean and the alternative is a silent skip the one time it is not.
- **JSON validity is not the discriminator — semantic honesty is.** The 3b
  returned perfectly-formed JSON containing an invented `matched_skills` list
  ("computer vision", "nlp", "generative ai" — in neither the profile nor the
  ad), listed the same skill as both matched and missing in one verdict, and
  produced **no gap at all**. That is precisely the plausible-and-wrong failure
  this design exists to catch, arriving in a well-formed envelope. Use the 7B.
  The 3b is not meaningfully faster once the model is warm.
- **The 7B is stable on skills and unstable on slots.** Across four runs its
  `missing_skills` was identically `pytorch, kubernetes, docker` every time, and
  its score was 85 every time — but which modules it chose varied, so the same
  ad assembled with a `[GAP: no module for 'skill']` on two runs and without it
  on the other two. Temperature 0.1 is not temperature 0. Re-evaluating a posting
  can legitimately change its draft; that is why the draft is *stored* rather
  than recomputed on read. It is also why intro and closing were taken away from
  it entirely — see Framing above.

Two quirks that are noise rather than bugs, recorded so nobody chases them:

- **`reasoning` sometimes comes back in Chinese.** Two of four live verdicts
  explained a Danish ad in Mandarin. It is bounded, sanitized display text and
  reaches no decision, so it is cosmetic — but it is startling in a panel.
- **`matched_skills` sometimes lists module names** (`skill_data_pipelines`)
  instead of skills, despite the prompt saying otherwise. It feeds only the
  framing tie-break and the display, never the choice of body modules.

Still open, and the next thing worth fixing: the model occasionally chooses a
body module with no real bearing on the ad — `skill_rust_systems` for a GenAI
role, `skill_ios_mobile` for a Data Engineer one. Unlike the framing problem this
one *is* a judgement about the ad, so it belongs with the model; the lever is
probably a relevance floor on tag overlap rather than more prompt text.

Cold-start dominates a first run: `load_duration` alone was 47 s for the 3b on a
freshly-booted machine, against 0.2 s of actual generation. The 300 s timeout on
the Ollama node is sized for that, not for inference.

## Traps

- **A slot is a paragraph kind, never a skill — and the vocabulary is closed.**
  An earlier prompt told the model to name a slot even when nothing could fill it.
  It responded by inventing one slot per missing technology — `skill_python`,
  `skill_linux`, `skill_vllm`, `skill_kubernetes` — and then choosing **no modules
  at all**: an 85-scored job assembled into a header and ten gap markers with two
  obviously relevant modules sitting unchosen. An unbounded vocabulary let "name
  the gaps" become "enumerate the requirements", and the enumeration crowded out
  the one job it had. `KNOWN_SLOTS` now bounds it in code as well as in the
  prompt, because the prompt is a request and the filter is a guarantee. A slot
  survives only if it is conventional or some module in the catalog uses it; a
  missing *technology* belongs in `missing_skills`, which is where it already was.
- **`pending` must select `tags` and `lang`, and neither is decoration.** They are
  what pick the intro and the closing. Without `lang` the two closings are
  indistinguishable; without `tags` all five intros tie on `sort = 0` and the
  choice collapses to alphabetical order. A deployment carrying the framing code
  but an older `select` looks like it works — it picks *an* intro every time —
  and quietly sends Danish framing to English ads.
- **Inside the container, `localhost` is the container.** The workflow points at
  `http://host.docker.internal:11434`. And then Ollama still refuses the
  connection, because it binds `127.0.0.1` by default and that excludes the
  Docker bridge: `launchctl setenv OLLAMA_HOST 0.0.0.0`, then restart it. This
  one bites *after* you fix the hostname, so it reads like the fix did not work.
  Note it then exposes Ollama on the LAN — firewall, not café wifi.
- **Empty `pending` is not "never ran".** `{ok: true, pending: []}` is the normal
  steady state: everything gated has been scored. It is a different fact from
  "the migration is missing" (`pending_failed`) and from "the function is old"
  (`postings_not_an_array`), and the dry run prints which of the three you have.
  A panel that renders all three as "nothing to review ✓" is lying two-thirds of
  the time — the same mistake as counting `mail_messages` rows for freshness.
- **`score` is nullable and stays that way.** An absent or unparseable score is
  `null`, never `0`, in both `parseEvalResponse` and `clampScore`. `null` sorts
  *first*, so a model failure surfaces at the top of the review list rather than
  sinking to the bottom looking like a considered verdict.
- **`pending` filters on `score IS NULL` **and** `evaluated_at IS NULL`.** Either
  alone asks a different question. A row with a timestamp and no score is one the
  model failed on; re-queuing it forever turns one unparseable response into an
  infinite loop against a model that will fail it again.
- **Module ids are validated server-side, and n8n's filter is not trusted.**
  `normalizeModulePlan` re-checks every id against the user's own enabled rows.
  n8n is a Docker container holding a scoped secret, and the function's client is
  service-role and therefore bypasses RLS — without the re-check, anything
  holding `JOB_INGEST_KEY` could name another user's module id and have their
  prose pasted into a draft. This is the one place the "never recompute what n8n
  computed" rule (see `dedupe_key`) deliberately does not apply: that is a
  derivation from inputs we do not have, this is a validation against inputs only
  we have.
- **`job_app_modules` / `job_applications` are `auth.uid()`-scoped with no anon
  policy.** Read them with the authenticated `supabase` client, never
  `supabasePublic`. The wrong client returns an **empty set, not an error** — and
  an empty module catalog is indistinguishable from "no modules written yet",
  which would make the assembler emit a draft of nothing but gap markers.
- **One inference at a time.** The Ollama node runs `batchSize: 1`. Two
  concurrent 7B generations on this machine are slower than two sequential ones
  and evict each other from memory. `pending` is capped at 10 and the workflow
  asks for 4.
- **A failed item posts nothing, on purpose.** The Ollama node continues on
  failure and the parser skips an item it cannot read, so no `evaluate_result` is
  sent and the match stays `score IS NULL` for the next pass. A 300 s timeout on
  posting three must not discard the two that already succeeded.
- **This is n8n, so it stops when the Mac sleeps.** By the repo's own rule that is
  acceptable: scoring a job ad is *nice to happen*. Nothing load-bearing hangs off
  it. A closing date is load-bearing and belongs in `pf_tasks`, not here.
- **n8n 2.x import fails** on a missing top-level `id` and on `tags` given as
  plain strings. `build-evaluate.mjs` asserts both, and additionally compiles
  every Code node body with `new Function` — an injection can produce valid JSON
  containing invalid JavaScript, and n8n reports that as a runtime error three
  nodes into a scheduled run at 03:00, to nobody.

## Not built yet

The `JobsPanel` (reading `job_matches` + `job_applications`), any notion of
*sending* an application, and the `job_assemble` / `job_submit` request kinds.
Autonomy stays deliberately undecided until there is a real scored queue with
real drafts to look at — which is now one harvest away.
