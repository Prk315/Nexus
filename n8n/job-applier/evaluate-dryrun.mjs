/**
 * Dry-run the evaluation pipeline end to end, without n8n.
 *
 *   node evaluate-dryrun.mjs                     # read-only, qwen2.5:latest
 *   node evaluate-dryrun.mjs --model qwen2.5:3b  # compare the small model
 *   node evaluate-dryrun.mjs --write             # actually POST evaluate_result
 *
 * Calls the real `job-ingest` for the real queue, runs the real prompt against
 * the real local Ollama, and prints the verdict, the module plan and the draft
 * body that would be stored. **Writes nothing** unless `--write` is passed.
 *
 * # Why this exists at all
 *
 * The same reason `harvest-dryrun.mjs` does, and phase 1 proved the point twice:
 * fixtures test the parser, the dry run tests the pipeline. The two bugs found on
 * 2026-08-24 — substring keyword matching passing a chef as an AI engineer, and
 * an application FORM overwriting a description — were invisible to 29 green
 * tests and obvious within one live run.
 *
 * The equivalent questions here cannot be answered by a fixture either: does a Q4
 * 7B actually return parseable JSON under `format: "json"`? How long does one
 * posting take on a machine that is also compiling Rust? Does the 3b hold up?
 *
 * # Modes
 *
 * `pending` is empty until a harvest has run, and returns an error until the
 * migration is applied. Neither should stop the Qwen round-trip being exercised,
 * so there is a built-in sample ad and a built-in sample module catalog. The mode
 * actually used is printed at the top and again in the summary — a run that
 * silently fell back to the sample would tell you nothing about your real data.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  assembleApplication,
  buildEvalPrompt,
  parseEvalResponse,
  planFromVerdict,
} from "./evaluate.js";

// MARK: - CLI

const argFlag = (name) => process.argv.includes(`--${name}`);
const argVal = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const MODEL = argVal("model", "qwen2.5:latest");
const OLLAMA = argVal("ollama", "http://localhost:11434");
const WRITE = argFlag("write");
const LIMIT = Number(argVal("limit", 4));

// MARK: - Secrets
//
// `~/docker/n8n/.env` is outside the repo, which is public. Nothing read here is
// ever printed. (In a shell, read it with `/bin/cat` — plain `cat` is aliased to
// `bat` on this machine and is not installed, which yields an empty variable and
// a very confusing 401.)

function loadEnv() {
  const path = join(homedir(), "docker", "n8n", ".env");
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    throw new Error(`cannot read ${path} — the dry run needs JOB_INGEST_KEY from it`);
  }
  const env = {};
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  for (const key of ["NEXUS_SUPABASE_URL", "NEXUS_USER_ID", "JOB_INGEST_KEY"]) {
    if (!env[key]) throw new Error(`${path} is missing ${key}`);
  }
  return env;
}

const env = loadEnv();

async function jobIngest(payload) {
  const res = await fetch(`${env.NEXUS_SUPABASE_URL}/functions/v1/job-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Job-Key": env.JOB_INGEST_KEY },
    body: JSON.stringify(payload),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* a 500 from the platform is not always JSON */
  }
  return { status: res.status, json };
}

// MARK: - Fallback fixtures
//
// A real Danish AI-engineer ad, in the shape and register Jobindex actually
// serves: Danish prose, English tool names, a "Om dig" requirements list. It is
// here so a machine with an empty queue still exercises the same prompt against
// the same model — and so the Danish/English `lang` call gets tested at all,
// which an English-only fixture would never do.

