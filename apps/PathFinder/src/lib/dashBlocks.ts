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

function parseVisibility(raw: string | null): DashBlockVisibility {
  if (!raw) return { ...DASH_BLOCK_DEFAULTS };
  try {
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

// ⚠️ The snapshot MUST be referentially stable while the stored value is
// unchanged. This is a `useSyncExternalStore` getSnapshot (App.tsx and
// Dashboard.tsx), and React compares consecutive snapshots with `Object.is`:
// returning a freshly-spread object every call means every commit sees a
// "changed" store, forces another render, and the tree loops until React
// throws "Maximum update depth exceeded" — which is a WHITE SCREEN, not a
// degraded panel. That shipped to production in PR #132 and took PathFinder's
// dashboard down entirely.
//
// So parse at most once per distinct raw string and hand back the same object
// afterwards. The raw string is the cache key rather than a dirty flag because
// the `storage` event (another tab) mutates localStorage without going through
// setDashBlockVisible.
let cachedRaw: string | null = null;
let cached: DashBlockVisibility | null = null;

export function getDashBlockVisibility(): DashBlockVisibility {
  let raw: string | null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    // localStorage can throw in private-browsing / restricted contexts. Treat
    // it as "unset" — and keep it cached, so the throwing path is stable too.
    raw = null;
  }
  if (cached !== null && raw === cachedRaw) return cached;
  cachedRaw = raw;
  cached = parseVisibility(raw);
  return cached;
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

// ── Layout: which column each block sits in, and in what order ──────────────
//
// Stored separately (`pf.dash.layout`) from visibility so neither write can
// clobber the other, and so a client that predates the layout keeps its
// visibility untouched. `welcome` is not in the layout: it is the full-width
// header above both columns, and there is nowhere else on the page it fits.
//
// The rail is `hidden md:flex` — on a phone nothing in it shows. That was
// already true of Habits and the Day calendar, and it is the honest cost of
// moving a block there; the Settings list says "Side rail (desktop)".

export type DashRegion = "main" | "rail";
export type DashLayoutBlockId = Exclude<DashBlockId, "welcome">;
export interface DashLayout {
  main: DashLayoutBlockId[];
  rail: DashLayoutBlockId[];
}

const LAYOUT_KEY = "pf.dash.layout";

export const DASH_LAYOUT_DEFAULT: DashLayout = {
  main: ["now", "tasks", "study"],
  rail: ["habits", "calendar"],
};

const LAYOUT_IDS: DashLayoutBlockId[] = [...DASH_LAYOUT_DEFAULT.main, ...DASH_LAYOUT_DEFAULT.rail];
const isLayoutId = (v: unknown): v is DashLayoutBlockId =>
  typeof v === "string" && (LAYOUT_IDS as string[]).includes(v);

/**
 * Coerces anything — a stored blob from an older or newer build, a hand edit —
 * into a layout where every block appears EXACTLY ONCE. Unknown ids and
 * duplicates are dropped (first occurrence wins, main before rail); a block
 * missing from the stored value (added after it was written) goes to its
 * default column, at the end. Never throws. A block that vanished from the
 * layout would be unreachable from Settings — it could not even be re-shown.
 */
export function normalizeDashLayout(raw: unknown): DashLayout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const seen = new Set<DashLayoutBlockId>();
  const take = (v: unknown): DashLayoutBlockId[] => {
    if (!Array.isArray(v)) return [];
    const out: DashLayoutBlockId[] = [];
    for (const id of v) {
      if (isLayoutId(id) && !seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out;
  };
  const main = take(o.main);
  const rail = take(o.rail);
  for (const id of DASH_LAYOUT_DEFAULT.main) if (!seen.has(id)) main.push(id);
  for (const id of DASH_LAYOUT_DEFAULT.rail) if (!seen.has(id)) rail.push(id);
  return { main, rail };
}

/**
 * Moves `id` into `region` at insertion slot `index` (clamped). Pure — the
 * Settings list's grip drag and its "move to rail/main" button both land
 * here, so there is one definition of what a move does.
 */
export function moveDashBlock(layout: DashLayout, id: DashLayoutBlockId, region: DashRegion, index: number): DashLayout {
  const main = layout.main.filter((x) => x !== id);
  const rail = layout.rail.filter((x) => x !== id);
  const target = region === "main" ? main : rail;
  const at = Math.max(0, Math.min(target.length, Math.floor(index)));
  target.splice(at, 0, id);
  return { main, rail };
}

/** Which column a block currently sits in. */
export function regionOf(layout: DashLayout, id: DashLayoutBlockId): DashRegion {
  return layout.rail.includes(id) ? "rail" : "main";
}

// Same referential-stability rule as getDashBlockVisibility above — this is a
// useSyncExternalStore snapshot too, and a fresh object per call is the #136
// white screen.
let cachedLayoutRaw: string | null = null;
let cachedLayout: DashLayout | null = null;

export function getDashLayout(): DashLayout {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LAYOUT_KEY);
  } catch {
    raw = null;
  }
  if (cachedLayout !== null && raw === cachedLayoutRaw) return cachedLayout;
  cachedLayoutRaw = raw;
  let parsed: unknown = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = null; }
  cachedLayout = normalizeDashLayout(parsed);
  return cachedLayout;
}

export function setDashLayout(layout: DashLayout): void {
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(normalizeDashLayout(layout))); } catch { /* ignore */ }
  emit();
}

export function resetDashLayout(): void {
  try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ }
  emit();
}

/** Subscribes to both same-tab (emitter) and cross-tab (`storage` event)
 *  changes — of visibility AND layout; both live behind one subscription so a
 *  page reading either repaints on either. */
export function subscribeDashBlocks(onChange: Listener): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === LAYOUT_KEY || e.key === null) onChange();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
