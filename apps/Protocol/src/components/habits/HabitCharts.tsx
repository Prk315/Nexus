import { Brain, PersonStanding, Sparkles, Droplet, BookOpen, Footprints, Moon, NotebookPen, CircleDot, type LucideIcon } from "lucide-react";

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
  grid, today, fractionByDate,
}: {
  grid: string[][];
  today: string;
  fractionByDate: Map<string, number>;
}) {
  let lastMonth = -1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 3 }}>
        <div style={{ width: 16 }} />
        {grid.map((col, i) => {
          const month = Number(col[0].slice(5, 7)) - 1;
          const showLabel = month !== lastMonth;
          if (showLabel) lastMonth = month;
          return (
            <div key={i} style={{ width: 11, fontSize: 10, color: "var(--text-muted)", flexShrink: 0 }}>
              {showLabel ? MONTH_NAMES[month] : ""}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 3 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 3, width: 16, flexShrink: 0 }}>
          {WEEKDAY_LABELS.map((label, i) => (
            <div key={i} style={{ width: 11, height: 11, fontSize: 9, color: "var(--text-muted)", display: "flex", alignItems: "center" }}>
              {i % 2 === 1 ? label : ""}
            </div>
          ))}
        </div>
        {grid.map((col, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {col.map((date) => {
              const isFuture = date > today;
              const fraction = fractionByDate.get(date) ?? 0;
              return (
                <div
                  key={date}
                  title={isFuture ? undefined : `${date} — ${Math.round(fraction * 100)}%`}
                  style={{
                    width: 11,
                    height: 11,
                    borderRadius: 2,
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
