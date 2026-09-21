// Harness for PdfParsedPanel — the REAL panel over the REAL KollerFriedman I
// fixture (:8899 sidecar), with a fixture companion whose chapter map is the
// production one. No PDF and no auth needed: the panel's whole job is the
// parsed side, and `load` is injectable.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PdfParsedPanel } from "./components/PdfParsedPanel";
import type { Companion } from "./lib/hybridPdf";
import "./App.css";
import "katex/dist/katex.min.css";

const post = (data: unknown) =>
  fetch("http://localhost:8899/log", { method: "POST", body: JSON.stringify(data) }).catch(() => {});

const CH: Record<string, [number, number]> = {
  pgm_ch01: [38, 51], pgm_ch02: [52, 81], pgm_ch03: [82, 139], pgm_ch04: [140, 193],
  pgm_ch05: [194, 235], pgm_ch06: [236, 283], pgm_ch07: [284, 297], pgm_ch08: [298, 323],
  pgm_ch09: [324, 381], pgm_ch10: [382, 417], pgm_ch11a: [418, 470], pgm_ch11b: [471, 523],
  pgm_ch12: [524, 587], pgm_ch13: [588, 641],
};
const companion: Companion = { v: 1, parsed: [{ node: "fixture-pgm-1", chapters: CH }] };

async function load(id: string): Promise<string | null> {
  if (id === "fixture-pgm-1") {
    const r = await fetch(`http://localhost:8899/pgm-1.html?v=${Date.now()}`);
    return r.ok ? r.text() : null;
  }
  if (id.endsWith("_concepts")) {
    const r = await fetch(`http://localhost:8899/pgm-1-concepts.json?v=${Date.now()}`);
    return r.ok ? r.text() : null;
  }
  return null;
}

function Rig() {
  const [page, setPage] = useState(340); // 0-based -> printed p.341, mid ch09
  (window as any).__hybrid = { setPage, post };
  return (
    <div style={{ height: "100vh", display: "flex" }}>
      <div style={{ flex: 1, display: "grid", placeItems: "center", font: "14px system-ui", color: "#666" }}>
        (pdf would be here) — page {page + 1}
        <button onClick={() => setPage(p => p + 1)} style={{ marginLeft: 8 }}>next page</button>
      </div>
      <PdfParsedPanel
        companion={companion}
        currentPage={page}
        onGoToPage={(p) => { setPage(p); post({ goto: p }); }}
        load={load}
        initialTab={(new URLSearchParams(location.search).get("tab") as "page" | "concepts" | "search") || "page"}
      />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Rig />);
