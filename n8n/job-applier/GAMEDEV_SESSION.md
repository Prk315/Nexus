# Session brief — finishing the modular CV for game dev

Prepared 2026-09-01. Everything below was read from the live database, the repo,
and the JobSearch folder on the Desktop — nothing here is assumed.

The pipeline is built and running. What is missing is **content**, and the
content is missing because it needed facts that were not in this repo. Most of
those facts turn out to exist already, in
`~/Desktop/Desktop - Bastian’s MacBook Air/JobSearch/` (dated Jan 2026).

---

## 1. Where the pipeline actually is

| | |
|---|---|
| `job_postings` | 48 (newest `2026-08-28`) |
| `job_matches` | 144, of which **58 scored** |
| `job_applications` | 58 drafts |
| `job_app_modules` | **22 rows — the seed is live**, matching `MODULES.md` exactly |
| Game Dev matches | 10 scored, range 0–85 |

The module table is the source of truth now, not `MODULES.md` (that file says so
itself). Edits happen in SQL.

---

## 2. What a real game-dev draft looks like today

This is the evidence that the library is under-built for game dev. All four rows
are live `job_applications`:

| Posting | Score | Modules chosen | Body | State |
|---|---|---|---|---|
| **Sybo Games — Game Engineer** (ats) | 85 | 3 | 1674 ch | `needs_approval`, **ships a literal `[TODO:` string** |
| **Sybo Games — Game Engineer** (unknown) | 85 | 2 — *intro + closing only, no body* | 1125 ch | `needs_approval`, **ships a literal `[TODO:`** |
| **Unity — SWE, Tooling & Automation** | 65 | **0** | 184 ch | `draft`, all four slots `[GAP]` |
| **Tactile Games — AI Technical Artist** | 35 | **0** | 48 ch | `draft` — effectively empty |

Two separate problems, and they need different fixes:

1. **The catalog has almost nothing for a game role to choose.** One
   gamedev-tagged skill module (`skill_graphics_3d`), zero gamedev-tagged
   project modules, and no `experience` module at all — even though
   `experience` is in `KNOWN_SLOTS` (`evaluate.js`). The model is not failing;
   it is picking from a shelf that is bare. Sybo's own `missing_skills` were
   *software engineering principles, data structures, algorithms, design
   patterns, version control, agile* — six requirements, no module covers any.
2. **`closing_en` ships a `[TODO]` verbatim.** `JOB_APPLIER_PLAN.md` §7 flags
   this ("one seeded module escapes that last row") and it is now confirmed in
   stored drafts. `enabled = true` with an unresolved TODO inside means the guard
   that stops the disabled stubs does not stop this one.

**Also true and worth knowing before writing anything:** every game-dev posting
found so far is `apply_channel = 'ats'` or `'unknown'`. None is `'email'`, so
none is auto-sendable by design. For game dev the pipeline is
assemble-and-prefill; a human presses submit. That lowers the risk of getting
the modules wrong, and it means the modules are read by *you* first, every time.

**Gate noise:** only 3 of 10 Game Dev matches are real game jobs. The rest are
*Unity Skolen* (a school), *Unity* the company's non-game roles, and IT-support
ads. `exclude_terms` already carries `unity skolen` yet two of its ads still
scored. Worth a look, but it is a separate problem from the CV.

---

## 3. The facts that were missing — most of them already exist

From `JobSearch/background information/` and `cv.tex` (Jan 2026):

- **Education** — BSc Machine Learning and Data Science, University of
  Copenhagen, 2023–2026, *in progress*. Coursework named: Machine Learning A,
  Highly Efficient Programming, Database Systems. → resolves `education_stub`.
- **Employment** — Danish Armed Forces, Engineer Company (conscription)
  2022–2023; Salesforce salesman 2024 (1 month); Rekum bartender 2022; Netto
  retail 2020; fishmonger 2017. No software employment.
- **Links** — `github.com/Prk315`, `prk315.github.io/personal-website`,
  LinkedIn `bastian-thomsen-167652205`. → unblocks `portfolio_link` *once the
  what-is-safe-to-link question is answered*.
