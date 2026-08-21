import { describe, it, expect } from "vitest";
import { buildBlockRegistry, actionsFor, matchesQuery, atCursor, GROUP_LABELS } from "./blockRegistry";

const registry = () => buildBlockRegistry();

describe("block registry", () => {
  it("gives every action a unique id", () => {
    const ids = registry().map((a) => a.id);
    expect(new Set(ids).size, `duplicate ids: ${ids.filter((v, i) => ids.indexOf(v) !== i)}`).toBe(ids.length);
  });

  it("gives every action at least one surface and a known group", () => {
    for (const a of registry()) {
      expect(a.surfaces.length, `${a.id} appears nowhere`).toBeGreaterThan(0);
      expect(GROUP_LABELS[a.group], `${a.id} has no group label`).toBeTruthy();
    }
  });

  // The whole point of this phase: the slash menu and the toolbar used to be
  // two hand-kept lists, and they had already drifted. Anything a user would
  // reasonably reach for by typing "/" must actually be reachable that way.
  it("exposes every block-inserting action in the slash menu", () => {
    const slashIds = new Set(actionsFor(registry(), "slash").map((a) => a.id));
    for (const id of [
      "paragraph", "heading1", "heading2", "heading3",
      "bulletList", "orderedList", "taskList",
      "blockquote", "codeBlock", "divider",
      "inlineMath", "blockMath", "table",
    ]) {
      expect(slashIds, `/${id} is not reachable from the slash menu`).toContain(id);
    }
  });

  it("keeps mark toggles out of the slash menu and in the bubble menu", () => {
    const slashIds = new Set(actionsFor(registry(), "slash").map((a) => a.id));
    const bubbleIds = new Set(actionsFor(registry(), "bubble").map((a) => a.id));
    for (const id of ["bold", "italic", "underline", "strike", "code"]) {
      // A mark applies to a selection; the slash menu fires with a collapsed
      // cursor, so offering them there would be a no-op the user can't explain.
      expect(slashIds, `${id} should not be in the slash menu`).not.toContain(id);
      expect(bubbleIds, `${id} should be in the bubble menu`).toContain(id);
    }
  });

  // Conditional injection: these actions must be ABSENT, not merely disabled,
  // when their context doesn't exist — a Database action in a note with no
  // Database ancestor can only fail.
  it("omits context actions when their callbacks aren't supplied", () => {
    const bare = buildBlockRegistry().map((a) => a.id);
    expect(bare).not.toContain("databaseInsert");
    expect(bare).not.toContain("link");
    expect(bare).not.toContain("editHighlighters");

    const full = buildBlockRegistry({
      onDatabaseInsert: () => {},
      onEditLink: () => {},
      onEditHighlighters: () => {},
    }).map((a) => a.id);
    expect(full).toContain("databaseInsert");
    expect(full).toContain("link");
    expect(full).toContain("editHighlighters");
  });

  it("emits one action per highlighter category", () => {
    const withCats = buildBlockRegistry({
      highlighters: [
        { name: "Definition", color: "#ffd400" },
        { name: "Claim", color: "#7ee787" },
      ] as any,
    });
    const ids = withCats.map((a) => a.id);
    expect(ids).toContain("highlight:Definition");
    expect(ids).toContain("highlight:Claim");
  });

  it("matches slash queries on title and on keywords", () => {
    const taskList = registry().find((a) => a.id === "taskList")!;
    expect(matchesQuery(taskList, "")).toBe(true);
    expect(matchesQuery(taskList, "to-do")).toBe(true);     // matches the title
    // "todo" (unhyphenated) is what people actually type, and the title does
    // NOT contain it — the keyword list is what makes this work.
    expect(matchesQuery(taskList, "todo")).toBe(true);
    expect(matchesQuery(taskList, "checkbox")).toBe(true);  // keyword only
    expect(matchesQuery(taskList, "TASK")).toBe(true);      // case-insensitive
    expect(matchesQuery(taskList, "zzz")).toBe(false);
  });

  it("hides table row/column operations outside a table", () => {
    const notInTable = { isActive: () => false } as any;
    const inTable = { isActive: (n: string) => n === "table" } as any;

    const ops = registry().filter((a) => a.id.startsWith("tableRow") || a.id.startsWith("tableCol") || a.id === "tableDelete");
    expect(ops.length).toBeGreaterThan(0);
    for (const op of ops) {
      expect(op.isAvailable?.(notInTable), `${op.id} should be hidden outside a table`).toBe(false);
      expect(op.isAvailable?.(inTable), `${op.id} should be shown inside a table`).toBe(true);
    }

    const insert = registry().find((a) => a.id === "table")!;
    expect(insert.isAvailable?.(notInTable)).toBe(true);
    // Inserting a table inside a table cell is the one thing this must not do.
    expect(insert.isAvailable?.(inTable)).toBe(false);
  });
});

describe("atCursor", () => {
  // Encodes the trap documented in blockRegistry.ts: insertInlineMath resolves
  // its position from the LIVE selection, so deleteRange must be dispatched
  // first, separately. If someone "tidies" this into one chain, the ordering
  // below changes and this test fails.
  it("dispatches deleteRange in its own run() before the body", () => {
    const calls: string[] = [];
    const chain = {
      focus: () => chain,
      deleteRange: () => { calls.push("deleteRange"); return chain; },
      setParagraph: () => { calls.push("body"); return chain; },
      run: () => { calls.push("run"); return true; },
    };
    const editor = { chain: () => chain } as any;
    atCursor((c: any) => c.setParagraph())(editor, { range: { from: 0, to: 1 } });

    expect(calls).toEqual(["deleteRange", "run", "body", "run"]);
  });

  it("skips deleteRange entirely when invoked without a slash range", () => {
    const calls: string[] = [];
    const chain = {
      focus: () => chain,
      deleteRange: () => { calls.push("deleteRange"); return chain; },
      setParagraph: () => { calls.push("body"); return chain; },
      run: () => { calls.push("run"); return true; },
    };
    const editor = { chain: () => chain } as any;
    atCursor((c: any) => c.setParagraph())(editor);

    expect(calls).toEqual(["body", "run"]);
  });
});
