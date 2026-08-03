import { useEffect, useRef } from "react";
import { createBodyHighlighter, type BodyHighlighterInstance, type IExerciseData, MuscleType } from "body-highlighter";

/**
 * Segmental analysis panel — the custom `body-highlighter` figure in the
 * centre, flanked by per-segment stat labels (left arm / torso / left leg on
 * the left, right arm / right leg on the right), exactly like a bio-impedance
 * body-composition report.
 *
 * The figure is a two-tone anatomical render (core muscles vs legs); the
 * measured numbers and their status colours live in the flanking labels, so a
 * single `accent` token drives the whole panel. Purely presentational.
 */

export interface SegmentStat {
  /** Measured value for the segment (kg). */
  value: number;
  /** Standard-comparison ratio in percent (100% = right at standard). */
  ratioPct: number;
  unit?: string;
}

export interface SegmentalData {
  leftArm: SegmentStat;
  rightArm: SegmentStat;
  torso: SegmentStat;
  leftLeg: SegmentStat;
  rightLeg: SegmentStat;
}

const CORE_MUSCLES = [
  MuscleType.CHEST, MuscleType.ABS, MuscleType.OBLIQUES, MuscleType.UPPER_BACK,
  MuscleType.LOWER_BACK, MuscleType.TRAPEZIUS, MuscleType.BICEPS, MuscleType.TRICEPS,
  MuscleType.FOREARM, MuscleType.FRONT_DELTOIDS, MuscleType.BACK_DELTOIDS,
];
const LEG_MUSCLES = [
  MuscleType.QUADRICEPS, MuscleType.HAMSTRING, MuscleType.CALVES,
  MuscleType.GLUTEAL, MuscleType.ABDUCTORS,
];

function ratioColor(ratioPct: number): string {
  if (ratioPct < 90) return "var(--warning)";
  if (ratioPct > 110) return "var(--danger)";
  return "var(--series-workout)";
}

function BodyFigure({ core, legs, width, height }: { core: string; legs: string; width: number; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inst = useRef<BodyHighlighterInstance | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const data: IExerciseData[] = [
      ...CORE_MUSCLES.map((m) => ({ name: m, muscles: [m], frequency: 1 })),
      ...LEG_MUSCLES.map((m) => ({ name: m, muscles: [m], frequency: 2 })),
    ];
    const instance = createBodyHighlighter({
      container: ref.current,
      type: "anterior",
      bodyColor: "var(--progress-bg)",
      highlightedColors: [core, legs],
      data,
    });
    inst.current = instance;
    return () => instance.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core, legs]);

  return <div ref={ref} style={{ width, height }} />;
}

function SegmentLabel({ title, stat, align }: { title: string; stat: SegmentStat; align: "left" | "right" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1, textAlign: align, alignItems: align === "left" ? "flex-start" : "flex-end" }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{title}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
        {stat.value}
        <span style={{ fontSize: 10, fontWeight: 500, color: "var(--text-muted)" }}> {stat.unit ?? "kg"}</span>
      </span>
      <span style={{ fontSize: 11, fontWeight: 600, color: ratioColor(stat.ratioPct) }}>
        {stat.ratioPct}% of standard
      </span>
    </div>
  );
}

export default function SegmentalBody({
  data, core = "var(--series-sleep)", legs = "var(--series-workout)",
}: {
  data: SegmentalData;
  core?: string;
  legs?: string;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", gap: 20 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <SegmentLabel title="Left arm" stat={data.leftArm} align="left" />
        <SegmentLabel title="Torso" stat={data.torso} align="left" />
        <SegmentLabel title="Left leg" stat={data.leftLeg} align="left" />
      </div>

      <BodyFigure core={core} legs={legs} width={140} height={280} />

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <SegmentLabel title="Right arm" stat={data.rightArm} align="right" />
        <SegmentLabel title="Right leg" stat={data.rightLeg} align="right" />
      </div>
    </div>
  );
}
