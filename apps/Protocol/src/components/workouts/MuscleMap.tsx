import { useMemo, useState } from "react";
import {
  ALL_MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  computeMuscleStatus,
  recencyIntensity,
  type MuscleGroup,
  type MuscleStatus,
} from "../../lib/muscleMap";
import { isoDate } from "../../lib/uiHelpers";
import type { ExerciseSet } from "../../store/types";

interface Region {
  group: MuscleGroup;
  shape: "rect" | "ellipse";
  x: number;
  y: number;
  w: number;
  h: number;
  rx: number;
}

// Simplified geometric silhouettes, viewBox 0 0 200 340. Coordinates are
// hand-placed approximations, not anatomically precise — the goal is a
// readable "where am I sore" map, not a medical diagram.
const FRONT_REGIONS: Region[] = [
  { group: "shoulders", shape: "ellipse", x: 60, y: 72, w: 26, h: 18, rx: 13 },
  { group: "shoulders", shape: "ellipse", x: 140, y: 72, w: 26, h: 18, rx: 13 },
  { group: "chest", shape: "rect", x: 70, y: 64, w: 60, h: 46, rx: 10 },
  { group: "biceps", shape: "rect", x: 38, y: 76, w: 18, h: 54, rx: 9 },
  { group: "biceps", shape: "rect", x: 144, y: 76, w: 18, h: 54, rx: 9 },
  { group: "forearms", shape: "rect", x: 34, y: 132, w: 16, h: 50, rx: 8 },
  { group: "forearms", shape: "rect", x: 150, y: 132, w: 16, h: 50, rx: 8 },
  { group: "abs", shape: "rect", x: 78, y: 112, w: 44, h: 46, rx: 8 },
  { group: "obliques", shape: "rect", x: 62, y: 116, w: 14, h: 42, rx: 6 },
  { group: "obliques", shape: "rect", x: 124, y: 116, w: 14, h: 42, rx: 6 },
  { group: "quads", shape: "rect", x: 72, y: 162, w: 26, h: 80, rx: 10 },
  { group: "quads", shape: "rect", x: 102, y: 162, w: 26, h: 80, rx: 10 },
  { group: "calves", shape: "rect", x: 74, y: 246, w: 22, h: 60, rx: 8 },
  { group: "calves", shape: "rect", x: 104, y: 246, w: 22, h: 60, rx: 8 },
];

const BACK_REGIONS: Region[] = [
  { group: "traps", shape: "rect", x: 78, y: 56, w: 44, h: 24, rx: 8 },
  { group: "shoulders", shape: "ellipse", x: 60, y: 72, w: 26, h: 18, rx: 13 },
  { group: "shoulders", shape: "ellipse", x: 140, y: 72, w: 26, h: 18, rx: 13 },
  { group: "back", shape: "rect", x: 68, y: 78, w: 64, h: 78, rx: 12 },
  { group: "triceps", shape: "rect", x: 38, y: 76, w: 18, h: 54, rx: 9 },
  { group: "triceps", shape: "rect", x: 144, y: 76, w: 18, h: 54, rx: 9 },
  { group: "forearms", shape: "rect", x: 34, y: 132, w: 16, h: 50, rx: 8 },
  { group: "forearms", shape: "rect", x: 150, y: 132, w: 16, h: 50, rx: 8 },
  { group: "glutes", shape: "rect", x: 74, y: 160, w: 52, h: 32, rx: 12 },
  { group: "hamstrings", shape: "rect", x: 72, y: 194, w: 26, h: 54, rx: 10 },
  { group: "hamstrings", shape: "rect", x: 102, y: 194, w: 26, h: 54, rx: 10 },
  { group: "calves", shape: "rect", x: 74, y: 250, w: 22, h: 58, rx: 8 },
  { group: "calves", shape: "rect", x: 104, y: 250, w: 22, h: 58, rx: 8 },
];

const OUTLINE = (
  <>
    <circle cx="100" cy="32" r="18" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
    <rect x="90" y="46" width="20" height="14" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="2" />
    <rect x="66" y="298" width="24" height="14" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
    <rect x="110" y="298" width="24" height="14" rx="4" fill="var(--surface)" stroke="var(--border)" strokeWidth="1.5" />
  </>
);

function Figure({
  regions,
  status,
  active,
  onHover,
}: {
  regions: Region[];
  status: Record<MuscleGroup, MuscleStatus>;
  active: MuscleGroup | null;
  onHover: (group: MuscleGroup | null) => void;
}) {
  return (
    <svg viewBox="0 0 200 320" width="100%" height="auto" style={{ maxWidth: 200 }}>
      {OUTLINE}
      {regions.map((r, i) => {
        const intensity = recencyIntensity(status[r.group].daysSince);
        const isActive = active === r.group;
        const fillOpacity = Math.max(intensity, 0.1);
        const Shape = r.shape === "ellipse" ? "ellipse" : "rect";
        const shapeProps =
          r.shape === "ellipse"
            ? { cx: r.x, cy: r.y, rx: r.w / 2, ry: r.h / 2 }
            : { x: r.x, y: r.y, width: r.w, height: r.h, rx: r.rx };
        return (
          <Shape
            // eslint-disable-next-line react/no-array-index-key
            key={`${r.group}-${i}`}
            {...shapeProps}
            fill="var(--series-workout)"
            fillOpacity={fillOpacity}
            stroke={isActive ? "var(--series-workout)" : "var(--border)"}
            strokeWidth={isActive ? 2 : 1}
            style={{ cursor: "pointer", transition: "fill-opacity 120ms, stroke 120ms" }}
            onMouseEnter={() => onHover(r.group)}
            onMouseLeave={() => onHover(null)}
            onClick={() => onHover(r.group)}
          />
        );
      })}
    </svg>
  );
}

function formatDaysSince(days: number | null): string {
  if (days == null) return "Never logged";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

export default function MuscleMap({ sets }: { sets: ExerciseSet[] }) {
  const [active, setActive] = useState<MuscleGroup | null>(null);
  const today = isoDate(new Date());

  const status = useMemo(() => computeMuscleStatus(sets, today), [sets, today]);

  const sortedByRecency = useMemo(
    () =>
      [...ALL_MUSCLE_GROUPS].sort((a, b) => {
        const da = status[a].daysSince;
        const db = status[b].daysSince;
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      }),
    [status],
  );

  const shown = active ?? sortedByRecency[0] ?? null;
  const shownStatus = shown ? status[shown] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <Figure regions={FRONT_REGIONS} status={status} active={active} onHover={setActive} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Front</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <Figure regions={BACK_REGIONS} status={status} active={active} onHover={setActive} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Back</div>
        </div>
      </div>

      {shown && shownStatus && (
        <div
          style={{
            display: "flex", alignItems: "baseline", gap: 10, justifyContent: "center",
            padding: "8px 16px", background: "var(--bg)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text)" }}>{MUSCLE_GROUP_LABELS[shown]}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDaysSince(shownStatus.daysSince)}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· {shownStatus.sets7d} sets (7d)</span>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 8 }}>
        {sortedByRecency.map((group) => {
          const s = status[group];
          const intensity = recencyIntensity(s.daysSince);
          return (
            <button
              key={group}
              onClick={() => setActive(group)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                background: active === group ? "var(--series-workout-track)" : "var(--bg)",
                border: `1px solid ${active === group ? "var(--series-workout)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "left",
              }}
            >
              <span
                style={{
                  width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                  background: "var(--series-workout)", opacity: Math.max(intensity, 0.12),
                }}
              />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{MUSCLE_GROUP_LABELS[group]}</span>
                <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{formatDaysSince(s.daysSince)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
