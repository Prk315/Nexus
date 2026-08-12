import { useMemo, useState } from "react";
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
} from "recharts";
import type { BodyMetric, RunningSession, SleepEntry, WorkoutSession, NutritionGoalItem } from "../../store/types";
import type { NutrientTotals } from "../../lib/mealNutrition";
import { isoDate } from "../../lib/uiHelpers";
import { weeklyNutritionScore, type CalorieConfig } from "../../lib/nutritionScore";

type Range = "7D" | "4W" | "6M";
type Domain = "sleep" | "nutrition" | "body" | "workout" | "running";

const COLORS: Record<"overall" | Domain, string> = {
  overall:   "var(--accent)",
  sleep:     "var(--series-sleep)",
  nutrition: "var(--series-nutrition)",
  body:      "var(--series-body)",
  workout:   "var(--series-workout)",
  running:   "var(--series-running)",
};

const TRACK_COLORS: Record<Domain, string> = {
  sleep:     "var(--series-sleep-track)",
  nutrition: "var(--series-nutrition-track)",
  body:      "var(--series-body-track)",
  workout:   "var(--series-workout-track)",
  running:   "var(--series-running-track)",
};

const DOMAIN_META: { key: Domain; label: string }[] = [
  { key: "sleep",     label: "Sleep" },
  { key: "nutrition", label: "Nutrition" },
  { key: "body",      label: "Body" },
  { key: "workout",   label: "Workout" },
  { key: "running",   label: "Running" },
];

/** A single ring gauge — score out of 100, filled arc in the domain's own color. */
function DomainRing({ label, value, color, track }: { label: string; value: number; color: string; track: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ value }]}
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            barSize={5}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <RadialBar
              dataKey="value"
              cornerRadius={3}
              fill={color}
              background={{ fill: track }}
              isAnimationActive={false}
            />
          </RadialBarChart>
        </ResponsiveContainer>
        <div
          style={{
            position: "absolute", inset: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, color: "var(--text)",
          }}
        >
          {value}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text)" }}>{label}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{value}%</div>
      </div>
    </div>
  );
}

// ── Scoring (0–100 per day) ─────────────────────────────────────────────────

/** Sleep score over the trailing 7 days ending at `date` — the average nightly
 *  quality/duration score across the week, so one good night can't offset a bad
 *  week. 0 if nothing was tracked in the window. */
function scoreSleep(date: string, entries: SleepEntry[]): number {
  const start = addDaysISO(date, -6);
  const week = entries.filter((e) => e.date >= start && e.date <= date);
  if (!week.length) return 0;
  const scores = week.map((e) => {
    const q = (e.quality_score / 10) * 65;
    const d = Math.max(0, 35 * (1 - Math.abs(e.duration_min - 480) / 300));
    return Math.min(100, q + d);
  });
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

/**
 * Weekly nutrition score at `date`: how well the trailing 7 days' intake met
 * the weekly nutrient goals and the dynamic calorie target (base + active ±
 * offset). See lib/nutritionScore. 0 on a week with nothing logged.
 */
function scoreNutrition(
  date: string,
  totalsByDate: Map<string, NutrientTotals>,
  activeCaloriesByDate: Map<string, number>,
  goals: NutritionGoalItem[],
  calorie: CalorieConfig | null,
): number {
  const dates: string[] = [];
  for (let i = 6; i >= 0; i--) dates.push(addDaysISO(date, -i));
  return weeklyNutritionScore(
    dates,
    totalsByDate as unknown as Map<string, Record<string, number | null>>,
    activeCaloriesByDate,
    goals,
    calorie,
  );
}

/** Body score over the trailing 7 days ending at `date` — vitals coverage of
 *  the most recent reading in the week. 0 if nothing was measured in the window,
 *  so a week with no body data reads as a gap rather than a stale old score. */
function scoreBody(date: string, entries: BodyMetric[]): number {
  const start = addDaysISO(date, -6);
  const week = entries
    .filter((e) => e.date >= start && e.date <= date)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!week.length) return 0;
  const e = week[week.length - 1];
  const fields = [e.weight_kg, e.hrv_ms, e.resting_hr_bpm, e.spo2_pct].filter((v) => v != null).length;
  return Math.min(100, 25 + fields * 19);
}

