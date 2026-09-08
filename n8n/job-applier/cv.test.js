/**
 * Tests for the modular CV.
 *
 *   node --test cv.test.js
 *
 * The highest-value cases here are the FIDELITY ones. A per-job CV is only worth
 * having if it is still his CV: the moment assembly can drop a degree, reword a
 * bullet or reorder Experience into something that reads as a different career,
 * the feature has stopped tailoring a document and started inventing one.
 *
 * So the suite is built around three properties, in descending order of how much
 * damage their absence would do:
 *
 *   1. with nothing to rank on, the output carries every fact `cv_2026.tex`
 *      carries, in the same order — modularising the CV must be a refactor;
 *   2. relevance may reorder and (under a budget) trim, and may never change a
 *      single word of an entry;
 *   3. contact, profile and education survive every budget, because a CV that
 *      loses its degree to a token-overlap heuristic is worse than no CV.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ALWAYS_KEPT,
  CV_SECTIONS,
  assembleCv,
  cvTagOverlap,
  cvTokens,
  escapeHtml,
  escapeLatex,
  renderHtml,
  renderLatex,
} from "./cv.js";
import { CV_ENTRIES, CV_FOOTER } from "./cv-entries.js";

// MARK: - Fidelity
//
// ⚠️ **This invariant changed once, deliberately, and the reason matters.**
//
// While `cv-entries.js` was verbatim from `cv_2026.tex`, the test pinned whole
// SENTENCES: modularising the CV was a refactor, so no word was allowed to move.
// The prose has since been rewritten to read like a professional CV, which
// retires that particular assertion — pinning sentences would now only pin the
// rewrite against itself.
//
// What must still hold, and is what this list now encodes, is the stronger and
// more permanent property: **no fact may be added or lost.** Organisations,
// dates, the degree, project names and technologies are what a CV is read for
// and what a reader will check. Prose may be sharpened; the record may not move.
//
// Every string below is copied out of `JobSearch/cv_2026.tex` by hand. That is
// the point: if these are ever derived from `cv-entries.js` the test becomes
// circular and asserts only that the catalog equals itself.

const FACTS_FROM_THE_REAL_CV = [
  // Identity and contact.
  "Bastian Rønfeldt Thomsen",
  "+45 42 66 08 98",
  "Bastianrthomsen@gmail.com",
  "Copenhagen, Denmark",
  // Every project named on the real CV.
  "Autonomous Game Entities",
  "Nexus — Personal Software Ecosystem",
  "University Knowledge Graph",
  "MIRTE Robot",
  // Every organisation and date range.
  "University of Copenhagen",
  "Danish Armed Forces",
  "2026 – Present",
  "2022 – 2023",
  "2023 – 2026",
  // The qualification, and the roles, exactly as claimed.
  "BSc Machine Learning and Data Science",
  "In Progress",
  "Instructor — High Performance Programming and Systems",
  "Engineer Company — Conscription",
  // Coursework.
  "Hybrid Quantum Programming",
  "Robot Systems and Vision",
  "Machine Learning A",
  "Database Systems",
  "MSc in Quantum Information",
  // The skills lines, which are a factual inventory and must survive verbatim.
  "Rust, TypeScript, Python, SQL, C, Swift, F#",
  "Unreal Engine, three.js / WebGL, real-time rendering",
  "PyTorch, scikit-learn, reinforcement learning",
  "PostgreSQL / Supabase, Tauri, Docker, Git, REST APIs, n8n, ETL pipelines",
  // Load-bearing technical claims that a reader would ask about in an interview.
  "topologically sorted into a dependency DAG",
  "Rust, reinforcement learning, Unreal Engine",
  "DAG, Markov chains, Kalman filters, local LLMs",
  "Robotics, computer vision, probabilistic state estimation",
];

/**
 * Claims that must NOT appear, because nobody has established them.
 *
 * A rewrite for tone is exactly where inflation enters a CV, and it enters as
 * seniority, headcount and scale — none of which is in any source document. This
 * list is the cheap guard against the next edit reaching for them.
 */
const CLAIMS_NOBODY_MADE = [
  "senior",
  "lead engineer",
  "led a team",
  "managed a team",
  "years of experience",
  "shipped to production for",
  "million",
  "startup founder",
  "award",
  "certified",
];

