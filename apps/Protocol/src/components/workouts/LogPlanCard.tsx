import { useEffect, useState } from "react";
import { Plus, Trash2, Dumbbell, CheckCircle2, ChevronRight, Save } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addWorkoutSession,
  addExercise,
  fetchWorkoutSessions,
  fetchExercises,
  completeWorkoutSession,
  removeWorkoutSession,
} from "../../store/slices/workoutsSlice";
import { libraryMusclesToGroups, type SetLike } from "../../lib/muscleMap";
import { CARD_STYLE, INPUT_STYLE, INPUT_SM, SECTION_LABEL, BTN_PRIMARY, BTN_GHOST, ICON_BTN, todayISO, isoDate } from "../../lib/uiHelpers";
import type { WorkoutSession, ExerciseSet } from "../../store/types";
import ExerciseNameInput from "./ExerciseNameInput";
import MuscleMap from "./MuscleMap";

/** One exercise being planned, before the workout is saved. Captures the library's
 *  muscles at pick-time so the live map can light up without another lookup. */
interface StagedExercise {
  name: string;
  primary: string[];
  secondary: string[];
  sets: number | null;
  reps: number | null;
  weight: number | null;
}

const MAX_SETS = 12;

/** Turn the planned exercises into the SetLike shape the muscle map consumes — one
 *  entry per planned set, muscles resolved from the library pick. */
function plannedSets(staged: StagedExercise[], today: string): SetLike[] {
  const out: SetLike[] = [];
  for (const ex of staged) {
    const groups = libraryMusclesToGroups([...ex.primary, ...ex.secondary]);
    if (groups.length === 0) continue;
    const count = Math.max(1, Math.min(ex.sets ?? 1, MAX_SETS));
    for (let i = 0; i < count; i++) {
      out.push({ date: today, category: "", reps: ex.reps, weight_kg: ex.weight, muscles: groups });
    }
  }
  return out;
}

/** One imported exercise, collapsed from its individual sets. */
interface SetGroup { name: string; sets: number; reps: number | null; weight: number | null; }

/** Garmin imports have no protocol_exercises — their detail lives per-set in
 *  protocol_exercise_sets. Collapse a day's sets into one row per exercise
 *  (top-set reps/weight), applying the same alias map the progress card uses. */
function groupSets(sets: ExerciseSet[], aliases: Record<string, string>): SetGroup[] {
  const map = new Map<string, { count: number; reps: number | null; weight: number | null }>();
  for (const s of sets) {
    const key = s.exercise_name ?? s.category;
    const name = aliases[key] ?? key;
    const g = map.get(name) ?? { count: 0, reps: null, weight: null };
    g.count += 1;
    if (s.reps != null) g.reps = Math.max(g.reps ?? 0, s.reps);
    if (s.weight_kg != null) g.weight = Math.max(g.weight ?? 0, s.weight_kg);
    map.set(name, g);
  }
  return [...map.entries()].map(([name, g]) => ({ name, sets: g.count, reps: g.reps, weight: g.weight }));
}

const ROW_STYLE = { marginTop: 10, paddingLeft: 26, display: "flex", flexDirection: "column" as const, gap: 4 };

/** Read-only exercise list for a saved session (expanded row). Manually-logged
 *  sessions carry protocol_exercises; Garmin imports fall back to the day's sets. */
