/**
 * The panel's *other* pure rules: relative time, the badge arithmetic, the
 * threshold clamp, chip-list editing, and how one submission attempt reads.
 *
 * Separate from `score.ts` because that file is about the model's verdict and
 * this one is about the surface — but the same house rule applies to both:
 * React-free, exported, and tested (`format.test.ts`). Anything a component
 * computes inline is a rule nobody can pin down later, and every function here
 * exists because getting it wrong is invisible rather than loud.
 */

import type { JobAppModule, JobSubmissionAttempt } from "./types";
import { RESPONSE_STATUS } from "./types";

// ── Relative time ─────────────────────────────────────────────────────────

/**
 * "2h ago" / "4d ago" / "21 Aug". Empty string for anything unparseable.
 *
 * `now` is injectable so this can be tested at all — a relative-time helper
 * reading `Date.now()` internally is one whose tests either drift or assert
 * nothing. Empty (never "unknown", never a guessed date) for a bad timestamp:
 * the caller decides what absence looks like, and two live timestamp formats
 * in one column is a mistake this codebase has already made once.
 */
export function ago(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const diff = now - t;
  if (diff < 0) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

// ── The badge ─────────────────────────────────────────────────────────────

/**
 * What the header badge counts: **decisions waiting + replies received**.
 *
 * A reply from a company is not a lesser event than a draft awaiting approval —
 * it is arguably the only thing in this whole pipeline that was ever the point.
 * So it carries the same urgency rather than sitting quietly inside a tab.
 *
 * `null` in, `null` out — but only when *both* halves are unknown. A failed
 * count must never be silently treated as zero (that is the `blocking_state`
 * seeding mistake wearing a third hat: "couldn't tell" rendering as "nothing
 * waiting"), and equally a known 3 must not be suppressed because the other
 * half of the pair failed. So: sum what is known, and return `null` only when
 * nothing is.
 */
export function jobsBadgeCount(
  needsApproval: number | null | undefined,
  responses: number | null | undefined,
): number | null {
  const a = typeof needsApproval === "number" && Number.isFinite(needsApproval) ? needsApproval : null;
  const b = typeof responses === "number" && Number.isFinite(responses) ? responses : null;
  if (a === null && b === null) return null;
  return Math.max(0, (a ?? 0) + (b ?? 0));
}

/** True for the status a company reply lands on. Free text, so this is the one place it is spelled. */
export function isResponseStatus(status: string | null | undefined): boolean {
  return status === RESPONSE_STATUS;
}

// ── The approval threshold ────────────────────────────────────────────────

export const THRESHOLD_MIN = 0;
export const THRESHOLD_MAX = 100;

/**
 * Clamp a typed threshold to an integer in 0–100, or `null` if it is not a
 * number at all.
 *
 * The `null` branch is the important one and it is deliberately different from
 * clamping: a half-typed input (`""`, `"-"`, `"7e"`) must leave the stored
 * value alone, not write 0. Writing 0 would set the profile to "ask me about
 * literally every posting" — the loudest possible failure — because someone
 * selected the field and pressed backspace.
 *
 * Out-of-range numbers *are* clamped rather than rejected, unlike
 * `normalizeScore`: a score of 999 is corrupt data arriving from a model, but a
 * threshold of 999 is a person holding the up-arrow, and the right answer to
 * that is 100.
 */
export function clampThreshold(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, Math.round(n)));
}

// ── Expected pay ──────────────────────────────────────────────────────────
//
// `job_profiles` carries an expected-pay range — monthly and hourly, DKK, all
// four bounds independently nullable (`20260907120000_job_profile_expected_pay.sql`).
// It gates nothing; it is the ready answer for the "expected salary" /
// "lønforventning" box almost every ATS form asks for, which nothing in this
// pipeline can otherwise fill in. `notify.js`'s `formatPayLine` renders the
// same shape into the decision email — the two are independently written and
// independently tested (that file cannot import from here, see its own
// header), but they should read as the same feature. Port a change to one into
// the other.

