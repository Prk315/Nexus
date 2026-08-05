import { useEffect, useState } from "react";
import { Activity, Footprints, Dumbbell } from "lucide-react";
import { getSupabaseClient, getUserId } from "../../lib/supabase";
import { StatTile, TrendChart } from "./BiomarkerCharts";
import { isoDate } from "../../lib/uiHelpers";

/**
 * Activity glance for the Biomarkers page — Oura's daily activity (steps /
 * active calories / MET, stored on protocol_body_metrics) plus the recent
 * exercise sessions on protocol_workout_sessions (Oura workouts + any
 * Garmin/Strava imports). Self-contained: fetches its own data via the shared
 * Supabase client so it drops in with no store wiring, RLS-scoped to the
 * signed-in user.
 */

const HISTORY_DAYS = 30;

function subDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

interface ActivityDay {
  date: string;
  steps: number | null;
  active_calories: number | null;
  activity_score: number | null;
  high_activity_min: number | null;
  medium_activity_min: number | null;
}

interface SessionRow {
  scheduled_date: string;
  name: string;
  duration_min: number | null;
  calories_burned: number | null;
  notes: string | null;
}

const MODULE_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: "24px 28px",
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

function useActivity() {
  const [days, setDays] = useState<ActivityDay[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sb = getSupabaseClient();
        const userId = getUserId();
        const since = subDays(HISTORY_DAYS - 1);
        const [act, ses] = await Promise.all([
          sb.from("protocol_body_metrics")
            .select("date, steps, active_calories, activity_score, high_activity_min, medium_activity_min")
            .eq("user_id", userId).gte("date", since).order("date", { ascending: true }),
          sb.from("protocol_workout_sessions")
            .select("scheduled_date, name, duration_min, calories_burned, notes")
            .eq("user_id", userId).gte("scheduled_date", since).order("scheduled_date", { ascending: false }),
        ]);
        if (!alive) return;
        setDays((act.data ?? []) as ActivityDay[]);
        setSessions((ses.data ?? []) as SessionRow[]);
      } catch {
        /* not authenticated / error — leave empty */
      }
    })();
    return () => { alive = false; };
  }, []);

  return { days, sessions };
}

function latest<K extends keyof ActivityDay>(days: ActivityDay[], field: K): ActivityDay[K] | null {
  for (let i = days.length - 1; i >= 0; i--) if (days[i][field] != null) return days[i][field];
  return null;
}

function avgSteps7d(days: ActivityDay[]): number | null {
  const cutoff = subDays(6);
  const vals = days.filter((d) => d.date >= cutoff && d.steps != null).map((d) => d.steps as number);
  if (!vals.length) return null;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

// ── Sub-views ────────────────────────────────────────────────────────────────

function DailySummary({ days }: { days: ActivityDay[] }) {
  const stepData = days.map((d) => ({ date: d.date.slice(5), value: d.steps ?? null }));
  const calData = days.map((d) => ({ date: d.date.slice(5), value: d.active_calories ?? null }));
  const hasData = days.some((d) => d.steps != null);

  if (!hasData) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        No daily-activity data yet — connect Oura in Settings, then sync.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Steps (30d)</div>
          <TrendChart data={stepData} color="var(--series-running)" gradientId="actSteps" height={130} />
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", marginBottom: 6 }}>Active calories (30d)</div>
          <TrendChart data={calData} color="var(--series-nutrition)" gradientId="actCal" height={130} valueSuffix=" kcal" />
        </div>
      </div>
    </div>
  );
}

function SessionList({ sessions }: { sessions: SessionRow[] }) {
  if (!sessions.length) {
    return (
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
        No activity sessions in the last {HISTORY_DAYS} days.
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sessions.slice(0, 12).map((s, i) => (
        <div
          key={`${s.scheduled_date}-${s.name}-${i}`}
          style={{
            display: "grid", gridTemplateColumns: "72px 1fr auto auto", alignItems: "center", gap: 12,
            padding: "8px 12px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>{s.scheduled_date.slice(5)}</span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", textTransform: "capitalize" }}>{s.name}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{s.duration_min != null ? `${s.duration_min} min` : "—"}</span>
          <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 60, textAlign: "right" }}>
            {s.calories_burned != null ? `${s.calories_burned} kcal` : "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Module ───────────────────────────────────────────────────────────────────

export default function ActivityModule() {
  const { days, sessions } = useActivity();

  const latestSteps = latest(days, "steps");
  const latestCal = latest(days, "active_calories");
  const latestScore = latest(days, "activity_score");
  const sessions7d = sessions.filter((s) => s.scheduled_date >= subDays(6)).length;

  return (
    <div style={MODULE_STYLE}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 8, background: "var(--series-running-track)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--series-running)", flexShrink: 0 }}>
            <Activity size={16} />
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: "var(--text)" }}>Activity</span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Daily activity & exercise sessions</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <StatTile label="Steps (latest)" value={latestSteps != null ? latestSteps.toLocaleString() : "—"} sub={(() => { const a = avgSteps7d(days); return a != null ? `${a.toLocaleString()} avg 7d` : undefined; })()} />
          <StatTile label="Active cal (latest)" value={latestCal != null ? String(latestCal) : "—"} sub="kcal" />
          <StatTile label="Activity score" value={latestScore != null ? String(latestScore) : "—"} sub="/ 100" />
          <StatTile label="Sessions (7d)" value={String(sessions7d)} />
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-muted)" }}>
        <Footprints size={13} /> Daily activity
      </div>
      <DailySummary days={days} />

      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: "var(--text-muted)", paddingTop: 4, borderTop: "1px solid var(--border-subtle)" }}>
        <Dumbbell size={13} /> Recent sessions
      </div>
      <SessionList sessions={sessions} />
    </div>
  );
}
