import { useEffect } from "react";
import { NexusClient } from "../client";

/**
 * Registers this app with the Nexus IPC server on mount and
 * unregisters it on unmount. Drop this into any app's root component.
 *
 * Usage:
 *   useNexusRegistration("Vault", "0.1.0");
 */
export function useNexusRegistration(appName: string, appVersion = "0.1.0") {
  useEffect(() => {
    const client = new NexusClient(appName, appVersion);

    client.register().catch((e) => {
      console.warn(`[nexus-core] Failed to register "${appName}" with Nexus:`, e);
    });

    return () => {
      client.unregister().catch(() => {});
    };
  }, [appName, appVersion]);
}
