import { setHabitDone } from "./api";
import type { ProtocolData } from "./useProtocolData";

/**
 * Today's habits with one-tap toggle — the same presence-row model as the
 * home-screen widget (INSERT = done, DELETE = not done) and Protocol's
 * HabitsPage, so all three surfaces agree.
 *
 * The per-habit week dots show the last 7 days against `target_per_week`,
 * which is the piece of context a bare checkbox lacks: "done today" means
 * little for a 3×/week habit.
 */
export function HabitsPanel({ data }: { data: ProtocolData }) {
  const { userId, today, habits, completions, patchCompletions, reload, setErr } = data;

  const toggle = async (habitId: string, done: boolean) => {
    patchCompletions((prev) => {
      const without = prev.filter((c) => !(c.habit_id === habitId && c.date === today));
      return done ? [...without, { habit_id: habitId, date: today }] : without;
    });
    try {
      await setHabitDone(userId, habitId, today, done);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      void reload();
    }
  };

  if (habits.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-white/40">Habits</h3>
      <div className="flex flex-col gap-1">
        {habits.map((h) => {
          const doneToday = completions.some((c) => c.habit_id === h.id && c.date === today);
          const weekCount = completions.filter((c) => c.habit_id === h.id).length;
          return (
            <div
              key={h.id}
              className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
            >
              <button
                type="button"
                aria-label={doneToday ? `Uncheck ${h.name}` : `Check ${h.name}`}
                onClick={() => void toggle(h.id, !doneToday)}
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-lg border text-sm transition-colors ${
                  doneToday
                    ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-300"
                    : "border-white/20 text-transparent hover:border-emerald-400/50 hover:text-emerald-300/60"
                }`}
              >
                ✓
              </button>
              <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${doneToday ? "text-white/50" : "text-white/85"}`}>
                  {h.name}
                </div>
                {h.scheduled_time && (
                  <div className="text-[10px] text-white/30">{h.scheduled_time.slice(0, 5)}</div>
                )}
              </div>
              <span
                className={`shrink-0 text-[11px] tabular-nums ${
                  weekCount >= h.target_per_week ? "text-emerald-300/80" : "text-white/35"
                }`}
              >
                {weekCount}/{h.target_per_week}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
