// Learn & Retain v2 — "the observatory" shell (P1, read-only).
// Replaces the /conceptmap.html iframe with a native surface: the 3D living
// map (Map3D), a HUD (course filter · lens switcher · legend) and the node
// inspector. Data comes from loadLearnGraph() in ./data — one load per mount
// plus an explicit manual refresh; no polling, no realtime, no writes.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./learn.css";
import { loadLearnGraph } from "./data";
import type { LearnGraph, LearnNode } from "./data";
import {
  LENSES,
  LENS_LABEL,
  LR,
  courseHue,
  heatColor,
  mixHex,
} from "./palette";
import type { Lens } from "./palette";
import { Map3D } from "./Map3D";
import { InspectorPanel } from "./InspectorPanel";

export interface LearnModeProps {
  /** True while appMode === "learn". Drives Map3D's pause/resume and gates the
   *  Escape keybinding so it can't fire while the user is back in Vault. */
  active: boolean;
}

type LoadStatus = "loading" | "ready" | "error";

/** d3 replaces link endpoint strings with node objects after the first tick —
 *  counting code must accept both forms. */
function idOf(x: unknown): string {
  return typeof x === "object" && x !== null ? (x as { id: string }).id : (x as string);
}

/** Course chip label: derive a short form (first 2–3 significant words), never
 *  a hardcoded c_id → label map, so a fourth course doesn't render blank.
 *  "Introduction to Probability and Statistics" → "Probability",
 *  "Linear Algebra" → "Linear Algebra", "Database Management Systems" → "Database". */
const STOP_WORDS = new Set([
  "introduction", "intro", "to", "an", "a", "the", "of", "and", "for", "in", "on",
]);
function shortTitle(title: string): string {
  const words = title.split(/\s+/).filter((w) => w && !STOP_WORDS.has(w.toLowerCase()));
  if (words.length === 0) return title;
  const two = words.slice(0, 2).join(" ");
  return two.length <= 16 ? two : words[0];
}

/** Small legend strip so each lens's colour/size mapping is legible — without
 *  it the heat lens (mostly dark, honestly, at a 24 h half-life) looks broken. */
function LensLegend({ lens }: { lens: Lens }) {
  // Amber (course 2) as the exemplar hue for ramps that end in "the course hue".
  const exemplar = courseHue(2);
  let stops: { color: string; size: number; label: string }[];
  let caption: string;
  switch (lens) {
    case "mastery":
      stops = [
        { color: LR.inert, size: 8, label: "never practiced" },
        { color: mixHex(LR.slate, exemplar, 0.5), size: 8, label: "learning" },
        { color: mixHex(LR.slate, exemplar, 1), size: 8, label: "mastered" },
      ];
      caption = "colour = mastery (toward the course hue) · size = evidence behind it";
      break;
    case "heat":
      stops = [
        { color: heatColor(0), size: 8, label: "cold" },
        { color: heatColor(0.5), size: 8, label: "warm" },
        { color: heatColor(1), size: 8, label: "just reviewed" },
      ];
      caption = "decays with a 24 h half-life — a mostly dark field is honest";
      break;
    case "importance":
      stops = [
        { color: exemplar, size: 5, label: "minor" },
        { color: exemplar, size: 9, label: "notable" },
        { color: exemplar, size: 14, label: "foundation" },
      ];
      caption = "hue = course · size = PageRank importance";
      break;
    case "retention":
      stops = [
        { color: LR.unretained, size: 8, label: "not yet retained" },
        { color: exemplar, size: 8, label: "retained" },
      ];
      caption = "concepts of mastered units glow in their course hue";
      break;
  }
  return (
    <div className="learn-hud-row learn-legend">
      {stops.map((s) => (
        <span key={s.label} className="learn-legend-stop">
          <span
            className="learn-legend-dot"
            style={{ background: s.color, width: s.size, height: s.size }}
          />
          {s.label}
        </span>
      ))}
      <span className="learn-legend-caption">{caption}</span>
    </div>
  );
}

