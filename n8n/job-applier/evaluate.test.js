/**
 * Tests for the evaluation half of the job applier.
 *
 *   node --test evaluate.test.js
 *
 * Node's built-in runner, no dependencies — this folder is deliberately outside
 * the npm workspace so a job-pipeline change can never break an app build.
 *
 * Every case below corresponds to something a 7B model actually does, or to a
 * property the design depends on, rather than to coverage for its own sake. The
 * three that matter most:
 *
 *   - a hallucinated module id must become a VISIBLE GAP, never a substitution;
 *   - an absent score must be null, never 0;
 *   - `intro` and `closing` are a RULE, not something the model gets a vote on.
 *
 * The first two are the same failure mode the rest of this repo keeps designing
 * against: output that is plausible and wrong is worse than output that is
 * visibly missing, because nothing downstream can tell the difference.
 *
 * ⚠️ **Most fixtures below carry a `score`, and that is load-bearing.** Framing
 * only runs for a scored verdict with at least one chosen module, so a test that
 * omits the score is silently testing a path production never takes. The suite
 * did exactly that when framing was added, and every assertion still passed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assembleApplication,
  buildEvalPrompt,
  parseEvalResponse,
  planFromVerdict,
  truncateOnWhitespace,
} from "./evaluate.js";

// MARK: - Fixtures
//
// Shaped like the real seeded catalog, including the two properties that make
// framing hard: every intro shares `sort = 0` (so the tie-break must come from
// tags) and both closings share their tags (so it must come from lang).

const ID = {
  introEn: "11111111-1111-4111-8111-111111111111",
  introGames: "11111111-1111-4111-8111-111111111112",
  introDa: "11111111-1111-4111-8111-111111111113",
  skill: "22222222-2222-4222-8222-222222222222",
  project: "33333333-3333-4333-8333-333333333333",
  closingEn: "44444444-4444-4444-8444-444444444444",
  closingDa: "44444444-4444-4444-8444-444444444445",
};

const MODULES = [
  {
    id: ID.introEn,
    name: "Intro — AI",
    slot: "intro",
    tags: ["python", "llm"],
    lang: "en",
    sort: 0,
    content: "I am a software engineer working on applied machine learning.",
    enabled: true,
  },
  {
    id: ID.introGames,
    name: "Intro — Games",
    slot: "intro",
    tags: ["unity", "gamedev"],
    lang: "en",
    sort: 0,
    content: "I am a gameplay programmer.",
    enabled: true,
  },
  {
    id: ID.introDa,
    name: "Intro — AI (da)",
    slot: "intro",
    tags: ["python", "llm"],
    lang: "da",
    sort: 0,
    content: "Jeg er softwareudvikler med fokus på anvendt machine learning.",
    enabled: true,
  },
  {
    id: ID.skill,
    name: "Skills — Python & PyTorch",
    slot: "skill",
    tags: ["python", "pytorch", "ml"],
    lang: "en",
    sort: 10,
    content: "Day to day I write Python, and train models with PyTorch.",
    enabled: true,
  },
  {
    id: ID.project,
    name: "Project — Nexus life OS",
    slot: "project",
    tags: ["rust", "typescript", "tauri"],
    lang: "en",
    sort: 20,
    content: "I built Nexus, a suite of Tauri desktop apps sharing one backend.",
    enabled: true,
  },
  {
    id: ID.closingEn,
    name: "Closing",
    slot: "closing",
    tags: ["closing", "availability"],
    lang: "en",
    sort: 90,
    content: "I would be glad to talk further.",
    enabled: true,
  },
  {
    id: ID.closingDa,
    name: "Closing (da)",
    slot: "closing",
    tags: ["closing", "availability"],
    lang: "da",
    sort: 90,
    content: "Jeg vil meget gerne fortælle mere.",
    enabled: true,
  },
];

const MODULE_IDS = MODULES.map((m) => m.id);
const BODY_MODULES = MODULES.filter((m) => !["intro", "closing"].includes(m.slot));

const POSTING = {
  title: "AI Engineer",
  company: "Acme ApS",
  location: "Copenhagen",
  lang: "en",
  description: "We are looking for an AI engineer with Python and PyTorch experience.",
};

const PROFILE = {
  id: "99999999-9999-4999-8999-999999999999",
  name: "AI Engineering",
  keywords: ["python", "pytorch", "llm"],
  notes: "Prefers applied work over research.",
};

const HEADER = "Application: AI Engineer — Acme ApS";

const verdictOf = (obj) => {
  const r = parseEvalResponse(JSON.stringify(obj), { moduleIds: MODULE_IDS });
  assert.ok(r.ok, `expected a parse, got ${r.ok ? "" : r.error}`);
  return r.verdict;
};

/** A verdict shaped like production: scored, with matched skills to frame on. */
const scored = (obj) =>
  verdictOf({ score: 85, lang: "en", matched_skills: ["python", "llm"], ...obj });

