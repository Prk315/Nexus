import { NUTRIENT_META, NUTRIENT_GROUPS, type NutrientMeta } from "../../lib/nutrients";
import type { NutrientTotals } from "../../lib/mealNutrition";

function fmt(v: number): string {
  if (v <= 0) return "—";
  if (v >= 100) return String(Math.round(v));
  return String(Math.round(v * 10) / 10);
}

/**
 * Today's nutrient breakdown — every nutrient the foods + taken supplements add
 * up to, grouped. Only nutrients with a value show (and only groups that have
 * one), so the panel stays tidy however many nutrient types exist.
 */
export default function NutrientBreakdown({ totals }: { totals: NutrientTotals }) {
  const groups = NUTRIENT_GROUPS
    .map((group) => ({
      group,
      items: NUTRIENT_META.filter(
        (m: NutrientMeta) => m.group === group && (totals[m.key as keyof NutrientTotals] ?? 0) > 0,
      ),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary)" }}>Today · nutrient breakdown</div>
      {groups.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Log foods or take supplements to see the full nutrient breakdown here.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
          {groups.map(({ group, items }) => (
            <div key={group}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                {group}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {items.map((m: NutrientMeta) => {
                  const val = totals[m.key as keyof NutrientTotals] ?? 0;
                  return (
                    <div
                      key={m.key}
                      style={{
                        display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8,
                        paddingLeft: m.sub ? 8 : 0,
                        borderLeft: m.sub ? "2px solid var(--border)" : "none",
                      }}
                    >
                      <span style={{ fontSize: 12, color: m.sub ? "var(--text-secondary)" : "var(--text)" }}>{m.label}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap" }}>
                        {fmt(val)} {m.unit}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
