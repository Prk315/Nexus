-- modules.seed.sql
--
-- Starter application-module library for job_app_modules (phase 2 of the job
-- applier — see JOB_APPLIER_PLAN.md section 6). A local Qwen assembles an
-- application draft by SELECTing a covering set of these rows; it never
-- writes prose of its own. The human-readable copy, with editing notes and
-- the gap principle explained, is n8n/job-applier/MODULES.md — read that
-- first if you are Bastian reviewing this before it ships.
--
-- Ownership: seeded explicitly for user_id
-- 'a33625c2-4dd2-44fa-b2e5-4d455eeac59d' (Bastian — see
-- project_bodyscan_autosync memory: this uuid is confirmed real, not a
-- duplicate account). A migration/seed script has no auth session, so
-- `auth.uid()` is unavailable here — unlike the SQL-editor examples in
-- n8n/job-applier/README.md, which run as an authenticated user and can use
-- it directly.
--
-- Idempotent: guarded with `on conflict do nothing` against the
-- (user_id, lower(name)) unique index expected on job_app_modules (the same
-- shape as job_profiles_user_name_idx in
-- supabase/migrations/20260824120000_job_pipeline.sql). Safe to re-run.
--
-- ⚠️ Two modules are seeded enabled = false with unresolved [TODO: ...]
-- markers in their content (education_stub, cv_link, portfolio_link).
-- Nothing containing an unresolved TODO may be assembled into a sent
-- application. Do not flip enabled to true until the real text replaces the
-- TODO. See MODULES.md's "Every [TODO: ...] is a hard stop" section.
--
-- Content uses dollar-quoted string literals throughout (delimiter "mod")
-- so apostrophes in the prose (there are many — "I've", "doesn't") never
-- need escaping.

-- ---------------------------------------------------------------------------
-- slot: intro (sort 0) — pick exactly one per application
-- ---------------------------------------------------------------------------

insert into public.job_app_modules
  (user_id, name, slot, tags, lang, content, enabled, sort)
values
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'intro_swe_en',
    'intro',
    array['fullstack','rust','react','typescript','tauri'],
    'en',
    $mod$I build a personal software ecosystem end to end — six interconnected desktop and mobile apps sharing one Postgres backend, one design system, and one IPC layer I wrote myself. My daily work spans Rust (Tauri) and TypeScript/React on the frontend, Postgres schema and row-level-security design on the backend, and enough Swift to ship a native iOS companion app with home-screen widgets. I care most about systems that stay correct under real failure modes — a phone asleep, a database shared by every branch, two processes racing to write the same file — rather than ones that only work in the demo.$mod$,
    true,
    0
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'intro_ai_en',
    'intro',
    array['llm','ai','ml','automation','rag'],
    'en',
    $mod$I run a local-LLM pipeline in production for myself: Ollama serving Qwen on a Mac, orchestrated by n8n, doing real classification and extraction work — mail triage that scores and drafts replies, and a job pipeline that gates candidates on rules before ever waking the model, then scores survivors against a structured rubric. Both share one principle: the model never writes final prose or makes an unsupervised final decision, only a verdict something downstream can check. I'm comfortable across the stack — prompt and schema design, local inference constraints (7B, Q4, 32k context), and the plumbing that turns a laptop that sleeps into a database every client can trust.$mod$,
    true,
    0
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'intro_game_en',
    'intro',
    array['gamedev','unity','unreal','c++','c#','graphics','real-time'],
    'en',
    $mod$My background is systems and graphics programming rather than shipped game credits, and I'd rather say that plainly than dress it up: I've built a real-time 3D force-directed graph renderer (three.js / react-three-fiber) with custom physics-style layout forces, a from-scratch ink/drawing engine with pointer-event stroke capture and vector rendering, and BLE protocol reverse-engineering down to raw byte offsets for an undocumented device. That's the same muscle gameplay and engine programming uses — real-time rendering, simulation, low-level protocol work — just not exercised inside a game studio yet. I'm looking for a team where that transfers.$mod$,
    true,
    0
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'intro_swe_da',
    'intro',
    array['fullstack','rust','react','typescript','tauri'],
    'da',
    $mod$Jeg bygger et personligt software-økosystem fra bunden — seks sammenkoblede desktop- og mobilapps, der deler én Postgres-backend, ét designsystem og ét IPC-lag, jeg selv har skrevet. Det daglige arbejde spænder fra Rust (Tauri) og TypeScript/React i frontend til Postgres-skemadesign og row-level security i backend, samt nok Swift til at shippe en native iOS-app med hjemmeskærms-widgets. Det, jeg går mest op i, er systemer der forbliver korrekte under virkelige fejlscenarier — en telefon der sover, en database delt af hver eneste branch, to processer der kapløber om at skrive samme fil — ikke systemer der kun virker i demoen.$mod$,
    true,
    0
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'intro_ai_da',
    'intro',
    array['llm','ai','ml','automation','rag'],
    'da',
    $mod$Jeg kører en lokal LLM-pipeline i produktion til mig selv: Ollama med Qwen på en Mac, orkestreret af n8n, til reel klassificerings- og ekstraktionsopgaver — mail-triage der scorer og udkaster svar, og en jobmatch-pipeline der først filtrerer kandidater på regler, før modellen overhovedet vækkes, og derefter scorer de overlevende mod en struktureret rubrik. Begge dele bygger på samme princip: modellen skriver aldrig endelig prosa eller træffer en endelig beslutning uden opsyn — den producerer en vurdering, som et menneske eller et efterfølgende system kan kontrollere.$mod$,
    true,
    0
  )
