# Application modules — the starter library

This is the human-readable copy of what `modules.seed.sql` inserts into
`job_app_modules`. A local Qwen picks which of these a given job needs and
assembles them into a draft — **it never writes prose of its own.** Every
sentence a job posting ends up reading came from this file, written by
Bastian, once.

## How editing actually works

**Editing this Markdown file does nothing by itself.** `modules.seed.sql` is
what seeds the database, and it only runs (or re-runs, `on conflict do
nothing`) against a fresh row set. Once modules exist in `job_app_modules`,
the live source of truth is the table, not this file — future edits happen in
the DB directly (SQL editor, or a panel once one exists), not by re-editing
this Markdown and expecting it to sync. Treat this file as the *first draft*
and the seed's own commentary, not an ongoing dual-write target.

## ⚠️ Superseded in part — changelog, 2026-09-01

The library below is the **seed**, and the database has since moved past it. Per
the section above, the table is the source of truth; this note exists so the
rest of this file is not read as current. See `GAMEDEV_SESSION.md` for why.

| Change | Detail |
|---|---|
| `closing_en` / `closing_da` | **rewritten.** The `[TODO: portfolio/GitHub link]` is gone — it had been shipping verbatim in 33 stored drafts. Location is now "in Copenhagen most of the week for university" (he is temporarily in Odense; the old "based in Copenhagen" was an address claim, "Holte" was out of date). The link moved out of the closing so it cannot appear twice. |
| `education_stub` → `education_ku_ml` | **filled and enabled.** BSc Machine Learning and Data Science, University of Copenhagen, 2023–2026, stated in progress. Names the in-progress coursework: Advanced Algorithms, Robotics, Virtual Reality, hybrid quantum programming. |
| `portfolio_link` | **filled and enabled.** `github.com/Prk315` only. Nexus is described, never linked — it is a life-OS holding health, screen-time and mail data. |
| `cv_link` | **text written, still `enabled = false` — staged, not live.** Points at `prk315.github.io/personal-website/cv.pdf`. A rewritten one-page CV exists at `JobSearch/cv_2026.tex` (the Jan 2026 `cv.tex` was ML-framed and named none of this work), but **the PDF is not on the site yet**, so the link would 404. |

⚠️ **Enabling `cv_link` is the act that opens the send path.** `cvGateReady`
(`job-ingest/logic.ts`) is guard 4 of `planApplyQueue`: while no *enabled*
`cv_link` module has non-`[TODO]` content, **every** application is skipped with
`cv_missing`. Nothing this pipeline has ever assembled could have been sent.
The query behind it filters `.eq("enabled", true)`, which is why real text can
sit here safely while disabled — flipping the flag is one deliberate act, and it
must not happen before the PDF actually resolves at that URL. A live gate
pointing at a 404 is worse than a closed one.
| `experience_armed_forces` | **new**, slot `experience` — which was in `KNOWN_SLOTS` and had never had a module. |
| `skill_cs_foundations` | **new.** Algorithms/data-structures evidence. Targets the six requirements Sybo's ad listed as missing. |
| `skill_tools_pipeline` | **new.** Tooling and test discipline; aimed at roles like Unity's "Tooling & Automation". |
| `project_editor_engine` | **retagged** `real-time, rendering, input, gamedev, simulation`. Its content already described a from-scratch pointer-driven ink engine and a render pipeline; only the tags were stopping a game ad from reaching it. Tags changed, prose untouched. |

⚠️ **A `project_realtime_graph` module was written and then deleted the same
day.** It restated `skill_graphics_3d` almost verbatim — Fibonacci sphere,
magnetic-field edge forces, IPC-driven node state, the two-`THREE`-instances
crash — and with `intro_game_en` also naming the graph, an assembled letter told
one story three times. The lesson is worth keeping: the catalog needs *coverage*,
not another angle on the strongest artifact. There is only one substantial
real-time graphics artifact here and two modules already describe it, so the
honest fix was a tag on an existing project rather than a fifth paragraph.
Check a concatenated draft before adding to a slot that is already occupied.

