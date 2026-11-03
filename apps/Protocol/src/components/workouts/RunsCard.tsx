import { useEffect, useState } from "react";
import { Footprints, Trash2, Save } from "lucide-react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addRunningSession, fetchRunningSessions, removeRunningSession } from "../../store/slices/runningSlice";
import { CARD_STYLE, INPUT_STYLE, INPUT_SM, BTN_PRIMARY, ICON_BTN, isoDate, todayISO } from "../../lib/uiHelpers";
import { StatTile } from "../shared/StatTile";
import type { RunningSession } from "../../store/types";

const WINDOW_DAYS = 30;

function fmtPace(s: number | null): string {
  if (s == null || s <= 0) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** "45" → 45 min, "45:30" → mm:ss, "1:05:30" → h:mm:ss. Returns seconds, or null
 *  for anything unparseable or zero. */
function parseDuration(raw: string): number | null {
  const parts = raw.trim().split(":").map((p) => Number(p));
  if (parts.length === 0 || parts.length > 3 || parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length > 1 && parts.slice(1).some((n) => n >= 60)) return null;
  const secs = parts.length === 1 ? parts[0] * 60
    : parts.length === 2 ? parts[0] * 60 + parts[1]
    : parts[0] * 3600 + parts[1] * 60 + parts[2];
  return secs > 0 ? secs : null;
}

function cutoff(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return isoDate(d);
}

/** Runs — Garmin/Strava imports plus hand-logged ones. Distance, pace, a recent list
 *  and a form for logging a run manually. The table has no duration column, so the
 *  entered time is stored as pace (time ÷ distance) — the same shape imports use. */
export default function RunsCard() {
  const dispatch = useAppDispatch();
  const runs = useAppSelector((s) => s.running.sessions);

  // Log-a-run form.
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayISO());
  const [km, setKm] = useState("");
  const [time, setTime] = useState("");
  const [hr, setHr] = useState("");
  const [kcal, setKcal] = useState("");
  const [saving, setSaving] = useState(false);

  const distance = km ? Number(km) : null;
  const durationS = parseDuration(time);
  // Pace needs both halves; integer column, so round.
  const pace = distance != null && distance > 0 && durationS != null ? Math.round(durationS / distance) : null;
  const canSave = distance != null && distance > 0 && !saving && (time.trim() === "" || durationS != null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await dispatch(addRunningSession({
        date,
        actual_km: distance,
        avg_pace_s_per_km: pace,
        heart_rate_avg: hr ? Math.round(Number(hr)) : null,
        calories: kcal ? Math.round(Number(kcal)) : null,
        notes: name.trim() || null,
        completed: true,
      })).unwrap();
      setName(""); setKm(""); setTime(""); setHr(""); setKcal("");
    } finally {
      setSaving(false);
    }
  };

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
          No runs yet — sync from Garmin above, or log one below.
        </div>
      ) : (
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap", marginTop: 12, marginBottom: 8 }}>
          <StatTile label="Distance" value={totalKm > 0 ? totalKm.toFixed(1) : "—"} sub="km" />
          <StatTile label="Runs" value={String(recentWindow.length)} sub={`last ${WINDOW_DAYS}d`} />
          <StatTile label="Avg pace" value={fmtPace(avgPace)} sub="/km" />
          <StatTile label="Longest" value={longest != null ? longest.toFixed(1) : "—"} sub="km" />
        </div>
      )}

      {/* Log a run manually */}
      <form onSubmit={save} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
          Log a run
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input style={{ ...INPUT_STYLE, flex: "2 1 180px" }} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (optional) — e.g. Lakes loop" />
          <input style={{ ...INPUT_STYLE, flex: "1 1 130px" }} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          <input style={{ ...INPUT_SM, flex: "1 1 80px" }} type="number" value={km} onChange={(e) => setKm(e.target.value)} placeholder="km" min={0} step={0.01} required />
          <input style={{ ...INPUT_SM, flex: "1 1 100px", borderColor: time.trim() && durationS == null ? "var(--danger)" : undefined }} value={time} onChange={(e) => setTime(e.target.value)} placeholder="Time — 45:30" title="Minutes, mm:ss or h:mm:ss" />
          <input style={{ ...INPUT_SM, flex: "1 1 80px" }} type="number" value={hr} onChange={(e) => setHr(e.target.value)} placeholder="Avg bpm" min={0} />
          <input style={{ ...INPUT_SM, flex: "1 1 80px" }} type="number" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="kcal" min={0} />
          <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 72, textAlign: "right" }}>
            {pace != null ? `${fmtPace(pace)}/km` : "—/km"}
          </span>
          <button
            type="submit"
            disabled={!canSave}
            style={{ ...BTN_PRIMARY, opacity: canSave ? 1 : 0.5, cursor: canSave ? "pointer" : "not-allowed", flexShrink: 0 }}
          >
            <Save size={14} /> {saving ? "Saving…" : "Log run"}
          </button>
        </div>
      </form>

      {runs.length > 0 && (
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
                {r.notes && <span style={{ color: "var(--text-muted)" }}>{r.notes}</span>}
              </span>
              <button onClick={() => dispatch(removeRunningSession(r.id))} style={{ ...ICON_BTN, padding: 2, flexShrink: 0 }} title="Delete run">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
