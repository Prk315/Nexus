import { useEffect, useState, type ReactNode } from "react";
import { NexusHeader } from "@nexus/core";
import { invoke } from "@tauri-apps/api/core";
import NavTab from "./NavTab";
import DashboardPage from "../../pages/DashboardPage";
import HistoryPage from "../../pages/HistoryPage";
import ReportsPage from "../../pages/ReportsPage";
import SettingsPage from "../../pages/SettingsPage";
import TimeKeeperPage from "../../pages/TimeKeeperPage";
import QuickSessionSheet from "../QuickSessionSheet";
import { startTimer } from "../../lib/tauriApi";

// App blocker / site blocker / schedule features rely on macOS system APIs
// (osascript, /etc/hosts, pkill) that don't exist on iOS.
const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

interface AppShellProps {
  pendingUrl: string | null;
  onUrlHandled: () => void;
}

const ALL_TABS = ["Dashboard", "History", "Reports", "Focus", "Settings"] as const;
// On iOS: "Dashboard" becomes the primary timer tab; "Focus" tab is shown because
// site blocking works via Safari Content Blocker (app blocking is hidden within the page).
const MOBILE_TABS = ["Dashboard", "History", "Reports", "Focus", "Settings"] as const;
type Tab = (typeof ALL_TABS)[number];

const TABS: readonly Tab[] = IS_IOS ? MOBILE_TABS : ALL_TABS;

const PAGE: Record<Tab, ReactNode> = {
  Dashboard: <DashboardPage />,
  History: <HistoryPage />,
  Reports: <ReportsPage />,
  Focus: <TimeKeeperPage />,
  Settings: <SettingsPage />,
};

async function toggleWidget() {
  // Delegated to Rust so it can apply all three NSWindowCollectionBehavior
  // flags (canJoinAllSpaces + stationary + fullScreenAuxiliary). Using the
  // JS Window API would only set canJoinAllSpaces and overwrite the rest.
  await invoke("toggle_widgets");
}

export default function AppShell({ pendingUrl, onUrlHandled }: AppShellProps) {
  const [activeTab, setActiveTab] = useState<Tab>(IS_IOS ? "Dashboard" : "Dashboard");
  const [showSessionSheet, setShowSessionSheet] = useState(false);

  // ── Deep link routing ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!pendingUrl) return;
    onUrlHandled(); // clear immediately so re-renders don't re-trigger

    try {
      const url = new URL(pendingUrl);
      const host = url.hostname; // "start" | "log-session"

      if (host === "start") {
        const task = decodeURIComponent(url.searchParams.get("task") ?? "").trim();
        const project = decodeURIComponent(url.searchParams.get("project") ?? "").trim();
        if (task) {
          startTimer({ taskName: task, project: project || undefined, billable: false, hourlyRate: 0 })
            .then(() => setActiveTab("Dashboard"))
            .catch((err) => console.error("deep-link startTimer failed:", err));
        } else {
          setActiveTab("Dashboard");
        }
      } else if (host === "log-session") {
        setShowSessionSheet(true);
      }
    } catch {
      // Malformed URL — ignore
    }
  }, [pendingUrl, onUrlHandled]);

  useEffect(() => {
    if (IS_IOS) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "w" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleWidget();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      {IS_IOS ? (
        /* Slim mobile header — no Nexus ecosystem icons, just the app name */
        <div style={{
          height: 44,
          display: "flex",
          alignItems: "center",
          paddingLeft: 16,
          paddingRight: 16,
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          flexShrink: 0,
        }}>
          <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: "-0.3px" }}>TimeTracker</span>
          <button
            onClick={() => setShowSessionSheet(true)}
            title="Log a past session"
            style={{
              marginLeft: "auto",
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              fontSize: 22,
              padding: "0 4px",
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            +
          </button>
        </div>
      ) : (
        <NexusHeader appName="TimeTracker" />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
          paddingLeft: 8,
          flexShrink: 0,
        }}
      >
        {TABS.map((tab) => (
          <NavTab
            key={tab}
            label={IS_IOS && tab === "Dashboard" ? "Timer" : tab}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}

        {!IS_IOS && (
          <div style={{ marginLeft: "auto", paddingRight: 10 }}>
            <button
              onClick={toggleWidget}
              title="Toggle floating widget (⌘W)"
              style={{
                background: "transparent",
                color: "var(--text-muted)",
                fontSize: 16,
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid transparent",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.borderColor = "transparent";
                (e.currentTarget as HTMLButtonElement).style.color = "var(--text-muted)";
              }}
            >
              ⏱
            </button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>{PAGE[activeTab]}</div>

      {showSessionSheet && (
        <QuickSessionSheet
          onClose={() => setShowSessionSheet(false)}
          onSaved={() => {
            setShowSessionSheet(false);
            // Switch to History so the user sees the new entry immediately
            setActiveTab("History");
          }}
        />
      )}
    </div>
  );
}
