import { useEffect, useMemo, useState } from "react";
import { Check, Flame, Plus, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  fetchHabits, fetchHabitCompletions, addHabit, removeHabit, checkHabit, uncheckHabit,
} from "../store/slices/habitsSlice";
import { CARD_STYLE, INPUT_STYLE, todayISO, isoDate } from "../lib/uiHelpers";
import { StatTile } from "../components/shared/StatTile";
import { habitIcon, buildHeatmapGrid, ConsistencyHeatmap } from "../components/habits/HabitCharts";
import type { Habit } from "../store/types";

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

/** Consecutive-day streak ending today (or yesterday, if today isn't checked yet). */
function computeStreak(dates: Set<string>, today: string): number {
  let cursor = today;
  if (!dates.has(cursor)) cursor = subDays(cursor, 1);
  let count = 0;
  while (dates.has(cursor)) {
    count++;
    cursor = subDays(cursor, 1);
  }
  return count;
}

/** Longest run of consecutive completed days within the fetched window. */
function computeBestStreak(dates: Set<string>, windowDates: string[]): number {
  let best = 0;
  let run = 0;
  for (const d of windowDates) {
    if (dates.has(d)) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

const dayCellBase: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  flexShrink: 0,
};

function HabitRow({
  habit, dates, weekDates, today, onToggle, onDelete,
}: {
  habit: Habit;
  dates: Set<string>;
  weekDates: string[];
  today: string;
  onToggle: (date: string, currentlyDone: boolean) => void;
  onDelete: () => void;
}) {
  const streak = computeStreak(dates, today);
  const best = computeBestStreak(dates, lastNDates(HISTORY_DAYS, today));
  const Icon = habitIcon(habit.name);

  return (
    <div style={{ ...CARD_STYLE, padding: "14px 18px", display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 160, flex: 1 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--accent)1f", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", flexShrink: 0 }}>
          <Icon size={16} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>{habit.name}</span>
          <div style={{ display: "flex", gap: 8, fontSize: 11, color: "var(--text-muted)" }}>
            {streak > 0 && (
              <span style={{ display: "flex", alignItems: "center", gap: 3, color: "var(--warning)", fontWeight: 700 }}>
                <Flame size={11} /> {streak}
              </span>
            )}
            <span>best {best}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 6 }}>
        {weekDates.map((d) => {
          const done = dates.has(d);
          const isToday = d === today;
          return (
            <button
              key={d}
              title={d}
              onClick={() => onToggle(d, done)}
              style={{
                ...dayCellBase,
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

      <button
        onClick={onDelete}
        title="Remove habit"
        style={{ background: "transparent", border: "none", color: "var(--text-muted)", padding: "4px 6px", cursor: "pointer", flexShrink: 0 }}
      >
        <Trash2 size={14} />
      </button>
    </div>
  );
}

export default function HabitsPage() {
  const dispatch = useAppDispatch();
  const habits = useAppSelector((s) => s.habits.habits);
  const completions = useAppSelector((s) => s.habits.completions);
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = todayISO();

  useEffect(() => {
    dispatch(fetchHabits());
    dispatch(fetchHabitCompletions(subDays(today, HISTORY_DAYS)));
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
  const todayDoneCount = habits.filter((h) => datesByHabit.get(h.id)?.has(today)).length;

  const bestOverall = habits.reduce<{ name: string; streak: number } | null>((best, h) => {
    const streak = computeBestStreak(datesByHabit.get(h.id) ?? new Set(), lastNDates(HISTORY_DAYS, today));
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
        (weekDates.reduce((sum, d) => sum + (countByDate.get(d) ?? 0), 0) / (weekDates.length * habits.length)) * 100,
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

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await dispatch(addHabit({ name: name.trim() })).unwrap();
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
        <StatTile label="Today" value={habits.length ? `${todayDoneCount}/${habits.length}` : "—"} sub="completed" />
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

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {habits.length === 0 ? (
          <p style={{ color: "var(--text-muted)", textAlign: "center", padding: "32px 0" }}>
            No habits yet — add one above to start your streak.
          </p>
        ) : (
          habits.map((habit) => (
            <HabitRow
              key={habit.id}
              habit={habit}
              dates={datesByHabit.get(habit.id) ?? new Set()}
              weekDates={weekDates}
              today={today}
              onToggle={(date, done) => toggle(habit.id, date, done)}
              onDelete={() => dispatch(removeHabit(habit.id))}
            />
          ))
        )}
      </div>

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