on conflict (user_id, lower(name)) do nothing;

-- ---------------------------------------------------------------------------
-- slot: skill (sort 10-17) — concrete evidence per skill area
-- ---------------------------------------------------------------------------

insert into public.job_app_modules
  (user_id, name, slot, tags, lang, content, enabled, sort)
values
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_rust_systems',
    'skill',
    array['rust','systems','tauri','backend'],
    'en',
    $mod$I write Rust daily in a Tauri 2 desktop/mobile workspace — a background grid-node daemon that runs headless under a macOS LaunchAgent, shares one binary between a windowed app and a --daemon mode, and enforces device policy by rewriting /etc/hosts as an idempotent fixed-point function — an already-correct file re-renders to itself byte-for-byte, which is what keeps a 30-second enforcement loop from prompting for a password every cycle. The same crate also drives a BLE scanner and a subprocess bridge for a fitness API integration.$mod$,
    true,
    10
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_typescript_react',
    'skill',
    array['typescript','react','frontend'],
    'en',
    $mod$React 19 and TypeScript across five apps sharing one component library — a 3D app-topology graph, a shared calendar sidebar, a command palette, and a custom rich-text editor. I've hit the sharp edges that only show up at this scale: dual-instance React from a mismatched dependency (blank white screen, no error), a Tailwind v4 build that silently drops styles from a workspace package Vite never touches directly, and a useLayoutEffect/useEffect scheduling race that crashed a force-graph library's animation frame until the mount was gated correctly.$mod$,
    true,
    11
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_supabase_backend',
    'skill',
    array['postgres','supabase','sql','rls','backend'],
    'en',
    $mod$I design and evolve a single shared Postgres schema (Supabase) spanning roughly a hundred tables across six applications — forward-only migrations, row-level-security scoped to auth.uid(), security_invoker views (a view without that flag silently bypasses the base table's RLS), and trigger-maintained columns where correctness can't be left to the client. I've also audited RLS done wrong: a handful of tables were still permissively world-writable, and I wrote the migration plan to close it — the mismatched-JWT trap, an empty result instead of an error, looks fine until it doesn't.$mod$,
    true,
    12
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_local_llm_ai',
    'skill',
    array['llm','ai','ml','rag','ollama','python','automation'],
    'en',
    $mod$I run local inference (Ollama, Qwen 2.5 at 3B and 7B, Q4, 32k context) as production infrastructure, not a demo: a mail-triage pipeline that classifies and drafts replies without a message leaving the machine, and a job-discovery pipeline with a strict two-stage design — a cheap, deterministic gate runs first (I fixed a substring bug where a chef passed an "AI Engineering" filter because "ai" matched inside "available"), and only survivors reach the model, which returns a bounded 0-100 score, never free-form prose.$mod$,
    true,
    13
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_ios_mobile',
    'skill',
    array['ios','swift','mobile','widgetkit'],
    'en',
    $mod$I've shipped a native iOS app (Tauri iOS + Swift) to a physical device under Apple's free developer tier, including WidgetKit home-screen widgets reading live data from Supabase, plus a Live Activity. That tier forced real trade-offs: no BGTaskScheduler or silent push means the phone can't run background logic, so policy is computed server-side on a cron and the device just reads a verdict. Two signing paths (direct Xcode install vs. a CI-built IPA re-signed on-device) yield different entitlements from one source — an App Group survives one, not the other.$mod$,
    true,
    14
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_graphics_3d',
    'skill',
    array['threejs','webgl','graphics','real-time','unity','unreal','gamedev'],
    'en',
    $mod$I built a real-time 3D force-directed graph (three.js via react-force-graph-3d / react-three-fiber) with custom physics — Fibonacci-sphere placement, magnetic-field-style edge forces, node states driven by a live IPC feed — and debugged it at the render-loop level: a race between two THREE instances (graph library vs. shared component package) corrupted simulation state and crashed every frame until I deduped the dependency and reordered init relative to React's mount. I also built a from-scratch pointer-driven ink engine for PDF annotation.$mod$,
    true,
    15
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_data_pipelines',
    'skill',
    array['data','pipelines','etl','analytics','postgres'],
    'en',
    $mod$I've built several small but real ETL pipelines: a Garmin-to-Postgres importer that reconciles two competing data sources per metric (a config table decides per-metric whether Garmin or Oura wins, so an import can't silently overwrite the better source), keyed for idempotency on the provider's own activity ID rather than a freshly minted UUID, with floats rounded on ingest into integer columns and timestamps normalized from a naive local timezone into UTC. I've also built a day-coverage reconstruction that stitches screen-usage spans, sleep, workouts and calendar blocks into one 24-hour timeline.$mod$,
    true,
    16
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'skill_automation_n8n',
    'skill',
    array['n8n','automation','workflow','integration'],
    'en',
    $mod$I use n8n as the orchestration layer for everything "nice to have" rather than load-bearing — since it runs in Docker on a Mac that sleeps, anything that must survive lives in a Postgres cron job and n8n only produces a row a client reads later. I've built multi-stage workflows there (RSS + sitemap discovery, a pure-function extractor with its own test suite, a rule gate, model scoring, a scoped edge-function upsert) and hit the real gotchas: localhost inside a container is the container, and Ollama refuses the Docker bridge until told to bind 0.0.0.0.$mod$,
    true,
    17
  )