### Second pass, same day — the current-work modules

`education_ku_ml` rewritten again (the taken-coursework list and the Codecademy
certificates are gone; the in-progress courses, the **instructor post on High
Performance Programming and Systems**, and why he does it are in).
`skill_tools_pipeline` **deleted** — its content was the job pipeline's own
build tooling, and the judgement was that a portfolio project of that size no
longer says anything after AI. Replaced by three `project` modules describing
current work: `project_game_ai_agents`, `project_knowledge_dag`,
`project_robot_probabilistic`.

⚠️ **Three modules, not one, and that is a deliberate change to what was asked
for.** The three problems were given as one replacement block. They are stored
separately because a module is the unit of *selection* — a robotics ad should
reach the robot module without also pulling in a game-engine pipeline and a
retention system. As one module it is all-or-nothing and roughly 1,900
characters of it. Merging them back is one `insert` and one `delete` if the
single-block version reads better.

⚠️ **The Unreal claim is new and it invalidates what this file said an hour
ago.** The line below used to read "No module claims Unity, Unreal, C# or a
shipped game, because there are none." `project_game_ai_agents` now describes a
Rust trainer whose policies are exported into Unreal Engine. Still no shipped
game credits — but `intro_game_en`, which opens every game application with
"systems and graphics programming rather than shipped game credits", was written
against the old picture and undersold the work two paragraphs below it.

**`intro_game_en` has since been rewritten**, around the thing that was actually
missing: why he does this at all. Own machine built at 13, first game in Unity
off a Brackeys tutorial, no discipline in game development he has not been out of
his depth in, and the hours coming from enjoyment rather than ambition. It still
says plainly that nothing is polished enough to be a credit, and it names the
Unreal work in one clause so the paragraph is not pure enthusiasm on the runs
where the model picks little else.

⚠️ **"Nobody beats the person who finds the work fun" belongs in exactly one
module.** It is the last line of `education_ku_ml`, and education and intro can
both appear in the same letter. `intro_game_en` therefore carries the same
conviction in different words, deliberately. If the maxim reads better in the
intro, move it — do not add it.

⚠️ **`project_robot_probabilistic` says MIRTE**, not "mitre". The first draft had
the wrong name for the platform.

**`experience_armed_forces` → `experience_why_a_team`, and the military is gone.**
The slot no longer holds a work-history paragraph at all. It states outright that
there is no professional software experience, gives the real reason — nothing had
seemed worth doing — and names what changed: interesting problems are more fun to
solve with other people than alone.

⚠️ **The conscription was deliberately removed, twice over.** A first version used
it as the one place he had worked inside a group. That was rejected: it happened,
but it is **not** what motivates him to look for a job, and dressing it as the
origin of that motivation would have been a small invention in exactly the place
this library exists to prevent. There is now **no module mentioning the Armed
Forces**. If a factual work-history line is ever wanted, it is a fresh `insert`
and it should not be merged into this one.

⚠️ **This module says "I don't have professional software experience" in plain
words.** That is a deliberate change of posture: the absence used to be silent,
and is now stated and explained. It is the gap principle applied to a career
rather than a paragraph — an honest blank beats an implied history. Be aware it
will be read literally by keyword screeners, which is a cost worth knowing about
rather than a reason to soften it.

**26 modules enabled, 1 disabled (`cv_link`), 0 enabled modules containing a
`[TODO]`.**

## The gap principle

A skill with no module is a **visible gap** in the assembled draft, and that
is deliberate, not a bug to route around. The alternative — Qwen inventing a
sentence to fill the hole — is worse than an honest blank, because a
hallucinated claim in a job application is a lie with his name on it. If a
job repeatedly needs a skill this library has no module for, the fix is to
write that module, not to let the model paper over it.

## Every `[TODO: …]` is a hard stop

Several modules below are seeded `enabled = false` or contain inline
`[TODO: …]` markers — education, CV/portfolio links, a couple of
verification notes. **Nothing containing an unresolved `[TODO]` may be sent.**
These exist because his education and employment history are not known facts
in this repo and must not be invented. Resolve every TODO (fill in the real
text, then flip `enabled` to `true` where relevant) before any application
assembled from this library goes out the door.

