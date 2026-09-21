// Harness entry for MarginInkLayer — see inktest.html. Mirrors ParsedViewer's
// structure exactly: a positioned wrap, a scrolling column, and the canvas as
// an absolutely-inset sibling. The probe object on window is what an
// automated driver asserts against.
import { createRoot } from "react-dom/client";
import { useRef, useState } from "react";
import { MarginInkLayer, type MarginInkHandle } from "./components/MarginInkLayer";
import "./App.css";

function Harness() {
  const [tool, setTool] = useState<"pen" | "highlighter" | "eraser">("pen");
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null);
  const ink = useRef<MarginInkHandle>(null);
  (window as any).__harness = {
    setTool,
    undo: () => ink.current?.undo(),
    count: () => ink.current?.count() ?? -1,
  };
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: 8, gap: 8, display: "flex", font: "14px sans-serif" }}>
        {(["pen", "highlighter", "eraser"] as const).map(t => (
          <button key={t} data-tool={t} onClick={() => setTool(t)}
            style={{ fontWeight: tool === t ? 700 : 400 }}>{t}</button>
        ))}
        <span id="count-probe" />
      </div>
      <div className="parsed-scroll-wrap" style={{ flex: 1 }}>
        <div className="parsed-scroll parsed-margins-on" ref={setScrollEl}>
          <div className="parsed-content" ref={setContentEl}
            style={{ height: 4000, background: "#fffef9" }}>
            {Array.from({ length: 40 }, (_, i) => (
              <p key={i} style={{ margin: "60px 40px", font: "16px serif" }}>
                paragraph {i} — fake book line for ink anchoring
              </p>
            ))}
          </div>
        </div>
        <MarginInkLayer ref={ink} nodeId="__inktest__" scrollEl={scrollEl}
          contentEl={contentEl} enabled tool={tool} color="#1a4fd6" />
      </div>
    </div>
  );
}
// Self-test (?auto=1): synthesise a pen stroke on the scroll container and
// read the canvas back — asserts the whole chain (per-pointer capture →
// placement in the scroll layer → doc-coord painting) in real WebKit, and
// that the ink RIDES THE SCROLL: after scrolling, the same document point
// must still be inked. POSTs to the :8899 sidecar like readertest.
async function autotest() {
  if (!location.search.includes("auto=1")) return;
  const post = (d: unknown) =>
    fetch("http://localhost:8899/log", { method: "POST", body: JSON.stringify(d) }).catch(() => {});
  const frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  await new Promise(r => setTimeout(r, 800));
  const sc = document.querySelector(".parsed-scroll") as HTMLElement;
  const cv = document.querySelector(".margin-ink-canvas") as HTMLCanvasElement;
  if (!sc || !cv) { post({ ink: "missing elements" }); return; }
  const r = sc.getBoundingClientRect();
  const pev = (type: string, x: number, y: number) =>
    new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y,
      pointerId: 7, pointerType: "pen", pressure: 0.6, buttons: 1 });
  sc.dispatchEvent(pev("pointerdown", r.left + 100, r.top + 100));
  for (let i = 1; i <= 20; i++) sc.dispatchEvent(pev("pointermove", r.left + 100 + i * 5, r.top + 100 + i * 3));
  sc.dispatchEvent(pev("pointerup", r.left + 200, r.top + 160));
  await frame();
  const sample = (vx: number, vy: number) => {
    const cr = cv.getBoundingClientRect();
    const sx = Math.round((vx - cr.left) * (cv.width / cr.width));
    const sy = Math.round((vy - cr.top) * (cv.height / cr.height));
    const d = cv.getContext("2d")!.getImageData(Math.max(0, sx - 8), Math.max(0, sy - 8), 16, 16).data;
    let hit = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { hit = true; break; }
    return hit;
  };
  const midX = r.left + 150, midY = r.top + 130;
  const inked = sample(midX, midY);
  sc.scrollTop += 300;
  await frame(); await frame();
  const inkedAfterScroll = sample(midX, midY - 300);
  post({ stage: "ink", count: (window as any).__harness.count(), inked, inkedAfterScroll });
}
autotest();
createRoot(document.getElementById("root")!).render(<Harness />);
