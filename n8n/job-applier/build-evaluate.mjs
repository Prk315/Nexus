/**
 * Generate `workflows/job-evaluate.json` from the template + `evaluate.js`.
 *
 *   node build-evaluate.mjs
 *
 * The evaluation half of what `build-workflow.mjs` does for harvesting, and it
 * exists for exactly the same reason: n8n Code nodes have no module system — no
 * `require`, no `import`, no way to share a function between two nodes — so any
 * shared code has to be pasted into each node body.
 *
 * Pasting it by hand would put untested forks of the prompt, the parser and the
 * planner in the tree. CLAUDE.md records that cost twice over (the stale Garmin
 * bridge, which made strength sync silently impossible; the BIA constants held
 * together by a comment). `evaluate.js` has tests; a hand-copy inside a JSON
 * string has none, and diverges the first time someone tightens a bound.
 *
 * So the copy is generated. Edit `evaluate.js`, run this, commit both.
 *
 *   node --test evaluate.test.js && node build-evaluate.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Strip ES module syntax so the source can live inside a Code node body.
 *
 * Only `export ` prefixes and the trailing `export const __internal` line need to
 * go — `evaluate.js` has no imports by design, precisely so this transform can
 * stay this small and this obviously correct. Identical to `build-workflow.mjs`;
 * two copies of a nine-line regex pair is cheaper than a shared module in a
 * folder that is deliberately outside the npm workspace.
 */
function toInlineSource(src) {
  const stripped = src
    .replace(/^export\s+(?=(?:function|const|class|let|var)\b)/gm, "")
    .replace(/^export\s+const\s+__internal\b[\s\S]*?;\s*$/gm, "");

  if (/^\s*(?:import|export)\b/m.test(stripped)) {
    throw new Error(
      "evaluate.js still contains module syntax after stripping — the Code node would " +
        "throw at runtime. Check for a new import or a re-export.",
    );
  }
  return stripped.trimEnd();
}

const evaluate = toInlineSource(readFileSync(join(here, "evaluate.js"), "utf8"));
const template = readFileSync(join(here, "workflows", "job-evaluate.template.json"), "utf8");

if (!template.includes("__EVALUATE_JS__")) {
  throw new Error("template has no __EVALUATE_JS__ placeholder — nothing would be injected");
}

// JSON.stringify the source, then drop the surrounding quotes: this escapes the
// newlines, quotes and backslashes the regexes are full of. Doing it by hand with
// .replace() is how a lone backslash silently corrupts a character class — and
// `evaluate.js`'s control-character class is written in \u escapes precisely
// because a mangled one would be invisible.
const encoded = JSON.stringify(evaluate).slice(1, -1);

const out = template.replaceAll("__EVALUATE_JS__", encoded);

// Parse before writing. A malformed workflow file fails inside n8n's importer
// with a message that says nothing useful about which node broke.
let parsed;
try {
  parsed = JSON.parse(out);
} catch (e) {
  throw new Error(`generated workflow is not valid JSON: ${e.message}`);
}

// n8n 2.x rejects a workflow with no top-level id, and rejects `tags` given as
// plain strings — it wants tag objects. Both produce unhelpful import errors, so
// they are checked here. (CLAUDE.md, "Mail triage / Traps".)
if (!parsed.id) throw new Error("workflow needs a top-level `id` or n8n 2.x refuses the import");
if (Array.isArray(parsed.tags) && parsed.tags.some((t) => typeof t === "string")) {
  throw new Error("n8n 2.x wants tag objects, not plain strings");
}

// Compile every Code node body. The injection above can produce syntactically
// valid JSON containing syntactically invalid JavaScript, and n8n reports that as
// a runtime error inside a node three steps into a scheduled run — i.e. at 03:00
// on a Tuesday, to nobody. `new Function` catches it here for the price of a
// parse. It does not execute the body.
const codeNodes = parsed.nodes.filter((n) => n.type === "n8n-nodes-base.code");
for (const node of codeNodes) {
  try {
    new Function(node.parameters.jsCode);
  } catch (e) {
    throw new Error(`Code node "${node.name}" does not compile: ${e.message}`);
  }
}

// The inlined nodes must actually contain the inlined functions. A placeholder
// that quietly stopped matching would generate a perfectly valid workflow whose
// prompt builder is undefined.
const inlined = parsed.nodes.filter((n) => JSON.stringify(n).includes("parseEvalResponse"));
if (inlined.length === 0) {
  throw new Error("no node ended up with evaluate.js inlined — check the placeholder");
}

const dest = join(here, "workflows", "job-evaluate.json");
writeFileSync(dest, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(
  `wrote ${dest}\n  ${parsed.nodes.length} nodes, ${codeNodes.length} Code node(s) compiled, ` +
    `evaluator inlined into ${inlined.length}`,
);