## Slot vocabulary

`slot` is free text in the schema (`supabase/migrations/20260825120000_job_evaluation.sql`),
not an enum — the model is shown the catalog and chooses from whatever
strings the rows actually use. This library sticks to the migration's own
documented convention so the model's `missing_slots` output and the
`[GAP: no module for '…']` marker line up with what's here:
`intro`, `skill`, `project`, `education`, `closing`, `cv_link`,
`portfolio_link` — singular, matching the column comment in that migration,
not the plural section headings a human reads this file by.

## Facts verified vs. facts owed

Every concrete claim in these modules is traceable to something in this repo
(file paths, table counts, specific mechanisms) or to the ground-truth facts
supplied for this task (name, email, nationality, birth year, location). Two
categories are explicitly **not** claimed because they are not knowable from
the repo: education and employment history. Those are stub modules, disabled,
with `[TODO]` markers — see `education_stub`, `cv_link`, `portfolio_link`
below.

---

## Slot: intro (sort 0)

Opening paragraph. Pick exactly one per application, matched to the profile.

### `intro_swe_en` — lang en

> I build a personal software ecosystem end to end — six interconnected
> desktop and mobile apps sharing one Postgres backend, one design system,
> and one IPC layer I wrote myself. My daily work spans Rust (Tauri) and
> TypeScript/React on the frontend, Postgres schema and row-level-security
> design on the backend, and enough Swift to ship a native iOS companion app
> with home-screen widgets. I care most about systems that stay correct under
> real failure modes — a phone asleep, a database shared by every branch, two
> processes racing to write the same file — rather than ones that only work
> in the demo.

### `intro_ai_en` — lang en

> I run a local-LLM pipeline in production for myself: Ollama serving Qwen on
> a Mac, orchestrated by n8n, doing real classification and extraction work —
> mail triage that scores and drafts replies, and a job pipeline that gates
> candidates on rules before ever waking the model, then scores survivors
> against a structured rubric. Both share one principle: the model never
> writes final prose or makes an unsupervised final decision, only a verdict
> something downstream can check. I'm comfortable across the stack — prompt
> and schema design, local inference constraints (7B, Q4, 32k context), and
> the plumbing that turns a laptop that sleeps into a database every client
> can trust.

### `intro_game_en` — lang en

> My background is systems and graphics programming rather than shipped game
> credits, and I'd rather say that plainly than dress it up: I've built a
> real-time 3D force-directed graph renderer (three.js / react-three-fiber)
> with custom physics-style layout forces, a from-scratch ink/drawing engine
> with pointer-event stroke capture and vector rendering, and BLE protocol
> reverse-engineering down to raw byte offsets for an undocumented device.
> That's the same muscle gameplay and engine programming uses — real-time
> rendering, simulation, low-level protocol work — just not exercised inside
> a game studio yet. I'm looking for a team where that transfers.

### `intro_swe_da` — lang da

> Jeg bygger et personligt software-økosystem fra bunden — seks
> sammenkoblede desktop- og mobilapps, der deler én Postgres-backend, ét
> designsystem og ét IPC-lag, jeg selv har skrevet. Det daglige arbejde
> spænder fra Rust (Tauri) og TypeScript/React i frontend til
> Postgres-skemadesign og row-level security i backend, samt nok Swift til at
> shippe en native iOS-app med hjemmeskærms-widgets. Det, jeg går mest op i,
> er systemer der forbliver korrekte under virkelige fejlscenarier — en
> telefon der sover, en database delt af hver eneste branch, to processer der
> kapløber om at skrive samme fil — ikke systemer der kun virker i demoen.

### `intro_ai_da` — lang da

