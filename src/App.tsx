import { NexusHeader, LifeBar, AgentBar, CalendarSidebar, WorkflowViewer, AppGridButton, useConnectedApps, useAgentBar, useCalendarSidebar } from "@nexus/core";

function App() {
  const { apps, isNexusRunning, isLoading } = useConnectedApps();
  const agent = useAgentBar();
  const calendar = useCalendarSidebar();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <NexusHeader appName="Nexus" onAgent={agent.open} onCalendar={calendar.toggle} />
      <AgentBar isOpen={agent.isOpen} onClose={agent.close} />
      <CalendarSidebar isOpen={calendar.isOpen} onClose={calendar.close} />
      <LifeBar birthDate="2003-06-05" />
      <main className="flex-1 p-6">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-sm font-medium text-muted-foreground">Connected Apps</span>
          <span className={`w-2 h-2 rounded-full ${isNexusRunning ? "bg-green-500" : "bg-muted"}`} />
        </div>

        <div className="flex items-start gap-6">
          <WorkflowViewer className="h-[220px] w-[340px] shrink-0" />
        </div>

        {isLoading ? null : !isNexusRunning ? (
          <p className="text-sm text-muted-foreground">IPC server not reachable.</p>
        ) : apps.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No apps connected. Other apps call <code className="text-xs bg-muted px-1 py-0.5 rounded">nexus.register()</code> on startup to appear here.
          </p>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {apps.map((app) => (
              <AppGridButton key={app.id} name={app.name} onLaunch={() => {}} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
