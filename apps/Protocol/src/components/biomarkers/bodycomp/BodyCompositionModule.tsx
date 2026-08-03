import { PersonStanding } from "lucide-react";
import RangeBar from "./RangeBar";
import DonutRing from "./DonutRing";
import BodyTypeGrid from "./BodyTypeGrid";
import SegmentalBody from "./SegmentalBody";
import { TrendChart } from "../BiomarkerCharts";
import { SAMPLE, type BodyCompositionData, type CompositionEntry } from "./data";

/**
 * Body-composition report — the bio-impedance ("smart scale") read-out, laid
 * out to match the reference sheet but in Protocol's own tokens/cards. Fully
 * presentational: pass a `BodyCompositionData` via `data`, else it renders
 * `SAMPLE` so the layout is reviewable while the data layer is wired.
 */

const MODULE_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "24px 28px",
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

function Section({ title, children, span = false }: { title: string; children: React.ReactNode; span?: boolean }) {
  return (
    <div
      style={{
        gridColumn: span ? "1 / -1" : "auto",
        background: "var(--bg)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{title}</span>
      {children}
    </div>
  );
}

function CompositionRow({ e }: { e: CompositionEntry }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "12px 1fr auto", alignItems: "center", gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: e.color }} />
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}>{e.label}</span>
      <span style={{ fontSize: 12, color: "var(--text)" }}>
        <span style={{ fontWeight: 700 }}>{e.value}</span>
        <span style={{ color: "var(--text-muted)" }}> {e.unit} · {e.low}–{e.high}</span>
      </span>
    </div>
  );
}

export default function BodyCompositionModule({ data = SAMPLE }: { data?: BodyCompositionData }) {
  const weightPct = ((data.weightKg - data.weightLow) / (data.weightHigh - data.weightLow || 1)) * 100;
  const waterPct = ((data.cellWater.totalKg - data.cellWater.totalLow) / (data.cellWater.totalHigh - data.cellWater.totalLow || 1)) * 100;

  return (
    <div style={MODULE_STYLE}>
      {/* header strip */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-tint)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", flexShrink: 0 }}>
            <PersonStanding size={18} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Body Composition</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Bio-impedance analysis — segmental fat, muscle & water</span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <span style={{ fontSize: 34, fontWeight: 800, color: "var(--accent)", lineHeight: 1 }}>{data.score}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-muted)" }}>{data.scoreLabel}</span>
        </div>
      </div>

      {/* composition + weight donut */}
      <Section title="Overview">
        <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 260 }}>
            {data.composition.map((e) => <CompositionRow key={e.label} e={e} />)}
          </div>
          <DonutRing
            value={`${data.weightKg}`}
            unit="kg"
            caption={`Weight · ${data.weightLow}–${data.weightHigh}`}
            pct={weightPct}
            color="var(--accent)"
          />
        </div>
      </Section>

      {/* sub-section grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
        <Section title="Full physical condition">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.physical.map((s) => <RangeBar key={s.label} stat={s} />)}
          </div>
        </Section>

        <Section title="Bones & joints">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.bones.map((s) => <RangeBar key={s.label} stat={s} />)}
          </div>
        </Section>

        <Section title="Fat analysis">
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {data.fat.map((s) => <RangeBar key={s.label} stat={s} />)}
          </div>
        </Section>

        <Section title="Body cell water">
          <div style={{ display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, flex: 1, minWidth: 200 }}>
              <CompositionRow e={{ label: "Extracellular water", value: data.cellWater.extracellularKg, low: 15.2, high: 18.6, unit: "kg", color: "var(--series-sleep)" }} />
              <CompositionRow e={{ label: "Intracellular water", value: data.cellWater.intracellularKg, low: 24.8, high: 30.4, unit: "kg", color: "var(--series-workout)" }} />
            </div>
            <DonutRing
              value={`${data.cellWater.totalKg}`}
              unit="kg"
              caption={`Total water · ${data.cellWater.totalLow}–${data.cellWater.totalHigh}`}
              pct={waterPct}
              color="var(--series-sleep)"
              size={104}
            />
          </div>
        </Section>

        <Section title="Physical condition advice">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px 20px" }}>
            {data.advice.map((a) => (
              <div key={a.label} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                <span style={{ color: "var(--text-muted)" }}>{a.label}</span>
                <span style={{ fontWeight: 700, color: "var(--text)" }}>{a.value}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Body type analysis">
          <BodyTypeGrid fat={data.bodyType.fat} muscle={data.bodyType.muscle} />
        </Section>
      </div>

      {/* segmental analyses — the custom body illustration */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 16 }}>
        <Section title="Segmental fat analysis">
          <SegmentalBody data={data.segmentalFat} core="var(--series-nutrition)" legs="var(--series-nutrition)" />
        </Section>
        <Section title="Segmental muscle analysis">
          <SegmentalBody data={data.segmentalMuscle} core="var(--series-sleep)" legs="var(--series-workout)" />
        </Section>
      </div>

      {/* composition history */}
      <Section title="Composition history" span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 20 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Weight (kg)</div>
            <TrendChart data={data.history.map((h) => ({ date: h.date, value: h.weightKg }))} color="var(--accent)" gradientId="bcWeight" height={130} valueSuffix=" kg" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Skeletal muscle (kg)</div>
            <TrendChart data={data.history.map((h) => ({ date: h.date, value: h.skeletalMuscleKg }))} color="var(--series-workout)" gradientId="bcMuscle" height={130} valueSuffix=" kg" />
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Body fat (%)</div>
            <TrendChart data={data.history.map((h) => ({ date: h.date, value: h.fatPct }))} color="var(--series-nutrition)" gradientId="bcFat" height={130} valueSuffix=" %" />
          </div>
        </div>
      </Section>
    </div>
  );
}