export function LearnMode({ active }: LearnModeProps) {
  const [graph, setGraph] = useState<LearnGraph | null>(null);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [lens, setLens] = useState<Lens>("mastery");
  const [courseFilter, setCourseFilter] = useState<number | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setStatus("loading");
    setError(null);
    try {
      const g = await loadLearnGraph(ctrl.signal);
      if (ctrl.signal.aborted) return;
      setGraph(g);
      setStatus("ready");
    } catch (e) {
      if (ctrl.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setStatus("error");
    }
  }, []);

  // Load once on mount. main.tsx renders inside <React.StrictMode>, which in
  // dev runs mount → cleanup → mount again: the guard + cleanup pair below
  // means the first (immediately aborted) run costs nothing and exactly one
  // load survives — without ever double-firing the six paginated reads in
  // parallel, and while still aborting in-flight requests on a real unmount.
  const didRunRef = useRef(false);
  useEffect(() => {
    if (didRunRef.current) return;
    didRunRef.current = true;
    load();
    return () => {
      // StrictMode's simulated unmount lands here too; resetting the guard
      // lets the second mount load again after this run's requests abort.
      didRunRef.current = false;
      abortRef.current?.abort();
    };
  }, [load]);

  // Manual refresh. This produces new node objects, which restarts the d3
  // simulation and resets the camera — the accepted cost of an explicit
  // user action (it is why there is no polling).
  const refresh = useCallback(() => {
    if (status === "loading") return;
    void load();
  }, [status, load]);

  // Escape clears the selection. Registered only while active && selectedId,
  // so it can never shadow Vault's useKeyBindings from the other appMode.
  useEffect(() => {
    if (!active || !selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, selectedId]);

  const selected: LearnNode | null =
    (selectedId && graph?.byId.get(selectedId)) || null;

  const { visibleCount, visibleLinks } = useMemo(() => {
    if (!graph) return { visibleCount: 0, visibleLinks: 0 };
    if (courseFilter === "all")
      return { visibleCount: graph.nodes.length, visibleLinks: graph.links.length };
    let n = 0;
    for (const node of graph.nodes) if (node.courseId === courseFilter) n++;
    let l = 0;
    for (const link of graph.links) {
      const s = graph.byId.get(idOf(link.source));
      const t = graph.byId.get(idOf(link.target));
      if (s?.courseId === courseFilter && t?.courseId === courseFilter) l++;
    }
    return { visibleCount: n, visibleLinks: l };
  }, [graph, courseFilter]);

  if (status === "error") {
    return (
      <div className="learn-root">
        <div className="learn-panel">
          <div className="learn-panel-title">The map couldn't load</div>
          <div className="learn-panel-detail">{error}</div>
          <button className="learn-retry" onClick={refresh}>Retry</button>
        </div>
      </div>
    );
  }

  if (status === "loading" || !graph) {
    return (
      <div className="learn-root">
        <div className="learn-panel">
          <div className="learn-panel-title">Charting 1,067 concepts…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="learn-root">
      <Map3D
        graph={graph}
        lens={lens}
        courseFilter={courseFilter}
        selectedId={selectedId}
        onSelect={setSelectedId}
        active={active}
      />

      <div className="learn-hud">
        <div className="learn-hud-row learn-courses">
          <button
            className={`learn-chip${courseFilter === "all" ? " active" : ""}`}
            style={{ "--chip": LR.fgSoft } as React.CSSProperties}
            title="All courses"
            onClick={() => setCourseFilter("all")}
          >
            All
            <span className="learn-chip-n">{graph.nodes.length}</span>
          </button>
          {graph.courses.map((c) => (
            <button
              key={c.cId}
              className={`learn-chip${courseFilter === c.cId ? " active" : ""}`}
              style={{ "--chip": courseHue(c.cId) } as React.CSSProperties}
              title={c.title}
              onClick={() => setCourseFilter(c.cId)}
            >
              <span className="learn-chip-dot" />
              {shortTitle(c.title)}
              <span className="learn-chip-n">{c.conceptCount}</span>
            </button>
          ))}
        </div>

        <div className="learn-hud-row learn-lenses">
          {LENSES.map((l) => (
            <button
              key={l}
              className={`learn-lens${lens === l ? " active" : ""}`}
              onClick={() => setLens(l)}
            >
              {LENS_LABEL[l]}
            </button>
          ))}
        </div>

        <div className="learn-hud-row learn-meta">
          <span>
            {visibleCount.toLocaleString()} of {graph.nodes.length.toLocaleString()} concepts
            {" · "}
            {visibleLinks.toLocaleString()} links
            {" · "}
            as of{" "}
            {graph.loadedAt.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <button
            className="learn-refresh"
            title="Reload from Supabase (restarts the layout)"
            onClick={refresh}
            disabled={status !== "ready"}
          >
            ↻
          </button>
        </div>

        <LensLegend lens={lens} />
      </div>

      {selected && (
        <InspectorPanel
          node={selected}
          graph={graph}
          onNavigate={setSelectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
