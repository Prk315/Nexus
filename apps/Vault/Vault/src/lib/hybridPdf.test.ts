import { describe, it, expect } from "vitest";
import { parseCompanion, sourceForPage, buildAnchors, sliceForPage, pageOfIndex } from "./hybridPdf";

const CH = { pgm_ch01: [38, 51] as [number, number], pgm_ch02: [52, 81] as [number, number] };

const HTML =
  '<span data-pv-ch="pgm_ch01" hidden></span>' +
  '<h1>1 Introduction</h1><p>intro text</p>' +
  '<p><img src="https://x/store/uid/parsed/n1/pgm_ch01/_page_0_Picture_8.jpeg"></p>' +
  '<p>mid chapter one</p>' +
  '<p><img src="https://x/store/uid/parsed/n1/pgm_ch01/_page_4_Figure_2.jpeg"></p>' +
  '<p>late chapter one</p>' +
  '<span data-pv-ch="pgm_ch02" hidden></span>' +
  '<h1>2 Foundations</h1><p>ch two opens</p>' +
  '<p><img src="https://x/store/uid/parsed/n1/pgm_ch02/_page_3_Figure_1.jpeg"></p>' +
  '<p>deep in ch two</p>';

describe("parseCompanion", () => {
  it("null for missing/garbage — absent is not empty", () => {
    expect(parseCompanion(null)).toBeNull();
    expect(parseCompanion("not json")).toBeNull();
    expect(parseCompanion('{"v":1}')).toBeNull();
  });
  it("keeps sources and their ranges", () => {
    const c = parseCompanion(JSON.stringify({ v: 1, parsed: [{ node: "n1", chapters: CH }] }))!;
    expect(c.parsed[0].node).toBe("n1");
    expect(c.parsed[0].chapters.pgm_ch01).toEqual([38, 51]);
  });
});

describe("sourceForPage", () => {
  const c = parseCompanion(JSON.stringify({ v: 1, parsed: [
    { node: "n1", chapters: { a: [38, 100] } },
    { node: "n2", chapters: { b: [101, 200] } },
  ] }))!;
  it("routes a page to the node whose chapters hold it", () => {
    expect(sourceForPage(c, 50)!.node).toBe("n1");
    expect(sourceForPage(c, 150)!.node).toBe("n2");
  });
  it("a source with no ranges is a whole-book fallback", () => {
    const k = parseCompanion(JSON.stringify({ v: 1, parsed: [{ node: "kal", chapters: {} }] }))!;
    expect(sourceForPage(k, 999)!.node).toBe("kal");
  });
});

describe("buildAnchors", () => {
  const anchors = buildAnchors(HTML, CH);
  it("anchors on chapter starts and figure filenames (0-based page ids)", () => {
    const pages = anchors.map(a => a.page);
    // ch01 marker (38), fig page 38 (=38+0), fig 42 (=38+4), ch02 marker (52), fig 55 (=52+3)
    expect(pages).toEqual([38, 38, 42, 52, 55]);
  });
  it("positions are sorted and land on tag boundaries", () => {
    for (let i = 1; i < anchors.length; i++) expect(anchors[i].idx).toBeGreaterThanOrEqual(anchors[i - 1].idx);
    for (const a of anchors) expect(HTML[a.idx]).toBe("<");
  });
  it("page numbers are forced monotone", () => {
    const pages = buildAnchors(HTML, CH).map(a => a.page);
    for (let i = 1; i < pages.length; i++) expect(pages[i]).toBeGreaterThanOrEqual(pages[i - 1]);
  });
});

describe("sliceForPage", () => {
  const anchors = buildAnchors(HTML, CH);
  it("a page mid-chapter gets the run between its bounding anchors", () => {
    const s = sliceForPage(HTML, anchors, 43)!;
    expect(s.html).toContain("late chapter one");
    expect(s.html).not.toContain("ch two opens");
    expect(s.from).toBe(42);
    expect(s.to).toBe(51);
  });
  it("chapter starts cut cleanly — page 52 excludes chapter one", () => {
    const s = sliceForPage(HTML, anchors, 52)!;
    expect(s.html).toContain("ch two opens");
    expect(s.html).not.toContain("late chapter one");
  });
  it("no anchors -> whole document with NaN bounds (whole-book sources)", () => {
    const s = sliceForPage("<p>x</p>", [], 10)!;
    expect(s.html).toBe("<p>x</p>");
    expect(Number.isNaN(s.from)).toBe(true);
  });
  it("empty html -> null, never an empty slice pretending to be a page", () => {
    expect(sliceForPage("", anchors, 43)).toBeNull();
  });
});

describe("pageOfIndex", () => {
  const anchors = buildAnchors(HTML, CH);
  it("maps a text position to the page of the last anchor before it", () => {
    const deep = HTML.indexOf("deep in ch two");
    expect(pageOfIndex(anchors, deep)).toBe(55);
    const mid = HTML.indexOf("mid chapter one");
    expect(pageOfIndex(anchors, mid)).toBe(38);
  });
  it("null with no anchors", () => {
    expect(pageOfIndex([], 5)).toBeNull();
  });
});

describe("textWithMap (search half)", async () => {
  const { textWithMap } = await import("../components/PdfParsedPanel");
  it("strips tags and maps every text char to its html position", () => {
    const html = '<p>ab <strong>cd</strong></p>';
    const { text, map } = textWithMap(html);
    expect(text).toBe("ab cd");
    expect(html[map[text.indexOf("c")]]).toBe("c");
    expect(map.length).toBe(text.length);
  });
  it("a hit maps back into anchor space — the search→page chain", () => {
    const CH2 = { pgm_ch01: [38, 51] as [number, number] };
    const html = '<span data-pv-ch="pgm_ch01" hidden></span><p>alpha</p>'
      + '<p><img src="/x/pgm_ch01/_page_6_Figure_1.jpeg"></p><p>needle text</p>';
    const anchors = buildAnchors(html, CH2);
    const { text, map } = textWithMap(html);
    const at = text.indexOf("needle");
    expect(pageOfIndex(anchors, map[at])).toBe(44); // 38 + 6
  });
});
