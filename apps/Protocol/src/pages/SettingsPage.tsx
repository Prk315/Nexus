import { useState, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setTheme } from "../store/slices/settingsSlice";
import {
  garminCheckStatus,
  garminCheckDeps,
  garminAuth,
  garminLogout,
  garminBridgePath,
} from "../lib/garminClient";
import { CARD_STYLE, BTN_GHOST, INPUT_STYLE, LABEL_STYLE } from "../lib/uiHelpers";
import type { Theme } from "../store/types";

const GARMIN_BLUE = "#009CDE";

const sectionTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: "var(--text)",
  marginBottom: 4,
};

const sectionDesc: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  marginBottom: 14,
};

const connectBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 18px",
  background: GARMIN_BLUE,
  color: "#fff",
  border: "none",
  borderRadius: "var(--radius-sm)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.settings.theme);

  // Garmin connection state
  const [connected, setConnected] = useState<boolean | null>(null);
  const [depsOk, setDepsOk] = useState<boolean | null>(null);
  const [bridgePath, setBridgePath] = useState("");

  // Credential form state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Show the manual fallback command
  const [showManual, setShowManual] = useState(false);

  function refreshStatus() {
    setConnected(null);
    garminCheckStatus()
      .then((s) => setConnected(s.connected))
      .catch(() => setConnected(false));
  }

  useEffect(() => {
    refreshStatus();
    garminCheckDeps()
      .then((r) => setDepsOk(r.garminconnect_installed))
      .catch(() => setDepsOk(false));
    garminBridgePath().then(setBridgePath).catch(() => {});
  }, []);

  async function handleConnect() {
    if (!email || !password) return;
    setConnecting(true);
    setAuthError(null);
    try {
      const result = await garminAuth(email, password, needsMfa ? otp : undefined);
      if (result.mfa_required) {
        setNeedsMfa(true);
      } else if (result.ok) {
        setNeedsMfa(false);
        setEmail("");
        setPassword("");
        setOtp("");
        refreshStatus();
      }
    } catch (e) {
      setAuthError(String(e));
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnect() {
    try {
      await garminLogout();
      refreshStatus();
    } catch (e) {
      setAuthError(String(e));
    }
  }

  const authCommand = bridgePath
    ? `python "${bridgePath}" auth`
    : `python garmin_bridge.py auth`;

  const THEMES: { value: Theme; label: string }[] = [
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
    { value: "system", label: "System" },
  ];

  return (
    <div style={{ padding: 32, maxWidth: 600, display: "flex", flexDirection: "column", gap: 24 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", marginBottom: 4 }}>Settings</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Theme and integrations.</p>
      </div>

      {/* Appearance */}
      <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
        <div style={sectionTitle}>Appearance</div>
        <div style={sectionDesc}>Choose how Protocol looks on your screen.</div>
        <div style={{ display: "flex", gap: 8 }}>
          {THEMES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => dispatch(setTheme(value))}
              style={{
                padding: "7px 16px",
                background: theme === value ? "var(--accent)" : "none",
                color: theme === value ? "#fff" : "var(--text-muted)",
                border: `1px solid ${theme === value ? "var(--accent)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)",
                fontSize: 13,
                fontWeight: theme === value ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Garmin Connect */}
      <div style={{ ...CARD_STYLE, padding: "20px 24px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={sectionTitle}>Garmin Connect</div>
          <div style={{ fontSize: 12 }}>
            {connected === null && <span style={{ color: "var(--text-muted)" }}>Checking…</span>}
            {connected === true && <span style={{ color: "#10b981" }}>● Connected</span>}
            {connected === false && <span style={{ color: "var(--text-muted)" }}>○ Not connected</span>}
          </div>
        </div>
        <div style={sectionDesc}>
          Sync sleep, body metrics, and activities from your Garmin device.
        </div>

        {/* Library not installed warning */}
        {depsOk === false && (
          <div
            style={{
              marginBottom: 16,
              padding: "10px 14px",
              background: "#fef3c7",
              border: "1px solid #f59e0b",
              borderRadius: "var(--radius-sm)",
              fontSize: 13,
              color: "#92400e",
            }}
          >
            <strong>garminconnect</strong> is not installed. Run:{" "}
            <code
              style={{
                fontFamily: "monospace",
                fontSize: 12,
                background: "#fde68a",
                borderRadius: 3,
                padding: "1px 5px",
              }}
            >
              pip install garminconnect
            </code>
          </div>
        )}

        {/* Connected state */}
        {connected === true && (
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Tokens stored at <code style={{ fontFamily: "monospace", fontSize: 12 }}>~/.garminconnect</code>
            </span>
            <button
              onClick={handleDisconnect}
              style={{
                ...BTN_GHOST,
                color: "#ef4444",
                borderColor: "#ef444444",
              }}
            >
              Disconnect
            </button>
          </div>
        )}

        {/* Auth form — not connected */}
        {connected === false && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={LABEL_STYLE}>Garmin email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={INPUT_STYLE}
                disabled={connecting}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={LABEL_STYLE}>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={INPUT_STYLE}
                disabled={connecting}
                onKeyDown={(e) => { if (e.key === "Enter" && !needsMfa) handleConnect(); }}
              />
            </div>

            {needsMfa && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={LABEL_STYLE}>
                  MFA code{" "}
                  <span style={{ fontWeight: 400, color: "var(--text-muted)" }}>
                    — check your Garmin app or authenticator
                  </span>
                </label>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                  placeholder="123456"
                  style={{ ...INPUT_STYLE, maxWidth: 160 }}
                  disabled={connecting}
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") handleConnect(); }}
                />
              </div>
            )}

            {authError && (
              <div
                style={{
                  padding: "8px 12px",
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  borderRadius: "var(--radius-sm)",
                  fontSize: 13,
                  color: "#b91c1c",
                }}
              >
                {authError}
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={handleConnect}
                disabled={connecting || !email || !password || depsOk === false}
                style={{
                  ...connectBtn,
                  opacity: (connecting || !email || !password || depsOk === false) ? 0.5 : 1,
                  cursor: (connecting || !email || !password || depsOk === false) ? "default" : "pointer",
                }}
              >
                {connecting
                  ? "Connecting…"
                  : needsMfa
                  ? "Submit Code"
                  : "Connect to Garmin"}
              </button>

              {needsMfa && (
                <button
                  onClick={() => { setNeedsMfa(false); setOtp(""); setAuthError(null); }}
                  style={BTN_GHOST}
                >
                  Start over
                </button>
              )}
            </div>

            {/* Manual fallback */}
            <div style={{ marginTop: 4 }}>
              <button
                onClick={() => setShowManual((v) => !v)}
                style={{ ...BTN_GHOST, fontSize: 12 }}
              >
                {showManual ? "Hide" : "Or connect via terminal ›"}
              </button>
              {showManual && (
                <div
                  style={{
                    marginTop: 8,
                    padding: "10px 14px",
                    background: "var(--bg)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: 13,
                    color: "var(--text-muted)",
                  }}
                >
                  <div style={{ marginBottom: 6 }}>Run this command once, then refresh:</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <code
                      style={{
                        flex: 1,
                        fontFamily: "monospace",
                        fontSize: 12,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-sm)",
                        padding: "4px 8px",
                        color: "var(--text)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {authCommand}
                    </code>
                    <button
                      onClick={() => navigator.clipboard.writeText(authCommand).catch(() => {})}
                      style={BTN_GHOST}
                    >
                      Copy
                    </button>
                  </div>
                  <button
                    onClick={refreshStatus}
                    style={{ ...BTN_GHOST, marginTop: 10 }}
                  >
                    Refresh connection status
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
