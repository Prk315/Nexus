import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks/useAppDispatch";
import { useTimer } from "../hooks/useTimer";
import {
  cancelPaused,
  pauseTimer,
  resumeFromEntry,
  resumeTimer,
  startTimer,
  stopTimer,
} from "../store/slices/timerSlice";
import { fetchEntries, fetchStatistics } from "../store/slices/entriesSlice";
import { updateCategories } from "../store/slices/categoriesSlice";
import DurationDisplay from "../components/shared/DurationDisplay";
import PomodoroRing from "../components/timer/PomodoroRing";
import ProjectPicker from "../components/timer/ProjectPicker";
import { formatHours, todayISO } from "../lib/formatters";
import type { TimeEntry } from "../store/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Most-recent entry per project (for resume button) */
function latestEntryByProject(entries: TimeEntry[]): Map<string, TimeEntry> {
  const map = new Map<string, TimeEntry>();
  for (const e of entries) {
    const key = e.project ?? "__none__";
    const existing = map.get(key);
    if (!existing || e.id > existing.id) map.set(key, e);
  }
  return map;
}

// ── Top-left: Timer start / Active session ────────────────────────────────────

function TimerStartPanel() {
  const dispatch = useAppDispatch();
  const { status, elapsedSeconds, active, paused, pomodoroEnabled, pomodoroPhase, pomodoroSecondsRemaining } =
    useAppSelector((s) => s.timer);
  const settings = useAppSelector((s) => s.settings);

  const [taskName, setTaskName] = useState("");
  const [project, setProject] = useState<string | undefined>();
  const [billable, setBillable] = useState(false);

  const handleStart = (overrideName?: string, overrideProject?: string) => {
    const name = overrideName ?? taskName.trim();
    if (!name) return;
    dispatch(
      startTimer({
        taskName: name,
        project: overrideProject ?? project,
        billable,
        hourlyRate: settings.config?.default_hourly_rate ?? 0,
      })
    );
    setTaskName("");
    setProject(undefined);
  };

  const isRunning = status === "running";
  const isPaused = status === "paused";
  const isActive = isRunning || isPaused;

  const pomodoroTotal =
    pomodoroPhase === "work"
      ? settings.pomodoro.workMinutes * 60
      : pomodoroPhase === "break"
      ? settings.pomodoro.breakMinutes * 60
      : settings.pomodoro.longBreakMinutes * 60;

  const activeTaskName = active?.task_name ?? paused?.task_name ?? "";
  const activeProject = active?.project ?? paused?.project ?? null;

  if (isActive) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: "20px 20px", height: "100%" }}>
        {/* Big elapsed time */}
        <div style={{ textAlign: "center", marginTop: "auto" }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {pomodoroEnabled && isRunning && (
              <div style={{ position: "absolute" }}>
                <PomodoroRing
                  totalSeconds={pomodoroTotal}
                  remainingSeconds={pomodoroSecondsRemaining}
                  phase={pomodoroPhase}
                  size={120}
                />
              </div>
            )}
            <DurationDisplay seconds={elapsedSeconds} large />
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 500, color: "var(--text)" }}>{activeTaskName}</div>
            {activeProject && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{activeProject}</div>
            )}
            {isPaused && (
              <div
                style={{
                  display: "inline-block",
                  marginTop: 6,
                  fontSize: 11,
                  color: "var(--text-muted)",
                  background: "var(--surface-raised)",
                  border: "1px solid var(--border)",
                  borderRadius: 10,
                  padding: "2px 10px",
                }}
              >
                Paused
              </div>
            )}
          </div>
        </div>

        {/* Controls */}
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: "auto" }}>
          {isRunning && (
            <>
              <button
                onClick={() => dispatch(pauseTimer())}
                style={btnSecondary}
              >
                Pause
              </button>
              <button onClick={() => dispatch(stopTimer())} style={btnDanger}>
                Stop
              </button>
            </>
          )}
          {isPaused && (
            <>
              <button onClick={() => dispatch(resumeTimer())} style={btnPrimary}>
                Resume
              </button>
              <button onClick={() => dispatch(stopTimer())} style={btnSecondary}>
                Stop
              </button>
              <button onClick={() => dispatch(cancelPaused())} style={btnGhost}>
                Discard
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: "20px 20px", height: "100%", justifyContent: "center" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
        Start tracking
      </div>
      <input
        placeholder="What are you working on?"
        value={taskName}
        onChange={(e) => setTaskName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleStart()}
        autoFocus
        style={{ fontSize: 14 }}
      />
      <ProjectPicker value={project} onChange={setProject} />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          onClick={() => handleStart()}
          disabled={!taskName.trim()}
          style={{ ...btnPrimary, flex: 1, opacity: !taskName.trim() ? 0.4 : 1 }}
        >
          Start
        </button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)", cursor: "pointer", flexShrink: 0 }}>
          <input
            type="checkbox"
            checked={billable}
            onChange={(e) => setBillable(e.target.checked)}
            style={{ width: "auto" }}
          />
          Billable
        </label>
      </div>
    </div>
  );
}

