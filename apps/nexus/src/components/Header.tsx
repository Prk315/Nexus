import { useEffect, useState } from "react";
import { LayoutGrid } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type App, getApps, updateLastLaunched } from "@/lib/db";

async function launchApp(app: App) {
  try {
    await invoke("launch_app", { path: app.path });
    await updateLastLaunched(app.id);
  } catch (e) {
    console.error(e);
  }
}

export function Header() {
  const [apps, setApps] = useState<App[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApps().then(setApps).catch((e) => {
      console.error(e);
      setError(String(e));
    });
  }, []);

  return (
    <header className="h-12 border-b border-border bg-background flex items-center px-4">
      <span className="text-sm font-medium">Nexus</span>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <LayoutGrid className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {error ? (
              <DropdownMenuItem disabled className="text-red-500 max-w-xs whitespace-normal">{error}</DropdownMenuItem>
            ) : apps.length === 0 ? (
              <DropdownMenuItem disabled>No apps registered</DropdownMenuItem>
            ) : (
              apps.map((app) => (
                <DropdownMenuItem key={app.id} onSelect={() => launchApp(app)}>
                  {app.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