const SAMPLE_POSTING = {
  id: "sample",
  title: "AI Engineer til vores Data & AI-team",
  company: "Nordisk Teknologi A/S",
  location: "København Ø",
  lang: "da",
  url: "https://example.invalid/sample",
  description: [
    "Nordisk Teknologi søger en AI Engineer, der vil være med til at bygge og drifte",
    "machine learning-løsninger, som bruges af over 200.000 danskere hver dag.",
    "",
    "Om stillingen",
    "Du bliver en del af vores Data & AI-team på ni personer og kommer til at arbejde",
    "tæt sammen med produktudviklere og forretningen. Vi arbejder primært i Python og",
    "kører vores modeller på Kubernetes i Azure. Du får ansvar for hele vejen fra",
    "eksperiment til produktion: dataudtræk, træning, evaluering, deployment og",
    "monitorering.",
    "",
    "Vi arbejder blandt andet med:",
    "- Retrieval-augmented generation ovenpå vores egen dokumentsamling (LLM'er, embeddings, vektordatabaser)",
    "- Klassiske ML-modeller til prognoser og anbefalinger (scikit-learn, XGBoost)",
    "- MLOps: CI/CD for modeller, feature store, model registry",
    "",
    "Om dig",
    "- Du har en kandidatgrad i datalogi, matematik, statistik eller lignende",
    "- 2+ års erfaring med Python i produktion, gerne med PyTorch eller TensorFlow",
    "- Erfaring med at arbejde med LLM'er og prompt engineering",
    "- Kendskab til Docker og gerne Kubernetes",
    "- Du taler og skriver dansk og engelsk",
    "",
    "Det er et plus, hvis du har erfaring med Azure ML, dbt eller Snowflake.",
    "",
    "Vi tilbyder",
    "Fleksible arbejdstider, 2 hjemmearbejdsdage om ugen, pensionsordning og et",
    "fagligt stærkt miljø med tid til læring.",
    "",
    "Ansøgningsfrist: løbende. Send din ansøgning og dit CV via knappen herunder.",
  ].join("\n"),
};

const SAMPLE_PROFILE = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "AI Engineering",
  keywords: ["machine learning", "llm", "pytorch", "python", "rag", "ml engineer"],
  notes:
    "Builds applied ML and LLM tooling. Comfortable in Python and TypeScript. " +
    "Prefers product work over research. Based in Copenhagen, Danish and English.",
};

/**
 * A sample catalog, shaped like the real seeded one in the ways that matter:
 *
 * - **Deliberately INCOMPLETE.** No Kubernetes/MLOps module, so a competent
 *   verdict on the sample ad has to produce a gap. A catalog that covered
 *   everything would make the gap machinery untestable, which is the one thing
 *   here most worth watching work.
 * - **Two intros and two closings, one per language, all tied on `sort`.** The
 *   framing rule is only interesting when there is something to choose between,
 *   and the ad is Danish — so a run that comes back with the English intro means
 *   the language step is broken, not that the model had an opinion.
 */
const SAMPLE_MODULES = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    name: "Intro — applied AI (da)",
    slot: "intro",
    tags: ["python", "llm", "machine learning"],
    lang: "da",
    sort: 0,
    content:
      "Jeg er softwareudvikler med fokus på anvendt machine learning. Jeg bygger " +
      "systemer, der kommer i produktion og bliver brugt — ikke prototyper.",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a5",
    name: "Intro — applied AI (en)",
    slot: "intro",
    tags: ["python", "llm", "machine learning"],
    lang: "en",
    sort: 0,
    content:
      "I am a software engineer focused on applied machine learning. I build " +
      "systems that reach production and get used — not prototypes.",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    name: "Skills — Python & PyTorch",
    slot: "skill",
    tags: ["python", "pytorch", "scikit-learn", "ml"],
    lang: "da",
    sort: 10,
    content:
      "Til daglig arbejder jeg i Python: PyTorch til modeller, scikit-learn til " +
      "det klassiske, og pandas til alt det ind imellem.",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a3",
    name: "Project — Nexus life OS",
    slot: "project",
    tags: ["typescript", "rust", "tauri", "postgres", "llm"],
    lang: "da",
    sort: 20,
    content:
      "Jeg har bygget Nexus, en samling desktop-apps i Tauri og React med Postgres " +
      "som fælles backend, inklusive en lokal LLM-pipeline der klassificerer og " +
      "prioriterer indhold uden at sende data ud af maskinen.",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a4",
    name: "Closing (da)",
    slot: "closing",
    tags: ["closing", "availability"],
    lang: "da",
    sort: 90,
    content: "Jeg vil meget gerne fortælle mere — jeg er nem at få fat på.",
  },
  {
    id: "00000000-0000-4000-8000-0000000000a6",
    name: "Closing (en)",
    slot: "closing",
    tags: ["closing", "availability"],
    lang: "en",
    sort: 90,
    content: "I would be glad to tell you more — I am easy to reach.",
  },
];

// MARK: - Ollama

