import { useEffect, useMemo, useState } from "react";
import { Check, Flame, Plus, Trash2, Pencil, Clock, ArrowUp, ArrowDown, Layers, X } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  fetchHabits, fetchHabitCompletions, fetchHabitStacks, addHabit, editHabit, removeHabit,
  removeHabitStack, checkHabit, uncheckHabit,
} from "../store/slices/habitsSlice";
import { CARD_STYLE, INPUT_STYLE, todayISO, isoDate } from "../lib/uiHelpers";
import { StatTile } from "../components/shared/StatTile";
import { habitIcon, buildHeatmapGrid, ConsistencyHeatmap } from "../components/habits/HabitCharts";
import HabitEditForm from "../components/habits/HabitEditForm";
import type { Habit, UpdateHabit } from "../store/types";

const HISTORY_DAYS = 90;
const STRIP_DAYS = 7;
const HEATMAP_WEEKS = 12;

function subDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** Oldest → newest. */
function lastNDates(n: number, today: string): string[] {
  return Array.from({ length: n }, (_, i) => subDays(today, n - 1 - i));
}

/** 0=Mon..6=Sun. */
function dayOfWeek(dateISO: string): number {
  const d = new Date(dateISO + "T00:00:00");
  return (d.getDay() + 6) % 7;
}

function isScheduled(habit: Habit, dateISO: string): boolean {
  if (!habit.repeat_days) return true;
  return habit.repeat_days.includes(dayOfWeek(dateISO));
}

/** Consecutive scheduled-day streak ending today (or the last scheduled day, if today isn't checked yet). */
function computeStreak(habit: Habit, dates: Set<string>, today: string): number {
  let cursor = today;
  if (isScheduled(habit, cursor) && !dates.has(cursor)) cursor = subDays(cursor, 1);
  let count = 0;
  for (let i = 0; i < HISTORY_DAYS; i++) {
    if (!isScheduled(habit, cursor)) {
      cursor = subDays(cursor, 1);
      continue;
    }
    if (!dates.has(cursor)) break;
    count++;
    cursor = subDays(cursor, 1);
  }
  return count;
}

function computeBestStreak(habit: Habit, dates: Set<string>, windowDates: string[]): number {
  let best = 0;
  let run = 0;
  for (const d of windowDates) {
    if (!isScheduled(habit, d)) continue;
    if (dates.has(d)) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

function formatTime(t: string | null): string | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

const dayCellBase: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
};

function HabitRow({
  habit, dates, weekDates, today, onToggle, onDelete, onEdit, editing, onSaveEdit, onCancelEdit,
  reorder,
}: {
  habit: Habit;
  dates: Set<string>;
  weekDates: string[];
  today: string;
  onToggle: (date: string, currentlyDone: boolean) => void;
  onDelete: () => void;
  onEdit: () => void;
  editing: boolean;
  onSaveEdit: (update: UpdateHabit) => Promise<void>;
  onCancelEdit: () => void;
  reorder?: { onUp?: () => void; onDown?: () => void };
}) {
  const streak = computeStreak(habit, dates, today);
  const best = computeBestStreak(habit, dates, lastNDates(HISTORY_DAYS, today));
  const Icon = habitIcon(habit.name);
  const timeLabel = formatTime(habit.scheduled_time);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <div style={{ ...CARD_STYLE, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        {reorder && (
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
            <button onClick={reorder.onUp} disabled={!reorder.onUp} style={{ background: "none", border: "none", color: reorder.onUp ? "var(--text-muted)" : "var(--border)", cursor: reorder.onUp ? "pointer" : "default", padding: 0 }}>
              <ArrowUp size={12} />
            </button>
            <button onClick={reorder.onDown} disabled={!reorder.onDown} style={{ background: "none", border: "none", color: reorder.onDown ? "var(--text-muted)" : "var(--border)", cursor: reorder.onDown ? "pointer" : "default", padding: 0 }}>
              <ArrowDown size={12} />
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160, flex: 1 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent-tint)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", flexShrink: 0 }}>
            <Icon size={16} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{habit.name}</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 11, color: "var(--text-muted)" }}>
              {streak > 0 && (
                <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--warning)", fontWeight: 700 }}>
                  <Flame size={11} /> {streak}
                </span>
              )}
              <span>best {best}</span>
              {timeLabel && (
                <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <Clock size={11} /> {timeLabel}
                </span>
              )}
              {habit.duration_min != null && <span>{habit.duration_min} min</span>}
            </div>
            {habit.description && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", maxWidth: 320 }}>{habit.description}</span>
            )}
          </div>
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          {weekDates.map((d) => {
            const done = dates.has(d);
            const isToday = d === today;
            const scheduled = isScheduled(habit, d);
            if (!scheduled) {
              return (
                <div key={d} title="Not scheduled" style={{ ...dayCellBase, border: "1px dashed var(--border)" }} />
              );
            }
            return (
              <button
                key={d}
                title={d}
                onClick={() => onToggle(d, done)}
                style={{
                  ...dayCellBase,
                  cursor: "pointer",
                  background: done ? "var(--accent)" : "transparent",
                  border: `2px solid ${done ? "var(--accent)" : isToday ? "var(--text-muted)" : "var(--border)"}`,
                  color: "var(--accent-fg)",
                }}
              >
                {done && <Check size={14} strokeWidth={3} />}
              </button>
            );
          })}
        </div>

        <button onClick={onEdit} title="Edit habit" style={{ background: "transparent", border: "none", color: "var(--text-muted)", padding: "4px 6px", cursor: "pointer", flexShrink: 0 }}>
          <Pencil size={14} />
        </button>
        <button onClick={onDelete} title="Remove habit" style={{ background: "transparent", border: "none", color: "var(--text-muted)", padding: "4px 6px", cursor: "pointer", flexShrink: 0 }}>
          <Trash2 size={14} />
        </button>
      </div>

      {editing && (
        <div style={{ marginTop: 8 }}>
          <HabitEditForm habit={habit} onSave={onSaveEdit} onCancel={onCancelEdit} />
        </div>
      )}
    </div>
  );
}