/**
 * "42–50k kr/md · 230–270 kr/t" — same rendering rule as `notify.js`'s
 * `formatPayLine`. Each half (monthly, hourly) renders only when at least one
 * of its own bounds is present — "42k+ kr/md" for an open lower bound, "op til
 * 50k kr/md" for an open upper bound, "42–50k kr/md" for both — and the two
 * halves join with " · " when both have something to say. Null when neither
 * pair holds anything, never a label with nothing after it.
 *
 * Takes the DB's own column names (`expected_monthly_min`, …), not the
 * shorter `monthly_min` keys `NotifyItem.expected_pay` nests them under — the
 * only real caller in this package is `JobsPanel` passing a whole
 * `JobProfileFull` row (from `snapshot.profiles`) straight through, so this
 * matches that shape rather than making every call site remap four fields
 * first. `notify.js`'s `formatPayLine` takes the API's nested shape because
 * *its* caller (`buildDecisionEmail`) already has `item.expected_pay` in that
 * form; same string output, deliberately different input shape.
 */
export function formatPayRange(pay: {
  expected_monthly_min?: number | null;
  expected_monthly_max?: number | null;
  expected_hourly_min?: number | null;
  expected_hourly_max?: number | null;
} | null | undefined): string | null {
  const p = pay ?? {};
  const monthly = formatMonthlyPay(
    payNumOrNull(p.expected_monthly_min),
    payNumOrNull(p.expected_monthly_max),
  );
  const hourly = formatHourlyPay(
    payNumOrNull(p.expected_hourly_min),
    payNumOrNull(p.expected_hourly_max),
  );
  const parts = [monthly, hourly].filter((s): s is string => s !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

function payNumOrNull(v: number | null | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** `42000` → `"42"`, `42500` → `"42.5"` — thousands, one decimal only when it is not a round figure. */
function payThousands(n: number): string {
  const k = n / 1000;
  return Number.isInteger(k) ? String(k) : k.toFixed(1);
}

function formatMonthlyPay(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${payThousands(min)}–${payThousands(max)}k kr/md`;
  if (min !== null) return `${payThousands(min)}k+ kr/md`;
  if (max !== null) return `op til ${payThousands(max)}k kr/md`;
  return null;
}

/** Same shape as `formatMonthlyPay`, unscaled — an hourly rate is already a small number. */
function formatHourlyPay(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${min}–${max} kr/t`;
  if (min !== null) return `${min}+ kr/t`;
  if (max !== null) return `op til ${max} kr/t`;
  return null;
}

/**
 * Parse one typed pay-bound field, or `null` for empty/unparseable input.
 *
 * Same "leave it alone rather than invent zero" contract as `clampThreshold`,
 * with two differences that matter here: there is no upper bound (a salary is
 * not a 0–100 score), and this NEVER clamps a negative into range — the caller
 * decides what to do with an out-of-domain value, because unlike a threshold a
 * negative salary is not "a person holding the down-arrow", it is a typo worth
 * refusing outright rather than silently flooring to 0.
 */
export function parsePayBound(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Editing the MIN of a pay pair: if the new value would land above the
 * current max, raise the max to match rather than silently reverting the
 * keystroke — the edit just made should win. Mirrors
 * `job_profiles_expected_{monthly,hourly}_range_chk`, which only fires when
 * BOTH halves are present, so a lone bound (the other null) is left alone.
 *
 * Always returns BOTH halves so the caller can send them as one patch: a
 * write of `expected_monthly_min` alone, against a stored max the new min now
 * exceeds, would trip the DB constraint and fail outright.
 */
export function clampPayMin(
  next: number | null,
  currentMax: number | null,
): { min: number | null; max: number | null } {
  if (next !== null && currentMax !== null && next > currentMax) {
    return { min: next, max: next };
  }
  return { min: next, max: currentMax };
}

/** Same rule, edited from the other side: a max below the current min drags the min down to meet it. */
export function clampPayMax(
  next: number | null,
  currentMin: number | null,
): { min: number | null; max: number | null } {
  if (next !== null && currentMin !== null && next < currentMin) {
    return { min: next, max: next };
  }
  return { min: currentMin, max: next };
}

// ── Chip lists (keywords, exclude_terms) ──────────────────────────────────

/**
 * Add one entry to a `text[]`, preserving the typed casing and de-duplicating
 * case-insensitively.
 *
 * Casing is preserved because the column is what a human reads back; matching
 * is case-insensitive because `cheapGate` lowercases both sides before
 * comparing (`extract.js`). Normalising to lowercase on write would therefore
 * change nothing about the gate and everything about how "C#" and "PyTorch"
 * look in the panel.
 *
 * Returns the **same contents** for a no-op (empty or duplicate) so a caller
 * comparing before/after can skip the write entirely — an `.update()` that
 * writes an identical array still bumps `updated_at` and still costs a round
 * trip on every stray Enter.
 */
export function addChip(list: readonly string[], raw: string): string[] {
  const current = (list ?? []).filter((s) => typeof s === "string" && s.trim() !== "");
  const value = String(raw ?? "").trim();
  if (value === "") return [...current];
  const seen = new Set(current.map((s) => s.toLowerCase()));
  if (seen.has(value.toLowerCase())) return [...current];
  return [...current, value];
}

/** Remove one entry, case-insensitively. Removing something absent is a no-op, not an error. */
export function removeChip(list: readonly string[], value: string): string[] {
  const target = String(value ?? "").toLowerCase();
  return (list ?? [])
    .filter((s) => typeof s === "string" && s.trim() !== "")
    .filter((s) => s.toLowerCase() !== target);
}

/** True when two chip lists differ in contents or order — the "is this worth a write?" test. */
export function chipsEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

// ── Submission attempts ───────────────────────────────────────────────────

/**
 * Three outcomes, not two.
 *
 * `ok is null` is "the attempt started and we never heard back" — the shape of
 * an n8n run the Mac slept through — and the migration makes the column
 * nullable specifically so that state stays distinguishable from a recorded
 * failure. Collapsing it into ✗ would invent failures; collapsing it into ✓
 * would invent sent applications. It gets its own mark.
 */
export type AttemptOutcome = "ok" | "failed" | "pending";

export function attemptOutcome(ok: boolean | null | undefined): AttemptOutcome {
  if (ok === true) return "ok";
  if (ok === false) return "failed";
  return "pending";
}

export const ATTEMPT_MARK: Record<AttemptOutcome, string> = {
  ok: "✓",
  failed: "✗",
  pending: "…",
};

export const ATTEMPT_LABEL: Record<AttemptOutcome, string> = {
  ok: "sent",
  failed: "failed",
  // Not "in progress": an attempt row from three days ago with a null `ok` is
  // not running, it is a report that never arrived. The word has to work for both.
  pending: "no result recorded",
};

/** Head-truncate an opaque id. Gmail message ids are long and only the prefix is ever recognised. */
export function shortId(id: string | null | undefined, max = 12): string | null {
  const s = String(id ?? "").trim();
  if (s === "") return null;
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}

/**
 * Dig the Gmail message id out of `proof`.
 *
 * `proof` is jsonb written by n8n — a record of what an external system said,
 * not a relation this code controls — so every access is defensive: it may be
 * null, a string, an array, or an object with the key spelled a different way
 * after a workflow edit. A thrown TypeError here would take out the whole
 * attempt list, which is the one surface that can answer "did this letter
 * actually leave the machine?".
 */
export function proofMessageId(proof: unknown): string | null {
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return null;
  const p = proof as Record<string, unknown>;
  for (const key of ["gmail_message_id", "message_id", "messageId"]) {
    const v = p[key];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
  }
  return null;
}

export type AttemptLine = {
  outcome: AttemptOutcome;
  mark: string;
  label: string;
  /** Relative time of the attempt. Falls back to `created_at` when `started_at` is unusable. */
  when: string;
  /** The failure text, when there is one. Never invented for a pending attempt. */
  error: string | null;
  /** Truncated Gmail message id from `proof`, when the attempt produced one. */
  proofId: string | null;
};

/**
 * One attempt, as the single compact line the Sent tab renders.
 *
 * Kept out of the component so the "✓ / ✗ / …" decision and the fallbacks are
 * one testable rule rather than a chain of JSX ternaries — and so a change to
 * what n8n writes into `proof` breaks a test rather than a dropdown.
 */
// ── The CV link ───────────────────────────────────────────────────────────
//
// He applies to most jobs through an external ATS form that wants a CV
// upload, so every surface that hands him a job needs a direct download link
// next to it. There is no dedicated column for it: `cv_link` is a THIRD framed
// slot on `job_app_modules` (`job-ingest/logic.ts`'s `FRAMING_SLOTS`) — one
// paragraph of freehand prose a person wrote once ("My CV is at
// prk315.github.io/personal-website/cv.pdf, and I'm happy to send it in
// whatever format…"), the same shape as `intro` and `closing`. So getting a
// clickable URL out of it is two separate, separately-testable rules: find the
// right module, then find the URL inside its prose.
//
// ⚠️ CANONICAL SOURCE: `supabase/functions/job-ingest/logic.ts`'s
// `canonicalizeUrl` / `extractFirstUrl` / `isUsableCvModule` / `cvUrlFromModules`.
// That file computes the `cv_url` the decision email actually renders (via
// `notify_queue` → `notify.js`), so this panel's link and that email's link
// MUST agree — a looser or stricter rule here would show no link (or a
// different one) where the email shows the real one. nexus-core cannot import
// a Supabase edge function, so this is a deliberate, faithful MIRROR, not an
// independent implementation. Port any future change to those four functions
// here too — `format.test.ts` carries the same fixture strings
// `logic.test.ts` pins server-side (the real seeded module content included),
// precisely so drift breaks a test here instead of showing up as "the panel
// has no CV link but the email does."
//
// One deliberate, documented difference in SCOPE rather than rule: `logic.ts`
// filters `enabled` at the SQL query (`.eq("enabled", true)`) before its pure
// functions ever see a row, so `isUsableCvModule` itself does not re-check it.
// This panel's `snapshot.modules` intentionally holds every module — the
// Modules tab needs the disabled ones too — so `pickCvUrl` below applies the
// same `enabled` filter locally. The two paths still agree on which module
// counts once both filters are applied.

/**
 * Tracking / attribution params dropped so the same file never produces two
 * different-looking links depending on how it was found. Exact mirror of
 * `logic.ts`'s `STRIP_PARAMS`.
 */
const CV_STRIP_PARAMS = [
  /^utm_/i,
  /^applySourceOverride$/i,
  /^linkref$/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^ref$/i,
  /^source$/i,
];

/** A URL longer than this is a payload, not a link. Mirrors `logic.ts`'s `MAX_URL`. */
const CV_MAX_URL = 2048;

/** Prose scanned for a URL, bounded — a CV module is a paragraph, not a document. Mirrors `logic.ts`'s `MAX_CV_SCAN`. */
export const MAX_CV_SCAN = 10_000;

/** Sentence punctuation that ends up glued to a URL in ordinary prose. Mirrors `logic.ts`'s `URL_TRAILING_PUNCT`. */
const CV_URL_TRAILING_PUNCT = /[.,;:!?)\]}>"'»]+$/;

/**
 * A scheme-prefixed URL, a `www.` one, or a bare `host.tld/path`.
 *
 * The bare form REQUIRES a path, and that is the whole guard: this scans a
 * sentence a human wrote, and a bare `host.tld` with no slash matches "e.g.",
 * "B.Sc." and the full stop ending "…suits your process." A required `/`
 * removes that entire false-positive family at once — a CV link is a link to
 * a file. Exact mirror of `logic.ts`'s `URL_CANDIDATE_RE`.
 */
const CV_URL_CANDIDATE_RE =
  /(?:https?:\/\/|www\.)[^\s<>"']+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+\/[^\s<>"']*/gi;

/**
 * Parse, protocol-check, tracking-strip and length-bound a URL. Exact mirror
 * of `logic.ts`'s `canonicalizeUrl`, restricted to the two protocols this
 * panel will ever render as an `href`.
 */
function canonicalizeCvUrl(raw: string): string | null {
  if (raw.length === 0 || raw.length > CV_MAX_URL) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  for (const key of [...u.searchParams.keys()]) {
    if (CV_STRIP_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  u.hash = "";
  return u.toString();
}

/**
 * The first URL in a piece of prose, normalized to `https://`, or null.
 *
 * Faithful port of `logic.ts`'s `extractFirstUrl` — see the file banner above
 * for why a divergence here is a real bug, not a style choice. Scheme-less
 * input is assumed https rather than http; an explicit `http://` is UPGRADED,
 * because this string is about to be pasted into someone else's form as a
 * link about the candidate. A bare `host/path` sitting immediately after a
 * scheme separator (`ftp://example.com/cv`) is the tail of a scheme this
 * function does not accept, and is skipped rather than re-prefixed with
 * `https://` — that would invent a URL the author did not write.
 *
 * Null for anything that is not a string, holds nothing URL-shaped, or would
 * parse to a hostname with no dot (a word, not a host) — never an empty
 * string, and never a guess. `it.cv_url` in `notify.js` renders the same way
 * for the same reason: absent is absent, not "".
 */
export function firstLinkUrl(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text.length === 0) return null;
  const scanned = text.length > MAX_CV_SCAN ? text.slice(0, MAX_CV_SCAN) : text;

  CV_URL_CANDIDATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CV_URL_CANDIDATE_RE.exec(scanned)) !== null) {
    if (scanned.slice(Math.max(0, match.index - 3), match.index) === "://") continue;

    let raw = match[0].replace(CV_URL_TRAILING_PUNCT, "");
    if (raw.length === 0 || raw.length > CV_MAX_URL) continue;
    if (/^http:\/\//i.test(raw)) raw = `https://${raw.slice("http://".length)}`;
    else if (!/^https:\/\//i.test(raw)) raw = `https://${raw}`;

    const canonical = canonicalizeCvUrl(raw);
    if (!canonical) continue;
    try {
      // A hostname with no dot is a word, not a host — `https://process/x`
      // would otherwise parse perfectly and render a link to nowhere.
      if (!new URL(canonical).hostname.includes(".")) continue;
    } catch {
      continue;
    }
    return canonical;
  }
  return null;
}

/**
 * Is this a `cv_link` module worth reading a URL out of?
 *
 * Non-empty content, and no `[TODO` marker. Mirrors `logic.ts`'s
 * `isUsableCvModule`: the seeded module ships as a stub, and nothing stops
 * someone enabling it before filling it in. Surfacing `[TODO: paste the
 * link]` — or a URL sitting inside one — as "the" CV link would be worse than
 * showing none, and would disagree with the send gate, which uses the exact
 * same predicate to decide whether a draft may go out at all.
 */
function isUsableCvModule(m: JobAppModule): boolean {
  if ((m.slot ?? "").toLowerCase() !== "cv_link") return false;
  const content = typeof m.content === "string" ? m.content : "";
  return content.trim().length > 0 && !content.includes("[TODO");
}

/**
 * The CV download link, derived from the module catalog — never stored
 * anywhere of its own.
 *
 * Picks the enabled, usable `cv_link` module the assembler would actually
 * choose — same `(sort, name, id)` tie-break `logic.ts`'s `byAssemblyOrder`
 * uses server-side, so the panel and the letter agree on which module is
 * "the" CV link when more than one is enabled — then pulls the URL out of its
 * prose with `firstLinkUrl`, falling through to the next candidate when one
 * holds no URL. Mirrors `logic.ts`'s `cvUrlFromModules`, with the `enabled`
 * filter applied here explicitly — see the file banner above for why.
 *
 * Null for no catalog, no usable `cv_link` module, or one whose content holds
 * nothing URL-shaped — every one of those is "nothing to show", not a guess.
 */
export function pickCvUrl(modules: readonly JobAppModule[] | null | undefined): string | null {
  const candidates = (modules ?? [])
    .filter((m) => m.enabled && isUsableCvModule(m))
    .slice()
    .sort((a, b) => {
      const sa = Number.isFinite(a.sort) ? a.sort : 0;
      const sb = Number.isFinite(b.sort) ? b.sort : 0;
      if (sa !== sb) return sa - sb;
      const na = a.name ?? "";
      const nb = b.name ?? "";
      if (na !== nb) return na < nb ? -1 : 1;
      const ia = a.id ?? "";
      const ib = b.id ?? "";
      return ia < ib ? -1 : ia > ib ? 1 : 0;
    });
  for (const m of candidates) {
    const url = firstLinkUrl(m.content);
    if (url) return url;
  }
  return null;
}

export function attemptLine(a: JobSubmissionAttempt, now: number = Date.now()): AttemptLine {
  const outcome = attemptOutcome(a.ok);
  const when = ago(a.started_at, now) || ago(a.created_at, now);
  const err = typeof a.error === "string" && a.error.trim() !== "" ? a.error.trim() : null;
  return {
    outcome,
    mark: ATTEMPT_MARK[outcome],
    label: ATTEMPT_LABEL[outcome],
    when,
    error: err,
    proofId: shortId(proofMessageId(a.proof)),
  };
}
