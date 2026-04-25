import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "../hooks/useAppDispatch";
import { useTimer } from "../hooks/useTimer";
import {
  cancelPaused,
  clearRemoteConflict,
  pauseTimer,
  resumeFromEntry,
  resumeTimer,
  startTimer,
  stopTimer,
  fetchStatus,
} from "../store/slices/timerSlice";
import { fetchEntries, fetchStatistics } from "../store/slices/entriesSlice";
import { updateCategories } from "../store/slices/categoriesSlice";
import DurationDisplay from "../components/shared/DurationDisplay";
import PomodoroRing from "../components/timer/PomodoroRing";
import ProjectPicker from "../components/timer/ProjectPicker";
import { formatHours, todayISO } from "../lib/formatters";
import type { TimeEntry } from "../store/types";

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

// ── Helpers ───────────────────────────────────────────────────────────────────

function latestEntryByProject(entries: TimeEntry[]): Map<string, TimeEntry> {
  const map = new Map<string, TimeEntry>();
  for (const e of entries) {
    const key = e.project ?? "__none__";
    const existing = map.get(key);
    if (!existing || e.id > existing.id) map.set(key, e);
  }
  return map;
}

// ── Timer panel (shared idle/active/paused states) ────────────────────────────

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
      <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: IS_IOS ? "32px 24px" : "20px 20px", height: "100%", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            {pomodoroEnabled && isRunning && (
              <div style={{ position: "absolute" }}>
                <PomodoroRing
                  totalSeconds={pomodoroTotal}
                  remainingSeconds={pomodoroSecondsRemaining}
                  phase={pomodoroPhase}
                  size={IS_IOS ? 160 : 120}
                />
              </div>
            )}
            <DurationDisplay seconds={elapsedSeconds} large />
          </div>

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: IS_IOS ? 17 : 15, fontWeight: 500, color: "var(--text)" }}>{activeTaskName}</div>
            {activeProject && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>{activeProject}</div>
            )}
            {isPaused && (
              <div style={{
                display: "inline-block", marginTop: 6, fontSize: 11,
                color: "var(--text-muted)", background: "var(--surface-raised)",
                border: "1px solid var(--border)", borderRadius: 10, padding: "2px 10px",
              }}>
                Paused
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          {isRunning && (
            <>
              <button onClick={() => dispatch(pauseTimer())} style={btnSecondary}>Pause</button>
              <button onClick={() => dispatch(stopTimer())} style={btnDanger}>Stop</button>
            </>
          )}
          {isPaused && (
            <>
              <button onClick={() => dispatch(resumeTimer())} style={btnPrimary}>Resume</button>
              <button onClick={() => dispatch(stopTimer())} style={btnSecondary}>Stop</button>
              <button onClick={() => dispatch(cancelPaused())} style={btnGhost}>Discard</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: IS_IOS ? "32px 24px" : "20px 20px", height: "100%", justifyContent: "center" }}>
      <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
        Start tracking
      </div>
      <input
        placeholder="What are you working on?"
        value={taskName}
        onChange={(e) => setTaskName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleStart()}
        style={{ fontSize: IS_IOS ? 16 : 14 }}
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
          <input type="checkbox" checked={billable} onChange={(e) => setBillable(e.target.checked)} style={{ width: "auto" }} />
          Billable
        </label>
      </div>
    </div>
  );
}

// ── Recent projects panel ─────────────────────────────────────────────────────

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
      <div style={{
        padding: "14px 16px 8px", fontSize: 11, color: "var(--text-muted)",
        textTransform: "uppercase", letterSpacing: "0.08em", flexShrink: 0,
      }}>
        Today's projects
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {stats.by_project.map((p) => {
          const key = p.project ?? "__none__";
          const latest = latestByProject.get(key);
          const pct = stats.total_seconds > 0 ? (p.total / stats.total_seconds) * 100 : 0;

          return (
            <div key={key} style={{ padding: "10px 16px", borderBottom: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {p.project ?? "No project"}
                  </div>
                </div>
                <div style={{ fontSize: 12, color: "var(--text-secondary)", flexShrink: 0 }}>
                  {formatHours(p.total)}
                </div>
                {canResume && latest && (
                  <button
                    onClick={() => dispatch(resumeFromEntry({ entryId: latest.id, userId: latest.user_id ?? undefined }))}
                    style={{ ...miniBtn, fontSize: 10, padding: "2px 8px", flexShrink: 0 }}
                    title={`Resume: ${latest.task_name}`}
                  >
                    ▶
                  </button>
                )}
              </div>
              <div style={{ height: 3, background: "var(--border)", borderRadius: 2 }}>
                <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 2 }} />
              </div>
            </div>
          );
        })}
      </div>
      <div style={{
        padding: "8px 16px", fontSize: 12, color: "var(--text-secondary)",
        borderTop: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "baseline", flexShrink: 0,
      }}>
        <span style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total</span>
        <span style={{ fontSize: 18, fontWeight: 300, color: "var(--text)" }}>{formatHours(stats.total_seconds)}</span>
      </div>
    </div>
  );
}