// MARK: - Prompt

test("the prompt lists module metadata but never module content", () => {
  const { system, user } = buildEvalPrompt(POSTING, PROFILE, MODULES);
  assert.match(system, /SINGLE JSON object/);
  assert.ok(user.includes(ID.project), "the model cannot choose an id it was not shown");
  assert.ok(user.includes("rust, typescript, tauri"), "tags are what the model matches on");
  for (const m of MODULES) {
    assert.ok(
      !user.includes(m.content),
      `module prose leaked into the prompt: ${m.name} — content must never leave Supabase`,
    );
  }
});

test("intro and closing modules are NOT offered to the model", () => {
  const { system, user } = buildEvalPrompt(POSTING, PROFILE, MODULES);
  for (const id of [ID.introEn, ID.introGames, ID.introDa, ID.closingEn, ID.closingDa]) {
    assert.ok(!user.includes(id), `a framing module was offered as a choice: ${id}`);
  }
  assert.ok(user.includes(ID.skill) && user.includes(ID.project), "the body modules must be shown");
  assert.match(system, /added AUTOMATICALLY/, "the model should be told why they are absent");
});

test("the system prompt fences the ad as data and forbids writing prose", () => {
  const { system, user } = buildEvalPrompt(POSTING, PROFILE, MODULES);
  assert.match(system, /untrusted text/i);
  assert.match(system, /never as instructions/i);
  assert.match(system, /do NOT write cover letters/i);
  assert.ok(user.includes("=== JOB AD START"), "the ad must be delimited");
  assert.ok(user.includes("=== JOB AD END"), "an unterminated fence is not a fence");
});

test("an empty catalog says so rather than silently offering nothing", () => {
  const { user } = buildEvalPrompt(POSTING, PROFILE, []);
  assert.match(user, /catalog is empty/);
});

// MARK: - Truncation

test("truncation cuts on a whitespace boundary and marks the cut", () => {
  const words = "requirement ".repeat(2000); // ~24k chars
  const out = truncateOnWhitespace(words, 6000);
  assert.ok(out.length <= 6100, `runaway length ${out.length}`);
  assert.match(out, /\[…truncated\]$/);
  // The last real word must be whole — a half word reads to the model as a
  // complete requirements list that happens to end oddly.
  const body = out.replace(/ \[…truncated\]$/, "");
  assert.ok(!/requiremen$|requireme$|requirem$/.test(body), `split a word: ...${body.slice(-20)}`);
});

test("short text is returned untouched, with no marker", () => {
  assert.equal(truncateOnWhitespace("short and sweet", 6000), "short and sweet");
});

test("a 6000-char run with no whitespace still truncates", () => {
  const blob = "x".repeat(10_000);
  const out = truncateOnWhitespace(blob, 6000);
  assert.ok(out.length < 6100 && out.length > 5900, `unexpected length ${out.length}`);
});

test("the description reaches the prompt truncated, not whole", () => {
  const long = { ...POSTING, description: "word ".repeat(4000) };
  const { user } = buildEvalPrompt(long, PROFILE, MODULES);
  assert.ok(user.includes("[…truncated]"), "a 20k-char ad was pasted whole into the context");
});