test("the rewritten prose adds no claim nobody made", () => {
  const doc = `${renderHtml(assembleCv(CV_ENTRIES))} ${renderLatex(assembleCv(CV_ENTRIES))}`.toLowerCase();
  for (const claim of CLAIMS_NOBODY_MADE) {
    assert.ok(!doc.includes(claim), `unestablished claim reached the CV: ${claim}`);
  }
});

test("an unranked build carries every fact the real CV carries", () => {
  const cv = assembleCv(CV_ENTRIES);
  const html = renderHtml(cv);
  const tex = renderLatex(cv);

  for (const fact of FACTS_FROM_THE_REAL_CV) {
    assert.ok(html.includes(escapeHtml(fact)), `HTML lost: ${fact}`);
    assert.ok(tex.includes(escapeLatex(fact)), `LaTeX lost: ${fact}`);
  }
});

test("an unranked build includes every enabled entry, and drops nothing", () => {
  const cv = assembleCv(CV_ENTRIES);
  assert.equal(cv.included.length, CV_ENTRIES.length);
  assert.deepEqual(cv.omitted, [], "nothing may be omitted without a budget");
  assert.equal(cv.ranked, false, "no skills means no ranking claim");
});

test("sections appear in document order, never in catalog order", () => {
  const cv = assembleCv(CV_ENTRIES);
  const order = cv.sections.map((s) => s.section);
  assert.deepEqual(order, CV_SECTIONS.filter((s) => order.includes(s)));
  assert.equal(order[0], "contact", "contact leads");
  assert.equal(order[order.length - 1], "skills", "skills close");
});

test("an unranked build keeps the catalog's own order inside a section", () => {
  const cv = assembleCv(CV_ENTRIES);
  const work = cv.sections.find((s) => s.section === "work");
  assert.deepEqual(
    work.entries.map((e) => e.name),
    ["work_game_entities", "work_nexus", "work_knowledge_graph", "work_mirte_robot"],
  );
});

// MARK: - The public copy
//
// A CV emailed to a named employer and a CV sitting at a public URL are not the
// same disclosure. The second is permanent, indexed and harvested, so the phone
// number is marked `private` and dropped from it.

test("a public copy carries no private contact detail", () => {
  const cv = assembleCv(CV_ENTRIES, { publicCopy: true });
  const docs = [renderLatex(cv), renderHtml(cv)];
  for (const doc of docs) {
    assert.ok(!doc.includes("42 66 08 98"), "the phone number reached a public build");
    // Everything else a reader needs must survive.
    assert.ok(doc.includes(escapeHtml("Bastianrthomsen@gmail.com")) || doc.includes("Bastianrthomsen@gmail.com"));
    assert.ok(doc.includes("Copenhagen, Denmark"));
    assert.ok(doc.includes("Prk315"));
  }
});

test("the default build still carries the phone", () => {
  const tex = renderLatex(assembleCv(CV_ENTRIES));
  assert.ok(tex.includes("42 66 08 98"), "a direct copy must keep it");
});

test("a public build does not contaminate the next build", () => {
  // CV_ENTRIES is a module-level constant shared by every build in the process.
  // Filtering it in place would strip the phone from the copy emailed to a
  // person, and only on runs where a public build happened to come first.
  assembleCv(CV_ENTRIES, { publicCopy: true });
  assert.ok(renderLatex(assembleCv(CV_ENTRIES)).includes("42 66 08 98"));

  const contact = CV_ENTRIES.find((e) => e.name === "contact_main");
  assert.equal(contact.data.items.length, 3, "the catalog itself must be untouched");
});

// MARK: - Relevance

test("a game posting leads with the game work, without changing a word of it", () => {
  const skills = ["unreal", "gamedev", "real-time rendering", "c++"];
  const cv = assembleCv(CV_ENTRIES, { skills });
  const work = cv.sections.find((s) => s.section === "work");

  assert.equal(work.entries[0].name, "work_game_entities");
  assert.equal(cv.ranked, true);

  const original = CV_ENTRIES.find((e) => e.name === "work_game_entities");
  assert.deepEqual(work.entries[0].bullets, original.bullets, "bullets must be untouched");
  assert.equal(work.entries[0].meta, original.meta);
});

