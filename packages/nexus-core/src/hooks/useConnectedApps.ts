import { useState, useEffect } from "react";
import { NexusClient } from "../client";
import type { ConnectedApp } from "../types";

interface UseConnectedAppsResult {
  apps: ConnectedApp[];
  isNexusRunning: boolean;
  isLoading: boolean;
}

/**
 * Polls the Nexus IPC server and returns the list of currently connected apps.
 * Any app with the submodule can use this to observe the live ecosystem.
 */
export function useConnectedApps(pollInterval = 3000): UseConnectedAppsResult {
  const [apps, setApps] = useState<ConnectedApp[]>([]);
  const [isNexusRunning, setIsNexusRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const client = new NexusClient("__observer__");

    const poll = async () => {
      const running = await client.isNexusRunning();
      setIsNexusRunning(running);
      if (running) {
        const connected = await client.getConnectedApps();
        setApps(connected);
      } else {
        setApps([]);
      }
      setIsLoading(false);
    };

    poll();
    const interval = setInterval(poll, pollInterval);
    return () => clearInterval(interval);
  }, [pollInterval]);

  return { apps, isNexusRunning, isLoading };
}
