import { NexusHeader, AppGridButton, useConnectedApps, useNexusRegistration } from "@nexus/core";

function App() {
  useNexusRegistration("Nexus", "0.1.0");
  const { apps, isNexusRunning, isLoading } = useConnectedApps();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <NexusHeader appName="Nexus" />
      <main className="flex-1 p-6">
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
      </main>
    </div>
  );
}

export default App;
