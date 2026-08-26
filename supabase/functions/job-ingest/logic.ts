/**
 * job-ingest — pure normalization and validation.
 *
 * Kept out of `index.ts` so it is testable without a Supabase client, exactly as
 * `n8n-ingest/logic.ts` is.
 *
 * # Why this imports from a sibling function
 *
 * The secret comparison, the control-character strip and the timestamp coercion
 * are security-shaped code that must behave identically in every ingest path. A
 * second copy of a constant-time compare is how one of them quietly stops being
 * constant-time. Supabase's bundler follows the import graph, so a deploy of
 * `job-ingest` carries these along.
 */

import {
  clampScore,
  coerceTimestamp,
  sanitizeText,
  secretIsUsable,
  secretMatches,
} from "../n8n-ingest/logic.ts";

export { clampScore, coerceTimestamp, sanitizeText, secretIsUsable, secretMatches };

// MARK: - Limits

/** Postings per request. Lower than mail's 500 — a job body is far larger. */
export const MAX_POSTINGS = 200;
export const MAX_MATCHES_PER_POSTING = 12;

export const MAX_URL = 2048;
export const MAX_EXTERNAL_ID = 256;
export const MAX_DEDUPE_KEY = 512;
export const MAX_TITLE = 512;
export const MAX_COMPANY = 256;
export const MAX_LOCATION = 256;
export const MAX_DESCRIPTION = 40_000;
export const MAX_REASON = 1000;
export const MAX_SKILLS = 40;
export const MAX_SKILL = 64;
export const MAX_LD_JSON_CHARS = 20_000;

export const SOURCE_KINDS = ["jobindex_rss", "thehub_sitemap", "gmail_alert", "manual"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const APPLY_CHANNELS = ["email", "ats", "board", "unknown"] as const;
export const GATE_VERDICTS = ["pass", "dropped"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// MARK: - URL

/**
 * Accept only http(s), and drop tracking noise so the same ad fetched twice does
 * not produce two rows.
 *
 * `applySourceOverride` is Jobindex's own attribution parameter and is present on
 * every outbound employer link it serves — leaving it in would make the URL vary
 * by discovery path for what is one job.
 */
const STRIP_PARAMS = [
  /^utm_/i,
  /^applySourceOverride$/i,
  /^linkref$/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^ref$/i,
  /^source$/i,
];

export function canonicalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  for (const key of [...u.searchParams.keys()]) {
    if (STRIP_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  u.hash = "";
  return u.toString();
}

// MARK: - Small coercions

export function parseBoolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  return null; // "unknown" is a real state; do not fold it into false
}

export function parseStringArray(v: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    const s = sanitizeText(item, maxLen);
    if (s && !out.includes(s)) out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function boundedJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null; // cycles, BigInt — store nothing rather than fail the batch
  }
  return serialized.length > MAX_LD_JSON_CHARS ? null : value;
}

// MARK: - Rows

export interface PostingRow {
  user_id: string;
  source_kind: string;
  source_id: string | null;
  url: string;
  source_url: string | null;
  external_id: string;
  dedupe_key: string;
  title: string;
  company: string | null;
  location: string | null;
  remote: boolean | null;
  employment_type: string | null;
  lang: string | null;
  posted_at: string | null;
  valid_through: string | null;
  description: string | null;
  ld_json: unknown;
  apply_channel: string;
  apply_email: string | null;
  apply_url: string | null;
  ats_vendor: string | null;
  status: string;
}

export interface MatchInput {
  profile_id: string;
  gate_verdict: string;
  gate_reason: string | null;
  score: number | null;
  required_skills: string[];
  matched_skills: string[];
  missing_skills: string[];
  reasoning: string | null;
  model: string | null;
  evaluated_at: string | null;
}

export type NormalizeResult =
  | { ok: true; posting: PostingRow; matches: MatchInput[] }
  | { ok: false; error: string; url?: string };

/**
 * Normalize one incoming posting.
 *
 * ## `dedupe_key` is required and is NEVER recomputed here
 *
 * The key is produced by `dedupeKey()` in `n8n/job-applier/extract.js`, which has
 * unit tests. Recomputing it in this file would put two implementations of a
 * *matching rule* in the tree, and CLAUDE.md already records what that costs when
 * the two drift (garmin's mapping, the BIA calibration constants).
 *
 * The failure here is specifically nasty: a drifted key does not error, it
 * produces a second row for a job that is already stored — and downstream that is
 * a second application to the same company. So a posting without a key is
 * rejected with a reason rather than being quietly given a locally-invented one.
 */
export function normalizePosting(item: unknown, userId: string): NormalizeResult {
  if (!item || typeof item !== "object") return { ok: false, error: "not_an_object" };
  const it = item as Record<string, unknown>;

  const url = canonicalizeUrl(it.url);
  if (!url) return { ok: false, error: "invalid_url" };

  const sourceKind = sanitizeText(it.source_kind, 64);
  if (!sourceKind || !(SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    return { ok: false, error: "invalid_source_kind", url };
  }

  const externalId = sanitizeText(it.external_id, MAX_EXTERNAL_ID);
  if (!externalId) return { ok: false, error: "missing_external_id", url };

  const dedupeKey = sanitizeText(it.dedupe_key, MAX_DEDUPE_KEY);
  if (!dedupeKey) return { ok: false, error: "missing_dedupe_key", url };

  const title = sanitizeText(it.title, MAX_TITLE);
  if (!title) return { ok: false, error: "missing_title", url };

  const applyChannelRaw = sanitizeText(it.apply_channel, 32);
  const applyChannel =
    applyChannelRaw && (APPLY_CHANNELS as readonly string[]).includes(applyChannelRaw)
      ? applyChannelRaw
      : "unknown";

  const posting: PostingRow = {
    user_id: userId,
    source_kind: sourceKind,
    source_id: isUuid(it.source_id) ? it.source_id : null,
    url,
    source_url: canonicalizeUrl(it.source_url),
    external_id: externalId,
    dedupe_key: dedupeKey,
    title,
    company: sanitizeText(it.company, MAX_COMPANY),
    location: sanitizeText(it.location, MAX_LOCATION),
    remote: parseBoolOrNull(it.remote),
    employment_type: sanitizeText(it.employment_type, 128),
    lang: sanitizeText(it.lang, 8),
    posted_at: coerceTimestamp(it.posted_at),
    valid_through: coerceTimestamp(it.valid_through),
    description: sanitizeText(it.description, MAX_DESCRIPTION, { multiline: true }),
    ld_json: boundedJson(it.ld_json),
    apply_channel: applyChannel,
    apply_email: sanitizeText(it.apply_email, 320),
    apply_url: canonicalizeUrl(it.apply_url),
    ats_vendor: sanitizeText(it.ats_vendor, 64),
    status: "discovered",
  };

  const matches: MatchInput[] = [];
  if (Array.isArray(it.matches)) {
    for (const raw of it.matches.slice(0, MAX_MATCHES_PER_POSTING)) {
      const m = normalizeMatch(raw);
      if (m && !matches.some((x) => x.profile_id === m.profile_id)) matches.push(m);
    }
  }

  return { ok: true, posting, matches };
}

/**
 * Normalize one profile verdict.
 *
 * `score` stays null unless the model actually produced one. `clampScore` returns
 * null for absent/unparseable rather than 0 — the distinction between "scored
 * badly" and "never scored" is the whole reason the column is nullable, and the
 * panel sorts `nulls first` so unscored work surfaces rather than sinks.
 */
export function normalizeMatch(raw: unknown): MatchInput | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (!isUuid(r.profile_id)) return null;

  const verdictRaw = sanitizeText(r.gate_verdict, 32);
  const verdict =
    verdictRaw && (GATE_VERDICTS as readonly string[]).includes(verdictRaw) ? verdictRaw : "pass";

  const score = clampScore(r.score);

  return {
    profile_id: r.profile_id,
    gate_verdict: verdict,
    gate_reason: sanitizeText(r.gate_reason, MAX_REASON),
    score,
    required_skills: parseStringArray(r.required_skills, MAX_SKILLS, MAX_SKILL),
    matched_skills: parseStringArray(r.matched_skills, MAX_SKILLS, MAX_SKILL),
    missing_skills: parseStringArray(r.missing_skills, MAX_SKILLS, MAX_SKILL),
    reasoning: sanitizeText(r.reasoning, 4000, { multiline: true }),
    model: sanitizeText(r.model, 128),
    // Only stamp an evaluation time when there is an evaluation. A timestamp
    // beside a null score would read as "we looked and found nothing to say".
    evaluated_at: score === null ? null : (coerceTimestamp(r.evaluated_at) ?? new Date().toISOString()),
  };
}

export interface ParsedBody {
  ok: boolean;
  error?: string;
  userId?: string;
  postings?: NormalizeResult[];
}

export function parseBody(body: unknown): ParsedBody {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;

  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!Array.isArray(b.postings)) return { ok: false, error: "postings_not_an_array" };
  if (b.postings.length > MAX_POSTINGS) return { ok: false, error: "too_many_postings" };

  return {
    ok: true,
    userId: b.user_id,
    postings: b.postings.map((p) => normalizePosting(p, b.user_id as string)),
  };
}

