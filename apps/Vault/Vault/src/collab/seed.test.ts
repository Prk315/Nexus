import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import { noteSchema } from "../extensions/noteExtensions";
import { FRAGMENT, buildSeedState, hydrate, readSeedWidth, shouldSeed } from "./seed";
import { fromB64 } from "./base64";

const DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "the quick brown fox" }] }],
};

const text = (doc: Y.Doc) => JSON.stringify(yDocToProsemirrorJSON(doc, FRAGMENT));

describe("seed election", () => {
  // ── The regression sentinel ────────────────────────────────────────────────
  // This test asserts the BUG, not the fix. If it ever goes green by accident
  // — because someone "simplified" the election away, or because a library
  // update made seeding deterministic — that is the signal to re-read
  // seed.ts's header before touching anything.
  it("two independent seeds of identical JSON DUPLICATE the document when merged", () => {
    const schema = noteSchema();
    const a = prosemirrorJSONToYDoc(schema, DOC, FRAGMENT);
    const b = prosemirrorJSONToYDoc(schema, DOC, FRAGMENT);

    const merged = new Y.Doc();
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(merged, Y.encodeStateAsUpdate(b));

    const occurrences = text(merged).split("the quick brown fox").length - 1;
    expect(occurrences).toBe(2);
  });

  // …and this is why the election exists: one winner's bytes, hydrated
  // independently by both clients, converge on exactly one copy.
  it("one winner's bytes hydrated twice produce identical, non-duplicated documents", () => {
    const state = buildSeedState(DOC, noteSchema());
    const winner = hydrate(state);
    const loser = hydrate(state);

    expect(text(winner)).toBe(text(loser));
    expect(text(winner).split("the quick brown fox").length - 1).toBe(1);
  });

  it("merging the two hydrated docs still yields one copy", () => {
    const state = buildSeedState(DOC, noteSchema());
    const winner = hydrate(state);
    const loser = hydrate(state);

    Y.applyUpdate(winner, Y.encodeStateAsUpdate(loser));
    expect(text(winner).split("the quick brown fox").length - 1).toBe(1);
  });

  it("round-trips content through seed and hydrate", () => {
    const doc = hydrate(buildSeedState(DOC, noteSchema()));
    expect(yDocToProsemirrorJSON(doc, FRAGMENT)).toMatchObject({
      content: [{ type: "paragraph", content: [{ type: "text", text: "the quick brown fox" }] }],
    });
  });

  describe("shouldSeed", () => {
    // An empty client must never win the election: if the other side has real
    // content and we publish an empty document as authoritative, the note is
    // gone. Because only a client holding content ever inserts, a row that
    // exists always came from a client that had something to say.
    it("refuses to seed from nothing", () => {
      expect(shouldSeed("")).toBe(false);
      expect(shouldSeed("   ")).toBe(false);
      expect(shouldSeed(JSON.stringify({ type: "doc", content: [] }))).toBe(false);
    });

    it("seeds from real content", () => {
      expect(shouldSeed(JSON.stringify(DOC))).toBe(true);
    });

    it("seeds from legacy HTML content, which Tiptap can still parse", () => {
      expect(shouldSeed("<p>an old imported note</p>")).toBe(true);
    });
  });

  describe("doc attributes", () => {
    // Pins the reason NoteEditor re-applies the width by hand. ySync rebuilds
    // the root as topNodeType.create(null, …), so doc-level attributes do not
    // survive the fragment round trip. If this ever starts passing with the
    // attribute intact, the manual restore in NoteEditor can go — until then,
    // deleting it silently resets every wide note to the default and the next
    // projection write makes that permanent.
    it("are DROPPED by the Yjs round trip", () => {
      const wide = { ...DOC, attrs: { width: "wide" } };
      const doc = hydrate(buildSeedState(wide, noteSchema()));
      expect((yDocToProsemirrorJSON(doc, FRAGMENT) as any).attrs?.width).toBeUndefined();
    });

    it("are recoverable from the seed JSON, which is how the width is restored", () => {
      expect(readSeedWidth(JSON.stringify({ ...DOC, attrs: { width: "wide" } }))).toBe("wide");
      expect(readSeedWidth(JSON.stringify(DOC))).toBeUndefined();
      expect(readSeedWidth("<p>not json</p>")).toBeUndefined();
    });
  });

  // The two defaults differ: Collaboration's `field` is "default" while
  // prosemirrorJSONToYDoc's third argument defaults to "prosemirror". Mixing
  // them produces no error at all — the editor mounts on an empty fragment and
  // the note simply looks blank, then the first keystroke's projection erases
  // it. Pin the constant.
  it("uses the fragment name Collaboration defaults to", () => {
    expect(FRAGMENT).toBe("default");

    const wrongFragment = prosemirrorJSONToYDoc(noteSchema(), DOC, "prosemirror");
    expect(wrongFragment.getXmlFragment("default").length).toBe(0);
  });

  it("hydrates an empty state into an empty doc rather than throwing", () => {
    expect(hydrate("").getXmlFragment(FRAGMENT).length).toBe(0);
  });

  it("produces bytes a plain Yjs client can apply", () => {
    const state = buildSeedState(DOC, noteSchema());
    const doc = new Y.Doc();
    expect(() => Y.applyUpdate(doc, fromB64(state))).not.toThrow();
  });
});
