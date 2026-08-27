// Cross-app appearance settings — theme and UI scale.
//
// React-free by design (same shape as coverage.ts): the store itself has no
// framework dependency, so it can be unit-tested without a DOM and imported
// from anywhere. `hooks/useAppearance.ts` is the thin React wrapper that
// subscribes via useSyncExternalStore and applies the result to the DOM.
//
// Every app shares the same localStorage keys under the `nexus.settings.`
// namespace (the dotted convention this ecosystem standardizes on), so
// switching between PathFinder, Vault, etc. doesn't reset your theme.

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "nexus.settings.theme";
const UI_SCALE_KEY = "nexus.settings.uiScale";

export const THEME_DEFAULT: Theme = "system";
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.3;
export const UI_SCALE_DEFAULT = 1;

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

/** Clamps to the supported UI-scale range, falling back to 1 for junk input. */
export function clampUiScale(v: number): number {
  if (!Number.isFinite(v)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v));
}

export function getTheme(): Theme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    return isTheme(raw) ? raw : THEME_DEFAULT;
  } catch {
    // localStorage can throw in private-browsing / restricted contexts.
    return THEME_DEFAULT;
  }
}

export function getUiScale(): number {
  try {
    const raw = localStorage.getItem(UI_SCALE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampUiScale(n) : UI_SCALE_DEFAULT;
  } catch {
    return UI_SCALE_DEFAULT;
  }
}

// Local emitter for same-tab updates. The browser's `storage` event only
// fires in OTHER documents than the one that made the write — a
// useSyncExternalStore subscriber in this same tab would otherwise never
// re-render when the settings dialog sitting right next to it changes a
// value, since the write happens in the same document.
type Listener = () => void;
const listeners = new Set<Listener>();
function emit() {
  for (const l of listeners) l();
}

export function setTheme(theme: Theme): void {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* ignore */ }
  emit();
}

export function setUiScale(scale: number): void {
  try { localStorage.setItem(UI_SCALE_KEY, String(clampUiScale(scale))); } catch { /* ignore */ }
  emit();
}

/** Subscribes to both same-tab (emitter) and cross-tab (`storage` event) changes. */
export function subscribeSettings(onChange: Listener): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY || e.key === UI_SCALE_KEY || e.key === null) onChange();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
