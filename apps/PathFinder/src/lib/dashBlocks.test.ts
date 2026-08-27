import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { DASH_BLOCK_DEFAULTS, getDashBlockVisibility, setDashBlockVisible } from "./dashBlocks";

// Same rationale as packages/nexus-core/src/settings.test.ts: vitest's Node
// environment (this project's `test.environment: "node"`) has no
// `localStorage` global, so polyfill a minimal one to exercise the real code.
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

describe("dashBlocks visibility store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("defaults every block to visible when unset", () => {
    expect(getDashBlockVisibility()).toEqual(DASH_BLOCK_DEFAULTS);
  });

  it("round-trips a toggle", () => {
    setDashBlockVisible("habits", false);
    expect(getDashBlockVisibility().habits).toBe(false);
    // Untouched blocks stay at their default.
    expect(getDashBlockVisibility().tasks).toBe(true);
  });

  it("merges over defaults, so a block unknown to an older stored map defaults visible", () => {
    // Simulates a client that persisted a map before "calendar" existed.
    localStorage.setItem("pf.dash.blocks", JSON.stringify({ welcome: false }));
    const v = getDashBlockVisibility();
    expect(v.welcome).toBe(false);
    expect(v.calendar).toBe(true);
  });

  it("falls back to defaults for corrupt JSON", () => {
    localStorage.setItem("pf.dash.blocks", "{not json");
    expect(getDashBlockVisibility()).toEqual(DASH_BLOCK_DEFAULTS);
  });
});
