/**
 * Per-node item counts for a past n8n execution.
 *
 *   node exec-forensics.mjs                 # newest nexus-job-harvest run
 *   node exec-forensics.mjs 343             # a specific execution id
 *   node exec-forensics.mjs 343 --node Gate # dump one node's output items
 *   node exec-forensics.mjs --list          # recent runs
 *
 * # Why this exists
 *
 * A harvest run that drops items does not fail. It finishes green, writes fewer
 * rows than expected, and gives you a 10 MB execution JSON to read. The first live
 * run stored 1 posting instead of ~60, and the ONLY thing that located the two
 * places the items died — 69 -> 3 at the gate, and 3 -> 1 at the ingest — was the
 * item count per node. Reading the workflow and guessing cost far longer.
 *
 * n8n keeps that history in SQLite inside the container, so this copies the DB out
 * (there is no sqlite3 in the container) and decodes it. `execution_data.data` is
 * `flatted`-encoded, not plain JSON: it is an array where every string that parses
 * as an index is a reference into that array. `JSON.parse` alone yields an
 * unreadable soup of numeric strings, which is what makes this file worth keeping
 * rather than re-deriving under pressure.
 *
 * Read the counts as a funnel and look for the first big step down. Note that
 * "Post to job-ingest" legitimately collapses N items to 1 — it batches — so the
 * meaningful counts stop at "Gate", and the ingest's own verdict is in the "Send"
 * node's response body, which reports rejects WITHOUT failing the run.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CONTAINER = "n8n";
const DB_IN_CONTAINER = "/home/node/.n8n/database.sqlite";
const WORKFLOW_ID = "nexus-job-harvest";

/**
 * Decode `flatted`. Every string that is a valid index into the outer array is a
 * pointer to another entry; everything else is a literal. Cycles are real (n8n
 * stores back-references), hence the seen/cache pair rather than a plain recursion.
 */
export function unflatten(arr) {
  const cache = new Array(arr.length);
  const seen = new Array(arr.length).fill(false);
  const deref = (v) => {
    if (typeof v !== "string") return v;
    const i = Number(v);
    return Number.isInteger(i) && i >= 0 && i < arr.length && v.trim() !== "" ? node(i) : v;
  };
  function node(i) {
    if (seen[i]) return cache[i];
    seen[i] = true;
    const v = arr[i];
    if (Array.isArray(v)) {
      const out = [];
      cache[i] = out;
      for (const e of v) out.push(deref(e));
      return out;
    }
    if (v && typeof v === "object") {
      const out = {};
      cache[i] = out;
      for (const k of Object.keys(v)) out[k] = deref(v[k]);
      return out;
    }
    cache[i] = v;
    return v;
  }
  return node(0);
}

const sqlite = (db, sql) =>
  execFileSync("/usr/bin/sqlite3", [db, sql], { encoding: "utf8", maxBuffer: 1 << 30 });

function pullDb() {
  const dir = mkdtempSync(join(tmpdir(), "n8n-forensics-"));
  const dest = join(dir, "database.sqlite");
  execFileSync("docker", ["cp", `${CONTAINER}:${DB_IN_CONTAINER}`, dest], { stdio: "pipe" });
  if (!existsSync(dest)) throw new Error("docker cp produced no file — is the container running?");
  return dest;
}

const args = process.argv.slice(2);
const nodeFlag = args.indexOf("--node");
const wantNode = nodeFlag >= 0 ? args[nodeFlag + 1] : null;
const idArg = args.find((a) => /^\d+$/.test(a));

const db = pullDb();

if (args.includes("--list")) {
  console.log(
    sqlite(
      db,
      `select id, workflowId, status, startedAt from execution_entity order by id desc limit 25;`,
    ),
  );
  process.exit(0);
}

const id =
  idArg ??
  sqlite(
    db,
    `select id from execution_entity where workflowId='${WORKFLOW_ID}' order by id desc limit 1;`,
  ).trim();
if (!id) throw new Error(`no executions found for ${WORKFLOW_ID}`);

const status = sqlite(db, `select status from execution_entity where id=${id};`).trim();
const data = unflatten(JSON.parse(sqlite(db, `select data from execution_data where executionId=${id};`)));
const runData = data?.resultData?.runData ?? {};

if (wantNode) {
  const runs = runData[wantNode];
  if (!runs) {
    console.error(`no node named ${JSON.stringify(wantNode)}. Nodes:\n  ${Object.keys(runData).join("\n  ")}`);
    process.exit(1);
  }
  for (const r of runs) {
    for (const [bi, branch] of (r?.data?.main ?? []).entries()) {
      if (!Array.isArray(branch)) continue;
      console.log(`--- branch ${bi}: ${branch.length} items`);
      branch.forEach((it, i) => console.log(i, JSON.stringify(it.json).slice(0, 3000)));
    }
  }
  process.exit(0);
}

const rows = Object.entries(runData)
  .map(([name, runs]) => {
    let items = 0;
    const errors = [];
    for (const r of runs) {
      for (const branch of r?.data?.main ?? []) if (Array.isArray(branch)) items += branch.length;
      if (r.error) errors.push(r.error.message ?? r.error.description ?? "error");
    }
    return { name, items, runs: runs.length, start: runs[0]?.startTime ?? 0, errors };
  })
  .sort((a, b) => a.start - b.start);

console.log(`execution ${id} — ${status}\n`);
console.log("  items | runs | node");
console.log("  ------+------+" + "-".repeat(40));
for (const r of rows) {
  console.log(
    `  ${String(r.items).padStart(5)} | ${String(r.runs).padStart(4)} | ${r.name}` +
      (r.errors.length ? `\n          ERROR: ${r.errors[0].slice(0, 160)}` : ""),
  );
}
if (data?.resultData?.error) {
  console.log(`\nRUN FAILED at ${data.resultData.lastNodeExecuted}: ${data.resultData.error.message ?? ""}`);
}
