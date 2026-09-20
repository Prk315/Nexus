// Harness entry — see zoomtest.html. Now also a PERF rig: 400 sections, each
// with a block equation, at Kalkulus scale (~4000 math nodes book-wide is the
// real book; 400 here at one per section exercises the same lazy path). The
// driver measures mount time and how many equations rendered eagerly.
import { createRoot } from "react-dom/client";
import { ParsedViewer } from "./components/ParsedViewer";
import "./App.css";

const content = Array.from({ length: 400 }, (_, i) =>
  `<h2 id="sec-${i}">Section ${i}</h2>` +
  `<p id="para-${i}">paragraph ${i} — ` + "text ".repeat(40) + `</p>` +
  `<div data-type="block-math" data-latex="\\sum_{k=0}^{${i}} \\frac{x^k}{k!} \\le e^x"></div>` +
  `<p><img src="/vite.svg" alt="fig ${i}"></p>`,
).join("");

const t0 = performance.now();
createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <ParsedViewer content={content} onChange={() => {}} nodeId="__zoomtest__" />
  </div>,
);
requestAnimationFrame(() => requestAnimationFrame(() => {
  (window as any).__mountMs = performance.now() - t0;
}));