async function askQwen(system, user) {
  const started = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      format: "json",
      options: { temperature: 0.1, num_ctx: 8192 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  const elapsed = Date.now() - started;
  if (!res.ok) {
    return { ok: false, elapsed, text: "", error: `ollama ${res.status}: ${await res.text()}` };
  }
  const body = await res.json();
  return { ok: true, elapsed, text: body?.message?.content ?? "", raw: body };
}

// MARK: - Output

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const DIM = (s) => `\x1b[90m${s}\x1b[0m`;
const GREEN = (s) => `\x1b[32m${s}\x1b[0m`;
const YELLOW = (s) => `\x1b[33m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const line = (s = "") => console.log(s);

// MARK: - Assemble the run

line(B("\n── Queue ──────────────────────────────────────────────"));

let mode = "live";
let items = [];
let catalog = [];

const pending = await jobIngest({ action: "pending", user_id: env.NEXUS_USER_ID, limit: LIMIT });

if (pending.status !== 200 || !pending.json?.ok) {
  const detail = pending.json?.detail ?? pending.json?.error ?? `HTTP ${pending.status}`;
  // Three distinguishable failures, and telling them apart is most of the value
  // of running this before the orchestrator has finished deploying:
  //
  //   postings_not_an_array -> the DEPLOYED job-ingest predates `action: pending`
  //                            and fell through to the harvest parser. Redeploy.
  //   PGRST205 / does not exist -> the MIGRATION has not been applied.
  //   anything else            -> a real error worth reading.
  const d = String(detail);
  const notDeployed = /postings_not_an_array|invalid_body/i.test(d);
  const notMigrated = /does not exist|schema cache|PGRST205/i.test(d);
  line(
    notDeployed
      ? YELLOW(
          "the deployed job-ingest does not know `action: \"pending\"` — it fell through to the\n" +
            "  harvest parser. Redeploy it:\n" +
            "    npx supabase functions deploy job-ingest --project-ref efxmzsdisaymtpebaxlp\n" +
            "  Falling back to the built-in sample. Nothing below reflects your real queue.",
        )
      : notMigrated
        ? YELLOW(
            "job_app_modules / job_applications are not in the database yet — the migration\n" +
              "  supabase/migrations/20260825120000_job_evaluation.sql has not been applied.\n" +
              "  Falling back to the built-in sample. Nothing below reflects your real data.",
          )
        : RED(`pending failed: ${detail}`),
  );
  line(DIM(`  raw: ${JSON.stringify(pending.json).slice(0, 300)}`));
  mode = "sample";
} else {
  catalog = pending.json.modules ?? [];
  items = (pending.json.pending ?? []).map((p) => ({
    match_id: p.match_id,
    posting: p.posting,
    profile: p.profile,
    modules: p.modules ?? catalog,
  }));
  line(`pending: ${items.length} unscored match(es), ${catalog.length} enabled module(s)`);
  if (items.length === 0) {
    line(
      DIM(
        "  an empty queue is the normal steady state — either nothing has been\n" +
          "  harvested yet, or everything gated has already been scored.",
      ),
    );
    mode = "sample";
  }
}

if (mode === "sample") {
  // Real profiles still work: `action: "config"` predates this migration.
  const cfg = await jobIngest({ action: "config", user_id: env.NEXUS_USER_ID });
  const profiles = cfg.json?.profiles ?? [];
  const profile = profiles.find((p) => /ai|data/i.test(p.name)) ?? profiles[0] ?? SAMPLE_PROFILE;
  const modules = catalog.length > 0 ? catalog : SAMPLE_MODULES;

  line(
    `\n${YELLOW("SAMPLE MODE")} — one built-in Danish AI-engineer ad, ` +
      `profile ${B(profile.name)} (${profiles.length > 0 ? "real" : "built-in"}), ` +
      `${modules.length} module(s) (${catalog.length > 0 ? "real" : "built-in"})`,
  );
  items = [{ match_id: null, posting: SAMPLE_POSTING, profile, modules }];
} else {
  line(`\n${GREEN("LIVE MODE")} — real pending matches from Supabase`);
}

// MARK: - Run

line(B(`\n── Qwen (${MODEL}) ──────────────────────────────────`));

const timings = [];
let parsedOk = 0;