/**
 * Collapse duplicates inside ONE request.
 *
 * The upsert key is `(user_id, source_kind, external_id)`; Postgres rejects a
 * single statement that touches the same key twice ("ON CONFLICT DO UPDATE command
 * cannot affect row a second time"). A Jobindex feed re-listing an ad is enough to
 * hit this, so it is deduped here rather than left to fail the whole batch.
 */
export function dedupeWithinBatch(rows: PostingRow[]): PostingRow[] {
  const seen = new Map<string, PostingRow>();
  for (const r of rows) seen.set(`${r.source_kind} ${r.external_id}`, r);
  return [...seen.values()];
}

// ===========================================================================
// MARK: - Phase 2: evaluation, module planning, application assembly
// ===========================================================================
//
// # Assembly is server-side, and this is the ONLY copy that matters
//
// `n8n/job-applier/evaluate.js` also carries an `assembleApplication`. This one
// is **canonical**: it is the only implementation that ever writes a row, and
// the workflow never calls the other. The split exists because
// `job_app_modules.content` deliberately never leaves Supabase — the prompt
// carries id, slot and tags only — so the workflow *cannot* assemble anything
// even if it wanted to. It posts a plan; this turns the plan into prose it
// already holds.
//
// The other copy is a dry-run preview, and `evaluate.test.js` pins the exact
// body format so a divergence is loud rather than silent. Change one, change the
// other. CLAUDE.md records what two drifting copies of a rule cost (the stale
// Garmin bridge; the BIA constants); the mitigation here is that only one of
// them is load-bearing — drift costs a wrong preview in a terminal, never a
// wrong stored draft.
//
// # The rules, stated once
//
//   1. Header: `Application: {title} — {company}`, title alone when unknown.
//   2. Every chosen module's `content` verbatim, in body order: intro first,
//      closing last, everything else between, `(sort, name, id)` within a rank.
//   3. One `[GAP: no module for '{slot}']` line per missing slot, in plan order.
//   4. Parts joined by a blank line, and NOTHING else is ever written.
//
// Rule 4 is the load-bearing one. The moment this function writes a sentence of
// its own to smooth a join, "did a human write this?" stops having an answer and
// the gap markers stop being trustworthy.

/** Enabled modules considered for one application. Beyond this, curate. */
export const MAX_MODULES = 200;
export const MAX_SLOT = 64;
export const MAX_JOB_TYPE = 64;
/** An assembled draft. A cover letter is not a novel; a runaway one is a bug. */
export const MAX_BODY_CHARS = 60_000;

export interface ModuleRow {
  id: string;
  name?: string | null;
  slot?: string | null;
  /** Tie-break input for framing. Required in the select, or intros go alphabetical. */
  tags?: string[] | null;
  /** 'en' | 'da'. Decides the framing pick before tags do. */
  lang?: string | null;
  sort?: number | null;
  content?: string | null;
}

export interface PlanSlot {
  slot: string;
  module_id: string | null;
}

