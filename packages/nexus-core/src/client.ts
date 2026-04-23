import { NEXUS_IPC_PORT } from "./types";
import type { ConnectedApp, RegisterResponse } from "./types";

/**
 * Client SDK for connecting an app to the Nexus IPC server.
 * Every app in the ecosystem uses this to register itself and
 * discover other running apps.
 *
 * Usage:
 *   const nexus = new NexusClient("MyApp");
 *   await nexus.register();
 *   // on app close:
 *   await nexus.unregister();
 */
export class NexusClient {
  private readonly baseUrl: string;
  private readonly appName: string;
  private readonly appVersion: string;
  private appId: string | null = null;

  constructor(appName: string, appVersion = "0.1.0", port = NEXUS_IPC_PORT) {
    this.appName = appName;
    this.appVersion = appVersion;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  /** Returns true if the Nexus IPC server is reachable */
  async isNexusRunning(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Register this app with Nexus. Call on app startup. */
  async register(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: this.appName, version: this.appVersion }),
    });
    if (!res.ok) throw new Error(`Nexus register failed: ${res.status}`);
    const data: RegisterResponse = await res.json();
    this.appId = data.id;
  }

  /** Deregister this app from Nexus. Call on app close. */
  async unregister(): Promise<void> {
    if (!this.appId) return;
    await fetch(`${this.baseUrl}/unregister/${this.appId}`, { method: "DELETE" });
    this.appId = null;
  }

  /** Returns all apps currently connected to Nexus */
  async getConnectedApps(): Promise<ConnectedApp[]> {
    const res = await fetch(`${this.baseUrl}/apps`);
    if (!res.ok) throw new Error(`Nexus getConnectedApps failed: ${res.status}`);
    return res.json();
  }

  get id() {
    return this.appId;
  }
}
