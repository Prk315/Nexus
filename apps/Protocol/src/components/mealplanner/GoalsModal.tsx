import { useMemo, useState } from "react";
import { X, Check, Plus, Trash2, Flame } from "lucide-react";
import { CARD_STYLE, INPUT_SM, LABEL_STYLE } from "../../lib/uiHelpers";
import { NUTRIENT_META, type NutrientMeta } from "../../lib/nutrients";
import type { NutritionGoalItem, CreateNutritionGoalItem } from "../../store/types";

const META_BY_KEY = new Map<string, NutrientMeta>(NUTRIENT_META.map((m) => [m.key, m]));

const CALORIE_PRESETS: { label: string; offset: number }[] = [
  { label: "Cut −500", offset: -500 },
  { label: "Maintain", offset: 0 },
  { label: "Bulk +300", offset: 300 },
];

export interface CalorieStrategy {
  base_bmr: number | null;
  calorie_offset: number | null;
  calorie_tolerance: number | null;
}

interface Row { nutrient_key: string; min: string; max: string }

/**
 * Edit nutrition goals. Calories is a DYNAMIC daily target — base burn + that
 * day's active calories + a bulk/cut offset, scored within a ± tolerance — set
 * in the top section. Every other nutrient is a WEEKLY min/max (at least / at
 * most / range). Saving reconciles the nutrient set and stores the calorie
 * strategy.
 */
