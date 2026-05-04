import { useState } from "react";
import { NexusHeader } from "@nexus/core";
import NavTab from "./NavTab";
import DashboardPage from "../../pages/DashboardPage";
import BiomarkersPage from "../../pages/BiomarkersPage";
import WorkoutsPage from "../../pages/WorkoutsPage";
import RunningPage from "../../pages/RunningPage";
import SettingsPage from "../../pages/SettingsPage";

const TABS = ["Dashboard", "Biomarkers", "Workouts", "Running", "Settings"] as const;
type Tab = (typeof TABS)[number];

function ActivePage({ tab }: { tab: Tab }) {
  switch (tab) {
    case "Dashboard":  return <DashboardPage />;
    case "Biomarkers": return <BiomarkersPage />;
    case "Workouts":   return <WorkoutsPage />;
    case "Running":    return <RunningPage />;
    case "Settings":   return <SettingsPage />;
  }
}

export default function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>("Dashboard");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <NexusHeader appName="Protocol" />
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
            label={tab}
            active={activeTab === tab}
            onClick={() => setActiveTab(tab)}
          />
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        <ActivePage tab={activeTab} />
      </div>
    </div>
  );
}
