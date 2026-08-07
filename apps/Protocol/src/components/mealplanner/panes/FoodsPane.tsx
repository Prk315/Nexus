import { useMemo, useState } from "react";
import { Search, Plus, Pencil, Trash2, Users, User as UserIcon, X } from "lucide-react";
import { useNexusAuth } from "@nexus/core";
import { useAppDispatch } from "../../../store/hooks";
import { addFood, updateFood, removeFood } from "../../../store/slices/mealPlannerSlice";
import { CARD_STYLE, INPUT_STYLE, LABEL_STYLE, FIELD_GROUP } from "../../../lib/uiHelpers";
import FoodPicker from "../FoodPicker";
import type { CreateFood, Food } from "../../../store/types";

const SOURCE_LABEL: Record<string, string> = {
  usda: "USDA", openfoodfacts: "Open Food Facts", frida: "Frida (Danish)", manual: "Manual",
};

/**
 * The shared ingredient library. Every food any user logs lands here and is
 * visible to everyone (RLS: read-all, write-own). You can browse/search the whole
 * catalog, contribute new foods, and edit or delete the ones you added.
 */
export default function FoodsPane({ foods }: { foods: Food[] }) {
  const dispatch = useAppDispatch();
  const { user } = useNexusAuth();
  const myId = user?.id ?? null;

  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Food | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return foods;
    return foods.filter((f) =>
      f.name.toLowerCase().includes(q) || (f.brand ?? "").toLowerCase().includes(q));
  }, [foods, query]);

  async function handleAdd(food: CreateFood) {
    const dup = foods.find(
      (f) => f.source === food.source && f.external_id === food.external_id && food.external_id != null,
    );
    if (!dup) await dispatch(addFood(food)).unwrap();
    setAdding(false);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
            <Users size={16} color="var(--accent)" /> Ingredient Library
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Shared across everyone — {foods.length} food{foods.length === 1 ? "" : "s"}. Anything you log is added here for all to reuse.
          </div>
        </div>
        <button
          onClick={() => setAdding(true)}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", flexShrink: 0 }}
        >
          <Plus size={14} /> Add food
        </button>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, ...CARD_STYLE, padding: "8px 12px" }}>
        <Search size={15} color="var(--text-muted)" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter the library…"
          style={{ ...INPUT_STYLE, border: "none", background: "transparent", padding: 0, flex: 1 }}
        />
      </div>

      {filtered.length === 0 ? (
        <div style={{ ...CARD_STYLE, padding: 32, textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
          {foods.length === 0 ? "No foods in the library yet." : "No foods match your filter."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {filtered.map((f) => {
            const mine = myId != null && f.user_id === myId;
            return (
              <div key={f.id} style={{ ...CARD_STYLE, padding: "10px 12px", display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {f.name}
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, color: mine ? "var(--accent)" : "var(--text-muted)", background: mine ? "var(--accent-tint)" : "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "1px 6px", flexShrink: 0 }}>
                      {mine ? <UserIcon size={9} /> : <Users size={9} />} {mine ? "You" : "Shared"}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {f.brand ? `${f.brand} · ` : ""}{SOURCE_LABEL[f.source] ?? f.source}
                    {f.calories != null ? ` · ${Math.round(f.calories)} kcal/100${f.serving_unit === "ml" ? "ml" : "g"}` : ""}
                  </div>
                </div>

                {mine && (
                  confirmDelete === f.id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => { dispatch(removeFood(f.id)); setConfirmDelete(null); }}
                        style={{ background: "var(--danger, #e5484d)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
                      >
                        Delete
                      </button>
                      <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => setEditing(f)} title="Edit" style={iconBtn}><Pencil size={14} /></button>
                      <button onClick={() => setConfirmDelete(f.id)} title="Delete" style={iconBtn}><Trash2 size={14} /></button>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}

      {adding && (
        <Modal title="Add food to library" onClose={() => setAdding(false)}>
          <FoodPicker localFoods={foods} onPick={handleAdd} />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit food" onClose={() => setEditing(null)}>
          <FoodEditor
            food={editing}
            onSave={async (patch) => { await dispatch(updateFood({ ...patch, id: editing.id })).unwrap(); setEditing(null); }}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 60, zIndex: 110 }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 480, maxHeight: "80vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--text)" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Compact per-100g editor for a food you contributed. */
function FoodEditor({ food, onSave }: { food: Food; onSave: (patch: CreateFood) => void }) {
  const [draft, setDraft] = useState<CreateFood>(() => {
    const { id: _id, user_id: _u, created_at: _c, ...rest } = food;
    return rest;
  });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof CreateFood>(k: K, v: CreateFood[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const numField = (label: string, key: keyof CreateFood) => (
    <div style={FIELD_GROUP}>
      <label style={LABEL_STYLE}>{label}</label>
      <input
        type="number"
        value={(draft[key] as number | null) ?? ""}
        onChange={(e) => set(key, (e.target.value ? Number(e.target.value) : null) as CreateFood[typeof key])}
        style={INPUT_STYLE}
      />
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={FIELD_GROUP}>
        <label style={LABEL_STYLE}>Name</label>
        <input type="text" value={draft.name} onChange={(e) => set("name", e.target.value)} style={INPUT_STYLE} />
      </div>
      <div style={FIELD_GROUP}>
        <label style={LABEL_STYLE}>Brand (optional)</label>
        <input type="text" value={draft.brand ?? ""} onChange={(e) => set("brand", e.target.value || null)} style={INPUT_STYLE} />
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Values per 100{draft.serving_unit === "ml" ? "ml" : "g"}:</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8 }}>
        {numField("Cal", "calories")}
        {numField("Protein", "protein_g")}
        {numField("Carbs", "carbs_g")}
        {numField("Fat", "fat_g")}
      </div>
      <button
        onClick={async () => { if (!draft.name.trim()) return; setSaving(true); try { await onSave(draft); } finally { setSaving(false); } }}
        disabled={!draft.name.trim() || saving}
        style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "9px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: !draft.name.trim() || saving ? 0.5 : 1 }}
      >
        {saving ? "Saving…" : "Save changes"}
      </button>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  padding: 5, cursor: "pointer", color: "var(--text-secondary)", display: "flex",
};
