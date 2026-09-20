// Harness entry for the zoom-anchoring fix — see zoomtest.html. A fake book
// of 300 identifiable paragraphs; the driver scrolls deep, zooms, and asserts
// the same paragraph still tops the viewport.
import { createRoot } from "react-dom/client";
import { ParsedViewer } from "./components/ParsedViewer";
import "./App.css";

const content = Array.from({ length: 300 }, (_, i) =>
  `<h2 id="sec-${i}">Section ${i}</h2><p id="para-${i}">paragraph ${i} — ` +
  "text ".repeat(30 + (i % 5) * 10) + "</p>",
).join("");

createRoot(document.getElementById("root")!).render(
  <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
    <ParsedViewer content={content} onChange={() => {}} nodeId="__zoomtest__" />
  </div>,
);
