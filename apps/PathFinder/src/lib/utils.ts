import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Priority, Urgency, TaskStage } from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function daysUntil(dateStr: string): number {
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - now.getTime()) / 86400000);
}

export function deadlineLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`;
  if (days === 0) return "Due today";
  if (days === 1) return "Tomorrow";
  return `${days}d left`;
}

/** "2026-08-24" -> "24 Aug". Compact enough for a dense breakdown row. */
export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export type DeadlineVariant = "destructive" | "warning" | "outline";
export function deadlineVariant(days: number): DeadlineVariant {
  if (days < 0) return "destructive";
  if (days <= 3) return "warning";
  return "outline";
}

// Canonical definition moved to components/task/taskVisual.ts (spec U3 Part
// B — the shared task-visual vocabulary). Re-exported here so every existing
// `import { PRIORITY_DOT } from "../lib/utils"` (or "./lib/utils") keeps
// resolving unchanged.
export { PRIORITY_DOT } from "../components/task/taskVisual";

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// ── The importance x urgency axes ────────────────────────────────────────────
//
// Importance keeps the established coloured dot. Urgency deliberately does NOT
// get its own hue ramp: two colour-coded axes sitting side by side in a dense
// list are indistinguishable to a colourblind reader and hard for anyone to
// decode at a glance. Urgency is encoded by *fill count* instead (three
// segments, 3/2/1 filled), so the two axes differ in form, not just colour.

export const URGENCY_LABEL: Record<Urgency, string> = {
  high: "Urgent",
  medium: "Soon",
  low: "Whenever",
};

/** How many of the meter's three segments are filled. */
export const URGENCY_LEVEL: Record<Urgency, number> = { high: 3, medium: 2, low: 1 };

export const STAGE_LABEL: Record<TaskStage, string> = {
  refine: "Refine",
  schedule: "Schedule",
  active: "Active",
  done: "Done",
};

/** One-line explanation of each stage, used as tooltips on the stage rail. */
export const STAGE_HINT: Record<TaskStage, string> = {
  refine: "Break it down, set importance, urgency and estimates.",
  schedule: "Specified — now commit calendar time to it.",
  active: "Scheduled and workable.",
  done: "Complete.",
};

export const STAGE_CLASSES: Record<TaskStage, string> = {
  refine: "bg-slate-500/10 text-slate-600 dark:text-slate-300 border-slate-400/30",
  schedule: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-400/30",
  active: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-400/30",
  done: "bg-primary/10 text-primary border-primary/30",
};

export const STAGE_ORDER: readonly TaskStage[] = ["refine", "schedule", "active", "done"] as const;

// Badge classes for assignment-type chips — indigo container uses these for type labels.
export const PRIORITY_BADGE_CLASSES: Record<string, string> = {
  high: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-400/30",
  medium: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-400/30",
  low: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-400/30",
};

// ── Calendar overlap layout ───────────────────────────────────────────────────
// Assigns side-by-side columns to simultaneously-overlapping timed events.
// Each item must supply startMin / endMin (minutes since midnight).
// Returns the same items augmented with { col, totalCols }.

export interface CalLayoutInput {
  startMin: number;
  endMin:   number;
}

export interface CalLayoutResult<T> {
  item:      T;
  col:       number;
  totalCols: number;
}

export function layoutCalItems<T extends CalLayoutInput>(items: T[]): CalLayoutResult<T>[] {
  if (items.length === 0) return [];

  // Sort by start time (ties: longer event first)
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const n = sorted.length;

  // Greedy column assignment — reuse a column as soon as its last event ends
  const colOf: number[]  = new Array(n).fill(-1);
  const colEnd: number[] = [];          // end-minute of the last item in each column

  for (let i = 0; i < n; i++) {
    let placed = false;
    for (let c = 0; c < colEnd.length; c++) {
      if (colEnd[c] <= sorted[i].startMin) {
        colOf[i]  = c;
        colEnd[c] = sorted[i].endMin;
        placed    = true;
        break;
      }
    }
    if (!placed) {
      colOf[i] = colEnd.length;
      colEnd.push(sorted[i].endMin);
    }
  }

  // Union-Find to group events that share the same overlap cluster
  const par = Array.from({ length: n }, (_, i) => i);
  function find(x: number): number {
    if (par[x] !== x) par[x] = find(par[x]);
    return par[x];
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sorted[j].startMin < sorted[i].endMin) union(i, j);
      else break; // sorted by start — no further j can overlap i
    }
  }
  function union(x: number, y: number) { par[find(x)] = find(y); }

  // Max column used per cluster → totalCols for that cluster
  const clusterMax = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    clusterMax.set(root, Math.max(clusterMax.get(root) ?? 0, colOf[i]));
  }

  return sorted.map((item, i) => ({
    item,
    col:       colOf[i],
    totalCols: (clusterMax.get(find(i)) ?? 0) + 1,
  }));
}
