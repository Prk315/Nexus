/**
 * Learn & Retain observatory — the living 3D map (P1, read-only).
 *
 * Renders the full 1,067-concept multi-course DAG as three constellations
 * (zero cross-course prereq edges exist — a per-course anchor force keeps the
 * disconnected components from escaping to infinity). Four lenses map memory
 * state onto colour + size; selection lights up the prereq/unlock
 * neighbourhood; course filtering hides via nodeVisibility so the simulation
 * is never restarted.
 *
 * Import pattern copied from ForceGraphView.tsx: `three` arrives transitively
 * and is pinned to ONE instance by vite.config.ts's resolve.dedupe — do not
 * add it to package.json or touch vite.config.ts.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { MIN_EVIDENCE, type LearnGraph, type LearnNode } from "./data";
import { LR, clamp01, courseHue, heatColor, mixHex, type Lens } from "./palette";

const NODE_REL_SIZE = 3;
/** Always-on labels above this importance → 60 nodes today (9 c1 + 38 c2 + 13 c3). */
const LABEL_IMPORTANCE_MIN = 0.25;

const ANCHOR_STRENGTH = 0.035;
// Equilateral triangle in the XZ plane, ~540 units on a side. Assigned by
// ascending c_id so the layout is stable across reloads.
const ANCHOR_POINTS = [
  { x:    0, y: 0, z: -360 },
  { x:  312, y: 0, z:  180 },
  { x: -312, y: 0, z:  180 },
];
// Courses beyond the third fall back to the origin (they'll pile up, which is
// the correct visible signal that ANCHOR_POINTS needs another entry).
const ANCHOR_FALLBACK = { x: 0, y: 0, z: 0 };

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** d3 replaces link endpoint strings with node objects after the first tick;
 *  code that assumes one form breaks after the sim warms up. */
function idOf(x: any): string {
  return typeof x === "object" && x !== null ? x.id : x;
}

function isTouching(l: any, selectedId: string | null): boolean {
  if (!selectedId) return false;
  return idOf(l.source) === selectedId || idOf(l.target) === selectedId;
}

// ── Per-lens node mapping (§B.3 of the build brief — exact) ─────────────────

function nodeValFor(n: LearnNode, lens: Lens): number {
  switch (lens) {
    case "mastery":    return 1 + 7 * clamp01(((n.confidence ?? 0) - 2) / 18);
    case "heat":       return 1 + 5 * clamp01(n.heatNow);
    case "importance": return 1 + 26 * clamp01(n.importance); // linear on purpose; drama is the point
    case "retention":  return n.retained ? 5 : 1;
  }
}

function nodeColorFor(n: LearnNode, lens: Lens): string {
  switch (lens) {
    case "mastery":
      return n.mastery == null ? LR.inert : mixHex(LR.slate, courseHue(n.courseId), n.mastery);
    case "heat":
      return n.heatNow <= 0 ? LR.ash : heatColor(n.heatNow);
    case "importance":
      return courseHue(n.courseId); // constant per course; all signal is in mass
    case "retention":
      return n.retained ? courseHue(n.courseId) : LR.unretained;
  }
}

function glowTest(n: LearnNode, lens: Lens): boolean {
  switch (lens) {
    case "mastery":    return (n.mastery ?? 0) >= 0.8 && (n.confidence ?? 0) >= MIN_EVIDENCE;
    case "heat":       return n.heatNow >= 0.55;
    case "importance": return n.importance >= 0.5;
    case "retention":  return n.retained;
  }
}

function radiusFor(n: LearnNode, lens: Lens): number {
  // In 3D, sphere radius = cbrt(val) × nodeRelSize.
  return Math.cbrt(nodeValFor(n, lens)) * NODE_REL_SIZE;
}

// One shared glow texture: a 64×64 radial white gradient. Created once and
// lazily (module import must not touch the DOM); only the SpriteMaterial is
// per-node (needed for per-node colour) — ≤ ~200 materials at the §B.3/§B.4
// thresholds.
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (!glowTexture) {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const ctx = c.getContext("2d")!;
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    glowTexture = new THREE.CanvasTexture(c);
  }
  return glowTexture;
}

// ── WebGL failure handling ──────────────────────────────────────────────────

/** Local copy — App.tsx's detectWebGL is module-private, and exporting it
 *  would churn App.tsx. ForceGraph3D throws SYNCHRONOUSLY on context-creation
 *  failure, which white-screens before a boundary can help, so this runs
 *  before the component is ever mounted. */
function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/** Copy of ForceGraphView's WebGLErrorBoundary, renamed. No 2D fallback here —
 *  the fallback is a dark message panel pointing at the old static map. */
class MapErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[learn] 3D map failed:", error);
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

function FallbackPanel() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        padding: 32,
        color: LR.fgSoft,
        background: LR.void,
        fontSize: 14,
        lineHeight: 1.6,
      }}
    >
      <div>
        The 3D map couldn't start (WebGL unavailable).
        <br />
        The previous static map is still at <code>/conceptmap.html</code>.
      </div>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export interface Map3DProps {
  graph: LearnGraph;
  lens: Lens;
  courseFilter: number | "all";
  selectedId: string | null;
  onSelect: (conceptId: string | null) => void;
  /** False while the Learn tab is hidden — pauses the render loop so at most
   *  one WebGL context is animating (the native replacement for the old
   *  iframe postMessage visibility handshake). */
  active: boolean;
}

export function Map3D({ graph, lens, courseFilter, selectedId, onSelect, active }: Map3DProps) {
  const fgRef = useRef<any>(undefined);
  const hostRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<SpriteText | null>(null);

  const webglOk = useMemo(() => detectWebGL(), []);

  // Always points at the latest nodes so the anchor-force closure stays fresh.
  const nodesRef = useRef<LearnNode[]>(graph.nodes);
  nodesRef.current = graph.nodes;

  // Per-course anchor targets, assigned by ascending c_id.
  const anchors = useMemo(() => {
    const m = new Map<number, { x: number; y: number; z: number }>();
    const ids = graph.courses.map((c) => c.cId).sort((a, b) => a - b);
    ids.forEach((cId, i) => m.set(cId, ANCHOR_POINTS[i] ?? ANCHOR_FALLBACK));
    return m;
  }, [graph]);
  const anchorsRef = useRef(anchors);
  anchorsRef.current = anchors;

  // Keyed on LearnGraph identity ONLY — a fresh object literal every render
  // would restart the 1067-node simulation on every keystroke elsewhere.
  const graphData = useMemo(
    () => ({ nodes: graph.nodes, links: graph.links }),
    [graph],
  );

  // ── Sizing: ForceGraph3D defaults to window dimensions, which overflows
  // below NexusHeader. Measure the container instead.
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      // ⚠️ While the Learn host is display:none the observer reports 0×0.
      // Committing that would unmount ForceGraph3D and destroy the simulation —
      // exactly what keeping the component mounted is supposed to prevent.
      if (width > 1 && height > 1) setSize({ w: Math.round(width), h: Math.round(height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ready = webglOk && size.w > 1;

  // ── Pause/resume with tab visibility (at most one animating GL context).
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (active) fg.resumeAnimation?.();
    else fg.pauseAnimation?.();
  }, [active, ready]);

  // ── Forces. Deferred-applyForces pattern copied from ForceGraphView.tsx:
  // kapsule assigns state.layout on a 1ms debounce after comp(domEl); React's
  // useEffect fires earlier via MessageChannel, and calling
  // d3ReheatSimulation() first flips engineRunning=true against an undefined
  // layout → crash in layoutTick on the next frame. The 50ms re-poll pushes us
  // past the debounce.
  useEffect(() => {
    if (!webglOk) return;
    let retryId: ReturnType<typeof setTimeout>;

    function applyForces() {
      const fg = fgRef.current as any;
      if (!fg?.d3Force || nodesRef.current.length === 0) {
        retryId = setTimeout(applyForces, 50);
        return;
      }
      fg.d3Force("charge")?.strength(-55);
      fg.d3Force("link")?.distance(34);
      fg.d3Force("center", null); // the anchor force replaces centering
      // The anchor force is load-bearing, not decorative: the three courses
      // share ZERO cross-course prereq edges (verified), so under pure charge
      // repulsion the three components escape to infinity and zoomToFit
      // renders three specks. Same shape as ForceGraphView's cluster force.
      fg.d3Force("courseAnchor", (alpha: number) => {
        for (const n of nodesRef.current) {
          const a = anchorsRef.current.get(n.courseId ?? -1);
          if (!a) continue;
          n.vx = (n.vx ?? 0) + (a.x - (n.x ?? 0)) * ANCHOR_STRENGTH * alpha;
          n.vy = (n.vy ?? 0) + (a.y - (n.y ?? 0)) * ANCHOR_STRENGTH * alpha;
          n.vz = (n.vz ?? 0) + (a.z - (n.z ?? 0)) * ANCHOR_STRENGTH * alpha;
        }
      });
      fg.d3ReheatSimulation();
    }

    retryId = setTimeout(applyForces, 50);
    return () => clearTimeout(retryId);
  }, [graph, webglOk]);

  // ── Hover sprite teardown (shared by onNodeHover, lens change, unmount).
  const clearHoverSprite = useCallback(() => {
    const prev = hoverRef.current;
    if (prev) {
      prev.parent?.remove(prev);
      (prev.material as THREE.Material | undefined)?.dispose?.();
      hoverRef.current = null;
    }
  }, []);

  // A lens switch replaces every node's __threeObj and would orphan a live
  // hover sprite; the cleanup also runs on unmount.
  useEffect(() => {
    return () => {
      clearHoverSprite();
      document.body.style.cursor = "";
    };
  }, [lens, clearHoverSprite]);

  // ── Per-lens accessors. react-force-graph only re-reads an accessor when
  // its function identity changes, so these are keyed on [lens].
  const nodeVal = useCallback((raw: any) => nodeValFor(raw as LearnNode, lens), [lens]);
  const nodeColor = useCallback((raw: any) => nodeColorFor(raw as LearnNode, lens), [lens]);

  // Always-on labels (importance ≥ 0.25 → 60 nodes) + per-lens glow halos.
  // nodeThreeObjectExtend means the returned group is added ALONGSIDE the
  // default sphere — nodeColor/nodeVal keep working. Return null for ordinary
  // nodes (plain sphere, nothing else).
  const nodeThreeObject = useCallback(
    (raw: any): THREE.Object3D | undefined => {
      const n = raw as LearnNode;
      const wantsLabel = n.importance >= LABEL_IMPORTANCE_MIN;
      const wantsGlow = glowTest(n, lens);
      if (!wantsLabel && !wantsGlow) return undefined;

      const group = new THREE.Group();
      const radius = radiusFor(n, lens);

      if (wantsGlow) {
        const spr = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: getGlowTexture(), // module-scope, built once
            color: new THREE.Color(nodeColorFor(n, lens)),
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        spr.scale.setScalar(radius * 6);
        group.add(spr);
      }
      if (wantsLabel) {
        const s = new SpriteText(truncate(n.title, 40));
        s.textHeight = 4;
        s.color = LR.fgSoft;
        s.material.depthWrite = false; // keep depthTest ON — 60 labels floating
        s.position.y = radius + 4;     // over the scene reads as noise
        group.add(s);
      }
      return group;
    },
    [lens],
  );

  // Hover label, imperative — putting hoveredId in nodeThreeObject's deps
  // would regenerate all 1067 objects on every mouse move.
  const onNodeHover = useCallback(
    (raw: any) => {
      // tear down the previous hover sprite first
      clearHoverSprite();
      if (!raw) {
        document.body.style.cursor = "";
        return;
      }
      document.body.style.cursor = "pointer";
      // __threeObj is semi-private but stable (three-forcegraph dist:262,1090).
      // The guard is what makes it safe: if a future version renames it, hover
      // labels silently stop and nothing crashes.
      const host = (raw as any).__threeObj as THREE.Object3D | undefined;
      if (!host) return; // graceful: no label, no crash
      const s = new SpriteText(truncate(raw.title, 48));
      s.textHeight = 6;
      s.color = LR.fg;
      s.backgroundColor = "rgba(5,6,10,0.78)";
      s.padding = 2;
      s.borderRadius = 2;
      s.material.depthTest = false; // hover label always on top
      s.position.y = radiusFor(raw as LearnNode, lens) + 7;
      host.add(s);
      hoverRef.current = s;
    },
    [lens, clearHoverSprite],
  );

  // ── Links: near-invisible baseline; the selected node's neighbourhood is
  // the only thing that snaps into focus (blue = stands-on, green = unlocks).
  const linkColor = useCallback(
    (l: any) => {
      if (!selectedId) return LR.link;
      const s = idOf(l.source), t = idOf(l.target);
      if (t === selectedId) return LR.linkPrereq; // incoming: stands on
      if (s === selectedId) return LR.linkUnlock; // outgoing: unlocks
      return LR.link;
    },
    [selectedId],
  );
  const linkWidth = useCallback(
    (l: any) => (isTouching(l, selectedId) ? 2.2 : 0.5),
    [selectedId],
  );
  const linkArrowLength = useCallback(
    (l: any) => (isTouching(l, selectedId) ? 4 : 0),
    [selectedId],
  );

  // ── Course filter: hide, never rebuild graphData — a rebuild restarts the
  // 1067-node simulation and throws away every position. Hidden constellations
  // keep exerting their forces, so switching back is instantaneous.
  const nodeVisibility = useCallback(
    (n: any) => courseFilter === "all" || n.courseId === courseFilter,
    [courseFilter],
  );
  const linkVisibility = useCallback(
    (l: any) => {
      if (courseFilter === "all") return true;
      const s = typeof l.source === "object" && l.source !== null
        ? (l.source as LearnNode)
        : graph.byId.get(l.source);
      const t = typeof l.target === "object" && l.target !== null
        ? (l.target as LearnNode)
        : graph.byId.get(l.target);
      return s?.courseId === courseFilter && t?.courseId === courseFilter;
    },
    [courseFilter, graph],
  );

  // ── Camera re-fit on filter change: hiding a constellation leaves the
  // camera parked where the FULL graph fit — a filtered subset can sit
  // entirely off-frame, which reads as "the map went dark" (it did, on
  // 2026-08-21, and looked exactly like a data bug). Fly to the visible
  // nodes instead; the 400 ms delay lets d3's reheat move them first.
  // Dev-only debug handle — lets a console probe read real node positions
  // and the camera without guessing. Stripped by the DEV gate in prod.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as any).__learnFG = fgRef.current;
      (window as any).__learnNodes = nodesRef.current;
    }
  });

  useEffect(() => {
    const fly = () => {
      const fg = fgRef.current as any;
      if (!fg?.cameraPosition) return;
      try {
        // Manual centroid+radius flight, NOT zoomToFit: on a tight
        // constellation zoomToFit's fitted distance can land the camera
        // inside the cluster (every node behind the near plane — the
        // "still black" failure of the first fix attempt).
        const vis = nodesRef.current.filter(
          (n: any) =>
            (courseFilter === "all" || n.courseId === courseFilter) &&
            Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z),
        );
        if (vis.length === 0) return;
        let cx = 0, cy = 0, cz = 0;
        for (const n of vis as any[]) { cx += n.x; cy += n.y; cz += n.z; }
        cx /= vis.length; cy /= vis.length; cz /= vis.length;
        let r = 0;
        for (const n of vis as any[]) {
          const d = Math.hypot(n.x - cx, n.y - cy, n.z - cz);
          if (d > r) r = d;
        }
        const dist = Math.max(200, r * 2.2);
        fg.cameraPosition(
          { x: cx, y: cy, z: cz + dist },
          { x: cx, y: cy, z: cz },
          700,
        );
      } catch {
        // Camera travel is best-effort — a mid-unmount call must not throw.
      }
    };
    // Two passes: an immediate rough flight for responsiveness, then a
    // corrective one after the d3 reheat has largely cooled — the first
    // pass targets a centroid that is still drifting (observed: the
    // constellation framed half-behind the HUD).
    const t1 = window.setTimeout(fly, 400);
    const t2 = window.setTimeout(fly, 2200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [courseFilter]);

  const handleNodeClick = useCallback((n: any) => onSelect(n.id), [onSelect]);
  const handleBackgroundClick = useCallback(() => onSelect(null), [onSelect]);

  return (
    <div ref={hostRef} className="learn-map">
      {!webglOk ? (
        <FallbackPanel />
      ) : size.w > 1 ? (
        <MapErrorBoundary fallback={<FallbackPanel />}>
          <ForceGraph3D
            ref={fgRef}
            graphData={graphData}
            width={size.w}
            height={size.h}
            // Transparent clear colour: the depth gradient lives on .learn-map
            // (learn.css), mirroring the outgoing conceptmap.html's radial
            // gradient with the values inverted for dark.
            backgroundColor="rgba(0,0,0,0)"
            showNavInfo={false}
            nodeLabel=""
            nodeRelSize={NODE_REL_SIZE}
            nodeOpacity={0.92}
            nodeVal={nodeVal}
            nodeColor={nodeColor}
            nodeThreeObject={nodeThreeObject as any}
            nodeThreeObjectExtend={true}
            nodeVisibility={nodeVisibility}
            linkVisibility={linkVisibility}
            linkColor={linkColor}
            linkWidth={linkWidth}
            linkOpacity={0.9} // per-link alpha lives in the colour
            linkDirectionalArrowLength={linkArrowLength}
            linkDirectionalArrowRelPos={0.9}
            linkDirectionalArrowColor={linkColor}
            warmupTicks={80}
            cooldownTicks={240}
            d3VelocityDecay={0.35}
            enableNodeDrag={false} // read-only surface; dragging reheats a 1067-node sim
            onNodeClick={handleNodeClick}
            onNodeHover={onNodeHover}
            onBackgroundClick={handleBackgroundClick}
            onEngineStop={() => fgRef.current?.zoomToFit(600, 90)}
          />
        </MapErrorBoundary>
      ) : null /* placeholder until the container reports a real size */}
    </div>
  );
}
