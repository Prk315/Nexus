import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import {
  DASH_BLOCK_DEFAULTS, getDashBlockVisibility, setDashBlockVisible,
  DASH_LAYOUT_DEFAULT, getDashLayout, setDashLayout, resetDashLayout,
  normalizeDashLayout, moveDashBlock, regionOf, type DashLayout,
} from "./dashBlocks";

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

  // The regression that white-screened the deployed dashboard (PR #132): this
  // is a useSyncExternalStore getSnapshot, and React compares snapshots with
  // `Object.is`. A fresh object per call means every commit looks like a store
  // change, so the tree re-renders forever until React throws "Maximum update
  // depth exceeded". Identity is the contract here, not just deep equality.
  it("returns an identical snapshot while the stored value is unchanged", () => {
    expect(getDashBlockVisibility()).toBe(getDashBlockVisibility());

    setDashBlockVisible("habits", false);
    expect(getDashBlockVisibility()).toBe(getDashBlockVisibility());
  });

  it("returns a NEW snapshot once the stored value changes", () => {
    const before = getDashBlockVisibility();
    setDashBlockVisible("habits", false);
    const after = getDashBlockVisibility();
    expect(after).not.toBe(before);
    expect(after.habits).toBe(false);
  });

  it("picks up a write made behind its back (cross-tab `storage` event)", () => {
    expect(getDashBlockVisibility().welcome).toBe(true);
    // Another tab wrote directly — no setDashBlockVisible call in this one.
    localStorage.setItem("pf.dash.blocks", JSON.stringify({ welcome: false }));
    expect(getDashBlockVisibility().welcome).toBe(false);
  });
});

describe("dash layout (868: reorder + move between columns)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const all = (l: DashLayout) => [...l.main, ...l.rail].sort();

  it("defaults to the page as it always looked", () => {
    expect(getDashLayout()).toEqual(DASH_LAYOUT_DEFAULT);
  });

  it("normalising junk yields every block exactly once — none can become unreachable", () => {
    for (const raw of [null, 42, "x", { main: "now" }, { main: ["now", "now", "bogus"], rail: ["now", "welcome"] }]) {
      const l = normalizeDashLayout(raw);
      expect(all(l)).toEqual(all(DASH_LAYOUT_DEFAULT));
    }
  });

  it("a duplicate across columns keeps its first (main) position", () => {
    const l = normalizeDashLayout({ main: ["calendar"], rail: ["calendar", "habits"] });
    expect(l.main[0]).toBe("calendar");
    expect(l.rail).toEqual(["habits"]);
  });

  it("a block added after the layout was stored lands in its default column", () => {
    // An older build stored a layout without "study".
    const l = normalizeDashLayout({ main: ["tasks", "now"], rail: ["calendar", "habits"] });
    expect(l.main).toEqual(["tasks", "now", "study"]);
    expect(l.rail).toEqual(["calendar", "habits"]);
  });

  it("moveDashBlock reorders within a column and moves across, clamping the slot", () => {
    let l = moveDashBlock(DASH_LAYOUT_DEFAULT, "study", "main", 0);
    expect(l.main).toEqual(["study", "now", "tasks"]);
    l = moveDashBlock(l, "calendar", "main", 99);
    expect(l.main).toEqual(["study", "now", "tasks", "calendar"]);
    expect(l.rail).toEqual(["habits"]);
    expect(regionOf(l, "calendar")).toBe("main");
    expect(all(l)).toEqual(all(DASH_LAYOUT_DEFAULT));
  });

  it("round-trips, and the snapshot is referentially stable while unchanged (#136)", () => {
    setDashLayout(moveDashBlock(DASH_LAYOUT_DEFAULT, "habits", "main", 1));
    const a = getDashLayout();
    expect(a.main).toEqual(["now", "habits", "tasks", "study"]);
    expect(getDashLayout()).toBe(a);
    resetDashLayout();
    expect(getDashLayout()).toEqual(DASH_LAYOUT_DEFAULT);
  });

  it("layout writes leave visibility untouched, and vice versa", () => {
    setDashBlockVisible("habits", false);
    setDashLayout(moveDashBlock(DASH_LAYOUT_DEFAULT, "habits", "main", 0));
    expect(getDashBlockVisibility().habits).toBe(false);
    setDashBlockVisible("habits", true);
    expect(getDashLayout().main[0]).toBe("habits");
  });
});
