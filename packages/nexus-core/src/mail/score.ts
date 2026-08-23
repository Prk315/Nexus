/**
 * Pure ordering / bucketing / sanitising for the mail triage list. No React,
 * no Supabase, no Tauri — same discipline as `coverage.ts`, so every rule here
 * is testable in isolation (`score.test.ts`) and the panel stays a dumb
 * renderer of whatever these functions decide.
 *
 * `score` is the model's **evidence** — one 0-100 number. The **verdict** is
 * the importance x urgency pair in `axes.ts`. This file deliberately does not
 * derive one from the other: a score is not an axis, and inventing axes from a
 * number would launder a guess into something the UI presents as a decision.
 */

import { HANDLED_STATUSES, type MailMessage } from "./types";

// ── Score scale ────────────────────────────────────────────────────────

/**
 * `untriaged` is a first-class bucket, not a fallback, and it sorts **first**.
 *
 * A `null` priority means the model has not scored the row yet — a different
 * fact from "scored low", and the one most likely to need a human. Collapsing
 * it into a numeric bucket (or into 0) is the mail version of seeding
 * `blocking_state` with zeros: it makes "no verdict yet" indistinguishable
 * from "verdict: nothing here", and hides the rows that most need looking at.
 */
export type ScoreBucket = "untriaged" | "urgent" | "high" | "normal" | "low";

/** Render order: un-triaged first, then most urgent down. */
export const SCORE_BUCKETS: readonly ScoreBucket[] = [
  "untriaged",
  "urgent",
  "high",
  "normal",
  "low",
] as const;

/** Inclusive bounds of the scored range. Pinned in the migration's CHECK too. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Lower inclusive bound of each scored bucket, most urgent first. */
export const BUCKET_FLOOR: Record<Exclude<ScoreBucket, "untriaged">, number> = {
  urgent: 80,
  high: 60,
  normal: 30,
  low: SCORE_MIN,
};

/**
 * Clamp a score into 0–100, or return `null` for "not triaged".
 *
 * Mirrors `clampPriority` in the `n8n-ingest` edge function deliberately: a
 * value that is present but out of range is a verdict the model spelled badly,
 * so it clamps; a value that is absent is not a verdict at all, so it stays
 * `null`. The two must not be conflated in either direction — which is why
 * this returns `number | null` rather than defaulting.
 */
export function normalizeScore(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(value)));
}

export function scoreBucket(value: number | null | undefined): ScoreBucket {
  const p = normalizeScore(value);
  if (p === null) return "untriaged";
  if (p >= BUCKET_FLOOR.urgent) return "urgent";
  if (p >= BUCKET_FLOOR.high) return "high";
  if (p >= BUCKET_FLOOR.normal) return "normal";
  return "low";
}

