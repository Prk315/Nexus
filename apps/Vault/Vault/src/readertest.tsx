// Harness entry — see readertest.html. Loads the REAL KollerFriedman I HTML
// into the real ParsedViewer, then RUNS ITS OWN TEST inside whatever engine
// opened it (the point: real iPadOS WebKit in the simulator, headless) and
// POSTs metrics to the sidecar on :8899. What it measures is exactly the
// user's complaint: can you interact — frame times during scroll, long
// tasks at open, images that actually loaded, math laziness.
import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ParsedViewer } from "./components/ParsedViewer";
import "./App.css";

const post = (data: unknown) =>
  fetch("http://localhost:8899/log", { method: "POST", body: JSON.stringify(data) }).catch(() => {});

async function autotest() {
  const t0 = performance.now();
  const longTasks: number[] = [];
  try {
    new PerformanceObserver(l => l.getEntries().forEach(e => longTasks.push(Math.round(e.duration))))
      .observe({ type: "longtask", buffered: true } as PerformanceObserverInit);
  } catch { /* longtask unsupported — frame deltas below still tell the story */ }

  // wait until the book is in
  let pc: HTMLElement | null = null;
  for (let i = 0; i < 120 && !pc; i++) {
    await new Promise(r => setTimeout(r, 500));
    pc = document.querySelector(".parsed-content");
    if (pc && pc.children.length < 100) pc = null;
  }
  if (!pc) { post({ fatal: "book never mounted" }); return; }
  const sc = document.querySelector(".parsed-scroll") as HTMLElement;
  post({ stage: "mounted", ms: Math.round(performance.now() - t0), blocks: pc.children.length });

  // scroll through the book in steps, measuring rAF frame deltas — the
  // "can I interact" number. 60fps = ~16ms; jank = spikes.
  const deltas: number[] = [];
  let last = performance.now();
  let raf = 0;
  const tick = () => { const n = performance.now(); deltas.push(n - last); last = n; raf = requestAnimationFrame(tick); };
  raf = requestAnimationFrame(tick);
  const H = sc.scrollHeight;
  for (let f = 0.02; f <= 0.5; f += 0.02) {
    sc.scrollTop = H * f;
    await new Promise(r => setTimeout(r, 250));
  }
  cancelAnimationFrame(raf);
  deltas.sort((a, b) => a - b);
  const q = (p: number) => Math.round(deltas[Math.floor(p * deltas.length)] || 0);

  // continuous flick: 2400 px/s for 6 s — the finger-scroll number, measured
  // separately from the teleport jumps above.
  const cd: number[] = [];
  sc.scrollTop = H * 0.55;
  await new Promise<void>(res => {
    let lastT = performance.now();
    const start = lastT;
    const step = () => {
      const n = performance.now();
      cd.push(n - lastT);
      sc.scrollTop += (n - lastT) * 2.4;
      lastT = n;
      if (n - start < 6000) requestAnimationFrame(step); else res();
    };
    requestAnimationFrame(step);
  });
  cd.sort((a, b) => a - b);
  const cq = (p: number) => Math.round(cd[Math.floor(p * cd.length)] || 0);

  // what materialised
  const imgs = [...pc.querySelectorAll("img")];
  const mathDone = pc.querySelectorAll("[data-math-done]").length;
  const mathTotal = pc.querySelectorAll('[data-type="block-math"],[data-type="inline-math"]').length;
  await new Promise(r => setTimeout(r, 1500));
  post({
    stage: "done",
    frames: { n: deltas.length, p50: q(0.5), p90: q(0.9), p99: q(0.99), worst: Math.round(deltas[deltas.length - 1] || 0) },
    flick: { n: cd.length, p50: cq(0.5), p90: cq(0.9), worst: Math.round(cd[cd.length - 1] || 0) },
    longTasks: longTasks.slice(0, 20),
    longTaskTotalMs: longTasks.reduce((a, b) => a + b, 0),
    imgs: {
      total: imgs.length,
      loaded: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
      failed: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
    },
    math: { total: mathTotal, rendered: mathDone },
    viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio },
    ua: navigator.userAgent.slice(0, 80),
  });
}

function Rig() {
  const [content, setContent] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("http://localhost:8899/pgm-1.html")
      .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
      .then(setContent)
      .catch(e => { setErr(String(e)); post({ fatal: "fixture: " + String(e) }); });
    autotest();
  }, []);
  if (err) return <div style={{ padding: 40 }}>fixture fetch failed: {err}</div>;
  if (content === null) return <div style={{ padding: 40 }}>loading real book…</div>;
  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <ParsedViewer content={content} onChange={() => {}} nodeId="__readertest__" />
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Rig />);
