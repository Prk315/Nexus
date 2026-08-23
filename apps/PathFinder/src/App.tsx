import { useState } from "react";
import { useNexusRegistration, NexusHeader, useNexusAuth } from "@nexus/core";
import { ymd } from "@nexus/core/coverage";
import { loadScreenSpansForDate } from "./lib/actual";
import "./App.css";
import { Sidebar, type Page } from "./components/Sidebar";
import { SchedulesProvider } from "./contexts/SchedulesContext";
import { BottomNav } from "./components/BottomNav";
import { Dashboard } from "./pages/Dashboard";
import { Week } from "./pages/Week";
import { Courses } from "./pages/Courses";
import { Projects } from "./pages/Projects";
import { Games } from "./pages/Games";
import { Schedules } from "./pages/Schedules";
import { Workspace } from "./pages/Workspace";
import { CommandPalette } from "./components/CommandPalette";
import { QuickPanelsProvider } from "./components/QuickPanels";
import { convertMailToTask } from "./lib/api";
import type { ConvertibleMail } from "./lib/mailConvert";
import { queryClient, qk } from "./lib/queryClient";

const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent);

/**
 * The one-click "make this mail a task" action the header's `MailPanel` calls.
 *
 * PathFinder owns it, not nexus-core: `MailPanel` is presentational and receives
 * injected callbacks, exactly like `loadMail` and `loadScreenSpans`. The mapping
 * knows about `pf_tasks`, its ISA subtypes and the discriminator trap, none of
 * which belong in a package that Vault and Protocol also render.
 *
 * Resolves to `void` — the panel only needs to know it worked, and a rejection
 * carries the message the user has to see (notably the "task created but not
 * linked" case, where converting again would duplicate).
 */
async function handleConvertMail(m: ConvertibleMail): Promise<void> {
  await convertMailToTask(m);
  // The draft lands in `refine`; invalidate so the workspace shows it without
  // waiting out the 30s staleTime or a manual reload.
  await queryClient.invalidateQueries({ queryKey: qk.tasks });
}

/**
 * ⚠️ TEMPORARY, AND CURRENTLY INERT. Passed by spread rather than as a plain
 * JSX attribute because `NexusHeaderProps` has no `onConvertToTask` — not on
 * `main`, and not on the mail-header branch (PR #118) either, whose `MailPanel`
 * still destructures `({ loadMail })` only. A JSX spread of a variable skips
 * excess-property checking, where a literal attribute would not compile.
 *
 * So nothing calls this today: `NexusHeader` destructures a fixed prop list and
 * silently drops the unknown key. Nothing in the toolchain will report that —
 * `handleConvertMail` *is* referenced, so it is not dead code to tsc.
 *
 * The moment nexus-core's `MailPanel` accepts
 * `onConvertToTask?: (m: MailMessage) => Promise<void>` and `NexusHeader`
 * forwards it, delete this object and pass the handler directly, so that a
 * signature change becomes a compile error again. The contravariance works out:
 * `MailMessage` is a superset of `ConvertibleMail`, so a handler taking the
 * narrower type is assignable where the wider one is expected.
 */
const mailConvertProps = { onConvertToTask: handleConvertMail };

function App() {
  useNexusRegistration("PathFinder");
  const { user, signOut } = useNexusAuth();
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <QuickPanelsProvider>
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <CommandPalette onNavigate={setPage} />
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
            loadScreenSpans={() => loadScreenSpansForDate(ymd(new Date()))}
            {...mailConvertProps}
          />
        )}

        <SchedulesProvider>
        <main className={`flex-1 overflow-y-auto${IS_IOS ? " pb-24" : ""}`}>
          {page === "dashboard" && <Dashboard />}
          {page === "workspace" && <Workspace />}
          {page === "week"      && <Week />}
          {page === "projects"  && <Projects />}
          {page === "courses"   && <Courses />}
          {page === "schedules" && <Schedules />}
          {page === "games"     && <Games />}
        </main>
        </SchedulesProvider>
      </div>

      {IS_IOS && <BottomNav currentPage={page} onNavigate={setPage} />}
    </div>
    </QuickPanelsProvider>
  );
}

export default App;
