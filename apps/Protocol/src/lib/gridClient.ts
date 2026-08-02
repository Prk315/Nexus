// Client for the Nexus Local "grid" — the local background node that runs
// capabilities the browser can't (e.g. the Garmin bridge). Web builds can't call
// Tauri `invoke`, so instead we enqueue a command into `nexus_local_commands`,
// a running node claims + executes it, and we poll the row for the result.
//
// See apps/NexusLocal for the node runtime.
import { getSupabaseClient } from "./supabase";

const NODES_TABLE = "nexus_local_nodes";
const COMMANDS_TABLE = "nexus_local_commands";
const NODE_FRESH_MS = 30_000; // a node heartbeats every ~10s

/** True when running inside the Tauri desktop shell (has native `invoke`). */
export function isDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

interface NodeRow {
  device_id: string;
  last_seen: string;
  modules: Array<{ id: string }> | null;
}

/** Is there a live node (optionally one with `module` installed)? */
export async function isNodeOnline(module?: string): Promise<boolean> {
  const sb = getSupabaseClient();
  const { data, error } = await sb
    .from(NODES_TABLE)
    .select("device_id,last_seen,modules")
    .order("last_seen", { ascending: false })
    .limit(10);
  if (error || !data) return false;
  const now = Date.now();
  return (data as NodeRow[]).some((n) => {
    if (now - new Date(n.last_seen).getTime() >= NODE_FRESH_MS) return false;
    if (!module) return true;
    return (n.modules ?? []).some((m) => m.id === module);
  });
}

interface GridRunOptions {
  timeoutMs?: number;
  pollMs?: number;
}

/**
 * Enqueue a command, wait for a node to run it, return its JSON result.
 * Throws if enqueue fails, the command errors, or no node responds in time.
 */
export async function runViaGrid<T>(
  module: string,
  action: string,
  payload: Record<string, unknown> = {},
  opts: GridRunOptions = {},
): Promise<T> {
  const sb = getSupabaseClient();
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const pollMs = opts.pollMs ?? 1500;

  const { data: inserted, error: insErr } = await sb
    .from(COMMANDS_TABLE)
    .insert({ module, action, payload })
    .select("id")
    .single();
  if (insErr || !inserted) {
    throw new Error(`Failed to enqueue ${module}.${action}: ${insErr?.message ?? "unknown error"}`);
  }

  const id = (inserted as { id: string }).id;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const { data, error } = await sb
      .from(COMMANDS_TABLE)
      .select("status,result,error")
      .eq("id", id)
      .single();
    if (error || !data) continue;
    const row = data as { status: string; result: T; error: string | null };
    if (row.status === "done") return row.result;
    if (row.status === "error") throw new Error(row.error ?? `${module}.${action} failed`);
  }
  throw new Error("No Nexus Local node responded — make sure it's running on a machine that's online.");
}
