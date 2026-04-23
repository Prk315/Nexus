import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import {
  CheckCircle, Flame, RefreshCw, Target, CheckSquare, Check, ChevronDown, ChevronRight,
  Bell, Plus, X, FileText, Zap, Calendar, Clock, Handshake, Star, Pencil, BookOpen,
} from "lucide-react";
import {
  getGoals, getPlans, getAllTasks, getSystems,
  markSystemDone, unmarkSystemDone, toggleTask, createTask, updateTask, deleteTask,
  getCalBlocks, createCalBlock, updateCalBlock, deleteCalBlock,
  getSystemSubtasks, toggleSystemSubtask,
  getGoalGroups,
  getDailyGoals, setDailyPrimaryGoal, clearDailyPrimaryGoal, addDailySecondaryGoal, deleteDailySecondaryGoal,
  getReminders, addReminder, toggleReminder, deleteReminder,
  getQuickNotes, addQuickNote, deleteQuickNote,
  getBrainDump, addBrainEntry, deleteBrainEntry,
  getEvents, addEvent, deleteEvent,
  getDeadlines, addDeadline, toggleDeadline, deleteDeadline,
  getAgreements, addAgreement, deleteAgreement,
  getJournalEntry, saveJournalEntry,
  getCourseAssignments, updateCourseAssignment,
} from "../lib/api";
import { Progress } from "../components/ui/progress";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { PriorityDot } from "../components/PriorityDot";
import { daysUntil, deadlineLabel, deadlineVariant, cn, layoutCalItems } from "../lib/utils";
import { isDue } from "./Systems";
import type { Goal, GoalGroup, Plan, TaskWithContext, SystemEntry, SystemSubtask, CalBlock, DailyGoals, Reminder, QuickNote, BrainEntry, CalEvent, Deadline, Agreement, CourseAssignment } from "../types";

const todayDate = () => new Date().toISOString().slice(0, 10);

// ── Day Calendar constants ────────────────────────────────────────────────────

const DC_HOUR_START = 5;
const DC_HOUR_END   = 23;
const DC_HOUR_PX    = 48;
const DC_HOURS      = Array.from({ length: DC_HOUR_END - DC_HOUR_START + 1 }, (_, i) => DC_HOUR_START + i);

