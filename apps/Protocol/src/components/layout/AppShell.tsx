import { useState } from "react";
import { NexusHeader, useNexusAuth, createMailLoader, createMailRulesApi, createMailApi, createJobsApi } from "@nexus/core";
import { getSupabaseClient } from "../../lib/supabase";
import NavTab from "./NavTab";
import DashboardPage from "../../pages/DashboardPage";
import BiomarkersPage from "../../pages/BiomarkersPage";
import WorkoutsPage from "../../pages/WorkoutsPage";
import HabitsPage from "../../pages/HabitsPage";
import MealPlannerPage from "../../pages/MealPlannerPage";
import SettingsPage from "../../pages/SettingsPage";

// Authenticated client, module scope — see packages/nexus-core/src/mail/loader.ts.
const loadMail = createMailLoader(getSupabaseClient());
const mailRulesApi = createMailRulesApi(getSupabaseClient());
const mailApi = createMailApi(getSupabaseClient());
// Same client, same reason — the five `job_*` tables are owner-only with no
// anon policy, so this must be the authenticated one.
const jobsApi = createJobsApi(getSupabaseClient());

const TABS = ["Dashboard", "Biomarkers", "Workouts", "Habits", "Meal Planner", "Settings"] as const;
type Tab = (typeof TABS)[number];

function ActivePage({ tab }: { tab: Tab }) {
  switch (tab) {
    case "Dashboard":     return <DashboardPage />;
    case "Biomarkers":    return <BiomarkersPage />;
    case "Workouts":      return <WorkoutsPage />;
    case "Habits":        return <HabitsPage />;
    case "Meal Planner":  return <MealPlannerPage />;
    case "Settings":      return <SettingsPage />;
  }
}

function initialTab(): Tab {
  const params = new URLSearchParams(window.location.search);
  return params.has("oura") ? "Biomarkers" : "Dashboard";
}

export default function AppShell() {
  const [activeTab, setActiveTab] = useState<Tab>(initialTab);
  const { user, signOut } = useNexusAuth();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--bg)" }}>
      <NexusHeader
        appName="Protocol"
        onHome={() => setActiveTab("Dashboard")}
        userEmail={user?.email}
        onSignOut={() => signOut()}
        // Signed out the RLS read returns [], not an error — withhold the
        // loader so the button falls back rather than claiming "no mail".
        loadMail={user ? loadMail : undefined}
            mailRulesApi={user ? mailRulesApi : undefined}
            mailApi={user ? mailApi : undefined}
        // Withheld when signed out for the same reason, with one difference: the
        // Jobs button still renders and says "sign in", having no legacy
        // plain-button fallback to degrade to.
        jobsApi={user ? jobsApi : undefined}
      />
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
