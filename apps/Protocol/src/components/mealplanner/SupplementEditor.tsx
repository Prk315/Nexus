import { useState } from "react";
import { X, Pill, Pencil } from "lucide-react";
import { useAppDispatch } from "../../store/hooks";
import { addSupplement, editSupplement } from "../../store/slices/supplementsSlice";
import { CARD_STYLE, INPUT_STYLE, LABEL_STYLE, FIELD_GROUP } from "../../lib/uiHelpers";
import { EMPTY_NUTRIENTS, type NutrientKey } from "../../lib/nutrients";
import NutrientFields from "./NutrientFields";
import type { CreateSupplement, Supplement } from "../../store/types";

/**
 * Create or edit a supplement. Nutrient values are ABSOLUTE per dose (what one
 * serving delivers), every field optional — leave blank what the label doesn't
 * list. This is the "vast nutrient customisability" surface.
 */
export default function SupplementEditor({
  supplement, sortOrder, onClose,
}: {
  supplement?: Supplement;
  sortOrder?: number;
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const editing = !!supplement;

  const [draft, setDraft] = useState<CreateSupplement>(() => {
    if (supplement) {
      const { id: _id, user_id: _u, archived: _a, created_at: _c, ...rest } = supplement;
      return rest;
    }
    return { ...EMPTY_NUTRIENTS, name: "", brand: null, dose: null, sort_order: sortOrder ?? 0 };
  });
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof CreateSupplement>(k: K, v: CreateSupplement[K]) =>
    setDraft((d) => ({ ...d, [k]: v }));

  async function save() {
    if (!draft.name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...draft, name: draft.name.trim() };
      if (editing && supplement) {
        await dispatch(editSupplement({ ...payload, id: supplement.id })).unwrap();
      } else {
        await dispatch(addSupplement(payload)).unwrap();
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 60, zIndex: 110 }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 480, maxHeight: "82vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
            {editing ? <Pencil size={16} color="var(--accent)" /> : <Pill size={16} color="var(--accent)" />}
            {editing ? "Edit supplement" : "New supplement"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}>
            <X size={16} />
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 10 }}>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Name</label>
            <input type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Vitamin D3" style={INPUT_STYLE} autoFocus />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Dose</label>
            <input type="text" value={draft.dose ?? ""} onChange={(e) => set("dose", e.target.value || null)} placeholder="1 capsule" style={INPUT_STYLE} />
          </div>
        </div>
        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Brand (optional)</label>
          <input type="text" value={draft.brand ?? ""} onChange={(e) => set("brand", e.target.value || null)} style={INPUT_STYLE} />
        </div>

        <NutrientFields
          values={draft}
          onChange={(k: NutrientKey, v) => set(k, v)}
          unitNote="Per dose — enter the amounts one serving delivers; leave the rest blank."
        />

        <button
          onClick={save}
          disabled={!draft.name.trim() || saving}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
            padding: "9px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none",
            borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer",
            opacity: !draft.name.trim() || saving ? 0.5 : 1,
          }}
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Add to stack"}
        </button>
      </div>
    </div>
  );
}
