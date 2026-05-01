import { useEffect } from "react";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Moon, Activity, TrendingUp } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { fetchSleep, fetchNutrition, fetchBodyMetrics } from "../store/slices/biomarkersSlice";
import { fetchWorkoutSessions } from "../store/slices/workoutsSlice";
import { fetchRunningSessions } from "../store/slices/runningSlice";
import { formatMinutes, CARD_STYLE } from "../lib/uiHelpers";
import ProtocolChargeChart from "../components/dashboard/ProtocolChargeChart";

function subDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

const TOOLTIP_STYLE = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  fontSize: 12,
  color: "var(--text)",
};

const CHART_MARGIN = { top: 4, right: 8, bottom: 0, left: -20 };

const NO_DATA = (
  <div style={{ textAlign: "center", padding: "32px 0", color: "var(--text-muted)", fontSize: 13 }}>
    No data yet — start logging!
  </div>
);

export default function DashboardPage() {
  const dispatch = useAppDispatch();
  const sleep = useAppSelector((s) => s.biomarkers.sleep);
  const nutrition = useAppSelector((s) => s.biomarkers.nutrition);
  const bodyMetrics = useAppSelector((s) => s.biomarkers.bodyMetrics);
  const workoutSessions = useAppSelector((s) => s.workouts.sessions);
  const runningSessions = useAppSelector((s) => s.running.sessions);

  useEffect(() => {
    dispatch(fetchSleep());
    dispatch(fetchNutrition());
    dispatch(fetchBodyMetrics());
    dispatch(fetchWorkoutSessions());
    dispatch(fetchRunningSessions());
  }, [dispatch]);

  const cutoff7 = subDays(7);
  const cutoff14 = subDays(14);

  const recentSleep = sleep.filter((e) => e.date >= cutoff7);
  const avgQuality = avg(recentSleep.map((e) => e.quality_score));
  const avgDuration = avg(recentSleep.map((e) => e.duration_min));

  // Single-pass: find the entry with the most-recent date that has a weight reading
  const lastWeight = bodyMetrics.reduce<{ date: string; weight: number } | null>((best, e) => {
    if (e.weight_kg == null) return best;
    if (best == null || e.date > best.date) return { date: e.date, weight: e.weight_kg };
    return best;
  }, null)?.weight ?? null;

  const sleepChartData = [...sleep]
    .filter((e) => e.date >= cutoff14)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date.slice(5), quality: e.quality_score }));

  const weightChartData = [...bodyMetrics]
    .filter((e) => e.date >= cutoff14 && e.weight_kg != null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((e) => ({ date: e.date.slice(5), weight: e.weight_kg }));

  const STAT_CARD: React.CSSProperties = { ...CARD_STYLE, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4 };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 900 }}>
      <div
        style={{
          background: "linear-gradient(135deg, var(--accent)22 0%, var(--surface) 100%)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius)",
          padding: "20px 24px",
        }}
      >
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>
          Welcome to Protocol
        </h2>
        <p style={{ color: "var(--text-secondary)", fontSize: 14 }}>
          Your health OS — track biomarkers, plan workouts, and optimize your performance.
        </p>
      </div>

      <ProtocolChargeChart
        sleep={sleep}
        nutrition={nutrition}
        bodyMetrics={bodyMetrics}
        workoutSessions={workoutSessions}
        runningSessions={runningSessions}
      />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
        <div style={STAT_CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Moon size={14} color="var(--accent)" />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Avg Sleep Quality (7d)</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {avgQuality != null ? avgQuality.toFixed(1) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>/ 10</span>
        </div>

        <div style={STAT_CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Moon size={14} color="var(--accent)" />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Avg Sleep Duration (7d)</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {avgDuration != null ? formatMinutes(avgDuration) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>per night</span>
        </div>

        <div style={STAT_CARD}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <TrendingUp size={14} color="var(--accent)" />
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 500 }}>Body Weight</span>
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "var(--text)" }}>
            {lastWeight != null ? lastWeight.toFixed(1) : "—"}
          </span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>kg (latest)</span>
        </div>
      </div>

      <div style={{ ...CARD_STYLE, padding: "20px 20px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Moon size={15} color="var(--accent)" />
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Sleep Quality — Last 14 Days</span>
        </div>
        {sleepChartData.length === 0 ? NO_DATA : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={sleepChartData} margin={CHART_MARGIN}>
              <defs>
                <linearGradient id="sleepGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Area type="monotone" dataKey="quality" stroke="var(--accent)" strokeWidth={2} fill="url(#sleepGrad)" dot={{ fill: "var(--accent)", r: 3 }} name="Quality" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ ...CARD_STYLE, padding: "20px 20px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Activity size={15} color="#8b5cf6" />
          <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Weight Trend — Last 14 Days</span>
        </div>
        {weightChartData.length === 0 ? NO_DATA : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={weightChartData} margin={CHART_MARGIN}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} />
              <Line type="monotone" dataKey="weight" stroke="#8b5cf6" strokeWidth={2} dot={{ fill: "#8b5cf6", r: 3 }} name="Weight (kg)" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ ...CARD_STYLE, padding: "16px 20px" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 12 }}>Quick Actions</p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {[
            { label: "Log Sleep", icon: <Moon size={14} />, color: "var(--accent)" },
            { label: "Log Nutrition", icon: <span style={{ fontSize: 14 }}>🍎</span>, color: "#f59e0b" },
            { label: "Log Body Metrics", icon: <Activity size={14} />, color: "#8b5cf6" },
          ].map(({ label, icon, color }) => (
            <button
              key={label}
              onClick={() => alert(`Navigate to ${label} — use the Biomarkers tab above.`)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 16px",
                background: color + "22",
                color,
                border: `1px solid ${color}44`,
                borderRadius: "var(--radius)",
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              {icon}
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
