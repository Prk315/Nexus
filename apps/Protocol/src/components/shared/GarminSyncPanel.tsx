import { useEffect, useState } from "react";
import { Activity, CheckCircle, AlertCircle } from "lucide-react";
import { garminCheckStatus } from "../../lib/garminClient";
import { syncGarminSleep, syncGarminBodyStats, syncGarminActivities } from "../../lib/importers/garmin";
import { CARD_STYLE, todayISO } from "../../lib/uiHelpers";

const GARMIN_BLUE = "#009CDE";

interface GarminSyncPanelProps {
  mode: "all" | "sleep" | "body" | "activities";
  onSynced: () => void;
}

export default function GarminSyncPanel({ mode, onSynced }: GarminSyncPanelProps) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [days, setDays] = useState(7);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    garminCheckStatus().then(s => setConnected(s.connected)).catch(() => setConnected(false));
  }, []);

  async function runSync(
    fn: (date: string, days: number) => Promise<string>,
  ) {
    setSyncing(true); setResult(null); setError(null);
    try {
      setResult(await fn(todayISO(), days));
      onSynced();
    } catch (e) {
      setError(String(e));
    } finally {
      setSyncing(false);
    }
  }

  async function handleSyncSleep() {
    return runSync(async (date, d) => {
      const { count } = await syncGarminSleep(date, d);
      return `Imported ${count} sleep entries`;
    });
  }

  async function handleSyncBody() {
    return runSync(async (date, d) => {
      const { count } = await syncGarminBodyStats(date, d);
      return `Imported ${count} body metric entries`;
    });
  }

  async function handleSyncActivities() {
    return runSync(async (date, d) => {
      const { runCount, workoutCount } = await syncGarminActivities(date, d);
      return `Imported ${runCount + workoutCount} activities`;
    });
  }

  const syncBtnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 14px",
    background: `${GARMIN_BLUE}22`,
    color: GARMIN_BLUE,
    border: `1px solid ${GARMIN_BLUE}44`,
    borderRadius: "var(--radius-sm)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    opacity: syncing ? 0.6 : 1,
  };

  const dayBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px",
    background: active ? GARMIN_BLUE : "none",
    color: active ? "#fff" : "var(--text-muted)",
    border: `1px solid ${active ? GARMIN_BLUE : "var(--border)"}`,
    borderRadius: "var(--radius-sm)",
    fontSize: 12,
    fontWeight: active ? 600 : 400,
    cursor: "pointer",
  });

  return (
    <div style={{ ...CARD_STYLE, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Activity size={16} color={GARMIN_BLUE} />
          <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>
            Garmin Connect
          </span>
        </div>

        <div style={{ fontSize: 12 }}>
          {connected === null && (
            <span style={{ color: "var(--text-muted)" }}>Checking…</span>
          )}
          {connected === true && (
            <span style={{ color: "#10b981" }}>● Connected</span>
          )}
          {connected === false && (
            <span style={{ color: "var(--text-muted)" }}>○ Not connected</span>
          )}
        </div>
      </div>

      {connected === false && (
        <p style={{ marginTop: 10, fontSize: 13, color: "var(--text-muted)" }}>
          Not connected — authenticate in the <strong>Settings</strong> tab first.
        </p>
      )}

      {connected === true && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: 12, color: "var(--text-muted)", marginRight: 4 }}>Range:</span>
            {([7, 14, 30] as const).map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                style={dayBtnStyle(days === d)}
              >
                {d} days
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(mode === "sleep" || mode === "all") && (
              <button onClick={handleSyncSleep} disabled={syncing} style={syncBtnStyle}>
                Sync Sleep
              </button>
            )}
            {(mode === "body" || mode === "all") && (
              <button onClick={handleSyncBody} disabled={syncing} style={syncBtnStyle}>
                Sync Body Metrics
              </button>
            )}
            {(mode === "activities" || mode === "all") && (
              <button onClick={handleSyncActivities} disabled={syncing} style={syncBtnStyle}>
                Sync Activities
              </button>
            )}
          </div>
        </div>
      )}

      {syncing && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--text-muted)", fontSize: 13, marginTop: 10 }}>
          <span>Syncing…</span>
        </div>
      )}
      {!syncing && result && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#10b981", fontSize: 13, marginTop: 10 }}>
          <CheckCircle size={14} /> {result}
        </div>
      )}
      {!syncing && error && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#ef4444", fontSize: 13, marginTop: 10 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  );
}