> Jeg kører en lokal LLM-pipeline i produktion til mig selv: Ollama med Qwen
> på en Mac, orkestreret af n8n, til reel klassificerings- og
> ekstraktionsopgaver — mail-triage der scorer og udkaster svar, og en
> jobmatch-pipeline der først filtrerer kandidater på regler, før modellen
> overhovedet vækkes, og derefter scorer de overlevende mod en struktureret
> rubrik. Begge dele bygger på samme princip: modellen skriver aldrig endelig
> prosa eller træffer en endelig beslutning uden opsyn — den producerer en
> vurdering, som et menneske eller et efterfølgende system kan kontrollere.

---

## Slot: skill (sort 10–19)

One paragraph of concrete, verifiable evidence per skill area.

### `skill_rust_systems` — sort 10 — tags: rust, systems, tauri, backend

> I write Rust daily in a Tauri 2 desktop/mobile workspace — a background
> grid-node daemon that runs headless under a macOS LaunchAgent, shares one
> binary between a windowed app and a `--daemon` mode, and enforces device
> policy by rewriting `/etc/hosts` as an idempotent fixed-point function — an
> already-correct file re-renders to itself byte-for-byte, which is what
> keeps a 30-second enforcement loop from prompting for a password every
> cycle. The same crate also drives a BLE scanner and a subprocess bridge for
> a fitness API integration.

### `skill_typescript_react` — sort 11 — tags: typescript, react, frontend

> React 19 and TypeScript across five apps sharing one component library —
> a 3D app-topology graph, a shared calendar sidebar, a command palette, and
> a custom rich-text editor. I've hit the sharp edges that only show up at
> this scale: dual-instance React from a mismatched dependency (blank white
> screen, no error), a Tailwind v4 build that silently drops styles from a
> workspace package Vite never touches directly, and a `useLayoutEffect`/
> `useEffect` scheduling race that crashed a force-graph library's animation
> frame until the mount was gated correctly.

### `skill_supabase_backend` — sort 12 — tags: postgres, supabase, sql, rls, backend

> I design and evolve a single shared Postgres schema (Supabase) spanning
> roughly a hundred tables across six applications — forward-only migrations,
> row-level-security scoped to `auth.uid()`, `security_invoker` views (a view
> without that flag silently bypasses the base table's RLS), and
> trigger-maintained columns where correctness can't be left to the client.
> I've also audited RLS done wrong: a handful of tables were still
> permissively world-writable, and I wrote the migration plan to close it —
> the mismatched-JWT trap, an empty result instead of an error, looks fine
> until it doesn't.

### `skill_local_llm_ai` — sort 13 — tags: llm, ai, ml, rag, ollama, python, automation

> I run local inference (Ollama, Qwen 2.5 at 3B and 7B, Q4, 32k context) as
> production infrastructure, not a demo: a mail-triage pipeline that
> classifies and drafts replies without a message leaving the machine, and a
> job-discovery pipeline with a strict two-stage design — a cheap,
> deterministic gate runs first (I fixed a substring bug where a chef passed
> an "AI Engineering" filter because `ai` matched inside "available"), and
> only survivors reach the model, which returns a bounded 0–100 score, never
> free-form prose.

### `skill_ios_mobile` — sort 14 — tags: ios, swift, mobile, widgetkit

> I've shipped a native iOS app (Tauri iOS + Swift) to a physical device
> under Apple's free developer tier, including WidgetKit home-screen widgets
> reading live data from Supabase, plus a Live Activity. That tier forced
> real trade-offs: no `BGTaskScheduler` or silent push means the phone can't
> run background logic, so policy is computed server-side on a cron and the
> device just reads a verdict. Two signing paths (direct Xcode install vs. a
> CI-built IPA re-signed on-device) yield different entitlements from one
> source — an App Group survives one, not the other.

### `skill_graphics_3d` — sort 15 — tags: threejs, webgl, graphics, real-time, unity, unreal, gamedev

> I built a real-time 3D force-directed graph (three.js via
> react-force-graph-3d / react-three-fiber) with custom physics — Fibonacci-
> sphere placement, magnetic-field-style edge forces, node states driven by
> a live IPC feed — and debugged it at the render-loop level: a race between
> two `THREE` instances (graph library vs. shared component package)
> corrupted simulation state and crashed every frame until I deduped the
> dependency and reordered init relative to React's mount. I also built a
> from-scratch pointer-driven ink engine for PDF annotation.

### `skill_data_pipelines` — sort 16 — tags: data, pipelines, etl, analytics, postgres

> I've built several small but real ETL pipelines: a Garmin-to-Postgres
> importer that reconciles two competing data sources per metric (a config
> table decides per-metric whether Garmin or Oura wins, so an import can't
> silently overwrite the better source), keyed for idempotency on the
> provider's own activity ID rather than a freshly minted UUID, with floats
> rounded on ingest into integer columns and timestamps normalized from a
> naive local timezone into UTC. I've also built a day-coverage
> reconstruction that stitches screen-usage spans, sleep, workouts and
> calendar blocks into one 24-hour timeline.

### `skill_automation_n8n` — sort 17 — tags: n8n, automation, workflow, integration

> I use n8n as the orchestration layer for everything "nice to have" rather
> than load-bearing — since it runs in Docker on a Mac that sleeps, anything
> that must survive lives in a Postgres cron job and n8n only produces a row
> a client reads later. I've built multi-stage workflows there (RSS +
> sitemap discovery, a pure-function extractor with its own test suite, a
> rule gate, model scoring, a scoped edge-function upsert) and hit the real
> gotchas: `localhost` inside a container is the container, and Ollama
> refuses the Docker bridge until told to bind `0.0.0.0`.

