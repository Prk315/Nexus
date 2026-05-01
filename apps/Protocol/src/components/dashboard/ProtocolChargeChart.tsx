import { useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { BodyMetric, NutritionEntry, RunningSession, SleepEntry, WorkoutSession } from "../../store/types";
import { CARD_STYLE } from "../../lib/uiHelpers";

type Range = "7D" | "4W" | "6M";

const COLORS = {
  overall:   "#f1f5f9",
  sleep:     "#3b82f6",
  nutrition: "#f59e0b",
  body:      "#8b5cf6",
  workout:   "#10b981",
  running:   "#f97316",
};

// ── Scoring (0–100 per day) ─────────────────────────────────────────────────

function scoreSleep(entries: SleepEntry[]): number {
  if (!entries.length) return 0;
  const scores = entries.map((e) => {
    const q = (e.quality_score / 10) * 65;
    const d = Math.max(0, 35 * (1 - Math.abs(e.duration_min - 480) / 300));
    return Math.min(100, q + d);
  });
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function scoreNutrition(entries: NutritionEntry[]): number {
  if (!entries.length) return 0;
  return Math.min(100, entries.length * 34);
}

function scoreBody(entries: BodyMetric[]): number {
  if (!entries.length) return 0;
  const e = entries[entries.length - 1];
  const fields = [e.weight_kg, e.hrv_ms, e.resting_hr_bpm, e.spo2_pct].filter((v) => v != null).length;
  return Math.min(100, 25 + fields * 19);
}

function scoreWorkout(sessions: WorkoutSession[]): number {
  if (!sessions.length) return 0;
  const completed = sessions.filter((s) => s.completed).length;
  if (completed === 0) return 15;
  return Math.min(100, 30 + completed * 35);
}

function scoreRunning(sessions: RunningSession[]): number {
  if (!sessions.length) return 0;
  const completed = sessions.filter((s) => s.completed);
  if (!completed.length) return 15;
  const scores = completed.map((s) => {
    if (s.actual_km && s.planned_km && s.planned_km > 0) {
      return Math.min(100, (s.actual_km / s.planned_km) * 100);
    }
    return 100;
  });
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ── Date helpers ────────────────────────────────────────────────────────────

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): string[] {
  const days: string[] = [];
  const d = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  while (d <= e) {
    days.push(isoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return days;
}

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  sleep: SleepEntry[];
  nutrition: NutritionEntry[];
  bodyMetrics: BodyMetric[];
  workoutSessions: WorkoutSession[];
  runningSessions: RunningSession[];
}

interface Point {
  label: string;
  overall: number;
  sleep: number;
  nutrition: number;
  body: number;
  workout: number;
  running: number;
}

export default function ProtocolChargeChart({
  sleep, nutrition, bodyMetrics, workoutSessions, runningSessions,
}: Props) {
  const [range, setRange] = useState<Range>("7D");

  const data = useMemo<Point[]>(() => {
    // Index all data by date for O(1) lookup
    const byDate = <T,>(items: T[], key: (t: T) => string) => {
      const m = new Map<string, T[]>();
      items.forEach((item) => {
        const d = key(item);
        if (!m.has(d)) m.set(d, []);
        m.get(d)!.push(item);
      });
      return m;
    };

    const sleepMap    = byDate(sleep, (e) => e.date);
    const nutriMap    = byDate(nutrition, (e) => e.date);
    const bodyMap     = byDate(bodyMetrics, (e) => e.date);
    const workoutMap  = byDate(workoutSessions, (s) => s.scheduled_date);
    const runningMap  = byDate(runningSessions, (s) => s.date);

    function dayScore(date: string) {
      return {
        sleep:    scoreSleep(sleepMap.get(date) ?? []),
        nutrition: scoreNutrition(nutriMap.get(date) ?? []),
        body:     scoreBody(bodyMap.get(date) ?? []),
        workout:  scoreWorkout(workoutMap.get(date) ?? []),
        running:  scoreRunning(runningMap.get(date) ?? []),
      };
    }

    function bucket(days: string[], label: string): Point {
      const scores = days.map(dayScore);
      const avg = (k: keyof typeof scores[0]) =>
        Math.round(scores.reduce((s, d) => s + d[k], 0) / scores.length);
      const s = avg("sleep");
      const n = avg("nutrition");
      const b = avg("body");
      const w = avg("workout");
      const r = avg("running");
      return { label, sleep: s, nutrition: n, body: b, workout: w, running: r,
               overall: Math.round((s + n + b + w + r) / 5) };
    }

    const today = new Date();

    if (range === "7D") {
      return Array.from({ length: 7 }, (_, i) => {
        const d = new Date(today);
        d.setDate(today.getDate() - 6 + i);
        const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return bucket([isoDate(d)], label);
      });
    }

    if (range === "4W") {
      return Array.from({ length: 4 }, (_, i) => {
        const monday = new Date(today);
        const dow = (today.getDay() + 6) % 7; // 0=Mon
        monday.setDate(today.getDate() - dow - (3 - i) * 7);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const label = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return bucket(daysBetween(isoDate(monday), isoDate(sunday)), label);
      });
    }

    // 6M
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth() - 5 + i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      const label = d.toLocaleDateString("en-US", { month: "short" });
      return bucket(daysBetween(isoDate(d), isoDate(end)), label);
    });
  }, [range, sleep, nutrition, bodyMetrics, workoutSessions, runningSessions]);

  const TOOLTIP_STYLE = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius-sm)",
    fontSize: 12,
    color: "var(--text)",
  };

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 20px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <span style={{ fontWeight: 700, color: "var(--text)", fontSize: 15 }}>Protocol Charge</span>
          <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted)" }}>
            health score across all domains
          </span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["7D", "4W", "6M"] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              style={{
                padding: "4px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--border)",
                background: range === r ? "var(--accent)" : "transparent",
                color: range === r ? "#fff" : "var(--text-muted)",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            domain={[0, 100]}
            tick={{ fontSize: 11, fill: "var(--text-muted)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${v}%`}
          />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(value: number, name: string) => [
              `${value}%`,
              name.charAt(0).toUpperCase() + name.slice(1),
            ]}
          />
          <Legend
            wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
            formatter={(v) => v.charAt(0).toUpperCase() + v.slice(1)}
          />
          <Line type="monotone" dataKey="overall"   name="overall"   stroke={COLORS.overall}   strokeWidth={3} dot={false} />
          <Line type="monotone" dataKey="sleep"     name="sleep"     stroke={COLORS.sleep}     strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="nutrition" name="nutrition" stroke={COLORS.nutrition} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="body"      name="body"      stroke={COLORS.body}      strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="workout"   name="workout"   stroke={COLORS.workout}   strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="running"   name="running"   stroke={COLORS.running}   strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
