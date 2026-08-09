import { useEffect } from "react";
import { Footprints, Trash2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { fetchRunningSessions, removeRunningSession } from "../../store/slices/runningSlice";
import { CARD_STYLE, ICON_BTN, isoDate } from "../../lib/uiHelpers";
import { StatTile } from "../shared/StatTile";
import type { RunningSession } from "../../store/types";

const WINDOW_DAYS = 30;

function fmtPace(s: number | null): string {
  if (s == null || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function cutoff(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

/** Read-only summary of runs (Garmin/Strava imported). Distance, pace and a recent
 *  list — running is imported, not hand-logged, so there's no add form here. */
export default function RunsCard() {
  const dispatch = useAppDispatch();
  const runs = useAppSelector((s) => s.running.sessions);

  useEffect(() => {
    dispatch(fetchRunningSessions());
  }, [dispatch]);

  const since = cutoff(WINDOW_DAYS);
  const recentWindow = runs.filter((r) => r.date >= since);
  const withKm = recentWindow.filter((r) => r.actual_km != null);
  const totalKm = withKm.reduce((sum, r) => sum + (r.actual_km ?? 0), 0);
  const paces = recentWindow.map((r) => r.avg_pace_s_per_km).filter((p): p is number => p != null && p > 0);
  const avgPace = paces.length > 0 ? paces.reduce((a, b) => a + b, 0) / paces.length : null;
  const longest = withKm.reduce<number | null>((best, r) => Math.max(best ?? 0, r.actual_km ?? 0), null);

  const recent = [...runs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);

  return (
    <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Footprints size={15} color="var(--series-running)" />
        <span style={{ fontWeight: 600, color: "var(--text)", fontSize: 14 }}>Runs</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>· last {WINDOW_DAYS} days</span>
      </div>

      {runs.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", padding: "24px 0" }}>
          No runs yet — sync from Garmin above.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 12, marginBottom: 8 }}>
            <StatTile label="Distance" value={totalKm > 0 ? totalKm.toFixed(1) : "—"} sub="km" />
            <StatTile label="Runs" value={String(recentWindow.length)} sub={`last ${WINDOW_DAYS}d`} />
            <StatTile label="Avg pace" value={fmtPace(avgPace)} sub="/km" />
            <StatTile label="Longest" value={longest != null ? longest.toFixed(1) : "—"} sub="km" />
          </div>

          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
            {recent.map((r: RunningSession) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)", width: 54, flexShrink: 0 }}>
                  {new Date(`${r.date}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", width: 64, flexShrink: 0 }}>
                  {r.actual_km != null ? `${r.actual_km.toFixed(1)} km` : "—"}
                </span>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {r.avg_pace_s_per_km != null && <span>{fmtPace(r.avg_pace_s_per_km)}/km</span>}
                  {r.heart_rate_avg != null && <span>{r.heart_rate_avg} bpm</span>}
                  {r.calories != null && <span>{r.calories} kcal</span>}
                </span>
                <button onClick={() => dispatch(removeRunningSession(r.id))} style={{ ...ICON_BTN, padding: 2, flexShrink: 0 }} title="Delete run">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
