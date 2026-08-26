import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { getSchema, generateHTML, generateJSON } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { buildNoteExtensions, noteSchema } from "./noteExtensions";
import { auditNoteRaw } from "../lib/noteSchemaGuard";
import { scanHeadingSections, foldsCovering, headingForSelection } from "./headingFold";

const schema = noteSchema();
const exts = buildNoteExtensions();

const para = (t = "x") => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const h = (level: number, t: string, collapsed = false) => ({
  type: "heading",
  attrs: collapsed ? { level, collapsed: true } : { level },
  content: [{ type: "text", text: t }],
});
const doc = (...content: any[]) => schema.nodeFromJSON({ type: "doc", content });

/** Text of every block a heading owns, for readable assertions. */
const ownedText = (d: any, title: string) =>
  scanHeadingSections(d)
    .find((s) => s.node.textContent === title)!
    .owned.map((o) => o.node.textContent);

describe("which blocks a heading owns", () => {
  it("takes everything up to the next heading of the same rank", () => {
    const d = doc(h(2, "A"), para("a1"), para("a2"), h(2, "B"), para("b1"));
    expect(ownedText(d, "A")).toEqual(["a1", "a2"]);
    expect(ownedText(d, "B")).toEqual(["b1"]);
  });

  it("swallows deeper headings and their content", () => {
    const d = doc(h(1, "Top"), para("t"), h(2, "Sub"), para("s"), h(1, "Next"));
    expect(ownedText(d, "Top")).toEqual(["t", "Sub", "s"]);
    // ...and the deeper heading still owns its own slice independently, so
    // folding either one works without folding the other.
    expect(ownedText(d, "Sub")).toEqual(["s"]);
  });

  it("stops at a HIGHER-ranked heading, which it does not own", () => {
    const d = doc(h(3, "Deep"), para("d"), h(2, "Shallower"), para("s"));
    expect(ownedText(d, "Deep")).toEqual(["d"]);
  });

  it("owns nothing when a heading is immediately followed by a peer", () => {
    const d = doc(h(2, "A"), h(2, "B"), para("b"));
    // Nothing to fold means no arrow is offered at all.
    expect(ownedText(d, "A")).toEqual([]);
  });

  it("owns nothing at the very end of the document", () => {
    const d = doc(para("p"), h(2, "Last"));
    expect(ownedText(d, "Last")).toEqual([]);
  });
});

// The property that makes this work inside the recursive structural blocks:
// a section is scoped to its PARENT, so a heading in a column cannot reach
// across the row, and a heading in a callout cannot swallow the rest of the
// note. It falls out of the recursion rather than being special-cased.
describe("sections are scoped to their parent", () => {
  const col = (...content: any[]) => ({ type: "column", content });
  const row = (...cols: any[]) => ({ type: "columnBlock", content: cols });

  it("does not let a heading inside a column own anything outside it", () => {
    const d = doc(
      row(col(h(2, "InCol"), para("mine")), col(para("other side"))),
      para("after the row")
    );
    expect(ownedText(d, "InCol")).toEqual(["mine"]);
  });

  it("does not let a heading inside a callout escape it", () => {
    const d = doc(
      { type: "calloutBlock", attrs: { variant: "info" }, content: [h(2, "Boxed"), para("in")] },
      para("out")
    );
    expect(ownedText(d, "Boxed")).toEqual(["in"]);
  });

  it("finds headings nested three container levels deep", () => {
    const inner = row(col(h(3, "Deepest"), para("deep body")), col(para()));
    const d = doc(row(col(row(col(inner), col(para()))), col(para())));
    expect(ownedText(d, "Deepest")).toEqual(["deep body"]);
  });
});

describe("foldsCovering", () => {
  it("finds the collapsed heading hiding a position", () => {
    const d = doc(h(2, "A", true), para("hidden"), h(2, "B"), para("visible"));
    const sections = scanHeadingSections(d);
    const a = sections.find((s) => s.node.textContent === "A")!;
    const hidden = a.owned[0].pos;
    expect(foldsCovering(d, hidden)).toEqual([a.pos]);
  });

  it("returns nothing for a position in an expanded section", () => {
    const d = doc(h(2, "A"), para("shown"));
    const p = scanHeadingSections(d)[0].owned[0].pos;
    expect(foldsCovering(d, p)).toEqual([]);
  });

  // This is what the outline needs: clicking "Sub" while "Top" is folded has
  // to reopen Top, or the scroll lands on a zero-height element.
  it("reports the outer fold for a heading nested inside it", () => {
    const d = doc(h(1, "Top", true), h(2, "Sub"), para("s"));
    const sections = scanHeadingSections(d);
    const top = sections.find((s) => s.node.textContent === "Top")!;
    const sub = sections.find((s) => s.node.textContent === "Sub")!;
    expect(foldsCovering(d, sub.pos)).toEqual([top.pos]);
  });
});

