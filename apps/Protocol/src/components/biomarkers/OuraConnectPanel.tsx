import { useEffect, useState } from "react";
import { RefreshCw, CheckCircle, AlertCircle } from "lucide-react";
import { startOuraConnect, isOuraConnected, disconnectOura, syncOuraNow } from "../../lib/oura";
import { CARD_STYLE } from "../../lib/uiHelpers";

const OURA_ACCENT = "#8a6fe8";

interface Props {
  onSynced: () => void;
}

export default function OuraConnectPanel({ onSynced }: Props) {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    isOuraConnected().then(setConnected).catch(() => setConnected(false));
  }, []);

  async function handleConnect() {
    setBusy(true);
    setError(null);
    try {
      await startOuraConnect();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  }

  async function handleSync() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const r = await syncOuraNow();
      const workoutPart = r.workoutCount ? ` + ${r.workoutCount} workouts` : "";
      setResult(`Synced ${r.sleepDays ?? 0} sleep + ${r.bodyDays ?? 0} body metric days${workoutPart}`);
      onSynced();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      await disconnectOura();
      setConnected(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const btnStyle: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 14px",
    background: `${OURA_ACCENT}22`,
    color: OURA_ACCENT,
    border: `1px solid ${OURA_ACCENT}44`,
    borderRadius: "var(--radius-sm)",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    opacity: busy ? 0.6 : 1,
  };

  return (
    <div style={{ ...CARD_STYLE, padding: "16px 20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text)" }}>Oura Ring</span>

        <div style={{ fontSize: 12 }}>
          {connected === null && <span style={{ color: "var(--text-muted)" }}>Checking…</span>}
          {connected === true && <span style={{ color: "#10b981" }}>● Connected</span>}
          {connected === false && <span style={{ color: "var(--text-muted)" }}>○ Not connected</span>}
        </div>
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {connected === false && (
          <button onClick={handleConnect} disabled={busy} style={btnStyle}>
            Connect Oura
          </button>
        )}
        {connected === true && (
          <>
            <button onClick={handleSync} disabled={busy} style={btnStyle}>
              <RefreshCw size={13} /> Sync now
            </button>
            <button
              onClick={handleDisconnect}
              disabled={busy}
              style={{ ...btnStyle, background: "none", color: "var(--text-muted)", border: "1px solid var(--border)" }}
            >
              Disconnect
            </button>
          </>
        )}
      </div>

      {result && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#10b981", fontSize: 13, marginTop: 10 }}>
          <CheckCircle size={14} /> {result}
        </div>
      )}
      {error && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#ef4444", fontSize: 13, marginTop: 10 }}>
          <AlertCircle size={14} /> {error}
        </div>
      )}
    </div>
  );
}
