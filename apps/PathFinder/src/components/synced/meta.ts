import { Dumbbell, Footprints, Pill, Sunrise, UtensilsCrossed, type LucideIcon } from "lucide-react";
import type { SyncedKind } from "@nexus/core/protocol";

/**
 * How each Protocol kind looks on PathFinder's calendar. One entry per kind so
 * the Week grid, the all-day row, the Dashboard and the dialogs cannot drift.
 * Same light/dark pairing the other Week card kinds use.
 */
export const SYNCED_META: Record<SyncedKind, { icon: LucideIcon; card: string; text: string; ring: string }> = {
  workout: {
    icon: Dumbbell,
    card: "bg-orange-500/15 border-orange-400/50",
    text: "text-orange-700 dark:text-orange-300",
    ring: "border-orange-500 bg-orange-500",
  },
  run: {
    icon: Footprints,
    card: "bg-emerald-500/15 border-emerald-400/50",
    text: "text-emerald-700 dark:text-emerald-300",
    ring: "border-emerald-500 bg-emerald-500",
  },
  meal: {
    icon: UtensilsCrossed,
    card: "bg-amber-500/15 border-amber-400/50",
    text: "text-amber-700 dark:text-amber-300",
    ring: "border-amber-500 bg-amber-500",
  },
  supplements: {
    icon: Pill,
    card: "bg-sky-500/15 border-sky-400/50",
    text: "text-sky-700 dark:text-sky-300",
    ring: "border-sky-500 bg-sky-500",
  },
  routine: {
    icon: Sunrise,
    card: "bg-violet-500/15 border-violet-400/50",
    text: "text-violet-700 dark:text-violet-300",
    ring: "border-violet-500 bg-violet-500",
  },
};

/** Monday-first, matching Protocol's Monday = 0 weekday numbering. */
export const PROTOCOL_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
