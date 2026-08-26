// Visibility map for the Dashboard's blocks, edited from the Settings dialog's
// PathFinder-specific section.
//
// Same tiny-store shape as packages/nexus-core/src/settings.ts (getter/setter
// pair + subscribe, no React), but kept here rather than in nexus-core: which
// blocks a page has is PathFinder-specific, and nexus-core must stay
// app-agnostic. Namespaced `pf.dash.blocks` per the dotted localStorage
// convention nexus.settings.* uses.

export type DashBlockId = "welcome" | "now" | "tasks" | "study" | "habits" | "calendar";

export type DashBlockVisibility = Record<DashBlockId, boolean>;

const KEY = "pf.dash.blocks";

export const DASH_BLOCK_DEFAULTS: DashBlockVisibility = {
  welcome: true,
  now: true,
  tasks: true,
  study: true,
  habits: true,
  calendar: true,
};

export const DASH_BLOCK_LABELS: Record<DashBlockId, string> = {
  welcome: "Welcome header",
  now: "Now panel",
  tasks: "Tasks",
  study: "Study",
  habits: "Habits",
  calendar: "Day calendar",
};

export const DASH_BLOCK_IDS = Object.keys(DASH_BLOCK_DEFAULTS) as DashBlockId[];

export function getDashBlockVisibility(): DashBlockVisibility {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DASH_BLOCK_DEFAULTS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DASH_BLOCK_DEFAULTS };
    // Merge over defaults, not the other way round — a block added after a
    // client's localStorage was first written (an older stored object simply
    // lacks the key) should default to visible, not disappear.
    return { ...DASH_BLOCK_DEFAULTS, ...(parsed as Partial<DashBlockVisibility>) };
  } catch {
    return { ...DASH_BLOCK_DEFAULTS };
  }
}

type Listener = () => void;
const listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l();
}

export function setDashBlockVisible(id: DashBlockId, visible: boolean): void {
  const next = { ...getDashBlockVisibility(), [id]: visible };
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  emit();
}

/** Subscribes to both same-tab (emitter) and cross-tab (`storage` event) changes. */
export function subscribeDashBlocks(onChange: Listener): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) onChange();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