// ── Project browser (desktop only) ────────────────────────────────────────────

function ProjectBrowser({ onStart }: { onStart: (taskName: string, project?: string) => void }) {
  const dispatch = useAppDispatch();
  const categories = useAppSelector((s) => s.categories.items);
  const timerStatus = useAppSelector((s) => s.timer.status);

  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [renamingCat, setRenamingCat] = useState<string | null>(null);
  const [renamingSub, setRenamingSub] = useState<{ cat: string; idx: number } | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const renameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { renameRef.current?.focus(); }, [renamingCat, renamingSub]);

  const [addingCat, setAddingCat] = useState(false);
  const [newCatVal, setNewCatVal] = useState("");
  const [addingSub, setAddingSub] = useState(false);
  const [newSubVal, setNewSubVal] = useState("");

  const canStart = timerStatus === "idle";
  const save = (updated: Record<string, string[]>) => dispatch(updateCategories(updated));

  const commitAddCat = () => {
    const name = newCatVal.trim();
    if (name && !categories[name]) { save({ ...categories, [name]: [] }); setSelectedCat(name); }
    setAddingCat(false); setNewCatVal("");
  };
  const commitRenameCat = (oldName: string) => {
    const name = renameVal.trim(); setRenamingCat(null);
    if (!name || name === oldName) return;
    const entries = Object.entries(categories).map(([k, v]) => k === oldName ? [name, v] : [k, v]) as [string, string[]][];
    save(Object.fromEntries(entries));
    if (selectedCat === oldName) setSelectedCat(name);
  };
  const deleteCat = (cat: string) => {
    const updated = { ...categories }; delete updated[cat]; save(updated);
    if (selectedCat === cat) setSelectedCat(null);
  };
  const commitAddSub = (cat: string) => {
    const name = newSubVal.trim();
    if (name && !categories[cat].includes(name)) save({ ...categories, [cat]: [...categories[cat], name] });
    setAddingSub(false); setNewSubVal("");
  };
  const commitRenameSub = (cat: string, idx: number) => {
    const name = renameVal.trim(); setRenamingSub(null);
    if (!name) return;
    save({ ...categories, [cat]: categories[cat].map((s, i) => i === idx ? name : s) });
  };
  const deleteSub = (cat: string, idx: number) => {
    save({ ...categories, [cat]: categories[cat].filter((_, i) => i !== idx) });
  };

  const categoryNames = Object.keys(categories);
  const subs = selectedCat ? (categories[selectedCat] ?? []) : [];

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* Left: categories */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {categoryNames.map((cat) => {
            const isSelected = selectedCat === cat;
            const isRenaming = renamingCat === cat;
            return (
              <div key={cat} style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px 0 12px", borderBottom: "1px solid var(--border)", background: isSelected ? "var(--surface-raised)" : "transparent", minHeight: 38 }}
                onClick={() => setSelectedCat(isSelected ? null : cat)}
                onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--surface-raised)"; (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "1"); }}
                onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "0"); }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: isSelected ? "var(--accent)" : "var(--border)", flexShrink: 0 }} />
                {isRenaming ? (
                  <input ref={renameRef} value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={() => commitRenameCat(cat)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitRenameCat(cat); if (e.key === "Escape") setRenamingCat(null); }}
                    style={{ flex: 1, fontSize: 13, padding: "2px 6px" }} onClick={(e) => e.stopPropagation()} />
                ) : (
                  <span style={{ flex: 1, fontSize: 13, color: "var(--text)", padding: "9px 0", userSelect: "none" }}>{cat}</span>
                )}
                <span className="row-actions" style={{ display: "flex", gap: 2, opacity: 0, transition: "opacity 0.1s" }}>
                  <button onClick={(e) => { e.stopPropagation(); setRenamingCat(cat); setRenameVal(cat); }} style={miniBtn} title="Rename">✎</button>
                  <button onClick={(e) => { e.stopPropagation(); deleteCat(cat); }} style={{ ...miniBtn, color: "var(--danger)" }} title="Delete">✕</button>
                </span>
              </div>
            );
          })}
          {addingCat && (
            <div style={{ display: "flex", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
              <input autoFocus placeholder="Project name" value={newCatVal} onChange={(e) => setNewCatVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitAddCat(); if (e.key === "Escape") { setAddingCat(false); setNewCatVal(""); } }}
                style={{ flex: 1, fontSize: 12, padding: "3px 6px" }} />
              <button onClick={commitAddCat} style={addConfirmBtn}>Add</button>
              <button onClick={() => { setAddingCat(false); setNewCatVal(""); }} style={addCancelBtn}>✕</button>
            </div>
          )}
        </div>
        <button onClick={() => { setAddingCat(true); setNewCatVal(""); }}
          style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)", background: "transparent", borderTop: "1px solid var(--border)", textAlign: "left", cursor: "pointer", flexShrink: 0 }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
        >+ Add project</button>
      </div>

      {/* Right: sub-projects */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {!selectedCat ? (
          <div style={{ padding: "20px 16px", color: "var(--text-muted)", fontSize: 12 }}>Select a project</div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: "auto" }}>
              {subs.map((sub, idx) => {
                const isRenaming = renamingSub?.cat === selectedCat && renamingSub.idx === idx;
                return (
                  <div key={idx} style={{ display: "flex", alignItems: "center", gap: 4, padding: "0 8px 0 12px", borderBottom: "1px solid var(--border)", minHeight: 38 }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--surface-raised)"; (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "1"); }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; (e.currentTarget as HTMLDivElement).querySelectorAll<HTMLElement>(".row-actions").forEach(el => el.style.opacity = "0"); }}
                  >
                    {isRenaming ? (
                      <input ref={renameRef} value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                        onBlur={() => commitRenameSub(selectedCat, idx)}
                        onKeyDown={(e) => { if (e.key === "Enter") commitRenameSub(selectedCat, idx); if (e.key === "Escape") setRenamingSub(null); }}
                        style={{ flex: 1, fontSize: 13, padding: "2px 6px" }} onClick={(e) => e.stopPropagation()} />
                    ) : (
                      <span onDoubleClick={() => { setRenamingSub({ cat: selectedCat, idx }); setRenameVal(sub); }}
                        onClick={() => canStart && onStart(sub, selectedCat)}
                        style={{ flex: 1, fontSize: 13, color: "var(--text)", cursor: canStart ? "pointer" : "default", userSelect: "none", padding: "9px 0" }}
                      >
                        {sub}{canStart && <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-muted)" }}>start</span>}
                      </span>
                    )}
                    <span className="row-actions" style={{ display: "flex", gap: 2, opacity: 0, transition: "opacity 0.1s" }}>
                      <button onClick={(e) => { e.stopPropagation(); setRenamingSub({ cat: selectedCat, idx }); setRenameVal(sub); }} style={miniBtn} title="Rename">✎</button>
                      <button onClick={(e) => { e.stopPropagation(); deleteSub(selectedCat, idx); }} style={{ ...miniBtn, color: "var(--danger)" }} title="Delete">✕</button>
                    </span>
                  </div>
                );
              })}
              {addingSub && (
                <div style={{ display: "flex", gap: 4, padding: "6px 8px", borderBottom: "1px solid var(--border)" }}>
                  <input autoFocus placeholder="Sub-project name" value={newSubVal} onChange={(e) => setNewSubVal(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") commitAddSub(selectedCat); if (e.key === "Escape") { setAddingSub(false); setNewSubVal(""); } }}
                    style={{ flex: 1, fontSize: 12, padding: "3px 6px" }} />
                  <button onClick={() => commitAddSub(selectedCat)} style={addConfirmBtn}>Add</button>
                  <button onClick={() => { setAddingSub(false); setNewSubVal(""); }} style={addCancelBtn}>✕</button>
                </div>
              )}
            </div>
            <button onClick={() => { setAddingSub(true); setNewSubVal(""); }}
              style={{ padding: "8px 12px", fontSize: 12, color: "var(--text-muted)", background: "transparent", borderTop: "1px solid var(--border)", textAlign: "left", cursor: "pointer", flexShrink: 0 }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)"; }}
            >+ Add sub-project</button>
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
  const { status, remoteConflict } = useAppSelector((s) => s.timer);
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
    dispatch(startTimer({ taskName, project, billable: false, hourlyRate: settings.config?.default_hourly_rate ?? 0 }));
  };

  const remoteElapsedMin = remoteConflict
    ? Math.floor(remoteConflict.elapsed_seconds / 60)
    : 0;

  const conflictBanner = remoteConflict ? (
    <div style={{
      padding: "10px 14px",
      background: "rgba(255,159,10,0.12)",
      borderBottom: "1px solid rgba(255,159,10,0.3)",
      fontSize: 12,
      display: "flex",
      flexDirection: "column",
      gap: 6,
      flexShrink: 0,
    }}>
      <div>
        📱 <strong>{remoteConflict.device_id.slice(0, 8)}</strong> is tracking &ldquo;{remoteConflict.task_name}&rdquo; ({remoteElapsedMin}m)
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => { dispatch(stopTimer()); setTimeout(() => dispatch(fetchStatus()), 500); }}
          style={{ ...miniBtn, color: "var(--accent)" }}
        >
          Adopt
        </button>
        <button
          onClick={() => dispatch(clearRemoteConflict())}
          style={miniBtn}
        >
          Dismiss
        </button>
      </div>
    </div>
  ) : null;

  // ── iOS: single-column layout ──────────────────────────────────────────────
  if (IS_IOS) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
        {conflictBanner}
        {/* Timer takes up most of the screen */}
        <div style={{ flex: "0 0 auto", borderBottom: "1px solid var(--border)" }}>
          <TimerStartPanel />
        </div>
        {/* Today's activity below */}
        <div style={{ flex: 1, overflow: "hidden" }}>
          <RecentProjectsPanel entries={entries} />
        </div>
        <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
      </div>
    );
  }

  // ── Desktop: two-row split layout ──────────────────────────────────────────
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {conflictBanner}
      <div style={{ flex: "0 0 58%", display: "flex", borderBottom: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ flex: 2, borderRight: "1px solid var(--border)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <TimerStartPanel />
        </div>
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <RecentProjectsPanel entries={entries} />
        </div>
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "8px 16px 6px", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: "1px solid var(--border)", flexShrink: 0, background: "var(--surface)" }}>
          Quick start
        </div>
        <div style={{ flex: 1, overflow: "hidden" }}>
          <ProjectBrowser onStart={handleQuickStart} />
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

