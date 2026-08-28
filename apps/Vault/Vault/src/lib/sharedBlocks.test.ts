import { describe, it, expect } from "vitest";
import {
  collectShares, shareIdOf, changedShares, serializeShare, parseShare,
  isEmptyContent, loadDecision, newShareId, shareKey, SHARE_PREFIX,
  type PmNode,
} from "./sharedBlocks";

const para = (text?: string): PmNode =>
  text ? { type: "paragraph", content: [{ type: "text", text }] } : { type: "paragraph" };

const shared = (id: string, ...content: PmNode[]): PmNode =>
  ({ type: "container", attrs: { shareId: id }, content });

const doc = (...content: PmNode[]): PmNode => ({ type: "doc", content });

describe("collectShares", () => {
  it("finds a share nested at any depth", () => {
    const d = doc(para("x"), { type: "columnBlock", content: [
      { type: "column", content: [shared("abc", para("inner"))] },
    ] });
    expect([...collectShares(d).keys()]).toEqual(["abc"]);
  });

  // ⚠️ The same share may legitimately appear twice in one note — a summary at
  // the top and the detail below. Keying by POSITION would drop one and then
  // write the survivor over it on the next save.
  it("keys by id, so one share appearing twice is one entry", () => {
    const d = doc(shared("abc", para("a")), shared("abc", para("a")));
    const m = collectShares(d);
    expect(m.size).toBe(1);
    expect(m.get("abc")).toEqual([para("a")]);
  });

  it("ignores containers with no share id, and survives junk", () => {
    expect(collectShares(doc({ type: "container", content: [para("x")] })).size).toBe(0);
    expect(collectShares(null).size).toBe(0);
    expect(collectShares(undefined).size).toBe(0);
    expect(shareIdOf({ type: "container", attrs: { shareId: "" } })).toBeNull();
    expect(shareIdOf({ type: "container", attrs: { shareId: 7 } as never })).toBeNull();
  });
});

describe("changedShares — the second guard against the write loop", () => {
  // Reference equality is always false: ProseMirror rebuilds nodes on every
  // transaction. Comparing payloads is what stops every keystroke being a write.
  it("reports nothing when the content is equal but the nodes are new objects", () => {
    const seen = new Map([["abc", serializeShare([para("hello")])]]);
    const current = new Map([["abc", [para("hello")]]]); // fresh objects
    expect(changedShares(current, seen)).toEqual([]);
  });

  it("reports a share whose content actually changed", () => {
    const seen = new Map([["abc", serializeShare([para("hello")])]]);
    const current = new Map([["abc", [para("goodbye")]]]);
    expect(changedShares(current, seen).map((c) => c.id)).toEqual(["abc"]);
  });

  it("reports a share never seen before", () => {
    expect(changedShares(new Map([["new", [para("x")]]]), new Map()).map((c) => c.id))
      .toEqual(["new"]);
  });

  // A share removed from the note is NOT reported: removing a block from one
  // note must not delete the shared content the other note still shows.
  it("never reports a share that has left the document", () => {
    const seen = new Map([["gone", serializeShare([para("x")])]]);
    expect(changedShares(new Map(), seen)).toEqual([]);
  });
});

describe("parseShare", () => {
  // ⚠️ Absent and empty are different. Returning [] for a failed read would
  // replace every copy of the block with nothing — and then save that.
  it("returns null for anything unusable, never an empty array", () => {
    for (const bad of [null, undefined, "", "not json", "{}", '"a string"', "[1,2]", '[{"nope":1}]']) {
      expect(parseShare(bad as never), String(bad)).toBeNull();
    }
  });

  it("returns an empty array only when that is genuinely what was stored", () => {
    expect(parseShare("[]")).toEqual([]);
  });

  it("round-trips", () => {
    const content = [para("one"), { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "h" }] }];
    expect(parseShare(serializeShare(content))).toEqual(content);
  });
});

describe("isEmptyContent", () => {
  // `block+` cannot hold zero children, so an "empty" container is one empty
  // paragraph — and seeding a row from it would publish emptiness over the
  // other note's content.
  it("treats one empty paragraph as empty, because that is what empty looks like", () => {
    expect(isEmptyContent([])).toBe(true);
    expect(isEmptyContent(null)).toBe(true);
    expect(isEmptyContent([para()])).toBe(true);
    expect(isEmptyContent([para(), para()])).toBe(true);
    expect(isEmptyContent([para("x")])).toBe(false);
    expect(isEmptyContent([{ type: "horizontalRule" }])).toBe(false);
  });
});

describe("loadDecision", () => {
  it("applies the row over the local copy, because the row is the shared truth", () => {
    const d = loadDecision([para("remote")], [para("local")]);
    expect(d).toEqual({ action: "apply", content: [para("remote")] });
  });

  it("does nothing when they already agree, so opening a note is not a write", () => {
    expect(loadDecision([para("same")], [para("same")])).toEqual({ action: "none" });
  });

  // Sharing an existing block must be a no-op for that block.
  it("seeds the row from the note when there is no row yet", () => {
    expect(loadDecision(null, [para("mine")])).toEqual({ action: "seed", content: [para("mine")] });
  });

  // ⚠️ Otherwise the first note to open a freshly shared empty block publishes
  // its emptiness over the second note's content.
  it("does not seed an empty block, so emptiness is never published", () => {
    expect(loadDecision(null, [para()])).toEqual({ action: "none" });
    expect(loadDecision(null, [])).toEqual({ action: "none" });
  });

  // A share deliberately emptied on the other device must clear here too —
  // that is a real edit, unlike the un-seeded case above.
  it("applies a genuinely empty row, which is different from no row", () => {
    expect(loadDecision([], [para("local")])).toEqual({ action: "apply", content: [] });
  });
});

describe("ids and keys", () => {
  it("mints distinct ids and keys them under one prefix", () => {
    const a = newShareId(), b = newShareId();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
    expect(shareKey(a)).toBe(`${SHARE_PREFIX}${a}`);
    // Must not collide with the other suffixed rows Vault stores in the same
    // table — `{id}_annot` and `{id}_margins` — which have no prefix at all.
    expect(shareKey(a).includes("_annot")).toBe(false);
    expect(shareKey(a).startsWith(SHARE_PREFIX)).toBe(true);
  });
});
