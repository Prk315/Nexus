/**
 * Copy every generated job-applier workflow to the n8n deploy directory,
 * re-applying the two patches the deployed copies need and the repo copies must
 * never carry.
 *
 *   node patch-deploy.mjs            # write ~/docker/n8n/workflows/*.json
 *   node patch-deploy.mjs --check    # verify the deploy copies are current, write nothing
 *   node patch-deploy.mjs job-apply  # just one, by name
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
 * Four workflows now share this patcher. Nothing below is keyed to a particular
 * one: the CLI trigger is wired by *finding* the schedule trigger rather than by
 * naming it, so adding a fifth workflow means adding a row to `WORKFLOWS` and
 * nothing else. A hard-coded node name ("Every 4 Hours") was the first thing that
 * would have had to be copy-pasted-and-edited per workflow, and a stale one there
 * fails by wiring the CLI trigger to nothing at all.
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
 * talks only to Ollama and Supabase, so it declares `false`.
 *
 * `sends: true` marks the workflow whose CLI trigger mails real companies. It
 * changes nothing mechanically; it is there so the console output says so.
 */
const WORKFLOWS = [
  { name: "job-harvest", builder: "build-workflow.mjs", gmail: true },
  { name: "job-evaluate", builder: "build-evaluate.mjs", gmail: false },
  { name: "job-notify", builder: "build-apply.mjs", gmail: true },
  { name: "job-apply", builder: "build-apply.mjs", gmail: true, sends: true },
];

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
  const src = join(here, "workflows", `${spec.name}.json`);
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