---

## Slot: project (sort 20–29)

Longer-form highlights, one strong paragraph each.

### `project_ecosystem` — sort 20 — tags: fullstack, architecture, tauri, react, supabase

> The biggest thing I've built is the ecosystem itself: six Tauri
> 2/React 19/TypeScript apps — a life-planning tool, a health/fitness
> tracker, a note-taking app with a custom Tiptap-based editor and PDF
> annotation, a time-tracker with real device-level enforcement, a financial
> tracker, and a background "grid node" daemon — sharing one component
> library, one IPC hub, and one Supabase Postgres schema, developed solo in a
> single npm + Cargo workspace. It's not a portfolio piece; it's software I
> use every day, which means the failure modes had to be actually solved, not
> demoed around — schema migrations that can never remove a column a running
> deployment still reads, two enforcement processes that must never write the
> same file at once, RLS policies that fail toward "still blocked" rather
> than toward "open."

### `project_local_ai_pipelines` — sort 21 — tags: llm, automation, ai, python

> I designed and built two production automation pipelines around a local
> LLM, both following the same architecture: a Mac running n8n and Ollama
> does the work on a schedule, writes results to Postgres, and every client —
> desktop, iOS, web — just reads a row, because none of them can reach a
> laptop directly (an HTTPS page can't fetch `localhost`, and a phone isn't
> even on the same network as the Mac). The first triages Gmail — classifies,
> scores priority, drafts replies, all fully local so mail content never
> leaves the machine. The second discovers and screens job postings: two
> purpose-built HTML/JSON-LD extractors (verified against live pages, not
> just fixtures — the fixture tests missed a substring-matching bug and an
> "apply link vs. actual ad" extraction bug that only showed up on a live dry
> run), a rule-only gate that runs before the model ever wakes, and
> Qwen-based structured scoring that never touches the final application
> text.

### `project_health_platform` — sort 22 — tags: ble, hardware, reverse-engineering, health, integrations

> I reverse-engineered the Bluetooth LE protocol of an off-brand smart scale
> with no public documentation — packet capture, byte-offset decoding, BIA
> (bio-impedance) calibration constants — to get body-composition data into
> a health platform I built that also pulls from Garmin and Oura's real
> APIs. The interesting engineering problem wasn't the integration itself,
> it was reconciliation: two vendors report the same metric differently, a
> config table decides which one is authoritative per metric so an import
> can't silently clobber the better source, and every external ID has to be
> the provider's own ID or duplicate-activity bugs creep in from a freshly
> generated UUID on every re-sync.

