// ─── The rule this file pins ─────────────────────────────────────────────────
//
// Ink capture is PER POINTER TYPE, decided by MarginInkLayer's native
// listeners on the scroll container (never by the canvas, which is
// pointer-events:none so links and text selection keep working):
//
//   pen   → always draws, margins layout on or off
//   touch → never draws (it navigates)
//   mouse → draws only when the wide-margins layout is on (`enabled`)
//
// Drawing used to be a MODE — a capturing canvas behind a "Margins" button —
// and these rules are what replaced it. A regression here reads as "my pen
// stopped working" or "I can't click anything", both silent.
//
// (.test.ts, not .tsx — vitest's include is *.test.ts — so the element is
// built with createElement rather than JSX.)

import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { createElement, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../lib/api", () => ({
  saveContent: vi.fn(async () => {}),
  readContent: vi.fn(async () => null),
}));

import { MarginInkLayer, type MarginInkHandle } from "./MarginInkLayer";

// happy-dom exposes ResizeObserver on its window but domSetup does not
// globalise it; the component reads the global.
(globalThis as any).ResizeObserver ??= (window as any).ResizeObserver
  ?? class { observe() {} unobserve() {} disconnect() {} };

// happy-dom has no 2D context; the paint loop only needs calls to not throw.
beforeAll(() => {
  const ctx: any = new Proxy(
    {},
    { get: (t: any, k) => (k in t ? t[k] : (t[k] = vi.fn())), set: (t: any, k, v) => ((t[k] = v), true) },
  );
  (window as any).HTMLCanvasElement.prototype.getContext = () => ctx;
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  root?.unmount();
  host?.remove();
  root = null;
});

async function mount(enabled: boolean) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const scroll = document.createElement("div");
  const content = document.createElement("div");
  scroll.appendChild(content);
  host.appendChild(scroll);
  const ink = createRef<MarginInkHandle>();
  root = createRoot(host);
  root.render(
    createElement(MarginInkLayer, {
      ref: ink,
      nodeId: "__test__",
      scrollEl: scroll as unknown as HTMLDivElement,
      contentEl: content as unknown as HTMLDivElement,
      enabled,
      tool: "pen",
      color: "#000",
    }),
  );
  // flush effects (listener attachment) — rAF/setTimeout(0) in domSetup
  await new Promise((r) => setTimeout(r, 25));
  return { scroll, ink };
}

function pev(type: string, pointerType: string, x: number, y: number) {
  const e = new (window as any).MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, buttons: 1 });
  Object.defineProperty(e, "pointerType", { value: pointerType });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e;
}

function strokeWith(scroll: HTMLElement, pointerType: string) {
  scroll.dispatchEvent(pev("pointerdown", pointerType, 10, 10));
  scroll.dispatchEvent(pev("pointermove", pointerType, 20, 20));
  scroll.dispatchEvent(pev("pointerup", pointerType, 20, 20));
}

describe("margin ink capture is per pointer type", () => {
  it("pen draws with the margins layout OFF — there is no mode to enter", async () => {
    const { scroll, ink } = await mount(false);
    strokeWith(scroll, "pen");
    expect(ink.current!.count()).toBe(1);
  });

  it("touch never draws — it navigates", async () => {
    const { scroll, ink } = await mount(true);
    strokeWith(scroll, "touch");
    expect(ink.current!.count()).toBe(0);
  });

  it("mouse does not draw on an ordinary read (text selection survives)", async () => {
    const { scroll, ink } = await mount(false);
    strokeWith(scroll, "mouse");
    expect(ink.current!.count()).toBe(0);
  });

  it("mouse draws once the wide-margins layout is on", async () => {
    const { scroll, ink } = await mount(true);
    strokeWith(scroll, "mouse");
    expect(ink.current!.count()).toBe(1);
  });
});
