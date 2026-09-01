import { describe, it, expect } from "vitest";
import { buildBlockRegistry, actionsFor, type BlockGroup } from "../extensions/blockRegistry";
import {
  INLINE_GROUPS,
  MENU_GROUPS,
  TABLE_MENU_GROUPS,
  CARD_MENU_GROUPS,
  SHARE_MENU_GROUPS,
  WIDTH_MENU_GROUPS,
  TAIL_GROUPS,
} from "./NoteToolbar";

// ─── The bug this file exists for ────────────────────────────────────────────
//
// The toolbar renders BY GROUP: five arrays name which groups appear where, and
// anything whose group is in none of them is simply never drawn — no error, no
// warning, no empty slot. So an action can be registered, correctly gated,
// correctly implemented, covered by its own tests, and completely unreachable.
//
// That is exactly what happened to `cardColor`. Card colours were declared with
// `surfaces: ["toolbar"]` and left out of every array, so there was no way to
// change a callout's or container's colour at all. It was found by a user
// asking how to do it, which is the worst way to find it.
//
// A group is easy to add and easy to forget to render, and the failure is
// silent in both directions. So the relationship between the two modules is
// asserted here rather than trusted.

const toolbarGroups = new Set<BlockGroup>([
  ...INLINE_GROUPS,
  ...MENU_GROUPS,
  ...TABLE_MENU_GROUPS,
  ...CARD_MENU_GROUPS,
  ...SHARE_MENU_GROUPS,
  ...WIDTH_MENU_GROUPS,
  ...TAIL_GROUPS,
]);

describe("toolbar group coverage", () => {
  it("renders every group that a toolbar action belongs to", () => {
    const orphaned = [
      ...new Set(
        actionsFor(buildBlockRegistry({}), "toolbar")
          .map((a) => a.group)
          .filter((g) => !toolbarGroups.has(g)),
      ),
    ];
    // Named in the message rather than just counted: when this fails, the group
    // is the whole answer.
    expect(orphaned, `groups declared surfaces:["toolbar"] but rendered nowhere: ${orphaned.join(", ")}`)
      .toEqual([]);
  });

  it("names no group that has no toolbar actions", () => {
    // The other direction. A stale entry is harmless at runtime — the section
    // filters to empty and hides — but it is a lie about what the toolbar
    // shows, and it makes the list above stop meaning anything.
    const used = new Set(actionsFor(buildBlockRegistry({}), "toolbar").map((a) => a.group));
    const dead = [...toolbarGroups].filter((g) => !used.has(g));
    expect(dead, `groups rendered by the toolbar with no actions: ${dead.join(", ")}`).toEqual([]);
  });

  it("keeps card colour reachable specifically", () => {
    // The regression itself, pinned by name. The coverage test above would
    // catch it, but only as one entry in a list — this says what broke.
    const ids = actionsFor(buildBlockRegistry({}), "toolbar")
      .filter((a) => a.group === "cardColor")
      .map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(toolbarGroups.has("cardColor")).toBe(true);
  });
});