### `project_editor_engine` — sort 23 — tags: editor, tiptap, canvas, frontend, graphics

> I built a note-taking and PDF-annotation app around a heavily customized
> Tiptap editor: structural block types (callouts, toggles, multi-column
> layouts) with correct ProseMirror `isolating` boundaries and their own
> Backspace/Enter key handling, a schema guard that inspects stored content
> *before* mounting an editor because an unrecognized node type doesn't get
> dropped — it silently blanks the entire document — and a from-scratch
> pointer-driven ink engine for Apple Pencil input with a tuned write-buffer
> flush window to keep per-stroke render cost from scaling with total canvas
> size. Getting PDF rendering correct meant tracking down four separate
> breaking changes in a major PDF.js version bump, including an API that
> silently renders nothing rather than erroring.

---

## Slot: education (sort 30) — DISABLED, do not enable until filled in

### `education_stub` — enabled: false — tags: education

> [TODO: verify — insert actual education history here: institution(s),
> degree/programme, years attended, graduation status. This repo contains no
> information about formal education and none should be inferred or
> invented. Do not enable this module, and do not let any assembled
> application imply a degree that hasn't been confirmed, until this is
> filled in and reviewed.]

---

## Slot: closing (sort 90)

### `closing_en` — lang en — tags: closing, availability

> I'm based in Copenhagen and open to on-site, hybrid or remote roles in
> Denmark. Happy to walk through any of the above in more depth — code, a
> live demo, or the repo itself. [TODO: portfolio/GitHub link — confirm which
> repositories are safe to make public-presentable before sending; the main
> workspace repo is currently public but contains personal life-tracking
> data flows that should be described rather than linked wholesale.]

### `closing_da` — lang da — tags: closing, availability

> Jeg bor i København og er åben for on-site, hybride eller remote stillinger
> i Danmark. Jeg viser gerne mere i dybden — kode, en live demo, eller selve
> repoet. [TODO: portfolio/GitHub-link — bekræft hvilke repos der er egnede
> at linke offentligt, inden noget sendes.]

---

## Slot: cv_link / portfolio_link (sort 30) — DISABLED, do not enable until filled in

### `cv_link` — enabled: false — tags: cv, resume

> [TODO: add a link to or attachment reference for an actual CV/resume once
> one exists in a state suitable for sending. Do not fabricate a CV or a
> download link.]

### `portfolio_link` — enabled: false — tags: portfolio, github

> [TODO: confirm which GitHub repositories / live app URLs are appropriate to
> share publicly with a prospective employer (the main workspace repo is
> public but contains personal data pipelines — decide whether to link it
> directly or describe it instead), then fill in the real link(s) here.]

---

## Summary table

| slot | name | lang | sort | enabled |
|---|---|---|---|---|
| intro | intro_swe_en | en | 0 | true |
| intro | intro_ai_en | en | 0 | true |
| intro | intro_game_en | en | 0 | true |
| intro | intro_swe_da | da | 0 | true |
| intro | intro_ai_da | da | 0 | true |
| skill | skill_rust_systems | en | 10 | true |
| skill | skill_typescript_react | en | 11 | true |
| skill | skill_supabase_backend | en | 12 | true |
| skill | skill_local_llm_ai | en | 13 | true |
| skill | skill_ios_mobile | en | 14 | true |
| skill | skill_graphics_3d | en | 15 | true |
| skill | skill_data_pipelines | en | 16 | true |
| skill | skill_automation_n8n | en | 17 | true |
| project | project_ecosystem | en | 20 | true |
| project | project_local_ai_pipelines | en | 21 | true |
| project | project_health_platform | en | 22 | true |
| project | project_editor_engine | en | 23 | true |
| education | education_stub | en | 30 | **false** |
| cv_link | cv_link | en | 30 | **false** |
| portfolio_link | portfolio_link | en | 30 | **false** |
| closing | closing_en | en | 90 | true |
| closing | closing_da | da | 90 | true |

22 modules total: 5 intro, 8 skills, 4 projects, 1 education (disabled),
2 links (disabled), 2 closing.