// MARK: - Parsing

test("a bare JSON object parses", () => {
  const v = verdictOf({ score: 82, job_type: "ai engineer", lang: "en", reasoning: "Good fit." });
  assert.equal(v.score, 82);
  assert.equal(v.job_type, "ai engineer");
  assert.equal(v.lang, "en");
});

test("a ```json fenced response parses", () => {
  const raw = '```json\n{"score": 71, "job_type": "data scientist"}\n```';
  const r = parseEvalResponse(raw, { moduleIds: MODULE_IDS });
  assert.ok(r.ok);
  assert.equal(r.verdict.score, 71);
});

test("leading and trailing prose around the JSON parses", () => {
  const raw =
    'Sure! Here is the evaluation of the posting:\n\n{"score": 44, "missing_skills": ["kubernetes"]}\n\nLet me know if you want more detail.';
  const r = parseEvalResponse(raw, { moduleIds: MODULE_IDS });
  assert.ok(r.ok);
  assert.equal(r.verdict.score, 44);
  assert.deepEqual(r.verdict.missing_skills, ["kubernetes"]);
});

test("empty, null and garbage responses fail closed", () => {
  for (const bad of ["", "   ", null, undefined, 42, "no json here at all", "{{{"]) {
    const r = parseEvalResponse(bad, { moduleIds: MODULE_IDS });
    assert.equal(r.ok, false, `expected failure for ${JSON.stringify(bad)}`);
    assert.ok(typeof r.error === "string" && r.error.length > 0);
  }
});

test("a JSON array is not a verdict", () => {
  // `[{"score":1}]` slices to `{"score":1}` and would parse — the guard is that a
  // top-level array is rejected before that, so test the un-sliceable form.
  assert.equal(parseEvalResponse("[1, 2, 3]", { moduleIds: [] }).ok, false);
});

test("an absent score is null, not 0", () => {
  const v = verdictOf({ job_type: "ai engineer" });
  assert.equal(v.score, null, "a missing score must not read as 'scored zero'");
});

test("an unparseable score is null, not 0", () => {
  assert.equal(verdictOf({ score: "very high" }).score, null);
  assert.equal(verdictOf({ score: null }).score, null);
  assert.equal(verdictOf({ score: [] }).score, null);
});

test("scores clamp to 0-100 and round to an integer", () => {
  assert.equal(verdictOf({ score: 250 }).score, 100);
  assert.equal(verdictOf({ score: -30 }).score, 0);
  assert.equal(verdictOf({ score: 87.6 }).score, 88);
  assert.equal(verdictOf({ score: "73" }).score, 73);
  assert.equal(verdictOf({ score: 0 }).score, 0, "a genuine 0 is a real verdict and must survive");
});

test("lang normalizes to en/da, and to null when it is neither", () => {
  assert.equal(verdictOf({ lang: "Danish" }).lang, "da");
  assert.equal(verdictOf({ lang: "da-DK" }).lang, "da");
  assert.equal(verdictOf({ lang: "English" }).lang, "en");
  assert.equal(verdictOf({ lang: "swedish" }).lang, null);
  assert.equal(verdictOf({}).lang, null);
});

test("arrays are bounded, deduped and per-item truncated", () => {
  const v = verdictOf({
    required_skills: Array.from({ length: 120 }, (_, i) => `skill-${i}`),
    matched_skills: ["Python", "python", "PYTHON"],
    missing_skills: ["x".repeat(500)],
  });
  assert.equal(v.required_skills.length, 40);
  assert.deepEqual(v.matched_skills, ["Python"], "case-insensitive dedupe");
  assert.equal(v.missing_skills[0].length, 64);
});

test("reasoning is bounded at 1000 chars and control characters are stripped", () => {
  const v = verdictOf({ reasoning: `a bvery${"long ".repeat(600)}` });
  assert.ok(v.reasoning.length <= 1000);
  assert.ok(!/[ -‮]/.test(v.reasoning), "control/bidi characters reached the column");
});

