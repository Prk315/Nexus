import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Play, Dumbbell, Layers } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchRoutines, fetchRoutineExercises, removeRoutine } from "../../store/slices/workoutsSlice";
import { CARD_STYLE } from "../../lib/uiHelpers";
import RoutineEditor from "./RoutineEditor";
import WorkoutPlanner from "./WorkoutPlanner";
import type { WorkoutRoutine } from "../../store/types";

/** Design tab: programs (WorkoutPlanner) + the training-day designer. Each
 *  routine card previews its prescribed exercises and can be launched into a
 *  logged workout. */
export default function RoutinesDesigner({ onStart }: { onStart: (r: WorkoutRoutine) => void }) {
  const dispatch = useAppDispatch();
  const plans = useAppSelector((s) => s.workouts.plans);
  const routines = useAppSelector((s) => s.workouts.routines);
  const routineExercises = useAppSelector((s) => s.workouts.routineExercises);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WorkoutRoutine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => { dispatch(fetchRoutines()); }, [dispatch]);
  useEffect(() => {
    for (const r of routines) if (!routineExercises[r.id]) dispatch(fetchRoutineExercises(r.id));
  }, [dispatch, routines, routineExercises]);

  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <WorkoutPlanner onSelectPlan={() => {}} selectedPlanId={null} />

      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 15, fontWeight: 700, color: "var(--text)" }}>
              <Dumbbell size={16} color="var(--accent)" /> Training days
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Design a day of training with target sets, reps, rest and weight — then log it.
            </div>
          </div>
          <button onClick={() => setCreating(true)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", background: "var(--accent)", color: "var(--accent-fg)", border: "none", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 13, cursor: "pointer", flexShrink: 0 }}>
            <Plus size={14} /> New training day
          </button>
        </div>

        {routines.length === 0 ? (
          <div style={{ ...CARD_STYLE, padding: 40, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
            <Dumbbell size={26} color="var(--text-muted)" />
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>No training days yet</div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 340 }}>
              Design one — e.g. "Push A" with bench 4×6 @ 100 kg, OHP 3×8 — and log it whenever you train to track progress.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 12 }}>
            {routines.map((r) => {
              const exs = routineExercises[r.id] ?? [];
              const prog = planName(r.plan_id);
              return (
                <div key={r.id} style={{ ...CARD_STYLE, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.day_label ? `${r.day_label} · ` : ""}{r.name}
                      </div>
                      {prog && (
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          <Layers size={11} /> {prog}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button onClick={() => setEditing(r)} title="Edit" style={iconBtn}><Pencil size={14} /></button>
                      <button onClick={() => setConfirmDelete(r.id)} title="Delete" style={iconBtn}><Trash2 size={14} /></button>
                    </div>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {exs.length === 0 ? (
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>No exercises</span>
                    ) : exs.map((e) => (
                      <div key={e.id} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, fontSize: 12 }}>
                        <span style={{ color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name}</span>
                        <span style={{ color: "var(--text-muted)", whiteSpace: "nowrap", flexShrink: 0 }}>
                          {e.target_sets ?? "–"}×{e.target_reps ?? "–"}{e.target_weight_kg != null ? ` · ${e.target_weight_kg} kg` : ""}
                        </span>
                      </div>
                    ))}
                  </div>

                  {confirmDelete === r.id ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                      <span style={{ color: "var(--text-secondary)" }}>Delete this day?</span>
                      <button onClick={() => { dispatch(removeRoutine(r.id)); setConfirmDelete(null); }} style={{ background: "var(--danger, #e5484d)", color: "#fff", border: "none", borderRadius: "var(--radius-sm)", padding: "3px 10px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Delete</button>
                      <button onClick={() => setConfirmDelete(null)} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}>Cancel</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => onStart(r)}
                      disabled={exs.length === 0}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "8px 12px", background: "var(--accent-tint)", color: "var(--accent)", border: "1px solid var(--accent-border-tint, var(--border))", borderRadius: "var(--radius-sm)", fontWeight: 600, fontSize: 12, cursor: exs.length ? "pointer" : "not-allowed", opacity: exs.length ? 1 : 0.5 }}
                    >
                      <Play size={13} /> Log this workout
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {creating && <RoutineEditor plans={plans} onClose={() => setCreating(false)} />}
      {editing && <RoutineEditor routine={editing} plans={plans} onClose={() => setEditing(null)} />}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  background: "none", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
  padding: 5, cursor: "pointer", color: "var(--text-secondary)", display: "flex",
};