function SavedExercises({ session, exerciseSets, aliases }: { session: WorkoutSession; exerciseSets: ExerciseSet[]; aliases: Record<string, string> }) {
  const dispatch = useAppDispatch();
  const exercises = useAppSelector((s) => s.workouts.exercises.filter((e) => e.session_id === session.id));
  useEffect(() => { dispatch(fetchExercises(session.id)); }, [dispatch, session.id]);

  if (exercises.length === 0) {
    const daySets = exerciseSets.filter((s) => s.date === session.scheduled_date);
    if (daySets.length > 0) {
      return (
        <div style={ROW_STYLE}>
          {groupSets(daySets, aliases).map((g) => (
            <div key={g.name} style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--text-secondary)" }}>
              <span style={{ fontWeight: 500, color: "var(--text)" }}>{g.name}</span>
              <span style={{ color: "var(--text-muted)" }}>{g.sets}×{g.reps ?? "—"}</span>
              {g.weight != null && <span style={{ color: "var(--text-muted)" }}>{g.weight} kg</span>}
            </div>
          ))}
        </div>
      );
    }
    return <p style={{ fontSize: 12, color: "var(--text-muted)", paddingLeft: 26, marginTop: 8 }}>No exercises logged.</p>;
  }
  return (
    <div style={ROW_STYLE}>
      {exercises.map((ex) => (
        <div key={ex.id} style={{ display: "flex", gap: 10, fontSize: 12, color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 500, color: "var(--text)" }}>{ex.name}</span>
          {ex.sets != null && <span style={{ color: "var(--text-muted)" }}>{ex.sets}×{ex.reps ?? "—"}</span>}
          {ex.weight_kg != null && <span style={{ color: "var(--text-muted)" }}>{ex.weight_kg} kg</span>}
        </div>
      ))}
    </div>
  );
}