test("a hallucinated module id is dropped, never repaired", () => {
  const v = verdictOf({
    chosen_module_ids: [ID.skill, "00000000-0000-4000-8000-000000000000", "the-skill-module"],
  });
  assert.deepEqual(v.chosen_module_ids, [ID.skill]);
  assert.equal(v.dropped_module_ids.length, 2, "the drop must be reportable, not silent");
});

// MARK: - Plan: gaps

test("a hallucinated id surfaces as a gap, not as a substituted module", () => {
  const verdict = scored({
    module_slots_needed: ["skill", "project"],
    // 'project' is answered with an invented id — the module exists in the
    // catalog, but the model did not actually choose it.
    chosen_module_ids: [ID.skill, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
  });
  const plan = planFromVerdict(verdict, MODULES);

  assert.deepEqual(plan.missing_slots, ["project"]);
  assert.ok(
    !plan.chosen.includes(ID.project),
    "a nearby module was substituted for an invented id — this is the invisible-lie failure",
  );

  const app = assembleApplication(plan, MODULES, POSTING);
  assert.ok(app.body.includes("[GAP: no module for 'project']"));
  assert.ok(!app.body.includes("I built Nexus"), "the un-chosen project module leaked in");
});

test("every needed slot with no module at all becomes a gap", () => {
  const verdict = scored({
    module_slots_needed: ["skill", "cv_link", "portfolio_link"],
    chosen_module_ids: [ID.skill],
  });
  const plan = planFromVerdict(verdict, MODULES);
  assert.deepEqual(plan.missing_slots, ["cv_link", "portfolio_link"]);
});

test("an empty catalog yields all gaps and no invented text", () => {
  const verdict = scored({ module_slots_needed: ["skill", "project"], chosen_module_ids: [] });
  const plan = planFromVerdict(verdict, []);
  const app = assembleApplication(plan, [], POSTING);
  assert.deepEqual(app.module_ids, []);
  assert.deepEqual(plan.chosen, [], "framing must not run when nothing was chosen");
  assert.equal(
    app.body,
    `${HEADER}\n\n[GAP: no module for 'skill']\n\n[GAP: no module for 'project']`,
  );
});

test("a chosen module whose slot nobody asked for is still included", () => {
  const verdict = scored({
    module_slots_needed: ["skill"],
    chosen_module_ids: [ID.skill, ID.project],
  });
  const plan = planFromVerdict(verdict, MODULES);
  assert.ok(plan.chosen.includes(ID.project), "a deliberate choice was silently dropped");
  assert.deepEqual(plan.missing_slots, []);
});

test("a disabled module cannot be chosen even if the model names it", () => {
  const catalog = MODULES.map((m) => (m.id === ID.skill ? { ...m, enabled: false } : m));
  const verdict = parseEvalResponse(
    JSON.stringify({ score: 60, module_slots_needed: ["skill"], chosen_module_ids: [ID.skill] }),
    { moduleIds: catalog.filter((m) => m.enabled).map((m) => m.id) },
  );
  const plan = planFromVerdict(verdict.verdict, catalog);
  assert.deepEqual(plan.chosen, []);
  assert.deepEqual(plan.missing_slots, ["skill"]);
});

// MARK: - Slot vocabulary
//
// Live regression, 2026-08-25: told to name a slot even when nothing could fill
// it, the 7B invented one slot per missing technology — `skill_python`,
// `skill_linux`, `skill_vllm`, `skill_kubernetes` — and then chose NO modules at
// all. An 85-scored job assembled into a header and ten gap markers with two
// obviously relevant modules unchosen. The vocabulary is closed for that reason.

test("invented per-skill slot names are dropped", () => {
  const verdict = scored({
    module_slots_needed: ["skill_python", "skill_kubernetes", "skill", "skill_vllm"],
    chosen_module_ids: [ID.skill],
  });
  const plan = planFromVerdict(verdict, MODULES);
  assert.deepEqual(
    plan.missing_slots,
    [],
    "an invented slot became a gap — the missing skill belongs in missing_skills",
  );
  assert.ok(!JSON.stringify(plan.slots).includes("skill_python"));
});

test("a conventional slot with no module is still a real gap", () => {
  // Dropping invented slots must not cost us the honest whole-slot gaps.
  const verdict = scored({
    module_slots_needed: ["skill", "cv_link", "portfolio_link"],
    chosen_module_ids: [ID.skill],
  });
  assert.deepEqual(planFromVerdict(verdict, MODULES).missing_slots, ["cv_link", "portfolio_link"]);
});

test("a slot the catalog uses is accepted even if unconventional", () => {
  const catalog = [...MODULES, { id: "x1", name: "Ref", slot: "reference", lang: "en", sort: 40, content: "A reference." }];
  const verdict = parseEvalResponse(
    JSON.stringify({ score: 70, module_slots_needed: ["reference"], chosen_module_ids: [ID.skill] }),
    { moduleIds: catalog.map((m) => m.id) },
  ).verdict;
  assert.deepEqual(planFromVerdict(verdict, catalog).missing_slots, ["reference"]);
});

test("the prompt names the closed slot vocabulary and forbids inventing one", () => {
  const { system } = buildEvalPrompt(POSTING, PROFILE, MODULES);
  assert.match(system, /PARAGRAPH KINDS/);
  assert.match(system, /skill_python/, "the failure mode should be named, not merely implied");
  assert.match(system, /chose\s*\n?\s*nothing, you have made a mistake|chose nothing/);
});

// MARK: - Framing
//
// Measured 2026-08-25: the model picks skill/project modules well and omits intro
// and closing erratically — one stored 85-score draft opened with a skill
// paragraph and carried GAP markers for both, against five enabled intros and two
// closings. These slots are therefore computed, not chosen.

test("intro and closing are added automatically for a scored verdict", () => {
  const verdict = scored({
    module_slots_needed: ["skill", "project"],
    chosen_module_ids: [ID.skill, ID.project],
  });
  const plan = planFromVerdict(verdict, MODULES);

  assert.deepEqual(
    plan.chosen,
    [ID.introEn, ID.skill, ID.project, ID.closingEn],
    "framing did not run, or ran in the wrong body order",
  );
  assert.deepEqual(plan.missing_slots, []);
  assert.equal(plan.slots[0].slot, "intro");
  assert.equal(plan.slots[plan.slots.length - 1].slot, "closing");
});

test("the intro is picked by tag overlap, not alphabetically", () => {
  // 'Intro — AI' sorts before 'Intro — Games' and both are sort 0, so an
  // implementation that skipped the tag tie-break would always pick the AI one.
  const verdict = scored({
    matched_skills: ["unity", "gamedev"],
    module_slots_needed: ["skill"],
    chosen_module_ids: [ID.skill],
  });
  const plan = planFromVerdict(verdict, MODULES);
  assert.ok(plan.chosen.includes(ID.introGames), "tag overlap did not decide the intro");
  assert.ok(!plan.chosen.includes(ID.introEn));
});

test("required_skills also count toward the intro tie-break", () => {
  const verdict = scored({
    matched_skills: [],
    required_skills: ["unity", "gamedev"],
    module_slots_needed: ["skill"],
    chosen_module_ids: [ID.skill],
  });
  assert.ok(planFromVerdict(verdict, MODULES).chosen.includes(ID.introGames));
});

test("a Danish ad gets the Danish intro and the Danish closing", () => {
  const verdict = scored({
    lang: "da",
    module_slots_needed: ["skill"],
    chosen_module_ids: [ID.skill],
  });
  const plan = planFromVerdict(verdict, MODULES);
  assert.deepEqual(plan.chosen, [ID.introDa, ID.skill, ID.closingDa]);
});

test("language beats tag overlap — the two closings differ only by lang", () => {
  // Both closings carry identical tags, so nothing but `lang` can separate them.
  // Alphabetically 'Closing' precedes 'Closing (da)', so a lang-blind rule would
  // send a Danish employer an English sign-off.
  const plan = planFromVerdict(
    scored({ lang: "da", module_slots_needed: [], chosen_module_ids: [ID.skill] }),
    MODULES,
  );
  assert.ok(plan.chosen.includes(ID.closingDa));
  assert.ok(!plan.chosen.includes(ID.closingEn));
});

test("an unknown language falls back to English, not to nothing", () => {
  const verdict = scored({ lang: "swedish", chosen_module_ids: [ID.skill] });
  assert.equal(verdict.lang, null, "the fixture should exercise the null-lang path");
  const plan = planFromVerdict(verdict, MODULES);
  assert.ok(plan.chosen.includes(ID.introEn));
  assert.ok(plan.chosen.includes(ID.closingEn));
});

test("an intro the model named is overridden by the rule, and never duplicated", () => {
  // The workflow validates against the FULL catalog, so a framing id can survive
  // parsing. Exactly one intro must come out, and it must be the rule's.
  const verdict = scored({
    matched_skills: ["python", "llm"],
    chosen_module_ids: [ID.introGames, ID.skill],
  });
  const plan = planFromVerdict(verdict, MODULES);
  const intros = plan.chosen.filter((id) =>
    [ID.introEn, ID.introGames, ID.introDa].includes(id),
  );
  assert.deepEqual(intros, [ID.introEn], "the model's intro choice was honoured, or duplicated");
});

test("framing does not run without a score", () => {
  // A null score means the model failed. Framing a failure dresses it up as a
  // considered verdict — the same reason `evaluated_at` is not stamped.
  const verdict = verdictOf({ module_slots_needed: ["skill"], chosen_module_ids: [ID.skill] });
  assert.equal(verdict.score, null);
  assert.deepEqual(planFromVerdict(verdict, MODULES).chosen, [ID.skill]);
});

test("framing does not run when nothing was chosen", () => {
  // An intro, a gap and a sign-off is worse than an honest empty.
  const verdict = scored({ module_slots_needed: ["skill"], chosen_module_ids: [] });
  const plan = planFromVerdict(verdict, MODULES);
  assert.deepEqual(plan.chosen, []);
  assert.deepEqual(plan.missing_slots, ["skill"]);
});

test("a catalog with no closing still gaps at the end", () => {
  const noClosing = MODULES.filter((m) => m.slot !== "closing");
  const verdict = scored({ module_slots_needed: ["skill"], chosen_module_ids: [ID.skill] });
  const plan = planFromVerdict(verdict, noClosing);
  assert.deepEqual(plan.missing_slots, ["closing"]);
  const app = assembleApplication(plan, noClosing, POSTING);
  assert.ok(app.body.endsWith("[GAP: no module for 'closing']"));
});

// MARK: - Assembly

test("the assembled body is exactly header + framed prose + gap markers", () => {
  const verdict = scored({
    module_slots_needed: ["skill", "project", "education"],
    chosen_module_ids: [ID.project, ID.skill], // deliberately out of order
  });
  const plan = planFromVerdict(verdict, MODULES);
  const app = assembleApplication(plan, MODULES, POSTING);

  // Pinned verbatim. `job-ingest/logic.ts` holds the canonical assembler and must
  // produce this same string; this assertion is what makes a drift loud.
  assert.equal(
    app.body,
    `${HEADER}\n\n` +
      "I am a software engineer working on applied machine learning.\n\n" +
      "Day to day I write Python, and train models with PyTorch.\n\n" +
      "I built Nexus, a suite of Tauri desktop apps sharing one backend.\n\n" +
      "I would be glad to talk further.\n\n" +
      "[GAP: no module for 'education']",
  );
  assert.deepEqual(app.module_ids, [ID.introEn, ID.skill, ID.project, ID.closingEn]);
  assert.deepEqual(app.missing_slots, ["education"]);
});

test("the intro opens the body and the closing ends it, whatever `sort` says", () => {
  // A module added later with a careless sort must not be able to open the letter.
  const perverse = MODULES.map((m) =>
    m.id === ID.introEn ? { ...m, sort: 999 } : m.id === ID.closingEn ? { ...m, sort: -5 } : m,
  );
  const verdict = scored({ module_slots_needed: ["skill"], chosen_module_ids: [ID.skill] });
  const app = assembleApplication(planFromVerdict(verdict, perverse), perverse, POSTING);
  const lines = app.body.split("\n\n");
  assert.equal(lines[1], "I am a software engineer working on applied machine learning.");
  assert.equal(lines[lines.length - 1], "I would be glad to talk further.");
});

test("assembly is deterministic — the same input twice is byte-identical", () => {
  const verdict = scored({
    module_slots_needed: ["skill", "project"],
    chosen_module_ids: [ID.skill],
  });
  const a = assembleApplication(planFromVerdict(verdict, MODULES), MODULES, POSTING);
  const b = assembleApplication(planFromVerdict(verdict, MODULES), MODULES, POSTING);
  assert.equal(a.body, b.body);
  assert.deepEqual(a.module_ids, b.module_ids);

  // …and independent of the order the catalog happened to come back in.
  const shuffled = [...MODULES].reverse();
  const c = assembleApplication(planFromVerdict(verdict, shuffled), shuffled, POSTING);
  assert.equal(c.body, a.body, "catalog row order changed the draft");
});

test("modules with an identical sort are ordered by name, then id", () => {
  const tied = [
    { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "B", slot: "skill", sort: 5, content: "second" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "A", slot: "skill", sort: 5, content: "first" },
  ];
  const verdict = parseEvalResponse(
    JSON.stringify({
      score: 50,
      module_slots_needed: ["skill"],
      chosen_module_ids: tied.map((m) => m.id),
    }),
    { moduleIds: tied.map((m) => m.id) },
  ).verdict;
  const app = assembleApplication(planFromVerdict(verdict, tied), tied, POSTING);
  assert.ok(app.body.indexOf("first") < app.body.indexOf("second"));
});

test("a posting with no company still gets a header", () => {
  const verdict = scored({ module_slots_needed: [], chosen_module_ids: [ID.skill] });
  const app = assembleApplication(planFromVerdict(verdict, BODY_MODULES), BODY_MODULES, {
    title: "Gameplay Programmer",
  });
  assert.ok(app.body.startsWith("Application: Gameplay Programmer\n\n"));
  assert.ok(!app.body.includes("—"), "a dangling em dash means a null company was interpolated");
});

test("nothing in the body comes from the model", () => {
  const verdict = scored({
    reasoning: "SENTINEL — the model wrote this",
    job_type: "SENTINEL-TYPE",
    module_slots_needed: ["skill"],
    chosen_module_ids: [ID.skill],
  });
  const app = assembleApplication(planFromVerdict(verdict, MODULES), MODULES, POSTING);
  assert.ok(!app.body.includes("SENTINEL"), "model-generated text reached the draft body");
});

test("a plan referring to a module that has since been deleted degrades cleanly", () => {
  const plan = { job_type: null, slots: [], missing_slots: [], chosen: [ID.skill, ID.project] };
  const app = assembleApplication(plan, [MODULES[3]], POSTING);
  assert.deepEqual(app.module_ids, [ID.skill]);
  assert.ok(app.body.includes("train models with PyTorch"));
});

test("assembleApplication never throws on junk", () => {
  for (const args of [
    [null, null, null],
    [{}, [], {}],
    [{ chosen: "not-an-array" }, MODULES, POSTING],
    [{ chosen: [ID.skill], missing_slots: "nope" }, MODULES, POSTING],
  ]) {
    const out = assembleApplication(...args);
    assert.equal(typeof out.body, "string");
    assert.ok(Array.isArray(out.module_ids));
  }
});
