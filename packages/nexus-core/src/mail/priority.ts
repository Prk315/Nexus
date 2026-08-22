/**
 * Pure ordering / bucketing / sanitising for the mail triage list. No React,
 * no Supabase, no Tauri — same discipline as `coverage.ts`, so every rule here
 * is testable in isolation (`priority.test.ts`) and the panel stays a dumb
 * renderer of whatever these functions decide.
 */

import type { MailMessage } from "./types";

// ── Priority scale ────────────────────────────────────────────────────────

export type PriorityBucket = "urgent" | "high" | "normal" | "low";

/** Most-urgent-first. The panel renders groups in exactly this order. */
export const PRIORITY_BUCKETS: readonly PriorityBucket[] = [
  "urgent",
  "high",
  "normal",
  "low",
] as const;

export const PRIORITY_MIN = 1;
export const PRIORITY_MAX = 5;

/**
 * Where an unranked message lands. Deliberately the **middle** of the scale,
 * not the bottom: a row n8n failed to score is not evidence that it is
 * unimportant, and sorting it silently to the end of a scrolling list is the
 * mail equivalent of failing toward "nothing is blocked".
 */
export const DEFAULT_PRIORITY = 3;

/**
 * Clamp whatever the row actually carries into 1–5. `priority` is an `integer`
 * column, but a null, a NaN, a float from a model that emitted `4.5`, or an
 * out-of-range 9 all have to produce a bucket rather than an exception.
 */
export function normalizePriority(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_PRIORITY;
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(value)));
}

export function priorityBucket(value: number | null | undefined): PriorityBucket {
  const p = normalizePriority(value);
  if (p >= 5) return "urgent";
  if (p === 4) return "high";
  if (p === 3) return "normal";
  return "low";
}

export const BUCKET_LABEL: Record<PriorityBucket, string> = {
  urgent: "Urgent",
  high: "High",
  normal: "Normal",
  low: "Low",
};

/**
 * Hex rather than Tailwind class names, for the same reason `ClockDropdown`
 * keeps a `COLOR_HEX` map: a dynamically-built `bg-${bucket}-500` is invisible
 * to Tailwind's scanner across the package boundary and renders as nothing.
 */
export const BUCKET_HEX: Record<PriorityBucket, string> = {
  urgent: "#ef4444", // red-500
  high: "#f97316", // orange-500
  normal: "#3b82f6", // blue-500
  low: "#64748b", // slate-500
};

// ── Triage status ─────────────────────────────────────────────────────────

/**
 * Statuses that mean "this no longer needs my attention". Compared
 * case-insensitively.
 *
 * An **unrecognised or missing** status counts as *pending*, not handled — the
 * list fails toward showing you a message rather than toward hiding one. If
 * n8n later invents a new terminal status, the worst outcome is a stale row
 * visible in the panel; the opposite default would silently swallow real mail.
 */
export const HANDLED_STATUSES: readonly string[] = [
  "archived",
  "done",
  "handled",
  "replied",
  "sent",
  "dismissed",
  "ignored",
];

export function isHandled(status: string | null | undefined): boolean {
  if (!status) return false;
  return HANDLED_STATUSES.includes(status.trim().toLowerCase());
}

// ── Ordering ──────────────────────────────────────────────────────────────

/**
 * `received_at` as epoch ms. An unparseable or missing timestamp yields 0, so
 * it sorts last under the descending comparison rather than becoming "now".
 */
export function receivedAtMs(message: MailMessage): number {
  if (!message.received_at) return 0;
  const t = Date.parse(message.received_at);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Priority desc, then recency desc, then `id` — the last key only exists to
 * make the order **total**, so two messages that tie on both real keys don't
 * swap places between renders and make the list visibly jitter.
 */
export function compareMail(a: MailMessage, b: MailMessage): number {
  const byPriority = normalizePriority(b.priority) - normalizePriority(a.priority);
  if (byPriority !== 0) return byPriority;
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
  /** Still needs attention, sorted by `compareMail`. */
  pending: MailMessage[];
  /** Already dealt with, sorted the same way. */
  handled: MailMessage[];
  /** Every row the loader returned — the number that distinguishes the two empty states. */
  total: number;
};

/**
 * Split a raw fetch into pending / handled.
 *
 * `total` is what lets the UI tell "n8n has never written a row" (total === 0)
 * apart from "synced, and everything is triaged" (total > 0, pending empty).
 * Collapsing those two would present a broken pipeline as an empty inbox —
 * the same mistake as seeding `blocking_state` with zeros.
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
  bucket: PriorityBucket;
  label: string;
  messages: MailMessage[];
};

/**
 * Group into priority buckets, most urgent first. Empty buckets are dropped —
 * a heading with nothing under it reads as a loading failure.
 */
export function groupByBucket(messages: readonly MailMessage[]): MailBucketGroup[] {
  const byBucket = new Map<PriorityBucket, MailMessage[]>();
  for (const m of sortMail(messages)) {
    const bucket = priorityBucket(m.priority);
    const list = byBucket.get(bucket);
    if (list) list.push(m);
    else byBucket.set(bucket, [m]);
  }
  return PRIORITY_BUCKETS.filter((b) => byBucket.has(b)).map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    messages: byBucket.get(bucket)!,
  }));
}

// ── Untrusted text ───────────────────────────────────────────────

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
 * truncation would be visibly corrupting text it was meant to tidy. The
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
