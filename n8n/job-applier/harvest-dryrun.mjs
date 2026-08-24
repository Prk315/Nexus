/**
 * Dry-run the harvest pipeline against the live sources.
 *
 *   node harvest-dryrun.mjs              # both sources, small caps
 *   node harvest-dryrun.mjs --hub 5 --ji 5
 *
 * Fetches nothing but public job pages, writes nothing anywhere, and posts
 * nothing to Supabase. It exists because the n8n workflow itself cannot be
 * unit-tested: this runs the same functions in the same order, so a regression in
 * the extraction chain shows up here rather than as an empty panel three days
 * later.
 *
 * Politeness is deliberate and should stay: small caps, a delay between requests,
 * and a real User-Agent. Being blocked by Jobindex or TheHub is a permanent cost
 * against a temporary saving.
 */

import {
  cheapGate,
  dedupeKey,
  extractJobPostingLd,
  extractJobindexStub,
  extractReadableText,
  normalizeLdJobPosting,
  parseJobindexFeed,
  pickDescription,
} from "./extract.js";

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? Number(process.argv[i + 1]) : dflt;
};

const JI_LIMIT = arg("ji", 4);
const HUB_LIMIT = arg("hub", 4);
const DELAY_MS = arg("delay", 1200);

const FEED = "https://www.jobindex.dk/jobsoegning.rss?q=game+developer";
const SITEMAP = "https://thehub.io/sitemap-jobs.xml";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch as text, honouring the charset the server declares.
 *
 * Jobindex's feed says ISO-8859-1. `Response.text()` assumes UTF-8 regardless, so
 * a raw latin-1 byte would come through as U+FFFD and be stored as permanent
 * mojibake. Decoding by the declared charset is the fix; doing it here rather
 * than inside the extractor keeps the extractor pure.
 */
async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "da,en" } });
  const buf = new Uint8Array(await res.arrayBuffer());
  const declared = /charset=([\w-]+)/i.exec(res.headers.get("content-type") ?? "")?.[1];
  const sniffed = /encoding=["']([\w-]+)["']/i.exec(
    new TextDecoder("latin1").decode(buf.slice(0, 200)),
  )?.[1];
  const charset = (declared ?? sniffed ?? "utf-8").toLowerCase();
  try {
    return { ok: res.ok, status: res.status, text: new TextDecoder(charset).decode(buf) };
  } catch {
    return { ok: res.ok, status: res.status, text: new TextDecoder("utf-8").decode(buf) };
  }
}

// A stand-in for a real `job_profiles` row.
const PROFILES = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Game Dev",
    keywords: ["unity", "unreal", "game", "gameplay", "engine", "developer", "c++", "c#"],
    exclude_terms: ["security clearance"],
    locations: [],
    category_allow: [],
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "AI Engineering",
    keywords: ["machine learning", "ai", "llm", "pytorch", "data scien", "ml engineer"],
    exclude_terms: [],
    locations: [],
    category_allow: [],
  },
];

const line = (s) => console.log(s);

async function harvestJobindex() {
  line(`\n\x1b[1m── Jobindex ────────────────────────────────────────────\x1b[0m`);
  const feed = await fetchText(FEED);
  const items = parseJobindexFeed(feed.text);
  line(`feed: ${feed.status}, ${items.length} items, taking ${Math.min(JI_LIMIT, items.length)}`);

  const rows = [];
  for (const item of items.slice(0, JI_LIMIT)) {
    await sleep(DELAY_MS);
    const stubRes = await fetchText(item.url);
    const stub = extractJobindexStub(stubRes.text);

    let description = stub.lead ?? "";
    let ld = null;
    if (stub.target_url) {
      await sleep(DELAY_MS);
      try {
        const bodyRes = await fetchText(stub.target_url);
        ld = extractJobPostingLd(bodyRes.text);
        description = pickDescription(
          description,
          ld ? normalizeLdJobPosting(ld, { url: item.url, sourceKind: "jobindex_rss" }).description : "",
          extractReadableText(bodyRes.text),
        );
      } catch (e) {
        line(`  ! body fetch failed: ${e.message}`);
      }
    }

    const title = stub.title || item.title;
    rows.push({
      source_kind: "jobindex_rss",
      url: item.url,
      source_url: stub.target_url,
      external_id: item.external_id,
      dedupe_key: dedupeKey(item.company, title),
      title,
      company: item.company,
      location: stub.location,
      remote: stub.remote,
      posted_at: item.posted_at,
      description,
      categories: item.categories,
      ld_json: ld,
    });
    line(
      `  ${(item.external_id ?? "?").padEnd(10)} ${String(title).slice(0, 42).padEnd(44)} ` +
        `${String(item.company ?? "-").slice(0, 20).padEnd(22)} desc=${String(description.length).padStart(6)}` +
        `${ld ? " ld✓" : ""}${stub.target_url ? "" : " \x1b[33m[no target]\x1b[0m"}`,
    );
  }
  return rows;
}

async function harvestHub() {
  line(`\n\x1b[1m── TheHub ──────────────────────────────────────────────\x1b[0m`);
  const sm = await fetchText(SITEMAP);
  const locs = [...sm.text.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.includes("/jobs/"));
  line(`sitemap: ${sm.status}, ${locs.length} job URLs, taking ${Math.min(HUB_LIMIT, locs.length)}`);

  const rows = [];
  let noLd = 0;
  for (const url of locs.slice(0, HUB_LIMIT)) {
    await sleep(DELAY_MS);
    const res = await fetchText(url);
    const ld = extractJobPostingLd(res.text);
    if (!ld) {
      noLd++;
      line(`  \x1b[33mno JSON-LD\x1b[0m ${url.slice(-28)}`);
      continue;
    }
    const row = normalizeLdJobPosting(ld, { url, sourceKind: "thehub_sitemap" });
    rows.push({ ...row, dedupe_key: dedupeKey(row.company, row.title), categories: [] });
    line(
      `  ${String(row.title).slice(0, 42).padEnd(44)} ${String(row.company ?? "-").slice(0, 20).padEnd(22)} ` +
        `desc=${String(row.description.length).padStart(6)}  ${row.location ?? "-"}`,
    );
  }
  if (noLd) line(`  ${noLd}/${HUB_LIMIT} pages had no JobPosting and were skipped`);
  return rows;
}

const all = [...(await harvestJobindex()), ...(await harvestHub())];

line(`\n\x1b[1m── Gate ────────────────────────────────────────────────\x1b[0m`);
const now = new Date();
let kept = 0;
for (const row of all) {
  const verdicts = PROFILES.map((p) => ({ p, g: cheapGate(row, p, now) }));
  const pass = verdicts.filter((v) => v.g.verdict === "pass");
  if (pass.length) {
    kept++;
    line(`  \x1b[32mPASS\x1b[0m ${String(row.title).slice(0, 46).padEnd(48)} -> ${pass.map((v) => v.p.name).join(", ")}`);
  } else {
    line(
      `  \x1b[90mdrop ${String(row.title).slice(0, 46).padEnd(48)} (${verdicts[0].g.reason})\x1b[0m`,
    );
  }
}

const keys = all.map((r) => r.dedupe_key);
line(
  `\n\x1b[1msummary\x1b[0m  ${all.length} postings, ${kept} pass the gate, ` +
    `${new Set(keys).size} distinct dedupe keys (${keys.length - new Set(keys).size} cross-source duplicate(s))`,
);
line(`nothing was written — this is a dry run\n`);
