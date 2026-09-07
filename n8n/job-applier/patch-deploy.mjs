/**
 * Copy every generated n8n workflow to the deploy directory, re-applying the two
 * patches the deployed copies need and the repo copies must never carry.
 *
 *   node patch-deploy.mjs            # write ~/docker/n8n/workflows/*.json
 *   node patch-deploy.mjs --check    # verify the deploy copies are current, write nothing
 *   node patch-deploy.mjs job-apply  # just one, by name
 *
 * It covers **both** pipelines — the four job workflows in this folder and the four
 * housing workflows in `../housing/` — because the two patches are properties of
 * *this n8n instance*, not of a pipeline: the Gmail credential id is a row id in
 * this instance's database and the CLI trigger is an affordance of this machine's
 * `n8n execute`. A second copy of this script for the housing folder would be a
 * second place for the credential id to go stale, and a stale one there fails at
 * the send.
 *
 * # Why the two copies differ at all
 *
 * The repo copies are the source of truth and are public. The deploy copies need
 * two things that cannot live in a public repo or in a portable template:
 *
 *   1. **A Gmail credential id.** n8n references credentials by an id that is local
 *      to this n8n instance's database. The repo carries the placeholder
 *      `GMAIL_CREDENTIAL_ID`; importing that verbatim gives the Gmail node no
 *      credential and the lane fails at the first send.
 *
 *   2. **A `CLI Trigger` node.** `n8n execute --id` refuses a workflow whose only
 *      entry point is a schedule trigger. An `executeWorkflowTrigger` wired to
 *      whatever the schedule trigger feeds gives the CLI something to start from.
 *      It is a test affordance, not part of the workflow's real behaviour, so it
 *      stays out of the repo.
 *
 * Both were being re-applied by hand after every regeneration, which is precisely
 * the setup for applying one and forgetting the other. Forgetting (1) fails loudly.
 * Forgetting (2) fails loudly too. But re-applying them by hand also invites
 * *editing the deploy copy directly* — and an edit there is invisible to the tests
 * and is overwritten by the next regeneration without a word. Scripting it keeps
 * `build-*.mjs -> patch-deploy.mjs -> import` the only path in.
 *
 * # The list is data, not code
 *
 * Eight workflows now share this patcher. Nothing below is keyed to a particular
 * one: the CLI trigger is wired by *finding* the schedule trigger rather than by
 * naming it, so adding a ninth workflow means adding a row to `WORKFLOWS` and
 * nothing else. A hard-coded node name ("Every 4 Hours") was the first thing that
 * would have had to be copy-pasted-and-edited per workflow, and a stale one there
 * fails by wiring the CLI trigger to nothing at all.
 *
 * `dir` is the one field that had to be added when the housing pipeline arrived,
 * and it is deliberately a *relative source* path rather than an absolute one:
 * the deploy directory stays flat (n8n imports by filename), so a workflow's
 * folder decides where it is read from and nothing else. That means the eight
 * names share one namespace — a `housing-harvest.json` and a `job-harvest.json`
 * cannot collide, but two folders offering the same name would, silently, with
 * the last one winning. The duplicate check below refuses that.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const DEPLOY_DIR = join(homedir(), "docker", "n8n", "workflows");

/** Local to this n8n instance. Not a secret — it is an opaque row id, not a token. */
const GMAIL_CREDENTIAL = { id: "7hzqrhh9QEyx6Lqp", name: "Gmail account" };

/**
 * `gmail: true` means the workflow *must* contain a credentialled Gmail node, and
 * a build that lost one is an error rather than a silent skip. `job-evaluate`
 * talks only to Ollama and Supabase, so it declares `false`; `housing-harvest`
 * talks only to three public sources and Supabase, so it does too — the housing
 * pipeline's Gmail lane is BoligPortal's own BoligAgent alerts arriving on the
 * existing mail bus, which nothing here fetches.
 *
 * `sends: true` marks the workflow whose CLI trigger mails real companies. It
 * changes nothing mechanically; it is there so the console output says so. No
 * housing workflow carries it and none ever should: the housing pipeline submits
 * nothing to a third-party portal, by design (`HOUSING_PLAN.md` §5).
 *
 * `dir` is the folder holding `workflows/<name>.json`, relative to this file.
 */
const WORKFLOWS = [
  { name: "job-harvest", dir: ".", builder: "build-workflow.mjs", gmail: true },
  { name: "job-evaluate", dir: ".", builder: "build-evaluate.mjs", gmail: false },
  { name: "job-notify", dir: ".", builder: "build-apply.mjs", gmail: true },
  { name: "job-apply", dir: ".", builder: "build-apply.mjs", gmail: true, sends: true },
  { name: "housing-harvest", dir: "../housing", builder: "build-housing.mjs", gmail: false },
  { name: "housing-notify", dir: "../housing", builder: "build-housing.mjs", gmail: true },
  { name: "housing-renewal", dir: "../housing", builder: "build-housing.mjs", gmail: true },
  { name: "housing-egmont", dir: "../housing", builder: "build-housing.mjs", gmail: true },
];