on conflict (user_id, lower(name)) do nothing;

-- ---------------------------------------------------------------------------
-- slot: project (sort 20-23) — longer-form highlights
-- ---------------------------------------------------------------------------

insert into public.job_app_modules
  (user_id, name, slot, tags, lang, content, enabled, sort)
values
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'project_ecosystem',
    'project',
    array['fullstack','architecture','tauri','react','supabase'],
    'en',
    $mod$The biggest thing I've built is the ecosystem itself: six Tauri 2/React 19/TypeScript apps — a life-planning tool, a health/fitness tracker, a note-taking app with a custom Tiptap-based editor and PDF annotation, a time-tracker with real device-level enforcement, a financial tracker, and a background "grid node" daemon — sharing one component library, one IPC hub, and one Supabase Postgres schema, developed solo in a single npm + Cargo workspace. It's not a portfolio piece; it's software I use every day, which means the failure modes had to be actually solved, not demoed around — schema migrations that can never remove a column a running deployment still reads, two enforcement processes that must never write the same file at once, RLS policies that fail toward "still blocked" rather than toward "open."$mod$,
    true,
    20
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'project_local_ai_pipelines',
    'project',
    array['llm','automation','ai','python'],
    'en',
    $mod$I designed and built two production automation pipelines around a local LLM, both following the same architecture: a Mac running n8n and Ollama does the work on a schedule, writes results to Postgres, and every client — desktop, iOS, web — just reads a row, because none of them can reach a laptop directly (an HTTPS page can't fetch localhost, and a phone isn't even on the same network as the Mac). The first triages Gmail — classifies, scores priority, drafts replies, all fully local so mail content never leaves the machine. The second discovers and screens job postings: two purpose-built HTML/JSON-LD extractors (verified against live pages, not just fixtures — the fixture tests missed a substring-matching bug and an "apply link vs. actual ad" extraction bug that only showed up on a live dry run), a rule-only gate that runs before the model ever wakes, and Qwen-based structured scoring that never touches the final application text.$mod$,
    true,
    21
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'project_health_platform',
    'project',
    array['ble','hardware','reverse-engineering','health','integrations'],
    'en',
    $mod$I reverse-engineered the Bluetooth LE protocol of an off-brand smart scale with no public documentation — packet capture, byte-offset decoding, BIA (bio-impedance) calibration constants — to get body-composition data into a health platform I built that also pulls from Garmin and Oura's real APIs. The interesting engineering problem wasn't the integration itself, it was reconciliation: two vendors report the same metric differently, a config table decides which one is authoritative per metric so an import can't silently clobber the better source, and every external ID has to be the provider's own ID or duplicate-activity bugs creep in from a freshly generated UUID on every re-sync.$mod$,
    true,
    22
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'project_editor_engine',
    'project',
    array['editor','tiptap','canvas','frontend','graphics'],
    'en',
    $mod$I built a note-taking and PDF-annotation app around a heavily customized Tiptap editor: structural block types (callouts, toggles, multi-column layouts) with correct ProseMirror isolating boundaries and their own Backspace/Enter key handling, a schema guard that inspects stored content before mounting an editor because an unrecognized node type doesn't get dropped — it silently blanks the entire document — and a from-scratch pointer-driven ink engine for Apple Pencil input with a tuned write-buffer flush window to keep per-stroke render cost from scaling with total canvas size. Getting PDF rendering correct meant tracking down four separate breaking changes in a major PDF.js version bump, including an API that silently renders nothing rather than erroring.$mod$,
    true,
    23
  )
