import { describe, it, expect } from "vitest";
import { activeOutlinePath, blockConcept, buildReaderOutline } from "./readerOutline";
import type { ReaderBlock, ReaderPage } from "./readerTypes";

let seq = 0;
function block(partial: Partial<ReaderBlock> & { type: ReaderBlock["type"] }): ReaderBlock {
  return {
    id: partial.id ?? `p1-b${seq++}`,
    bbox: [0, 0, 10, 10],
    text: "",
    html: "",
    ...partial,
  } as ReaderBlock;
}

function page(printedPage: number, blocks: ReaderBlock[], n = 0): ReaderPage {
  return {
    n, pdfPage: printedPage, printedPage,
    image: `/p${printedPage}.png`, width: 1000, height: 1400, blocks,
  };
}

describe("buildReaderOutline", () => {
  it("nests headings by level", () => {
    const tree = buildReaderOutline([page(27, [
      block({ id: "a", type: "heading", level: 1, heading: "1 Naturlige tall" }),
      block({ id: "b", type: "heading", level: 2, heading: "1.1 Grunnleggende egenskaper" }),
      block({ id: "c", type: "heading", level: 3, heading: "Polarform" }),
      block({ id: "d", type: "heading", level: 2, heading: "1.2 Induksjon" }),
    ])]);

    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe("a");
    expect(tree[0].children.map((n) => n.id)).toEqual(["b", "d"]);
    expect(tree[0].children[0].children.map((n) => n.id)).toEqual(["c"]);
  });

  it("hangs concepts off the innermost open heading", () => {
    const tree = buildReaderOutline([page(54, [
      block({ id: "h", type: "heading", level: 2, heading: "1.4 Pascals trekant" }),
      block({ id: "c1", type: "concept", heading: "1.4.1 Eksempel" }),
      block({ id: "c2", type: "concept", heading: "1.4.2 Binomialformelen" }),
    ])]);

    expect(tree[0].children.map((n) => [n.text, n.conceptKind])).toEqual([
      ["Eksempel 1.4.1", "example"],
      ["Binomialformelen", "theorem"],
    ]);
    expect(tree[0].children.every((n) => n.kind === "concept")).toBe(true);
  });

  // The reason the tree is built from the pages array and not per page.
  it("carries a heading across a page boundary", () => {
    const tree = buildReaderOutline([
      page(53, [block({ id: "h", type: "heading", level: 2, heading: "1.4 Pascals trekant" })], 0),
      page(54, [block({ id: "c", type: "concept", heading: "1.4.2 Binomialformelen" })], 1),
    ]);
    expect(tree[0].children[0].id).toBe("c");
    expect(tree[0].children[0].pageIndex).toBe(1);
  });

  it("puts a concept with no heading above it at the root", () => {
    const tree = buildReaderOutline([page(55, [
      block({ id: "c", type: "concept", heading: "1.4.4 Lemma" }),
    ])]);
    expect(tree.map((n) => n.id)).toEqual(["c"]);
    expect(tree[0].kind).toBe("concept");
  });

  it("ignores blocks that are neither headings nor concepts", () => {
    const tree = buildReaderOutline([page(58, [
      block({ id: "h", type: "heading", level: 3, heading: "Oppgaver i seksjon 1.4" }),
      block({ id: "e", type: "exercise", text: "1. Regn ut" }),
      block({ id: "m", type: "math", text: "a + b" }),
      block({ id: "f", type: "figure", text: "" }),
      block({ id: "p", type: "paragraph", text: "Vi beviser dette i neste seksjon." }),
    ])]);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(0);
  });

  it("drops a concept block whose heading parses to nothing", () => {
    const tree = buildReaderOutline([page(60, [
      block({ id: "x", type: "concept", heading: "Noe helt annet" }),
    ])]);
    expect(tree).toHaveLength(0);
  });

  it("prefers label/name already written into the JSON over re-parsing", () => {
    const tree = buildReaderOutline([page(61, [
      block({ id: "c", type: "concept", heading: "ignored", concept: "definition", name: "Kontinuitet" }),
    ])]);
    expect(tree[0].text).toBe("Kontinuitet");
    expect(tree[0].conceptKind).toBe("definition");
  });
});

describe("blockConcept", () => {
  it("falls back to the block text when there is no heading run", () => {
    expect(blockConcept(block({ id: "z", type: "concept", text: "3.3.1 Definisjon" })))
      .toEqual({ kind: "definition", title: "Definisjon 3.3.1" });
  });
});

describe("activeOutlinePath", () => {
  const pages = [
    page(53, [
      block({ id: "h1", type: "heading", level: 1, heading: "1 Naturlige tall" }),
      block({ id: "h2", type: "heading", level: 2, heading: "1.4 Pascals trekant" }),
      block({ id: "p1", type: "paragraph", text: "…" }),
    ], 0),
    page(54, [
      block({ id: "c1", type: "concept", heading: "1.4.2 Binomialformelen" }),
      block({ id: "p2", type: "paragraph", text: "…" }),
    ], 1),
  ];
  const tree = buildReaderOutline(pages);

  it("is empty when nothing is on screen yet", () => {
    expect(activeOutlinePath(tree, pages, [])).toEqual([]);
  });

  it("returns the full ancestor path so a collapsed branch still marks", () => {
    expect(activeOutlinePath(tree, pages, ["c1"])).toEqual(["h1", "h2", "c1"]);
  });

  it("marks the last entry scrolled past when none is itself visible", () => {
    expect(activeOutlinePath(tree, pages, ["p1"])).toEqual(["h1", "h2"]);
    expect(activeOutlinePath(tree, pages, ["p2"])).toEqual(["h1", "h2", "c1"]);
  });

  it("uses the earliest visible block, not the last", () => {
    expect(activeOutlinePath(tree, pages, ["p1", "c1", "p2"])).toEqual(["h1", "h2", "c1"]);
  });
});
