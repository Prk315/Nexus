import React, { useState, useEffect, useRef, useMemo } from "react";
import { useNexusRegistration, NexusHeader } from "@nexus/core";
import * as api from "./lib/api";
import ForceGraph2D from "react-force-graph-2d";
import ForceGraph3D from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { useGraph } from "./hooks/useGraph";
import { useKeyBindings } from "./hooks/useKeyBindings";
import { TreeRow } from "./components/TreeRow";
import { SearchModal } from "./components/SearchModal";
import { GraphView } from "./components/GraphView";
import { GraphFilterPanel, GraphFilters, DEFAULT_GRAPH_FILTERS } from "./components/GraphFilterPanel";
import { drawNode, resolveNodeColor } from "./canvas/drawNode";
import { TagsPanel } from "./components/TagsPanel";
import { EditorPane, EditorPaneHandle } from "./components/EditorPane";
import "./App.css";

function App() {
  useNexusRegistration("Vault");
  const { graph, graphData, savePositions, loadGraph, createNode, deleteNode, addEdge, removeEdge, addTag, removeTag, setTagColor, createTag, renameTag, deleteTagGlobal } = useGraph();

  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState("Note");
  const [sidebarView, setSidebarView] = useState<"list" | "graph" | "tags">("list");
  const [fullGraph, setFullGraph] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [fullGraphCreating, setFullGraphCreating] = useState(false);
  const [fullGraphNewName, setFullGraphNewName] = useState("");
  const [fullGraphNewKind, setFullGraphNewKind] = useState("Note");
  const [graphFilters, setGraphFilters] = useState<GraphFilters>(DEFAULT_GRAPH_FILTERS);
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const [is3D, setIs3D] = useState(true);

  const graphContainerRef = useRef<HTMLDivElement>(null);
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
  const [graphSize, setGraphSize] = useState({ width: 240, height: 400 });
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const pdfImportRef = useRef<HTMLInputElement>(null);
  const videoImportRef = useRef<HTMLInputElement>(null);

  // Multi-pane state
  const initialPaneId = React.useRef(crypto.randomUUID()).current;
  const [panes, setPanes] = useState<{ id: string }[]>(() => [{ id: initialPaneId }]);
  const [activePaneId, setActivePaneId] = useState<string>(initialPaneId);
  const [paneSizes, setPaneSizes] = useState<number[]>([1]);
  const [paneSelectedIds, setPaneSelectedIds] = useState<Record<string, string | null>>({});
  const paneRefs = useRef<Record<string, React.RefObject<EditorPaneHandle | null>>>({});

  function getPaneRef(paneId: string): React.RefObject<EditorPaneHandle | null> {
    if (!paneRefs.current[paneId]) {
      paneRefs.current[paneId] = React.createRef<EditorPaneHandle | null>();
    }
    return paneRefs.current[paneId];
  }

  const activePaneRef = getPaneRef(activePaneId);
  const selectedId = paneSelectedIds[activePaneId] ?? null;

  useEffect(() => { loadGraph(); }, []);

  useEffect(() => {
    if (!fullGraph) return;

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
  }, [fullGraph, is3D, graphFilters.gravity, graphFilters.showClusters, graphFilters.clusterStrength, graphFilters.clusterRepulsion]);

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
    if (!fullGraph || !is3D || !graphFilters.showClusters) return;
    let rafId: number;
    function loop() {
      updateClusterMeshesRef.current();
      rafId = requestAnimationFrame(loop);
    }
    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, [fullGraph, is3D, graphFilters.showClusters]);

  useEffect(() => {
    if (sidebarView === "graph" && graphContainerRef.current) {
      const { offsetWidth, offsetHeight } = graphContainerRef.current;
      setGraphSize({ width: offsetWidth, height: offsetHeight });
    }
  }, [sidebarView]);

  useEffect(() => {
    if (!searchOpen) setSearchQuery("");
  }, [searchOpen]);

  function addPaneAfter(afterPaneId: string) {
    const newPane = { id: crypto.randomUUID() };
    setPanes(prev => {
      const idx = prev.findIndex(p => p.id === afterPaneId);
      const next = [...prev];
      next.splice(idx + 1, 0, newPane);
      return next;
    });
    setPaneSizes(prev => {
      const idx = panes.findIndex(p => p.id === afterPaneId);
      const next = [...prev];
      const half = (next[idx] ?? 1) / 2;
      next[idx] = half;
      next.splice(idx + 1, 0, half);
      return next;
    });
    setActivePaneId(newPane.id);
  }

  function closePane(paneId: string) {
    if (panes.length <= 1) return;
    const idx = panes.findIndex(p => p.id === paneId);
    const removedSize = paneSizes[idx] ?? 1;
    delete paneRefs.current[paneId];
    setPanes(prev => prev.filter(p => p.id !== paneId));
    setPaneSizes(prev => {
      const next = [...prev];
      next.splice(idx, 1);
      const neighbor = Math.min(idx, next.length - 1);
      next[neighbor] = (next[neighbor] ?? 0) + removedSize;
      return next;
    });
    if (activePaneId === paneId) {
      const remaining = panes.filter(p => p.id !== paneId);
      setActivePaneId(remaining[Math.min(idx, remaining.length - 1)]?.id ?? remaining[0]?.id ?? "");
    }
  }

  const resizeDragRef = useRef<{ idx: number; startX: number; startSizes: number[] } | null>(null);
  const [isPaneResizing, setIsPaneResizing] = useState(false);

  function onPaneDividerMouseDown(e: React.MouseEvent, idx: number) {
    e.preventDefault();
    resizeDragRef.current = { idx, startX: e.clientX, startSizes: [...paneSizes] };
    setIsPaneResizing(true);
    function onMove(ev: MouseEvent) {
      if (!resizeDragRef.current) return;
      const { idx, startX, startSizes } = resizeDragRef.current;
      const totalEl = document.querySelector(".editor-area") as HTMLElement;
      if (!totalEl) return;
      const totalWidth = totalEl.offsetWidth;
      const dx = ev.clientX - startX;
      const dFrac = dx / totalWidth;
      const next = [...startSizes];
      next[idx - 1] = Math.max(0.1, startSizes[idx - 1] + dFrac);
      next[idx] = Math.max(0.1, startSizes[idx] - dFrac);
      setPaneSizes(next);
    }
    function onUp() {
      resizeDragRef.current = null;
      setIsPaneResizing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  useKeyBindings({
    onToggleFullGraph: () => setFullGraph(v => !v),
    onToggleSearch: () => setSearchOpen(v => !v),
    onNewNode: () => {
      setFullGraph(false);
      setSearchOpen(false);
      setSidebarView("list");
      setTimeout(() => newNameInputRef.current?.focus(), 0);
    },
    onEscape: () => {
      setFullGraph(false);
      setSearchOpen(false);
      setLinkMode(false);
      setLinkSource(null);
    },
    onCloseTab: () => activePaneRef.current?.closeCurrentTab(),
    onNextTab: () => activePaneRef.current?.selectNextTab(),
    onPrevTab: () => activePaneRef.current?.selectPrevTab(),
  });

  function getAncestors(id: string, visited = new Set<string>()): string[] {
    if (visited.has(id)) return [];
    visited.add(id);
    const parents = graph.back_edges[id] ?? [];
    return parents.flatMap(p => [p, ...getAncestors(p, visited)]);
  }

  function selectNode(id: string) {
    activePaneRef.current?.selectNode(id);
    const ancestors = getAncestors(id);
    if (ancestors.length > 0) {
      setSidebarView("list");
      setExpandedNodes(prev => {
        const next = new Set(prev);
        ancestors.forEach(a => next.add(a));
        return next;
      });
    }
  }

  async function handleCreateNode() {
    const name = newName.trim();
    if (!name) return;
    await createNode(name, newKind);
    setNewName("");
  }

  async function handleCreateChild(parentId: string, name: string, kind: string) {
    const oldIds = new Set(Object.keys(graph.nodes));
    const g = await createNode(name, kind);
    const newId = Object.keys(g.nodes).find(id => !oldIds.has(id));
    if (newId) await addEdge(parentId, newId);
  }

  async function handleImportPdf(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.pdf$/i, "");
    const oldIds = new Set(Object.keys(graph.nodes));
    const g = await createNode(name, "Pdf");
    const newId = Object.keys(g.nodes).find(id => !oldIds.has(id));
    if (newId) {
      await api.uploadAsset(newId, file);
      selectNode(newId);
    }
    e.target.value = "";
  }

  async function handleImportVideo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const name = file.name.replace(/\.[^.]+$/, "");
    const oldIds = new Set(Object.keys(graph.nodes));
    const g = await createNode(name, "Video");
    const newId = Object.keys(g.nodes).find(id => !oldIds.has(id));
    if (newId) {
      await api.uploadAsset(newId, file);
      selectNode(newId);
    }
    e.target.value = "";
  }

  async function handleDeleteNode(id: string) {
    await deleteNode(id);
    Object.values(paneRefs.current).forEach(ref => ref.current?.closeTabIfOpen(id));
  }

  async function handleGraphNodeClick(id: string) {
    if (!linkMode) { selectNode(id); return; }
    if (!linkSource) { setLinkSource(id); return; }
    if (linkSource === id) { setLinkSource(null); return; }
    try { await addEdge(linkSource, id); } catch (_) {}
    setLinkSource(null);
  }

  function toggleLinkMode() { setLinkMode(v => !v); setLinkSource(null); }

  function toggleExpanded(id: string) {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const nodeList = Object.values(graph.nodes).sort((a, b) => a.name.localeCompare(b.name));
  const topLevelNodes = nodeList.filter(n => (graph.back_edges[n.id] ?? []).length === 0);
  const searchResults = searchQuery.trim()
    ? nodeList.filter(n => n.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : nodeList;

  const filteredGraphData = useMemo(() => {
    let nodes = graphData.nodes as any[];

    if (graphFilters.query.trim()) {
      const q = graphFilters.query.toLowerCase();
      nodes = nodes.filter(n => n.name.toLowerCase().includes(q));
    }

    if (graphFilters.hiddenKinds.size > 0) {
      nodes = nodes.filter(n => !graphFilters.hiddenKinds.has(n.kind?.type ?? ""));
    }

    if (graphFilters.tagFilter.size > 0) {
      nodes = nodes.filter(n => (n.tags ?? []).some((t: string) => graphFilters.tagFilter.has(t)));
    }

    const nodeIds = new Set(nodes.map((n: any) => n.id));

    if (!graphFilters.showOrphans) {
      const linkedIds = new Set<string>();
      graphData.links.forEach((l: any) => {
        const s = typeof l.source === "object" ? l.source.id : l.source;
        const t = typeof l.target === "object" ? l.target.id : l.target;
        if (nodeIds.has(s) && nodeIds.has(t)) {
          linkedIds.add(s);
          linkedIds.add(t);
        }
      });
      nodes = nodes.filter((n: any) => linkedIds.has(n.id));
      nodes.forEach((n: any) => nodeIds.add(n.id));
    }

    const links = (graphData.links as any[]).filter(l => {
      const s = typeof l.source === "object" ? l.source.id : l.source;
      const t = typeof l.target === "object" ? l.target.id : l.target;
      return nodeIds.has(s) && nodeIds.has(t);
    });

    return { nodes, links };
  }, [graphData, graphFilters]);

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

  // Updates cluster bubble meshes and labels — driven by a rAF loop (see effect below)
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <NexusHeader appName="Vault" />
    <div className="app" style={{ flex: 1, minHeight: 0, height: "auto" }}>
      {fullGraph && (
        <div className="fullgraph-overlay">
          {filteredGraphData.nodes.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
              {graph && Object.keys(graph.nodes).length === 0 ? "No nodes in vault yet" : "Loading graph…"}
            </div>
          ) : is3D ? (
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
              onNodeClick={(node: any) => handleGraphNodeClick(node.id)}
              onEngineStop={() => {
                savePositions(filteredGraphData.nodes);
                fullGraphRef.current?.zoomToFit(400, 120);
              }}
            />
          ) : (
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
              onNodeClick={(node: any) => handleGraphNodeClick(node.id)}
            />
          )}
          <div className="fullgraph-toolbar">
            {!fullGraphCreating ? (
              <>
                <button className={`link-mode-btn ${linkMode ? "active" : ""}`} onClick={toggleLinkMode}>
                  {linkMode ? (linkSource ? "Select target…" : "Select source…") : "Link"}
                </button>
                <button className="link-mode-btn" onClick={() => { setFullGraphCreating(true); setFullGraphNewName(""); }}>
                  + Node
                </button>
                {selectedId && (
                  <button className="link-mode-btn graph-delete-btn" onClick={() => handleDeleteNode(selectedId)}>
                    Delete "{graph.nodes[selectedId]?.name}"
                  </button>
                )}
                <button
                  className={`link-mode-btn${is3D ? " active" : ""}`}
                  onClick={() => setIs3D(v => !v)}
                  title="Toggle 3D view"
                >
                  {is3D ? "2D" : "3D"}
                </button>
              </>
            ) : (
              <>
                <input
                  className="graph-create-input"
                  placeholder="Node name…"
                  value={fullGraphNewName}
                  autoFocus
                  onChange={e => setFullGraphNewName(e.target.value)}
                  onKeyDown={async e => {
                    if (e.key === "Enter" && fullGraphNewName.trim()) {
                      await createNode(fullGraphNewName.trim(), fullGraphNewKind);
                      setFullGraphCreating(false);
                    }
                    if (e.key === "Escape") setFullGraphCreating(false);
                  }}
                />
                <select className="graph-create-select" value={fullGraphNewKind} onChange={e => setFullGraphNewKind(e.target.value)}>
                  <option>Note</option>
                  <option>Folder</option>
                  <option>CodeFile</option>
                  <option>Table</option>
                  <option>Database</option>
                  <option>Journal</option>
                  <option>Books</option>
                </select>
                <button className="link-mode-btn" disabled={!fullGraphNewName.trim()} onClick={async () => {
                  if (fullGraphNewName.trim()) {
                    await createNode(fullGraphNewName.trim(), fullGraphNewKind);
                    setFullGraphCreating(false);
                  }
                }}>✓</button>
                <button className="link-mode-btn" onClick={() => setFullGraphCreating(false)}>✕</button>
              </>
            )}
          </div>
          <GraphFilterPanel
            graph={graph}
            filters={graphFilters}
            onChange={setGraphFilters}
          />
          <div className="fullgraph-hint">⌘G to close · Esc to cancel</div>
        </div>
      )}

      {searchOpen && (
        <SearchModal
          query={searchQuery}
          results={searchResults}
          onQueryChange={setSearchQuery}
          onSelect={selectNode}
          onClose={() => setSearchOpen(false)}
        />
      )}

      <button
        className={`sidebar-toggle-tab${sidebarOpen ? "" : " closed"}`}
        onClick={() => setSidebarOpen(v => !v)}
        title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
      >{sidebarOpen ? "‹" : "›"}</button>

      <aside className={`sidebar${sidebarOpen ? "" : " sidebar-hidden"}`}>
        <div className="sidebar-header">
          <h2 className="vault-title-btn" onClick={() => activePaneRef.current?.showHome()}>Vault</h2>
          <div className="sidebar-header-right">
            <div className="sidebar-toggle">
              <button className={sidebarView === "list" ? "active" : ""} onClick={() => setSidebarView("list")}>List</button>
              <button className={sidebarView === "graph" ? "active" : ""} onClick={() => setSidebarView("graph")}>Graph</button>
              <button className={sidebarView === "tags" ? "active" : ""} onClick={() => setSidebarView("tags")}>Tags</button>
            </div>
          </div>
        </div>

        {sidebarView === "list" ? (
          <>
            <div className="new-node">
              <input
                ref={newNameInputRef}
                placeholder="Node name..."
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateNode()}
              />
              <select value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                <option>Note</option>
                <option>Folder</option>
                <option>Canvas</option>
                <option>CodeFile</option>
                <option>Table</option>
                <option>Database</option>
                <option>Workbook</option>
                <option>Journal</option>
                <option>Books</option>
              </select>
              <button onClick={handleCreateNode}>+</button>
            </div>
            <div className="import-pdf-row">
              <input
                ref={pdfImportRef}
                type="file"
                accept=".pdf"
                style={{ display: "none" }}
                onChange={handleImportPdf}
              />
              <input
                ref={videoImportRef}
                type="file"
                accept="video/*"
                style={{ display: "none" }}
                onChange={handleImportVideo}
              />
              <button className="import-pdf-btn" onClick={() => pdfImportRef.current?.click()}>
                Import PDF
              </button>
              <button className="import-pdf-btn" onClick={() => videoImportRef.current?.click()}>
                Import Video
              </button>
            </div>
            <ul className="node-list">
              {topLevelNodes.map(node => (
                <TreeRow
                  key={node.id}
                  nodeId={node.id}
                  graph={graph}
                  selectedId={selectedId}
                  expanded={expandedNodes}
                  depth={0}
                  onSelect={selectNode}
                  onDelete={handleDeleteNode}
                  onToggle={toggleExpanded}
                  onCreateChild={handleCreateChild}
                  onUnlink={async (parentId, childId) => removeEdge(parentId, childId)}
                  onToggleFavorite={(id, isFav) => isFav ? removeTag(id, "favorite") : addTag(id, "favorite")}
                />
              ))}
            </ul>
          </>
        ) : sidebarView === "tags" ? (
          <TagsPanel
            graph={graph}
            onCreateTag={createTag}
            onRenameTag={renameTag}
            onDeleteTag={deleteTagGlobal}
            onSetTagColor={setTagColor}
          />
        ) : (
          <div className="graph-container" ref={graphContainerRef}>
            <GraphView
              graph={graph}
              graphData={graphData}
              selectedId={selectedId}
              linkMode={linkMode}
              linkSource={linkSource}
              width={graphSize.width}
              height={graphSize.height - 32}
              onNodeClick={handleGraphNodeClick}
              onEngineStop={() => savePositions(graphData.nodes)}
              onToggleLinkMode={toggleLinkMode}
              onCreateNode={async (name, kind) => { await createNode(name, kind); }}
              onDeleteNode={handleDeleteNode}
              onDeleteEdge={async (a, b) => removeEdge(a, b)}
            />
          </div>
        )}
      </aside>

      <main className="editor-area">
        {panes.map((pane, i) => (
          <React.Fragment key={pane.id}>
            {i > 0 && (
              <div
                className="pane-divider"
                onMouseDown={e => onPaneDividerMouseDown(e, i)}
              />
            )}
            <EditorPane
              ref={getPaneRef(pane.id)}
              graph={graph}
              isActive={activePaneId === pane.id}
              canClose={panes.length > 1}
              onActivate={() => setActivePaneId(pane.id)}
              onClose={() => closePane(pane.id)}
              onAddPane={() => addPaneAfter(pane.id)}
              onSelectionChange={nodeId => setPaneSelectedIds(prev => ({ ...prev, [pane.id]: nodeId }))}
              removeEdge={removeEdge}
              addTag={addTag}
              removeTag={removeTag}
              setTagColor={setTagColor}
              savePositions={savePositions}
              style={{ flex: paneSizes[i], pointerEvents: isPaneResizing ? "none" : undefined }}
            />
          </React.Fragment>
        ))}
      </main>
    </div>
    </div>
  );
}

export default App;