on conflict (user_id, lower(name)) do nothing;

-- ---------------------------------------------------------------------------
-- slot: education (sort 30) — DISABLED. Education/employment history is
-- unknown to this task; do not invent it. Resolve the TODO, then flip
-- enabled to true, before any application can include it.
-- ---------------------------------------------------------------------------

insert into public.job_app_modules
  (user_id, name, slot, tags, lang, content, enabled, sort)
values
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'education_stub',
    'education',
    array['education'],
    'en',
    $mod$[TODO: verify — insert actual education history here: institution(s), degree/programme, years attended, graduation status. This repo contains no information about formal education and none should be inferred or invented. Do not enable this module, and do not let any assembled application imply a degree that hasn't been confirmed, until this is filled in and reviewed.]$mod$,
    false,
    30
  )
on conflict (user_id, lower(name)) do nothing;

-- ---------------------------------------------------------------------------
-- slot: cv_link / portfolio_link (sort 30) — DISABLED stubs for CV/portfolio
-- references. Each module's own name doubles as its slot value, per the
-- conventional vocabulary named in 20260825120000_job_evaluation.sql.
-- ---------------------------------------------------------------------------

insert into public.job_app_modules
  (user_id, name, slot, tags, lang, content, enabled, sort)
values
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'cv_link',
    'cv_link',
    array['cv','resume'],
    'en',
    $mod$[TODO: add a link to or attachment reference for an actual CV/resume once one exists in a state suitable for sending. Do not fabricate a CV or a download link.]$mod$,
    false,
    30
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'portfolio_link',
    'portfolio_link',
    array['portfolio','github'],
    'en',
    $mod$[TODO: confirm which GitHub repositories / live app URLs are appropriate to share publicly with a prospective employer (the main workspace repo is public but contains personal data pipelines — decide whether to link it directly or describe it instead), then fill in the real link(s) here.]$mod$,
    false,
    30
  )
on conflict (user_id, lower(name)) do nothing;

-- ---------------------------------------------------------------------------
-- slot: closing (sort 90)
-- ---------------------------------------------------------------------------

insert into public.job_app_modules
  (user_id, name, slot, tags, lang, content, enabled, sort)
values
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'closing_en',
    'closing',
    array['closing','availability'],
    'en',
    $mod$I'm based in Copenhagen and open to on-site, hybrid or remote roles in Denmark. Happy to walk through any of the above in more depth — code, a live demo, or the repo itself. [TODO: portfolio/GitHub link — confirm which repositories are safe to make public-presentable before sending; the main workspace repo is currently public but contains personal life-tracking data flows that should be described rather than linked wholesale.]$mod$,
    true,
    90
  ),
  (
    'a33625c2-4dd2-44fa-b2e5-4d455eeac59d',
    'closing_da',
    'closing',
    array['closing','availability'],
    'da',
    $mod$Jeg bor i København og er åben for on-site, hybride eller remote stillinger i Danmark. Jeg viser gerne mere i dybden — kode, en live demo, eller selve repoet. [TODO: portfolio/GitHub-link — bekræft hvilke repos der er egnede at linke offentligt, inden noget sendes.]$mod$,
    true,
    90
  )
on conflict (user_id, lower(name)) do nothing;
