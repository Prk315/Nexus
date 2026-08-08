import { useEffect, useMemo, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { TrendingUp } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchExerciseHistory } from "../../store/slices/workoutsSlice";
import { CARD_STYLE } from "../../lib/uiHelpers";

/** Estimated 1RM (Epley). */
const e1rm = (w: number, reps: number) => Math.round(w * (1 + reps / 30) * 10) / 10;

export default function ProgressionView() {
  const dispatch = useAppDispatch();
  const sessions = useAppSelector((s) => s.workouts.sessions);
  const history = useAppSelector((s) => s.workouts.exerciseHistory);
  const [selected, setSelected] = useState<string | null>(null);

  // Pull all logged exercises across the loaded sessions.
  useEffect(() => {
    const list = sessions.map((s) => ({ id: s.id, date: s.scheduled_date }));
    dispatch(fetchExerciseHistory(list));
  }, [dispatch, sessions]);

  // Exercise names ranked by how often they've been logged.
  const names = useMemo(() => {
    const count = new Map<string, number>();
    for (const h of history) count.set(h.name, (count.get(h.name) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  }, [history]);

  const active = selected ?? names[0] ?? null;

  const series = useMemo(() => {
    if (!active) return [];
    return history
      .filter((h) => h.name === active && h.weight_kg != null && h.reps != null)
      .map((h) => ({
        date: h.date,
        label: h.date.slice(5),
        weight: h.weight_kg!,
        e1rm: e1rm(h.weight_kg!, h.reps!),
        volume: (h.sets ?? 1) * h.reps! * h.weight_kg!,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [history, active]);

  const best = useMemo(() => {
    if (series.length === 0) return null;
    return {
      weight: Math.max(...series.map((s) => s.weight)),
      e1rm: Math.max(...series.map((s) => s.e1rm)),
      volume: Math.max(...series.map((s) => s.volume)),
      last: series[series.length - 1],
    };
  }, [series]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <TrendingUp size={16} color="var(--accent)" />
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--text)" }}>Progress</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· working weight & estimated 1RM over time</span>
      </div>

      {names.length === 0 ? (
        <div style={{ ...CARD_STYLE, padding: 40, textAlign: "center", fontSize: 13, color: "var(--text-muted)" }}>
          Log a workout with weights and reps and your progress will chart here.
        </div>
      ) : (
        <>
          {/* Exercise picker */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {names.map((n) => {
              const on = n === active;
              return (
                <button key={n} onClick={() => setSelected(n)} style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", borderRadius: 999, border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`, background: on ? "var(--accent-tint)" : "transparent", color: on ? "var(--accent)" : "var(--text-secondary)", whiteSpace: "nowrap" }}>
                  {n}
                </button>
              );
            })}
          </div>

          <div style={{ ...CARD_STYLE, padding: "18px 18px 12px" }}>
            {best && (
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginBottom: 14 }}>
                {([
                  ["Best weight", `${best.weight} kg`],
                  ["Best est. 1RM", `${best.e1rm} kg`],
                  ["Latest", `${best.last.weight} kg`],
                  ["Sessions", String(series.length)],
                ] as const).map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{val}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{label}</div>
                  </div>
                ))}
              </div>
            )}
            {series.length < 2 ? (
              <div style={{ textAlign: "center", padding: "24px 0", fontSize: 13, color: "var(--text-muted)" }}>
                Log this exercise at least twice to see a trend.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} minTickGap={20} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} width={40} unit="kg" />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", fontSize: 12 }}
                    labelFormatter={(l, p) => (p && p[0] ? (p[0].payload as { date: string }).date : String(l))}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="weight" name="Working weight" stroke="#38bdf8" strokeWidth={2.5} dot={{ r: 3, fill: "#38bdf8" }} isAnimationActive={false} />
                  <Line type="monotone" dataKey="e1rm" name="Est. 1RM" stroke="#d946ef" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}
    </div>
  );
}
