import { useState, type CSSProperties } from "react";
import type { PfCalEntry } from "../lib/pathfinderCalendar";
import {
  createBlock,
  updateBlock,
  deleteBlock,
  createSeries,
  updateSeries,
  deleteSeries,
} from "../lib/pathfinderCalendar";

// State the host passes when opening the editor.
export type CalEditorState =
  | { mode: "create"; date: string; startTime: string }
  | { mode: "edit"; entry: PfCalEntry };

const COLORS = [
  "#3b82f6", "#ef4444", "#f59e0b", "#10b981",
  "#8b5cf6", "#ec4899", "#14b8a6", "#6b7280",
];
const DOW = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** end = start + 1h (clamped), preserving minutes. */
function addHour(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const nh = Math.min(23, (h ?? 0) + 1);
  return `${String(nh).padStart(2, "0")}:${String(m ?? 0).padStart(2, "0")}`;
}

const inputStyle: CSSProperties = {
  background: "var(--bg-raised)",
  border: "1px solid var(--border-base)",
  color: "var(--fg-main)",
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 13,
  outline: "none",
  width: "100%",
};

export function CalendarBlockEditor({
  state,
  onClose,
  onSaved,
}: {
  state: CalEditorState;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = state.mode === "edit" ? state.entry : null;
  const isRecurring = editing?.kind === "recurring";
  const baseDate = state.mode === "create" ? state.date : editing!.date;
  const seedStart =
    editing?.startTime ?? (state.mode === "create" ? state.startTime : "09:00");

  const [title, setTitle] = useState(editing?.title ?? "");
  const [start, setStart] = useState(seedStart);
  const [end, setEnd] = useState(editing?.endTime ?? addHour(seedStart));
  const [color, setColor] = useState(editing?.color ?? COLORS[0]);
  const [description, setDescription] = useState(editing?.description ?? "");

  // Repeat: create can pick none/daily/weekly; a recurring edit stays daily/weekly.
  const [repeat, setRepeat] = useState<"none" | "daily" | "weekly">(
    isRecurring ? (editing!.recurrence as "daily" | "weekly") : "none"
  );
  const defaultDow = new Date(baseDate + "T00:00:00Z").getUTCDay();
  const [days, setDays] = useState<Set<number>>(() => {
    const src = isRecurring ? editing!.daysOfWeek : null;
    return src ? new Set(src.split(",").map(Number)) : new Set([defaultDow]);
  });
  const [until, setUntil] = useState<string>(
    isRecurring ? editing!.endDate ?? "" : ""
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showRepeat = state.mode === "create" || isRecurring;
  const showDays = repeat === "weekly";

  const toggleDay = (d: number) =>
    setDays((prev) => {
      const n = new Set(prev);
      n.has(d) ? n.delete(d) : n.add(d);
      return n;
    });

  async function save() {
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (start >= end) {
      setError("End must be after start");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const daysStr = [...days].sort((a, b) => a - b).join(",");
      if (state.mode === "create") {
        if (repeat === "none") {
          await createBlock({
            date: state.date, title: title.trim(), startTime: start,
            endTime: end, color, description: description || null,
          });
        } else {
          await createSeries({
            title: title.trim(), startTime: start, endTime: end, color,
            recurrence: repeat, daysOfWeek: repeat === "weekly" ? daysStr : null,
            startDate: state.date, endDate: until || null,
            description: description || null,
          });
        }
      } else if (isRecurring) {
        await updateSeries(editing!.sourceId, {
          title: title.trim(), startTime: start, endTime: end, color,
          recurrence: repeat === "none" ? "weekly" : repeat,
          daysOfWeek: repeat === "daily" ? null : daysStr,
          endDate: until || null, description: description || null,
        });
      } else {
        await updateBlock(editing!.sourceId, {
          title: title.trim(), startTime: start, endTime: end, color,
          description: description || null,
        });
      }
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      if (isRecurring) await deleteSeries(editing.sourceId);
      else await deleteBlock(editing.sourceId);
      onSaved();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
      setBusy(false);
    }
  }

  const heading =
    state.mode === "create"
      ? "New block"
      : isRecurring
      ? "Edit recurring series"
      : "Edit block";

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(0,0,0,0.35)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 360, maxWidth: "92vw",
          background: "var(--bg-base)", color: "var(--fg-main)",
          border: "1px solid var(--border-base)", borderRadius: 14,
          boxShadow: "0 12px 40px rgba(0,0,0,0.25)", padding: 18,
          display: "flex", flexDirection: "column", gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{heading}</h3>
          <span style={{ fontSize: 11, color: "var(--fg-muted)" }}>PathFinder</span>
        </div>

        {isRecurring && (
          <p style={{ margin: 0, fontSize: 11, color: "var(--fg-muted)", lineHeight: 1.4 }}>
            🔁 Changes apply to the whole series. Editing a single occurrence is coming soon.
          </p>
        )}

        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          style={inputStyle}
        />

        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ flex: 1, fontSize: 11, color: "var(--fg-muted)" }}>
            Start
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
          </label>
          <label style={{ flex: 1, fontSize: 11, color: "var(--fg-muted)" }}>
            End
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              title={c}
              style={{
                width: 22, height: 22, borderRadius: "50%", background: c,
                border: color === c ? "2px solid var(--fg-main)" : "2px solid transparent",
                cursor: "pointer",
              }}
            />
          ))}
          <input
            type="color" value={color} onChange={(e) => setColor(e.target.value)}
            title="Custom color"
            style={{ width: 26, height: 26, border: "none", background: "none", cursor: "pointer", padding: 0 }}
          />
        </div>

        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notes (optional)"
          rows={2}
          style={{ ...inputStyle, resize: "vertical" }}
        />

        {showRepeat && (
          <label style={{ fontSize: 11, color: "var(--fg-muted)" }}>
            Repeat
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as "none" | "daily" | "weekly")}
              style={{ ...inputStyle, marginTop: 4 }}
            >
              {state.mode === "create" && <option value="none">Does not repeat</option>}
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
            </select>
          </label>
        )}

        {showDays && (
          <div style={{ display: "flex", gap: 4 }}>
            {DOW.map((label, d) => (
              <button
                key={d}
                onClick={() => toggleDay(d)}
                style={{
                  flex: 1, padding: "5px 0", fontSize: 11, borderRadius: 6, cursor: "pointer",
                  border: "1px solid var(--border-base)",
                  background: days.has(d) ? "var(--fg-main)" : "var(--bg-raised)",
                  color: days.has(d) ? "var(--bg-base)" : "var(--fg-muted)",
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {showRepeat && repeat !== "none" && (
          <label style={{ fontSize: 11, color: "var(--fg-muted)" }}>
            Until (optional)
            <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} style={{ ...inputStyle, marginTop: 4 }} />
          </label>
        )}

        {error && (
          <div style={{ fontSize: 12, color: "#ef4444" }}>{error}</div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          {editing && (
            <button
              onClick={remove}
              disabled={busy}
              style={{
                fontSize: 12, color: "#ef4444", background: "none",
                border: "1px solid #ef444455", borderRadius: 8, padding: "6px 10px", cursor: "pointer",
              }}
            >
              {isRecurring ? "Delete series" : "Delete"}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            disabled={busy}
            style={{
              fontSize: 12, color: "var(--fg-muted)", background: "none",
              border: "1px solid var(--border-base)", borderRadius: 8, padding: "6px 12px", cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={busy}
            style={{
              fontSize: 12, fontWeight: 600, color: "var(--bg-base)",
              background: "var(--fg-main)", border: "none", borderRadius: 8,
              padding: "6px 14px", cursor: "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