export interface ModulePlan {
  job_type: string | null;
  slots: PlanSlot[];
  missing_slots: string[];
  chosen: string[];
}

/**
 * The tie-break used everywhere an application is built: `(sort, name, id)`.
 *
 * Total, not merely sorted. Postgres promises nothing about the order of rows
 * with equal sort keys, and a draft whose paragraphs shuffle between two runs is
 * not reviewable — a person would be re-reading it from scratch each time to
 * find what actually changed.
 */
export function byAssemblyOrder(a: ModuleRow, b: ModuleRow): number {
  const sa = Number.isFinite(Number(a?.sort)) ? Number(a.sort) : 0;
  const sb = Number.isFinite(Number(b?.sort)) ? Number(b.sort) : 0;
  if (sa !== sb) return sa - sb;
  const na = String(a?.name ?? "");
  const nb = String(b?.name ?? "");
  if (na !== nb) return na < nb ? -1 : 1;
  const ia = String(a?.id ?? "");
  const ib = String(b?.id ?? "");
  return ia < ib ? -1 : ia > ib ? 1 : 0;
}

// MARK: - Framing: intro and closing are a RULE, not a model choice
//
// Measured over live runs on 2026-08-25: the model reliably picks sensible
// `skill` and `project` modules and *erratically* omits `intro` and `closing`.
// One stored 85-score draft opened with a skill paragraph and carried GAP markers
// for both, against a catalog holding five enabled intros and two closings.
//
// Tightening the prompt would make that rarer, not absent. It is a modelling
// error: choosing an intro is not a judgement about the ad. Every application has
// exactly one intro and exactly one closing, and which one follows from facts
// already decided — the ad's language, and which skills matched. So the model now
// chooses `skill` / `project` / `education` (it is not even shown the others) and
// these two slots are computed.
//
// The rule, in order:
//   1. candidates = enabled modules in that slot;
//   2. keep those whose `lang` matches the verdict's, else 'en', else all;
//   3. most tag overlap with the verdict's matched + required skills;
//   4. `(sort, name, id)`.
//
// Steps 2 and 3 are both load-bearing against the real catalog: the two closings
// carry identical tags and differ only by language, while the five intros all
// carry `sort = 0` and differ only by tags. Drop either and one of the two slots
// silently picks alphabetically.
//
// ⚠️ This mirrors the same block in `n8n/job-applier/evaluate.js`. Both run — the
// workflow frames the plan it posts, and this re-derives it — so they must agree,
// and `evaluate.test.js` pins the resulting body verbatim.

export const FRAMING_SLOTS = ["intro", "closing"] as const;

/**
 * The closed slot vocabulary. A slot is a KIND OF PARAGRAPH, not a skill.
 *
 * ⚠️ Not tidiness — a bug fix. Told to name a slot even when nothing could fill
 * it, qwen2.5:7b invented one slot per missing technology (`skill_python`,
 * `skill_linux`, `skill_vllm`, `skill_kubernetes`) and then chose **no modules at
 * all**. The draft for an 85-scored job came out as a header and ten gap markers,
 * with two plainly relevant modules sitting unchosen in the catalog.
 *
 * An unbounded vocabulary let the model turn "name the gaps" into "enumerate the
 * requirements", and the enumeration crowded out the job it actually had.
 * Bounding it in the prompt is half the fix; bounding it here is the other half,
 * because the prompt is a request and this is a guarantee.
 *
 * A slot survives if it is conventional or if some module in the catalog uses it
 * — so a genuine whole-slot gap ("no cv_link module exists") stays expressible,
 * while `skill_python` is dropped. The missing *skill* is already reported in
 * `missing_skills`, which is where a skill belongs.
 */
export const KNOWN_SLOTS = [
  "intro",
  "skill",
  "project",
  "education",
  "experience",
  "cv_link",
  "portfolio_link",
  "closing",
] as const;

/** Body position: intro first, closing last, everything else in between. */
const SLOT_RANK: Record<string, number> = { intro: 0, closing: 2 };

const slotOf = (m: ModuleRow): string => String(m?.slot ?? "").toLowerCase();

export const isFramingSlot = (slot: unknown): boolean =>
  (FRAMING_SLOTS as readonly string[]).includes(String(slot ?? "").toLowerCase());

/**
 * Keep only slots that are conventional or that the catalog actually uses.
 * Order and case survive from the input; the comparison is case-insensitive.
 */
export function knownSlotsOnly(slots: string[], catalog: ModuleRow[]): string[] {
  const vocabulary = new Set<string>(KNOWN_SLOTS as readonly string[]);
  for (const m of catalog) {
    const s = slotOf(m);
    if (s) vocabulary.add(s);
  }
  return slots.filter((s) => vocabulary.has(String(s).toLowerCase()));
}

/**
 * The order a draft is actually written in: slot rank, then `(sort, name, id)`.
 *
 * Rank rather than `sort` alone because "the intro comes first" is a property of
 * a letter, not of a number someone typed into a row. The seeded catalog happens
 * to number them 0 and 90, but a module added later with a careless `sort` must
 * not be able to open the application.
 */
export function byBodyOrder(a: ModuleRow, b: ModuleRow): number {
  const ra = SLOT_RANK[slotOf(a)] ?? 1;
  const rb = SLOT_RANK[slotOf(b)] ?? 1;
  if (ra !== rb) return ra - rb;
  return byAssemblyOrder(a, b);
}

/**
 * Split skills into comparable tokens. Whole tokens, never substrings.
 *
 * Phase 1 shipped a gate that matched `ai` inside "training" and "available" and
 * passed a chef as an AI engineer. `\b` is no help — it fails immediately after
 * `+` or `#`, which `c++` and `c#` both end with. Splitting on non-alphanumerics
 * and comparing whole tokens sidesteps both.
 */
