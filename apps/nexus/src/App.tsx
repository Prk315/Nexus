import { useMemo } from "react";
import {
  NexusHeader, LifeBar, AgentBar, CalendarSidebar, WorkflowViewer,
  AppGridButton, AppGraph3D, useConnectedApps, useAgentBar, useCalendarSidebar,
  type GraphNode, type GraphEdge,
} from "@nexus/core";

// Known apps in the ecosystem — always shown in the graph.
const STATIC_NODES: GraphNode[] = [
  { id: "nexus",      label: "Nexus",      color: "#60a5fa" },
  { id: "vault",      label: "Vault",      color: "#a78bfa" },
  { id: "pathfinder", label: "PathFinder", color: "#34d399" },
];

// Known data flows between apps.
const STATIC_EDGES: GraphEdge[] = [
  { source: "nexus",      target: "vault",      color: "#3a4a5a" },
  { source: "nexus",      target: "pathfinder", color: "#3a4a5a" },
  { source: "vault",      target: "nexus",      color: "#3a4a5a" },
];

function App() {
  const { apps, isNexusRunning, isLoading } = useConnectedApps();
  const agent = useAgentBar();
  const calendar = useCalendarSidebar();

  const graphNodes = useMemo<GraphNode[]>(() => {
    const connectedIds = new Set(apps.map((a) => a.name.toLowerCase()));
    const staticIds = new Set(STATIC_NODES.map((n) => n.id));
    return [
      ...STATIC_NODES.map((n) => ({
        ...n,
        // Nexus itself is always active; others only when connected
        active: n.id === "nexus" ? isNexusRunning : connectedIds.has(n.id),
      })),
      ...apps
        .filter((a) => !staticIds.has(a.name.toLowerCase()))
        .map((a) => ({ id: a.name.toLowerCase(), label: a.name, active: true })),
    ];
  }, [apps, isNexusRunning]);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <NexusHeader appName="Nexus" onAgent={agent.open} onCalendar={calendar.toggle} />
      <AgentBar isOpen={agent.isOpen} onClose={agent.close} />
      <CalendarSidebar isOpen={calendar.isOpen} onClose={calendar.close} />
      <LifeBar birthDate="2003-06-05" />
      <main className="flex-1 p-6 flex flex-col gap-6">

        <div className="flex items-start gap-6">
          <WorkflowViewer className="h-[220px] w-[680px] shrink-0" />
          <AppGraph3D
            nodes={graphNodes}
            edges={STATIC_EDGES}
            title="App Ecosystem"
            className="h-[220px] w-[260px] shrink-0"
            autoRotate
          />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-4">
              <span className="text-sm font-medium text-muted-foreground">Connected Apps</span>
              <span className={`w-2 h-2 rounded-full ${isNexusRunning ? "bg-green-500" : "bg-muted"}`} />
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
          </div>
        </div>

      </main>
    </div>
  );
}

export default App;
