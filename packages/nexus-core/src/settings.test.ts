import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { clampUiScale, getTheme, getUiScale, setTheme, setUiScale, THEME_DEFAULT, UI_SCALE_DEFAULT, UI_SCALE_MIN, UI_SCALE_MAX } from "./settings";

// vitest's default environment is Node, which has no `localStorage` global
// (unlike a browser or the Tauri WebView this actually runs in) — polyfill a
// minimal synchronous Storage so these tests exercise the real getters and
// setters instead of mocking them out. Guarded so it's a no-op if a future
// jsdom/happy-dom environment already provides one.
beforeAll(() => {
  if (typeof (globalThis as unknown as { localStorage?: unknown }).localStorage === "undefined") {
    const store = new Map<string, string>();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    } as Storage;
  }
});

describe("clampUiScale", () => {
  it("passes through values already in range", () => {
    expect(clampUiScale(1)).toBe(1);
    expect(clampUiScale(1.15)).toBe(1.15);
  });
  it("clamps below the floor", () => {
    expect(clampUiScale(0.1)).toBe(UI_SCALE_MIN);
  });
  it("clamps above the ceiling", () => {
    expect(clampUiScale(5)).toBe(UI_SCALE_MAX);
  });
  it("falls back to the default for non-finite input", () => {
    expect(clampUiScale(NaN)).toBe(UI_SCALE_DEFAULT);
    expect(clampUiScale(Infinity)).toBe(UI_SCALE_DEFAULT);
  });
});

describe("theme / uiScale store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults to system theme and 1x scale when unset", () => {
    expect(getTheme()).toBe(THEME_DEFAULT);
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
  });

  it("round-trips a valid theme", () => {
    setTheme("dark");
    expect(getTheme()).toBe("dark");
  });

  it("ignores a corrupt stored theme and falls back to default", () => {
    localStorage.setItem("nexus.settings.theme", "not-a-theme");
    expect(getTheme()).toBe(THEME_DEFAULT);
  });

  it("round-trips and clamps uiScale", () => {
    setUiScale(1.2);
    expect(getUiScale()).toBe(1.2);
    setUiScale(9);
    expect(getUiScale()).toBe(UI_SCALE_MAX);
  });

  it("ignores a corrupt stored uiScale and falls back to default", () => {
    localStorage.setItem("nexus.settings.uiScale", "banana");
    expect(getUiScale()).toBe(UI_SCALE_DEFAULT);
  });
});