test("a data posting leads with different work than a game posting", () => {
  const game = assembleCv(CV_ENTRIES, { skills: ["unreal", "gamedev"] });
  const data = assembleCv(CV_ENTRIES, { skills: ["postgres", "etl", "sql", "supabase"] });

  const lead = (cv) => cv.sections.find((s) => s.section === "work").entries[0].name;
  assert.equal(lead(game), "work_game_entities");
  assert.equal(lead(data), "work_nexus");
  assert.notEqual(lead(game), lead(data), "the whole point of the feature");
});

test("ranking never adds or removes an entry on its own", () => {
  const plain = assembleCv(CV_ENTRIES).included.slice().sort();
  const ranked = assembleCv(CV_ENTRIES, { skills: ["unreal", "rust"] }).included.slice().sort();
  assert.deepEqual(ranked, plain, "relevance reorders; only a budget may remove");
});

test("a pinned entry leads its section regardless of relevance", () => {
  // `skills_languages` is pinned and carries no unreal/graphics tags, so a pure
  // overlap sort would put `skills_engines_graphics` above it.
  const cv = assembleCv(CV_ENTRIES, { skills: ["unreal", "webgl", "graphics"] });
  const skills = cv.sections.find((s) => s.section === "skills");
  assert.equal(skills.entries[0].name, "skills_languages");
});

// MARK: - Budget

test("a budget trims the least relevant and says what it dropped", () => {
  const cv = assembleCv(CV_ENTRIES, { skills: ["unreal", "gamedev"], budget: { work: 2 } });
  const work = cv.sections.find((s) => s.section === "work");

  assert.equal(work.entries.length, 2);
  assert.equal(work.entries[0].name, "work_game_entities");
  assert.equal(cv.omitted.length, 2);
  for (const o of cv.omitted) {
    assert.equal(o.section, "work");
    assert.equal(o.reason, "budget");
  }
});

test("no budget can remove contact, profile or education", () => {
  const cv = assembleCv(CV_ENTRIES, {
    skills: ["cobol"],
    budget: { contact: 0, profile: 0, education: 0, work: 0, experience: 0, skills: 0 },
  });
  const kept = cv.sections.map((s) => s.section);
  for (const section of ALWAYS_KEPT) {
    assert.ok(kept.includes(section), `${section} must survive any budget`);
  }
  assert.ok(!kept.includes("work"), "an unprotected section may be emptied");
  assert.ok(
    renderLatex(cv).includes(escapeLatex("BSc Machine Learning and Data Science")),
    "the degree must still be in the document",
  );
});

test("an emptied section is reported as data, never as a marker in the document", () => {
  const cv = assembleCv(CV_ENTRIES, { skills: ["cobol"], budget: { work: 0, experience: 0 } });
  const tex = renderLatex(cv);
  const html = renderHtml(cv);

  assert.ok(cv.omitted.length > 0, "the omission must be visible to a reviewer");
  for (const doc of [tex, html]) {
    assert.ok(!doc.includes("[GAP"), "a CV must never carry a gap marker");
    assert.ok(!doc.includes("[TODO"), "nor a TODO");
    assert.ok(!doc.includes("Current Work"), "an empty section prints no heading");
  }
});

// MARK: - Escaping

test("LaTeX escaping survives the characters the real CV actually contains", () => {
  assert.equal(escapeLatex("F#"), "F\\#");
  assert.equal(escapeLatex("ML & AI"), "ML \\& AI");
  assert.equal(escapeLatex("~100 tables"), "\\textasciitilde{}100 tables");
  assert.equal(escapeLatex("a_b"), "a\\_b");
  assert.equal(escapeLatex("100%"), "100\\%");
  // Backslash first, or every replacement escapes the previous one's output.
  assert.equal(escapeLatex("\\"), "\\textbackslash{}");
});

