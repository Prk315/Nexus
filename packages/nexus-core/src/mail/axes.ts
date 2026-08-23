/**
 * The importance × urgency pair, rendered the way PathFinder already renders
 * it. Pure — no React, no Supabase.
 *
 * # Why the two axes look different rather than being two colour ramps
 *
 * Copied verbatim from the reasoning in `apps/PathFinder/src/lib/utils.ts`:
 * two colour-coded axes side by side in a dense list are indistinguishable to
 * a colourblind reader and hard for anyone to decode at a glance. So
 * **importance is a coloured dot** and **urgency is a fill-count meter** —
 * three segments, 3/2/1 lit, one hue. The axes differ in *form*, not just
 * colour. A mail row shows the same dot-then-meter pair in the same order as
 * `TaskRow`, so someone who uses both apps reads it without relearning.
 *
 * The values, labels and level counts below are mirrors of PathFinder's. They
 * are duplicated rather than imported because nexus-core cannot depend on an
 * app — but they must not drift, so they are kept in one block with the source
 * file named.
 *
 * # The one place this deliberately diverges
 *
 * PathFinder's axes are `not null default 'medium'`; mail's are nullable, and
 * `null` means "not determined", never "medium". `normalizeAxis` returns
 * `MailAxis | null` and invents nothing, and every renderer omits the glyph
 * entirely for a null — exactly as `TaskRow` omits the urgency meter for a
 * sparse task rather than drawing it at 2/3. Rendering "medium" for an unknown
 * is the single mistake this module exists to prevent.
 */

import type { MailAxis } from "./types";

/** High first — the order PathFinder's matrix rows and columns use. */
export const AXIS_LEVELS: readonly MailAxis[] = ["high", "medium", "low"] as const;

/**
 * Coerce unknown input to a level, or `null`.
 *
 * Anything that is not one of the three literals — including `"Medium"`,
 * `""`, a number, or an axis a future migration adds — becomes `null`, i.e.
 * "not determined". Guessing would be worse than admitting ignorance: the
 * whole point of the pair is that the user can trust what it says.
 */
export function normalizeAxis(value: string | null | undefined): MailAxis | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (AXIS_LEVELS as readonly string[]).includes(v) ? (v as MailAxis) : null;
}

/** Mirrors PathFinder `PRIORITY_LABEL` (`lib/utils.ts`). */
export const IMPORTANCE_LABEL: Record<MailAxis, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Mirrors PathFinder `URGENCY_LABEL` — deliberately different words per axis. */
export const URGENCY_LABEL: Record<MailAxis, string> = {
  high: "Urgent",
  medium: "Soon",
  low: "Whenever",
};

/**
 * Mirrors PathFinder `PRIORITY_DOT` (`lib/utils.ts`). Tailwind classes rather
 * than hex, because unlike the score buckets these are fixed strings the
 * scanner can see.
 */
export const IMPORTANCE_DOT: Record<MailAxis, string> = {
  high: "bg-red-500",
  medium: "bg-yellow-400",
  low: "bg-muted-foreground/40",
};

/** Mirrors PathFinder `URGENCY_LEVEL` — how many of the three bars are lit. */
export const URGENCY_FILL: Record<MailAxis, number> = { high: 3, medium: 2, low: 1 };

/**
 * Mirrors PathFinder `cellAdvice` (`lib/taskTree.ts`) exactly, including the
 * empty string for every non-corner cell. Returns "" when either axis is
 * undetermined: advice derived from a value the model never produced would be
 * an invention presented as a recommendation.
 */
export function cellAdvice(
  importance: MailAxis | null,
  urgency: MailAxis | null,
): string {
  if (importance === null || urgency === null) return "";
  if (importance === "high" && urgency === "high") return "Do now";
  if (importance === "high" && urgency === "low") return "Schedule";
  if (importance === "low" && urgency === "high") return "Do quickly";
  if (importance === "low" && urgency === "low") return "Drop or defer";
  return "";
}

/**
 * The tooltip for the pair, in PathFinder's phrasing
 * (`"High importance · Urgent — Do now"`).
 *
 * A missing axis is named as missing rather than skipped silently, so hovering
 * always answers "what does this row actually claim?".
 */
export function axisSummary(
  importance: MailAxis | null,
  urgency: MailAxis | null,
): string {
  const imp = importance ? `${IMPORTANCE_LABEL[importance]} importance` : "Importance not set";
  const urg = urgency ? URGENCY_LABEL[urgency] : "urgency not set";
  const advice = cellAdvice(importance, urgency);
  return `${imp} · ${urg}${advice ? ` — ${advice}` : ""}`;
}

/**
 * Is this message placeable on the 3×3 matrix at all?
 *
 * Both axes required. A message with one axis is not "on the matrix with a
 * default for the other" — it is a message the pipeline only half-decided, and
 * the UI says so rather than filling the gap.
 */
export function isPlaced(
  importance: MailAxis | null,
  urgency: MailAxis | null,
): boolean {
  return importance !== null && urgency !== null;
}

/**
 * How much of the verdict exists, for sorting and for the "needs a human"
 * signal: 0 = neither axis, 1 = half-decided, 2 = fully placed.
 */
export function axisCompleteness(
  importance: MailAxis | null,
  urgency: MailAxis | null,
): 0 | 1 | 2 {
  return ((importance !== null ? 1 : 0) + (urgency !== null ? 1 : 0)) as 0 | 1 | 2;
}
