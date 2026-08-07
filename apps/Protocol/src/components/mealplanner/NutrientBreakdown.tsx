import { NUTRIENT_META, NUTRIENT_GROUPS, type NutrientMeta } from "../../lib/nutrients";
import type { NutrientTotals } from "../../lib/mealNutrition";

function fmt(v: number): string {
  if (v <= 0) return "—";
  if (v >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

/**
 * Today's full nutrient breakdown — every macro sub-category, mineral and
 * vitamin the foods + taken supplements add up to. Makes the granular data you
 * enter actually visible (the donut/rings only cover the headline set).
 */
export default function NutrientBreakdown({ totals }: { totals: NutrientTotals }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>Today · full breakdown</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
        {NUTRIENT_GROUPS.map((group) => (
          <div key={group}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
              {group}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
              {NUTRIENT_META.filter((m) => m.group === group).map((m: NutrientMeta) => {
                const val = totals[m.key as keyof NutrientTotals] ?? 0;
                const dim = val <= 0;
                return (
                  <div
                    key={m.key}
                    style={{
                      display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
                      paddingLeft: m.sub ? 8 : 0,
                      borderLeft: m.sub ? "2px solid var(--border)" : "none",
                    }}
                  >
                    <span style={{ fontSize: 12, color: dim ? "var(--text-muted)" : (m.sub ? "var(--text-secondary)" : "var(--text)") }}>
                      {m.label}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: dim ? "var(--text-muted)" : "var(--text)", whiteSpace: "nowrap" }}>
                      {fmt(val)}{val > 0 ? ` ${m.unit}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