test("the rendered LaTeX leaves no raw special character in body text", () => {
  const cv = assembleCv(CV_ENTRIES);
  const tex = renderLatex(cv, { footer: CV_FOOTER });
  // `F#` and `~100` are the two that would break a build; both must be escaped.
  assert.ok(tex.includes("F\\#"), "F# must be escaped");
  assert.ok(tex.includes("\\textasciitilde{}100 tables"), "~ must be escaped");

  // Only the BODY. `#1`..`#4` in the preamble are macro parameters in the real
  // `\cventry` / `\projectentry` definitions and must stay exactly as they are.
  const body = tex.split("\\begin{document}")[1];
  assert.ok(!/[^\\]#/.test(body.replace(/\\#/g, "")), "no unescaped # may reach the body");
});

test("a prose section never ends on a line break before a section", () => {
  // `\\` immediately before `\section` is "There's no line here to end", and it
  // would only surface once a build happened to order the sections that way.
  const cv = assembleCv(CV_ENTRIES);
  const tex = renderLatex(cv, { footer: CV_FOOTER });
  assert.ok(!/\\\\\s*\n\s*\\section/.test(tex), "a section may not follow a dangling \\\\");
  assert.ok(!/\\\\\s*\n\s*\\end\{document\}/.test(tex), "nor may the document end on one");
});

test("HTML escaping closes the obvious hole", () => {
  assert.equal(escapeHtml('<script>&"'), "&lt;script&gt;&amp;&quot;");
  const cv = assembleCv([
    { name: "x", section: "profile", meta: "<img onerror=alert(1)>", sort: 0, pinned: true },
  ]);
  assert.ok(!renderHtml(cv).includes("<img"), "entry text must not become markup");
});

// MARK: - Structure

test("the document is complete LaTeX and carries the real preamble", () => {
  const tex = renderLatex(assembleCv(CV_ENTRIES), { footer: CV_FOOTER });
  assert.ok(tex.startsWith("\\documentclass[10pt,a4paper]{article}"));
  assert.ok(tex.includes("\\usepackage{fontawesome5}"));
  assert.ok(tex.includes("\\newcommand{\\cventry}[4]"), "the real macros, not new ones");
  assert.ok(tex.includes("\\newcommand{\\projectentry}[2]"));
  assert.ok(tex.trimEnd().endsWith("\\end{document}"));
  assert.equal(tex.split("\\begin{document}").length, 2, "exactly one document body");
});

test("the HTML page is self-contained", () => {
  const html = renderHtml(assembleCv(CV_ENTRIES), { title: "CV" });
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!html.includes("<script"), "no scripts");
  assert.ok(!/https?:\/\/(?!www\.linkedin|github|prk315)/.test(html), "no external asset hosts");
  assert.ok(html.includes("prefers-color-scheme"), "readable in both themes");
});

test("contact links render as links in both formats", () => {
  const cv = assembleCv(CV_ENTRIES);
  const tex = renderLatex(cv);
  const html = renderHtml(cv);
  assert.ok(tex.includes("\\href{https://github.com/Prk315}{github.com/Prk315}"));
  assert.ok(html.includes('<a href="https://github.com/Prk315">github.com/Prk315</a>'));
});

// MARK: - Robustness

test("assembly never throws on junk", () => {
  for (const junk of [null, undefined, [], "nope", [null], [{}], [{ section: "" }]]) {
    const cv = assembleCv(junk);
    assert.ok(Array.isArray(cv.sections));
    assert.equal(typeof renderLatex(cv), "string");
    assert.equal(typeof renderHtml(cv), "string");
  }
});

test("a disabled entry is not in the document", () => {
  const entries = CV_ENTRIES.map((e) =>
    e.name === "work_mirte_robot" ? { ...e, enabled: false } : e,
  );
  const cv = assembleCv(entries);
  assert.ok(!cv.included.includes("work_mirte_robot"));
  assert.ok(!renderLatex(cv).includes("MIRTE Robot"));
});

test("tag overlap counts whole tokens, never substrings", () => {
  const entry = { tags: ["ai", "computer vision"] };
  // The phase-1 bug: `ai` matched inside "available" and passed a chef as an AI
  // engineer. Whole-token comparison is what stops it.
  assert.equal(cvTagOverlap(entry, cvTokens(["available positions"])), 0);
  assert.equal(cvTagOverlap(entry, cvTokens(["AI"])), 1);
  // A multi-word tag is all-or-nothing: half of "computer vision" is not a hit.
  assert.equal(cvTagOverlap(entry, cvTokens(["computer"])), 0);
  assert.equal(cvTagOverlap(entry, cvTokens(["computer vision"])), 1);
  assert.equal(cvTagOverlap(entry, cvTokens(["AI", "computer vision"])), 2);
});

test("c++ and c# survive tokenisation", () => {
  const tokens = cvTokens(["C++", "C#", "F#"]);
  assert.ok(tokens.has("c++"));
  assert.ok(tokens.has("c#"));
  assert.equal(cvTagOverlap({ tags: ["f#"] }, tokens), 1);
});
