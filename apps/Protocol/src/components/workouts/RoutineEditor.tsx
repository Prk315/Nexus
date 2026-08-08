import { useEffect, useState } from "react";
import { X, Plus, Trash2, ChevronUp, ChevronDown, Dumbbell, Pencil } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addRoutine, editRoutine, fetchRoutineExercises,
  addRoutineExercise, editRoutineExercise, removeRoutineExercise,
} from "../../store/slices/workoutsSlice";
import { CARD_STYLE, INPUT_STYLE, INPUT_SM, LABEL_STYLE, FIELD_GROUP } from "../../lib/uiHelpers";
import { searchExerciseLibrary } from "../../lib/exerciseLibrary";
import type { WorkoutPlan, WorkoutRoutine, ExerciseLibraryItem } from "../../store/types";

interface DraftItem {
  key: string;
  id?: string;           // present = already-persisted routine exercise
  name: string;
  sets: string;
  reps: string;          // free text, allows "8-12"
  rest: string;          // seconds
  weight: string;        // kg
  rpe: string;
  notes: string;
  primary: string[] | null;   // muscles from the picked library exercise
  secondary: string[] | null;
}

const blankItem = (): DraftItem => ({
  key: crypto.randomUUID(), name: "", sets: "", reps: "", rest: "", weight: "", rpe: "", notes: "",
  primary: null, secondary: null,
});

/** Design or edit a training day (routine): name/day/program + an ordered list of
 *  prescribed exercises with target sets / reps / rest / weight / RPE. */