// ── Button styles ─────────────────────────────────────────────────────────────

const btnPrimary: React.CSSProperties = { padding: "9px 20px", borderRadius: "var(--radius-sm)", background: "var(--accent)", color: "var(--accent-fg)", fontWeight: 500, fontSize: 13, cursor: "pointer" };
const btnSecondary: React.CSSProperties = { padding: "9px 20px", borderRadius: "var(--radius-sm)", background: "var(--surface-raised)", color: "var(--text)", border: "1px solid var(--border)", fontSize: 13, cursor: "pointer" };
const btnDanger: React.CSSProperties = { padding: "9px 20px", borderRadius: "var(--radius-sm)", background: "var(--danger)", color: "#fff", fontSize: 13, cursor: "pointer" };
const btnGhost: React.CSSProperties = { padding: "9px 14px", borderRadius: "var(--radius-sm)", background: "transparent", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" };
const miniBtn: React.CSSProperties = { padding: "3px 7px", fontSize: 11, background: "var(--surface-raised)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", cursor: "pointer" };
const addConfirmBtn: React.CSSProperties = { padding: "3px 10px", fontSize: 12, background: "var(--accent)", color: "var(--accent-fg)", borderRadius: "var(--radius-sm)", cursor: "pointer" };
const addCancelBtn: React.CSSProperties = { padding: "3px 8px", fontSize: 12, background: "transparent", color: "var(--text-muted)", borderRadius: "var(--radius-sm)", cursor: "pointer" };
