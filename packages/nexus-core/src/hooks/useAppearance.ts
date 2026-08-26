import { useEffect, useSyncExternalStore } from "react";
import {
  getTheme,
  getUiScale,
  setTheme as setThemeStore,
  setUiScale as setUiScaleStore,
  subscribeSettings,
  THEME_DEFAULT,
  UI_SCALE_DEFAULT,
} from "../settings";

function getSystemDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function subscribeSystemDark(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  // Safari < 14 only has the deprecated addListener/removeListener pair, but
  // every WebView this ecosystem targets (Tauri's WKWebView, current Chrome)
  // supports addEventListener — no fallback needed here.
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/**
 * Subscribes to the shared appearance settings and applies them to the DOM:
 * toggles the `.dark` class `App.css`'s `@custom-variant dark` depends on, and
 * sets `document.documentElement`'s `zoom` for the UI-scale slider.
 *
 * Call this once, from the app's root component — the header never applies
 * appearance itself, it only opens the dialog that edits it. "system" tracks
 * `prefers-color-scheme` live, so flipping the OS theme repaints without a
 * reload.
 */
export function useNexusAppearance() {
  const theme = useSyncExternalStore(subscribeSettings, getTheme, () => THEME_DEFAULT);
  const uiScale = useSyncExternalStore(subscribeSettings, getUiScale, () => UI_SCALE_DEFAULT);
  const systemDark = useSyncExternalStore(subscribeSystemDark, getSystemDark, () => false);

  const isDark = theme === "dark" || (theme === "system" && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDark);
  }, [isDark]);

  useEffect(() => {
    // `zoom` is a non-standard CSS property (no dedicated CSSStyleDeclaration
    // member in every TS lib target), so it's set via setProperty rather than
    // `.style.zoom = …`. It scales rendered px uniformly, which is what this
    // app needs — most sizes here are hard px (`text-[10px]`), so a root
    // font-size trick wouldn't reach them.
    document.documentElement.style.setProperty("zoom", String(uiScale));
  }, [uiScale]);

  return {
    theme,
    uiScale,
    isDark,
    setTheme: setThemeStore,
    setUiScale: setUiScaleStore,
  };
}
