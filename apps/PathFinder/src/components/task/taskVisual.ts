// The shared task-visual vocabulary (spec U3 Part B).
//
// One place that decides what a task's priority, done state and stage look
// like, so a task reads the same way everywhere it appears — a Dashboard
// row, a Week all-day chip, a month-grid pill. The point is NOT pixel-
// identical surfaces (a chip and a row are different shapes) but the same
// ENCODINGS: priority is always this hue set, done is always strike +
// emerald, a stage badge is always these classes. Before this file, three
// components (`TodoList`'s `PRIORITY_BAR`, `TimeColumn`'s `TaskPopupChip`
// chip/check maps, `MonthView`'s matching pair) each hand-rolled their own
// copy of the same red/amber/blue-by-priority literal, and they had already
// drifted (different opacities, no shared "done" rule).

import type { Priority } from "../../types";

// ── Priority ──────────────────────────────────────────────────────────────

/** The dot used anywhere a task's importance needs one glyph of colour
 *  (`PriorityDot`, `NowPanel` rows). Canonical home for what used to be
 *  `lib/utils.ts`'s `PRIORITY_DOT` — that file re-exports this one so every
 *  existing `import { PRIORITY_DOT } from "../lib/utils"` keeps resolving. */
export const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-red-500",
  medium: "bg-yellow-400",
  low: "bg-muted-foreground/40",
};

/** Left accent bar — scannable down a column in a way a dot isn't
 *  (Dashboard's `DashTaskRow`). */
export const PRIORITY_BAR: Record<Priority, string> = {
  high: "bg-rose-500",
  medium: "bg-amber-400",
  low: "bg-slate-400/50",
};

/** Chip background + border, for a task rendered as a small pill (Week's
 *  all-day `TaskPopupChip`, `MonthView`'s task pills). */
export const PRIORITY_CHIP_BG: Record<Priority, string> = {
  high: "bg-red-500/10 border-red-400/40",
  medium: "bg-amber-500/10 border-amber-400/40",
  low: "bg-blue-500/10 border-blue-400/40",
};

/** Unfilled checkbox border (+ hover fill), same hue set, for the same chip
 *  surfaces — and for `RightPanel`'s plain checkbox-only task rows. */
export const PRIORITY_CHIP_CHECK: Record<Priority, string> = {
  high: "border-red-400 hover:bg-red-400/20",
  medium: "border-amber-400 hover:bg-amber-400/20",
  low: "border-blue-400 hover:bg-blue-400/20",
};

/** Plain text colour for a priority label (Week's popup card). */
export const PRIORITY_TEXT: Record<Priority, string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-blue-500",
};

// ── Done state ───────────────────────────────────────────────────────────
//
// Every done task strikes its own title and turns emerald — never any other
// hue — so "done" reads identically on a dashboard row, a chip and a pill.

export const DONE_TEXT_CLASSES = "line-through text-muted-foreground";
export const DONE_CHIP_BG = "bg-emerald-500/15 border-emerald-400/40";
export const DONE_CHIP_CHECK = "bg-emerald-500 border-emerald-500";

/** Title text classes for a task's own title: emerald+strike once done,
 *  plain foreground otherwise. Priority never touches title colour. */
export function taskTitleClasses(done: boolean): string {
  return done ? DONE_TEXT_CLASSES : "text-foreground";
}

/** Chip bg+border for a task pill: emerald once done, else its priority hue. */
export function chipBgClasses(priority: Priority, done: boolean): string {
  return done ? DONE_CHIP_BG : (PRIORITY_CHIP_BG[priority] ?? PRIORITY_CHIP_BG.low);
}

/** Checkbox classes for the same chip surfaces. */
export function chipCheckClasses(priority: Priority, done: boolean): string {
  return done ? DONE_CHIP_CHECK : (PRIORITY_CHIP_CHECK[priority] ?? PRIORITY_CHIP_CHECK.low);
}

// ── Stage badges ─────────────────────────────────────────────────────────
//
// Deliberately NOT re-defined or re-exported here. `STAGE_LABEL`/
// `STAGE_CLASSES` already live in exactly one place (`lib/utils.ts`) and are
// shared correctly today by `TimeColumn`, `TaskBoard` and `TaskPlanner` —
// moving them here would mean either duplicating them (the bug this file
// exists to prevent) or importing `lib/utils.ts` from here while it
// re-exports `PRIORITY_DOT` from here, a circular module edge for no
// behavioural gain. Task-language consumers keep reaching `lib/utils.ts`
// for stage classes; this file owns priority/done, the two axes that were
// actually duplicated.