export default function HabitsPage() {
  const dispatch = useAppDispatch();
  const habits = useAppSelector((s) => s.habits.habits);
  const completions = useAppSelector((s) => s.habits.completions);
  const stacks = useAppSelector((s) => s.habits.stacks);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const today = todayISO();

  useEffect(() => {
    dispatch(fetchHabits());
    dispatch(fetchHabitCompletions(subDays(today, HISTORY_DAYS)));
    dispatch(fetchHabitStacks());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dispatch]);

  const datesByHabit = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const c of completions) {
      if (!m.has(c.habit_id)) m.set(c.habit_id, new Set());
      m.get(c.habit_id)!.add(c.date);
    }
    return m;
  }, [completions]);

  const weekDates = useMemo(() => lastNDates(STRIP_DAYS, today), [today]);

  // ── Aggregate stats ──────────────────────────────────────────────────────
  const todayDoneCount = habits.filter((h) => isScheduled(h, today) && datesByHabit.get(h.id)?.has(today)).length;
  const todayScheduledCount = habits.filter((h) => isScheduled(h, today)).length;

  const bestOverall = habits.reduce<{ name: string; streak: number } | null>((best, h) => {
    const streak = computeBestStreak(h, datesByHabit.get(h.id) ?? new Set(), lastNDates(HISTORY_DAYS, today));
    if (streak === 0) return best;
    if (!best || streak > best.streak) return { name: h.name, streak };
    return best;
  }, null);

  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of completions) m.set(c.date, (m.get(c.date) ?? 0) + 1);
    return m;
  }, [completions]);

  const weeklyConsistency = habits.length
    ? Math.round(
        (weekDates.reduce((sum, d) => {
          const scheduledThatDay = habits.filter((h) => isScheduled(h, d)).length;
          return sum + (scheduledThatDay ? (countByDate.get(d) ?? 0) / scheduledThatDay : 0);
        }, 0) / weekDates.length) * 100,
      )
    : null;

  // ── Heatmap ──────────────────────────────────────────────────────────────
  const heatmapGrid = useMemo(() => buildHeatmapGrid(today, HEATMAP_WEEKS), [today]);
  const fractionByDate = useMemo(() => {
    const m = new Map<string, number>();
    if (habits.length === 0) return m;
    for (const [date, count] of countByDate) m.set(date, Math.min(1, count / habits.length));
    return m;
  }, [countByDate, habits.length]);

  // ── Grouping by stack ────────────────────────────────────────────────────
  const stackedGroups = useMemo(() => {
    const groups = new Map<string, Habit[]>();
    for (const h of habits) {
      if (!h.stack_id) continue;
      if (!groups.has(h.stack_id)) groups.set(h.stack_id, []);
      groups.get(h.stack_id)!.push(h);
    }
    for (const list of groups.values()) list.sort((a, b) => a.sort_order - b.sort_order);
    return groups;
  }, [habits]);
  const unstacked = useMemo(
    () => habits.filter((h) => !h.stack_id).sort((a, b) => a.sort_order - b.sort_order),
    [habits],
  );

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await dispatch(addHabit({ name: name.trim(), sort_order: habits.length })).unwrap();
      setName("");
    } finally {
      setSubmitting(false);
    }
  }

  function toggle(habitId: string, date: string, currentlyDone: boolean) {
    if (currentlyDone) {
      dispatch(uncheckHabit({ habitId, date }));
    } else {
      dispatch(checkHabit({ habitId, date }));
    }
  }

  async function swapOrder(a: Habit, b: Habit) {
    await Promise.all([
      dispatch(editHabit({ id: a.id, sort_order: b.sort_order })).unwrap(),
      dispatch(editHabit({ id: b.id, sort_order: a.sort_order })).unwrap(),
    ]);
  }

  function renderRow(habit: Habit, reorder?: { onUp?: () => void; onDown?: () => void }) {
    return (
      <HabitRow
        key={habit.id}
        habit={habit}
        dates={datesByHabit.get(habit.id) ?? new Set()}
        weekDates={weekDates}
        today={today}
        onToggle={(date, done) => toggle(habit.id, date, done)}
        onDelete={() => dispatch(removeHabit(habit.id))}
        onEdit={() => setEditingId(editingId === habit.id ? null : habit.id)}
        editing={editingId === habit.id}
        onSaveEdit={async (update) => {
          await dispatch(editHabit(update)).unwrap();
          setEditingId(null);
        }}
        onCancelEdit={() => setEditingId(null)}
        reorder={reorder}
      />
    );
  }

  return (
    <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 24, maxWidth: 900 }}>
      <div>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          Habits
        </h2>
        <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
          Meditation, stretching, skincare — the small stuff, tracked daily.
        </p>
      </div>

      <div style={{ ...CARD_STYLE, padding: "18px 24px", display: "flex", gap: 32, flexWrap: "wrap" }}>
        <StatTile label="Today" value={todayScheduledCount ? `${todayDoneCount}/${todayScheduledCount}` : "—"} sub="completed" />
        <StatTile label="Active habits" value={String(habits.length)} />
        <StatTile
          label="Best streak"
          value={bestOverall ? String(bestOverall.streak) : "—"}
          sub={bestOverall ? bestOverall.name : undefined}
          color="var(--warning)"
        />
        <StatTile label="Weekly consistency" value={weeklyConsistency != null ? `${weeklyConsistency}%` : "—"} sub="last 7 days" />
      </div>

      <form onSubmit={handleAdd} style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a habit — e.g. Meditate, Stretch, Face care"
          style={{ ...INPUT_STYLE, flex: 1 }}
        />
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "8px 16px", background: "var(--accent)", color: "var(--accent-fg)",
            border: "none", borderRadius: "var(--radius-sm)", fontSize: 14, fontWeight: 600,
            cursor: "pointer", opacity: submitting || !name.trim() ? 0.6 : 1, flexShrink: 0,
          }}
        >
          <Plus size={14} />
          Add
        </button>
      </form>

      {habits.length === 0 ? (
        <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 0" }}>
          No habits yet — add one above to start your streak.
        </p>
      ) : (
        <>
          {[...stackedGroups.entries()].map(([stackId, stackHabits]) => {
            const stack = stacks.find((s) => s.id === stackId);
            return (
              <div key={stackId} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                    <Layers size={13} />
                    {stack?.name ?? "Stack"}
                  </div>
                  <button
                    onClick={() => dispatch(removeHabitStack(stackId))}
                    title="Delete stack (habits stay, just ungrouped)"
                    style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", padding: 2 }}
                  >
                    <X size={12} />
                  </button>
                </div>
                {stackHabits.map((habit, i) =>
                  renderRow(habit, {
                    onUp: i > 0 ? () => swapOrder(habit, stackHabits[i - 1]) : undefined,
                    onDown: i < stackHabits.length - 1 ? () => swapOrder(habit, stackHabits[i + 1]) : undefined,
                  }),
                )}
              </div>
            );
          })}

          {unstacked.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {stackedGroups.size > 0 && (
                <div style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Other habits
                </div>
              )}
              {unstacked.map((habit) => renderRow(habit))}
            </div>
          )}
        </>
      )}

      {habits.length > 0 && (
        <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Consistency</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
            Share of habits completed each day, last {HEATMAP_WEEKS} weeks
          </div>
          <ConsistencyHeatmap grid={heatmapGrid} today={today} fractionByDate={fractionByDate} />
        </div>
      )}
    </div>
  );
}
