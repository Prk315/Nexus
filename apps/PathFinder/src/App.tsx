import { useState } from "react";
import { useNexusRegistration, NexusHeader } from "@nexus/core";
import "./App.css";
import { Sidebar, type Page } from "./components/Sidebar";
import { BottomNav } from "./components/BottomNav";
import { Dashboard } from "./pages/Dashboard";
import { Goals } from "./pages/Goals";
import { Plans } from "./pages/Plans";
import { Tasks } from "./pages/Tasks";
import { Systems } from "./pages/Systems";
import { Week } from "./pages/Week";
import { Courses } from "./pages/Courses";
import { Lifestyle } from "./pages/Lifestyle";
import { Projects } from "./pages/Projects";
import { Games } from "./pages/Games";

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

function App() {
  useNexusRegistration("PathFinder");
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
          <NexusHeader appName="PathFinder" onHome={() => setPage("dashboard")} />
        )}

        <main className={`flex-1 overflow-y-auto${IS_IOS ? " pb-24" : ""}`}>
          {page === "dashboard" && <Dashboard />}
          {page === "week"      && <Week />}
          {page === "goals"     && <Goals />}
          {page === "plans"     && <Plans />}
          {page === "tasks"     && <Tasks />}
          {page === "systems"   && <Systems />}
          {page === "projects"  && <Projects />}
          {page === "lifestyle" && <Lifestyle />}
          {page === "courses"   && <Courses />}
          {page === "games"     && <Games />}
        </main>
      </div>

      {IS_IOS && <BottomNav currentPage={page} onNavigate={setPage} />}
    </div>
  );
}

export default App;