- **Certificates** — four Codecademy paths, dated, 109+ hours.
- **Game-relevant biography nothing currently uses**: `me.md` says he built his
  first PC at 13 and taught himself to make video games from there — 3D
  software, game engines, self-directed. For a studio that is a better opening
  than it looks, and no module contains it.

### Three contradictions to settle before writing

- **Location.** Both closing modules say *"based in Copenhagen"*. The CV and
  `me.md` say **Holte**. Greater Copenhagen, but it is a factual claim in a
  letter.
- **Seniority voice.** The modules read as a working engineer ("I write Rust
  daily", "five apps"). `cv.tex` reads *"ML student eager to turn academic
  foundations into real-world impact"*. Both are defensible; they cannot both
  be in the same application.
- **The CV is 8 months stale.** `cv.tex` (Jan 2026) is ML-framed: Python, C,
  SQL, scikit-learn. `skills.md` grades **C++ Beginner, TypeScript Beginner, no
  Rust, no Unity, no C#**. None of the Nexus ecosystem — Rust/Tauri, React 19,
  the Postgres schema, the local-LLM pipelines — appears anywhere in it. The
  module library is built entirely on work the CV does not mention. A studio
  receiving the assembled letter *and* that CV gets two different people.

---

## 4. Decisions taken (2026-09-01)

**Game-dev evidence: nothing beyond the graphics work already in the modules.**
No Unity, no Unreal, no C#, no Blender, nothing shipped or playable. So the
game-dev case is built from what is genuinely there and claims nothing else:
the three.js / react-three-fiber renderer with custom layout forces, the
from-scratch ink engine, the BLE byte-level protocol work, the two-`THREE`-
instance render-loop debugging — plus the two items below. `intro_game_en`'s
"no shipped game credits, and I'd rather say that plainly" framing is not a
placeholder; it is the correct and permanent posture for this profile.

**New fact, and it matters more than it looks.** Coursework currently in
progress at KU: **robotics, hybrid quantum programming, virtual reality, and
advanced algorithms.** Two of those four are directly on target — *virtual
reality* is real-time 3D by another name, and *advanced algorithms* answers
four of the six requirements Sybo's ad listed as missing (software engineering
principles, data structures, algorithms, design patterns). This is the single
biggest addition available to the game-dev profile, and it currently appears in
no module and in no CV.

⚠️ These are **in progress**, and must read that way. "Currently taking advanced
algorithms" is a fact; "strong in algorithms" is a claim the coursework does not
yet support. The gap principle applies to tense as well as to content.

**CV: left alone this session.** `cv_link` therefore **stays `enabled = false`**.
Do not fill it with the Jan 2026 PDF — it is ML-framed, eight months stale, and
would contradict the letter it travels with. The stub stays a visible gap, which
is the designed behaviour. Rewriting it is its own session.

**Links: GitHub profile yes; Nexus described, never linked.** `portfolio_link`
carries `github.com/Prk315` and nothing else. The Nexus repo is public but is a
life-OS — health, screen usage, mail — and handing an employer that URL hands
them all of it. The personal website was not selected either, so it stays out
until it is deliberately chosen. The closing paragraph describes the ecosystem
and offers a walkthrough on request, which is what `closing_en`'s TODO was
asking for all along.

**Education and experience: both, stated plainly.**
- `education_stub` → enabled: BSc Machine Learning and Data Science, University
  of Copenhagen, 2023–2026, in progress, expected 2026. Never phrased so it
  could be read as completed. Names the in-progress coursework above.
- A new `experience` module: Danish Armed Forces, Engineer Company
  (conscription) 2022–2023. The retail, bar and sales jobs stay out of a
  game-studio letter.

**Location: Copenhagen, phrased as presence rather than address.** Currently
living in Odense temporarily, but mainly in Copenhagen for university. So
neither the old *"I'm based in Copenhagen"* (an address claim that isn't
currently true) nor *"Holte"* (out of date) is right. The closings say he is in
Copenhagen most of the week for the studies — true, and it answers the only
thing a Copenhagen studio is actually asking.

Odense is not mentioned. It is temporary, and raising it invites a commute
question that does not reflect the situation. One consequence to keep in view:
all three profiles match on `denmark` as well as `copenhagen`, so a Funen-area
posting can surface — and for one of those, being in Odense is an advantage the
closing would hide. If Odense-area roles are wanted, that is a separate closing
module, not an edit to this one.

