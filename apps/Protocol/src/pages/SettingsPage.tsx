import { useState, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { setTheme } from "../store/slices/settingsSlice";
import { garminCheckStatus, garminBridgePath } from "../lib/garminClient";
import { CARD_STYLE, BTN_GHOST } from "../lib/uiHelpers";
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

export default function SettingsPage() {
  const dispatch = useAppDispatch();
  const theme = useAppSelector((s) => s.settings.theme);

  const [garminConnected, setGarminConnected] = useState<boolean | null>(null);
  const [bridgePath, setBridgePath] = useState<string>("");
  const [checkingGarmin, setCheckingGarmin] = useState(false);

  function checkGarmin() {
    setCheckingGarmin(true);
    garminCheckStatus()
      .then((s) => setGarminConnected(s.connected))
      .catch(() => setGarminConnected(false))
      .finally(() => setCheckingGarmin(false));
  }

  useEffect(() => {
    checkGarmin();
    garminBridgePath().then(setBridgePath).catch(() => {});
  }, []);

  const authCommand = bridgePath
    ? `python "${bridgePath}" auth`
    : `python garmin_bridge.py auth`;

  function copyAuthCommand() {
    navigator.clipboard.writeText(authCommand).catch(() => {});
  }

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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
          <div style={sectionTitle}>Garmin Connect</div>
          <div style={{ fontSize: 12 }}>
            {garminConnected === null && (
              <span style={{ color: "var(--text-muted)" }}>Checking…</span>
            )}
            {garminConnected === true && (
              <span style={{ color: "#10b981" }}>● Connected</span>
            )}
            {garminConnected === false && (
              <span style={{ color: "var(--text-muted)" }}>○ Not connected</span>
            )}
          </div>
        </div>
        <div style={sectionDesc}>
          Sync sleep, body metrics, and activities from Garmin Connect using the python-garminconnect library.
        </div>

        {garminConnected === false && (
          <div
            style={{
              background: "var(--bg)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)",
              padding: "12px 16px",
              marginBottom: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)", marginBottom: 6 }}>
              First-time setup
            </div>
            <ol style={{ fontSize: 13, color: "var(--text-muted)", margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
              <li>
                Install the library:{" "}
                <code
                  style={{
                    fontFamily: "monospace",
                    fontSize: 12,
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "1px 6px",
                    color: "var(--text)",
                  }}
                >
                  pip install garminconnect
                </code>
              </li>
              <li style={{ marginTop: 6 }}>Run the auth command below once to store your tokens</li>
            </ol>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <code
                style={{
                  flex: 1,
                  fontFamily: "monospace",
                  fontSize: 12,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  padding: "5px 10px",
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {authCommand}
              </code>
              <button onClick={copyAuthCommand} style={BTN_GHOST}>
                Copy
              </button>
            </div>
          </div>
        )}

        <button
          onClick={checkGarmin}
          disabled={checkingGarmin}
          style={{
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
            cursor: checkingGarmin ? "default" : "pointer",
            opacity: checkingGarmin ? 0.6 : 1,
          }}
        >
          {checkingGarmin ? "Checking…" : "Check Connection"}
        </button>
      </div>
    </div>
  );
}
