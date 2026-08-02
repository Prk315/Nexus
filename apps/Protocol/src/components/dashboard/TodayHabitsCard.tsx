import { Check } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { checkHabit, uncheckHabit } from "../../store/slices/habitsSlice";
import { habitIcon, groupHabitsByStack } from "../habits/HabitCharts";
import { CARD_STYLE, todayISO } from "../../lib/uiHelpers";
import type { Habit } from "../../store/types";

/** Same height as the neighboring Habit Consistency card (12-week heatmap at
 * the default cell size) — the list scrolls internally rather than growing
 * past it. */
const CARD_HEIGHT = 224;

function dayOfWeek(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00`);
  return (d.getDay() + 6) % 7;
}

function isScheduledToday(habit: Habit, today: string): boolean {
  if (!habit.repeat_days) return true;
  return habit.repeat_days.includes(dayOfWeek(today));
}

/** Reads habits/completions straight from Redux — DashboardPage already
 * dispatches fetchHabits/fetchHabitCompletions for the heatmap beside it. */
export default function TodayHabitsCard() {
  const dispatch = useAppDispatch();
  const habits = useAppSelector((s) => s.habits.habits);
  const completions = useAppSelector((s) => s.habits.completions);
  const today = todayISO();

  const doneToday = new Set(completions.filter((c) => c.date === today).map((c) => c.habit_id));
  const scheduled = groupHabitsByStack(habits.filter((h) => isScheduledToday(h, today)));
  const doneCount = scheduled.filter((h) => doneToday.has(h.id)).length;

  function toggle(habitId: string, done: boolean) {
    if (done) dispatch(uncheckHabit({ habitId, date: today }));
    else dispatch(checkHabit({ habitId, date: today }));
  }

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px", height: CARD_HEIGHT, display: "flex", flexDirection: "column", flex: "1 1 260px" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 12 }}>
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Today's Habits</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{doneCount}/{scheduled.length} done</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {scheduled.length === 0 ? (
          <div style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: "16px 0" }}>
            Nothing scheduled today
          </div>
        ) : (
          scheduled.map((habit) => {
            const done = doneToday.has(habit.id);
            const Icon = habitIcon(habit.name);
            return (
              <button
                key={habit.id}
                onClick={() => toggle(habit.id, done)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px",
                  background: done ? "var(--accent-tint)" : "var(--bg)",
                  border: `1px solid ${done ? "var(--accent-border-tint)" : "var(--border)"}`,
                  borderRadius: "var(--radius-sm)", cursor: "pointer", textAlign: "left", flexShrink: 0,
                }}
              >
                <div
                  style={{
                    width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: done ? "var(--accent)" : "transparent",
                    border: `2px solid ${done ? "var(--accent)" : "var(--border)"}`,
                    color: "var(--accent-fg)",
                  }}
                >
                  {done ? <Check size={12} strokeWidth={3} /> : <Icon size={11} color="var(--text-muted)" />}
                </div>
                <span
                  style={{
                    fontSize: 13, fontWeight: 500,
                    color: done ? "var(--text-muted)" : "var(--text)",
                    textDecoration: done ? "line-through" : "none",
                  }}
                >
                  {habit.name}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