for (const item of items) {
  const modules = item.modules ?? [];
  const title = item.posting?.title ?? "(untitled)";
  line(`\n${B(String(title).slice(0, 70))}  ${DIM(item.posting?.company ?? "")}`);

  const { system, user } = buildEvalPrompt(item.posting ?? {}, item.profile ?? {}, modules);
  line(
    DIM(
      `  prompt: ${system.length} + ${user.length} chars (~${Math.round(
        (system.length + user.length) / 4,
      )} tokens), ${modules.length} module(s) in catalog`,
    ),
  );

  const res = await askQwen(system, user);
  timings.push(res.elapsed);
  if (!res.ok) {
    line(RED(`  ${res.error}`));
    continue;
  }
  line(DIM(`  ${(res.elapsed / 1000).toFixed(1)}s, ${res.text.length} chars back`));

  const parsed = parseEvalResponse(res.text, { moduleIds: modules.map((m) => m.id) });
  if (!parsed.ok) {
    line(RED(`  UNPARSEABLE (${parsed.error})`));
    line(DIM(`  raw: ${res.text.slice(0, 400)}`));
    continue;
  }
  parsedOk++;
  const v = parsed.verdict;

  line(
    `  ${GREEN("verdict")} score=${v.score === null ? YELLOW("null") : v.score}` +
      `  type=${v.job_type ?? "-"}  lang=${v.lang ?? "-"}`,
  );
  line(`    required: ${v.required_skills.join(", ") || "-"}`);
  line(`    matched : ${GREEN(v.matched_skills.join(", ") || "-")}`);
  line(`    missing : ${YELLOW(v.missing_skills.join(", ") || "-")}`);
  line(`    reason  : ${DIM(v.reasoning ?? "-")}`);
  if (v.dropped_module_ids.length) {
    line(`    ${YELLOW(`dropped ${v.dropped_module_ids.length} hallucinated module id(s)`)}`);
  }

  const plan = planFromVerdict(v, modules);
  line(
    `  ${B("plan")} slots: ` +
      plan.slots
        .map((s) => (s.module_id ? GREEN(s.slot) : YELLOW(`${s.slot}!`)))
        .join(" → ") || "  plan: (none)",
  );

  // Intro and closing are a rule, not a model choice — name which modules the
  // rule picked, because "it chose sensibly" and "it was computed" look the same
  // in the finished draft and only one of them is reliable.
  const byId = new Map(modules.map((m) => [m.id, m]));
  const framed = plan.chosen
    .map((id) => byId.get(id))
    .filter((m) => m && ["intro", "closing"].includes(String(m.slot).toLowerCase()));
  line(
    framed.length
      ? DIM(`    framed by rule: ${framed.map((m) => `${m.slot}=${m.name}`).join(", ")}`)
      : DIM("    framed by rule: (none — no score, or nothing chosen)"),
  );

  const app = assembleApplication(plan, modules, item.posting ?? {});

  // In LIVE mode the catalog came from `action: "pending"`, which deliberately
  // returns no `content` — the prose never leaves Supabase, and the edge function
  // is the canonical assembler. So print the running order by NAME rather than a
  // body that would look alarmingly empty for reasons that are not a bug.
  const haveContent = app.module_ids.some((id) => typeof byId.get(id)?.content === "string");
  line(
    B(
      `  ── draft: ${app.module_ids.length} module(s), ${app.missing_slots.length} gap(s) ` +
        `${haveContent ? `— ${app.body.length} chars` : ""} ──`,
    ),
  );
  line(
    `    order: ` +
      app.module_ids
        .map((id) => `${GREEN(byId.get(id)?.slot ?? "?")}:${byId.get(id)?.name ?? id}`)
        .join(" → "),
  );

  if (!haveContent) {
    line(
      DIM(
        "    (module prose is not returned by `pending` and never leaves Supabase —\n" +
          "     the body below is structure only; job-ingest assembles the real draft)",
      ),
    );
  }
  for (const l of app.body.split("\n")) {
    line(l.startsWith("[GAP:") ? `  ${YELLOW(l)}` : `  ${l}`);
  }

  if (WRITE && item.match_id) {
    const posted = await jobIngest({
      action: "evaluate_result",
      user_id: env.NEXUS_USER_ID,
      match_id: item.match_id,
      model: MODEL,
      verdict: { ...v, module_plan: plan },
    });
    line(
      posted.json?.ok
        ? GREEN(`  written: application ${posted.json.application_id}`)
        : RED(`  write failed: ${JSON.stringify(posted.json).slice(0, 200)}`),
    );
  }
}

// MARK: - Summary

const secs = (ms) => (ms / 1000).toFixed(1);
const avg = timings.length ? timings.reduce((a, b) => a + b, 0) / timings.length : 0;
const range = timings.length
  ? ` (min ${secs(Math.min(...timings))}s, max ${secs(Math.max(...timings))}s)`
  : "";
line(B("\n── Summary ────────────────────────────────────────────"));
line(
  `mode ${mode === "live" ? GREEN("LIVE") : YELLOW("SAMPLE")}   model ${MODEL}   ` +
    `${parsedOk}/${items.length} parsed as JSON   avg ${secs(avg)}s${range}`,
);
line(
  WRITE
    ? YELLOW("--write was set: evaluate_result was POSTed for every LIVE item above")
    : "nothing was written — this is a dry run (pass --write to post evaluate_result)",
);
line();