/** ISO date `delta` days from `dateStr` (delta may be negative). */
function addDaysISO(dateStr: string, delta: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return isoDate(d);
}

/**
 * Strength score: completed workout sessions over the trailing 7 days ending at
 * `date`, vs the weekly-sessions goal (100 when the goal is met). With no goal
 * set it falls back to the old per-day heuristic.
 */
function scoreWorkout(date: string, sessions: WorkoutSession[], goalPerWeek: number | null): number {
  if (goalPerWeek && goalPerWeek > 0) {
    const start = addDaysISO(date, -6);
    const count = sessions.filter((s) => s.completed && s.scheduled_date >= start && s.scheduled_date <= date).length;
    return Math.min(100, Math.round((count / goalPerWeek) * 100));
  }
  const today = sessions.filter((s) => s.scheduled_date === date);
  if (!today.length) return 0;
  const completed = today.filter((s) => s.completed).length;
  return completed === 0 ? 20 : Math.min(100, completed * 100);
}

/**
 * Running score: completed km over the trailing 7 days ending at `date`, vs the
 * weekly-km goal (100 when the goal is met). With no goal set it falls back to
 * the old per-day actual-vs-planned heuristic.
 */
function scoreRunning(date: string, sessions: RunningSession[], goalKmPerWeek: number | null): number {
  if (goalKmPerWeek && goalKmPerWeek > 0) {
    const start = addDaysISO(date, -6);
    const km = sessions
      .filter((s) => s.completed && s.date >= start && s.date <= date)
      .reduce((sum, s) => sum + (s.actual_km ?? 0), 0);
    return Math.min(100, Math.round((km / goalKmPerWeek) * 100));
  }
  const today = sessions.filter((s) => s.date === date);
  if (!today.length) return 0;
  const completed = today.filter((s) => s.completed);
  if (!completed.length) return 15;
  const scores = completed.map((s) =>
    s.actual_km && s.planned_km && s.planned_km > 0 ? Math.min(100, (s.actual_km / s.planned_km) * 100) : 100,
  );
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

// ── Date helpers ────────────────────────────────────────────────────────────

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
  /** Full nutrient totals per date (Meal Planner, logged entries only). */
  nutritionTotalsByDate: Map<string, NutrientTotals>;
  nutritionGoals: NutritionGoalItem[];
  /** Oura active calories per date — feeds the dynamic calorie target. */
  activeCaloriesByDate: Map<string, number>;
  calorieConfig: CalorieConfig | null;
  bodyMetrics: BodyMetric[];
  workoutSessions: WorkoutSession[];
  runningSessions: RunningSession[];
  /** Weekly targets driving the Workout & Running scores (null = old heuristic). */
  workoutGoalPerWeek: number | null;
  runningGoalKmPerWeek: number | null;
}

interface Point {
  label: string;
  overall: number;
  /** Same value as `overall`, under a distinct key so the fill Area and the
   *  overall Line don't share a dataKey — recharts collapses same-key
   *  graphical series, which was hiding the overall line. */
  overallArea: number;
  sleep: number;
  nutrition: number;
  body: number;
  workout: number;
  running: number;
}

