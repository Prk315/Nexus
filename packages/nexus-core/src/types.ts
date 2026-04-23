// ── Agent types ───────────────────────────────────────────────────────────────

export interface AgentConversation {
  id: string;
  query: string;
  response?: string;
  timestamp: string; // ISO string
}

export interface AgentTool {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
}

// ── n8n Workflow types ────────────────────────────────────────────────────────

export interface N8nNode {
  id?: string;
  name: string;
  type: string;
  position: [number, number];
  parameters?: Record<string, unknown>;
  disabled?: boolean;
}

export interface N8nConnection {
  node: string;
  type: string;
  index: number;
}

export interface N8nWorkflow {
  name?: string;
  nodes: N8nNode[];
  connections: Record<string, { main: N8nConnection[][] }>;
}

// ── Calendar types ────────────────────────────────────────────────────────────

export interface CalendarEvent {
  id: string;
  title: string;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  color?: string;
}

export interface AgentProject {
  id: string;
  name: string;
  lastActive?: string; // ISO string
}

// ── IPC / Nexus types ─────────────────────────────────────────────────────────

// The port Nexus runs its IPC server on — shared constant across all apps
export const NEXUS_IPC_PORT = 1430;

// An app currently connected to the Nexus IPC server
export interface ConnectedApp {
  id: string;
  name: string;
  version: string;
  registeredAt: string;
}

export interface RegisterRequest {
  name: string;
  version: string;
}

export interface RegisterResponse {
  id: string;
}

// Represents a registered application in the Nexus launcher
export interface App {
  id: number;
  name: string;
  path: string;
  icon: string | null;
  last_launched: string | null;
}

// Payload sent when requesting an app launch
export interface LaunchRequest {
  app_id: number;
  args?: string[];
}

// Result returned after a launch attempt
export interface LaunchResult {
  success: boolean;
  message?: string;
}

// Generic IPC message envelope for cross-app communication
export interface IpcMessage<T = unknown> {
  type: string;
  payload: T;
  timestamp: string;
}
