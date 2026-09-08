#!/usr/bin/env node
/**
 * Build a tailored CV.
 *
 *   node cv-build.mjs                                   # the unranked CV
 *   node cv-build.mjs --skills "unreal,gamedev,c++"     # ranked for a game role
 *   node cv-build.mjs --skills "postgres,etl" --budget work=2
 *   node cv-build.mjs --skills "unreal" --pdf           # also run pdflatex
 *   node cv-build.mjs --out build/sybo                  # choose the basename
 *
 * Writes `<out>.tex` and `<out>.html`, and prints what was included and what a
 * budget dropped. Nothing here talks to Supabase: the catalog is
 * `cv-entries.js`, which is the committed source of truth. A `--from-db` mode
 * belongs here eventually, but the offline path is what makes this reviewable
 * and is what the tests exercise.
 *
 * ⚠️ This writes files and, with `--pdf`, shells out to pdflatex. It sends
 * nothing anywhere. Publishing the result is a separate, deliberate act — see
 * the CV section of README.md.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFileSync } from "node:child_process";

import { assembleCv, renderHtml, renderLatex } from "./cv.js";
import { CV_ENTRIES, CV_FOOTER } from "./cv-entries.js";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = (name) => argv.includes(`--${name}`);

const skills = (flag("skills") ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// `--budget work=2 --budget skills=3`, or one comma-separated value.
const budget = {};
for (const raw of argv.filter((_, i) => argv[i - 1] === "--budget")) {
  for (const pair of raw.split(",")) {
    const [k, v] = pair.split("=");
    if (k && Number.isFinite(Number(v))) budget[k.trim()] = Number(v);
  }
}

const out = resolve(flag("out", "build/cv"));
const lang = flag("lang", "en");

// `--public` builds the copy that gets hosted at a URL anyone can fetch, and
// drops every contact detail marked `private` in the catalog. Default is off:
// the common case is a document going to a named person.
const publicCopy = has("public");

const cv = assembleCv(CV_ENTRIES, { skills, lang, budget, publicCopy });
const tex = renderLatex(cv, { footer: CV_FOOTER });
const html = renderHtml(cv, { title: "Bastian Rønfeldt Thomsen — CV" });

mkdirSync(dirname(out), { recursive: true });
writeFileSync(`${out}.tex`, tex);
writeFileSync(`${out}.html`, html);

console.log(`skills   : ${skills.length ? skills.join(", ") : "(none — unranked)"}`);
console.log(`ranked   : ${cv.ranked}`);
console.log(`audience : ${publicCopy ? "PUBLIC — private contact details dropped" : "direct"}`);
for (const s of cv.sections) {
  console.log(`  ${s.section.padEnd(11)} ${s.entries.map((e) => e.name).join(", ")}`);
}
if (cv.omitted.length > 0) {
  console.log("omitted  :");
  for (const o of cv.omitted) console.log(`  ${o.section.padEnd(11)} ${o.name} (${o.reason})`);
} else {
  console.log("omitted  : nothing");
}
console.log(`wrote    : ${out}.tex`);
console.log(`wrote    : ${out}.html`);

if (has("pdf")) {
  // `-halt-on-error` so a broken escape fails here rather than producing a PDF
  // with a missing line nobody notices until a company has it.
  execFileSync(
    "pdflatex",
    ["-halt-on-error", "-interaction=nonstopmode", `-output-directory=${dirname(out)}`, `${out}.tex`],
    { stdio: "pipe" },
  );
  console.log(`wrote    : ${out}.pdf`);
}
