import { useMemo, useState } from "react";
import {
  Pill, Plus, Check, Pencil, Trash2, ChevronDown, ChevronRight, GripVertical, Layers, X,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import {
  takeSupplement, untakeSupplement, removeSupplement,
  addSupplementStack, editSupplementStack, removeSupplementStack, reorderSupplements,
} from "../../../store/slices/supplementsSlice";
import { CARD_STYLE, todayISO } from "../../../lib/uiHelpers";
import SupplementEditor from "../SupplementEditor";
import type { Supplement, SupplementStack } from "../../../store/types";

const COLLAPSED_KEY = "protocol_supp_collapsed";

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

/**
 * The supplement stacks. Each stack is a collapsible group of habit-style toggle
 * cards; you can keep several (Morning, Pre-workout, …), rename/delete them, and
 * drag supplements between stacks. Deleting a non-empty stack moves its
 * supplements into another stack so nothing is lost. Collapse is purely visual —
 * every stack always counts toward the day's tally and nutrient totals.
 */
export default function SupplementPane() {
  const dispatch = useAppDispatch();
  const supplements = useAppSelector((s) => s.supplements.items);
  const stacks = useAppSelector((s) => s.supplements.stacks);
  const logs = useAppSelector((s) => s.supplements.logs);
  const today = todayISO();

  const [creatingInStack, setCreatingInStack] = useState<string | null>(null);
  const [editing, setEditing] = useState<Supplement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [newStackName, setNewStackName] = useState("");
  const [renamingStackId, setRenamingStackId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteStack, setConfirmDeleteStack] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverStack, setDragOverStack] = useState<string | null>(null);
  const [dragStackId, setDragStackId] = useState<string | null>(null);
  const [stackDropTarget, setStackDropTarget] = useState<string | null>(null);

  const takenToday = useMemo(
    () => new Set(logs.filter((l) => l.date === today).map((l) => l.supplement_id)),
    [logs, today],
  );

  const orderedStacks = useMemo(() => [...stacks].sort((a, b) => a.sort_order - b.sort_order), [stacks]);
  const byStack = useMemo(() => {
    const m = new Map<string, Supplement[]>();
    for (const s of supplements) {
      const key = s.stack_id ?? "__none__";
      (m.get(key) ?? m.set(key, []).get(key)!).push(s);
    }
    for (const list of m.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [supplements]);

  // Supplements whose stack was deleted out from under them (should be rare).
  const knownIds = useMemo(() => new Set(stacks.map((s) => s.id)), [stacks]);
  const orphans = useMemo(
    () => supplements.filter((s) => !s.stack_id || !knownIds.has(s.stack_id)).sort((a, b) => a.sort_order - b.sort_order),
    [supplements, knownIds],
  );

  function persistCollapsed(next: Set<string>) {
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
  }
  function toggleCollapse(stackId: string) {
    const next = new Set(collapsed);
    next.has(stackId) ? next.delete(stackId) : next.add(stackId);
    persistCollapsed(next);
  }

  function toggle(id: string, taken: boolean) {
    if (taken) dispatch(untakeSupplement({ supplementId: id, date: today }));
    else dispatch(takeSupplement({ supplementId: id, date: today }));
  }

  async function handleAddStack(e: React.FormEvent) {
    e.preventDefault();
    const v = newStackName.trim();
    if (!v) return;
    await dispatch(addSupplementStack({ name: v, sort_order: stacks.length })).unwrap();
    setNewStackName("");
  }

  function commitRename(stack: SupplementStack) {
    const v = renameValue.trim();
    if (v && v !== stack.name) {
      dispatch(editSupplementStack({ id: stack.id, name: v, sort_order: stack.sort_order }));
    }
    setRenamingStackId(null);
  }

  function deleteStack(stack: SupplementStack) {
    // Move this stack's supplements into the first OTHER stack so nothing is lost.
    const target = orderedStacks.find((s) => s.id !== stack.id);
    dispatch(removeSupplementStack({ id: stack.id, moveToStackId: target?.id ?? null }));
    setConfirmDeleteStack(null);
  }

  /** Drop the dragged supplement into `targetStackId`, positioned before
   *  `beforeId` (or appended when null). Reindexes the target stack and persists
   *  only the rows that actually changed. */
  function moveTo(targetStackId: string, beforeId: string | null) {
    if (!dragId) return;
    const dragged = supplements.find((s) => s.id === dragId);
    if (!dragged || dragId === beforeId) return;
    const target = supplements
      .filter((s) => (s.stack_id ?? "__none__") === targetStackId && s.id !== dragId)
      .sort((a, b) => a.sort_order - b.sort_order);
    let idx = beforeId ? target.findIndex((s) => s.id === beforeId) : target.length;
    if (idx < 0) idx = target.length;
    target.splice(idx, 0, dragged);
    const updates = target
      .map((s, i) => ({ id: s.id, stack_id: targetStackId, sort_order: i }))
      .filter((u) => {
        const cur = supplements.find((s) => s.id === u.id)!;
        return cur.stack_id !== u.stack_id || cur.sort_order !== u.sort_order;
      });
    if (updates.length) dispatch(reorderSupplements(updates));
    setDragId(null);
    setDragOverStack(null);
  }

  /** Reorder whole stacks — the dragged stack (and, since its supplements render
   *  inside it, all of them) moves to the target's slot; every stack's sort_order
   *  is renumbered and only the changed ones are persisted. */
  function reorderStacks(draggedId: string, targetId: string) {
    if (draggedId === targetId) return;
    const ordered = [...orderedStacks];
    const from = ordered.findIndex((s) => s.id === draggedId);
    const to = ordered.findIndex((s) => s.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = ordered.splice(from, 1);
    ordered.splice(to, 0, moved);
    ordered.forEach((s, i) => {
      if (s.sort_order !== i) dispatch(editSupplementStack({ id: s.id, name: s.name, sort_order: i }));
    });
    setDragStackId(null);
    setStackDropTarget(null);
  }

  const canDeleteStacks = orderedStacks.length > 1;

  return (
    <div style={{ ...CARD_STYLE, padding: 16, display: "flex", flexDirection: "column", gap: 12, width: "100%", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <Pill size={15} color="var(--accent)" />
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Stacks</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{supplements.length}</span>
      </div>

      <form onSubmit={handleAddStack} style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Layers size={13} color="var(--text-muted)" style={{ flexShrink: 0 }} />
        <input
          type="text"
          value={newStackName}
          onChange={(e) => setNewStackName(e.target.value)}
          placeholder="New stack — e.g. Morning"
          style={{ flex: 1, minWidth: 0, fontSize: 12, padding: "5px 8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text)" }}
        />
        <button
          type="submit"
          disabled={!newStackName.trim()}
          title="Add stack"
          style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 8px", background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12, fontWeight: 600, color: "var(--text-secondary)", cursor: "pointer", opacity: newStackName.trim() ? 1 : 0.5, flexShrink: 0 }}
        >
          <Plus size={13} />
        </button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 12, flex: 1, minHeight: 0, overflowY: "auto" }}>
        {orderedStacks.length === 0 && orphans.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "24px 8px", textAlign: "center" }}>
            <Layers size={22} color="var(--text-muted)" />
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Add a stack above, then fill it with supplements.</div>
          </div>
        )}

        {orderedStacks.map((stack) => {
          const list = byStack.get(stack.id) ?? [];
          const isCollapsed = collapsed.has(stack.id);
          const takenCount = list.filter((s) => takenToday.has(s.id)).length;
          const isRenaming = renamingStackId === stack.id;
          const isSuppDragOver = dragOverStack === stack.id && !!dragId;
          const isStackDragOver = stackDropTarget === stack.id && !!dragStackId && dragStackId !== stack.id;
          return (
            <div
              key={stack.id}
              onDragOver={(e) => {
                if (dragStackId) { e.preventDefault(); setStackDropTarget(stack.id); }
                else if (dragId) { e.preventDefault(); setDragOverStack(stack.id); }
              }}
              onDragLeave={() => {
                setDragOverStack((cur) => (cur === stack.id ? null : cur));
                setStackDropTarget((cur) => (cur === stack.id ? null : cur));
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragStackId) reorderStacks(dragStackId, stack.id);
                else moveTo(stack.id, null);
              }}
              style={{
                display: "flex", flexDirection: "column", gap: 6,
                border: `1px solid ${isSuppDragOver ? "var(--accent)" : "var(--border)"}`,
                ...(isStackDragOver ? { borderTop: "2px solid var(--accent)" } : {}),
                background: isSuppDragOver ? "var(--accent-tint)" : "transparent",
                borderRadius: "var(--radius-sm)", padding: 8,
                opacity: dragStackId === stack.id ? 0.5 : 1,
              }}
            >
              {/* Stack header */}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  draggable={!isRenaming}
                  onDragStart={(e) => { setDragStackId(stack.id); e.dataTransfer.effectAllowed = "move"; }}
                  onDragEnd={() => { setDragStackId(null); setStackDropTarget(null); }}
                  title="Drag to reorder stack"
                  style={{ display: "flex", cursor: isRenaming ? "default" : "grab", color: "var(--text-muted)", flexShrink: 0 }}
                >
                  <GripVertical size={14} />
                </span>
                <button onClick={() => toggleCollapse(stack.id)} title={isCollapsed ? "Expand" : "Collapse"} style={iconBtn}>
                  {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                </button>
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(stack)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRename(stack); if (e.key === "Escape") setRenamingStackId(null); }}
                    style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, padding: "2px 6px", background: "var(--bg)", border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)", color: "var(--text)" }}
                  />
                ) : (
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {stack.name}
                  </span>
                )}
                {list.length > 0 && (
                  <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>{takenCount}/{list.length}</span>
                )}
                <button onClick={() => setCreatingInStack(stack.id)} title="Add supplement" style={iconBtn}><Plus size={14} /></button>
                <button onClick={() => { setRenamingStackId(stack.id); setRenameValue(stack.name); }} title="Rename stack" style={iconBtn}><Pencil size={13} /></button>
                {confirmDeleteStack === stack.id ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                    <button onClick={() => deleteStack(stack)} style={{ background: "var(--danger, #e5484d)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "2px 7px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                    <button onClick={() => setConfirmDeleteStack(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}>✕</button>
                  </div>
                ) : (
                  <button
                    onClick={() => canDeleteStacks && setConfirmDeleteStack(stack.id)}
                    title={canDeleteStacks ? "Delete stack" : "Keep at least one stack"}
                    disabled={!canDeleteStacks}
                    style={{ ...iconBtn, opacity: canDeleteStacks ? 1 : 0.35, cursor: canDeleteStacks ? "pointer" : "not-allowed" }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Supplement cards */}
              {!isCollapsed && (
                list.length === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", padding: "6px 4px 4px 26px" }}>
                    Empty — add one, or drag a supplement here.
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {list.map((s) => (
                      <SupplementRow
                        key={s.id}
                        s={s}
                        taken={takenToday.has(s.id)}
                        dragging={dragId === s.id}
                        suppDragging={!!dragId}
                        onDragStart={() => setDragId(s.id)}
                        onDragEnd={() => { setDragId(null); setDragOverStack(null); }}
                        onDropBefore={() => moveTo(stack.id, s.id)}
                        onToggle={() => toggle(s.id, takenToday.has(s.id))}
                        onEdit={() => setEditing(s)}
                        confirmingDelete={confirmDelete === s.id}
                        onAskDelete={() => setConfirmDelete(s.id)}
                        onCancelDelete={() => setConfirmDelete(null)}
                        onDelete={() => { dispatch(removeSupplement(s.id)); setConfirmDelete(null); }}
                      />
                    ))}
                  </div>
                )
              )}
            </div>
          );
        })}

        {/* Orphaned supplements (stack deleted mid-flight) — drag them into a stack. */}
        {orphans.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", padding: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-muted)" }}>Ungrouped — drag into a stack</span>
            {orphans.map((s) => (
              <SupplementRow
                key={s.id}
                s={s}
                taken={takenToday.has(s.id)}
                dragging={dragId === s.id}
                suppDragging={!!dragId}
                onDragStart={() => setDragId(s.id)}
                onDragEnd={() => { setDragId(null); setDragOverStack(null); }}
                onDropBefore={() => { /* no reorder within ungrouped */ }}
                onToggle={() => toggle(s.id, takenToday.has(s.id))}
                onEdit={() => setEditing(s)}
                confirmingDelete={confirmDelete === s.id}
                onAskDelete={() => setConfirmDelete(s.id)}
                onCancelDelete={() => setConfirmDelete(null)}
                onDelete={() => { dispatch(removeSupplement(s.id)); setConfirmDelete(null); }}
              />
            ))}
          </div>
        )}
      </div>

      {creatingInStack && (
        <SupplementEditor
          stackId={creatingInStack}
          sortOrder={(byStack.get(creatingInStack) ?? []).length}
          onClose={() => setCreatingInStack(null)}
        />
      )}
      {editing && <SupplementEditor supplement={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SupplementRow({
  s, taken, dragging, suppDragging, onDragStart, onDragEnd, onDropBefore,
  onToggle, onEdit, confirmingDelete, onAskDelete, onCancelDelete, onDelete,
}: {
  s: Supplement;
  taken: boolean;
  dragging: boolean;
  /** True while some supplement is mid-drag. When false, a drop here is a stack
   *  drag — don't intercept it, let it bubble to the stack container. */
  suppDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: () => void;
  onToggle: () => void;
  onEdit: () => void;
  confirmingDelete: boolean;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      onDragOver={(e) => { if (suppDragging) e.preventDefault(); }}
      onDrop={(e) => { if (suppDragging) { e.preventDefault(); e.stopPropagation(); onDropBefore(); } }}
      style={{
        display: "flex", alignItems: "center", gap: 6, padding: "8px 8px",
        background: taken ? "var(--accent-tint)" : "var(--bg)",
        border: `1px solid ${taken ? "var(--accent-border-tint)" : "var(--border)"}`,
        borderRadius: "var(--radius-sm)", opacity: dragging ? 0.4 : 1,
      }}
    >
      <span
        draggable
        onDragStart={(e) => { onDragStart(); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={onDragEnd}
        title="Drag to another stack"
        style={{ display: "flex", cursor: "grab", color: "var(--text-muted)", flexShrink: 0 }}
      >
        <GripVertical size={14} />
      </span>

      <button
        onClick={onToggle}
        title={taken ? "Taken today — tap to undo" : "Mark as taken"}
        style={{ display: "flex", alignItems: "center", gap: 9, flex: 1, minWidth: 0, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}
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
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: taken ? "var(--text-muted)" : "var(--text)", textDecoration: taken ? "line-through" : "none", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {s.name}
          </span>
          {s.dose && (
            <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {s.dose}
            </span>
          )}
        </span>
      </button>

      {confirmingDelete ? (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <button onClick={onDelete} style={{ background: "var(--danger, #e5484d)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "2px 8px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Delete</button>
          <button onClick={onCancelDelete} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}><X size={12} /></button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <button onClick={onEdit} title="Edit" style={iconBtn}><Pencil size={13} /></button>
          <button onClick={onAskDelete} title="Delete" style={iconBtn}><Trash2 size={13} /></button>
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "none", borderRadius: "var(--radius-sm)",
  padding: 3, cursor: "pointer", color: "var(--text-muted)", display: "flex", flexShrink: 0,
};
