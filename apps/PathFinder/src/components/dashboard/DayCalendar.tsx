// The day's timed calendar column, and the block editor modal behind it.

import { useEffect, useState, useCallback, useRef } from "react";
import { Check, Plus, X, Eye, EyeOff } from "lucide-react";
import { cn, layoutCalItems } from "../../lib/utils";
import type { TaskWithContext, SystemEntry, CalBlock, CourseAssignment, ScheduleEntry, TaskSession } from "../../types";
import { DCBlockDraft, DC_COLORS, DC_COLOR_KEYS, DC_HOURS, DC_HOUR_END, DC_HOUR_PX, DC_HOUR_START, addMinutes, dcAddHour, dcMinToPx, dcPxToTime, dcTimeToMin } from "./_shared";

// ── Day Block Modal ───────────────────────────────────────────────────────────

function DayBlockModal({
  initial, startTime, endTime, tasks, onSave, onDelete, onClose,
}: {
  initial?: CalBlock;
  startTime?: string;
  endTime?: string;
  tasks: TaskWithContext[];
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
    task_id:     initial?.task_id     ?? null,
  });
  const set = (p: Partial<DCBlockDraft>) => setForm((f) => ({ ...f, ...p }));
  const valid = form.title.trim() !== "" && form.start_time < form.end_time;
  const [saving, setSaving] = useState(false);

  const openTasks = tasks.filter((t) => !t.done);

  function handleTaskSelect(rawId: string) {
    if (!rawId) { set({ task_id: null }); return; }
    const id = Number(rawId);
    const task = openTasks.find((t) => t.id === id);
    if (!task) return;
    const updates: Partial<DCBlockDraft> = { task_id: id, title: task.title };
    if (task.time_estimate) {
      updates.end_time = addMinutes(form.start_time, task.time_estimate);
    }
    set(updates);
  }

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

        <div className="flex flex-col gap-0.5">
          <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Link task (optional)</label>
          <select
            className="h-7 rounded border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={form.task_id ?? ""}
            onChange={(e) => handleTaskSelect(e.target.value)}
          >
            <option value="">— none —</option>
            {openTasks.length === 0 && <option disabled value="">No open tasks</option>}
            {openTasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}{t.plan_title ? ` · ${t.plan_title}` : ""}{t.time_estimate ? ` (${t.time_estimate}min)` : ""}
              </option>
            ))}
          </select>
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
              value={form.start_time}
              onChange={(e) => {
                const newStart = e.target.value;
                const linkedTask = openTasks.find((t) => t.id === form.task_id);
                const newEnd = linkedTask?.time_estimate
                  ? addMinutes(newStart, linkedTask.time_estimate)
                  : form.end_time;
                set({ start_time: newStart, end_time: newEnd });
              }} />
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

// ── Habits Strip ─────────────────────────────────────────────────────────────


// ── Day Calendar ──────────────────────────────────────────────────────────────