**The master's stays in `education_ku_ml`, including on game applications.**
Raised as a concern — a studio could read "heading into a quantum-information
master's" next to "nothing I enjoy more than games" as *this is a stop on the
way elsewhere*. Decided against changing it: these are the paths currently under
consideration, and something at least a year out is not a problem for a new hire.
No game-specific education variant. Do not re-open this.

### ⚠️ FLAGGED: the Gmail 7-day expiry cannot be fixed in Google's console

CLAUDE.md says the permanent fix is *Google Auth Platform → Audience → Publish
app*. **That is not currently possible**, and this is the detail that entry is
missing. Checked in the console on 2026-09-01:

- **Publish app is greyed out.** Tooltip: *"Valid app name, support email,
  homepage URL and privacy policy URL are required for switching the app to
  external production mode."* App name (`Nexus n8n`) and support email are set;
  **homepage URL and privacy policy URL are not**, and both must be real hosted
  pages, with the domain registered under Authorised domains.
- **Adding test users does nothing.** `bastianrthomsen@gmail.com` is already
  listed, 1/100 used. The ~7-day refresh-token expiry is a property of *Testing
  mode itself* and applies to every test user of an unpublished app. There is no
  setting inside Testing that disables it.
- **"Make internal" is unavailable** — that needs a Workspace organisation, not
  a consumer Gmail account.
- ⚠️ **Do not upload the app logo** as part of "finishing" Branding. The console
  states that uploading one requires submitting for verification, which is a far
  larger process than publishing.

So there are exactly two real options:

| | Path A — satisfy Google | Path B — drop OAuth |
|---|---|---|
| Work | host a homepage + a written privacy policy (`prk315.github.io`), register the authorised domain | enable 2FA, generate a Google **App Password**, move to SMTP (send) + IMAP (read) |
| Risk | `github.io` is on the Public Suffix List and Google's authorised-domain field is awkward about it — unverified whether it is accepted | App Passwords need 2FA and Google has been narrowing them |
| Fixes | the job pipeline and mail triage | the same, and removes the consent screen entirely |
| Cost | writing a privacy policy for a single-user automation | one n8n workflow edit, plus repo drift (below) |

**Path B is the recommendation.** `job-notify` only ever emails *the user* — it
has no reason to hold a Gmail API credential at all.

