import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks/useAppDispatch";
import { fetchEntries, deleteEntry, editEntry } from "../store/slices/entriesSlice";
import { resumeFromEntry } from "../store/slices/timerSlice";
import { formatDateTime, formatDuration, todayISO, weekStartISO, monthStartISO } from "../lib/formatters";
import Modal from "../components/shared/Modal";
import type { TimeEntry } from "../store/types";

type Period = "all" | "today" | "week" | "month";

const PERIODS: { label: string; value: Period }[] = [
  { label: "All", value: "all" },
  { label: "Today", value: "today" },
  { label: "This Week", value: "week" },
  { label: "This Month", value: "month" },
];

export default function HistoryPage() {
  const dispatch = useAppDispatch();
  const { items, loading } = useAppSelector((s) => s.entries);
  const timerStatus = useAppSelector((s) => s.timer.status);
  const [period, setPeriod] = useState<Period>("today");
  const [editTarget, setEditTarget] = useState<TimeEntry | null>(null);
  const [editTask, setEditTask] = useState("");
  const [editProject, setEditProject] = useState("");
  const [editTags, setEditTags] = useState("");

  const load = (p: Period) => {
    const today = todayISO();
    const ranges: Record<Period, { startDate?: string; endDate?: string }> = {
      all: {},
      today: { startDate: today, endDate: today },
      week: { startDate: weekStartISO(), endDate: today },
      month: { startDate: monthStartISO(), endDate: today },
    };
    dispatch(fetchEntries({ ...ranges[p], limit: 500 }));
  };

  useEffect(() => {
    load(period);
  }, []);

  const handlePeriod = (p: Period) => {
    setPeriod(p);
    load(p);
  };

  const handleEdit = () => {
    if (!editTarget) return;
    dispatch(
      editEntry({
        entryId: editTarget.id,
        taskName: editTask || undefined,
        project: editProject || undefined,
        tags: editTags || undefined,
      })
    );
    setEditTarget(null);
  };

  const openEdit = (e: TimeEntry) => {
    setEditTarget(e);
    setEditTask(e.task_name);
    setEditProject(e.project ?? "");
    setEditTags(e.tags ?? "");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Filter bar */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          display: "flex",
          gap: 6,
          flexShrink: 0,
        }}
      >
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => handlePeriod(p.value)}
            style={{
              padding: "5px 12px",
              fontSize: 12,
              borderRadius: "var(--radius-sm)",
              background: period === p.value ? "var(--accent)" : "var(--surface-raised)",
              color: period === p.value ? "var(--accent-fg)" : "var(--text-secondary)",
              border: "1px solid var(--border)",
            }}
          >
            {p.label}
          </button>
        ))}
        <div style={{ marginLeft: "auto", fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
          {!loading && `${items.length} entries`}
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
        {loading ? (
          <p style={{ color: "var(--text-muted)", padding: "16px 0" }}>Loading…</p>
        ) : items.length === 0 ? (
          <p style={{ color: "var(--text-muted)", padding: "16px 0" }}>No entries for this period.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {items.map((entry) => (
              <div
                key={entry.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  background: "var(--surface)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontWeight: 500,
                      fontSize: 13,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.task_name}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    {entry.project && <span>{entry.project} · </span>}
                    {formatDateTime(entry.start_time)}
                  </div>
                </div>
                <div
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {formatDuration(entry.duration_seconds)}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {timerStatus === "idle" && (
                    <button
                      onClick={() => dispatch(resumeFromEntry({ entryId: entry.id }))}
                      style={{
                        background: "var(--surface-raised)",
                        color: "var(--text-secondary)",
                        padding: "4px 10px",
                        fontSize: 12,
                        border: "1px solid var(--border)",
                      }}
                      title="Resume"
                    >
                      ▶
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(entry)}
                    style={{
                      background: "var(--surface-raised)",
                      color: "var(--text-secondary)",
                      padding: "4px 10px",
                      fontSize: 12,
                      border: "1px solid var(--border)",
                    }}
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    onClick={() => dispatch(deleteEntry(entry.id))}
                    style={{ background: "transparent", color: "var(--danger)", padding: "4px 8px", fontSize: 12 }}
                    title="Delete"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Entry">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="Task name" value={editTask} onChange={(e) => setEditTask(e.target.value)} />
          <input placeholder="Project" value={editProject} onChange={(e) => setEditProject(e.target.value)} />
          <input placeholder="Tags" value={editTags} onChange={(e) => setEditTags(e.target.value)} />
          <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
            <button
              onClick={handleEdit}
              style={{
                flex: 1,
                background: "var(--accent)",
                color: "var(--accent-fg)",
                padding: "9px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Save
            </button>
            <button
              onClick={() => setEditTarget(null)}
              style={{
                flex: 1,
                background: "var(--surface-raised)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                padding: "9px",
                borderRadius: "var(--radius-sm)",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
