import { useState } from "react";
import { Pill, Plus, Check, Pencil, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { takeSupplement, untakeSupplement, removeSupplement } from "../../../store/slices/supplementsSlice";
import { CARD_STYLE, todayISO } from "../../../lib/uiHelpers";
import SupplementEditor from "../SupplementEditor";
import type { Supplement } from "../../../store/types";

/**
 * The supplement stack — a thin column of habit-style toggle cards. Tap a card
 * to mark the supplement taken today (adds/removes a log); edit/delete manage
 * the stack. Mirrors the Today's-Habits card visual language.
 */
export default function SupplementPane() {
  const dispatch = useAppDispatch();
  const supplements = useAppSelector((s) => s.supplements.items);
  const logs = useAppSelector((s) => s.supplements.logs);
  const today = todayISO();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supplement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const takenToday = new Set(logs.filter((l) => l.date === today).map((l) => l.supplement_id));
  const takenCount = supplements.filter((s) => takenToday.has(s.id)).length;

  function toggle(id: string, taken: boolean) {
    if (taken) dispatch(untakeSupplement({ supplementId: id, date: today }));
    else dispatch(takeSupplement({ supplementId: id, date: today }));
  }

  return (
    <div style={{ ...CARD_STYLE, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          <Pill size={15} color="var(--accent)" />
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>Stack</span>
          {supplements.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{takenCount}/{supplements.length}</span>
          )}
        </div>
        <button
          onClick={() => setCreating(true)}
          title="New supplement"
          style={{ display: "flex", alignItems: "center", gap: 4, background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "4px 8px", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer", flexShrink: 0 }}
        >
          <Plus size={13} />
        </button>
      </div>

      {supplements.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "24px 8px", textAlign: "center" }}>
          <Pill size={22} color="var(--text-muted)" />
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            No supplements yet. Add your daily stack and tick each one off.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 520, overflowY: "auto" }}>
          {supplements.map((s) => {
            const taken = takenToday.has(s.id);
            return (
              <div
                key={s.id}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 10px",
                  background: taken ? "var(--accent-tint)" : "var(--bg)",
                  border: `1px solid ${taken ? "var(--accent-border-tint)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <button
                  onClick={() => toggle(s.id, taken)}
                  title={taken ? "Taken today — tap to undo" : "Mark as taken"}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0,
                    background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0,
                  }}
                >
                  <span
                    style={{
                      width: 22, height: 22, borderRadius: "50%", flexShrink: 0,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: taken ? "var(--accent)" : "transparent",
                      border: `2px solid ${taken ? "var(--accent)" : "var(--border)"}`,
                      color: "var(--accent-fg)",
                    }}
                  >
                    {taken ? <Check size={12} strokeWidth={3} /> : <Pill size={11} color="var(--text-muted)" />}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        display: "block", fontSize: 13, fontWeight: 600,
                        color: taken ? "var(--text-muted)" : "var(--text)",
                        textDecoration: taken ? "line-through" : "none",
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}
                    >
                      {s.name}
                    </span>
                    {s.dose && (
                      <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {s.dose}
                      </span>
                    )}
                  </span>
                </button>

                {confirmDelete === s.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button
                      onClick={() => { dispatch(removeSupplement(s.id)); setConfirmDelete(null); }}
                      style={{ background: "var(--danger, #e5484d)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "2px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}
                    >
                      Delete
                    </button>
                    <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>✕</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                    <button onClick={() => setEditing(s)} title="Edit" style={iconBtn}><Pencil size={13} /></button>
                    <button onClick={() => setConfirmDelete(s.id)} title="Delete" style={iconBtn}><Trash2 size={13} /></button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {creating && <SupplementEditor sortOrder={supplements.length} onClose={() => setCreating(false)} />}
      {editing && <SupplementEditor supplement={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", borderRadius: "var(--radius-sm)",
  padding: 3, cursor: "pointer", color: "var(--text-muted)", display: "flex",
};
