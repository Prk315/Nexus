import { Brain, PersonStanding, Sparkles, Droplet, BookOpen, Footprints, Moon, NotebookPen, CircleDot, type LucideIcon } from "lucide-react";
import type { Habit, HabitCompletion } from "../../store/types";

/**
 * Orders habits the same way the Habits tab does: grouped by stack (each
 * stack's habits kept together, in the order the stack was first seen — not
 * globally interleaved by sort_order, since stacks don't reserve contiguous
 * sort_order ranges), each group internally sorted by sort_order, then
 * unstacked habits sorted by their own sort_order.
 */
export function groupHabitsByStack(habits: Habit[]): Habit[] {
  const groups = new Map<string, Habit[]>();
  const unstacked: Habit[] = [];
  for (const h of habits) {
    if (!h.stack_id) {
      unstacked.push(h);
      continue;
    }
    if (!groups.has(h.stack_id)) groups.set(h.stack_id, []);
    groups.get(h.stack_id)!.push(h);
  }
  for (const list of groups.values()) list.sort((a, b) => a.sort_order - b.sort_order);
  unstacked.sort((a, b) => a.sort_order - b.sort_order);
  return [...groups.values()].flat().concat(unstacked);
}

/** Share of habits completed on each date, for heatmap coloring. */
export function computeFractionByDate(completions: HabitCompletion[], totalHabits: number): Map<string, number> {
  const m = new Map<string, number>();
  if (totalHabits === 0) return m;
  const countByDate = new Map<string, number>();
  for (const c of completions) countByDate.set(c.date, (countByDate.get(c.date) ?? 0) + 1);
  for (const [date, count] of countByDate) m.set(date, Math.min(1, count / totalHabits));
  return m;
}

/** Infer a fitting icon from a habit's name — a light touch, not a picker UI. */
export function habitIcon(name: string): LucideIcon {
  const n = name.toLowerCase();
  if (/medit|mindful|breath/.test(n)) return Brain;
  if (/stretch|mobility|yoga/.test(n)) return PersonStanding;
  if (/face|skin|care/.test(n)) return Sparkles;
  if (/water|hydrat/.test(n)) return Droplet;
  if (/read/.test(n)) return BookOpen;
  if (/walk|run|step/.test(n)) return Footprints;
  if (/sleep/.test(n)) return Moon;
  if (/journal|write/.test(n)) return NotebookPen;
  return CircleDot;
}

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

/** GitHub-style weeks×7 grid, Monday-first, ending on `today`. */
export function buildHeatmapGrid(today: string, weeks: number): string[][] {
  const d = new Date(today + "T00:00:00");
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  const thisMonday = new Date(d);
  thisMonday.setDate(d.getDate() - dow);
  const firstMonday = new Date(thisMonday);
  firstMonday.setDate(thisMonday.getDate() - (weeks - 1) * 7);

  const grid: string[][] = [];
  for (let w = 0; w < weeks; w++) {
    const col: string[] = [];
    for (let day = 0; day < 7; day++) {
      const dt = new Date(firstMonday);
      dt.setDate(firstMonday.getDate() + w * 7 + day);
      col.push(
        `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`,
      );
    }
    grid.push(col);
  }
  return grid;
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function ConsistencyHeatmap({
  grid, today, fractionByDate, cellSize = 11,
}: {
  grid: string[][];
  today: string;
  fractionByDate: Map<string, number>;
  /** Cell edge length in px — the grid (labels, gaps, radius) scales with it. */
  cellSize?: number;
}) {
  let lastMonth = -1;
  const gap = Math.max(2, Math.round(cellSize * 0.27));
  const labelWidth = Math.max(16, Math.round(cellSize * 1.45));
  const fontSize = Math.max(9, Math.round(cellSize * 0.9));
  const radius = Math.max(2, Math.round(cellSize * 0.18));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap }}>
        <div style={{ width: labelWidth }} />
        {grid.map((col, i) => {
          const month = Number(col[0].slice(5, 7)) - 1;
          const showLabel = month !== lastMonth;
          if (showLabel) lastMonth = month;
          return (
            <div key={i} style={{ width: cellSize, fontSize, color: "var(--text-muted)", flexShrink: 0 }}>
              {showLabel ? MONTH_NAMES[month] : ""}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap }}>
        <div style={{ display: "flex", flexDirection: "column", gap, width: labelWidth, flexShrink: 0 }}>
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} style={{ width: cellSize, height: cellSize, fontSize: Math.max(9, fontSize - 1), color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
              {i % 2 === 1 ? label : ""}
            </div>
          ))}
        </div>
        {grid.map((col, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap }}>
            {col.map((date) => {
              const isFuture = date > today;
              const fraction = fractionByDate.get(date) ?? 0;
              return (
                <div
                  key={date}
                  title={isFuture ? undefined : `${date} — ${Math.round(fraction * 100)}%`}
                  style={{
                    width: cellSize,
                    height: cellSize,
                    borderRadius: radius,
                    visibility: isFuture ? "hidden" : "visible",
                    background: fraction > 0 ? "var(--accent)" : "var(--progress-bg)",
                    opacity: fraction > 0 ? 0.15 + fraction * 0.85 : 1,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
