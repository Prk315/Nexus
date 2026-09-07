/**
 * Generate `workflows/housing-{harvest,notify}.json` from their templates plus
 * `extract.js` and `notify-housing.js`.
 *
 *   node --test extract.test.js && node build-housing.mjs
 *
 * # Why a build step for a JSON file
 *
 * n8n Code nodes have no module system: no `require`, no `import`, and no way to
 * share a function between two nodes. Any code a workflow uses has to be pasted
 * into every node body that needs it — six copies in `housing-harvest` alone.
 *
 * Pasting them by hand would put six untested forks of the parsing rules in the
 * tree, and CLAUDE.md already records what that costs twice over: the stale
 * Garmin bridge fork that made strength sync silently impossible, and the BIA
 * constants duplicated into `bodyscan-sync` with only a comment holding them
 * together. `extract.js` has 70 tests against real captured pages; a hand-copy
 * inside a JSON string has none, and diverges the first time anyone fixes a regex
 * in one place.
 *
 * So the copies are generated. Edit the source, run this, commit both.
 *
 * This is `build-workflow.mjs` and `build-apply.mjs` with a table instead of a
 * hard-coded pair — the same shape those two would have converged on if there had
 * been three of them at the time.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { SOURCE_KIND } from "./extract.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * A Switch node's `rightValue` is a **literal string in JSON**, so it cannot use
 * the `SOURCE_KIND` constant the Code nodes share — and that is precisely the gap
 * the constant was created to close.
 *
 * It got straight through it. `SOURCE_KIND.lejebolig` was corrected from
 * `lejebolig_search` to `lejebolig_jsonld` to match the edge function's
 * allow-list, `extract.js` and every Code node followed, and the Route Source
 * switch kept the old literal. The first live run therefore sent **zero items**
 * down the lejebolig branch: no error, no warning, one of two race lanes simply
 * absent from the funnel. Third outing of "two vocabularies for one lane" in this
 * repo, after the job pipeline's `gmail_alert`/`gmail_alerts`.
 *
 * A literal that cannot import the constant can still be checked against it.
 */
function assertSourceKindsAreReal(parsed, output) {
  const known = new Set(Object.values(SOURCE_KIND));
  for (const node of parsed.nodes) {
    if (node.type !== "n8n-nodes-base.switch") continue;
    for (const rule of node.parameters?.rules?.values ?? []) {
      for (const cond of rule.conditions?.conditions ?? []) {
        const v = cond.rightValue;
        if (typeof v !== "string" || !v || v.startsWith("=")) continue;
        if (!known.has(v)) {
          throw new Error(
            `${output}: Switch "${node.name}" routes on "${v}", which is not a value of ` +
              `SOURCE_KIND (${[...known].join(", ")}). A branch keyed to a stale spelling ` +
              "receives zero items and reports nothing.",
          );
        }
      }
    }
  }
}

/**
 * One entry per generated workflow.
 *
 * `mustInline` names a function that has to survive the injection: a placeholder
 * that quietly stopped matching would generate a perfectly valid workflow whose
 * `cheapGateHousing` is `undefined`, and `undefined(x)` throwing at 07:00 inside a
 * scheduled run is the *good* outcome — the bad one is a Code node that catches.
 */
const TARGETS = [
  {
    template: "housing-harvest.template.json",
    output: "housing-harvest.json",
    source: "extract.js",
    placeholder: "__EXTRACT_JS__",
    mustInline: "cheapGateHousing",
    gmail: false,
  },
  {
    template: "housing-notify.template.json",
    output: "housing-notify.json",
    source: "notify-housing.js",
    placeholder: "__NOTIFY_JS__",
    mustInline: "buildListingEmail",
    gmail: true,
  },
  {
    template: "housing-renewal.template.json",
    output: "housing-renewal.json",
    source: "notify-housing.js",
    placeholder: "__NOTIFY_JS__",
    // Deliberately the *unknown-interval* builder rather than `buildRenewalEmail`.
    // It is the one a careless edit is most likely to drop — the loud path gets
    // tested by hand, the quiet one does not — and losing it would send every
    // rule-unknown row through the urgent template.
    mustInline: "buildUnknownIntervalEmail",
    gmail: true,
  },
  {
    template: "housing-egmont.template.json",
    output: "housing-egmont.json",
    source: "extract.js",
    placeholder: "__EXTRACT_JS__",
    // Only the status-check Code node inlines a shared source; the compose
    // node builds its own tiny escapeHtml rather than pulling in the whole of
    // notify-housing.js for one helper — this template has no __NOTIFY_JS__
    // placeholder at all, on purpose.
    mustInline: "egmontRoundStatus",
    gmail: true,
  },
];

/**
 * Strip ES module syntax so the source can live inside a Code node body.
 *
 * Only `export ` prefixes and the trailing `export const __internal` line need to
 * go — both files have no imports by design, precisely so this transform can stay
 * this small and this obviously correct.
 */
function toInlineSource(src, name) {
  const stripped = src
    .replace(/^export\s+(?=(?:function|const|class|let|var)\b)/gm, "")
    .replace(/^export\s+const\s+__internal\b[\s\S]*?;\s*$/gm, "");

  if (/^\s*(?:import|export)\b/m.test(stripped)) {
    throw new Error(
      `${name} still contains module syntax after stripping — the Code node would throw at ` +
        "runtime. Check for a new import or a re-export.",
    );
  }
  return stripped.trimEnd();
}