// ── Top-right: Recent projects with stats ─────────────────────────────────────

function RecentProjectsPanel({ entries }: { entries: TimeEntry[] }) {
  const dispatch = useAppDispatch();
  const stats = useAppSelector((s) => s.entries.statistics);
  const timerStatus = useAppSelector((s) => s.timer.status);

  const latestByProject = latestEntryByProject(entries);
  const canResume = timerStatus === "idle";

  if (!stats || stats.by_project.length === 0) {
    return (
      <div style={{ padding: "20px 16px", color: "var(--text-muted)", fontSize: 13 }}>
        No activity yet today.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{
          padding: "14px 16px 8px",
          fontSize: 11,
          color: "var(--text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          flexShrink: 0,
        }}
      >
        Today's projects
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {stats.by_project.map((p) => {
          const key = p.project ?? "__none__";
          const latest = latestByProject.get(key);
          const pct = stats.total_seconds > 0 ? (p.total / stats.total_seconds) * 100 : 0;

          return (
            <div
              key={key}
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid var(--border)",
                display: "flex",
                flexDirection: "column",
                gap: 5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: "var(--text)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {p.project ?? "No project"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>
                    {p.count} {p.count === 1 ? "entry" : "entries"} · {formatHours(p.total)}
                  </div>
                </div>
                {canResume && latest && (
                  <button
                    onClick={() => dispatch(resumeFromEntry({ entryId: latest.id }))}
                    title={`Resume "${latest.task_name}"`}
                    style={{
                      padding: "5px 12px",
                      fontSize: 12,
                      borderRadius: "var(--radius-sm)",
                      border: "1px solid var(--border)",
                      background: "var(--surface-raised)",
                      color: "var(--text-secondary)",
                      flexShrink: 0,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--accent)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--accent)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                      (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)";
                    }}
                  >
                    ▶ Resume
                  </button>
                )}
              </div>
              {/* Progress bar */}
              <div style={{ height: 2, background: "var(--border)", borderRadius: 1, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${pct}%`,
                    background: "var(--accent)",
                    borderRadius: 1,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      {/* Total */}
      <div
        style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--border)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Total
        </span>
        <span style={{ fontSize: 18, fontWeight: 300, color: "var(--text)" }}>
          {formatHours(stats.total_seconds)}
        </span>
      </div>
    </div>
  );
}

// ── Bottom: Project browser with inline CRUD ──────────────────────────────────

function ProjectBrowser({ onStart }: { onStart: (taskName: string, project?: string) => void }) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((s) => s.categories.items);
  const timerStatus = useAppSelector((s) => s.timer.status);

  const [selectedCat, setSelectedCat] = useState<string | null>(null);

  // Inline rename
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renamingSub, setRenamingSub] = useState<{ cat: string; idx: number } | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { renameRef.current?.focus(); }, [renamingCat, renamingSub]);

  // Add-new inputs
  const [addingCat, setAddingCat] = useState(false);
  const [newCatVal, setNewCatVal] = useState("");
  const [addingSub, setAddingSub] = useState(false);
  const [newSubVal, setNewSubVal] = useState("");

  const canStart = timerStatus === "idle";

  const save = (updated: Record<string, string[]>) => dispatch(updateCategories(updated));

  // ── Category CRUD ──

  const commitAddCat = () => {
    const name = newCatVal.trim();
    if (name && !categories[name]) {
      save({ ...categories, [name]: [] });
      setSelectedCat(name);
    }
    setAddingCat(false);
    setNewCatVal("");
  };

  const commitRenameCat = (oldName: string) => {
    const name = renameVal.trim();
    setRenamingCat(null);
    if (!name || name === oldName) return;
    const entries = Object.entries(categories).map(([k, v]) =>
      k === oldName ? [name, v] : [k, v]
    ) as [string, string[]][];
    save(Object.fromEntries(entries));
    if (selectedCat === oldName) setSelectedCat(name);
  };

  const deleteCat = (cat: string) => {
    const updated = { ...categories };
    delete updated[cat];
    save(updated);
    if (selectedCat === cat) setSelectedCat(null);
  };

  // ── Sub-project CRUD ──

  const commitAddSub = (cat: string) => {
    const name = newSubVal.trim();
    if (name && !categories[cat].includes(name)) {
      save({ ...categories, [cat]: [...categories[cat], name] });
    }
    setAddingSub(false);
    setNewSubVal("");
  };

  const commitRenameSub = (cat: string, idx: number) => {
    const name = renameVal.trim();
    setRenamingSub(null);
    if (!name) return;
    const subs = categories[cat].map((s, i) => (i === idx ? name : s));
    save({ ...categories, [cat]: subs });
  };

  const deleteSub = (cat: string, idx: number) => {
    const subs = categories[cat].filter((_, i) => i !== idx);
    save({ ...categories, [cat]: subs });
  };

  const categoryNames = Object.keys(categories);
  const subs = selectedCat ? (categories[selectedCat] ?? []) : [];

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── Left column: projects ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {categoryNames.map((cat) => {
            const hasSubs = categories[cat].length > 0;
            const isSelected = selectedCat === cat;
            const isRenaming = renamingCat === cat;

            return (
              <div
                key={cat}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "0 8px 0 12px",
                  borderBottom: "1px solid var(--border)",
                  background: isSelected ? "var(--surface-raised)" : "transparent",
                  minHeight: 38,
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-raised)";
                  (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "1");
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent";
                  (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "0");
                }}
              >
                {/* Dot */}
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: isSelected ? "var(--accent)" : "var(--border)", flexShrink: 0 }} />

                {/* Name / rename input */}
                {isRenaming ? (
                  <input
                    ref={renameRef}
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={() => commitRenameCat(cat)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRenameCat(cat);
                      if (e.key === "Escape") setRenamingCat(null);
                    }}
                    style={{ flex: 1, fontSize: 13, padding: "2px 6px" }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    onDoubleClick={() => { setRenamingCat(cat); setRenameVal(cat); }}
                    onClick={() => {
                      if (hasSubs) setSelectedCat(isSelected ? null : cat);
                      else if (canStart) onStart(cat);
                    }}
                    style={{ flex: 1, fontSize: 13, fontWeight: isSelected ? 500 : 400, color: "var(--text)", cursor: "pointer", userSelect: "none", padding: "9px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {cat}
                    {hasSubs && <span style={{ marginLeft: 5, fontSize: 10, color: "var(--text-muted)", fontWeight: 400 }}>{isSelected ? "▾" : "›"}</span>}
                    {!hasSubs && canStart && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>start</span>}
                  </span>
                )}

                {/* Hover actions */}
                <span className="row-actions" style={{ display: "flex", gap: 2, opacity: 0, transition: "opacity 0.1s" }}>
                  <button
                    onClick={(e) => { e.stopPropagation(); setRenamingCat(cat); setRenameVal(cat); }}
                    style={miniBtn} title="Rename"
                  >✎</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteCat(cat); }}
                    style={{ ...miniBtn, color: "var(--danger)" }} title="Delete"
                  >✕</button>
                </span>
              </div>
            );
          })}

          {/* Add category inline input */}
          {addingCat ? (
            <div style={{ display: "flex", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
              <input
                autoFocus
                placeholder="Project name"
                value={newCatVal}
                onChange={(e) => setNewCatVal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitAddCat();
                  if (e.key === "Escape") { setAddingCat(false); setNewCatVal(""); }
                }}
                style={{ flex: 1, fontSize: 12, padding: "3px 6px" }}
              />
              <button onClick={commitAddCat} style={addConfirmBtn}>Add</button>
              <button onClick={() => { setAddingCat(false); setNewCatVal(""); }} style={addCancelBtn}>✕</button>
            </div>
          ) : null}
        </div>

        {/* Add project button */}
        <button
          onClick={() => { setAddingCat(true); setNewCatVal(""); }}
          style={{
            padding: "8px 12px",
            fontSize: 12,
            color: "var(--text-muted)",
            background: "transparent",
            borderTop: "1px solid var(--border)",
            textAlign: "left",
            cursor: "pointer",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
        >
          + Add project
        </button>
      </div>

      {/* ── Right column: sub-projects ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", background: "var(--bg)" }}>
        {!selectedCat ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-muted)", fontSize: 12 }}>
            Select a project
          </div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {subs.length === 0 && !addingSub && (
                <div style={{ padding: "16px 14px", color: "var(--text-muted)", fontSize: 12 }}>
                  No sub-projects yet.
                </div>
              )}

              {subs.map((sub, idx) => {
                const isRenaming = renamingSub?.cat === selectedCat && renamingSub?.idx === idx;
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 4,
                      padding: "0 8px 0 12px",
                      borderBottom: "1px solid var(--border)",
                      minHeight: 38,
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "var(--surface-raised)";
                      (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "1");
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLDivElement).style.background = "transparent";
                      (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "0");
                    }}
                  >
                    {isRenaming ? (
                      <input
                        ref={renameRef}
                        value={renameVal}
                        onChange={(e) => setRenameVal(e.target.value)}
                        onBlur={() => commitRenameSub(selectedCat, idx)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRenameSub(selectedCat, idx);
                          if (e.key === "Escape") setRenamingSub(null);
                        }}
                        style={{ flex: 1, fontSize: 13, padding: "2px 6px" }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        onDoubleClick={() => { setRenamingSub({ cat: selectedCat, idx }); setRenameVal(sub); }}
                        onClick={() => canStart && onStart(sub, selectedCat)}
                        style={{ flex: 1, fontSize: 13, color: "var(--text)", cursor: canStart ? "pointer" : "default", userSelect: "none", padding: "9px 0" }}
                      >
                        {sub}
                        {canStart && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>start</span>}
                      </span>
                    )}

                    <span className="row-actions" style={{ display: "flex", gap: 2, opacity: 0, transition: "opacity 0.1s" }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingSub({ cat: selectedCat, idx }); setRenameVal(sub); }}
                        style={miniBtn} title="Rename"
                      >✎</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); deleteSub(selectedCat, idx); }}
                        style={{ ...miniBtn, color: "var(--danger)" }} title="Delete"
                      >✕</button>
                    </span>
                  </div>
                );
              })}

              {addingSub && (
                <div style={{ display: "flex", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <input
                    autoFocus
                    placeholder="Sub-project name"
                    value={newSubVal}
                    onChange={(e) => setNewSubVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitAddSub(selectedCat);
                      if (e.key === "Escape") { setAddingSub(false); setNewSubVal(""); }
                    }}
                    style={{ flex: 1, fontSize: 12, padding: "3px 6px" }}
                  />
                  <button onClick={() => commitAddSub(selectedCat)} style={addConfirmBtn}>Add</button>
                  <button onClick={() => { setAddingSub(false); setNewSubVal(""); }} style={addCancelBtn}>✕</button>
                </div>
              )}
            </div>

            {/* Add sub-project button */}
            <button
              onClick={() => { setAddingSub(true); setNewSubVal(""); }}
              style={{
                padding: "8px 12px",
                fontSize: 12,
                color: "var(--text-muted)",
                background: "transparent",
                borderTop: "1px solid var(--border)",
                textAlign: "left",
                cursor: "pointer",
                flexShrink: 0,
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
            >
              + Add sub-project
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Main dashboard ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  useTimer();
  const dispatch = useAppDispatch();
  const { status } = useAppSelector((s) => s.timer);
  const settings = useAppSelector((s) => s.settings);
  const entries = useAppSelector((s) => s.entries.items);

  const loadToday = () => {
    const today = todayISO();
    dispatch(fetchEntries({ startDate: today, endDate: today, limit: 200 }));
    dispatch(fetchStatistics({ startDate: today, endDate: today }));
  };

  useEffect(() => { loadToday(); }, []);
  useEffect(() => { if (status === "idle") loadToday(); }, [status]);

  const handleQuickStart = (taskName: string, project?: string) => {
    if (status !== "idle") return;
    dispatch(
      startTimer({
        taskName,
        project,
        billable: false,
        hourlyRate: settings.config?.default_hourly_rate ?? 0,
      })
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

      {/* ── Row 1 ──────────────────────────────────────────────────────────── */}
      <div style={{ flex: "0 0 58%", display: "flex", borderBottom: "1px solid var(--border)", overflow: "hidden" }}>

        {/* Top-left: timer start / active session */}
        <div
          style={{
            flex: 2,
            borderRight: "1px solid var(--border)",
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TimerStartPanel />
        </div>

        {/* Top-right: recent projects */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <RecentProjectsPanel entries={entries} />
        </div>
      </div>

      {/* ── Row 2: project browser ─────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div
          style={{
            padding: "8px 16px 6px",
            fontSize: 11,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            background: "var(--surface)",
          }}
        >
          Quick start
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ProjectBrowser onStart={handleQuickStart} />
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}

// ── Button styles ─────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: "var(--radius-sm)",
  background: "var(--accent)",
  color: "var(--accent-fg)",
  fontWeight: 500,
  fontSize: 13,
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid var(--border)",
  background: "var(--surface-raised)",
  color: "var(--text)",
  fontSize: 13,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = {
  padding: "9px 20px",
  borderRadius: "var(--radius-sm)",
  background: "var(--danger)",
  color: "#fff",
  fontSize: 13,
  cursor: "pointer",
};

const btnGhost: React.CSSProperties = {
  padding: "9px 16px",
  borderRadius: "var(--radius-sm)",
  background: "transparent",
  color: "var(--text-muted)",
  fontSize: 13,
  cursor: "pointer",
};

const miniBtn: React.CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  padding: "2px 5px",
  fontSize: 11,
  borderRadius: 3,
  cursor: "pointer",
  flexShrink: 0,
};

const addConfirmBtn: React.CSSProperties = {
  background: "var(--accent)",
  color: "var(--accent-fg)",
  padding: "3px 10px",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  cursor: "pointer",
  flexShrink: 0,
};

const addCancelBtn: React.CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  padding: "3px 6px",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  cursor: "pointer",
  flexShrink: 0,
};
