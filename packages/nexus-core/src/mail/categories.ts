/**
 * Resolving a message's `category` name against the user's `mail_categories`
 * rows. Pure — no React, no Supabase.
 *
 * `mail_messages.category` is `text` with **no foreign key**, matched by name,
 * exactly like `pf_cal_blocks.category`. An FK would block ad-hoc categories
 * and turn every rename into a migration; the cost is that a rename orphans
 * every message filed under the old name, so a name with no matching row is a
 * normal state that has to render, not an impossible one.
 */

import type { MailCategory } from "./types";

/**
 * A category ready to render: either resolved from a row, or a stand-in for a
 * name nothing matched.
 */
export type ResolvedCategory = {
  name: string;
  /** Hex, because a `bg-${color}-500` built at runtime is invisible to the Tailwind scanner. */
  hex: string;
  emoji: string;
  /**
   * How the *name* resolved. `unknown` means the message carries a category
   * name with no matching row — a renamed or deleted category, or one a rule
   * wrote that was never created.
   */
  resolution: "matched" | "disabled" | "unknown";
  /**
   * How the *colour* resolved, kept separate from `hex` on purpose.
   *
   * The obvious design — fall back to a distinctive colour — cannot work here,
   * because every distinctive colour is also a colour a user may legitimately
   * have chosen. Falling back to amber makes a broken category indistinguishable
   * from a deliberately amber one, which is precisely the Week view's teal
   * problem. So the signal does not live in the hue at all: the hex degrades
   * quietly to slate, and this field lets the renderer mark the chip by *form*
   * (a dashed ring) instead — the same "differ in form, not just colour"
   * discipline the two axes use.
   */
  colorResolution: "ok" | "unset" | "unrecognized";
};

/**
 * PathFinder `BLOCK_COLORS` key → hex. Same map, same reason, as
 * `ClockDropdown`'s `COLOR_HEX`: a class name assembled at runtime never
 * survives Tailwind's scan across the package boundary.
 */
const COLOR_HEX: Record<string, string> = {
  blue: "#3b82f6", indigo: "#6366f1", violet: "#8b5cf6", purple: "#a855f7",
  pink: "#ec4899", rose: "#f43f5e", red: "#ef4444", orange: "#f97316",
  amber: "#f59e0b", yellow: "#eab308", green: "#22c55e", emerald: "#10b981",
  teal: "#14b8a6", cyan: "#06b6d4", sky: "#0ea5e9", slate: "#64748b",
};

/**
 * The neutral hex for a category whose colour is missing or unrecognised.
 *
 * Deliberately *not* a distinctive "error" colour. Every distinctive colour is
 * also one a user may have picked, so signalling breakage through hue makes a
 * broken category look like a deliberate choice — the Week view's teal problem.
 * `colorResolution` carries the signal instead, and the chip marks itself by
 * form.
 */
const HEX_NEUTRAL = "#64748b"; // slate
/**
 * Violet, matching the `untriaged` score bucket. This one *is* safe to encode
 * in hue: it applies to a name with no row at all, so there is no user-chosen
 * colour it could be confused with.
 */
const HEX_UNKNOWN_CATEGORY = "#8b5cf6";

function resolveColor(
  color: string | null | undefined,
): { hex: string; colorResolution: ResolvedCategory["colorResolution"] } {
  if (!color) return { hex: HEX_NEUTRAL, colorResolution: "unset" };
  const hex = COLOR_HEX[color];
  return hex
    ? { hex, colorResolution: "ok" }
    : { hex: HEX_NEUTRAL, colorResolution: "unrecognized" };
}

/**
 * Index categories by name for lookup. Case-insensitive, because the name is
 * the join key and `Invoices` vs `invoices` would otherwise silently orphan a
 * message the user believes is filed.
 */
export function indexCategories(
  categories: readonly MailCategory[],
): Map<string, MailCategory> {
  const byName = new Map<string, MailCategory>();
  for (const c of categories) byName.set(c.name.trim().toLowerCase(), c);
  return byName;
}

/**
 * Resolve one message's category name.
 *
 * Returns `null` only for "no category at all" — which is a different thing
 * from "a category we can't find", and the caller renders them differently.
 *
 * A **disabled** category still resolves and still renders: disabling hides it
 * from pickers going forward, it does not retroactively un-file mail. Hiding
 * the chip would make the message look uncategorised and invite someone to
 * re-file it under a second name.
 */
export function resolveCategory(
  name: string | null | undefined,
  byName: Map<string, MailCategory>,
): ResolvedCategory | null {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  const row = byName.get(trimmed.toLowerCase());
  if (!row) {
    return {
      name: trimmed,
      hex: HEX_UNKNOWN_CATEGORY,
      emoji: "",
      resolution: "unknown",
      colorResolution: "ok",
    };
  }
  return {
    name: row.name,
    emoji: row.emoji ?? "",
    resolution: row.enabled ? "matched" : "disabled",
    ...resolveColor(row.color),
  };
}

/**
 * The categories a picker should offer: enabled only, in `sort` order.
 *
 * Deliberately **not** used to filter what renders on a message — see
 * `resolveCategory`. Offering a disabled category would undo the point of
 * disabling it; hiding an already-applied one would lose information.
 */
export function pickableCategories(
  categories: readonly MailCategory[],
): MailCategory[] {
  return categories
    .filter((c) => c.enabled)
    .slice()
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}