// The deploy directory is flat, so two folders offering the same workflow name
// would silently overwrite each other and whichever ran last would win.
const seenNames = new Set();
for (const w of WORKFLOWS) {
  if (seenNames.has(w.name)) {
    throw new Error(`two WORKFLOWS rows are called "${w.name}" — they would share one deploy file`);
  }
  seenNames.add(w.name);
}

const CLI_TRIGGER = {
  parameters: {},
  type: "n8n-nodes-base.executeWorkflowTrigger",
  typeVersion: 1.1,
  position: [-620, 500],
  id: "exec-trigger-cli",
  name: "CLI Trigger",
};

function patch(workflow, spec) {
  const wf = JSON.parse(JSON.stringify(workflow));

  // 1. Gmail credential. Match on the credential TYPE rather than the node name so
  //    renaming the node in the template does not silently skip the patch.
  let credentialed = 0;
  for (const node of wf.nodes) {
    if (node.credentials && node.credentials.gmailOAuth2) {
      node.credentials.gmailOAuth2 = { ...GMAIL_CREDENTIAL };
      credentialed++;
    }
  }
  if (spec.gmail && credentialed === 0) {
    throw new Error(
      `${spec.name}: no node with a gmailOAuth2 credential — the send lane would run without ` +
        "auth. Did the template lose its Gmail node?",
    );
  }
  if (!spec.gmail && credentialed > 0) {
    // Not fatal, but worth saying out loud: a workflow that grew a Gmail node
    // without anyone updating this table is a workflow that grew a way to send
    // mail without anyone noticing.
    console.warn(`${spec.name}: gained a Gmail node that WORKFLOWS says it should not have`);
  }

  // 2. CLI trigger, wired to whatever the schedule trigger feeds. Found by type,
  //    not by name — see the header.
  const schedules = wf.nodes.filter((n) => n.type === "n8n-nodes-base.scheduleTrigger");
  if (schedules.length !== 1) {
    throw new Error(
      `${spec.name}: expected exactly one schedule trigger, found ${schedules.length} — ` +
        "the CLI trigger would start nothing, or start the wrong thing",
    );
  }
  const scheduleTarget = wf.connections[schedules[0].name];
  if (!scheduleTarget) {
    throw new Error(
      `${spec.name}: schedule trigger "${schedules[0].name}" has no outgoing connection to mirror`,
    );
  }

  // Replace rather than skip-if-present, and match on name **as well as** id.
  // `job-evaluate` was hand-patched once with a CLI trigger under the id
  // `exec-trigger-cli-eval`, so an id-only check would have added a *second* node
  // called "CLI Trigger" — and n8n keys connections by name, so two nodes sharing
  // one is a workflow whose wiring means whatever the importer decides. Rebuilding
  // it every time also makes this patch idempotent against a hand-edited deploy
  // copy, which is the state this script exists to stop mattering.
  wf.nodes = wf.nodes.filter((n) => n.id !== CLI_TRIGGER.id && n.name !== CLI_TRIGGER.name);
  wf.nodes.push({ ...CLI_TRIGGER });
  wf.connections[CLI_TRIGGER.name] = JSON.parse(JSON.stringify(scheduleTarget));

  return { wf, credentialed };
}

// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));
const selected = only.length ? WORKFLOWS.filter((w) => only.includes(w.name)) : WORKFLOWS;

if (!selected.length) {
  throw new Error(`no workflow matched ${only.join(", ")} — known: ${WORKFLOWS.map((w) => w.name).join(", ")}`);
}

let stale = 0;
for (const spec of selected) {
  const src = join(here, spec.dir ?? ".", "workflows", `${spec.name}.json`);
  const dest = join(DEPLOY_DIR, `${spec.name}.json`);

  if (!existsSync(src)) {
    throw new Error(`${src} does not exist — run ${spec.builder} first`);
  }

  const { wf, credentialed } = patch(JSON.parse(readFileSync(src, "utf8")), spec);
  const rendered = `${JSON.stringify(wf, null, 2)}\n`;

  if (check) {
    const current = existsSync(dest) ? readFileSync(dest, "utf8") : "";
    if (current === rendered) {
      console.log(`current: ${dest}`);
    } else {
      console.error(`STALE:   ${dest} differs from the patched build`);
      stale++;
    }
    continue;
  }

  writeFileSync(dest, rendered);
  console.log(
    `wrote ${dest}\n` +
      `  ${wf.nodes.length} nodes (${wf.nodes.length - 1} from the repo + CLI Trigger)` +
      (credentialed ? `, gmail credential -> ${GMAIL_CREDENTIAL.id} on ${credentialed} node(s)` : "") +
      (spec.sends
        ? "\n  ⚠ this is the workflow that mails real companies — `n8n execute --id nexus-job-apply`\n" +
          "    against a non-empty apply_queue sends for real, immediately, with no confirmation"
        : ""),
  );
}

if (check) {
  if (stale) {
    console.error(`\n${stale} deploy copy/copies out of date. Run: node patch-deploy.mjs`);
    process.exit(1);
  }
  console.log(`\nall ${selected.length} deploy copies are current`);
} else {
  console.log(
    "\nnext:\n" +
      selected
        .map((w) => `  docker exec n8n n8n import:workflow --input=/home/node/workflows/${w.name}.json`)
        .join("\n"),
  );
}
