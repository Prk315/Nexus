import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import katex from "katex";
import { buildNoteExtensions, noteSchema } from "./noteExtensions";
import { auditNoteRaw } from "../lib/noteSchemaGuard";
import { KATEX_OPTS } from "../lib/katexShared";
import {
  MATH_GROUPS, MATH_GROUP_IDS, insertMathSymbol,
  setActiveMathField, clearActiveMathField, getActiveMathField,
  type MathFieldHandle,
} from "../lib/mathToolbar";

const schema = noteSchema();
const exts = buildNoteExtensions();

const doc = (...content: any[]) => ({ type: "doc", content });
const para = (...content: any[]) => ({ type: "paragraph", content });

describe("⚠️ the schema is unchanged by moving to node views", () => {
  // `Mathematics` was swapped for `InlineMath` + `BlockMath` so the nodes could
  // get a custom node view. That wrapper is nothing but
  // `addExtensions: () => [blockMath, inlineMath]`, so this must be a pure
  // rendering change — if it were not, every stored note containing maths would
  // be at risk, and an unknown node type BLANKS a document.
  it("still declares both math node types, by the same names", () => {
    expect(schema.nodes.inlineMath).toBeTruthy();
    expect(schema.nodes.blockMath).toBeTruthy();
  });

  it("keeps `latex` as the attribute the documents are written with", () => {
    for (const name of ["inlineMath", "blockMath"]) {
      expect(Object.keys(schema.nodes[name].spec.attrs ?? {}), name).toContain("latex");
    }
  });

  it("parses a note written before this change", () => {
    const json = doc(
      para({ type: "text", text: "before " }, { type: "inlineMath", attrs: { latex: "x^2" } }),
      { type: "blockMath", attrs: { latex: "\\int_0^1 x\\,dx" } },
    );
    expect(auditNoteRaw(JSON.stringify(json), schema).ok).toBe(true);
    expect(() => schema.nodeFromJSON(json).check()).not.toThrow();
  });

  it("round-trips both kinds through HTML with the latex intact", () => {
    const json = doc(
      para({ type: "inlineMath", attrs: { latex: "a+b" } }),
      { type: "blockMath", attrs: { latex: "\\frac{1}{2}" } },
    );
    const back = JSON.stringify(generateJSON(generateHTML(json as any, exts), exts));
    expect(back).toContain("a+b");
    expect(back).toContain("\\\\frac{1}{2}");
  });

  it("accepts an empty formula, which is what an insert now creates", () => {
    // Inserting used to seed "x" — a placeholder you must delete first. An
    // empty node has to be representable for the empty-field start to work.
    const json = doc(para({ type: "inlineMath", attrs: { latex: "" } }));
    expect(() => schema.nodeFromJSON(json).check()).not.toThrow();
    expect(auditNoteRaw(JSON.stringify(json), schema).ok).toBe(true);
  });
});

describe("the palette", () => {
  it("has unique group ids and no empty group", () => {
    expect(new Set(MATH_GROUP_IDS).size).toBe(MATH_GROUP_IDS.length);
    for (const g of MATH_GROUPS) expect(g.items.length, g.id).toBeGreaterThan(0);
  });

  // A button labelled `\frac` tells you less than a fraction, so every entry
  // draws its own preview. One that cannot render would show its fallback
  // label instead — legible, but it means the palette is lying about what it
  // inserts, so they are checked here rather than discovered on screen.
  it("renders every preview with the document's own KaTeX settings", () => {
    for (const g of MATH_GROUPS) {
      for (const item of g.items) {
        expect(() => katex.renderToString(item.preview, { ...KATEX_OPTS, displayMode: false }),
          `${g.id}/${item.label}`).not.toThrow();
      }
    }
  });

  it("inserts something for every entry, and labels all of them", () => {
    for (const g of MATH_GROUPS) {
      for (const item of g.items) {
        expect(item.latex.length, `${g.id}/${item.label}`).toBeGreaterThan(0);
        expect(item.label.trim(), `${g.id}/${item.latex}`).not.toBe("");
      }
    }
  });

  it("uses MathLive's placeholder so the caret lands in the first hole", () => {
    // Constructs with holes must say so; a `\frac{}{}` with no placeholder
    // leaves the caret after the fraction rather than inside it.
    const frac = MATH_GROUPS[0].items.find((i) => i.label === "Fraction")!;
    expect(frac.latex).toContain("#?");
  });
});

describe("the active-field registry", () => {
  const field = (): MathFieldHandle & { inserted: string[] } => {
    const inserted: string[] = [];
    return { inserted, insert: (l) => inserted.push(l), focus: () => {}, getValue: () => "" };
  };

  it("inserts into whichever field is registered", () => {
    const f = field();
    setActiveMathField(f);
    expect(insertMathSymbol("\\alpha")).toBe(true);
    expect(f.inserted).toEqual(["\\alpha"]);
    clearActiveMathField(f);
  });

  it("reports false rather than silently doing nothing when none is focused", () => {
    const f = field();
    setActiveMathField(f);
    clearActiveMathField(f);
    expect(insertMathSymbol("\\beta")).toBe(false);
  });

  // ⚠️ The trap the registry exists to avoid. Two fields hand over on focus —
  // the new one registers BEFORE the old one's blur fires — so a blur handler
  // that cleared unconditionally would wipe the field that had just taken
  // over, and the toolbar would insert into nothing while looking alive.
  it("clears by identity, so a late blur cannot wipe the field that took over", () => {
    const first = field();
    const second = field();
    setActiveMathField(first);
    setActiveMathField(second);   // focus moves
    clearActiveMathField(first);  // first's blur arrives late
    expect(getActiveMathField()).toBe(second);
    expect(insertMathSymbol("\\gamma")).toBe(true);
    expect(second.inserted).toEqual(["\\gamma"]);
    expect(first.inserted).toEqual([]);
    clearActiveMathField(second);
  });
});
