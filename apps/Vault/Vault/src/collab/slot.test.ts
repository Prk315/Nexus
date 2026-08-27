import { describe, it, expect } from "vitest";
import { nextSeed, resolveSlot, type CollabSlot, type Seed } from "./slot";
import type { CollabSession } from "./types";

const fakeSession = (tag: string) => ({ tag } as unknown as CollabSession);

const slotFor = (nodeId: string, tag = nodeId): CollabSlot => ({
  nodeId,
  session: fakeSession(tag),
  status: "live",
});

describe("resolveSlot", () => {
  it("reports off when the node is not eligible", () => {
    expect(resolveSlot(slotFor("a"), "a", false)).toEqual({
      loading: false,
      session: null,
      status: "off",
    });
  });

  it("reports off when there is no node", () => {
    expect(resolveSlot(null, null, true).status).toBe("off");
  });

  it("reports loading until a slot for THIS node exists", () => {
    const state = resolveSlot(null, "a", true);
    expect(state).toEqual({ loading: true, session: null, status: "loading" });
  });

  // The regression this whole module exists for. Switching tabs A → B leaves
  // A's slot in state for at least one render; handing it back would bind note
  // B's editor to note A's Y.Doc and seed B's CRDT from A's document.
  it("never hands back another node's session", () => {
    const state = resolveSlot(slotFor("a"), "b", true);
    expect(state.session).toBeNull();
    expect(state.loading).toBe(true);
  });

  it("hands back the session once its own slot lands", () => {
    const slot = slotFor("b");
    const state = resolveSlot(slot, "b", true);
    expect(state.session).toBe(slot.session);
    expect(state.loading).toBe(false);
    expect(state.status).toBe("live");
  });

  // A failed setup is RESOLVED, not absent — otherwise the pane sits on
  // "Connecting…" forever rather than falling back to the guarded save path.
  it("treats a failed slot as resolved so the caller can fall back", () => {
    const failed: CollabSlot = { nodeId: "a", session: null, status: "error" };
    expect(resolveSlot(failed, "a", true)).toEqual({
      loading: false,
      session: null,
      status: "error",
    });
  });
});

describe("nextSeed", () => {
  const seed = (nodeId: string | null, json: string): Seed => ({ nodeId, json });

  it("takes the new node's json even while the previous session is still resolved", () => {
    // This is the exact frame that produced two identical notes: nodeId has
    // moved to B, the OLD session is still in state, and the old code kept A's
    // json because "a session exists".
    const next = nextSeed(seed("a", "NOTE-A"), "b", "NOTE-B", true);
    expect(next).toEqual({ nodeId: "b", json: "NOTE-B" });
  });

  it("keeps tracking the prop while the same node is still resolving", () => {
    const next = nextSeed(seed("a", "old"), "a", "fresher", false);
    expect(next.json).toBe("fresher");
  });

  it("freezes once the same node has resolved", () => {
    const prev = seed("a", "seed-at-open");
    // The projection lags the CRDT, so re-seeding from it would resurrect text
    // the Y.Doc has already deleted.
    expect(nextSeed(prev, "a", "projection-written-later", true)).toBe(prev);
  });

  it("is referentially stable when nothing changed", () => {
    const prev = seed("a", "same");
    expect(nextSeed(prev, "a", "same", false)).toBe(prev);
  });

  it("handles the transition to no node at all", () => {
    expect(nextSeed(seed("a", "NOTE-A"), null, "", true)).toEqual({ nodeId: null, json: "" });
  });
});
