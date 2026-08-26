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

import type { JobSubmissionAttempt } from "./types";
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
