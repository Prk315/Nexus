import React, { useEffect, useRef } from "react";
import ForceGraph2D from "react-force-graph-2d";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { drawNode, resolveNodeColor } from "../canvas/drawNode";
import type { VaultGraph } from "../types";
import type { GraphFilters } from "./GraphFilterPanel";

// Extracted out of App.tsx so `three` / `three-spritetext` / react-force-graph-2d/3d
// only load when the full-graph overlay is actually opened, instead of loading
// before first paint. This component owns every ref/effect that talks to THREE
// directly; App.tsx only knows about plain data (filteredGraphData, graphFilters,
// is3D) and callbacks (setIs3D, onNodeClick, savePositions).

// Catches a WebGL context failure that slips past App's detectWebGL() (e.g. the
// context is created then lost mid-render) and falls back to the 2D graph
// instead of crashing React.
class WebGLErrorBoundary extends React.Component<
  { fallback: React.ReactNode; onError?: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[Vault] 3D graph failed, falling back to 2D:", error);
    this.props.onError?.();
  }
  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export interface ForceGraphViewProps {
  graph: VaultGraph;
  filteredGraphData: { nodes: any[]; links: any[] };
  graphFilters: GraphFilters;
  is3D: boolean;
  setIs3D: React.Dispatch<React.SetStateAction<boolean>>;
  selectedId: string | null;
  linkMode: boolean;
  linkSource: string | null;
  // Mirrors of App's own `fullGraph`/`appMode` gates — this component is only
  // ever mounted when both are already true, but the internal effects keep the
  // same explicit guard they had in App.tsx for exact behavioral parity.
  fullGraph: boolean;
  appMode: "vault" | "learn";
  onNodeClick: (id: string) => void;
  savePositions: (nodes: any[]) => void;
}