function dcTimeToMin(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function dcMinToPx(min: number) {
  return ((min - DC_HOUR_START * 60) / 60) * DC_HOUR_PX;
}
function dcPxToTime(px: number) {
  const raw     = DC_HOUR_START * 60 + (px / DC_HOUR_PX) * 60;
  const snapped = Math.round(raw / 30) * 30;
  const clamped = Math.max(DC_HOUR_START * 60, Math.min((DC_HOUR_END + 1) * 60 - 30, snapped));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function dcAddHour(t: string) {
  const [h, m] = t.split(":").map(Number);
  const total  = Math.min((DC_HOUR_END + 1) * 60, h * 60 + m + 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

const DC_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  blue:    { bg: "bg-blue-500/20",    border: "border-blue-400/50",    text: "text-blue-700 dark:text-blue-300",       dot: "bg-blue-500" },
  indigo:  { bg: "bg-indigo-500/20",  border: "border-indigo-400/50",  text: "text-indigo-700 dark:text-indigo-300",   dot: "bg-indigo-500" },
  violet:  { bg: "bg-violet-500/20",  border: "border-violet-400/50",  text: "text-violet-700 dark:text-violet-300",   dot: "bg-violet-500" },
  purple:  { bg: "bg-purple-500/20",  border: "border-purple-400/50",  text: "text-purple-700 dark:text-purple-300",   dot: "bg-purple-500" },
  pink:    { bg: "bg-pink-500/20",    border: "border-pink-400/50",    text: "text-pink-700 dark:text-pink-300",       dot: "bg-pink-500" },
  rose:    { bg: "bg-rose-500/20",    border: "border-rose-400/50",    text: "text-rose-700 dark:text-rose-300",       dot: "bg-rose-500" },
  red:     { bg: "bg-red-500/20",     border: "border-red-400/50",     text: "text-red-700 dark:text-red-300",         dot: "bg-red-500" },
  orange:  { bg: "bg-orange-500/20",  border: "border-orange-400/50",  text: "text-orange-700 dark:text-orange-300",   dot: "bg-orange-500" },
  amber:   { bg: "bg-amber-500/20",   border: "border-amber-400/50",   text: "text-amber-700 dark:text-amber-300",     dot: "bg-amber-500" },
  yellow:  { bg: "bg-yellow-400/20",  border: "border-yellow-400/50",  text: "text-yellow-700 dark:text-yellow-300",   dot: "bg-yellow-400" },
  green:   { bg: "bg-green-500/20",   border: "border-green-400/50",   text: "text-green-700 dark:text-green-300",     dot: "bg-green-500" },
  emerald: { bg: "bg-emerald-500/20", border: "border-emerald-400/50", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  teal:    { bg: "bg-teal-500/20",    border: "border-teal-400/50",    text: "text-teal-700 dark:text-teal-300",       dot: "bg-teal-500" },
  cyan:    { bg: "bg-cyan-500/20",    border: "border-cyan-400/50",    text: "text-cyan-700 dark:text-cyan-300",       dot: "bg-cyan-500" },
  slate:   { bg: "bg-slate-500/20",   border: "border-slate-400/50",   text: "text-slate-700 dark:text-slate-300",     dot: "bg-slate-500" },
};
const DC_COLOR_KEYS = Object.keys(DC_COLORS);

type DCBlockDraft = {
  title: string; start_time: string; end_time: string;
  color: string; description: string; location: string;
};

// ── Day Block Modal ───────────────────────────────────────────────────────────

function DayBlockModal({
  initial, startTime, endTime, onSave, onDelete, onClose,
}: {
  initial?: CalBlock;
  startTime?: string;
  endTime?: string;
  onSave: (d: DCBlockDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<DCBlockDraft>({
    title:       initial?.title       ?? "",
    start_time:  initial?.start_time  ?? startTime ?? "09:00",
    end_time:    initial?.end_time    ?? endTime   ?? "10:00",
    color:       initial?.color       ?? "blue",
    description: initial?.description ?? "",
    location:    initial?.location    ?? "",
  });
  const set = (p: Partial<DCBlockDraft>) => setForm((f) => ({ ...f, ...p }));
  const valid = form.title.trim() !== "" && form.start_time < form.end_time;
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!valid || saving) return;
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-80 rounded-xl border border-border bg-popover shadow-2xl p-4 flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">{initial ? "Edit block" : "New block"}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>

        <input
          autoFocus
          className="h-8 rounded border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Title"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onClose(); }}
        />

        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-0.5 flex-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Start</label>
            <input type="time" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.start_time} onChange={(e) => set({ start_time: e.target.value })} />
          </div>
          <div className="flex flex-col gap-0.5 flex-1">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">End</label>
            <input type="time" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.end_time} onChange={(e) => set({ end_time: e.target.value })} />
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {DC_COLOR_KEYS.map((c) => (
            <button
              key={c}
              onClick={() => set({ color: c })}
              title={c}
              className={cn(
                "h-4 w-4 rounded-full transition-transform shrink-0",
                DC_COLORS[c].dot,
                form.color === c && "ring-2 ring-offset-1 ring-ring scale-110"
              )}
            />
          ))}
        </div>

        <input
          className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Description (optional)"
          value={form.description}
          onChange={(e) => set({ description: e.target.value })}
        />
        <input
          className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Location (optional)"
          value={form.location}
          onChange={(e) => set({ location: e.target.value })}
        />

        <div className="flex items-center gap-2 pt-0.5">
          <button
            disabled={!valid || saving}
            onClick={handleSave}
            className="flex-1 h-8 rounded bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {initial ? "Save changes" : "Add block"}
          </button>
          {onDelete && (
            <button
              disabled={saving}
              onClick={async () => { setSaving(true); try { await onDelete(); } finally { setSaving(false); } }}
              className="h-8 px-3 rounded border border-destructive/50 text-destructive text-xs hover:bg-destructive/10 transition-colors disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Day Calendar ──────────────────────────────────────────────────────────────

function DayCalendar({
  date: _date, calBlocks, systems, courseAssignments,
  onCreateBlock, onUpdateBlock, onDeleteBlock,
}: {
  date: string;
  calBlocks: CalBlock[];
  systems: SystemEntry[];
  courseAssignments: CourseAssignment[];
  onCreateBlock: (d: DCBlockDraft) => Promise<void>;
  onUpdateBlock: (id: number, d: DCBlockDraft) => Promise<void>;
  onDeleteBlock: (b: CalBlock) => Promise<void>;
}) {
  const colRef    = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<{
    block?: CalBlock;
    startTime?: string;
    endTime?: string;
  } | null>(null);

  const totalPx = DC_HOURS.length * DC_HOUR_PX;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = dcMinToPx(8 * 60) - 24;
    }
  }, []);

  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const nowPx   = dcMinToPx(nowMin);
  const showNow = nowMin >= DC_HOUR_START * 60 && nowMin <= (DC_HOUR_END + 1) * 60;

  function handleColClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-block]")) return;
    const rect = colRef.current!.getBoundingClientRect();
    const st   = dcPxToTime(Math.max(0, e.clientY - rect.top));
    const et   = dcAddHour(st);
    setModal({ startTime: st, endTime: et });
  }

  // Systems with a start_time (shown as context, not editable here)
  const timedSystems = systems.filter((s) => s.start_time);
  // Course assignments for today with a start_time
  const timedCAs     = courseAssignments.filter((ca) => ca.start_time);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-2 shrink-0 px-1">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
        </h2>
        <button
          onClick={() => setModal({ startTime: "09:00", endTime: "10:00" })}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Add block"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Scrollable grid */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: totalPx }}>

          {/* Hour labels */}
          <div className="w-7 shrink-0 relative select-none pointer-events-none">
            {DC_HOURS.map((h) => (
              <div
                key={h}
                className="absolute w-full text-right pr-1"
                style={{ top: (h - DC_HOUR_START) * DC_HOUR_PX - 6 }}
              >
                <span className="text-[9px] font-mono text-muted-foreground/40">
                  {String(h).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>

          {/* Event column */}
          <div
            ref={colRef}
            className="flex-1 min-w-0 relative border-l border-border cursor-crosshair"
            style={{ height: totalPx }}
            onClick={handleColClick}
          >
            {/* Hour lines */}
            {DC_HOURS.map((h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-border/30 pointer-events-none"
                style={{ top: (h - DC_HOUR_START) * DC_HOUR_PX }}
              />
            ))}
            {/* Half-hour dashed lines */}
            {DC_HOURS.slice(0, -1).map((h) => (
              <div
                key={`${h}h`}
                className="absolute left-0 right-0 border-t border-dashed border-border/15 pointer-events-none"
                style={{ top: (h - DC_HOUR_START) * DC_HOUR_PX + DC_HOUR_PX / 2 }}
              />
            ))}

            {/* Current time indicator */}
            {showNow && (
              <div
                className="absolute left-0 right-0 pointer-events-none z-10 flex items-center"
                style={{ top: nowPx }}
              >
                <div className="h-2 w-2 rounded-full bg-primary shrink-0 -ml-1 animate-pulse" />
                <div className="flex-1 border-t-2 border-primary" />
              </div>
            )}

            {/* All timed events — unified overlap layout */}
            {(() => {
              type DcEvt =
                | { kind: "sys"; startMin: number; endMin: number; s: typeof timedSystems[number] }
                | { kind: "ca";  startMin: number; endMin: number; ca: typeof timedCAs[number] }
                | { kind: "blk"; startMin: number; endMin: number; b: CalBlock };

              const evts: DcEvt[] = [
                ...timedSystems.map((s) => ({
                  kind: "sys" as const,
                  startMin: dcTimeToMin(s.start_time!),
                  endMin:   s.end_time ? dcTimeToMin(s.end_time) : dcTimeToMin(s.start_time!) + 60,
                  s,
                })),
                ...timedCAs.map((ca) => ({
                  kind: "ca" as const,
                  startMin: dcTimeToMin(ca.start_time!),
                  endMin:   ca.end_time ? dcTimeToMin(ca.end_time) : dcTimeToMin(ca.start_time!) + 60,
                  ca,
                })),
                ...calBlocks.map((b) => ({
                  kind: "blk" as const,
                  startMin: dcTimeToMin(b.start_time),
                  endMin:   dcTimeToMin(b.end_time),
                  b,
                })),
              ];

              return layoutCalItems(evts).map(({ item, col, totalCols }) => {
                const top   = dcMinToPx(item.startMin);
                const ht    = Math.max(18, dcMinToPx(item.endMin) - top);
                const left  = `calc(${(col / totalCols) * 100}% + 1px)`;
                const right = `calc(${((totalCols - col - 1) / totalCols) * 100}% + 1px)`;

                if (item.kind === "sys") {
                  const { s } = item;
                  const clr = DC_COLORS.emerald;
                  return (
                    <div
                      key={`sys-${s.id}`}
                      data-block="1"
                      title={s.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default", clr.bg, clr.border)}
                      style={{ top, height: ht, left, right }}
                    >
                      <p className={cn("text-[10px] font-medium leading-tight truncate", clr.text)}>{s.title}</p>
                      {ht > 26 && (
                        <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                          {s.start_time}{s.end_time ? `–${s.end_time}` : ""}
                        </p>
                      )}
                    </div>
                  );
                }

                if (item.kind === "ca") {
                  const { ca } = item;
                  const clr = ca.assignment_type === "theory" ? DC_COLORS.orange : DC_COLORS.indigo;
                  return (
                    <div
                      key={`ca-${ca.id}`}
                      data-block="1"
                      title={ca.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default", clr.bg, clr.border)}
                      style={{ top, height: ht, left, right }}
                    >
                      <p className={cn("text-[10px] font-medium leading-tight truncate", clr.text)}>{ca.title}</p>
                      {ht > 26 && ca.end_time && (
                        <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                          {ca.start_time}–{ca.end_time}
                        </p>
                      )}
                    </div>
                  );
                }

                // cal block
                const { b } = item;
                const clr = DC_COLORS[b.color] ?? DC_COLORS.blue;
                return (
                  <div
                    key={`blk-${b.id}`}
                    data-block="1"
                    className={cn(
                      "absolute rounded border px-1 py-0.5 overflow-hidden z-20 transition-all",
                      clr.bg, clr.border,
                      b.is_recurring ? "cursor-default opacity-80" : "cursor-pointer hover:brightness-110"
                    )}
                    style={{ top, height: ht, left, right }}
                    onClick={b.is_recurring ? undefined : (e) => { e.stopPropagation(); setModal({ block: b }); }}
                    title={b.is_recurring ? `${b.title} (recurring — edit in Week view)` : b.title}
                  >
                    <p className={cn("text-[10px] font-semibold leading-tight truncate", clr.text)}>{b.title}</p>
                    {ht > 26 && (
                      <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                        {b.start_time}–{b.end_time}
                      </p>
                    )}
                    {ht > 42 && b.location && (
                      <p className={cn("text-[9px] leading-tight opacity-60 truncate", clr.text)}>{b.location}</p>
                    )}
                  </div>
                );
              });
            })()}
          </div>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 mt-2 px-1 shrink-0">
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-emerald-500/40 border border-emerald-400/50 shrink-0" />Systems
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-indigo-500/40 border border-indigo-400/50 shrink-0" />Study
        </span>
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-blue-500/40 border border-blue-400/50 shrink-0" />Events
        </span>
      </div>

      {/* Modal */}
      {modal && (
        <DayBlockModal
          initial={modal.block}
          startTime={modal.startTime}
          endTime={modal.endTime}
          onSave={async (draft) => {
            if (modal.block) await onUpdateBlock(modal.block.id, draft);
            else await onCreateBlock(draft);
            setModal(null);
          }}
          onDelete={
            modal.block && !modal.block.is_recurring
              ? async () => { await onDeleteBlock(modal.block!); setModal(null); }
              : undefined
          }
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

// ── Today Pie Chart ───────────────────────────────────────────────────────────

interface PieItem {
  id: number;
  label: string;
  subtitle?: string;
  minutes: number;
  done: boolean;
  kind: "task" | "assignment";
}

function fmtMin(min: number) {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function TodayPie({ doneMin, pendingMin, freeMin, capTotal, items }: {
  doneMin: number; pendingMin: number; freeMin: number; capTotal: number;
  items: PieItem[];
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node))
        setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const SIZE   = 68;
  const STROKE = 10;
  const r      = (SIZE - STROKE) / 2;
  const cx     = SIZE / 2;
  const cy     = SIZE / 2;
  const circ   = 2 * Math.PI * r;

  const doneFrac    = capTotal > 0 ? doneMin    / capTotal : 0;
  const pendingFrac = capTotal > 0 ? pendingMin / capTotal : 0;
  const freeFrac    = capTotal > 0 ? freeMin    / capTotal : 1;

  const segments: { frac: number; color: string; cumOffset: number }[] = [];
  let cum = 0;
  for (const [frac, color] of [
    [doneFrac,    "#10b981"          ] as const,
    [pendingFrac, "#6366f1"          ] as const,
    [freeFrac,    "hsl(var(--muted))"] as const,
  ]) {
    if (frac > 0.0005) segments.push({ frac, color, cumOffset: cum });
    cum += frac;
  }

  const doneWorkPct = (doneMin + pendingMin) > 0
    ? Math.round((doneMin / (doneMin + pendingMin)) * 100) : 0;

  const maxItemMin = items.reduce((m, i) => Math.max(m, i.minutes), 1);

  return (
    <div ref={containerRef} className="relative flex items-center gap-3 shrink-0">
      {/* Donut + legend */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Click to see schedule breakdown"
        className="relative shrink-0 hover:opacity-80 transition-opacity focus:outline-none"
        style={{ width: SIZE, height: SIZE }}
      >
        <svg width={SIZE} height={SIZE}>
          <circle cx={cx} cy={cy} r={r} fill="none"
            stroke="hsl(var(--muted))" strokeWidth={STROKE} />
          {segments.map((seg, i) => (
            <circle
              key={i} cx={cx} cy={cy} r={r} fill="none"
              stroke={seg.color} strokeWidth={STROKE}
              strokeDasharray={`${seg.frac * circ} ${circ}`}
              strokeDashoffset={-(seg.cumOffset * circ)}
              style={{ transform: "rotate(-90deg)", transformOrigin: `${cx}px ${cy}px` }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-[11px] font-bold tabular-nums leading-none">{doneWorkPct}%</span>
        </div>
      </button>

      <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-emerald-500" />
          <span>{fmtMin(doneMin)} done</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-indigo-500" />
          <span>{fmtMin(pendingMin)} planned</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full shrink-0 bg-muted-foreground/25" />
          <span>{fmtMin(Math.max(0, freeMin))} free</span>
        </div>
      </div>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 mt-2 z-50 w-80 rounded-lg border border-border bg-popover shadow-xl">
          <div className="px-3 pt-3 pb-2 border-b border-border">
            <p className="text-xs font-semibold text-foreground">Today's schedule</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">16-hour basis · timed tasks use actual duration</p>
          </div>

          {items.length === 0 ? (
            <p className="px-3 py-3 text-xs text-muted-foreground italic">Nothing scheduled today.</p>
          ) : (
            <div className="flex flex-col gap-0 max-h-72 overflow-y-auto px-3 py-2">
              {items.map((item) => {
                const barPct = Math.round((item.minutes / maxItemMin) * 100);
                return (
                  <div key={`${item.kind}-${item.id}`} className="py-1.5 border-b border-border/40 last:border-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn(
                        "flex-1 text-xs truncate",
                        item.done ? "line-through text-muted-foreground" : "text-foreground"
                      )}>
                        {item.label}
                      </span>
                      <span className={cn(
                        "text-[10px] font-medium shrink-0 px-1.5 py-0.5 rounded",
                        item.done ? "bg-emerald-500/15 text-emerald-600" : "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
                      )}>
                        {fmtMin(item.minutes)}
                      </span>
                    </div>
                    {item.subtitle && (
                      <p className="text-[10px] text-muted-foreground/60 mb-1">{item.subtitle}</p>
                    )}
                    <div className="h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all", item.done ? "bg-emerald-500" : "bg-indigo-400")}
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="px-3 py-2 border-t border-border flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              {fmtMin(doneMin + pendingMin)} planned of 16h
            </span>
            <span className="text-[10px] font-medium text-foreground">
              {Math.round(((doneMin + pendingMin) / capTotal) * 100)}% of day used
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Welcome Box ───────────────────────────────────────────────────────────────

function WelcomeBox({
  goals, plans, tasks, systems, dailyGoals, courseAssignments, date,
}: {
  goals: Goal[]; plans: Plan[]; tasks: TaskWithContext[]; systems: SystemEntry[];
  dailyGoals: DailyGoals; courseAssignments: CourseAssignment[]; date: string;
}) {
  const hour     = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Stat pills
  const activeGoals = goals.filter((g) => g.status === "active").length;
  const openTasks   = tasks.filter((t) => !t.done).length;
  const activePlans = plans.filter((p) => p.status === "active").length;
  const systemsDue  = systems.filter(isDue).length;

  // Today's task progress (tasks due today + today's assignments)
  const todayTasks = tasks.filter((t) => t.due_date === date);
  const totalToday = todayTasks.length + courseAssignments.length;
  const doneToday  = todayTasks.filter((t) => t.done).length
                   + courseAssignments.filter((ca) => ca.status === "done").length;
  const progressPct = totalToday === 0 ? 0 : Math.round((doneToday / totalToday) * 100);

  // Pie chart: 16-hour day = 960 minutes
  // Normal task → 10 min; timed assignment → duration (minutes)
  const TOTAL_MIN = 16 * 60;
  const TASK_MIN  = 10;
  let doneMin = 0, pendingMin = 0;

  for (const t of todayTasks) {
    const min = t.time_estimate ?? TASK_MIN;
    (t.done ? (doneMin += min) : (pendingMin += min));
  }
  for (const ca of courseAssignments) {
    let min: number;
    if (ca.time_estimate != null) {
      min = ca.time_estimate;
    } else if (ca.start_time && ca.end_time) {
      const [sh, sm] = ca.start_time.split(":").map(Number);
      const [eh, em] = ca.end_time.split(":").map(Number);
      const dur = (eh * 60 + em) - (sh * 60 + sm);
      min = dur > 0 ? dur : TASK_MIN;
    } else {
      min = TASK_MIN;
    }
    ca.status === "done" ? (doneMin += min) : (pendingMin += min);
  }

  const workMin  = doneMin + pendingMin;
  const capTotal = Math.max(TOTAL_MIN, workMin);
  const freeMin  = capTotal - workMin;

  const pieItems: PieItem[] = [
    ...todayTasks.map((t) => ({
      id: t.id, label: t.title, subtitle: t.plan_title ?? undefined,
      minutes: t.time_estimate ?? TASK_MIN, done: t.done, kind: "task" as const,
    })),
    ...courseAssignments.map((ca) => {
      let min: number;
      if (ca.time_estimate != null) {
        min = ca.time_estimate;
      } else if (ca.start_time && ca.end_time) {
        const [sh, sm] = ca.start_time.split(":").map(Number);
        const [eh, em] = ca.end_time.split(":").map(Number);
        const dur = (eh * 60 + em) - (sh * 60 + sm);
        min = dur > 0 ? dur : TASK_MIN;
      } else {
        min = TASK_MIN;
      }
      return { id: ca.id, label: ca.title, subtitle: ca.plan_title, minutes: min, done: ca.status === "done", kind: "assignment" as const };
    }),
  ];

  return (
    <div className="shrink-0 flex items-center gap-4 px-5 py-2.5 border-b border-border bg-card">

      {/* Greeting */}
      <div className="shrink-0">
        <h1 className="text-xl font-semibold text-foreground">{greeting}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
        </p>
      </div>

      <div className="h-10 w-px bg-border shrink-0" />

      {/* Primary goal + today's progress */}
      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {dailyGoals.primary ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <Star className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
            <span className="text-sm font-medium truncate text-foreground">{dailyGoals.primary}</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-muted-foreground/40">
            <Star className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs italic">No primary goal set for today</span>
          </div>
        )}

        {totalToday > 0 ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {doneToday}/{totalToday} today
            </span>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/40 italic">Nothing scheduled for today</p>
        )}
      </div>

      <div className="h-10 w-px bg-border shrink-0" />

      {/* Pie chart */}
      <TodayPie doneMin={doneMin} pendingMin={pendingMin} freeMin={freeMin} capTotal={capTotal} items={pieItems} />

      <div className="h-10 w-px bg-border shrink-0" />

      {/* Stat pills */}
      <div className="flex items-center gap-2 shrink-0">
        {[
          { label: "Goals",   value: activeGoals },
          { label: "Plans",   value: activePlans },
          { label: "Tasks",   value: openTasks },
          { label: "Systems", value: systemsDue, sub: systemsDue === 0 ? "clear" : "due" },
        ].map(({ label, value, sub }) => (
          <div key={label} className="rounded-lg border border-border px-3 py-1.5 bg-background text-center min-w-[56px]">
            <p className="text-sm font-semibold text-foreground leading-none">{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{sub ?? label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Daily Goals Section ───────────────────────────────────────────────────────

function DailyGoalsSection({ date, goals, onSetPrimary, onClearPrimary, onAddSecondary, onDeleteSecondary }: {
  date: string;
  goals: DailyGoals;
  onSetPrimary: (text: string) => void;
  onClearPrimary: () => void;
  onAddSecondary: (text: string) => void;
  onDeleteSecondary: (id: number) => void;
}) {
  const [editingPrimary, setEditingPrimary] = useState(false);
  const [primaryDraft, setPrimaryDraft] = useState(goals.primary ?? "");
  const [secDraft, setSecDraft] = useState("");

  // Completion state — persisted per-day in localStorage
  const lsKey = `daily_goals_done_${date}`;
  const [primaryDone, setPrimaryDone] = useState<boolean>(() => {
    try { return JSON.parse(localStorage.getItem(lsKey) ?? "{}").primary === true; }
    catch { return false; }
  });
  const [secDone, setSecDone] = useState<Set<number>>(() => {
    try { return new Set<number>(JSON.parse(localStorage.getItem(lsKey) ?? "{}").secondary ?? []); }
    catch { return new Set(); }
  });

  function persistDone(primary: boolean, sec: Set<number>) {
    localStorage.setItem(lsKey, JSON.stringify({ primary, secondary: [...sec] }));
  }

  function togglePrimaryDone() {
    const next = !primaryDone;
    setPrimaryDone(next);
    persistDone(next, secDone);
  }

  function toggleSecDone(id: number) {
    const next = new Set(secDone);
    next.has(id) ? next.delete(id) : next.add(id);
    setSecDone(next);
    persistDone(primaryDone, next);
  }

  function commitPrimary() {
    const trimmed = primaryDraft.trim();
    if (trimmed) onSetPrimary(trimmed);
    else onClearPrimary();
    setEditingPrimary(false);
  }

  function startEditPrimary() {
    setPrimaryDraft(goals.primary ?? "");
    setEditingPrimary(true);
  }

  function handleSecKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && secDraft.trim()) {
      onAddSecondary(secDraft.trim());
      setSecDraft("");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Primary goal */}
      <div className="flex flex-col gap-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <Star className="h-3.5 w-3.5 text-yellow-500" /> Primary goal today
        </p>
        {editingPrimary ? (
          <div className="flex items-center gap-1.5">
            <input
              autoFocus
              className="flex-1 h-8 rounded-md border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              placeholder="What's your main focus today?"
              value={primaryDraft}
              onChange={(e) => setPrimaryDraft(e.target.value)}
              onBlur={commitPrimary}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPrimary();
                if (e.key === "Escape") setEditingPrimary(false);
              }}
            />
            {goals.primary && (
              <button onClick={() => { onClearPrimary(); setEditingPrimary(false); }}
                className="text-muted-foreground hover:text-destructive transition-colors">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : goals.primary ? (
          <div className={cn(
            "group flex items-center gap-2 rounded-md px-2.5 py-1.5 border transition-colors",
            primaryDone
              ? "bg-emerald-500/10 border-emerald-400/20"
              : "bg-yellow-500/10 border-yellow-500/20 hover:border-yellow-500/40"
          )}>
            {/* Completion checkbox */}
            <button
              onClick={togglePrimaryDone}
              className={cn(
                "h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center transition-colors",
                primaryDone
                  ? "bg-emerald-500 border-emerald-500 text-white"
                  : "border-yellow-500/50 hover:border-yellow-500"
              )}
            >
              {primaryDone && <Check className="h-2.5 w-2.5" />}
            </button>
            {/* Edit button */}
            <button onClick={startEditPrimary} className="flex-1 flex items-center gap-2 text-left min-w-0">
              <span className={cn(
                "text-sm font-medium flex-1 truncate",
                primaryDone ? "line-through text-muted-foreground" : "text-foreground"
              )}>
                {goals.primary}
              </span>
              <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
            </button>
          </div>
        ) : (
          <button
            onClick={startEditPrimary}
            className="flex items-center gap-2 text-left rounded-md px-2.5 py-1.5 border border-dashed border-border hover:border-muted-foreground/50 transition-colors"
          >
            <span className="text-sm text-muted-foreground/60">Set your primary goal for today…</span>
          </button>
        )}
      </div>

      {/* Secondary goals */}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Secondary goals
        </p>
        <div className="flex flex-col gap-0.5">
          {goals.secondary.map((g) => {
            const done = secDone.has(g.id);
            return (
              <div key={g.id} className="flex items-center gap-2 group py-0.5 pl-1">
                <button
                  onClick={() => toggleSecDone(g.id)}
                  className={cn(
                    "h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center transition-colors",
                    done
                      ? "bg-emerald-500 border-emerald-500 text-white"
                      : "border-muted-foreground/30 hover:border-muted-foreground"
                  )}
                >
                  {done && <Check className="h-2 w-2" />}
                </button>
                <span className={cn(
                  "text-sm flex-1",
                  done ? "line-through text-muted-foreground" : "text-foreground"
                )}>
                  {g.text}
                </span>
                <button onClick={() => onDeleteSecondary(g.id)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5">
          <input
            className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Add secondary goal… (Enter)"
            value={secDraft}
            onChange={(e) => setSecDraft(e.target.value)}
            onKeyDown={handleSecKey}
          />
          <button
            onClick={() => { if (secDraft.trim()) { onAddSecondary(secDraft.trim()); setSecDraft(""); } }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Quick Cards ───────────────────────────────────────────────────────────────

function RemindersPanel({ reminders, onAdd, onToggle, onDelete }: {
  reminders: Reminder[];
  onAdd: (title: string) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [draft, setDraft] = useState("");

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && draft.trim()) {
      onAdd(draft.trim());
      setDraft("");
    }
  }

  const open = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);

  return (
    <div className="flex flex-col gap-2 pt-1">
      {/* Add input */}
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Add reminder… (Enter)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(""); } }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Open reminders */}
      {open.length === 0 && done.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No reminders yet.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {open.map((r) => (
            <div key={r.id} className="flex items-center gap-2 group py-0.5">
              <button
                onClick={() => onToggle(r.id)}
                className="h-3.5 w-3.5 shrink-0 rounded border border-border hover:border-primary transition-colors"
              />
              <span className="text-xs flex-1 truncate">{r.title}</span>
              <button onClick={() => onDelete(r.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {done.length > 0 && (
            <>
              {open.length > 0 && <div className="h-px bg-border my-1" />}
              {done.map((r) => (
                <div key={r.id} className="flex items-center gap-2 group py-0.5 opacity-50">
                  <button
                    onClick={() => onToggle(r.id)}
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-primary bg-primary transition-colors"
                  >
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </button>
                  <span className="text-xs flex-1 truncate line-through">{r.title}</span>
                  <button onClick={() => onDelete(r.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Quick Notes Panel ─────────────────────────────────────────────────────────

function QuickNotesPanel({ notes, onAdd, onDelete }: {
  notes: QuickNote[];
  onAdd: (title: string, body: string | null) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function handleAdd() {
    if (!title.trim()) return;
    onAdd(title.trim(), body.trim() || null);
    setTitle(""); setBody(""); setAdding(false);
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
          <Plus className="h-3.5 w-3.5" /> New note
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <input autoFocus className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
          <textarea className="rounded border border-input bg-transparent px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Body (optional)" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-1.5">
            <button onClick={handleAdd} className="px-2 h-6 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90">Add</button>
            <button onClick={() => { setAdding(false); setTitle(""); setBody(""); }}
              className="px-2 h-6 text-xs rounded border border-border text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
      {notes.length === 0 && !adding && <p className="text-xs text-muted-foreground italic">No notes yet.</p>}
      <div className="flex flex-col gap-1">
        {notes.map((n) => {
          const open = expanded.has(n.id);
          return (
            <div key={n.id} className="group rounded border border-border px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                {n.body && (
                  <button onClick={() => setExpanded((prev) => { const s = new Set(prev); open ? s.delete(n.id) : s.add(n.id); return s; })}
                    className="shrink-0 text-muted-foreground hover:text-foreground">
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                )}
                <span className="text-xs flex-1 font-medium truncate">{n.title}</span>
                <button onClick={() => onDelete(n.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {open && n.body && <p className="text-xs text-muted-foreground mt-1 pl-5 whitespace-pre-wrap">{n.body}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Brain Dump Panel ──────────────────────────────────────────────────────────

function BrainDumpPanel({ entries, onAdd, onDelete }: {
  entries: BrainEntry[];
  onAdd: (content: string) => void;
  onDelete: (id: number) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-col gap-2 pt-1">
      <textarea
        autoFocus
        className="rounded border border-input bg-transparent px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Dump your thoughts… (Ctrl+Enter to save)"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim()) {
            onAdd(draft.trim()); setDraft("");
          }
        }}
      />
      <button
        onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(""); } }}
        className="self-start px-2 h-6 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
      >Capture</button>
      {entries.length === 0
        ? <p className="text-xs text-muted-foreground italic">Nothing captured yet.</p>
        : <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
            {entries.map((e) => (
              <div key={e.id} className="flex items-start gap-2 group py-0.5">
                <span className="text-xs flex-1 text-muted-foreground whitespace-pre-wrap">{e.content}</span>
                <button onClick={() => onDelete(e.id)} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive mt-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

// ── Events Panel ──────────────────────────────────────────────────────────────

function EventsPanel({ events, onAdd, onDelete }: {
  events: CalEvent[];
  onAdd: (title: string, date: string) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  function handleAdd() {
    if (!title.trim() || !date) return;
    onAdd(title.trim(), date);
    setTitle(""); setDate("");
  }

  function relativeDate(d: string) {
    const days = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 0) return `${Math.abs(days)}d ago`;
    if (days < 7) return `In ${days}d`;
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-center gap-1.5">
        <input className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        <input type="date" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={handleAdd}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {events.length === 0
        ? <p className="text-xs text-muted-foreground italic">No events.</p>
        : <div className="flex flex-col gap-0.5">
            {events.map((ev) => {
              const past = ev.date < today;
              return (
                <div key={ev.id} className={cn("flex items-center gap-2 group py-0.5", past && "opacity-50")}>
                  <span className={cn("text-xs w-16 shrink-0 tabular-nums", ev.date === today ? "text-primary font-medium" : past ? "text-muted-foreground" : "text-foreground")}>
                    {relativeDate(ev.date)}
                  </span>
                  <span className="text-xs flex-1 truncate">{ev.title}</span>
                  <button onClick={() => onDelete(ev.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ── Deadlines Panel ───────────────────────────────────────────────────────────

function DeadlinesPanel({ deadlines, onAdd, onToggle, onDelete }: {
  deadlines: Deadline[];
  onAdd: (title: string, due_date: string) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  function handleAdd() {
    if (!title.trim() || !date) return;
    onAdd(title.trim(), date);
    setTitle(""); setDate("");
  }

  const open = deadlines.filter((d) => !d.done);
  const done = deadlines.filter((d) => d.done);

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-center gap-1.5">
        <input className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Deadline title" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        <input type="date" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={handleAdd}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {deadlines.length === 0
        ? <p className="text-xs text-muted-foreground italic">No deadlines.</p>
        : <div className="flex flex-col gap-0.5">
            {open.map((d) => {
              const overdue = d.due_date < today;
              const days = Math.round((new Date(d.due_date).getTime() - new Date(today).getTime()) / 86_400_000);
              return (
                <div key={d.id} className="flex items-center gap-2 group py-0.5">
                  <button onClick={() => onToggle(d.id)}
                    className="h-3.5 w-3.5 shrink-0 rounded border border-border hover:border-primary transition-colors" />
                  <span className={cn("text-xs flex-1 truncate", overdue && "text-destructive")}>{d.title}</span>
                  <span className={cn("text-xs shrink-0 tabular-nums", overdue ? "text-destructive" : "text-muted-foreground")}>
                    {overdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}
                  </span>
                  <button onClick={() => onDelete(d.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {done.length > 0 && open.length > 0 && <div className="h-px bg-border my-1" />}
            {done.map((d) => (
              <div key={d.id} className="flex items-center gap-2 group py-0.5 opacity-50">
                <button onClick={() => onToggle(d.id)}
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-primary bg-primary transition-colors">
                  <Check className="h-2.5 w-2.5 text-primary-foreground" />
                </button>
                <span className="text-xs flex-1 truncate line-through">{d.title}</span>
                <button onClick={() => onDelete(d.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

// ── Agreements Panel ──────────────────────────────────────────────────────────

function AgreementsPanel({ agreements, onAdd, onDelete }: {
  agreements: Agreement[];
  onAdd: (title: string, notes: string | null) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function handleAdd() {
    if (!title.trim()) return;
    onAdd(title.trim(), notes.trim() || null);
    setTitle(""); setNotes(""); setAdding(false);
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
          <Plus className="h-3.5 w-3.5" /> New agreement
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <input autoFocus className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="What was agreed" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
          <textarea className="rounded border border-input bg-transparent px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Notes / context (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-1.5">
            <button onClick={handleAdd} className="px-2 h-6 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90">Add</button>
            <button onClick={() => { setAdding(false); setTitle(""); setNotes(""); }}
              className="px-2 h-6 text-xs rounded border border-border text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
      {agreements.length === 0 && !adding && <p className="text-xs text-muted-foreground italic">No agreements recorded.</p>}
      <div className="flex flex-col gap-1">
        {agreements.map((a) => {
          const open = expanded.has(a.id);
          return (
            <div key={a.id} className="group rounded border border-border px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                {a.notes && (
                  <button onClick={() => setExpanded((prev) => { const s = new Set(prev); open ? s.delete(a.id) : s.add(a.id); return s; })}
                    className="shrink-0 text-muted-foreground hover:text-foreground">
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                )}
                <span className="text-xs flex-1 font-medium truncate">{a.title}</span>
                <button onClick={() => onDelete(a.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {open && a.notes && <p className="text-xs text-muted-foreground mt-1 pl-5 whitespace-pre-wrap">{a.notes}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type CardId = "reminders" | "notes" | "brain" | "events" | "deadlines" | "agreements";

interface CardDef {
  id: CardId;
  label: string;
  icon: import("react").ReactNode;
  count?: number;
}

function QuickCards({
  reminders, onAddReminder, onToggleReminder, onDeleteReminder,
  notes, onAddNote, onDeleteNote,
  brainEntries, onAddBrain, onDeleteBrain,
  events, onAddEvent, onDeleteEvent,
  deadlines, onAddDeadline, onToggleDeadline, onDeleteDeadline,
  agreements, onAddAgreement, onDeleteAgreement,
}: {
  reminders: Reminder[];       onAddReminder: (t: string) => void;    onToggleReminder: (id: number) => void; onDeleteReminder: (id: number) => void;
  notes: QuickNote[];          onAddNote: (t: string, b: string | null) => void; onDeleteNote: (id: number) => void;
  brainEntries: BrainEntry[];  onAddBrain: (c: string) => void;       onDeleteBrain: (id: number) => void;
  events: CalEvent[];          onAddEvent: (t: string, d: string) => void; onDeleteEvent: (id: number) => void;
  deadlines: Deadline[];       onAddDeadline: (t: string, d: string) => void; onToggleDeadline: (id: number) => void; onDeleteDeadline: (id: number) => void;
  agreements: Agreement[];     onAddAgreement: (t: string, n: string | null) => void; onDeleteAgreement: (id: number) => void;
}) {
  const [open, setOpen] = useState<CardId | null>(null);
  const toggle = (id: CardId) => setOpen((prev) => prev === id ? null : id);

  const today = new Date().toISOString().slice(0, 10);
  const cards: CardDef[] = [
    { id: "reminders",  label: "Reminders",   icon: <Bell className="h-3.5 w-3.5" />,     count: reminders.filter((r) => !r.done).length || undefined },
    { id: "notes",      label: "Quick Notes",  icon: <FileText className="h-3.5 w-3.5" />, count: notes.length || undefined },
    { id: "brain",      label: "Brain Dump",   icon: <Zap className="h-3.5 w-3.5" />,      count: brainEntries.length || undefined },
    { id: "events",     label: "Events",       icon: <Calendar className="h-3.5 w-3.5" />, count: events.filter((e) => e.date >= today).length || undefined },
    { id: "deadlines",  label: "Deadlines",    icon: <Clock className="h-3.5 w-3.5" />,    count: deadlines.filter((d) => !d.done).length || undefined },
    { id: "agreements", label: "Agreements",   icon: <Handshake className="h-3.5 w-3.5" />,count: agreements.length || undefined },
  ];

  return (
    <div className="flex flex-col gap-2">
      {/* Card strip */}
      <div className="flex items-center gap-2 flex-wrap">
        {cards.map((card) => (
          <button
            key={card.id}
            onClick={() => toggle(card.id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors",
              open === card.id
                ? "bg-secondary border-border text-foreground"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/50"
            )}
          >
            {card.icon}
            {card.label}
            {card.count != null && (
              <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] px-1">
                {card.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Dropdown panel */}
      {open && (
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          {open === "reminders"  && <RemindersPanel  reminders={reminders}   onAdd={onAddReminder}  onToggle={onToggleReminder} onDelete={onDeleteReminder} />}
          {open === "notes"      && <QuickNotesPanel notes={notes}           onAdd={onAddNote}      onDelete={onDeleteNote} />}
          {open === "brain"      && <BrainDumpPanel  entries={brainEntries}  onAdd={onAddBrain}     onDelete={onDeleteBrain} />}
          {open === "events"     && <EventsPanel     events={events}         onAdd={onAddEvent}     onDelete={onDeleteEvent} />}
          {open === "deadlines"  && <DeadlinesPanel  deadlines={deadlines}   onAdd={onAddDeadline}  onToggle={onToggleDeadline} onDelete={onDeleteDeadline} />}
          {open === "agreements" && <AgreementsPanel agreements={agreements} onAdd={onAddAgreement} onDelete={onDeleteAgreement} />}
        </div>
      )}
    </div>
  );
}

// ── Top Goals ─────────────────────────────────────────────────────────────────

const GROUP_COLOR_MAP: Record<string, { bg: string; text: string }> = {
  slate:  { bg: "bg-slate-500/15",  text: "text-slate-600 dark:text-slate-400" },
  red:    { bg: "bg-red-500/15",    text: "text-red-600 dark:text-red-400" },
  orange: { bg: "bg-orange-500/15", text: "text-orange-600 dark:text-orange-400" },
  yellow: { bg: "bg-yellow-400/15", text: "text-yellow-600 dark:text-yellow-400" },
  green:  { bg: "bg-green-500/15",  text: "text-green-600 dark:text-green-400" },
  teal:   { bg: "bg-teal-500/15",   text: "text-teal-600 dark:text-teal-400" },
  blue:   { bg: "bg-blue-500/15",   text: "text-blue-600 dark:text-blue-400" },
  purple: { bg: "bg-purple-500/15", text: "text-purple-600 dark:text-purple-400" },
  pink:   { bg: "bg-pink-500/15",   text: "text-pink-600 dark:text-pink-400" },
};

function TopGoals({ goals, groups }: { goals: Goal[]; groups: GoalGroup[] }) {
  const [groupFilter, setGroupFilter] = useState<number | null>(null);

  const visibleGoals = [...goals]
    .filter((g) => groupFilter === null || g.group_id === groupFilter)
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      const pd = (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
      if (pd !== 0) return pd;
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      return a.deadline ? -1 : b.deadline ? 1 : 0;
    });

  return (
    <div className="flex flex-col gap-2">
      {/* Header + group toggles */}
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5 shrink-0">
          <Target className="h-3.5 w-3.5" /> Goals
        </h2>
        {groups.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <button
              onClick={() => setGroupFilter(null)}
              className={cn(
                "px-2 py-0.5 text-xs rounded-full border transition-colors font-medium",
                groupFilter === null
                  ? "bg-foreground text-background border-foreground"
                  : "text-muted-foreground border-border hover:text-foreground"
              )}
            >
              All
            </button>
            {groups.map((g) => {
              const col = GROUP_COLOR_MAP[g.color] ?? GROUP_COLOR_MAP.slate;
              const active = groupFilter === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setGroupFilter(active ? null : g.id)}
                  className={cn(
                    "px-2 py-0.5 text-xs rounded-full border transition-colors font-medium",
                    active
                      ? cn("border-transparent", col.bg, col.text)
                      : "text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  {g.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Goal list — scrollable, capped height */}
      <div className="flex flex-col gap-2 overflow-y-auto max-h-48 pr-1">
        {visibleGoals.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No active goals.</p>
        ) : visibleGoals.map((goal) => {
          const pct  = goal.task_count === 0 ? 0 : Math.round((goal.done_count / goal.task_count) * 100);
          const days = goal.deadline ? daysUntil(goal.deadline) : null;
          const col  = goal.group_color ? GROUP_COLOR_MAP[goal.group_color] : null;
          return (
            <div key={goal.id} className="flex flex-col gap-1 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <PriorityDot priority={goal.priority} />
                <span className="text-sm font-medium text-foreground truncate flex-1">{goal.title}</span>
                {col && goal.group_name && (
                  <span className={cn("text-xs px-1.5 py-0 rounded-full shrink-0 font-medium", col.bg, col.text)}>
                    {goal.group_name}
                  </span>
                )}
                {days !== null && (
                  <Badge variant={deadlineVariant(days)} className="text-xs shrink-0 px-1.5 py-0">
                    {deadlineLabel(days)}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Progress value={goal.done_count} max={goal.task_count || 1} className="flex-1" />
                <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── To-Do List ────────────────────────────────────────────────────────────────

function TodoList({
  tasks, plans, systems, courseAssignments, today, onToggleTask, onCreateTask, onDeleteTask, onUpdateTask, onMarkSystem, onUnmarkSystem, onToggleSubtask, subtaskMap, onToggleAssignment,
}: {
  tasks: TaskWithContext[];
  plans: Plan[];
  systems: SystemEntry[];
  courseAssignments: CourseAssignment[];
  today: string;
  onToggleTask: (id: number) => void;
  onCreateTask: (payload: { plan_id?: number | null; title: string; priority?: string; due_date?: string | null }) => void;
  onDeleteTask: (id: number) => void;
  onUpdateTask: (id: number, payload: { title: string; priority: string; due_date?: string | null }) => void;
  onMarkSystem: (id: number) => void;
  onUnmarkSystem: (id: number) => void;
  onToggleSubtask: (subtaskId: number, systemId: number) => void;
  subtaskMap: Record<number, SystemSubtask[]>;
  onToggleAssignment: (ca: CourseAssignment) => void;
}) {
  const [tasksCollapsed, setTasksCollapsed] = useState(false);
  const [systemsCollapsed, setSystemsCollapsed] = useState(false);
  const [studyCollapsed, setStudyCollapsed] = useState(false);
  const [collapsedPlans, setCollapsedPlans] = useState<Set<number | null>>(new Set());
  // Systems where the user has manually expanded subtasks even after completion
  const [expandedSystems, setExpandedSystems] = useState<Set<number>>(new Set());

  // Create form state
  const [showAdd, setShowAdd] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPlanId, setNewPlanId] = useState<number | null>(null);
  const [newPriority, setNewPriority] = useState("medium");
  const [newDueDate, setNewDueDate] = useState("");

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState("medium");
  const [editDueDate, setEditDueDate] = useState("");

  // Hover state for delete button
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const activePlans = plans.filter((p) => p.status === "active");

  const submitCreate = () => {
    const title = newTitle.trim();
    if (!title) return;
    onCreateTask({ plan_id: newPlanId ?? null, title, priority: newPriority, due_date: newDueDate || null });
    setNewTitle(""); setNewPlanId(null); setNewPriority("medium"); setNewDueDate("");
    setShowAdd(false);
  };

  const startEdit = (task: TaskWithContext) => {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditPriority(task.priority);
    setEditDueDate(task.due_date ?? "");
  };

  const submitEdit = (id: number) => {
    const title = editTitle.trim();
    if (!title) { setEditingId(null); return; }
    onUpdateTask(id, { title, priority: editPriority, due_date: editDueDate || null });
    setEditingId(null);
  };

  const toggleSystemExpand = (id: number) =>
    setExpandedSystems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const open = useMemo(() => [...tasks]
    .filter((t) => !t.done)
    .sort((a, b) => {
      const p = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      const aOver = a.due_date && a.due_date < today ? 0 : 1;
      const bOver = b.due_date && b.due_date < today ? 0 : 1;
      if (aOver !== bOver) return aOver - bOver;
      const pd = (p[a.priority] ?? 1) - (p[b.priority] ?? 1);
      if (pd !== 0) return pd;
      if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date);
      return a.due_date ? -1 : b.due_date ? 1 : 0;
    }), [tasks, today]);

  // Group open tasks by plan
  const byPlan = useMemo(() => {
    const map = new Map<number | null, { planTitle: string | null; goalTitle: string | null; tasks: TaskWithContext[] }>();
    for (const t of open) {
      if (!map.has(t.plan_id)) map.set(t.plan_id, { planTitle: t.plan_title, goalTitle: t.goal_title, tasks: [] });
      map.get(t.plan_id)!.tasks.push(t);
    }
    return Array.from(map.entries()); // [planId, group]
  }, [open]);

  const togglePlan = (planId: number | null) => {
    setCollapsedPlans((prev) => {
      const next = new Set(prev);
      if (next.has(planId)) next.delete(planId); else next.add(planId);
      return next;
    });
  };

  const SectionHeader = ({ icon, label, collapsed, onToggle }: {
    icon: import("react").ReactNode; label: string; collapsed: boolean; onToggle: () => void;
  }) => (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-fit"
    >
      {icon}
      {label}
      {collapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
    </button>
  );

  return (
    <div className="flex flex-col gap-3">

      {/* ── Tasks section ── */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <SectionHeader
            icon={<CheckSquare className="h-3.5 w-3.5" />}
            label={`Tasks${open.length > 0 ? ` (${open.length})` : ""}`}
            collapsed={tasksCollapsed}
            onToggle={() => setTasksCollapsed((v) => !v)}
          />
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Inline create form */}
        {showAdd && (
          <div className="flex flex-col gap-2 p-2 rounded-md border border-border bg-muted/30">
            <input
              autoFocus
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") submitCreate(); if (e.key === "Escape") setShowAdd(false); }}
              placeholder="Task title…"
              className="text-sm bg-transparent border-none outline-none placeholder:text-muted-foreground/50 w-full"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={newPlanId ?? ""}
                onChange={(e) => setNewPlanId(e.target.value ? Number(e.target.value) : null)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none max-w-32"
              >
                <option value="">No plan</option>
                {activePlans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
              <input
                type="date"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="text-xs bg-input border border-border rounded px-1.5 py-0.5 outline-none"
              />
              <button
                onClick={submitCreate}
                disabled={!newTitle.trim()}
                className="ml-auto text-xs bg-primary text-primary-foreground px-2 py-0.5 rounded disabled:opacity-40 hover:bg-primary/90 transition-colors"
              >
                Add
              </button>
              <button onClick={() => setShowAdd(false)} className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        )}

        {!tasksCollapsed && (
          open.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle className="h-4 w-4 text-green-500 shrink-0" /> All tasks done!
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {byPlan.map(([planId, group]) => {
                const isPlanCollapsed = collapsedPlans.has(planId);
                return (
                  <div key={planId} className="flex flex-col gap-0.5">
                    {/* Plan group header */}
                    <button
                      onClick={() => togglePlan(planId)}
                      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit"
                    >
                      {isPlanCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      <span className="font-medium">{group.planTitle ?? "No plan"}</span>
                      {group.goalTitle && <span className="opacity-60">· {group.goalTitle}</span>}
                      <span className="opacity-50">({group.tasks.length})</span>
                    </button>

                    {!isPlanCollapsed && (
                      <div className="flex flex-col gap-0.5 pl-4 border-l border-border ml-1">
                        {group.tasks.map((task) => {
                          const overdue  = task.due_date && task.due_date < today;
                          const dueToday = task.due_date === today;
                          const isEditing = editingId === task.id;
                          return (
                            <div
                              key={task.id}
                              className="flex items-start gap-2 py-0.5 group/task"
                              onMouseEnter={() => setHoveredId(task.id)}
                              onMouseLeave={() => setHoveredId(null)}
                            >
                              <button
                                onClick={() => onToggleTask(task.id)}
                                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border hover:border-primary transition-colors"
                              />
                              <div className="flex-1 min-w-0">
                                {isEditing ? (
                                  <div className="flex flex-col gap-1">
                                    <input
                                      autoFocus
                                      value={editTitle}
                                      onChange={(e) => setEditTitle(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter") submitEdit(task.id); if (e.key === "Escape") setEditingId(null); }}
                                      onBlur={() => submitEdit(task.id)}
                                      className="text-sm bg-input border border-border rounded px-1.5 py-0.5 outline-none focus:ring-1 focus:ring-ring w-full"
                                    />
                                    <div className="flex gap-1.5 items-center">
                                      <select
                                        value={editPriority}
                                        onChange={(e) => setEditPriority(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      >
                                        <option value="high">High</option>
                                        <option value="medium">Medium</option>
                                        <option value="low">Low</option>
                                      </select>
                                      <input
                                        type="date"
                                        value={editDueDate}
                                        onChange={(e) => setEditDueDate(e.target.value)}
                                        className="text-xs bg-input border border-border rounded px-1 py-0.5 outline-none"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div
                                    className="flex items-center gap-1.5 min-w-0 cursor-pointer"
                                    onClick={() => startEdit(task)}
                                  >
                                    <PriorityDot priority={task.priority} />
                                    <span className={cn("text-sm truncate", overdue && "text-destructive")}>
                                      {task.title}
                                    </span>
                                    {(overdue || dueToday) && (
                                      <span className="text-xs text-muted-foreground shrink-0">
                                        {overdue ? "overdue" : "today"}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>
                              {!isEditing && hoveredId === task.id && (
                                <button
                                  onClick={() => onDeleteTask(task.id)}
                                  className="mt-0.5 p-0.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        )}
      </div>

      {/* ── Study section ── */}
      {courseAssignments.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeader
            icon={<BookOpen className="h-3.5 w-3.5" />}
            label={`Study (${courseAssignments.length})`}
            collapsed={studyCollapsed}
            onToggle={() => setStudyCollapsed((v) => !v)}
          />
          {!studyCollapsed && (
            <div className="flex flex-col gap-1">
              {courseAssignments.map((ca) => {
                const done = ca.status === "done";
                return (
                  <div key={ca.id} className="flex items-start gap-2 py-0.5">
                    <button
                      onClick={() => onToggleAssignment(ca)}
                      className={cn(
                        "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                        done ? "bg-primary border-primary" : "border-border hover:border-primary"
                      )}
                    >
                      {done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <span className={cn("text-sm truncate block", done && "line-through text-muted-foreground")}>
                        {ca.title}
                      </span>
                      <p className="text-xs text-muted-foreground truncate">{ca.plan_title}</p>
                    </div>
                    {ca.start_time && (
                      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{ca.start_time}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Systems section ── */}
      {systems.length > 0 && (
        <div className="flex flex-col gap-2">
          <SectionHeader
            icon={<RefreshCw className="h-3.5 w-3.5" />}
            label="Systems"
            collapsed={systemsCollapsed}
            onToggle={() => setSystemsCollapsed((v) => !v)}
          />

          {!systemsCollapsed && (
            <div className="flex flex-col gap-1">
              {systems.map((sys) => {
                const due = isDue(sys);
                const subtasks = subtaskMap[sys.id] ?? [];
                const hasSubtasks = subtasks.length > 0;
                const allSubtasksDone = hasSubtasks && subtasks.every((s) => s.done);
                // Auto-collapse when all done; user can manually re-expand
                const subtasksVisible = hasSubtasks && (!allSubtasksDone || expandedSystems.has(sys.id));

                return (
                  <div key={sys.id} className={cn("flex flex-col gap-0.5", !due && "opacity-60")}>
                    <div className="flex items-center gap-2 py-0.5">
                      {/* Chevron toggle for systems with subtasks */}
                      {hasSubtasks && (
                        <button
                          onClick={() => toggleSystemExpand(sys.id)}
                          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          {subtasksVisible ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      )}
                      <span className={cn("text-sm truncate flex-1", due ? "text-foreground" : "text-muted-foreground")}>
                        {sys.title}
                      </span>
                      {sys.streak_count > 1 && (
                        <span className="flex items-center gap-0.5 text-xs text-orange-500 shrink-0">
                          <Flame className="h-3 w-3" />{sys.streak_count}
                        </span>
                      )}
                      {!hasSubtasks && (
                        due ? (
                          <Button size="sm" variant="outline" className="h-6 px-2 text-xs shrink-0"
                            onClick={() => onMarkSystem(sys.id)}>
                            Done
                          </Button>
                        ) : (
                          <button onClick={() => onUnmarkSystem(sys.id)} title="Mark as not done"
                            className="shrink-0 hover:opacity-70 transition-opacity">
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          </button>
                        )
                      )}
                      {hasSubtasks && (
                        allSubtasksDone ? (
                          <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                        ) : (
                          <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                            {subtasks.filter((s) => s.done).length}/{subtasks.length}
                          </span>
                        )
                      )}
                    </div>

                    {subtasksVisible && (
                      <div className="flex flex-col gap-0.5 pl-3 border-l border-border ml-1">
                        {subtasks.map((sub) => (
                          <div key={sub.id} className="flex items-center gap-2 py-0.5">
                            <button
                              onClick={() => onToggleSubtask(sub.id, sys.id)}
                              className={cn(
                                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                                sub.done ? "bg-primary border-primary" : "border-border hover:border-primary"
                              )}
                            >
                              {sub.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                            </button>
                            <span className={cn(
                              "text-xs flex-1 truncate",
                              sub.done ? "line-through text-muted-foreground" : "text-foreground"
                            )}>
                              {sub.title}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Journal Strip ─────────────────────────────────────────────────────────────

function JournalStrip({ content, onSave }: {
  date: string;
  content: string;
  onSave: (text: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState(content);
  const savedRef = useRef(content);

  useEffect(() => {
    setDraft(content);
    savedRef.current = content;
  }, [content]);

  function handleBlur() {
    if (draft !== savedRef.current) {
      savedRef.current = draft;
      onSave(draft);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors w-fit"
      >
        <BookOpen className="h-3.5 w-3.5" />
        Reflection
        {collapsed
          ? <ChevronRight className="h-3 w-3" />
          : <ChevronDown  className="h-3 w-3" />
        }
      </button>

      {!collapsed && (
        <div className="flex flex-col gap-1">
          <textarea
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed
                       placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring
                       resize-none"
            rows={5}
            placeholder="Write about your day, reflect on what went well, what you'd do differently…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={handleBlur}
          />
          <p className="text-[10px] text-muted-foreground/50">Auto-saves when you click away</p>
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const [goals,      setGoals]      = useState<Goal[]>([]);
  const [groups,     setGroups]     = useState<GoalGroup[]>([]);
  const [plans,      setPlans]      = useState<Plan[]>([]);
  const [tasks,      setTasks]      = useState<TaskWithContext[]>([]);
  const [systems,    setSystems]    = useState<SystemEntry[]>([]);
  const [subtaskMap, setSubtaskMap] = useState<Record<number, SystemSubtask[]>>({});
  const [calBlocks,  setCalBlocks]  = useState<CalBlock[]>([]);
  const [dailyGoals, setDailyGoals] = useState<DailyGoals>({ primary: null, secondary: [] });
  const [reminders,  setReminders]  = useState<Reminder[]>([]);
  const [notes,      setNotes]      = useState<QuickNote[]>([]);
  const [brainEntries, setBrainEntries] = useState<BrainEntry[]>([]);
  const [events,     setEvents]     = useState<CalEvent[]>([]);
  const [deadlines,  setDeadlines]  = useState<Deadline[]>([]);
  const [agreements, setAgreements] = useState<Agreement[]>([]);
  const [journalContent, setJournalContent] = useState("");
  const [courseAssignments, setCourseAssignments] = useState<CourseAssignment[]>([]);

  const date = todayDate();

  const loadSubtasks = useCallback(async (sysList: SystemEntry[]) => {
    const entries = await Promise.all(
      sysList.map(async (s) => [s.id, await getSystemSubtasks(s.id, date)] as [number, SystemSubtask[]])
    );
    setSubtaskMap(Object.fromEntries(entries));
  }, [date]);

  const load = useCallback(async () => {
    const [g, gr, p, t, s, cb, dg, rem, qn, bd, ev, dl, ag, jc, cas] = await Promise.all([
      getGoals(), getGoalGroups(), getPlans(), getAllTasks(), getSystems(), getCalBlocks(date, date),
      getDailyGoals(date), getReminders(), getQuickNotes(), getBrainDump(), getEvents(), getDeadlines(), getAgreements(),
      getJournalEntry(date), getCourseAssignments(),
    ]);
    setGoals(g); setGroups(gr); setPlans(p); setTasks(t); setSystems(s); setCalBlocks(cb);
    setDailyGoals(dg); setReminders(rem); setNotes(qn); setBrainEntries(bd); setEvents(ev); setDeadlines(dl); setAgreements(ag);
    setJournalContent(jc);
    setCourseAssignments(cas.filter((ca) => ca.due_date === date));
    loadSubtasks(s);
  }, [date, loadSubtasks]);

  useEffect(() => { load(); }, [load]);

  const activeGoals = goals.filter((g) => g.status === "active");

  const handleToggleTask = async (id: number) => {
    await toggleTask(id);
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  };

  const handleCreateTask = async (payload: { plan_id?: number | null; title: string; priority?: string; due_date?: string | null }) => {
    await createTask(payload);
    const t = await getAllTasks();
    setTasks(t);
  };

  const handleDeleteTask = async (id: number) => {
    await deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  const handleUpdateTask = async (id: number, payload: { title: string; priority: string; due_date?: string | null }) => {
    await updateTask(id, payload);
    const t = await getAllTasks();
    setTasks(t);
  };

  const handleMarkSystem = async (id: number) => {
    await markSystemDone(id);
    const s = await getSystems();
    setSystems(s);
    loadSubtasks(s);
  };

  const handleUnmarkSystem = async (id: number) => {
    await unmarkSystemDone(id);
    const s = await getSystems();
    setSystems(s);
    loadSubtasks(s);
  };

  const handleToggleSubtask = async (subtaskId: number, systemId: number) => {
    const result = await toggleSystemSubtask(subtaskId, date);
    setSubtaskMap((prev) => ({ ...prev, [systemId]: result.subtasks }));
    setSystems((prev) => prev.map((s) => s.id === result.system.id ? result.system : s));
  };

  const handleSetPrimary = async (text: string) => {
    await setDailyPrimaryGoal(date, text);
    setDailyGoals((prev) => ({ ...prev, primary: text }));
  };
  const handleClearPrimary = async () => {
    await clearDailyPrimaryGoal(date);
    setDailyGoals((prev) => ({ ...prev, primary: null }));
  };
  const handleAddSecondary = async (text: string) => {
    const g = await addDailySecondaryGoal(date, text);
    setDailyGoals((prev) => ({ ...prev, secondary: [...prev.secondary, g] }));
  };
  const handleDeleteSecondary = async (id: number) => {
    await deleteDailySecondaryGoal(id);
    setDailyGoals((prev) => ({ ...prev, secondary: prev.secondary.filter((s) => s.id !== id) }));
  };

  const handleAddReminder = async (title: string) => {
    const r = await addReminder(title);
    setReminders((prev) => [...prev, r]);
  };

  const handleToggleReminder = async (id: number) => {
    const r = await toggleReminder(id);
    setReminders((prev) => prev.map((x) => x.id === id ? r : x));
  };

  const handleDeleteReminder = async (id: number) => {
    await deleteReminder(id);
    setReminders((prev) => prev.filter((x) => x.id !== id));
  };

  const handleAddNote = async (title: string, body: string | null) => {
    const n = await addQuickNote(title, body);
    setNotes((prev) => [n, ...prev]);
  };
  const handleDeleteNote = async (id: number) => { await deleteQuickNote(id); setNotes((prev) => prev.filter((x) => x.id !== id)); };

  const handleAddBrain = async (content: string) => {
    const e = await addBrainEntry(content);
    setBrainEntries((prev) => [e, ...prev]);
  };
  const handleDeleteBrain = async (id: number) => { await deleteBrainEntry(id); setBrainEntries((prev) => prev.filter((x) => x.id !== id)); };

  const handleAddEvent = async (title: string, date: string) => {
    const e = await addEvent(title, date);
    setEvents((prev) => [...prev, e].sort((a, b) => a.date.localeCompare(b.date)));
  };
  const handleDeleteEvent = async (id: number) => { await deleteEvent(id); setEvents((prev) => prev.filter((x) => x.id !== id)); };

  const handleAddDeadline = async (title: string, due_date: string) => {
    const d = await addDeadline(title, due_date);
    setDeadlines((prev) => [...prev, d].sort((a, b) => a.due_date.localeCompare(b.due_date)));
  };
  const handleToggleDeadline = async (id: number) => {
    const d = await toggleDeadline(id);
    setDeadlines((prev) => prev.map((x) => x.id === id ? d : x));
  };
  const handleDeleteDeadline = async (id: number) => { await deleteDeadline(id); setDeadlines((prev) => prev.filter((x) => x.id !== id)); };

  const handleAddAgreement = async (title: string, notes: string | null) => {
    const a = await addAgreement(title, notes);
    setAgreements((prev) => [a, ...prev]);
  };
  const handleDeleteAgreement = async (id: number) => { await deleteAgreement(id); setAgreements((prev) => prev.filter((x) => x.id !== id)); };

  const handleToggleAssignment = async (ca: CourseAssignment) => {
    const newStatus = ca.status === "done" ? "pending" : "done";
    const updated = await updateCourseAssignment(ca.id, {
      plan_id: ca.plan_id, title: ca.title, assignment_type: ca.assignment_type,
      due_date: ca.due_date, status: newStatus, priority: ca.priority,
      book_title: ca.book_title, chapter_start: ca.chapter_start, chapter_end: ca.chapter_end,
      page_start: ca.page_start, page_end: ca.page_end, page_current: ca.page_current,
      notes: ca.notes, start_time: ca.start_time, end_time: ca.end_time,
    });
    setCourseAssignments((prev) => prev.map((x) => x.id === ca.id ? updated : x));
  };

  const handleSaveJournal = async (text: string) => {
    await saveJournalEntry(date, text);
    setJournalContent(text);
  };

  const handleCreateCalBlock = async (d: DCBlockDraft) => {
    const b = await createCalBlock(date, d.title, d.start_time, d.end_time, d.color, d.description || null, d.location || null);
    setCalBlocks((prev) => [...prev, b].sort((a, x) => a.start_time.localeCompare(x.start_time)));
  };
  const handleUpdateCalBlock = async (id: number, d: DCBlockDraft) => {
    const b = await updateCalBlock(id, d.title, d.start_time, d.end_time, d.color, d.description || null, d.location || null);
    setCalBlocks((prev) => prev.map((x) => x.id === id ? b : x));
  };
  const handleDeleteCalBlock = async (b: CalBlock) => {
    await deleteCalBlock(b.id);
    setCalBlocks((prev) => prev.filter((x) => x.id !== b.id));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-2.5rem)] overflow-hidden">

      <WelcomeBox goals={goals} plans={plans} tasks={tasks} systems={systems}
        dailyGoals={dailyGoals} courseAssignments={courseAssignments} date={date} />

      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* ── Left column ─────────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0 overflow-y-auto border-r border-border px-4 py-3 flex flex-col gap-4">

          {/* Daily Goals */}
          <DailyGoalsSection
            date={date}
            goals={dailyGoals}
            onSetPrimary={handleSetPrimary}
            onClearPrimary={handleClearPrimary}
            onAddSecondary={handleAddSecondary}
            onDeleteSecondary={handleDeleteSecondary}
          />

          <div className="h-px bg-border" />

          {/* Quick Cards */}
          <QuickCards
            reminders={reminders}    onAddReminder={handleAddReminder}    onToggleReminder={handleToggleReminder} onDeleteReminder={handleDeleteReminder}
            notes={notes}            onAddNote={handleAddNote}            onDeleteNote={handleDeleteNote}
            brainEntries={brainEntries} onAddBrain={handleAddBrain}      onDeleteBrain={handleDeleteBrain}
            events={events}          onAddEvent={handleAddEvent}          onDeleteEvent={handleDeleteEvent}
            deadlines={deadlines}    onAddDeadline={handleAddDeadline}    onToggleDeadline={handleToggleDeadline} onDeleteDeadline={handleDeleteDeadline}
            agreements={agreements}  onAddAgreement={handleAddAgreement}  onDeleteAgreement={handleDeleteAgreement}
          />

          <div className="h-px bg-border" />

          {/* Top Goals */}
          <TopGoals goals={activeGoals} groups={groups} />

          <div className="h-px bg-border" />

          {/* To-Do List */}
          <TodoList
            tasks={tasks}
            plans={plans}
            systems={systems}
            courseAssignments={courseAssignments}
            today={date}
            onToggleTask={handleToggleTask}
            onCreateTask={handleCreateTask}
            onDeleteTask={handleDeleteTask}
            onUpdateTask={handleUpdateTask}
            onMarkSystem={handleMarkSystem}
            onUnmarkSystem={handleUnmarkSystem}
            onToggleSubtask={handleToggleSubtask}
            subtaskMap={subtaskMap}
            onToggleAssignment={handleToggleAssignment}
          />

          <div className="h-px bg-border" />

          {/* Journal */}
          <JournalStrip date={date} content={journalContent} onSave={handleSaveJournal} />
        </div>

        {/* ── Right column: Day Calendar ──────────────────────────────────── */}
        <div className="w-72 shrink-0 flex flex-col overflow-hidden px-3 py-3">
          <DayCalendar
            date={date}
            calBlocks={calBlocks}
            systems={systems}
            courseAssignments={courseAssignments}
            onCreateBlock={handleCreateCalBlock}
            onUpdateBlock={handleUpdateCalBlock}
            onDeleteBlock={handleDeleteCalBlock}
          />
        </div>

      </div>

    </div>
  );
}
