import { useState } from "react";
import { useNexusRegistration, NexusHeader, useNexusAuth } from "@nexus/core";
import "./App.css";
import { Sidebar, type Page } from "./components/Sidebar";
import { SchedulesProvider } from "./contexts/SchedulesContext";
import { BottomNav } from "./components/BottomNav";
import { Dashboard } from "./pages/Dashboard";
import { GoalHub } from "./pages/GoalHub";
import { Systems } from "./pages/Systems";
import { Week } from "./pages/Week";
import { Courses } from "./pages/Courses";
import { Projects } from "./pages/Projects";
import { Games } from "./pages/Games";
import { Schedules } from "./pages/Schedules";
import { Backlog } from "./pages/Backlog";
import { Planner } from "./pages/Planner";

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

function App() {
  useNexusRegistration("PathFinder");
  const { user, signOut } = useNexusAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      {!IS_IOS && (
        <Sidebar
          current={page}
          onChange={setPage}
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((c) => !c)}
        />
      )}

      <div className="flex flex-col flex-1 min-w-0">
        {IS_IOS ? (
          <div className="h-11 flex items-center px-4 border-b border-border bg-background/95 shrink-0">
            <span className="text-sm font-semibold">PathFinder</span>
          </div>
        ) : (
          <NexusHeader
            appName="PathFinder"
            onHome={() => setPage("dashboard")}
            userEmail={user?.email}
            onSignOut={() => signOut()}
          />
        )}

        <SchedulesProvider>
        <main className={`flex-1 overflow-y-auto${IS_IOS ? " pb-24" : ""}`}>
          {page === "dashboard" && <Dashboard />}
          {page === "week"      && <Week />}
          {page === "goals"     && <GoalHub />}
          {page === "systems"   && <Systems />}
          {page === "projects"  && <Projects />}
          {page === "courses"   && <Courses />}
          {page === "schedules" && <Schedules />}
          {page === "games"     && <Games />}
          {page === "backlog"   && <Backlog />}
          {page === "planner"   && <Planner />}
        </main>
        </SchedulesProvider>
      </div>

      {IS_IOS && <BottomNav currentPage={page} onNavigate={setPage} />}
    </div>
  );
}

export default App;
