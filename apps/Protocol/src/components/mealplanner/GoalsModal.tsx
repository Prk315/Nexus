import { useMemo, useState } from "react";
import { X, Check, Plus, Trash2 } from "lucide-react";
import { CARD_STYLE, INPUT_SM, LABEL_STYLE } from "../../lib/uiHelpers";
import { NUTRIENT_META, type NutrientMeta } from "../../lib/nutrients";
import type { NutritionGoalItem, CreateNutritionGoalItem } from "../../store/types";

const META_BY_KEY = new Map<string, NutrientMeta>(NUTRIENT_META.map((m) => [m.key, m]));

interface Row { nutrient_key: string; min: string; max: string }

/**
 * Edit nutrition goals: a row per nutrient with an optional floor (min) and
 * ceiling (max). Add a goal on ANY nutrient from the grouped picker; leave a
 * side blank for a one-sided goal ("at least" / "at most"), or fill both for a
 * range. Saving reconciles the whole set — the parent upserts what's set and
 * deletes what was removed.
 */
export default function GoalsModal({
  goals, onSave, onClose,
}: {
  goals: NutritionGoalItem[];
  onSave: (items: CreateNutritionGoalItem[]) => Promise<void>;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    goals
      .map((g) => ({
        nutrient_key: g.nutrient_key,
        min: g.min_value != null ? String(g.min_value) : "",
        max: g.max_value != null ? String(g.max_value) : "",
      }))
      .sort(byMetaOrder),
  );
  const [adding, setAdding] = useState("");
  const [saving, setSaving] = useState(false);

  const used = useMemo(() => new Set(rows.map((r) => r.nutrient_key)), [rows]);
  const available = useMemo(() => NUTRIENT_META.filter((m) => !used.has(m.key)), [used]);

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
      await onSave(items);
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
        style={{ ...CARD_STYLE, width: 500, maxHeight: "82vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>Daily nutrition goals</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -6 }}>
          Set a minimum ("at least"), a maximum ("at most"), or both for a range — e.g. calories between 2000 and 2800.
        </div>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Column headers */}
          {rows.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 28px", gap: 8, alignItems: "center" }}>
              <span style={LABEL_STYLE}>Nutrient</span>
              <span style={LABEL_STYLE}>Min</span>
              <span style={LABEL_STYLE}>Max</span>
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

          {rows.length === 0 && (
            <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "8px 0" }}>
              No goals yet — add one below.
            </div>
          )}

          {/* Add-nutrient picker */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <Plus size={14} color="var(--text-muted)" />
            <select
              value={adding}
              onChange={(e) => addNutrient(e.target.value)}
              style={{ ...INPUT_SM, flex: 1, cursor: "pointer" }}
            >
              <option value="">Add a goal…</option>
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

/** Grouped <optgroup> options from the nutrient catalog. */
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
