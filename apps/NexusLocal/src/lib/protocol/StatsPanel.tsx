import type { ProtocolData } from "./useProtocolData";

/**
 * The headline numbers — today's state of the protocol at a glance, plus the
 * week's habit adherence. Pure derivation from the shared page data; every
 * number here is also visible (and editable) in the panel it belongs to.
 */
export function StatsPanel({ data }: { data: ProtocolData }) {
  const { today, habits, completions, supplements, suppLogs, mealEntries, sleep } = data;

  const habitsDoneToday = habits.filter((h) =>
    completions.some((c) => c.habit_id === h.id && c.date === today),
  ).length;

  // Adherence over the 7-day window: completions counted against each habit's
  // weekly target, capped at 1 per habit so an every-day habit can't mask a
  // skipped one.
  const adherence = (() => {
    if (habits.length === 0) return null;
    let sum = 0;
    for (const h of habits) {
      const doneCount = completions.filter((c) => c.habit_id === h.id).length;
      const target = Math.max(1, Math.min(7, h.target_per_week));
      sum += Math.min(1, doneCount / target);
    }
    return Math.round((sum / habits.length) * 100);
  })();

  const suppTakenToday = supplements.filter((s) =>
    suppLogs.some((l) => l.supplement_id === s.id && l.date === today),
  ).length;

  const mealsLogged = mealEntries.filter((e) => e.logged).length;

  const lastNight = sleep.length > 0 ? sleep[sleep.length - 1] : null;
  const scores = sleep.map((n) => n.quality_score).filter((s): s is number => s != null);
  const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs uppercase tracking-wide text-white/40">Protocol today</h3>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile
          label="Sleep"
          value={lastNight?.quality_score != null ? lastNight.quality_score.toFixed(1) : "—"}
          sub={avgScore != null ? `avg ${avgScore.toFixed(1)}` : "no data"}
          accent="text-indigo-300"
        />
        <Tile
          label="Habits"
          value={`${habitsDoneToday}/${habits.length}`}
          sub={adherence != null ? `${adherence}% this week` : "none set up"}
          accent="text-emerald-300"
        />
        <Tile
          label="Supplements"
          value={`${suppTakenToday}/${supplements.length}`}
          sub="taken today"
          accent="text-amber-300"
        />
        <Tile
          label="Meals"
          value={`${mealsLogged}/${mealEntries.length}`}
          sub="logged today"
          accent="text-rose-300"
        />
      </div>
    </section>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="text-[10px] uppercase tracking-wide text-white/35">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold ${accent}`}>{value}</div>
      <div className="text-[10px] text-white/35">{sub}</div>
    </div>
  );
}
