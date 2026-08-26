// The month grid.

import { useMemo } from "react";
import { Check, Target, Repeat2, Flag, GraduationCap, CalendarRange } from "lucide-react";
import { cn } from "../../lib/utils";
import { chipBgClasses, chipCheckClasses } from "../task/taskVisual";
import type { Goal, WeekItems, CalBlock } from "../../types";
import { BLOCK_COLORS, DAY_NAMES, MAX_CELL_ITEMS, addDays, toISO } from "./_shared";

export function MonthView({ monthStart, calBlocks, items, today, onClickDay, onClickBlock, onToggleTask, onEditGoal }: {
  monthStart: Date;
  calBlocks: CalBlock[];
  items: WeekItems;
  today: string;
  onClickDay: (iso: string) => void;
  onClickBlock: (b: CalBlock) => void;
  onToggleTask: (id: number) => void;
  onEditGoal: (g: Goal) => void;
}) {
  const deadlinesFor         = (iso: string) => items.deadlines.filter((d) => d.due_date === iso);
  const courseAssignmentsFor = (iso: string) => items.course_assignments.filter((a) => a.due_date === iso);
  const scheduleEntriesFor   = (iso: string) => items.schedule_entries.filter((e) => e.date === iso);
  const trainingSessionsFor  = (iso: string) => items.training_sessions.filter((s) => s.scheduled_date === iso);
  const currentMonth = monthStart.getMonth();

  // Start grid on the Sunday of the week containing the 1st
  const gridStart = useMemo(() => {
    const d = new Date(monthStart);
    d.setDate(d.getDate() - d.getDay());
    return d;
  }, [monthStart]);

  const cells = useMemo(() =>
    Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)),
  [gridStart]);

  const blocksFor = (iso: string) => calBlocks.filter((b) => b.date === iso);
  const tasksFor  = (iso: string) => items.tasks.filter((t) => t.due_date === iso);
  const goalsFor  = (iso: string) => items.goals.filter((g) => g.deadline === iso);

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">

      {/* Day name header row */}
      <div className="shrink-0 grid grid-cols-7 border-b border-border bg-card">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center py-2 border-r border-border last:border-r-0">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{name}</span>
          </div>
        ))}
      </div>

      {/* 6-row grid */}
      <div className="flex-1 overflow-y-auto">
        <div className="grid grid-cols-7 h-full" style={{ gridTemplateRows: "repeat(6, minmax(100px, 1fr))" }}>
          {cells.map((day) => {
            const iso       = toISO(day);
            const isToday   = iso === today;
            const inMonth   = day.getMonth() === currentMonth;
            const blocks    = blocksFor(iso);
            const tasks     = tasksFor(iso);
            const goals     = goalsFor(iso);
            const dlItems   = deadlinesFor(iso);
            const caItems   = courseAssignmentsFor(iso);
            const seItems   = scheduleEntriesFor(iso);
            const tsItems   = trainingSessionsFor(iso);
            const total     = blocks.length + goals.length + tasks.length + dlItems.length + caItems.length + seItems.length + tsItems.length;
            let shown       = 0;

            return (
              <div
                key={iso}
                className={cn(
                  "border-r border-b border-border p-1 flex flex-col gap-0.5 cursor-pointer hover:bg-secondary/20 transition-colors overflow-hidden",
                  isToday && "bg-primary/[0.04]",
                  !inMonth && "opacity-35"
                )}
                onClick={() => onClickDay(iso)}
              >
                {/* Day number */}
                <div className={cn(
                  "text-xs font-semibold h-5 w-5 flex items-center justify-center rounded-full shrink-0 self-start",
                  isToday ? "bg-primary text-primary-foreground" : "text-foreground"
                )}>
                  {day.getDate()}
                </div>

                {/* Cal blocks */}
                {blocks.map((b) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  const col = BLOCK_COLORS[b.color] ?? BLOCK_COLORS.blue;
                  return (
                    <div key={`b-${b.recurring_id ?? b.id}-${iso}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0", col.bg, col.border)}
                      onClick={(e) => { e.stopPropagation(); onClickBlock(b); }}
                    >
                      {b.is_recurring && <Repeat2 className={cn("h-2 w-2 shrink-0", col.text)} />}
                      <span className={cn("truncate", col.text)}>{b.start_time} {b.title}</span>
                    </div>
                  );
                })}

                {/* Goals */}
                {goals.map((g) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  return (
                    <div key={`g-${g.id}`}
                      className="flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0 bg-blue-500/10 border-blue-500/20"
                      onClick={(e) => { e.stopPropagation(); onEditGoal(g); }}
                    >
                      <Target className="h-2 w-2 text-blue-500 shrink-0" />
                      <span className="text-foreground truncate">{g.title}</span>
                    </div>
                  );
                })}

                {/* Tasks */}
                {tasks.map((t) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  const chip = chipBgClasses(t.priority, t.done);
                  const check = chipCheckClasses(t.priority, t.done);
                  return (
                    <div key={`t-${t.id}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border shrink-0", chip)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleTask(t.id); }}
                        className={cn("h-2.5 w-2.5 shrink-0 rounded-sm border flex items-center justify-center transition-colors", check)}
                      >
                        {t.done && <Check className="h-1.5 w-1.5 text-white" />}
                      </button>
                      <span className={cn("truncate", t.done && "line-through text-muted-foreground")}>{t.title}</span>
                    </div>
                  );
                })}

                {/* Deadlines */}
                {dlItems.map((d) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  return (
                    <div key={`dl-${d.id}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0",
                        d.done ? "bg-secondary/40 border-border/40" : "bg-red-500/10 border-red-400/30")}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Flag className={cn("h-2 w-2 shrink-0", d.done ? "text-muted-foreground" : "text-red-500")} />
                      <span className={cn("truncate", d.done ? "line-through text-muted-foreground" : "text-foreground")}>{d.title}</span>
                    </div>
                  );
                })}

                {/* Course assignments */}
                {caItems.map((a) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  return (
                    <div key={`ca-${a.id}`}
                      className="flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0 bg-indigo-500/10 border-indigo-400/30"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <GraduationCap className="h-2 w-2 shrink-0 text-indigo-500" />
                      <span className="truncate text-foreground">{a.title}</span>
                    </div>
                  );
                })}

                {/* Schedule entries */}
                {seItems.map((e) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  const clr = BLOCK_COLORS[e.color] ?? BLOCK_COLORS.teal;
                  return (
                    <div key={`se-${e.id}-${e.date}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0", clr.bg, clr.border)}
                      onClick={(e2) => e2.stopPropagation()}
                    >
                      <CalendarRange className={cn("h-2 w-2 shrink-0", clr.text)} />
                      <span className={cn("truncate", clr.text)}>{e.start_time ? `${e.start_time} ` : ""}{e.title}</span>
                    </div>
                  );
                })}

                {/* Training sessions */}
                {tsItems.map((s) => {
                  if (shown >= MAX_CELL_ITEMS) return null;
                  shown++;
                  const typeColors: Record<string, string> = {
                    running:  "bg-emerald-500/10 border-emerald-400/30 text-emerald-700",
                    strength: "bg-orange-500/10 border-orange-400/30 text-orange-700",
                    yoga:     "bg-violet-500/10 border-violet-400/30 text-violet-700",
                    other:    "bg-slate-500/10 border-slate-400/30 text-slate-600",
                  };
                  const typeIcons: Record<string, string> = { running: "🏃", strength: "🏋️", yoga: "🧘", other: "⚡" };
                  const cls = typeColors[s.plan_type ?? "other"] ?? typeColors.other;
                  return (
                    <div key={`ts-${s.id}`}
                      className={cn("flex items-center gap-0.5 rounded px-1 py-px text-[10px] leading-tight border truncate shrink-0", cls)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="shrink-0 leading-none">{typeIcons[s.plan_type ?? "other"] ?? "⚡"}</span>
                      <span className={cn("truncate", s.completed && "line-through opacity-60")}>{s.title}</span>
                    </div>
                  );
                })}

                {/* Overflow count */}
                {total > MAX_CELL_ITEMS && (
                  <p className="text-[9px] text-muted-foreground px-1 shrink-0">+{total - MAX_CELL_ITEMS} more</p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Week page ─────────────────────────────────────────────────────────────────

