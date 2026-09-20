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
createRoot(document.getElementById("root")!).render(<Harness />);
