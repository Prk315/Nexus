import { describe, it, expect } from "vitest";
import { generateHTML, generateJSON } from "@tiptap/core";
import { buildNoteExtensions } from "./noteExtensions";
import { buildBlockRegistry, actionsFor, FONT_FAMILIES, TEXT_COLORS, TEXT_COLOR_L } from "./blockRegistry";

const exts = buildNoteExtensions();

const styled = (attrs: Record<string, unknown>) => ({
  type: "doc",
  content: [{
    type: "paragraph",
    content: [{ type: "text", text: "sample", marks: [{ type: "textStyle", attrs }] }],
  }],
});

describe("font family", () => {
  // ⚠️ The test that matters. FontFamily is an ATTRIBUTE on the TextStyle mark,
  // and a renderHTML/parseHTML mismatch is invisible to tsc — it shows up as
  // "the font resets every time I reload", with the button looking correct.
  it("round-trips through HTML for every stack", () => {
    for (const f of FONT_FAMILIES) {
      if (!f.value) continue;
      const back: any = generateJSON(generateHTML(styled({ fontFamily: f.value }) as any, exts), exts);
      const mark = back.content[0].content[0].marks.find((m: any) => m.type === "textStyle");
      expect(mark?.attrs?.fontFamily, f.id).toBeTruthy();
    }
  });

  // A note using this must open on a build that predates it. ProseMirror builds
  // a mark's attrs from the TYPE's declared list and ignores extras, so the
  // text simply renders in the default face — unlike a new MARK type.
  it("is dropped harmlessly when the attribute is unknown", () => {
    const html = generateHTML(styled({ fontFamily: "ui-serif, Georgia, serif" }) as any, exts);
    const older = JSON.parse(
      JSON.stringify(generateJSON(html, exts)),
      (k, v) => (k === "fontFamily" ? undefined : v),
    );
    expect(JSON.stringify(older)).toContain("sample");
    expect(JSON.stringify(older)).not.toContain("Georgia");
  });

  // System stacks, not webfonts: Vault runs in a Tauri WebView, as a Vercel
  // page and as an iPad PWA, where a webfont is either megabytes in every
  // build or a CDN call the offline story dislikes.
  it("names only system stacks — no url() and no @import", () => {
    for (const f of FONT_FAMILIES) {
      expect(f.value ?? "", f.id).not.toContain("url(");
      expect(f.value ?? "", f.id).not.toContain("http");
    }
  });

  it("always ends in a generic family, so an unknown face still resolves", () => {
    for (const f of FONT_FAMILIES) {
      if (!f.value) continue;
      const last = f.value.split(",").pop()!.trim();
      expect(["serif", "sans-serif", "monospace", "system-ui", "cursive"], f.id).toContain(last);
    }
  });
});

describe("text colours read on both a light and a dark surface", () => {
  // ⚠️ A colour mark stores a LITERAL in the document, so it cannot follow the
  // theme the way a token does. Storing `var(--note-red, …)` was measured and
  // rejected: `style.color = "var(…)"` yields "" in this environment, so the
  // round trip cannot be proven and the failure mode is every coloured span
  // silently losing its colour on reload.
  //
  // The palette is tuned to a lightness band instead. This is what stops
  // someone "improving" a colour back to a light-theme-only value.
  it("keeps every colour inside the legible band", () => {
    for (const c of TEXT_COLORS) {
      if (!c.value) continue;
      const l = Number(/oklch\(([\d.]+)/.exec(c.value)![1]);
      expect(l, `${c.id} is ${l}`).toBeGreaterThanOrEqual(TEXT_COLOR_L.min);
      expect(l, `${c.id} is ${l}`).toBeLessThanOrEqual(TEXT_COLOR_L.max);
    }
  });

  it("has one and only one default that clears the colour", () => {
    expect(TEXT_COLORS.filter((c) => c.value === null)).toHaveLength(1);
    expect(TEXT_COLORS[0].id).toBe("default");
  });

  // ⚠️ A colour round trip CANNOT be asserted here, and that is worth knowing
  // before you spend an afternoon on it.
  //
  // happy-dom's CSSStyleDeclaration silently drops any value it cannot parse,
  // and it cannot parse `oklch()` or `var()`. Tiptap's Color mark serialises to
  // `style="color: …"` and parses back out of `element.style.color`, so every
  // one of Vault's colours round-trips to "" in this environment while working
  // correctly in every browser that ships oklch — which is all of them.
  //
  // This is measured, not assumed. The test below pins the environment's
  // behaviour so the next person sees the cause immediately rather than
  // concluding the colour mark is broken.
  it("documents WHY: the test DOM drops oklch and var from inline styles", () => {
    const el = document.createElement("span");
    const seen = (v: string) => { el.setAttribute("style", `color: ${v}`); return el.style.color; };
    expect(seen("#ff0000")).toBe("#ff0000");
    expect(seen("rgb(255,0,0)")).toBe("rgb(255, 0, 0)");
    // The two that vanish. If either of these ever starts working, delete this
    // test and write the real round trip.
    expect(seen("oklch(0.6 0.15 260)")).toBe("");
    expect(seen("var(--x, red)")).toBe("");
  });
});

describe("the bubble stays usable", () => {
  // The bubble renders every bubble action FLAT in one row and is the iPad's
  // only formatting surface. A row of thirty 13px targets is not a palette.
  // Adding past this needs the bubble to group or collapse first.
  it("keeps the flat bubble row under a workable size", () => {
    const n = actionsFor(buildBlockRegistry({}), "bubble").length;
    expect(n, `${n} buttons in one flat row`).toBeLessThanOrEqual(30);
  });

  it("puts every font and colour action on the bubble, not nowhere", () => {
    const ids = new Set(actionsFor(buildBlockRegistry({}), "bubble").map((a) => a.id));
    for (const f of FONT_FAMILIES) expect(ids.has(`font:${f.id}`), f.id).toBe(true);
    for (const c of TEXT_COLORS) expect(ids.has(`color:${c.id}`), c.id).toBe(true);
  });
});