⚠️ **If Path B is taken, edit `job-notify` in the n8n editor UI, never by
re-importing the JSON.** `n8n import:workflow` clears `activeVersionId` and
silently retires a running workflow (CLAUDE.md, "A workflow with `active = 1` is
not necessarily running"). The cost is that
`n8n/job-applier/workflows/job-notify.json` then drifts from what is live and
must be mirrored back by hand.

**Stopgap, and it is only that:** *Switch account* on the Gmail credential in
n8n re-runs OAuth and buys another ~7 days. Note the credential page shows a
green *"Account connected"* the whole time it is broken — n8n reports that a
token is stored, not that it works, so the failure is only ever visible at
runtime.

### Still open, and deliberately deferred

- The CV rewrite, and where a CV would be hosted.
- The portfolio site — in or out, later.
- An Odense/Funen closing variant, only if those roles are wanted.

---

## 4b. What was executed, 2026-09-01

Steps 1–4 below are **done**, against the live `job_app_modules` table. Written
by Claude from the facts in `JobSearch/background information/` and this repo,
on your "just do your thing" — so the prose is drafted, not yours. Read it
before anything goes out; every sentence is editable in place with an `update`.

- Rewrote `closing_en` / `closing_da`; filled and enabled `education_ku_ml`
  (renamed from `education_stub`) and `portfolio_link`; left `cv_link`
  **disabled**. Added `experience_armed_forces`, `skill_cs_foundations`,
  `skill_tools_pipeline`. Retagged `project_editor_engine` so a game ad can
  reach it — prose untouched, tags only.
- **24 enabled modules, 0 containing a `[TODO]`** (was 19 enabled, 2 of them
  shipping one).
- **31 applications demoted `needs_approval` → `draft`** and **58 matches
  requeued** (`score`/`evaluated_at` set null). The next `job-evaluate` pass
  re-scores them and the upsert overwrites `body` — that is how the fixes reach
  the stored drafts, since a draft is frozen text.

⚠️ **33 of the 58 stored drafts had been shipping the `[TODO:` string**, 28 of
them sitting in `needs_approval`. None could have been auto-sent: `job-apply`
requires `apply_channel = 'email'` and all 28 were `ats` or `unknown`, so the
guard in `JOB_APPLIER_PLAN.md` §7 held. They were hand-copyable, though, which
is why they were demoted rather than left.

**Verified, not assumed.** `evaluate-dryrun.mjs` was run read-only against the
live queue with the real local Qwen: 4/4 parsed, the new modules are reachable
(`skill_cs_foundations` chosen twice, `education_ku_ml` once), and the three real
ads assembled with **0 gaps** where game-dev drafts had previously come out
empty. Nothing was written by the dry run.

**Three things still to watch:**
1. **One-sentence echo.** `skill_graphics_3d` closes on "I also built a
   from-scratch pointer-driven ink engine for PDF annotation", and
   `project_editor_engine` then describes that engine properly. Read as
   mention-then-elaborate it is fine; if it grates, delete that one trailing
   sentence. Left alone because it is your prose, not mine.
2. **`skill_graphics_3d` carries `unity` and `unreal` tags** from the original
   seed while its content claims neither. Tags drive selection, not prose, so
   nothing false is asserted — but it is why a Unity ad reaches it.
3. **Qwen answered once in Chinese.** The Unity Skolen ad came back with its
   `reasoning` field in Mandarin. Harmless here (score 10, correctly rejected),
   but `reasoning` is rendered in the decision email, so it will eventually show
   up in your inbox looking like a fault. Pre-existing model behaviour, not
   something this session changed.

---

## 4c. n8n restarted, 2026-09-01

Docker Desktop was not running at all, so neither was n8n. Started it; the
container came back on its own restart policy.

- **Active:** Gmail triage ×3, Job Harvest, **Job Evaluate**, **Job Notify**.
- **Not active: Job Apply** — correct, and left that way. It is the one
  irreversible workflow, and `README.md` step 5 says it is activated only after
  a manual run whose result you checked in Gmail → Sent.
- Verified from inside the container: Supabase resolves (401, i.e. reached) and
  Ollama answers on `host.docker.internal:11434`. The previous boot had died on
  `getaddrinfo ENOTFOUND` for Supabase — that was the Mac being offline, not
  configuration.

⚠️ **Draining the queue takes about eight hours.** `job-evaluate` is a
30-minute schedule with `limit: 4`, and 61 matches are queued — roughly 16
passes. Inference measured at ~85 s per posting in the dry run, so a pass is
~6 minutes of Qwen and then 24 idle. Nothing is wrong if the numbers move
slowly; that is the designed rate.

⚠️ **`job-notify` is active, so decision emails will arrive as drafts
regenerate** — every 15 minutes, 5 at a time. Expect a stream of them today.
That is the intended loop, but it is a lot of mail in one afternoon, and each
one is asking you to read a letter Claude drafted. Reading `intro_game_en`
through `closing_en` once, first, is worth more than triaging them one by one.

---

## 4d. First real pass, 21:35 — it works, and it found two bugs

The 21:32 scheduled `job-evaluate` completed against the rewritten library.
Two 85-score drafts, **2141 and 2233 characters** (the old ones were 1125–1674),
four modules each, **no `[TODO]`**. The pipeline is sound end to end.

Two defects surfaced, neither of them in the module text:

⚠️ **1. `[GAP: no module for 'experience']` is a false statement.**
`experience_armed_forces` exists and is enabled, and it was in the catalog for
that run. `missing_slots` means *"a slot the model asked for and chose nothing
for"* (`evaluate.js`, the comment above `planFromVerdict`), but the marker
rendered at `evaluate.js:682` says `no module for '{slot}'` — a different claim,
and here an untrue one. This is precisely the conflation the rest of the repo
designs against: *nothing exists* and *nothing was chosen* must not print the
same sentence. Both real drafts carry it.

The underlying cause is the one already solved for `intro` and `closing`: the
model erratically declines to fill a slot whose choice is not really a judgement.
`experience` has **exactly one** enabled module, so there is no choice to make —
"anything derivable should be derived" applies unchanged. The fix is a
single-module slot being filled by rule, plus honest wording on the marker, in
`supabase/functions/job-ingest/logic.ts` (the canonical assembler) mirrored into
`evaluate.js`. **Not done** — it is a code change and an edge-function deploy,
which is past editing prose.

⚠️ **2. The gap marker prints after the closing.** Gaps are appended last
(`evaluate.js:647`, step 3), so a letter with any gap ends on a bracketed
marker *below* the sign-off rather than in the slot's own position.

**No decision emails are being sent, and that is a third problem.**
`job-notify` ran at 21:30 and reported success, but every application is still
`draft` — nothing was promoted to `needs_approval`. The n8n log says why:

> `The credential "Gmail account" needs to be reconnected.`
> `Access could not be refreshed because the connected account has revoked
> access, the refresh token expired...`

This is the trap CLAUDE.md names exactly: the Google OAuth consent screen is
still in **Testing**, so Google expires refresh tokens on a ~7-day cycle and the
only symptom is triage quietly ceasing. It also stops the `gmail_alert`
discoverer and all mail triage. The permanent fix is Google Auth Platform →
**Audience** → **Publish app**; the immediate one is reconnecting the credential
in n8n.

The design held up under it: `notify_result` is posted *only* if Gmail accepted
the message, so a dead credential leaves the row `draft` and the next pass
retries. Nothing was lost and nothing was falsely marked done.

---

## 4e. The experience-gap fix — written and tested, NOT deployed

`supabase/functions/job-ingest/logic.ts`, two changes:

1. **`pickUncontestedModule`** — a needed slot the model asked for and then chose
   nothing for is filled **only when the catalog holds exactly one** enabled
   module for it. Same argument `FRAMING_SLOTS` already won: choosing among one
   option is not a judgement about the ad. With two or more candidates the slot
   stays a gap, because declining to pick is then a real judgement and picking
   for it would put a paragraph into a job application on the strength of
   alphabetical order. Gated on `framing`, so a scoreless or empty plan is not
   dressed up as a considered one.
2. **The gap marker no longer lies.** `[GAP: no module for '{slot}']` when nobody
   has written one; `[GAP: no module chosen for '{slot}']` when one exists and
   none was picked. Two different states, two different sentences — the
   `blocking_state`-is-never-seeded rule applied to a draft.

`logic.test.ts` grew 7 cases: **60/60 pass**. One of them pins the safety
property that `GAP_MARKERS` matches the `[GAP` prefix rather than a whole
sentence, so rewording a marker can never open the send gate.

**Deployed 2026-09-01 21:02 UTC — `job-ingest` version 7 → 8, ACTIVE.**

```
npx supabase functions deploy job-ingest --project-ref efxmzsdisaymtpebaxlp --no-verify-jwt
```

⚠️ **`--no-verify-jwt` is mandatory and there is nothing in the repo to remind
you.** There is no `supabase/config.toml`, so the CLI defaults `verify_jwt` to
**true**, while `job-ingest` authenticates on the `X-Job-Key` header. Deploying
without the flag makes the gateway reject every n8n post before the function is
reached — the pipeline would stop dead with no code change to blame.

Verified after deploy by calling the function with no JWT: it answered
`{"error":"unauthorized"}`, which is the function's **own** body. A gateway
rejection would have been `{"code":401,"message":"Missing authorization
header"}`. Reaching the function at all is the proof that `verify_jwt` is off.

⚠️ **`npx supabase login` cannot complete inside Claude Code.** Both the agent
shell and the `!` prefix are non-TTY, and the CLI refuses the browser flow there
(`Cannot use automatic login flow inside non-TTY environments`). It has to be run
in a real terminal. Do not paste the token into the session — `!` input is
echoed into the transcript and the token is account-scoped.

Facts checked before deploying, and they must stay true on any redeploy:

- **`verify_jwt = false`.** `job-ingest` authenticates on `X-Job-Key`, not a JWT.
  Deploying it as `true` breaks the entire pipeline.
- The deployed `job-ingest/logic.ts` and `index.ts` are **byte-identical to
  committed HEAD**, so these edits are the only job-ingest change riding along.
- ⚠️ **One thing does ride along.** The deployed copy of
  `functions/n8n-ingest/logic.ts` is 69 lines behind the committed one — the
  mail-bus `pending` drain-queue action, committed but never redeployed into
  *this* function's bundle. The drift is a single pure append with no existing
  code modified, and the same source already runs in the `n8n-ingest` function.
  Additive, but it is a second change in the same deploy and worth knowing.

---

## 4f. State at end of session, 2026-09-01 23:06

| | |
|---|---|
| Modules enabled | **26**, none containing a `[TODO]` |
| `cv_link` | text written, **`enabled = false`** — staged, PDF not yet hosted |
| `job-ingest` | **v8 deployed**, `verify_jwt` off (probe-confirmed) |
| Queue | 9 scored, **52 still to evaluate** — drains overnight at 4 per 30 min |
| Applications | 58, **all `draft`**, none approved, none submitted |
| n8n | up; harvest / evaluate / notify active, **`job-apply` still dormant** |
| Gmail | reconnected 22:45, zero errors since — **expires ~8 Sep** |

**VERIFIED in production, 21:05 UTC** — the first evaluate pass after the deploy
exercised both fixes on real drafts:

| Posting | Score | Result |
|---|---|---|
| Senior Machine Learning Engineer | 85 | `missing_slots: []`, 5 modules, **experience paragraph present**. The back-fill worked — previously this would have been a gap. |
| AI/ML udvikler i PET | 85 | `missing_slots: ["project"]` rendered as **`[GAP: no module chosen for 'project']`**. Correct and honest: seven project modules exist and the model picked none of them. The old wording would have claimed none existed. |

Both fixes behave exactly as the tests predicted. The query that showed it:

```sql
select po.title, a.missing_slots,
       (a.body like '%professional software experience%') as has_experience_para
from job_matches m
join job_postings po on po.id = m.posting_id
join job_applications a on a.posting_id = m.posting_id and a.profile_id = m.profile_id
where m.evaluated_at > '2026-09-01 21:02:12+00'
order by m.evaluated_at desc limit 5;
```

### The three things standing between this and a sent application

1. **`cv_link` is disabled** → guard 4 skips every application (`cv_missing`).
   Host `cv_2026.pdf`, verify the URL resolves, then enable. Nothing sends until
   this is done, which is also why nothing can go out by accident overnight.
2. **`job-apply` is not active**, deliberately. `README.md` step 5 is the only
   irreversible step in the pipeline and wants one manual run checked in Gmail →
   Sent before activation.
3. **Nobody has read the library end to end.** Every module is Claude's prose
   written from facts the user supplied in conversation. Factually his,
   structurally his voice, but unread — particularly `intro_game_en` and
   `experience_why_a_team`, which make claims about *who he is* rather than what
   he has built. That review is worth an hour before anything is sent.

---

## 5. Order of work

1. **Fix `closing_en` / `closing_da`.** Strip the `[TODO]`, put in the GitHub
   profile, describe rather than link Nexus, settle Copenhagen vs Holte. This is
   first because it unblocks *every* profile, not just game dev, and because two
   drafts are sitting in `needs_approval` shipping that TODO right now.
2. **Enable `education_stub`** with the real KU facts and the in-progress
   coursework. **Leave `cv_link` disabled.** Fill and enable `portfolio_link`
   with the GitHub profile only.
3. **Write the `experience` module** (Armed Forces). The slot is in
   `KNOWN_SLOTS` and has never had a module.
4. **Write the game-dev body modules** — the actual subject of the session.
   Target the shelf that is currently bare: a real-time/simulation skill module,
   an algorithms-and-systems-foundations module carrying the coursework, and a
   project module built from the renderer and the ink engine. Tag them so
   `skill_graphics_3d` stops being the only thing a game role can pick.
5. **Re-run `job-evaluate`** against the four real postings (Sybo ×2, Unity
   Tooling, Tactile) and read the regenerated drafts. Fixtures test the parser;
   only a re-run tests the library.

All edits are `update`/`insert` against `job_app_modules` in Supabase.
`modules.seed.sql` is `on conflict do nothing` and will not re-seed over them.