export function ForceGraphView({
  graph,
  filteredGraphData,
  graphFilters,
  is3D,
  setIs3D,
  selectedId,
  linkMode,
  linkSource,
  fullGraph,
  appMode,
  onNodeClick,
  savePositions,
}: ForceGraphViewProps) {
  const fullGraphRef = useRef<any>(undefined);
  // Cluster bubble meshes and label sprites keyed by tag name
  const clusterMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const clusterLabelsRef = useRef<Map<string, any>>(new Map()); // SpriteText objects
  // Always points at the latest filtered nodes so D3 force closure stays fresh
  const filteredNodesRef = useRef<any[]>([]);
  // Keep graphFilters fresh inside ForceGraph3D tick callbacks (avoids stale closures)
  const graphFiltersRef = useRef(graphFilters);
  graphFiltersRef.current = graphFilters;
  // Stable ref to updateClusterMeshes so the rAF loop always calls the latest version
  const updateClusterMeshesRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Graph is only mounted in Vault mode (see render gate) — skip force setup
    // when it's unmounted, and re-run when we return so forces re-apply.
    if (!fullGraph || appMode !== "vault") return;

    // ForceGraph3D may not have finished mounting when this effect fires.
    // Retry until the ref and its d3Force API are available.
    let retryId: ReturnType<typeof setTimeout>;

    function applyForces() {
      const fg = fullGraphRef.current as any;
      // Wait for: kapsule API + data + kapsule's debounced _updateGraph.
      // _updateGraph runs ~1ms after comp() and is what assigns state.layout.
      // If we call d3ReheatSimulation before that, engineRunning flips true
      // while state.layout is still undefined → next animation frame crashes
      // inside three-forcegraph's layoutTick. The 50ms re-poll below is what
      // pushes us past the 1ms debounce.
      if (!fg?.d3Force || filteredNodesRef.current.length === 0) {
        retryId = setTimeout(applyForces, 50);
        return;
      }
      fg.d3Force("charge")?.strength(-(graphFiltersRef.current.gravity * 56));
      fg.d3Force("link")?.distance(90);

      if (is3D && graphFiltersRef.current.showClusters) {
        fg.d3Force("cluster", (alpha: number) => {
        const nodes = filteredNodesRef.current;
        const { clusterStrength, clusterRepulsion } = graphFiltersRef.current;

        // Compute per-tag centroids
        const centroids: Record<string, { x: number; y: number; z: number; n: number }> = {};
        for (const node of nodes) {
          const tag = node.tags?.[0];
          if (!tag) continue;
          if (!centroids[tag]) centroids[tag] = { x: 0, y: 0, z: 0, n: 0 };
          centroids[tag].x += node.x ?? 0;
          centroids[tag].y += node.y ?? 0;
          centroids[tag].z += node.z ?? 0;
          centroids[tag].n++;
        }

        // Pull nodes toward their own cluster centroid
        for (const node of nodes) {
          const tag = node.tags?.[0];
          if (!tag) continue;
          const c = centroids[tag];
          if (!c || c.n < 2) continue;
          node.vx = (node.vx ?? 0) + ((c.x / c.n) - (node.x ?? 0)) * clusterStrength * alpha;
          node.vy = (node.vy ?? 0) + ((c.y / c.n) - (node.y ?? 0)) * clusterStrength * alpha;
          node.vz = (node.vz ?? 0) + ((c.z / c.n) - (node.z ?? 0)) * clusterStrength * alpha;
        }

        // Push nodes away from other clusters' centroids
        if (clusterRepulsion > 0) {
          for (const node of nodes) {
            const ownTag = node.tags?.[0];
            for (const [tag, c] of Object.entries(centroids)) {
              if (tag === ownTag || c.n < 1) continue;
              const ox = (node.x ?? 0) - c.x / c.n;
              const oy = (node.y ?? 0) - c.y / c.n;
              const oz = (node.z ?? 0) - c.z / c.n;
              const dist2 = ox * ox + oy * oy + oz * oz || 1;
              const force = (clusterRepulsion / dist2) * alpha;
              node.vx = (node.vx ?? 0) + ox * force;
              node.vy = (node.vy ?? 0) + oy * force;
              node.vz = (node.vz ?? 0) + oz * force;
            }
          }
        }
      });
      } else {
        fg.d3Force("cluster", null);
      }

      fg.d3ReheatSimulation();
    }

    // Defer the first attempt past kapsule's 1ms debounced digest so that
    // _updateGraph has set state.layout before we flip engineRunning=true.
    retryId = setTimeout(applyForces, 50);
    return () => clearTimeout(retryId);
  }, [fullGraph, appMode, is3D, graphFilters.gravity, graphFilters.showClusters, graphFilters.clusterStrength, graphFilters.clusterRepulsion]);

  // Clean up cluster meshes and labels when switching to 2D or disabling clusters
  useEffect(() => {
    if (is3D && graphFilters.showClusters) return;
    if (!fullGraphRef.current) return;
    try {
      const scene: THREE.Scene = fullGraphRef.current.scene?.();
      if (scene) {
        for (const mesh of clusterMeshesRef.current.values()) {
          scene.remove(mesh);
          mesh.geometry.dispose();
          (mesh.material as THREE.Material).dispose();
        }
        for (const sprite of clusterLabelsRef.current.values()) {
          scene.remove(sprite);
        }
      }
    } catch { /* scene may not be ready */ }
    clusterMeshesRef.current.clear();
    clusterLabelsRef.current.clear();
  }, [is3D, graphFilters.showClusters]);

  // rAF loop: drive cluster mesh updates independently of the D3 tick timing
  useEffect(() => {
    if (!fullGraph || appMode !== "vault" || !is3D || !graphFilters.showClusters) return;
    let rafId: number;
    function loop() {
      updateClusterMeshesRef.current();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [fullGraph, appMode, is3D, graphFilters.showClusters]);

  // Keep ref fresh so the D3 cluster force always sees current nodes
  filteredNodesRef.current = filteredGraphData.nodes as any[];

  const fullGraphPaint = (node: any, ctx: CanvasRenderingContext2D, globalScale: number) =>
    drawNode(node, ctx, globalScale, graph.tag_colors, node.id === selectedId, node.id === linkSource, linkMode, graphFilters.fontSize);

  function fullGraphPaintLink(link: any, ctx: CanvasRenderingContext2D, globalScale: number) {
    const start = typeof link.source === "object" ? link.source : null;
    const end   = typeof link.target === "object" ? link.target : null;
    if (!start || !end || start.x == null || end.x == null) return;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;
    const lw = 1.5 / globalScale;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.strokeStyle = "#9ca3af";
    ctx.lineWidth = lw;
    ctx.stroke();
    const angle = Math.atan2(dy, dx);
    const arrowLen = 5 / globalScale;
    const spread = Math.PI * 0.38;
    const tx = start.x + dx * 0.88;
    const ty = start.y + dy * 0.88;
    ctx.beginPath();
    ctx.moveTo(tx + arrowLen * Math.cos(angle), ty + arrowLen * Math.sin(angle));
    ctx.lineTo(tx + arrowLen * Math.cos(angle + Math.PI - spread), ty + arrowLen * Math.sin(angle + Math.PI - spread));
    ctx.lineTo(tx + arrowLen * Math.cos(angle + Math.PI + spread), ty + arrowLen * Math.sin(angle + Math.PI + spread));
    ctx.closePath();
    ctx.fillStyle = "#9ca3af";
    ctx.fill();
  }

  // Updates cluster bubble meshes and labels — driven by a rAF loop (see effect above)
  function updateClusterMeshes() {
    if (!fullGraphRef.current) return;
    const { showClusters } = graphFiltersRef.current;
    if (!showClusters) return;
    const scene: THREE.Scene = fullGraphRef.current.scene?.();
    if (!scene) return;

    // Prefer live nodes from the graph (have up-to-date x/y/z), fall back to ref
    const liveNodes: any[] = fullGraphRef.current.graphData?.()?.nodes ?? filteredNodesRef.current;
    const nodes = liveNodes.filter((n: any) => n.x !== undefined);

    // Compute per-tag clusters
    const tagGroups = new Map<string, { nodes: any[]; color: string }>();
    for (const node of nodes) {
      for (const tag of (node.tags ?? [])) {
        if (!tagGroups.has(tag)) {
          tagGroups.set(tag, { nodes: [], color: graph.tag_colors[tag] ?? "#94a3b8" });
        }
        tagGroups.get(tag)!.nodes.push(node);
      }
    }

    const { clusterOpacity, clusterPadding, clusterColor, clusterShowLabel, clusterFontSize } = graphFiltersRef.current;

    // Remove stale meshes and labels
    for (const [tag, mesh] of clusterMeshesRef.current) {
      if (!tagGroups.has(tag) || tagGroups.get(tag)!.nodes.length < 2) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        clusterMeshesRef.current.delete(tag);
      }
    }
    for (const [tag, sprite] of clusterLabelsRef.current) {
      if (!tagGroups.has(tag) || tagGroups.get(tag)!.nodes.length < 2) {
        scene.remove(sprite);
        clusterLabelsRef.current.delete(tag);
      }
    }

    for (const [tag, { nodes: cn, color }] of tagGroups) {
      if (cn.length < 2) continue;

      const cx = cn.reduce((s, n) => s + (n.x ?? 0), 0) / cn.length;
      const cy = cn.reduce((s, n) => s + (n.y ?? 0), 0) / cn.length;
      const cz = cn.reduce((s, n) => s + (n.z ?? 0), 0) / cn.length;
      const radius = Math.max(
        20,
        ...cn.map((n: any) =>
          Math.sqrt(((n.x ?? 0) - cx) ** 2 + ((n.y ?? 0) - cy) ** 2 + ((n.z ?? 0) - cz) ** 2)
        )
      ) + clusterPadding;

      const bubbleColor = clusterColor !== "" ? clusterColor : color;

      // ── Bubble mesh ──
      if (!clusterMeshesRef.current.has(tag)) {
        const geo = new THREE.SphereGeometry(1, 24, 24);
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(bubbleColor),
          transparent: true,
          opacity: clusterOpacity,
          side: THREE.BackSide,
          depthWrite: false,
        });
        scene.add(new THREE.Mesh(geo, mat));
        clusterMeshesRef.current.set(tag, scene.children[scene.children.length - 1] as THREE.Mesh);
      }
      const mesh = clusterMeshesRef.current.get(tag)!;
      mesh.position.set(cx, cy, cz);
      mesh.scale.setScalar(radius);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.set(bubbleColor);
      mat.opacity = clusterOpacity;

      // ── Label sprite ──
      if (clusterShowLabel) {
        if (!clusterLabelsRef.current.has(tag)) {
          const sprite = new SpriteText(tag);
          sprite.color = bubbleColor;
          sprite.backgroundColor = "rgba(255,255,255,0.75)";
          sprite.padding = 3;
          sprite.borderRadius = 3;
          scene.add(sprite);
          clusterLabelsRef.current.set(tag, sprite);
        }
        const sprite = clusterLabelsRef.current.get(tag)!;
        sprite.text = tag;
        sprite.textHeight = clusterFontSize;
        sprite.color = bubbleColor;
        sprite.position.set(cx, cy + radius * 0.92, cz);
      } else if (clusterLabelsRef.current.has(tag)) {
        scene.remove(clusterLabelsRef.current.get(tag)!);
        clusterLabelsRef.current.delete(tag);
      }
    }
  }
  // Keep the ref pointing at the latest version so the rAF loop is always current
  updateClusterMeshesRef.current = updateClusterMeshes;

  // 2D canvas graph — used both as the explicit 2D mode and as the WebGL fallback.
  const twoDGraph = (
    <ForceGraph2D
      ref={fullGraphRef}
      graphData={filteredGraphData}
      backgroundColor="#f8f9fa"
      nodeLabel=""
      nodeCanvasObject={fullGraphPaint}
      nodeCanvasObjectMode={() => "replace" as const}
      nodeRelSize={5}
      linkCanvasObject={fullGraphPaintLink}
      linkCanvasObjectMode={() => "replace" as const}
      warmupTicks={60}
      cooldownTime={4000}
      d3VelocityDecay={0.35}
      width={window.innerWidth - 260}
      height={window.innerHeight}
      onEngineStop={() => savePositions(filteredGraphData.nodes)}
      onNodeClick={(node: any) => onNodeClick(node.id)}
    />
  );

  return is3D ? (
    <WebGLErrorBoundary onError={() => setIs3D(false)} fallback={twoDGraph}>
      <ForceGraph3D
        ref={fullGraphRef}
        graphData={filteredGraphData}
        backgroundColor="#f8f9fa"
        nodeLabel={(node: any) => node.name}
        nodeColor={(node: any) => resolveNodeColor(node, graph.tag_colors)}
        nodeRelSize={5}
        linkColor={() => "#9ca3af"}
        linkWidth={1.5}
        linkCurvature={0.08}
        linkDirectionalArrowLength={4}
        linkDirectionalArrowRelPos={0.88}
        linkDirectionalArrowColor={() => "#9ca3af"}
        warmupTicks={60}
        cooldownTime={4000}
        d3VelocityDecay={0.35}
        width={window.innerWidth - 260}
        height={window.innerHeight}
        onNodeClick={(node: any) => onNodeClick(node.id)}
        onEngineStop={() => {
          savePositions(filteredGraphData.nodes);
          fullGraphRef.current?.zoomToFit(400, 120);
        }}
      />
    </WebGLErrorBoundary>
  ) : (
    twoDGraph
  );
}