export default function GoalsModal({
  goals, calorie, onSave, onClose,
}: {
  goals: NutritionGoalItem[];
  calorie: CalorieStrategy | null;
  onSave: (items: CreateNutritionGoalItem[], calorie: CalorieStrategy) => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    goals
      .filter((g) => g.nutrient_key !== "calories")
      .map((g) => ({
        nutrient_key: g.nutrient_key,
        min: g.min_value != null ? String(g.min_value) : "",
        max: g.max_value != null ? String(g.max_value) : "",
      }))
      .sort(byMetaOrder),
  );
  const [baseBmr, setBaseBmr] = useState(calorie?.base_bmr != null ? String(calorie.base_bmr) : "1800");
  const [offset, setOffset] = useState(calorie?.calorie_offset != null ? String(calorie.calorie_offset) : "0");
  const [tolerance, setTolerance] = useState(calorie?.calorie_tolerance != null ? String(calorie.calorie_tolerance) : "200");
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);

  const used = useMemo(() => new Set(rows.map((r) => r.nutrient_key)), [rows]);
  const available = useMemo(
    () => NUTRIENT_META.filter((m) => m.key !== "calories" && !used.has(m.key)),
    [used],
  );

  function addNutrient(key: string) {
    if (!key || used.has(key)) return;
    setRows((rs) => [...rs, { nutrient_key: key, min: "", max: "" }].sort(byMetaOrder));
    setAdding("");
  }
  function setField(key: string, field: "min" | "max", value: string) {
    setRows((rs) => rs.map((r) => (r.nutrient_key === key ? { ...r, [field]: value } : r)));
  }
  function removeRow(key: string) {
    setRows((rs) => rs.filter((r) => r.nutrient_key !== key));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const items: CreateNutritionGoalItem[] = rows
        .map((r) => ({
          nutrient_key: r.nutrient_key,
          min_value: r.min.trim() !== "" ? Number(r.min) : null,
          max_value: r.max.trim() !== "" ? Number(r.max) : null,
        }))
        .filter((i) => i.min_value != null || i.max_value != null);
      const cal: CalorieStrategy = {
        base_bmr: baseBmr.trim() !== "" ? Number(baseBmr) : null,
        calorie_offset: offset.trim() !== "" ? Number(offset) : 0,
        calorie_tolerance: tolerance.trim() !== "" ? Number(tolerance) : 200,
      };
      await onSave(items, cal);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 60, zIndex: 100 }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 520, maxHeight: "84vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Nutrition goals</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Dynamic calorie strategy */}
          <div style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <Flame size={14} color="var(--series-nutrition)" />
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>Calorie target (dynamic)</span>
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -4 }}>
              Each day: <strong>base burn + active calories + offset</strong>. Positive offset = bulk, negative = cut. The score rewards staying within ± tolerance.
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {CALORIE_PRESETS.map((p) => {
                const active = offset.trim() !== "" && Number(offset) === p.offset;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setOffset(String(p.offset))}
                    style={{
                      flex: 1, padding: "5px 8px", fontSize: 12, fontWeight: 600, cursor: "pointer",
                      borderRadius: "var(--radius-sm)",
                      border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                      background: active ? "var(--accent-tint)" : "var(--bg)",
                      color: active ? "var(--accent)" : "var(--text-secondary)",
                    }}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={LABEL_STYLE}>Base burn (kcal)</span>
                <input type="number" value={baseBmr} onChange={(e) => setBaseBmr(e.target.value)} placeholder="1800" style={INPUT_SM} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={LABEL_STYLE}>Offset (± kcal)</span>
                <input type="number" value={offset} onChange={(e) => setOffset(e.target.value)} placeholder="0" style={INPUT_SM} />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={LABEL_STYLE}>Tolerance (± kcal)</span>
                <input type="number" value={tolerance} onChange={(e) => setTolerance(e.target.value)} placeholder="200" style={INPUT_SM} />
              </label>
            </div>
          </div>

          {/* Weekly nutrient goals */}
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Nutrient goals are <strong>weekly</strong> — a minimum ("at least"), a maximum ("at most"), or both for a range. Scored on the last 7 days.
          </div>

          {rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 28px", gap: 8, alignItems: "center" }}>
              <span style={LABEL_STYLE}>Nutrient</span>
              <span style={LABEL_STYLE}>Min / wk</span>
              <span style={LABEL_STYLE}>Max / wk</span>
              <span />
            </div>
          )}

          {rows.map((r) => {
            const meta = META_BY_KEY.get(r.nutrient_key);
            return (
              <div key={r.nutrient_key} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 28px", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {meta?.label ?? r.nutrient_key}{meta ? ` (${meta.unit})` : ""}
                </span>
                <input type="number" value={r.min} onChange={(e) => setField(r.nutrient_key, "min", e.target.value)} placeholder="—" style={INPUT_SM} />
                <input type="number" value={r.max} onChange={(e) => setField(r.nutrient_key, "max", e.target.value)} placeholder="—" style={INPUT_SM} />
                <button type="button" onClick={() => removeRow(r.nutrient_key)} title="Remove goal" style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", display: "flex", justifyContent: "center" }}>
                  <Trash2 size={14} />
                </button>
              </div>
            );
          })}

          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <Plus size={14} color="var(--text-muted)" />
            <select value={adding} onChange={(e) => addNutrient(e.target.value)} style={{ ...INPUT_SM, flex: 1, cursor: "pointer" }}>
              <option value="">Add a weekly goal…</option>
              {groupOptions(available)}
            </select>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="submit"
              disabled={saving}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: saving ? 0.6 : 1 }}
            >
              <Check size={13} /> Save goals
            </button>
            <button type="button" onClick={onClose} style={{ background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 14px", fontSize: 13, color: "var(--text-secondary)", cursor: "pointer" }}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function byMetaOrder(a: { nutrient_key: string }, b: { nutrient_key: string }): number {
  const ia = NUTRIENT_META.findIndex((m) => m.key === a.nutrient_key);
  const ib = NUTRIENT_META.findIndex((m) => m.key === b.nutrient_key);
  return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
}

function groupOptions(metas: NutrientMeta[]) {
  const groups = new Map<string, NutrientMeta[]>();
  for (const m of metas) (groups.get(m.group) ?? groups.set(m.group, []).get(m.group)!).push(m);
  return [...groups.entries()].map(([group, items]) => (
    <optgroup key={group} label={group}>
      {items.map((m) => (
        <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>
      ))}
    </optgroup>
  ));
}