let total = 0;
for (const target of TARGETS) {
  const source = toInlineSource(readFileSync(join(here, target.source), "utf8"), target.source);

  // JSON.stringify the source, then drop the surrounding quotes: this escapes the
  // newlines, quotes and backslashes the regexes are full of. Doing it by hand
  // with .replace() is how a lone backslash silently corrupts a character class —
  // and both files write their control-character and combining-mark classes in
  // \u escapes precisely because a mangled one would be invisible.
  const encoded = JSON.stringify(source).slice(1, -1);

  const template = readFileSync(join(here, "workflows", target.template), "utf8");
  if (!template.includes(target.placeholder)) {
    throw new Error(
      `${target.template} has no ${target.placeholder} placeholder — nothing would be injected`,
    );
  }
  const out = template.replaceAll(target.placeholder, encoded);

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

  assertSourceKindsAreReal(parsed, target.output);

  // Exactly one schedule trigger, because `patch-deploy.mjs` mirrors that
  // trigger's wiring onto the CLI Trigger and two would make "which one" a coin
  // toss. It is also why `housing-harvest`'s daily Lane A rides a clock guard
  // rather than a second trigger — fail here rather than there.
  const schedules = parsed.nodes.filter((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  if (schedules.length !== 1) {
    throw new Error(
      `${target.output}: expected exactly one schedule trigger, found ${schedules.length} — ` +
        "patch-deploy.mjs would refuse it",
    );
  }

  // Every node a connection names must exist, and vice versa. n8n imports a
  // workflow with a dangling connection without complaint and simply never runs
  // the branch — which here would mean a whole source silently never polled.
  const names = new Set(parsed.nodes.map((n) => n.name));
  for (const [from, connection] of Object.entries(parsed.connections || {})) {
    if (!names.has(from)) throw new Error(`${target.output}: connection from unknown node "${from}"`);
    for (const output of connection.main || []) {
      for (const link of output || []) {
        if (!names.has(link.node)) {
          throw new Error(`${target.output}: connection from "${from}" to unknown node "${link.node}"`);
        }
      }
    }
  }

  // Compile every Code node body. The injection above can produce syntactically
  // valid JSON containing syntactically invalid JavaScript, and n8n reports that
  // as a runtime error inside a node several steps into a scheduled run — i.e. at
  // 07:00 on a Tuesday, to nobody. This catches it here for the price of a parse.
  // It does not execute the body.
  //
  // ⚠️ **`AsyncFunction`, not `Function`.** n8n wraps a Code node body in an async
  // function, so **top-level `await` is legal there** — and a plain
  // `new Function(body)` rejects it with "missing ) after argument list", a
  // message that points at a paren and has nothing to do with parens. The
  // boligzonen node has to await `getBinaryDataBuffer`, and this check refused a
  // perfectly valid node for twenty minutes on the strength of that error.
  //
  // The other two builders (`build-workflow.mjs`, `build-apply.mjs`) still use the
  // sync constructor. That is fine only because none of their nodes await
  // anything yet; the first one that does will hit this same wall.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const codeNodes = parsed.nodes.filter((n) => n.type === "n8n-nodes-base.code");
  for (const node of codeNodes) {
    try {
      new AsyncFunction(node.parameters.jsCode);
    } catch (e) {
      throw new Error(`${target.output}: Code node "${node.name}" does not compile: ${e.message}`);
    }
  }

  const inlined = parsed.nodes.filter((n) => JSON.stringify(n).includes(target.mustInline));
  if (inlined.length === 0) {
    throw new Error(
      `${target.output}: no node ended up with ${target.source} inlined (looked for ` +
        `${target.mustInline}) — check the placeholder`,
    );
  }

  // A Gmail node with no credential block cannot be patched by patch-deploy.mjs,
  // which matches on the credential TYPE. It would import, run, and fail at the
  // send — or look like it had been configured.
  const gmailNodes = parsed.nodes.filter((n) => n.type === "n8n-nodes-base.gmail");
  for (const node of gmailNodes) {
    if (!(node.credentials && node.credentials.gmailOAuth2)) {
      throw new Error(
        `${target.output}: Gmail node "${node.name}" has no gmailOAuth2 credential placeholder — ` +
          "patch-deploy.mjs would not find it",
      );
    }
  }
  if (target.gmail && gmailNodes.length === 0) {
    throw new Error(`${target.output}: expected a Gmail node and found none`);
  }
  if (!target.gmail && gmailNodes.length > 0) {
    throw new Error(
      `${target.output}: gained a Gmail node the build table says it should not have — a workflow ` +
        "that grew a way to send mail without anyone noticing",
    );
  }

  const dest = join(here, "workflows", target.output);
  writeFileSync(dest, `${JSON.stringify(parsed, null, 2)}\n`);
  total++;
  console.log(
    `wrote ${dest}\n  ${parsed.nodes.length} nodes, ${codeNodes.length} Code node(s) compiled, ` +
      `${target.source} inlined into ${inlined.length}`,
  );
}

console.log(`${total} workflow(s) built`);
