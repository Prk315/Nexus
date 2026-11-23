// Cross-app appearance settings — theme, colour theme, UI scale, text size.
//
// React-free by design (same shape as coverage.ts): the store itself has no
// framework dependency, so it can be unit-tested without a DOM and imported
// from anywhere. `hooks/useAppearance.ts` is the thin React wrapper that
// subscribes via useSyncExternalStore and applies the result to the DOM.
//
// Every app shares the same localStorage keys under the `nexus.settings.`
// namespace (the dotted convention this ecosystem standardizes on), so
// switching between PathFinder, Vault, etc. doesn't reset your theme.

import { COLOR_THEME_DEFAULT, isColorThemeId, type ColorThemeId } from "./colorTheme";

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "nexus.settings.theme";
const UI_SCALE_KEY = "nexus.settings.uiScale";
const TEXT_SCALE_KEY = "nexus.settings.textScale";
const COLOR_THEME_KEY = "nexus.settings.colorTheme";
const KEYS = new Set([THEME_KEY, UI_SCALE_KEY, TEXT_SCALE_KEY, COLOR_THEME_KEY]);

export const THEME_DEFAULT: Theme = "system";
export const UI_SCALE_MIN = 0.8;
export const UI_SCALE_MAX = 1.3;
export const UI_SCALE_DEFAULT = 1;

// Text size is separate from UI scale on purpose: UI scale zooms EVERYTHING
// (padding, icons, the calendar grid), which is what you want on a big screen
// and exactly what you don't when only the type is too small to read. Text
// size scales font sizes alone. It only does anything in an app whose CSS
// reads `--nexus-text-scale` (PathFinder's App.css does) — which is why the
// Settings dialog shows the slider only when the app opts in.
export const TEXT_SCALE_MIN = 0.85;
export const TEXT_SCALE_MAX = 1.4;
export const TEXT_SCALE_DEFAULT = 1;

function isTheme(v: unknown): v is Theme {
  return v === "light" || v === "dark" || v === "system";
}

/** Clamps to the supported UI-scale range, falling back to 1 for junk input. */
export function clampUiScale(v: number): number {
  if (!Number.isFinite(v)) return UI_SCALE_DEFAULT;
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v));
}

/** Clamps to the supported text-size range, falling back to 1 for junk input. */
export function clampTextScale(v: number): number {
  if (!Number.isFinite(v)) return TEXT_SCALE_DEFAULT;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, v));
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

export function getTextScale(): number {
  try {
    const raw = localStorage.getItem(TEXT_SCALE_KEY);
    const n = raw == null ? NaN : Number(raw);
    return Number.isFinite(n) ? clampTextScale(n) : TEXT_SCALE_DEFAULT;
  } catch {
    return TEXT_SCALE_DEFAULT;
  }
}

// Returns a string — a primitive, so consecutive useSyncExternalStore
// snapshots compare equal by value. (An object here would need the same
// raw-string cache PathFinder's dashBlocks.ts carries; see #136.)
export function getColorTheme(): ColorThemeId {
  try {
    const raw = localStorage.getItem(COLOR_THEME_KEY);
    return isColorThemeId(raw) ? raw : COLOR_THEME_DEFAULT;
  } catch {
    return COLOR_THEME_DEFAULT;
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

export function setTextScale(scale: number): void {
  try { localStorage.setItem(TEXT_SCALE_KEY, String(clampTextScale(scale))); } catch { /* ignore */ }
  emit();
}

export function setColorTheme(id: ColorThemeId): void {
  try { localStorage.setItem(COLOR_THEME_KEY, id); } catch { /* ignore */ }
  emit();
}

/** Subscribes to both same-tab (emitter) and cross-tab (`storage` event) changes. */
export function subscribeSettings(onChange: Listener): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || KEYS.has(e.key)) onChange();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}
