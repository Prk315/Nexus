import { useEffect, useMemo, useRef, useState } from "react";
import { createBodyHighlighter, type BodyHighlighterInstance, type IExerciseData } from "body-highlighter";
import {
  TRACKED_MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  computeMuscleStatus,
  recencyIntensity,
  type MuscleGroup,
  type MuscleStatus,
} from "../../lib/muscleMap";
import { isoDate } from "../../lib/uiHelpers";
import type { ExerciseSet } from "../../store/types";

const COLOR_STEPS = 8;

const HIGHLIGHTED_COLORS = Array.from({ length: COLOR_STEPS }, (_, i) => {
  const pct = Math.round(((i + 1) / COLOR_STEPS) * 100);
  return `color-mix(in srgb, var(--series-workout) ${pct}%, var(--progress-bg))`;
});

function frequencyFor(daysSince: number | null): number {
  if (daysSince == null) return 0;
  const intensity = recencyIntensity(daysSince);
  return Math.max(1, Math.round(intensity * (COLOR_STEPS - 1)) + 1);
}

function buildData(status: Record<MuscleGroup, MuscleStatus>): IExerciseData[] {
  const entries: IExerciseData[] = [];
  for (const group of TRACKED_MUSCLE_GROUPS) {
    const freq = frequencyFor(status[group].daysSince);
    if (freq > 0) entries.push({ name: group, muscles: [group], frequency: freq });
  }
  return entries;
}

function formatDaysSince(days: number | null): string {
  if (days == null) return "Never logged";
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return `${days} days ago`;
}

function Figure({
  type,
  data,
  onSelect,
}: {
  type: "anterior" | "posterior";
  data: IExerciseData[];
  onSelect: (group: MuscleGroup) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<BodyHighlighterInstance | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const instance = createBodyHighlighter({
      container: containerRef.current,
      type,
      bodyColor: "var(--progress-bg)",
      highlightedColors: HIGHLIGHTED_COLORS,
      data,
      onClick: ({ muscle }) => onSelect(muscle as MuscleGroup),
    });
    instanceRef.current = instance;
    return () => instance.destroy();
    // Recreate only when the view (front/back) changes; data updates flow
    // through the effect below via instance.update() instead of a remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);

  useEffect(() => {
    instanceRef.current?.update({ data });
  }, [data]);

  return <div ref={containerRef} style={{ width: 170, height: 320 }} />;
}

export default function MuscleMap({ sets }: { sets: ExerciseSet[] }) {
  const today = isoDate(new Date());
  const status = useMemo(() => computeMuscleStatus(sets, today), [sets, today]);
  const data = useMemo(() => buildData(status), [status]);

  const sortedByRecency = useMemo(
    () =>
      [...TRACKED_MUSCLE_GROUPS].sort((a, b) => {
        const da = status[a].daysSince;
        const db = status[b].daysSince;
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return da - db;
      }),
    [status],
  );

  const [active, setActive] = useState<MuscleGroup | null>(null);
  const shown = active ?? sortedByRecency[0] ?? null;
  const shownStatus = shown ? status[shown] : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 24, justifyContent: "center", flexWrap: "wrap" }}>
        <div style={{ textAlign: "center" }}>
          <Figure type="anterior" data={data} onSelect={setActive} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Front</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <Figure type="posterior" data={data} onSelect={setActive} />
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
