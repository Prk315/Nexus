// Today's habits, including stacks that expand into their subtasks.

import { useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { getHabitSubtasks, toggleHabitSubtask } from "../../lib/api";
import { cn } from "../../lib/utils";
import type { HabitWithCompletion, HabitStack, HabitSubtask } from "../../types";
import { HABIT_COLOR_DOT } from "./_shared";

function HabitRowWithSubtasks({ h, today, onToggle }: {
  h: HabitWithCompletion;
  today: string;
  onToggle: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subtasks, setSubtasks] = useState<HabitSubtask[]>([]);
  const [loaded, setLoaded] = useState(false);

  const handleExpand = async () => {
    const next = !expanded;
    setExpanded(next);
    if (next && !loaded) {
      try {
        const data = await getHabitSubtasks(h.id, today);
        setSubtasks(data);
        setLoaded(true);
      } catch (e) { console.error(e); }
    }
  };

  const handleToggleSub = async (subtaskId: number) => {
    try {
      const updated = await toggleHabitSubtask(subtaskId, today);
      setSubtasks(updated);
    } catch (e) { console.error(e); }
  };

  return (
    <div>
      <div className="flex items-center gap-1 px-1.5 py-1 rounded-md hover:bg-secondary/60 group">
        <button
          onClick={() => onToggle(h.id)}
          className={cn(
            "h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center transition-colors",
            h.done
              ? `border-transparent ${HABIT_COLOR_DOT[h.color] ?? "bg-primary"}`
              : "border-border group-hover:border-muted-foreground/50"
          )}
        >
          {h.done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
        </button>
        <span
          onClick={() => onToggle(h.id)}
          className={cn("flex-1 text-[11px] truncate cursor-pointer transition-colors", h.done ? "line-through text-muted-foreground/50" : "text-foreground")}
        >
          {h.title}
        </span>
        {h.subtask_count > 0 && (
          <span className="text-[9px] tabular-nums text-muted-foreground/70 shrink-0">
            {h.subtask_done_count}/{h.subtask_count}
          </span>
        )}
        {h.streak > 1 && (
          <span className="text-[9px] text-amber-500 font-semibold shrink-0">🔥{h.streak}</span>
        )}
        {(h.subtask_count > 0 || expanded) && (
          <button
            onClick={handleExpand}
            className="p-0.5 rounded text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
          >
            <ChevronDown className={cn("h-2.5 w-2.5 transition-transform", expanded && "rotate-180")} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="pl-5 pr-1 pb-1 flex flex-col gap-0.5">
          {subtasks.length === 0 && loaded && (
            <span className="text-[10px] text-muted-foreground/50 italic px-1">No sub-habits yet.</span>
          )}
          {subtasks.map((sub) => (
            <button
              key={sub.id}
              onClick={() => handleToggleSub(sub.id)}
              className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-secondary/60 text-left transition-colors group/sub"
            >
              <div className={cn(
                "h-3 w-3 shrink-0 rounded border flex items-center justify-center transition-colors",
                sub.done ? `border-transparent ${HABIT_COLOR_DOT[h.color] ?? "bg-primary"}` : "border-border"
              )}>
                {sub.done && <Check className="h-2 w-2 text-white" strokeWidth={3} />}
              </div>
              <span className={cn("text-[10px] flex-1 truncate", sub.done && "line-through text-muted-foreground/50")}>
                {sub.title}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function HabitsStrip({ habits, stacks, onToggle, today }: {
  habits: HabitWithCompletion[];
  stacks: HabitStack[];
  onToggle: (id: number) => void;
  today: string;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [collapsedStacks, setCollapsedStacks] = useState<Set<number>>(new Set());

  if (!habits.length) return null;
  const done  = habits.filter((h) => h.done).length;
  const total = habits.length;
  const pct   = total > 0 ? Math.round((done / total) * 100) : 0;

  const ungrouped = habits.filter((h) => h.stack_id === null);
  const grouped = stacks
    .map((s) => ({ stack: s, habits: habits.filter((h) => h.stack_id === s.id) }))
    .filter((g) => g.habits.length > 0);

  const toggleStack = (id: number) =>
    setCollapsedStacks((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const renderHabitRow = (h: HabitWithCompletion) => (
    <HabitRowWithSubtasks key={h.id} h={h} today={today} onToggle={onToggle} />
  );

  return (
    <div className="shrink-0 flex flex-col gap-2 pb-2 border-b border-border">
      {/* Header — click to collapse the whole strip */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center justify-between px-1 w-full hover:opacity-80 transition-opacity"
      >
        <div className="flex items-center gap-1">
          <ChevronRight className={cn("h-3 w-3 text-muted-foreground transition-transform", !collapsed && "rotate-90")} />
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Habits
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </button>

      {!collapsed && (
        <>
          {/* Progress bar */}
          <div className="h-1 bg-secondary rounded-full overflow-hidden mx-1">
            <div
              className={cn("h-full rounded-full transition-all duration-500", pct === 100 ? "bg-emerald-500" : "bg-primary")}
              style={{ width: `${pct}%` }}
            />
          </div>

          {/* Stacked groups — each collapsible */}
          {grouped.map(({ stack, habits: sh }) => {
            const stackColor = HABIT_COLOR_DOT[stack.color] ?? "bg-blue-500";
            const stackDone = sh.filter((h) => h.done).length;
            const stackCollapsed = collapsedStacks.has(stack.id);
            return (
              <div key={stack.id} className="flex flex-col gap-0">
                <button
                  onClick={() => toggleStack(stack.id)}
                  className="flex items-center gap-1.5 px-1.5 py-0.5 w-full hover:opacity-80 transition-opacity"
                >
                  <ChevronRight className={cn("h-2.5 w-2.5 text-muted-foreground transition-transform flex-shrink-0", !stackCollapsed && "rotate-90")} />
                  <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", stackColor)} />
                  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider flex-1 truncate text-left">{stack.title}</span>
                  <span className="text-[9px] tabular-nums text-muted-foreground">{stackDone}/{sh.length}</span>
                </button>
                {!stackCollapsed && (
                  <div className="flex flex-col gap-0.5 pl-1">
                    {sh.map(renderHabitRow)}
                  </div>
                )}
              </div>
            );
          })}

          {/* Ungrouped */}
          {ungrouped.length > 0 && (
            <div className="flex flex-col gap-0.5">
              {grouped.length > 0 && (
                <div className="flex items-center gap-1.5 px-1.5 py-0.5">
                  <span className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Other</span>
                </div>
              )}
              {ungrouped.map(renderHabitRow)}
            </div>
          )}
        </>
      )}
    </div>
  );
}
