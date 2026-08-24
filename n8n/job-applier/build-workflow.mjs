/**
 * Generate `workflows/job-harvest.json` from the template + `extract.js`.
 *
 *   node build-workflow.mjs
 *
 * # Why a build step for a JSON file
 *
 * n8n Code nodes have no module system: no `require`, no `import`, and no way to
 * share a function between two nodes. Any extractor used by the workflow has to
 * be pasted into the node body.
 *
 * Pasting it by hand would put a second, untested copy of the parsing rules in
 * the tree — and CLAUDE.md already records what that costs twice over (the stale
 * Garmin bridge fork that made strength sync silently impossible, and the BIA
 * constants duplicated into `bodyscan-sync` with only a comment holding them
 * together). `extract.js` has 21 tests against real captured pages; a hand-copy
 * inside a JSON string has none, and diverges the first time anyone fixes a
 * regex in one place.
 *
 * So the copy is generated. Edit `extract.js`, run this, commit both.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Strip ES module syntax so the source can live inside a Code node body.
 *
 * Only `export ` prefixes and the trailing `export const __internal` line need to
 * go — the file has no imports by design, precisely so this transform can stay
 * this small and this obviously correct.
 */
function toInlineSource(src) {
  const stripped = src
    .replace(/^export\s+(?=(?:function|const|class|let|var)\b)/gm, "")
    .replace(/^export\s+const\s+__internal\b[\s\S]*?;\s*$/gm, "");

  if (/^\s*(?:import|export)\b/m.test(stripped)) {
    throw new Error(
      "extract.js still contains module syntax after stripping — the Code node would " +
        "throw at runtime. Check for a new import or a re-export.",
    );
  }
  return stripped.trimEnd();
}

const extract = toInlineSource(readFileSync(join(here, "extract.js"), "utf8"));
const template = readFileSync(join(here, "workflows", "job-harvest.template.json"), "utf8");

if (!template.includes("__EXTRACT_JS__")) {
  throw new Error("template has no __EXTRACT_JS__ placeholder — nothing would be injected");
}

// JSON.stringify the source, then drop the surrounding quotes: this escapes the
// newlines, quotes and backslashes that the regexes are full of. Doing it by hand
// with .replace() is how a lone backslash silently corrupts a character class.
const encoded = JSON.stringify(extract).slice(1, -1);

const out = template.replaceAll("__EXTRACT_JS__", encoded);

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
// they are checked here instead. (CLAUDE.md, "Mail triage / Traps".)
if (!parsed.id) throw new Error("workflow needs a top-level `id` or n8n 2.x refuses the import");
if (Array.isArray(parsed.tags) && parsed.tags.some((t) => typeof t === "string")) {
  throw new Error("n8n 2.x wants tag objects, not plain strings");
}

const dest = join(here, "workflows", "job-harvest.json");
writeFileSync(dest, `${JSON.stringify(parsed, null, 2)}\n`);
console.log(
  `wrote ${dest}\n  ${parsed.nodes.length} nodes, extractor inlined into ` +
    `${parsed.nodes.filter((n) => JSON.stringify(n).includes("dedupeKey")).length} Code node(s)`,
);
