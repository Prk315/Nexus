import { useState, useEffect } from "react";
import { Plus, Trash2, CheckCircle2, ChevronRight, Timer } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addWorkoutSession,
  completeWorkoutSession,
  removeWorkoutSession,
  fetchExercises,
  addExercise,
  removeExercise,
} from "../../store/slices/workoutsSlice";
import type { WorkoutSession } from "../../store/types";
import { CARD_PADDED, CARD_TIGHT, INPUT_STYLE, INPUT_SM, SECTION_LABEL, BTN_PRIMARY, BTN_GHOST, ICON_BTN } from "../../lib/uiHelpers";

interface WorkoutSessionLoggerProps {
  planId?: string | null;
}

function ExerciseList({ session }: { session: WorkoutSession }) {
  const dispatch = useAppDispatch();
  const exercises = useAppSelector((s) => s.workouts.exercises.filter((e) => e.session_id === session.id));

  const [exName, setExName] = useState("");
  const [sets, setSets] = useState("");
  const [reps, setReps] = useState("");
  const [weight, setWeight] = useState("");
  const [duration, setDuration] = useState("");
  const [exNotes, setExNotes] = useState("");

  useEffect(() => {
    dispatch(fetchExercises(session.id));
  }, [dispatch, session.id]);

  const handleAddExercise = (e: React.FormEvent) => {
    e.preventDefault();
    if (!exName.trim()) return;
    dispatch(addExercise({
      session_id: session.id,
      name: exName.trim(),
      sets: sets ? Number(sets) : null,
      reps: reps ? Number(reps) : null,
      weight_kg: weight ? Number(weight) : null,
      duration_min: duration ? Number(duration) : null,
      notes: exNotes.trim() || null,
    }));
    setExName(""); setSets(""); setReps(""); setWeight(""); setDuration(""); setExNotes("");
  };

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 10 }}>
        Exercises ({exercises.length})
      </p>

      {exercises.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {exercises.map((ex) => (
            <div
              key={ex.id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 12px",
                background: "var(--bg)",
                borderRadius: "var(--radius-sm)",
                marginBottom: 6,
                gap: 8,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{ex.name}</span>
                <div style={{ display: "flex", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
                  {ex.sets != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ex.sets} sets</span>}
                  {ex.reps != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ex.reps} reps</span>}
                  {ex.weight_kg != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ex.weight_kg} kg</span>}
                  {ex.duration_min != null && <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{ex.duration_min} min</span>}
                  {ex.notes && <span style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic" }}>{ex.notes}</span>}
                </div>
              </div>
              <button onClick={() => dispatch(removeExercise(ex.id))} style={{ ...ICON_BTN, padding: 2 }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleAddExercise}>
        <div style={{ marginBottom: 8 }}>
          <input style={INPUT_SM} value={exName} onChange={(e) => setExName(e.target.value)} placeholder="Exercise name" required />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 8 }}>
          <input style={INPUT_SM} type="number" value={sets} onChange={(e) => setSets(e.target.value)} placeholder="Sets" min={0} />
          <input style={INPUT_SM} type="number" value={reps} onChange={(e) => setReps(e.target.value)} placeholder="Reps" min={0} />
          <input style={INPUT_SM} type="number" value={weight} onChange={(e) => setWeight(e.target.value)} placeholder="kg" min={0} step={0.5} />
          <input style={INPUT_SM} type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="min" min={0} />
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input style={{ ...INPUT_SM, flex: 1 }} value={exNotes} onChange={(e) => setExNotes(e.target.value)} placeholder="Notes (optional)" />
          <button type="submit" style={{ ...BTN_GHOST, whiteSpace: "nowrap", flexShrink: 0 }}>
            <Plus size={12} /> Add
          </button>
        </div>
      </form>
    </div>
  );
}

export default function WorkoutSessionLogger({ planId }: WorkoutSessionLoggerProps) {
  const dispatch = useAppDispatch();
  const allSessions = useAppSelector((s) => s.workouts.sessions);
  const sessions = planId
    ? allSessions.filter((s) => s.plan_id === planId)
    : allSessions;

  const [sessionName, setSessionName] = useState("");
  const [scheduledDate, setScheduledDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sessionName.trim()) return;
    dispatch(addWorkoutSession({
      plan_id: planId ?? null,
      name: sessionName.trim(),
      scheduled_date: scheduledDate,
      notes: notes.trim() || null,
    }));
    setSessionName("");
    setNotes("");
  };

  const completedCount = sessions.filter((s) => s.completed).length;

  return (
    <div>
      <div style={CARD_PADDED}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Timer size={18} color="var(--accent)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Log Session</span>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={SECTION_LABEL}>Session Name</label>
            <input style={INPUT_STYLE} value={sessionName} onChange={(e) => setSessionName(e.target.value)} placeholder="e.g. Upper Body Push" required />
          </div>
          <div style={{ marginBottom: 12 }}>
            <label style={SECTION_LABEL}>Scheduled Date</label>
            <input style={INPUT_STYLE} type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} required />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={SECTION_LABEL}>Notes (optional)</label>
            <textarea
              style={{ ...INPUT_STYLE, resize: "vertical", minHeight: 60 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How was the session?"
            />
          </div>
          <button type="submit" style={BTN_PRIMARY}>
            <Plus size={14} /> Add Session
          </button>
        </form>
      </div>

      {sessions.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
            Sessions ({sessions.length})
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {completedCount}/{sessions.length} completed
          </span>
        </div>
      )}

      {sessions.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 14, textAlign: "center", padding: "16px 0" }}>
          {planId ? "No sessions for this plan yet." : "No sessions yet."}
        </p>
      ) : (
        sessions.map((session) => {
          const isExpanded = expandedId === session.id;
          return (
            <div key={session.id} style={{ ...CARD_TIGHT, borderColor: session.completed ? "var(--success)" : "var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button
                  onClick={() => { if (!session.completed) dispatch(completeWorkoutSession(session.id)); }}
                  style={{ ...ICON_BTN, padding: 0, cursor: session.completed ? "default" : "pointer", color: session.completed ? "var(--success)" : "var(--border)", flexShrink: 0 }}
                  title={session.completed ? "Completed" : "Mark complete"}
                >
                  <CheckCircle2 size={18} />
                </button>

                <div style={{ flex: 1, minWidth: 0, cursor: "pointer" }} onClick={() => setExpandedId((p) => (p === session.id ? null : session.id))}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <ChevronRight
                      size={14}
                      color="var(--text-muted)"
                      style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.15s", flexShrink: 0 }}
                    />
                    <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: session.completed ? "line-through" : "none", opacity: session.completed ? 0.6 : 1 }}>
                      {session.name}
                    </span>
                  </div>
                  <div style={{ paddingLeft: 20, marginTop: 2 }}>
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {new Date(session.scheduled_date).toLocaleDateString()}
                    </span>
                  </div>
                </div>

                <button onClick={() => dispatch(removeWorkoutSession(session.id))} style={{ ...ICON_BTN, flexShrink: 0 }}>
                  <Trash2 size={14} />
                </button>
              </div>

              {isExpanded && (
                <>
                  {session.notes && (
                    <p style={{ marginTop: 10, paddingLeft: 26, fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
                      {session.notes}
                    </p>
                  )}
                  <ExerciseList session={session} />
                </>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
