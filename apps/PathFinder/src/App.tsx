import { useState, useSyncExternalStore } from "react";
import { useNexusRegistration, NexusHeader, useNexusAuth, useNexusAppearance, SettingsDialog, createMailLoader, createMailRulesApi } from "@nexus/core";
import { ymd } from "@nexus/core/coverage";
import { loadScreenSpansForDate } from "./lib/actual";
import { supabase } from "./lib/supabase";
import {
  DASH_BLOCK_IDS,
  DASH_BLOCK_LABELS,
  getDashBlockVisibility,
  setDashBlockVisible,
  subscribeDashBlocks,
  type DashBlockId,
} from "./lib/dashBlocks";
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
import { Team } from "./pages/Team";
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
 *
 * Note the prop is `onConvertMailToTask` on `NexusHeader` but `onConvertToTask`
 * on `MailPanel` — the header disambiguates because it carries several `on*`
 * handlers. Pass it as a plain attribute and never through a spread: the header
 * destructures a fixed prop list, so a spread of a misspelled key is dropped in
 * silence and the button renders but does nothing.
 */
async function handleConvertMail(m: ConvertibleMail): Promise<void> {
  await convertMailToTask(m);
  // The draft lands in `refine`; invalidate so the workspace shows it without
  // waiting out the 30s staleTime or a manual reload.
  await queryClient.invalidateQueries({ queryKey: qk.tasks });
}
// Authenticated client, module scope — see packages/nexus-core/src/mail/loader.ts.
const loadMail = createMailLoader(supabase);
const mailRulesApi = createMailRulesApi(supabase);

/**
 * The Dashboard-blocks checkboxes shown inside the shared Settings dialog.
 *
 * Lives here, not in nexus-core: nexus-core has no notion of a "Dashboard" or
 * what's on it. `dashBlocks.ts` is the same getter/setter/subscribe shape as
 * nexus-core's own `settings.ts`, just scoped to PathFinder's localStorage
 * namespace (`pf.dash.blocks`) instead of the shared `nexus.settings.` one.
 */
function DashboardBlocksSection() {
  const visibility = useSyncExternalStore(subscribeDashBlocks, getDashBlockVisibility);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
        Dashboard blocks
      </h3>
      <div className="flex flex-col gap-1.5">
        {DASH_BLOCK_IDS.map((id: DashBlockId) => (
          <label key={id} className="flex items-center gap-2 text-sm text-foreground cursor-pointer select-none">
            <input
              type="checkbox"
              checked={visibility[id]}
              onChange={(e) => setDashBlockVisible(id, e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input accent-primary"
            />
            {DASH_BLOCK_LABELS[id]}
          </label>
        ))}
      </div>
    </div>
  );
}

function App() {
  useNexusRegistration("PathFinder");
  const { user, signOut } = useNexusAuth();
  // Applies theme (.dark class) + UI scale (root zoom) — the header only
  // opens the dialog that edits these, it never applies appearance itself.
  useNexusAppearance();
  const [page, setPage] = useState<Page>("dashboard");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

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
            onSettings={() => setSettingsOpen(true)}
            loadScreenSpans={() => loadScreenSpansForDate(ymd(new Date()))}
            onConvertMailToTask={handleConvertMail}
            // Signed out the RLS read returns [], not an error — withhold the
            // loader so the button falls back rather than claiming "no mail".
            loadMail={user ? loadMail : undefined}
            mailRulesApi={user ? mailRulesApi : undefined}
          />
        )}

        <SchedulesProvider>
        <main className={`flex-1 overflow-y-auto${IS_IOS ? " pb-24" : ""}`}>
          {page === "dashboard" && <Dashboard />}
          {page === "workspace" && <Workspace />}
          {page === "week"      && <Week />}
          {page === "team"      && <Team />}
          {page === "projects"  && <Projects />}
          {page === "courses"   && <Courses />}
          {page === "schedules" && <Schedules />}
          {page === "games"     && <Games />}
        </main>
        </SchedulesProvider>
      </div>

      {IS_IOS && <BottomNav currentPage={page} onNavigate={setPage} />}

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        sections={<DashboardBlocksSection />}
      />
    </div>
    </QuickPanelsProvider>
  );
}

export default App;