export function DayCalendar({
  date: _date, calBlocks, systems, courseAssignments, scheduleEntries, tasks,
  sessionsByBlock, onCreateBlock, onUpdateBlock, onDeleteBlock, onToggleWorked,
}: {
  date: string;
  calBlocks: CalBlock[];
  systems: SystemEntry[];
  courseAssignments: CourseAssignment[];
  scheduleEntries: ScheduleEntry[];
  tasks: TaskWithContext[];
  /** Sessions already logged, keyed by the occurrence's cal_block_id. */
  sessionsByBlock: Map<number, TaskSession>;
  onCreateBlock: (d: DCBlockDraft) => Promise<void>;
  onUpdateBlock: (id: number, d: DCBlockDraft) => Promise<void>;
  onDeleteBlock: (b: CalBlock) => Promise<void>;
  onToggleWorked: (b: CalBlock) => void;
}) {
  const colRef    = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<{
    block?: CalBlock;
    startTime?: string;
    endTime?: string;
  } | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const toggleHidden = useCallback((id: string) => {
    setHiddenIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

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
  // Schedule entries for today with a start_time
  const timedSEs     = scheduleEntries.filter((e) => e.start_time);

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
                | { kind: "blk"; startMin: number; endMin: number; b: CalBlock }
                | { kind: "se";  startMin: number; endMin: number; e: ScheduleEntry };

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
                ...timedSEs.map((e) => ({
                  kind: "se" as const,
                  startMin: dcTimeToMin(e.start_time!),
                  endMin:   e.end_time ? dcTimeToMin(e.end_time) : dcTimeToMin(e.start_time!) + 60,
                  e,
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
                  const sysId = `sys-${s.id}`;
                  const sysHidden = hiddenIds.has(sysId);
                  return (
                    <div
                      key={`sys-${s.id}`}
                      data-block="1"
                      title={s.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default group", clr.bg, clr.border, sysHidden && "opacity-15")}
                      style={{ top, height: ht, left, right }}
                    >
                      <button
                        className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", sysHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                        onClick={(e) => { e.stopPropagation(); toggleHidden(sysId); }}
                      >
                        {sysHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                      </button>
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
                  const caId = `ca-${ca.id}`;
                  const caHidden = hiddenIds.has(caId);
                  return (
                    <div
                      key={`ca-${ca.id}`}
                      data-block="1"
                      title={ca.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default group", clr.bg, clr.border, caHidden && "opacity-15")}
                      style={{ top, height: ht, left, right }}
                    >
                      <button
                        className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", caHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                        onClick={(e) => { e.stopPropagation(); toggleHidden(caId); }}
                      >
                        {caHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                      </button>
                      <p className={cn("text-[10px] font-medium leading-tight truncate", clr.text)}>{ca.title}</p>
                      {ht > 26 && ca.end_time && (
                        <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                          {ca.start_time}–{ca.end_time}
                        </p>
                      )}
                    </div>
                  );
                }

                if (item.kind === "se") {
                  const { e } = item;
                  const clr   = DC_COLORS[e.color] ?? DC_COLORS.blue;
                  const seId  = `se-${e.recurring_id ?? e.id}-${e.date}`;
                  const seHidden = hiddenIds.has(seId);
                  return (
                    <div
                      key={seId}
                      data-block="1"
                      title={e.title}
                      className={cn("absolute rounded border px-1 py-0.5 overflow-hidden cursor-default group", clr.bg, clr.border, seHidden && "opacity-15")}
                      style={{ top, height: ht, left, right }}
                    >
                      <button
                        className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", seHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                        onClick={(e) => { e.stopPropagation(); toggleHidden(seId); }}
                      >
                        {seHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                      </button>
                      <p className={cn("text-[10px] font-medium leading-tight truncate", clr.text)}>{e.title}</p>
                      {ht > 26 && e.start_time && (
                        <p className={cn("text-[9px] leading-tight opacity-70 tabular-nums", clr.text)}>
                          {e.start_time}{e.end_time ? `–${e.end_time}` : ""}
                        </p>
                      )}
                      {ht > 42 && e.location && (
                        <p className={cn("text-[9px] leading-tight opacity-60 truncate", clr.text)}>{e.location}</p>
                      )}
                    </div>
                  );
                }

                // cal block
                const { b } = item;
                const clr = DC_COLORS[b.color] ?? DC_COLORS.blue;
                const cbId = `cb-${b.recurring_id ?? b.id}-${b.date}`;
                const cbHidden = hiddenIds.has(cbId);
                // A block committed to a task can be worked off in place; ticking
                // it logs a session, which is what advances sessions/time modes.
                const worked = b.task_id != null && sessionsByBlock.has(b.id);
                return (
                  <div
                    key={`blk-${b.id}`}
                    data-block="1"
                    className={cn(
                      "absolute rounded border px-1 py-0.5 overflow-hidden z-20 transition-all group",
                      clr.bg, clr.border,
                      b.is_recurring ? "cursor-default opacity-80" : "cursor-pointer hover:brightness-110",
                      cbHidden && "opacity-15",
                      worked && "ring-1 ring-emerald-400/60"
                    )}
                    style={{ top, height: ht, left, right }}
                    onClick={b.is_recurring ? undefined : (e) => { e.stopPropagation(); setModal({ block: b }); }}
                    title={b.is_recurring ? `${b.title} (recurring — edit in Week view)` : b.title}
                  >
                    <button
                      className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", cbHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                      onClick={(e) => { e.stopPropagation(); toggleHidden(cbId); }}
                    >
                      {cbHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                    </button>
                    <div className="flex items-center gap-1">
                      {b.task_id != null && (
                        <button
                          title={worked ? "Worked — click to undo" : "Mark this block as worked"}
                          onClick={(e) => { e.stopPropagation(); onToggleWorked(b); }}
                          className={cn(
                            "flex h-2.5 w-2.5 shrink-0 items-center justify-center rounded-[2px] border transition-colors",
                            worked
                              ? "bg-emerald-500 border-emerald-500 text-white"
                              : cn("border-current opacity-50 hover:opacity-100", clr.text),
                          )}
                        >
                          {worked && <Check className="h-1.5 w-1.5" />}
                        </button>
                      )}
                      <p className={cn("text-[10px] font-semibold leading-tight truncate", clr.text, worked && "line-through opacity-70")}>{b.title}</p>
                    </div>
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
        <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
          <span className="h-2 w-2 rounded-sm bg-violet-500/40 border border-violet-400/50 shrink-0" />Schedule
        </span>
      </div>

      {/* Modal */}
      {modal && (
        <DayBlockModal
          initial={modal.block}
          startTime={modal.startTime}
          endTime={modal.endTime}
          tasks={tasks}
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


