import { useState, useEffect } from "react";
import { addManualEntry, getAllProjects, syncWidgetState } from "../lib/tauriApi";

interface Props {
  onClose: () => void;
  onSaved: () => void;
}

function toLocalDatetimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

function durationLabel(startIso: string, endIso: string): string {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const secs = Math.floor((e.getTime() - s.getTime()) / 1000);
  if (secs <= 0) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function QuickSessionSheet({ onClose, onSaved }: Props) {
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 3600 * 1000);

  const [taskName, setTaskName] = useState("");
  const [project, setProject] = useState("");
  const [startTime, setStartTime] = useState(toLocalDatetimeString(oneHourAgo));
  const [endTime, setEndTime] = useState(toLocalDatetimeString(now));
  const [notes, setNotes] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getAllProjects().then(setProjects).catch(() => {});
  }, []);

  const duration = durationLabel(startTime, endTime);
  const canSave = taskName.trim().length > 0 && duration !== "";

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    setError("");
    try {
      await addManualEntry({
        taskName: taskName.trim(),
        project: project.trim() || undefined,
        startTime,
        endTime,
        notes: notes.trim() || undefined,
        billable: false,
        hourlyRate: 0,
      });
      syncWidgetState();
      onSaved();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg)",
    color: "var(--text)",
    fontSize: 15,
    outline: "none",
    boxSizing: "border-box",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    marginBottom: 4,
    display: "block",
  };

  return (
    /* Backdrop */
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        zIndex: 1000,
        display: "flex",
        alignItems: "flex-end",
      }}
    >
      {/* Sheet */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          background: "var(--surface)",
          borderRadius: "16px 16px 0 0",
          padding: "20px 20px 40px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        {/* Handle + header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: "var(--border)",
              margin: "0 auto",
              position: "absolute",
              left: "50%",
              transform: "translateX(-50%)",
              top: 10,
            }}
          />
          <span style={{ fontSize: 17, fontWeight: 700, marginTop: 8 }}>Log Past Session</span>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 24,
              cursor: "pointer",
              padding: "0 4px",
              marginTop: 8,
            }}
          >
            ×
          </button>
        </div>

        {/* Task name */}
        <div>
          <label style={labelStyle}>Task *</label>
          <input
            style={inputStyle}
            placeholder="What were you working on?"
            value={taskName}
            onChange={(e) => setTaskName(e.target.value)}
            autoFocus
          />
        </div>

        {/* Project */}
        <div>
          <label style={labelStyle}>Project</label>
          <input
            style={inputStyle}
            placeholder="Optional"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            list="project-list"
          />
          <datalist id="project-list">
            {projects.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>

        {/* Start / End time row */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>Start</label>
            <input
              type="datetime-local"
              style={inputStyle}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={labelStyle}>End</label>
            <input
              type="datetime-local"
              style={inputStyle}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
        </div>

        {/* Duration pill */}
        {duration && (
          <div style={{ textAlign: "center" }}>
            <span
              style={{
                display: "inline-block",
                padding: "4px 14px",
                borderRadius: 20,
                background: "rgba(249,115,22,0.12)",
                color: "#f97316",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {duration}
            </span>
          </div>
        )}

        {/* Notes */}
        <div>
          <label style={labelStyle}>Notes</label>
          <textarea
            style={{ ...inputStyle, minHeight: 64, resize: "none", fontFamily: "inherit" }}
            placeholder="Optional"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {error && (
          <p style={{ color: "var(--error, #ef4444)", fontSize: 13, margin: 0 }}>{error}</p>
        )}

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={!canSave || saving}
          style={{
            width: "100%",
            padding: "14px",
            borderRadius: 12,
            border: "none",
            background: canSave ? "#f97316" : "var(--border)",
            color: canSave ? "#fff" : "var(--text-muted)",
            fontSize: 16,
            fontWeight: 700,
            cursor: canSave ? "pointer" : "not-allowed",
            transition: "background 0.15s",
          }}
        >
          {saving ? "Saving…" : "Log Session"}
        </button>
      </div>
    </div>
  );
}