export default function ProtocolChargeChart({
  sleep, nutritionTotalsByDate, nutritionGoals, activeCaloriesByDate, calorieConfig,
  bodyMetrics, workoutSessions, runningSessions,
  workoutGoalPerWeek, runningGoalKmPerWeek,
}: Props) {
  const [range, setRange] = useState<Range>("7D");

  const data = useMemo<Point[]>(() => {
    // Every domain scores over the trailing 7 days ending at `date`, so each
    // point reads as "how's the last week" rather than a single day.
    function dayScore(date: string) {
      return {
        sleep:    scoreSleep(date, sleep),
        nutrition: scoreNutrition(date, nutritionTotalsByDate, activeCaloriesByDate, nutritionGoals, calorieConfig),
        body:     scoreBody(date, bodyMetrics),
        workout:  scoreWorkout(date, workoutSessions, workoutGoalPerWeek),
        running:  scoreRunning(date, runningSessions, runningGoalKmPerWeek),
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
      const overall = Math.round((s + n + b + w + r) / 5);
      return { label, sleep: s, nutrition: n, body: b, workout: w, running: r, overall, overallArea: overall };
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
  }, [range, sleep, nutritionTotalsByDate, nutritionGoals, activeCaloriesByDate, calorieConfig, bodyMetrics, workoutSessions, runningSessions, workoutGoalPerWeek, runningGoalKmPerWeek]);

  const TOOLTIP_STYLE = {
    background: "var(--surface)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
    boxShadow: "var(--shadow-md)",
    fontSize: 12,
    color: "var(--text)",
  };

  const latest = data[data.length - 1]?.overall ?? null;
  const previous = data[data.length - 2]?.overall ?? null;
  const delta = latest != null && previous != null ? latest - previous : null;

  return (
    <div
      style={{
        width: "100%",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        padding: "28px 40px 20px",
        boxSizing: "border-box",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 40, fontWeight: 800, letterSpacing: "-0.02em", color: "var(--text)" }}>
            Protocol
          </h1>
          <div style={{ marginTop: 4, fontSize: 13, color: "var(--text-secondary)" }}>
            <span style={{ fontWeight: 600, color: "var(--text)" }}>Charge</span>
            {" — health score across sleep, nutrition, body, workouts & running"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: 24 }}>
          {latest != null && (
            <div style={{ textAlign: "right" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, justifyContent: "flex-end" }}>
                <span style={{ fontSize: 48, fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
                  {latest}%
                </span>
                {delta != null && delta !== 0 && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: delta > 0 ? "var(--success)" : "var(--danger)" }}>
                    {delta > 0 ? "+" : ""}{delta}
                  </span>
                )}
              </div>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>overall, latest</span>
            </div>
          )}

          <div style={{ display: "flex", gap: 4, paddingBottom: 4 }}>
            {(["7D", "4W", "6M"] as Range[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  background: range === r ? "var(--accent)" : "transparent",
                  color: range === r ? "var(--accent-fg)" : "var(--text-muted)",
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
      </div>

      <div style={{ display: "flex", gap: 32, alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <ResponsiveContainer width="100%" height={360}>
            <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -28 }}>
              <defs>
                <linearGradient id="overallGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.overall} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={COLORS.overall} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border-subtle)" strokeWidth={1} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "var(--text-muted)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 12, fill: "var(--text-muted)" }}
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
                wrapperStyle={{ fontSize: 12, paddingTop: 16 }}
                payload={(["overall", "sleep", "nutrition", "body", "workout", "running"] as const).map((key) => ({
                  value: key.charAt(0).toUpperCase() + key.slice(1),
                  type: "line" as const,
                  color: COLORS[key],
                }))}
              />
              <Area type="monotone" dataKey="overallArea" name="overallArea" stroke="none" fill="url(#overallGrad)" isAnimationActive={false} legendType="none" tooltipType="none" />
              <Line type="monotone" dataKey="sleep"     name="sleep"     stroke={COLORS.sleep}     strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="nutrition" name="nutrition" stroke={COLORS.nutrition} strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="body"      name="body"      stroke={COLORS.body}      strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="workout"   name="workout"   stroke={COLORS.workout}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="running"   name="running"   stroke={COLORS.running}   strokeWidth={2} dot={false} />
              <Line type="monotone" dataKey="overall"   name="overall"   stroke={COLORS.overall}   strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--surface)" }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div
          style={{
            width: 190,
            flexShrink: 0,
            borderLeft: "1px solid var(--border-subtle)",
            paddingLeft: 24,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-evenly",
          }}
        >
          {DOMAIN_META.map(({ key, label }) => (
            <DomainRing
              key={key}
              label={label}
              value={data[data.length - 1]?.[key] ?? 0}
              color={COLORS[key]}
              track={TRACK_COLORS[key]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
