import { NUTRIENT_META, NUTRIENT_GROUPS, type NutrientKey, type NutrientMeta, type NutrientValues } from "../../lib/nutrients";
import { INPUT_SM } from "../../lib/uiHelpers";

/**
 * Grouped, fully-optional nutrient inputs — macros (with fibre/sugar under carbs
 * and the fat sub-types under fat), minerals and vitamins. A blank field is
 * `null` ("not specified"), never coerced to 0, so you can specify only the
 * nutrients you actually know. Shared by the food editor, the manual-food form
 * and the supplement editor.
 */
export default function NutrientFields({
  values, onChange, unitNote,
}: {
  values: Partial<NutrientValues>;
  onChange: (key: NutrientKey, value: number | null) => void;
  unitNote?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {unitNote && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{unitNote}</div>}
      {NUTRIENT_GROUPS.map((group) => (
        <div key={group}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 8 }}>
            {group}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
            {NUTRIENT_META.filter((m) => m.group === group).map((m: NutrientMeta) => {
              const key = m.key as NutrientKey;
              const v = values[key];
              return (
                <div key={key} style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: m.sub ? 8 : 0, borderLeft: m.sub ? "2px solid var(--border)" : "none" }}>
                  <label style={{ fontSize: 10, color: m.sub ? "var(--text-muted)" : "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {m.label} <span style={{ opacity: 0.6 }}>{m.unit}</span>
                  </label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={v ?? ""}
                    placeholder="—"
                    onChange={(e) => onChange(key, e.target.value === "" ? null : Number(e.target.value))}
                    style={INPUT_SM}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