export function skillTokens(values: unknown): Set<string> {
  const out = new Set<string>();
  for (const v of Array.isArray(values) ? values : []) {
    for (const t of String(v ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .trim()
      .split(/\s+/)) {
      if (t) out.add(t);
    }
  }
  return out;
}

/** How many of a module's tags are evidenced by the verdict's skills. */
export function tagOverlap(module: ModuleRow, tokens: Set<string>): number {
  let hits = 0;
  for (const tag of Array.isArray(module?.tags) ? module.tags : []) {
    const parts = String(tag ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9+#]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length > 0 && parts.every((p) => tokens.has(p))) hits++;
  }
  return hits;
}

/**
 * Pick the one module framing the application at `slot`, or null if the catalog
 * has none — in which case the slot stays a visible gap, exactly as if the model
 * had asked for something nobody has written yet.
 */
export function pickFramingModule(
  catalog: ModuleRow[],
  slot: string,
  lang: string | null,
  tokens: Set<string>,
): ModuleRow | null {
  const candidates = catalog.filter((m) => slotOf(m) === slot);
  if (candidates.length === 0) return null;

  const inLang = (want: string) =>
    candidates.filter((m) => String(m?.lang ?? "en").toLowerCase() === want);

  // Language first: sending a Danish employer an English opening line is a bigger
  // error than opening with a slightly less apt paragraph.
  const wanted = lang ? inLang(lang) : [];
  const english = inLang("en");
  const pool = wanted.length > 0 ? wanted : english.length > 0 ? english : candidates;

  return (
    pool.slice().sort((a, b) => {
      const oa = tagOverlap(a, tokens);
      const ob = tagOverlap(b, tokens);
      if (oa !== ob) return ob - oa;
      return byAssemblyOrder(a, b);
    })[0] ?? null
  );
}

/**
 * Re-derive the module plan from what n8n posted, against the REAL catalog.
 *
 * ## Why this IS recomputed when `dedupe_key` deliberately is not
 *
 * `normalizePosting` refuses to recompute `dedupe_key`, on the grounds that two
 * implementations of a matching rule drift. That reasoning does not transfer:
 *
 *   - `dedupe_key` is a *derivation* whose inputs (a scraped page) are not
 *     available here. This is a *validation* whose input — the user's own module
 *     rows — is available here and nowhere else. n8n only ever saw metadata.
 *   - It is security-relevant. n8n filters hallucinated ids too, but n8n is a
 *     Docker container holding a scoped secret, and the client in `index.ts` is
 *     service-role and therefore bypasses RLS. Trusting that filter would let
 *     anything holding `JOB_INGEST_KEY` name *another user's* module id and have
 *     their prose pasted into a draft. The check costs one set lookup.
 *
 * An id not in `modules` is dropped, and the slot it would have covered stays in
 * `missing_slots` — a visible gap, never a substitution.
 *
 * ## Framing is applied here too
 *
 * `opts` carries the verdict's score, language and skills so `intro` and
 * `closing` can be decided by rule. n8n already framed the plan it posted; this
 * re-derives the same thing from the same inputs, so the result is identical and
 * a plan posted by an older workflow (or by hand) still comes out framed. Being
 * idempotent is what lets both run without disagreeing.
 *
 * Framing needs chosen modules AND a score. No chosen modules means the model
 * found nothing worth saying, and a letter that is an intro, a gap and a sign-off
 * is worse than an honest empty. A null score means the model failed, and framing
 * a failure dresses it up as a considered verdict — the same reason
 * `evaluated_at` is not stamped without a score.
 */
export function normalizeModulePlan(
  raw: unknown,
  modules: ModuleRow[],
  opts: { score?: number | null; lang?: string | null; skills?: unknown } = {},
): ModulePlan {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const catalog = modules.filter((m) => typeof m?.id === "string").slice(0, MAX_MODULES);

  // Needed slots, from either shape a plan can carry.
  const rawSlots = Array.isArray(r.slots) ? r.slots : [];
  const fromSlots = rawSlots.map((s) =>
    s && typeof s === "object" ? (s as Record<string, unknown>).slot : s,
  );
  let neededSlots = knownSlotsOnly(
    parseStringArray(
      [...fromSlots, ...(Array.isArray(r.missing_slots) ? r.missing_slots : [])],
      MAX_SKILLS,
      MAX_SLOT,
    ),
    catalog,
  );

  // Claimed ids, validated against the catalog rather than trusted.
  const claimed = new Set<string>();
  for (const c of Array.isArray(r.chosen) ? r.chosen : []) {
    if (typeof c === "string") claimed.add(c);
  }
  for (const s of rawSlots) {
    if (s && typeof s === "object") {
      const id = (s as Record<string, unknown>).module_id;
      if (typeof id === "string") claimed.add(id);
    }
  }
  let chosenModules = catalog.filter((m) => claimed.has(m.id));

  const framing =
    chosenModules.length > 0 && opts.score !== null && opts.score !== undefined;
  if (framing) {
    const tokens = skillTokens(opts.skills);
    // Strip whatever arrived for these two slots. Deterministic means
    // deterministic: a stray intro id must not produce two intros.
    chosenModules = chosenModules.filter((m) => !isFramingSlot(m.slot));
    neededSlots = neededSlots.filter((s) => !isFramingSlot(s));
    for (const slot of FRAMING_SLOTS) {
      const pick = pickFramingModule(catalog, slot, opts.lang ?? null, tokens);
      // A null pick leaves the slot in `neededSlots` with nothing to fill it,
      // which is exactly a gap — the honest answer for a catalog with no closing.
      if (pick) chosenModules.push(pick);
    }
    neededSlots = ["intro", ...neededSlots, "closing"];
  }

  chosenModules = chosenModules.sort(byBodyOrder);

  const slots: PlanSlot[] = [];
  const used = new Set<string>();

  for (const slot of neededSlots) {
    const hit = chosenModules.find(
      (m) => String(m.slot ?? "").toLowerCase() === slot.toLowerCase() && !used.has(m.id),
    );
    if (hit) used.add(hit.id);
    slots.push({ slot, module_id: hit ? hit.id : null });
  }
  // A chosen module covering a slot nobody listed was still a deliberate choice.
  // Dropping it would make the stored draft differ from the stored plan for a
  // reason no later reader could reconstruct.
  for (const m of chosenModules) {
    if (used.has(m.id)) continue;
    used.add(m.id);
    slots.push({ slot: sanitizeText(m.slot, MAX_SLOT) ?? "", module_id: m.id });
  }

  return {
    job_type: sanitizeText(r.job_type, MAX_JOB_TYPE),
    slots,
    missing_slots: slots.filter((s) => s.module_id === null).map((s) => s.slot),
    chosen: chosenModules.map((m) => m.id),
  };
}

export interface AssembledApplication {
  body: string;
  module_ids: string[];
  missing_slots: string[];
}

/**
 * Build the draft body. Canonical — see the block comment above.
 *
 * Deterministic and clock-free: the same plan, catalog and posting always give
 * byte-identical output. That is what lets the caller upsert on every
 * re-evaluation without churning `updated_at` for a draft that did not change.
 */
export function assembleApplication(
  plan: ModulePlan,
  modules: ModuleRow[],
  posting: { title?: string | null; company?: string | null },
): AssembledApplication {
  const byId = new Map(modules.filter((m) => typeof m?.id === "string").map((m) => [m.id, m]));

  const chosen = (plan.chosen ?? [])
    .map((id) => byId.get(id))
    .filter((m): m is ModuleRow => Boolean(m))
    .sort(byBodyOrder);

  const title = sanitizeText(posting?.title, MAX_TITLE) ?? "Untitled position";
  const company = sanitizeText(posting?.company, MAX_COMPANY);
  const parts: string[] = [
    company ? `Application: ${title} — ${company}` : `Application: ${title}`,
  ];

  for (const m of chosen) {
    // `multiline` keeps a module's paragraph breaks. A module is prose a person
    // wrote, and its shape is part of what they wrote.
    const content = sanitizeText(m.content, MAX_BODY_CHARS, { multiline: true });
    if (content) parts.push(content);
  }
  for (const slot of plan.missing_slots ?? []) parts.push(`[GAP: no module for '${slot}']`);

  const body = parts.join("\n\n");
  return {
    body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
    module_ids: chosen.map((m) => m.id),
    missing_slots: [...(plan.missing_slots ?? [])],
  };
}

// MARK: - evaluate_result body

export interface EvaluateResult {
  userId: string;
  matchId: string;
  model: string | null;
  score: number | null;
  jobType: string | null;
  lang: string | null;
  requiredSkills: string[];
  matchedSkills: string[];
  missingSkills: string[];
  reasoning: string | null;
  rawModulePlan: unknown;
}

export type EvaluateResultParse =
  | { ok: true; result: EvaluateResult }
  | { ok: false; error: string };

/**
 * Validate an `evaluate_result` body. Shape only — the module plan is normalized
 * separately, because that needs the user's catalog and this file does no I/O.
 *
 * `score` goes through the shared `clampScore`, so an absent or unparseable one
 * is **null, not 0**. The panel sorts `nulls first` precisely so a model failure
 * surfaces at the top of the review list instead of sinking to the bottom
 * looking like a considered verdict.
 */
export function parseEvaluateResult(body: unknown): EvaluateResultParse {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;

  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!isUuid(b.match_id)) return { ok: false, error: "invalid_match_id" };

  const v = (b.verdict && typeof b.verdict === "object" ? b.verdict : {}) as Record<string, unknown>;

  const langRaw = sanitizeText(v.lang, 16)?.toLowerCase() ?? "";
  const lang = langRaw.startsWith("da") ? "da" : langRaw.startsWith("en") ? "en" : null;

  return {
    ok: true,
    result: {
      userId: b.user_id,
      matchId: b.match_id,
      model: sanitizeText(b.model ?? v.model, 128),
      score: clampScore(v.score),
      jobType: sanitizeText(v.job_type, MAX_JOB_TYPE),
      lang,
      requiredSkills: parseStringArray(v.required_skills, MAX_SKILLS, MAX_SKILL),
      matchedSkills: parseStringArray(v.matched_skills, MAX_SKILLS, MAX_SKILL),
      missingSkills: parseStringArray(v.missing_skills, MAX_SKILLS, MAX_SKILL),
      reasoning: sanitizeText(v.reasoning, MAX_REASON, { multiline: true }),
      rawModulePlan: v.module_plan ?? null,
    },
  };
}

/** `pending` batch size. Each item costs one 7B inference on an 8-core Mac. */
export const MAX_PENDING = 10;
export const DEFAULT_PENDING = 5;

export function parsePendingLimit(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_PENDING;
  return Math.min(MAX_PENDING, Math.max(1, Math.floor(n)));
}

// ===========================================================================
// MARK: - Phase 3: approval and submission
// ===========================================================================
//
// # The invariant, stated once and enforced in four places
//
// **Nothing is ever sent without an explicit human approval.**
//
// The state machine is `draft -> needs_approval -> approved -> queued ->
// submitted` (see 20260826120000_job_apply.sql for the full domain). Every
// transition in this file is expressed as an UPDATE guarded on its predecessor
// status, never as a plain write — a guard in the WHERE clause is the only kind
// that survives two pollers running at once, and this pipeline has two by
// construction (n8n polls every 30 minutes; a human clicks a link whenever).
//
// # Why `apply_queue` re-checks everything approval already implied
//
// A human approving a draft is approving *that letter, to that company, before
// that deadline, with that CV attached*. Every one of those facts can change in
// the hours or days between the click and the send: a module gets edited, the ad
// expires, a second application to the same company goes out under a different
// profile. So the guards below run at SEND time, against the state as it is then,
// and approval buys permission rather than a verdict.
//
// The two kinds of guard failure are deliberately not the same shape:
//
//   SKIP    leaves the row `approved`. Used when a human can fix the blocker and
//           the application becomes sendable again — a `[TODO` still sitting in
//           the CV module, an ad that is not an email-apply channel. Failing
//           these would force a re-approval for a problem that was never about
//           the decision.
//   TERMINAL flips the row to `expired` / `cancelled`. Used when nothing can make
//           it sendable — the deadline passed, or the company already has an
//           application from us.
//
// Getting that backwards in either direction is the bug to watch for. A terminal
// state for a fixable problem silently drops good work; a skip for an unfixable
// one re-scans the same dead row on every poll forever.

/** Approval-notification batch size. Each item is one email a human must read. */
export const MAX_NOTIFY = 10;
export const DEFAULT_NOTIFY = 5;

/** Send batch size. Deliberately tiny — each item is an email to a stranger. */
export const MAX_APPLY = 5;
export const DEFAULT_APPLY = 2;

/**
 * How many applications may be SUBMITTED in one UTC day.
 *
 * Three, and the number is small on purpose. This is the blast radius of every
 * bug in this pipeline: a mis-scored batch, a duplicated queue, a workflow that
 * loops. Three wrong emails is an embarrassment; thirty is a reputation.
 *
 * UTC rather than Europe/Copenhagen, and this is a real (small) wart: the day
 * rolls over at 01:00 or 02:00 local time, so an application approved late on a
 * summer evening counts against tomorrow. Accepted because the alternative —
 * a timezone in an edge function that must agree with a timezone in a workflow —
 * is the class of thing CLAUDE.md already records going wrong twice
 * (`start_time` offsets, `startTimeLocal`). A cap that is occasionally one day
 * early is strictly better than two components disagreeing about which day it is.
 */
export const DAILY_SUBMIT_CAP = 3;

/**
 * Rows examined per poll before the limit is applied.
 *
 * Both queues need to look at MORE rows than they return: `notify_queue` cannot
 * rank by score until it has joined the matches, and `apply_queue` cannot know
 * how many candidates the guards will reject. Bounded so a large backlog cannot
 * turn one poll into an unbounded read.
 */
export const NOTIFY_SCAN = 200;
export const APPLY_SCAN = 50;

export const MAX_FAIL_REASON = 500;
export const MAX_PROOF_FIELD = 256;

/** Every status `job_applications.status` may legitimately hold. */
export const APPLICATION_STATUSES = [
  "draft",
  "needs_approval",
  "approved",
  "queued",
  "submitted",
  "cancelled",
  "expired",
  "failed",
  // Reserved: an employer replied. Named here so two workflows cannot invent two
  // spellings for it later.
  "response",
] as const;

function clampLimit(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

export const parseNotifyLimit = (v: unknown): number => clampLimit(v, DEFAULT_NOTIFY, MAX_NOTIFY);
export const parseApplyLimit = (v: unknown): number => clampLimit(v, DEFAULT_APPLY, MAX_APPLY);

// MARK: - Guard 1: unresolved gaps

/**
 * The literal markers that mean a document is not finished.
 *
 * `[GAP` is written by `assembleApplication` for a slot the catalog cannot fill.
 * `[TODO` is what a half-written module row contains — the seeded `cv_link`
 * module ships as a stub precisely so it is visibly incomplete rather than
 * plausibly wrong.
 *
 * Case-sensitive substring scan, and both of those choices are load-bearing.
 * Case-sensitive because this is matching a marker *we* emit in a fixed spelling,
 * not guessing at prose — lowercasing first would let a company whose ad contains
 * the English word "todo" block an application. Substring rather than a regex
 * because `[` is a regex metacharacter and an escaping mistake here fails OPEN,
 * which is the one direction this check must never fail.
 */
export const GAP_MARKERS = ["[GAP", "[TODO"] as const;

export function bodyHasUnresolvedGaps(body: unknown): boolean {
  if (typeof body !== "string") return true; // no body is not a finished document
  return GAP_MARKERS.some((marker) => body.includes(marker));
}

// MARK: - Guard 4: the CV gate

/**
 * Is there a usable `cv_link` module?
 *
 * An application with no link to a CV is not an application, and the module that
 * carries the link ships as a `[TODO` stub. Checking the module rather than the
 * assembled body is deliberate: the body could carry a *different* module's CV
 * mention and still leave the actual link unset.
 *
 * A missing or stubbed CV is a SKIP, never a failure. It unblocks for every
 * pending application at once the moment the user fills one row in.
 */
export function cvGateReady(modules: ModuleRow[]): boolean {
  return modules.some((m) => {
    if (String(m?.slot ?? "").toLowerCase() !== "cv_link") return false;
    const content = typeof m?.content === "string" ? m.content : "";
    return content.trim().length > 0 && !content.includes("[TODO");
  });
}

// MARK: - Guard 2: the deadline

/**
 * Has the ad's `valid_through` passed?
 *
 * NULL is not expired. Most Danish ads carry no deadline at all, and treating
 * "unknown" as "over" would silently expire the majority of the pipeline — the
 * same never-fold-unknown-into-a-value rule as `remote` (null, not false),
 * `job_matches.score` and the never-seeded `blocking_state`.
 *
 * An unparseable timestamp is likewise not expired: `coerceTimestamp` returning
 * null means we could not read it, which is not evidence about the deadline.
 */
export function deadlinePassed(validThrough: unknown, nowMs: number): boolean {
  const iso = coerceTimestamp(validThrough);
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t < nowMs;
}

/** Start of the current UTC day, as an RFC3339 string. The daily-cap window. */
export function utcDayStart(nowMs: number): string {
  const d = new Date(nowMs);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
}

// MARK: - notify_queue

export interface NotifyPosting {
  id?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  url?: string | null;
  apply_channel?: string | null;
  apply_email?: string | null;
  valid_through?: string | null;
}

export interface NotifyProfile {
  id?: string | null;
  name?: string | null;
  approval_threshold?: number | null;
}

export interface NotifyDraftRow {
  id: string;
  posting_id: string;
  profile_id: string;
  body: string | null;
  missing_slots: string[] | null;
  approval_token: string;
  job_postings: NotifyPosting | null;
  job_profiles: NotifyProfile | null;
}

export interface NotifyMatchRow {
  posting_id: string;
  profile_id: string;
  score: number | null;
  reasoning: string | null;
  matched_skills: string[] | null;
  missing_skills: string[] | null;
}

export interface NotifyItem {
  application_id: string;
  body: string | null;
  missing_slots: string[];
  score: number;
  reasoning: string | null;
  matched_skills: string[];
  missing_skills: string[];
  profile_name: string | null;
  posting: {
    title: string | null;
    company: string | null;
    location: string | null;
    url: string | null;
    apply_channel: string | null;
    apply_email: string | null;
    valid_through: string | null;
  };
  review_url: string;
}

/** The review link that goes in the decision email. Built here, never by n8n. */
export function reviewUrl(supabaseUrl: string, token: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/job-approve?token=${encodeURIComponent(token)}`;
}

/**
 * Join drafts to their match verdicts, keep the ones worth asking a human about,
 * and rank them.
 *
 * ## Why the join happens here rather than in PostgREST
 *
 * `job_applications` has no foreign key to `job_matches` — both hang off
 * `(posting_id, profile_id)` independently, which is the correct model (a match
 * is a verdict, an application is a document; one can exist without the other)
 * but leaves PostgREST with no relationship to embed through. Two queries and a
 * Map, rather than inventing an FK to please a query builder.
 *
 * ## The threshold comparison, and the null that must not pass it
 *
 * `score >= profile.approval_threshold` AND `score !== null`. The null check is
 * not redundant with the comparison: `null >= 75` is false in JS but
 * `undefined >= 75` is also false while `null >= 0` is TRUE — a profile whose
 * threshold someone set to 0 would start emailing every unscored draft. Testing
 * the null explicitly costs nothing and removes the whole family.
 *
 * A draft with no match row at all is dropped for the same reason: it has no
 * verdict, and an approval email for something nothing has judged asks the human
 * to do the model's job.
 */
export function selectNotifyCandidates(
  drafts: NotifyDraftRow[],
  matches: NotifyMatchRow[],
  opts: { limit: number; supabaseUrl: string },
): NotifyItem[] {
  const byKey = new Map<string, NotifyMatchRow>();
  for (const m of matches) byKey.set(`${m.posting_id}|${m.profile_id}`, m);

  const items: NotifyItem[] = [];
  for (const d of drafts) {
    const match = byKey.get(`${d.posting_id}|${d.profile_id}`);
    if (!match) continue;
    const score = match.score;
    if (typeof score !== "number" || !Number.isFinite(score)) continue;

    const profile = d.job_profiles ?? null;
    const threshold =
      typeof profile?.approval_threshold === "number" && Number.isFinite(profile.approval_threshold)
        ? profile.approval_threshold
        : 75; // the column default, for a row written before this migration landed
    if (score < threshold) continue;

    const posting = d.job_postings ?? null;
    items.push({
      application_id: d.id,
      body: d.body ?? null,
      missing_slots: Array.isArray(d.missing_slots) ? d.missing_slots : [],
      score,
      reasoning: match.reasoning ?? null,
      matched_skills: Array.isArray(match.matched_skills) ? match.matched_skills : [],
      missing_skills: Array.isArray(match.missing_skills) ? match.missing_skills : [],
      profile_name: profile?.name ?? null,
      posting: {
        title: posting?.title ?? null,
        company: posting?.company ?? null,
        location: posting?.location ?? null,
        url: posting?.url ?? null,
        apply_channel: posting?.apply_channel ?? null,
        apply_email: posting?.apply_email ?? null,
        valid_through: posting?.valid_through ?? null,
      },
      review_url: reviewUrl(opts.supabaseUrl, d.approval_token),
    });
  }

  // Best first: the human reads the top of the list with the most attention, so
  // that is where the strongest match belongs. `application_id` breaks ties so
  // two equal scores do not shuffle between polls.
  items.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.application_id < b.application_id ? -1 : 1
  );
  return items.slice(0, Math.max(0, opts.limit));
}

// MARK: - apply_queue planning

export interface ApplyPosting {
  id?: string | null;
  title?: string | null;
  company?: string | null;
  url?: string | null;
  apply_channel?: string | null;
  apply_email?: string | null;
  valid_through?: string | null;
  dedupe_key?: string | null;
}

export interface ApplyCandidate {
  id: string;
  body: string | null;
  posting: ApplyPosting | null;
  profile_name: string | null;
}

export interface ApplyContext {
  /** Guard 4. False when no usable `cv_link` module exists. */
  cvReady: boolean;
  /** Guard 5. `dedupe_key`s of postings this user has ALREADY submitted to. */
  submittedDedupeKeys: Set<string>;
  /** Guard 6. `DAILY_SUBMIT_CAP` minus everything already committed today. */
  budget: number;
  /** Batch size the caller asked for. */
  limit: number;
  nowMs: number;
}

export interface ApplyQueueItem {
  application_id: string;
  body: string;
  posting: {
    title: string | null;
    company: string | null;
    apply_email: string;
    url: string | null;
  };
  profile_name: string | null;
}

export interface ApplyPlan {
  /** Flip to `queued` and hand to n8n. */
  queue: ApplyQueueItem[];
  /** Flip to `expired`, with `fail_reason`. */
  expire: { application_id: string; reason: string }[];
  /** Flip to `cancelled`, with `fail_reason`. */
  cancel: { application_id: string; reason: string }[];
  /** Left `approved`. Reported so a human can see WHY nothing was sent. */
  skipped: { application_id: string; reason: string }[];
}

/**
 * Run the six send-time guards over a batch of approved applications.
 *
 * Pure: no clock, no client, no I/O. Everything it needs — the CV verdict, the
 * submitted dedupe keys, the remaining daily budget, the time — is passed in, so
 * the whole guard matrix is unit-testable, which for a function whose job is
 * "decide whether to email a stranger" is the minimum bar.
 *
 * ## Guard order is the contract order, and one consequence is worth naming
 *
 * The gap check runs BEFORE the deadline check, as specified. So an application
 * that both still has `[GAP` markers and has run past its deadline is reported as
 * `body_has_gaps` and stays `approved` rather than being flipped to `expired`. It
 * is a stale row, not a wrong send, and re-ordering the guards to tidy it up
 * would mean the reason reported for a blocked application depends on which of
 * two problems a reader happens to consider more important.
 *
 * ## `body_has_gaps` is a SKIP, not a failure
 *
 * The contract numbers this guard first and does not name its outcome. It is a
 * skip: an unfilled gap is exactly the fixable class — writing the missing module
 * unblocks every application waiting on it — and failing the row would demand a
 * fresh human approval for a problem the human's decision was never about. It is
 * the same shape as `cv_missing`, which is the same defect one layer down.
 */
export function planApplyQueue(candidates: ApplyCandidate[], ctx: ApplyContext): ApplyPlan {
  const plan: ApplyPlan = { queue: [], expire: [], cancel: [], skipped: [] };
  const eligible: ApplyQueueItem[] = [];

  for (const c of candidates) {
    const posting = c.posting ?? null;
    if (!posting) {
      // The FK is `on delete cascade`, so this is not a deleted posting — it is a
      // read that came back without its embed. Skipping keeps the row alive.
      plan.skipped.push({ application_id: c.id, reason: "posting_missing" });
      continue;
    }

    // 1. Unresolved gaps.
    if (bodyHasUnresolvedGaps(c.body)) {
      plan.skipped.push({ application_id: c.id, reason: "body_has_gaps" });
      continue;
    }

    // 2. Deadline. Terminal: nothing makes a closed ad open again.
    if (deadlinePassed(posting.valid_through, ctx.nowMs)) {
      plan.expire.push({ application_id: c.id, reason: "valid_through_passed" });
      continue;
    }

    // 3. Channel. A human can still apply by hand through an ATS, so this is a
    // skip and the row stays visible as approved-but-unsent work.
    const channel = String(posting.apply_channel ?? "").toLowerCase();
    const email = typeof posting.apply_email === "string" ? posting.apply_email.trim() : "";
    if (channel !== "email" || email.length === 0) {
      plan.skipped.push({ application_id: c.id, reason: "not_email_channel" });
      continue;
    }

    // 4. CV.
    if (!ctx.cvReady) {
      plan.skipped.push({ application_id: c.id, reason: "cv_missing" });
      continue;
    }

    // 5. Cross-source dedup. Terminal, and the harshest guard here on purpose:
    // two letters to one company is worse than a missed application, which is the
    // same judgement `job_postings.dedupe_key` exists to encode one stage
    // earlier. The caller must have excluded THIS application's own row when
    // building the set, or a re-poll would cancel what it just submitted.
    const key = typeof posting.dedupe_key === "string" ? posting.dedupe_key : "";
    if (key && ctx.submittedDedupeKeys.has(key)) {
      plan.cancel.push({ application_id: c.id, reason: "duplicate_company_application" });
      continue;
    }

    eligible.push({
      application_id: c.id,
      body: String(c.body ?? ""),
      posting: {
        title: posting.title ?? null,
        company: posting.company ?? null,
        apply_email: email,
        url: posting.url ?? null,
      },
      profile_name: c.profile_name ?? null,
    });
  }

  // 6. Daily cap. Everything the cap itself excludes is reported, because "we
  // stopped at three today" is information; everything the *batch limit* excludes
  // is not, because it is simply the next poll's work and reporting it would make
  // a healthy queue look like a wall of skips.
  const room = Math.max(0, ctx.budget);
  for (const item of eligible.slice(room)) {
    plan.skipped.push({ application_id: item.application_id, reason: "daily_cap" });
  }
  plan.queue = eligible.slice(0, room).slice(0, Math.max(0, ctx.limit));

  return plan;
}

// MARK: - notify_result / apply_result bodies

export interface NotifyResultInput {
  userId: string;
  applicationId: string;
  ok: boolean;
  messageId: string | null;
}

export type NotifyResultParse =
  | { ok: true; result: NotifyResultInput }
  | { ok: false; error: string };

/**
 * `ok` must be a real boolean.
 *
 * Not truthy-coerced, and this is the whole check: n8n emits `""` for an
 * expression that resolved to nothing, and `"false"` for a boolean rendered into
 * a string field. `Boolean("false")` is `true`, which would mark an email that
 * never sent as sent — and `notify_result ok:true` is the transition that makes
 * an application eligible for approval. The string spellings are accepted
 * explicitly; anything else is a 400 rather than a guess.
 */
export function parseStrictBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function parseNotifyResult(body: unknown): NotifyResultParse {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!isUuid(b.application_id)) return { ok: false, error: "invalid_application_id" };
  const ok = parseStrictBool(b.ok);
  if (ok === null) return { ok: false, error: "invalid_ok" };
  return {
    ok: true,
    result: {
      userId: b.user_id,
      applicationId: b.application_id,
      ok,
      messageId: sanitizeText(b.message_id, MAX_PROOF_FIELD),
    },
  };
}

export interface ApplyResultInput {
  userId: string;
  applicationId: string;
  ok: boolean;
  proof: Record<string, string> | null;
  error: string | null;
}

export type ApplyResultParse =
  | { ok: true; result: ApplyResultInput }
  | { ok: false; error: string };

/**
 * The audit payload: what n8n can name about what actually left the machine.
 *
 * Keys are kept as sent rather than allow-listed — a future channel will carry
 * different evidence and a rejected field is evidence destroyed — but every
 * VALUE is sanitized and bounded, and the whole object is bounded again by
 * `boundedJson`. Nested structure is dropped: an audit record is a flat set of
 * identifiers, and accepting arbitrary depth here is how an unbounded blob gets
 * into a jsonb column that a panel renders.
 */
export function normalizeProof(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = sanitizeText(k, 64);
    if (!key) continue;
    const value = typeof v === "number" || typeof v === "boolean" ? String(v) : v;
    const clean = sanitizeText(value, MAX_PROOF_FIELD);
    if (clean) out[key] = clean;
    if (Object.keys(out).length >= 16) break;
  }
  if (Object.keys(out).length === 0) return null;
  return boundedJson(out) as Record<string, string> | null;
}

export function parseApplyResult(body: unknown): ApplyResultParse {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!isUuid(b.application_id)) return { ok: false, error: "invalid_application_id" };
  const ok = parseStrictBool(b.ok);
  if (ok === null) return { ok: false, error: "invalid_ok" };
  return {
    ok: true,
    result: {
      userId: b.user_id,
      applicationId: b.application_id,
      ok,
      proof: normalizeProof(b.proof),
      // Gmail's errors are long and occasionally quote the message. Bounded and
      // stripped of control characters like every other stranger-authored string
      // that reaches a column a panel will render.
      error: sanitizeText(b.error, MAX_FAIL_REASON, { multiline: true }),
    },
  };
}
