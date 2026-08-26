/**
 * Copy `workflows/job-harvest.json` to the n8n deploy directory, re-applying the
 * two patches the deployed copy needs and the repo copy must never carry.
 *
 *   node patch-deploy.mjs            # write ~/docker/n8n/workflows/job-harvest.json
 *   node patch-deploy.mjs --check    # verify the deploy copy is current, write nothing
 *
 * # Why the two copies differ at all
 *
 * The repo copy is the source of truth and is public. The deploy copy needs two
 * things that cannot live in a public repo or in a portable template:
 *
 *   1. **A Gmail credential id.** n8n references credentials by an id that is local
 *      to this n8n instance's database. The repo carries the placeholder
 *      `GMAIL_CREDENTIAL_ID`; importing that verbatim gives the Gmail node no
 *      credential and the alert lane fails at the first fetch.
 *
 *   2. **A `CLI Trigger` node.** `n8n execute --id` refuses a workflow whose only
 *      entry point is a schedule trigger. An `executeWorkflowTrigger` wired to
 *      "Load Config" gives the CLI something to start from. It is a test affordance,
 *      not part of the workflow's real behaviour, so it stays out of the repo.
 *
 * Both were being re-applied by hand after every regeneration, which is precisely
 * the setup for applying one and forgetting the other. Forgetting (1) fails loudly.
 * Forgetting (2) fails loudly too. But re-applying them by hand also invites
 * *editing the deploy copy directly* — and an edit there is invisible to the tests
 * and is overwritten by the next regeneration without a word. Scripting it keeps
 * `build-workflow.mjs -> patch-deploy.mjs -> import` the only path in.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "workflows", "job-harvest.json");
const DEST = join(homedir(), "docker", "n8n", "workflows", "job-harvest.json");

/** Local to this n8n instance. Not a secret — it is an opaque row id, not a token. */
const GMAIL_CREDENTIAL = { id: "7hzqrhh9QEyx6Lqp", name: "Gmail account" };

const CLI_TRIGGER = {
  parameters: {},
  type: "n8n-nodes-base.executeWorkflowTrigger",
  typeVersion: 1.1,
  position: [-620, 500],
  id: "exec-trigger-cli",
  name: "CLI Trigger",
};

function patch(workflow) {
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
  if (credentialed === 0) {
    throw new Error(
      "no node with a gmailOAuth2 credential — the alert lane would run without auth. " +
        "Did the template lose its Gmail node?",
    );
  }

  // 2. CLI trigger, wired to the same first step the schedule trigger feeds.
  if (!wf.nodes.some((n) => n.id === CLI_TRIGGER.id)) {
    wf.nodes.push({ ...CLI_TRIGGER });
  }
  const scheduleTarget = wf.connections["Every 4 Hours"];
  if (!scheduleTarget) {
    throw new Error("no 'Every 4 Hours' connection to mirror — the CLI trigger would start nothing");
  }
  wf.connections[CLI_TRIGGER.name] = JSON.parse(JSON.stringify(scheduleTarget));

  return wf;
}

if (!existsSync(SRC)) {
  throw new Error(`${SRC} does not exist — run build-workflow.mjs first`);
}
const patched = patch(JSON.parse(readFileSync(SRC, "utf8")));
const rendered = `${JSON.stringify(patched, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const current = existsSync(DEST) ? readFileSync(DEST, "utf8") : "";
  if (current === rendered) {
    console.log(`deploy copy is current: ${DEST}`);
  } else {
    console.error(`STALE: ${DEST} differs from the patched build. Run: node patch-deploy.mjs`);
    process.exit(1);
  }
} else {
  writeFileSync(DEST, rendered);
  console.log(
    `wrote ${DEST}\n  ${patched.nodes.length} nodes (${patched.nodes.length - 1} from the repo + CLI Trigger)\n` +
      `  gmail credential -> ${GMAIL_CREDENTIAL.id}\n` +
      `  next: docker exec n8n n8n import:workflow --input=/home/node/workflows/job-harvest.json`,
  );
}