export default function RoutineEditor({
  routine, plans, onClose,
}: {
  routine?: WorkoutRoutine;
  plans: WorkoutPlan[];
  onClose: () => void;
}) {
  const dispatch = useAppDispatch();
  const editing = !!routine;
  const existing = useAppSelector((s) => (routine ? s.workouts.routineExercises[routine.id] : undefined));

  const [name, setName] = useState(routine?.name ?? "");
  const [dayLabel, setDayLabel] = useState(routine?.day_label ?? "");
  const [planId, setPlanId] = useState(routine?.plan_id ?? "");
  const [notes, setNotes] = useState(routine?.notes ?? "");
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);
  const [saving, setSaving] = useState(false);
  const [seeded, setSeeded] = useState(!editing);

  // Load existing prescribed exercises when editing.
  useEffect(() => {
    if (editing && routine) dispatch(fetchRoutineExercises(routine.id));
  }, [dispatch, editing, routine]);

  useEffect(() => {
    if (editing && !seeded && existing) {
      setItems(existing.length ? existing.map((e) => ({
        key: crypto.randomUUID(), id: e.id, name: e.name,
        sets: e.target_sets?.toString() ?? "", reps: e.target_reps ?? "",
        rest: e.rest_sec?.toString() ?? "", weight: e.target_weight_kg?.toString() ?? "",
        rpe: e.target_rpe?.toString() ?? "", notes: e.notes ?? "",
        primary: e.primary_muscles, secondary: e.secondary_muscles,
      })) : [blankItem()]);
      setSeeded(true);
    }
  }, [editing, seeded, existing]);

  const patch = (key: string, field: keyof DraftItem, value: string) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, [field]: value } : i)));
  const patchItem = (key: string, partial: Partial<DraftItem>) =>
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...partial } : i)));
  const addRow = () => setItems((l) => [...l, blankItem()]);
  const removeRow = (key: string) => setItems((l) => (l.length > 1 ? l.filter((i) => i.key !== key) : l));
  const move = (key: string, dir: -1 | 1) =>
    setItems((l) => {
      const idx = l.findIndex((i) => i.key === key);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= l.length) return l;
      const copy = [...l];
      [copy[idx], copy[j]] = [copy[j], copy[idx]];
      return copy;
    });

  const num = (s: string) => (s.trim() ? Number(s) : null);

  async function save() {
    const rows = items.filter((i) => i.name.trim());
    if (!name.trim() || rows.length === 0) return;
    setSaving(true);
    try {
      let routineId: string;
      if (editing && routine) {
        await dispatch(editRoutine({
          id: routine.id, name: name.trim(), day_label: dayLabel.trim() || null,
          plan_id: planId || null, notes: notes.trim() || null, sort_order: routine.sort_order,
        })).unwrap();
        routineId = routine.id;
        // remove exercises deleted in the editor
        const keptIds = new Set(rows.filter((r) => r.id).map((r) => r.id!));
        for (const e of existing ?? []) {
          if (!keptIds.has(e.id)) await dispatch(removeRoutineExercise({ id: e.id, routineId })).unwrap();
        }
      } else {
        const r = await dispatch(addRoutine({
          name: name.trim(), day_label: dayLabel.trim() || null,
          plan_id: planId || null, notes: notes.trim() || null,
        })).unwrap();
        routineId = r.id;
      }
      // upsert every row with its position as sort_order
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const payload = {
          routine_id: routineId, name: r.name.trim(),
          target_sets: num(r.sets), target_reps: r.reps.trim() || null,
          rest_sec: num(r.rest), target_weight_kg: num(r.weight),
          target_rpe: num(r.rpe), tempo: null, sort_order: i, notes: r.notes.trim() || null,
          primary_muscles: r.primary, secondary_muscles: r.secondary,
        };
        if (r.id) await dispatch(editRoutineExercise({ ...payload, id: r.id })).unwrap();
        else await dispatch(addRoutineExercise(payload)).unwrap();
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: 48, zIndex: 110 }}
      onClick={onClose}
    >
      <div
        style={{ ...CARD_STYLE, width: 680, maxWidth: "94vw", maxHeight: "86vh", overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15, color: "var(--text)" }}>
            {editing ? <Pencil size={16} color="var(--accent)" /> : <Dumbbell size={16} color="var(--accent)" />}
            {editing ? "Edit training day" : "Design a training day"}
          </span>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer" }}><X size={16} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1.4fr", gap: 10 }}>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Name</label>
            <input style={INPUT_STYLE} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Push A" autoFocus />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Day label</label>
            <input style={INPUT_STYLE} value={dayLabel} onChange={(e) => setDayLabel(e.target.value)} placeholder="Day 1" />
          </div>
          <div style={FIELD_GROUP}>
            <label style={LABEL_STYLE}>Program</label>
            <select style={INPUT_STYLE} value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">— standalone —</option>
              {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>

        {/* Prescribed exercises */}
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "16px 1fr 52px 64px 60px 60px 48px 24px", gap: 6, alignItems: "center", padding: "0 2px 6px", fontSize: 10, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            <span /><span>Exercise</span><span>Sets</span><span>Reps</span><span>Rest s</span><span>kg</span><span>RPE</span><span />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {items.map((it, i) => (
              <div key={it.key} style={{ display: "grid", gridTemplateColumns: "16px 1fr 52px 64px 60px 60px 48px 24px", gap: 6, alignItems: "center" }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <button onClick={() => move(it.key, -1)} disabled={i === 0} style={miniBtn}><ChevronUp size={11} /></button>
                  <button onClick={() => move(it.key, 1)} disabled={i === items.length - 1} style={miniBtn}><ChevronDown size={11} /></button>
                </div>
                <ExerciseNameInput
                  value={it.name}
                  onChange={(name, p, s) => patchItem(it.key, { name, primary: p, secondary: s })}
                />
                <input style={INPUT_SM} value={it.sets} onChange={(e) => patch(it.key, "sets", e.target.value)} placeholder="3" inputMode="numeric" />
                <input style={INPUT_SM} value={it.reps} onChange={(e) => patch(it.key, "reps", e.target.value)} placeholder="8-12" />
                <input style={INPUT_SM} value={it.rest} onChange={(e) => patch(it.key, "rest", e.target.value)} placeholder="120" inputMode="numeric" />
                <input style={INPUT_SM} value={it.weight} onChange={(e) => patch(it.key, "weight", e.target.value)} placeholder="100" inputMode="decimal" />
                <input style={INPUT_SM} value={it.rpe} onChange={(e) => patch(it.key, "rpe", e.target.value)} placeholder="8" inputMode="decimal" />
                <button onClick={() => removeRow(it.key)} style={{ ...miniBtn, color: "var(--text-muted)" }} title="Remove"><Trash2 size={12} /></button>
              </div>
            ))}
          </div>
          <button onClick={addRow} style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, background: "none", border: "1px dashed var(--border)", borderRadius: "var(--radius-sm)", padding: "7px 12px", fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", width: "100%", justifyContent: "center" }}>
            <Plus size={13} /> Add exercise
          </button>
        </div>

        <div style={FIELD_GROUP}>
          <label style={LABEL_STYLE}>Notes (optional)</label>
          <input style={INPUT_STYLE} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Focus, cues, deload…" />
        </div>

        <button
          onClick={save}
          disabled={!name.trim() || saving || items.every((i) => !i.name.trim())}
          style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "10px 16px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", opacity: !name.trim() || saving ? 0.5 : 1 }}
        >
          {saving ? "Saving…" : editing ? "Save changes" : "Save training day"}
        </button>
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)",
  padding: 0, display: "flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
};

/** Searchable exercise-name field backed by the shared library — picking a match
 *  fills the name and captures its muscles; free-typing is still allowed. */
function ExerciseNameInput({
  value, onChange,
}: {
  value: string;
  onChange: (name: string, primary: string[] | null, secondary: string[] | null) => void;
}) {
  const [results, setResults] = useState<ExerciseLibraryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    const t = setTimeout(() => {
      searchExerciseLibrary(q).then((r) => setResults(r)).finally(() => setLoading(false));
    }, 220);
    return () => clearTimeout(t);
  }, [value]);

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <input
        style={INPUT_SM}
        value={value}
        onChange={(e) => { onChange(e.target.value, null, null); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Search exercises…"
      />
      {open && value.trim().length >= 2 && (results.length > 0 || loading) && (
        <div style={{ position: "absolute", top: "calc(100% + 2px)", left: 0, width: 300, maxWidth: "70vw", maxHeight: 240, overflowY: "auto", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", boxShadow: "0 8px 24px rgba(0,0,0,0.25)", zIndex: 5 }}>
          {loading && results.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 12, color: "var(--text-muted)" }}>Searching…</div>
          )}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onChange(r.name, r.primary_muscles, r.secondary_muscles); setOpen(false); }}
              style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1, width: "100%", textAlign: "left", padding: "7px 10px", background: "none", border: "none", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
            >
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{r.name}</span>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {r.primary_muscles.join(", ")}{r.equipment ? ` · ${r.equipment}` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
