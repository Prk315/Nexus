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

function boundedJson(value: unknown): unknown {
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
