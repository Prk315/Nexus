import { useState } from "react";
import { Plus, Trash2, CheckCircle2, PlayCircle } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addRunningSession,
  completeRunningSession,
  removeRunningSession,
} from "../../store/slices/runningSlice";
import { CARD_PADDED, CARD_TIGHT, INPUT_STYLE, SECTION_LABEL, BTN_PRIMARY, ICON_BTN } from "../../lib/uiHelpers";

interface RunningSessionLoggerProps {
  planId?: string | null;
}

function parsePace(raw: string): number | null {
  const parts = raw.trim().split(":");
  if (parts.length !== 2) return null;
  const mins = parseInt(parts[0], 10);
  const secs = parseInt(parts[1], 10);
  if (isNaN(mins) || isNaN(secs) || secs >= 60) return null;
  return mins * 60 + secs;
}

function formatPace(sPerKm: number | null): string {
  if (sPerKm == null) return "—";
  const mins = Math.floor(sPerKm / 60);
  const secs = sPerKm % 60;
  return `${mins}:${secs.toString().padStart(2, "0")} /km`;
}

const btnSmall: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "4px 10px",
  background: "none",
  border: "1px solid var(--accent)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  color: "var(--accent)",
  cursor: "pointer",
  fontWeight: 500,
};

function CompleteModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const [actualKm, setActualKm] = useState("");
  const [pace, setPace] = useState("");
  const [hr, setHr] = useState("");

  const handleComplete = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(completeRunningSession({
      id: sessionId,
      actualKm: actualKm ? Number(actualKm) : undefined,
      avgPaceSPerKm: parsePace(pace) ?? undefined,
      heartRateAvg: hr ? Number(hr) : undefined,
    }));
    onClose();
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--surface)", borderRadius: "var(--radius)", padding: 24, width: 340, border: "1px solid var(--border)", boxShadow: "var(--shadow-md)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <p style={{ fontWeight: 600, fontSize: 15, color: "var(--text)", marginBottom: 16 }}>Complete Session</p>
        <form onSubmit={handleComplete}>
          <div style={{ marginBottom: 10 }}>
            <label style={SECTION_LABEL}>Actual Distance (km)</label>
            <input style={INPUT_STYLE} type="number" value={actualKm} onChange={(e) => setActualKm(e.target.value)} placeholder="e.g. 8.2" min={0} step={0.1} />
          </div>
          <div style={{ marginBottom: 10 }}>
            <label style={SECTION_LABEL}>Avg Pace (mm:ss)</label>
            <input style={INPUT_STYLE} value={pace} onChange={(e) => setPace(e.target.value)} placeholder="e.g. 5:30" />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={SECTION_LABEL}>Avg Heart Rate (bpm)</label>
            <input style={INPUT_STYLE} type="number" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="e.g. 148" min={0} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" style={BTN_PRIMARY}>Mark Complete</button>
            <button type="button" onClick={onClose} style={{ ...BTN_PRIMARY, background: "var(--border)", color: "var(--text)" }}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function RunningSessionLogger({ planId }: RunningSessionLoggerProps) {
  const dispatch = useAppDispatch();
  const allSessions = useAppSelector((s) => s.running.sessions);
  const sessions = planId
    ? allSessions.filter((s) => s.plan_id === planId)
    : allSessions;

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [plannedKm, setPlannedKm] = useState("");
  const [actualKm, setActualKm] = useState("");
  const [pace, setPace] = useState("");
  const [hr, setHr] = useState("");
  const [notes, setNotes] = useState("");
  const [completingId, setCompletingId] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    dispatch(addRunningSession({
      plan_id: planId ?? null,
      date,
      planned_km: plannedKm ? Number(plannedKm) : null,
      actual_km: actualKm ? Number(actualKm) : null,
      avg_pace_s_per_km: parsePace(pace),
      heart_rate_avg: hr ? Number(hr) : null,
      notes: notes.trim() || null,
    }));
    setPlannedKm(""); setActualKm(""); setPace(""); setHr(""); setNotes("");
  };

  const completedCount = sessions.filter((s) => s.completed).length;

  return (
    <div>
      <div style={CARD_PADDED}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <PlayCircle size={18} color="var(--accent)" />
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>Log Run</span>
        </div>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <label style={SECTION_LABEL}>Date</label>
            <input style={INPUT_STYLE} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={SECTION_LABEL}>Planned km</label>
              <input style={INPUT_STYLE} type="number" value={plannedKm} onChange={(e) => setPlannedKm(e.target.value)} placeholder="e.g. 8" min={0} step={0.1} />
            </div>
            <div>
              <label style={SECTION_LABEL}>Actual km</label>
              <input style={INPUT_STYLE} type="number" value={actualKm} onChange={(e) => setActualKm(e.target.value)} placeholder="e.g. 7.8" min={0} step={0.1} />
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div>
              <label style={SECTION_LABEL}>Avg Pace (mm:ss /km)</label>
              <input style={INPUT_STYLE} value={pace} onChange={(e) => setPace(e.target.value)} placeholder="e.g. 5:30" />
            </div>
            <div>
              <label style={SECTION_LABEL}>Avg Heart Rate (bpm)</label>
              <input style={INPUT_STYLE} type="number" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="e.g. 148" min={0} />
            </div>
          </div>
          <div style={{ marginBottom: 16 }}>
            <label style={SECTION_LABEL}>Notes (optional)</label>
            <textarea
              style={{ ...INPUT_STYLE, resize: "vertical", minHeight: 60 }}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="How did the run feel?"
            />
          </div>
          <button type="submit" style={BTN_PRIMARY}>
            <Plus size={14} /> Log Run
          </button>
        </form>
      </div>

      {sessions.length > 0 && (
        <div style={{ marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>Run Log ({sessions.length})</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{completedCount}/{sessions.length} completed</span>
        </div>
      )}

      {sessions.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 14, textAlign: "center", padding: "16px 0" }}>
          {planId ? "No runs logged for this plan yet." : "No runs logged yet."}
        </p>
      ) : (
        sessions.map((session) => (
          <div key={session.id} style={{ ...CARD_TIGHT, borderColor: session.completed ? "var(--success)" : "var(--border)" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <CheckCircle2
                size={18}
                color={session.completed ? "var(--success)" : "var(--border)"}
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
                    {new Date(session.date).toLocaleDateString()}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                    {!session.completed && (
                      <button onClick={() => setCompletingId(session.id)} style={btnSmall}>
                        <CheckCircle2 size={12} /> Complete
                      </button>
                    )}
                    <button onClick={() => dispatch(removeRunningSession(session.id))} style={ICON_BTN}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 16, marginTop: 6, flexWrap: "wrap" }}>
                  {(session.planned_km != null || session.actual_km != null) && (
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      {session.actual_km != null ? `${session.actual_km} km` : "—"}
                      {session.planned_km != null && ` / ${session.planned_km} km planned`}
                    </span>
                  )}
                  {session.avg_pace_s_per_km != null && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {formatPace(session.avg_pace_s_per_km)}
                    </span>
                  )}
                  {session.heart_rate_avg != null && (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      {session.heart_rate_avg} bpm
                    </span>
                  )}
                </div>
                {session.notes && (
                  <p style={{ marginTop: 6, fontSize: 13, color: "var(--text-secondary)", fontStyle: "italic" }}>
                    {session.notes}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {completingId && (
        <CompleteModal sessionId={completingId} onClose={() => setCompletingId(null)} />
      )}
    </div>
  );
}