describe("headingForSelection", () => {
  it("returns the heading the caret is inside", () => {
    const d = doc(h(2, "A"), para("a"));
    const a = scanHeadingSections(d)[0];
    expect(headingForSelection(d, a.pos + 1)).toBe(a.pos);
  });

  it("returns the OWNING heading when the caret is in a paragraph under it", () => {
    const d = doc(h(2, "A"), para("body"));
    const a = scanHeadingSections(d)[0];
    expect(headingForSelection(d, a.owned[0].pos + 1)).toBe(a.pos);
  });

  it("prefers the innermost owner when sections nest", () => {
    const d = doc(h(1, "Top"), h(2, "Sub"), para("s"));
    const sections = scanHeadingSections(d);
    const sub = sections.find((s) => s.node.textContent === "Sub")!;
    const p = sub.owned[0].pos + 1;
    // Both Top and Sub own that paragraph; folding should collapse the
    // tightest section, not the whole document.
    expect(headingForSelection(d, p)).toBe(sub.pos);
  });

  it("returns null with no headings at all", () => {
    const d = doc(para("just text"));
    expect(headingForSelection(d, 1)).toBeNull();
  });
});

describe("persistence", () => {
  it("round-trips collapsed through JSON, which is how notes are stored", () => {
    const json = { type: "doc", content: [h(2, "A", true), para("b")] };
    const back: any = schema.nodeFromJSON(json).toJSON();
    expect(back.content[0].attrs.collapsed).toBe(true);
  });

  it("round-trips collapsed through HTML", () => {
    const html = generateHTML({ type: "doc", content: [h(2, "A", true), para("b")] }, exts);
    expect(html).toContain('data-collapsed="true"');
    const back: any = generateJSON(html, exts);
    expect(back.content[0].attrs.collapsed).toBe(true);
  });

  it("omits the attribute entirely when expanded, so old notes stay byte-identical", () => {
    const html = generateHTML({ type: "doc", content: [h(2, "A"), para("b")] }, exts);
    expect(html).not.toContain("data-collapsed");
  });

  it("passes the schema guard", () => {
    const raw = JSON.stringify({ type: "doc", content: [h(2, "A", true), para("b")] });
    expect(auditNoteRaw(raw, schema).ok).toBe(true);
  });
});

// The reason folding is an attribute and not a container node. A client that
// predates this release reads a folded note as an ordinary one — everything
// expanded, nothing lost — where an unknown NODE type would hand it an empty
// document and the next keystroke would autosave the blank.
describe("a client without the attribute", () => {
  const oldSchema = getSchema([StarterKit]);

  it("keeps every block of a folded note", () => {
    const json = { type: "doc", content: [h(2, "A", true), para("still here")] };
    let node: any;
    expect(() => { node = oldSchema.nodeFromJSON(json); }).not.toThrow();
    expect(node.childCount).toBe(2);
    expect(node.textContent).toContain("still here");
    expect(node.child(0).attrs.collapsed).toBeUndefined();
  });
});

// A CSS assertion in a unit test looks odd, so: this is a regression, not
// tidiness. `.columns-row` sets `display: flex` at the SAME specificity as the
// fold rule and is declared later in App.css, so a folded column row stayed
// fully visible while carrying the `is-folded` class — nothing to see in the
// DOM, nothing wrong in the decorations, and the section reporting itself
// folded. Folding has to beat every block type's own layout, including ones
// added after this was written, and `!important` is what guarantees that.
describe("the fold rule outranks every block's own display", () => {
  it("keeps !important on .is-folded", () => {
    const css = readFileSync(new URL("../App.css", import.meta.url), "utf8");
    const rule = css.match(/\.is-folded\s*\{[^}]*\}/);
    expect(rule, ".is-folded rule missing from App.css").not.toBeNull();
    expect(rule![0]).toMatch(/display:\s*none\s*!important/);
  });
});
