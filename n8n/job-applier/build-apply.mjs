/**
 * Generate `workflows/job-notify.json` and `workflows/job-apply.json` from their
 * templates + `notify.js`.
 *
 *   node build-apply.mjs
 *
 * The phase-3 half of what `build-workflow.mjs` does for harvesting and
 * `build-evaluate.mjs` does for scoring, and it exists for the same reason all
 * three do: n8n Code nodes have no module system — no `require`, no `import`, no
 * way to share a function between two nodes — so shared code has to be pasted
 * into every node body that needs it.
 *
 * Pasting it by hand would put untested forks of `validateRecipient` in a
 * workflow that mails strangers. CLAUDE.md records the cost of a hand-copied
 * module twice over (the stale Garmin bridge, which made strength sync silently
 * impossible; the BIA constants held together by a comment). `notify.js` has 55
 * tests; a hand-copy inside a JSON string has none, and diverges the first time
 * someone loosens an address check.
 *
 * So the copy is generated. Edit `notify.js`, run this, commit all four files.
 *
 *   node --test notify.test.js && node build-apply.mjs
 *
 * Both workflows are built by one script on purpose. They share `notify.js` and
 * they share a hazard — one composes the email that authorises a send and the
 * other performs it — so a change that regenerates one and not the other is a
 * change nobody should be able to make by accident.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Placeholder → the file whose source replaces it. */
const PLACEHOLDER = "__NOTIFY_JS__";

/**
 * One entry per generated workflow. `mustInline` names a function that has to
 * survive the injection: a placeholder that quietly stopped matching would
 * generate a perfectly valid workflow whose recipient check is `undefined`, and
 * `undefined(x)` throwing at 03:00 inside a scheduled run is the good outcome.
 */
const TARGETS = [
  {
    template: "job-notify.template.json",
    output: "job-notify.json",
    mustInline: "buildDecisionEmail",
  },
  {
    template: "job-apply.template.json",
    output: "job-apply.json",
    mustInline: "validateRecipient",
  },
];

/**
 * Strip ES module syntax so the source can live inside a Code node body.
 *
 * Only `export ` prefixes need to go — `notify.js` has no imports by design,
 * precisely so this transform can stay this small and this obviously correct.
 * Same nine lines as the other two builders; three copies of a regex pair is
 * cheaper than a shared module in a folder deliberately kept outside the npm
 * workspace.
 */
function toInlineSource(src) {
  const stripped = src
    .replace(/^export\s+(?=(?:function|const|class|let|var)\b)/gm, "")
    .replace(/^export\s+const\s+__internal\b[\s\S]*?;\s*$/gm, "");

  if (/^\s*(?:import|export)\b/m.test(stripped)) {
    throw new Error(
      "notify.js still contains module syntax after stripping — the Code node would " +
        "throw at runtime. Check for a new import or a re-export.",
    );
  }
  return stripped.trimEnd();
}

const notify = toInlineSource(readFileSync(join(here, "notify.js"), "utf8"));

// JSON.stringify the source, then drop the surrounding quotes: this escapes the
// newlines, quotes and backslashes the regexes are full of. Doing it by hand with
// .replace() is how a lone backslash silently corrupts a character class — and
// `notify.js`'s control-character class is written in \u escapes precisely
// because a mangled one would be invisible.
const encoded = JSON.stringify(notify).slice(1, -1);

let total = 0;
for (const target of TARGETS) {
  const template = readFileSync(join(here, "workflows", target.template), "utf8");

  if (!template.includes(PLACEHOLDER)) {
    throw new Error(`${target.template} has no ${PLACEHOLDER} placeholder — nothing would be injected`);
  }

  const out = template.replaceAll(PLACEHOLDER, encoded);

  // Parse before writing. A malformed workflow file fails inside n8n's importer
  // with a message that says nothing useful about which node broke.
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch (e) {
    throw new Error(`${target.output} is not valid JSON: ${e.message}`);
  }

  // n8n 2.x rejects a workflow with no top-level id, and rejects `tags` given as
  // plain strings — it wants tag objects. Both produce unhelpful import errors,
  // so they are checked here. (CLAUDE.md, "Mail triage / Traps".)
  if (!parsed.id) {
    throw new Error(`${target.output} needs a top-level \`id\` or n8n 2.x refuses the import`);
  }
  if (Array.isArray(parsed.tags) && parsed.tags.some((t) => typeof t === "string")) {
    throw new Error(`${target.output}: n8n 2.x wants tag objects, not plain strings`);
  }

  // Every node a connection names must exist, and vice versa. n8n imports a
  // workflow with a dangling connection without complaint and simply never runs
  // the branch — which in job-apply would mean sends that are never reported.
  const names = new Set(parsed.nodes.map((n) => n.name));
  for (const [from, conn] of Object.entries(parsed.connections || {})) {
    if (!names.has(from)) {
      throw new Error(`${target.output}: connection from unknown node "${from}"`);
    }
    for (const output of conn.main || []) {
      for (const link of output || []) {
        if (!names.has(link.node)) {
          throw new Error(`${target.output}: connection from "${from}" to unknown node "${link.node}"`);
        }
      }
    }
  }

  // Compile every Code node body. The injection above can produce syntactically
  // valid JSON containing syntactically invalid JavaScript, and n8n reports that
  // as a runtime error inside a node three steps into a scheduled run — i.e. at
  // 03:00 on a Tuesday, to nobody. `new Function` catches it here for the price
  // of a parse. It does not execute the body.
  const codeNodes = parsed.nodes.filter((n) => n.type === "n8n-nodes-base.code");
  for (const node of codeNodes) {
    try {
      new Function(node.parameters.jsCode);
    } catch (e) {
      throw new Error(`${target.output}: Code node "${node.name}" does not compile: ${e.message}`);
    }
  }

  const inlined = parsed.nodes.filter((n) => JSON.stringify(n).includes(target.mustInline));
  if (inlined.length === 0) {
    throw new Error(
      `${target.output}: no node ended up with notify.js inlined (looked for ${target.mustInline}) — ` +
        "check the placeholder",
    );
  }

  // A Gmail node with no credential block cannot be patched by patch-deploy.mjs,
  // which matches on the credential TYPE. It would import, run, and fail at the
  // send — or worse in job-apply, look like it had been configured.
  for (const node of parsed.nodes) {
    if (node.type === "n8n-nodes-base.gmail" && !(node.credentials && node.credentials.gmailOAuth2)) {
      throw new Error(
        `${target.output}: Gmail node "${node.name}" has no gmailOAuth2 credential placeholder — ` +
          "patch-deploy.mjs would not find it",
      );
    }
  }

  const dest = join(here, "workflows", target.output);
  writeFileSync(dest, `${JSON.stringify(parsed, null, 2)}\n`);
  total++;
  console.log(
    `wrote ${dest}\n  ${parsed.nodes.length} nodes, ${codeNodes.length} Code node(s) compiled, ` +
      `notify.js inlined into ${inlined.length}`,
  );
}

console.log(`${total} workflow(s) built`);
