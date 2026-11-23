import { useEffect, useSyncExternalStore } from "react";
import {
  getColorTheme,
  getTextScale,
  getTheme,
  getUiScale,
  setColorTheme as setColorThemeStore,
  setTextScale as setTextScaleStore,
  setTheme as setThemeStore,
  setUiScale as setUiScaleStore,
  subscribeSettings,
  TEXT_SCALE_DEFAULT,
  THEME_DEFAULT,
  UI_SCALE_DEFAULT,
} from "../settings";
import { COLOR_THEME_DEFAULT, COLOR_THEME_TOKENS, colorThemeTokens } from "../colorTheme";

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
 * sets `document.documentElement`'s `zoom` for the UI-scale slider, the
 * `--nexus-text-scale` variable for the text-size slider, and the colour
 * theme's token overrides (see colorTheme.ts).
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
  const textScale = useSyncExternalStore(subscribeSettings, getTextScale, () => TEXT_SCALE_DEFAULT);
  const colorTheme = useSyncExternalStore(subscribeSettings, getColorTheme, () => COLOR_THEME_DEFAULT);

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

  useEffect(() => {
    // Read by the app's own CSS (PathFinder's App.css multiplies every font
    // size by it). Harmless in an app that never reads it.
    document.documentElement.style.setProperty("--nexus-text-scale", String(textScale));
  }, [textScale]);

  useEffect(() => {
    // Inline custom properties on <html> outrank both `:root` and `.dark` in
    // the stylesheet, so a theme overrides whichever mode is active. It is
    // re-derived when the mode flips (`isDark` is a dependency) because the
    // light and dark versions of a theme differ in lightness. Neutral yields
    // null → every override is REMOVED, leaving the stylesheet exactly as
    // written — the default must be a no-op, not a copy of it.
    const root = document.documentElement;
    const tokens = colorThemeTokens(colorTheme, isDark);
    for (const name of COLOR_THEME_TOKENS) {
      const v = tokens?.[name];
      if (v) root.style.setProperty(name, v);
      else root.style.removeProperty(name);
    }
    root.dataset.colorTheme = colorTheme;
  }, [colorTheme, isDark]);

  return {
    theme,
    uiScale,
    textScale,
    colorTheme,
    isDark,
    setTheme: setThemeStore,
    setUiScale: setUiScaleStore,
    setTextScale: setTextScaleStore,
    setColorTheme: setColorThemeStore,
  };
}
