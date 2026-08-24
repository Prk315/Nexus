import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import { buildNoteExtensions, noteSchema } from "../noteExtensions";
import { auditNoteRaw } from "../../lib/noteSchemaGuard";
import { buildColumnDecorations } from "./columnResize";
import { stripDefaults } from "../../test/roundTrip";

const schema = noteSchema();
const exts = buildNoteExtensions();

const para = (t = "x") => ({ type: "paragraph", content: [{ type: "text", text: t }] });
const callout = (...c: any[]) => ({ type: "calloutBlock", attrs: { variant: "note" }, content: c });
const container = (...c: any[]) => ({ type: "containerBlock", attrs: { style: "card" }, content: c });
const col = (...c: any[]) => ({ type: "column", attrs: { width: null }, content: c });
const row = (...cols: any[]) => ({ type: "columnBlock", content: cols });
const toggle = (summary: string, ...body: any[]) => ({
  type: "toggleBlock",
  attrs: { open: true },
  content: [
    { type: "toggleSummary", content: [{ type: "text", text: summary }] },
    { type: "toggleContent", content: body },
  ],
});
const doc = (...c: any[]) => ({ type: "doc", content: c });

/** Throws if the structure violates the schema. */
const check = (json: any) => {
  const node = schema.nodeFromJSON(json);
  node.check();
  return node;
};

const depthOf = (node: any): number => {
  let max = 0;
  node.descendants((n: any, _pos: number, _parent: any) => {
    void n;
    return true;
  });
  // Walk explicitly: deepest nesting of columnBlock/callout/container/toggle.
  const STRUCT = new Set(["columnBlock", "column", "calloutBlock", "containerBlock", "toggleBlock", "toggleContent"]);
  const walk = (n: any, d: number) => {
    max = Math.max(max, d);
    n.forEach((child: any) => walk(child, STRUCT.has(child.type.name) ? d + 1 : d));
  };
  walk(node, 0);
  return max;
};

describe("recursive nesting is allowed by the schema", () => {
  it("puts a container inside a column", () => {
    expect(() => check(doc(row(col(container(para())), col(para()))))).not.toThrow();
  });

  it("puts a column row inside a column — the case the UI was blocking", () => {
    const json = doc(row(col(row(col(para("a")), col(para("b")))), col(para("c"))));
    expect(() => check(json)).not.toThrow();
  });

  it("puts a column row inside a callout, and a callout inside a column", () => {
    expect(() => check(doc(callout(row(col(para()), col(para())))))).not.toThrow();
    expect(() => check(doc(row(col(callout(para())), col(para()))))).not.toThrow();
  });

  it("puts structural blocks inside a toggle body", () => {
    expect(() => check(doc(toggle("s", row(col(para()), col(para())), callout(para()))))).not.toThrow();
  });

  // The user's actual requirement: "theoretically infinite, pragmatically at
  // least three times". Three levels of rows, each inside the previous.
  it("nests column rows three levels deep", () => {
    const level3 = row(col(para("deepest")), col(para()));
    const level2 = row(col(level3), col(para()));
    const level1 = row(col(level2), col(para()));
    const json = doc(level1);
    expect(() => check(json)).not.toThrow();
    expect(depthOf(check(json))).toBeGreaterThanOrEqual(6); // row+column per level
  });

  it("nests a mixed tower five levels deep", () => {
    let node: any = para("bottom");
    for (const wrap of [container, callout, (x: any) => row(col(x), col(para())), container, callout]) {
      node = wrap(node);
    }
    expect(() => check(doc(node))).not.toThrow();
  });

  it("still refuses a column outside a row", () => {
    expect(() => check(doc(col(para())))).toThrow();
  });

  it("still refuses a non-column child in a row", () => {
    expect(() => check(doc({ type: "columnBlock", content: [para(), para()] }))).toThrow();
  });
});

describe("deeply nested content survives the round trip", () => {
  const strip = (v: any) => stripDefaults(v, schema);

  it("round-trips three levels of nested rows through HTML", () => {
    const json = doc(
      row(col(row(col(row(col(para("deep")), col(para("b")))), col(para("c")))), col(para("d")))
    );
    expect(strip(generateJSON(generateHTML(json, exts), exts))).toEqual(strip(json));
  });

  it("round-trips a callout inside a column inside a toggle", () => {
    const json = doc(toggle("outer", row(col(callout(para("inner"))), col(para("side")))));
    expect(strip(generateJSON(generateHTML(json, exts), exts))).toEqual(strip(json));
  });

  it("the schema guard accepts deeply nested documents", () => {
    const json = doc(row(col(row(col(callout(container(para("x")))), col(para()))), col(para())));
    expect(auditNoteRaw(JSON.stringify(json), schema).ok).toBe(true);
  });
});

describe("resize gutters reach nested rows", () => {
  // The decoration walk used to stop at the first row on the belief that "a
  // row can't contain another row" — true only because the UI refused to make
  // one. With nesting offered, stopping there leaves inner rows unresizable.
  it("places gutters in an inner row as well as the outer one", () => {
    const inner = row(col(para("a")), col(para("b")), col(para("c"))); // 2 gutters
    const outer = row(col(inner), col(para("d")));                     // 1 gutter
    const set = buildColumnDecorations(check(doc(outer)));
    expect(set.find().length).toBe(3);
  });

  it("counts gutters across three nested levels", () => {
    const l3 = row(col(para()), col(para()));            // 1
    const l2 = row(col(l3), col(para()));                // 1
    const l1 = row(col(l2), col(para()), col(para()));   // 2
    expect(buildColumnDecorations(check(doc(l1))).find().length).toBe(4);
  });
});