export const BUCKET_LABEL: Record<ScoreBucket, string> = {
  untriaged: "Not scored",
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * Hex rather than Tailwind class names, for the same reason `ClockDropdown`
 * keeps a `COLOR_HEX` map: a dynamically-built `bg-${bucket}-500` is invisible
 * to Tailwind's scanner across the package boundary and renders as nothing.
 *
 * `untriaged` gets violet specifically so it cannot be mistaken for `low`'s
 * grey — "we haven't looked at this" and "we looked, it's unimportant" are
 * opposite meanings and must not share a colour family.
 */
export const BUCKET_HEX: Record<ScoreBucket, string> = {
  untriaged: "#8b5cf6", // violet-500
  urgent: "#ef4444", // red-500
  high: "#f97316", // orange-500
  normal: "#3b82f6", // blue-500
  low: "#94a3b8", // slate-400
};

// ── Triage status ─────────────────────────────────────────────────────────

/**
 * Has the user finished with this message?
 *
 * `status` is CHECK-constrained to four values, so this is exhaustive today.
 * It still treats an **unrecognised or missing** status as *open* rather than
 * handled: if a future migration widens the vocabulary, the worst outcome is a
 * stale row visible in the panel, where the opposite default would silently
 * swallow real mail.
 */
export function isHandled(status: string | null | undefined): boolean {
  if (!status) return false;
  return (HANDLED_STATUSES as readonly string[]).includes(status.trim().toLowerCase());
}

// ── Ordering ──────────────────────────────────────────────────────────────

/**
 * `received_at` as epoch ms. Unparseable or missing yields 0, so such a row
 * sorts last under the descending comparison rather than becoming "now".
 */
export function receivedAtMs(message: MailMessage): number {
  if (!message.received_at) return 0;
  const t = Date.parse(message.received_at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * `priority desc nulls first, received_at desc` — the exact ordering the
 * `mail_messages_user_priority` index is built for, restated client-side
 * because the panel re-sorts after merging and clamping.
 *
 * `nulls first` is part of the contract, not a default: un-triaged mail belongs
 * at the top of a triage list. The trailing `id` key exists only to make the
 * order **total**, so two messages tying on both real keys don't swap places
 * between renders and make the list visibly jitter.
 */
export function compareMail(a: MailMessage, b: MailMessage): number {
  const pa = normalizeScore(a.score);
  const pb = normalizeScore(b.score);
  // nulls first, and only against a scored row — two un-triaged messages fall
  // through to recency together.
  if (pa === null && pb !== null) return -1;
  if (pb === null && pa !== null) return 1;
  if (pa !== null && pb !== null && pa !== pb) return pb - pa;
  const byRecency = receivedAtMs(b) - receivedAtMs(a);
  if (byRecency !== 0) return byRecency;
  return String(a.id).localeCompare(String(b.id));
}

/** Non-mutating sort — the caller's array (often React state) stays untouched. */
export function sortMail(messages: readonly MailMessage[]): MailMessage[] {
  return [...messages].sort(compareMail);
}

// ── Partitioning ──────────────────────────────────────────────────────────

export type MailTriage = {
  /** Still open, sorted by `compareMail`. */
  pending: MailMessage[];
  /** Already dealt with, sorted the same way. */
  handled: MailMessage[];
  /** Every row handed in — the size of the fetched window, nothing more. */
  total: number;
};

/**
 * Split a fetch into open / handled.
 *
 * The loader already filters to open statuses in SQL, so `handled` is normally
 * empty; this is the client-side backstop for a status the database starts
 * allowing before this code knows about it.
 *
 * Note what `total` is **not**: it is not a freshness signal. Zero rows means
 * "n8n has never run" *or* "the inbox is clean", and those must not render the
 * same way. `MailSnapshot.lastSyncedAt`, read from the `n8n_requests` queue, is
 * the signal that tells them apart.
 */
export function triageInbox(messages: readonly MailMessage[]): MailTriage {
  const pending: MailMessage[] = [];
  const handled: MailMessage[] = [];
  for (const m of messages) {
    (isHandled(m.status) ? handled : pending).push(m);
  }
  return {
    pending: pending.sort(compareMail),
    handled: handled.sort(compareMail),
    total: messages.length,
  };
}

export type MailBucketGroup = {
  bucket: ScoreBucket;
  label: string;
  messages: MailMessage[];
};

/**
 * Group into priority buckets in `SCORE_BUCKETS` order. Empty buckets are
 * dropped — a heading with nothing under it reads as a loading failure.
 */
export function groupByBucket(messages: readonly MailMessage[]): MailBucketGroup[] {
  const byBucket = new Map<ScoreBucket, MailMessage[]>();
  for (const m of sortMail(messages)) {
    const bucket = scoreBucket(m.score);
    const list = byBucket.get(bucket);
    if (list) list.push(m);
    else byBucket.set(bucket, [m]);
  }
  return SCORE_BUCKETS.filter((b) => byBucket.has(b)).map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    messages: byBucket.get(bucket)!,
  }));
}

// ── Untrusted text ────────────────────────────────────────────────────────

/**
 * `subject`, `snippet`, `category` and `suggested_reply` were written by an
 * LLM that read arbitrary email, so all four are attacker-influenced. React
 * escapes them on render (and nothing here ever goes near
 * `dangerouslySetInnerHTML`), but escaping does not stop a message from
 * smuggling control characters or a thousand blank lines through the layout.
 *
 * Strip control and invisible-format characters, collapse runs of horizontal
 * whitespace and of blank lines, then cap the length.
 */
export function plainText(value: string | null | undefined, maxLength = 2000): string {
  if (!value) return "";
  const collapsed = value
    // CRLF / CR first, so the control-strip below can keep a bare \n as the one
    // surviving control character — paragraphs in a draft reply are meaningful.
    .replace(/\r\n?/g, "\n")
    // C0 except the whitespace ones, DEL, C1 — plus the zero-width and bidi
    // format characters. The latter are not cosmetic: an RLO in a subject line
    // is the classic "invoice\u202Egnp.exe" spoof, and JS `\s` does not match
    // U+200B, so the whitespace collapse below would never catch them.
    // Written as escapes on purpose: pasting the literal characters into the
    // source makes the class unreviewable. \t \n \v \f survive so the collapse
    // turns them into a space — stripping a tab outright welds "tab\tsep" into
    // "tabsep", a worse corruption than the character it removed.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000E-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
    // Horizontal whitespace only — plain `\s` would eat the newlines just kept.
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return truncate(collapsed, maxLength);
}

/** Same, flattened to a single line — for anything rendered inside a row. */
export function plainLine(value: string | null | undefined, maxLength = 200): string {
  return truncate(plainText(value, Number.MAX_SAFE_INTEGER).replace(/\n+/g, " ").trim(), maxLength);
}

/**
 * Cut to `maxLength` *displayed* characters with an ellipsis.
 *
 * Counts by code point, not UTF-16 unit: a plain `slice` through the middle of
 * an emoji leaves a lone surrogate, which renders as a replacement glyph — the
 * truncation would be visibly corrupting the text it was meant to tidy. The
 * `Math.max` guards a `maxLength` of 0, where `maxLength - 1` would otherwise
 * become a *negative* slice index and return a string longer than the cap.
 */
function truncate(value: string, maxLength: number): string {
  // UTF-16 length is never below the code-point count, so this short-circuits
  // the common "nothing to cut" case — including plainLine's uncapped inner
  // call — without materialising a character array.
  if (value.length <= maxLength) return value;
  const chars = Array.from(value);
  if (chars.length <= maxLength) return value;
  return `${chars.slice(0, Math.max(0, maxLength - 1)).join("")}\u2026`;
}
