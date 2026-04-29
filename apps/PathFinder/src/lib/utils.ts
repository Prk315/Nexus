import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Priority } from "../types";

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

export type DeadlineVariant = "destructive" | "warning" | "outline";
export function deadlineVariant(days: number): DeadlineVariant {
  if (days < 0) return "destructive";
  if (days <= 3) return "warning";
  return "outline";
}

export const PRIORITY_DOT: Record<Priority, string> = {
  high: "bg-red-500",
  medium: "bg-yellow-400",
  low: "bg-muted-foreground/40",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

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