export default function LogPlanCard({ exerciseSets = [], aliases = {} }: { exerciseSets?: ExerciseSet[]; aliases?: Record<string, string> }) {
  const dispatch = useAppDispatch();
  const sessions = useAppSelector((s) => s.workouts.sessions);
  const today = isoDate(new Date());

  // Builder state — the workout being planned.
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [notes, setNotes] = useState("");
  const [staged, setStaged] = useState<StagedExercise[]>([]);
  const [saving, setSaving] = useState(false);

  // Add-exercise form.
  const [exName, setExName] = useState("");
  const [exPrimary, setExPrimary] = useState<string[]>([]);
  const [exSecondary, setExSecondary] = useState<string[]>([]);
  const [exSets, setExSets] = useState("");
  const [exReps, setExReps] = useState("");
  const [exWeight, setExWeight] = useState("");

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const addStaged = (e: React.FormEvent) => {
    e.preventDefault();
    if (!exName.trim()) return;
    setStaged((prev) => [...prev, {
      name: exName.trim(),
      primary: exPrimary,
      secondary: exSecondary,
      sets: exSets ? Number(exSets) : null,
      reps: exReps ? Number(exReps) : null,
      weight: exWeight ? Number(exWeight) : null,
    }]);
    setExName(""); setExPrimary([]); setExSecondary([]); setExSets(""); setExReps(""); setExWeight("");
  };

  const removeStaged = (i: number) => setStaged((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!name.trim() || staged.length === 0 || saving) return;
    setSaving(true);
    try {
      const session = await dispatch(addWorkoutSession({
        plan_id: null, name: name.trim(), scheduled_date: date, notes: notes.trim() || null,
      })).unwrap();
      for (const ex of staged) {
        await dispatch(addExercise({
          session_id: session.id, name: ex.name, sets: ex.sets, reps: ex.reps,
          weight_kg: ex.weight, duration_min: null, notes: null,
        })).unwrap();
      }
      setStaged([]); setName(""); setNotes("");
      dispatch(fetchWorkoutSessions());
    } finally {
      setSaving(false);
    }
  };

  const preview = plannedSets(staged, today);
  const recent = [...sessions].sort((a, b) => b.scheduled_date.localeCompare(a.scheduled_date)).slice(0, 8);

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Dumbbell size={15} color="var(--accent)" />
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Log & Plan a Workout</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· build it, watch the muscles light up, save it</span>
      </div>

      {/* Builder (left) + live muscle map (right) */}
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input style={{ ...INPUT_STYLE, flex: "2 1 180px" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Workout name — e.g. Upper Push" />
            <input style={{ ...INPUT_STYLE, flex: "1 1 130px" }} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          {/* Staged exercises */}
          {staged.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {staged.map((ex, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: "var(--bg)", borderRadius: "var(--radius-sm)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{ex.name}</span>
                    <div style={{ display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap", alignItems: "center" }}>
                      {ex.sets != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ex.sets} × {ex.reps ?? "—"}</span>}
                      {ex.weight != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ex.weight} kg</span>}
                      {ex.primary.length > 0 ? (
                        <span style={{ fontSize: 11, color: "var(--series-workout)" }}>{ex.primary.join(", ")}</span>
                      ) : (
                        <span style={{ fontSize: 11, color: "var(--warning)" }}>not in library — won't map</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeStaged(i)} style={{ ...ICON_BTN, padding: 2 }}><Trash2 size={13} /></button>
                </div>
              ))}
            </div>
          )}

          {/* Add-exercise form */}
          <form onSubmit={addStaged} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <ExerciseNameInput
              value={exName}
              onChange={(n, primary, secondary) => { setExName(n); setExPrimary(primary ?? []); setExSecondary(secondary ?? []); }}
              placeholder="Search exercises to add…"
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input style={{ ...INPUT_SM, flex: 1 }} type="number" value={exSets} onChange={(e) => setExSets(e.target.value)} placeholder="Sets" min={0} />
              <input style={{ ...INPUT_SM, flex: 1 }} type="number" value={exReps} onChange={(e) => setExReps(e.target.value)} placeholder="Reps" min={0} />
              <input style={{ ...INPUT_SM, flex: 1 }} type="number" value={exWeight} onChange={(e) => setExWeight(e.target.value)} placeholder="kg" min={0} step={0.5} />
              <button type="submit" style={{ ...BTN_GHOST, whiteSpace: "nowrap", flexShrink: 0 }}><Plus size={12} /> Add</button>
            </div>
          </form>

          <input style={INPUT_STYLE} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" />

          <button
            onClick={save}
            disabled={!name.trim() || staged.length === 0 || saving}
            style={{ ...BTN_PRIMARY, opacity: (!name.trim() || staged.length === 0 || saving) ? 0.5 : 1, cursor: (!name.trim() || staged.length === 0 || saving) ? "not-allowed" : "pointer" }}
          >
            <Save size={14} /> {saving ? "Saving…" : "Save workout"}
          </button>
        </div>

        {/* Live muscle map */}
        <div style={{ flex: "1 1 340px", textAlign: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
            {staged.length === 0 ? "Add exercises to see which muscles you'll hit" : "Muscles engaged by this workout — brighter = harder hit"}
          </div>
          <MuscleMap sets={preview} minimal />
        </div>
      </div>

      {/* Recent logged workouts */}
      {recent.length > 0 && (
        <div style={{ marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
            Recent workouts ({sessions.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {recent.map((session: WorkoutSession) => {
              const isExpanded = expandedId === session.id;
              return (
                <div key={session.id} style={{ padding: "8px 12px", background: "var(--bg)", borderRadius: "var(--radius-sm)", border: `1px solid ${session.completed ? "var(--success)" : "var(--border)"}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <button
                      onClick={() => { if (!session.completed) dispatch(completeWorkoutSession(session.id)); }}
                      style={{ ...ICON_BTN, padding: 0, cursor: session.completed ? "default" : "pointer", color: session.completed ? "var(--success)" : "var(--border)", flexShrink: 0 }}
                      title={session.completed ? "Completed" : "Mark complete"}
                    >
                      <CheckCircle2 size={16} />
                    </button>
                    <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setExpandedId((p) => (p === session.id ? null : session.id))}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <ChevronRight size={13} color="var(--text-muted)" style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }} />
                        <span style={{ fontWeight: 600, fontSize: 13, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: session.completed ? "line-through" : "none", opacity: session.completed ? 0.6 : 1 }}>
                          {session.name}
                        </span>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", flexShrink: 0 }}>
                          {new Date(`${session.scheduled_date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                        </span>
                      </div>
                    </div>
                    <button onClick={() => dispatch(removeWorkoutSession(session.id))} style={{ ...ICON_BTN, flexShrink: 0 }}><Trash2 size={13} /></button>
                  </div>
                  {isExpanded && <SavedExercises session={session} exerciseSets={exerciseSets} aliases={aliases} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
