import React, { useState, useEffect, useRef, useMemo, Suspense } from "react";
import { useNexusRegistration, NexusHeader, useNexusAuth, CalendarSidebar } from "@nexus/core";
import * as api from "./lib/api";
import { loadPathfinderDay, entryToEvent, toIsoDate, type PfCalEntry } from "./lib/pathfinderCalendar";
import { CalendarBlockEditor, type CalEditorState } from "./components/CalendarBlockEditor";
import { markdownToParsedHtml, blockifyDisplayMath } from "./lib/parsedImport";
import { useResizableWidth } from "./hooks/useResizableWidth";
import { useGraph } from "./hooks/useGraph";
import { useKeyBindings } from "./hooks/useKeyBindings";
import { TreeRow } from "./components/TreeRow";
import { SearchModal } from "./components/SearchModal";
import { GraphFilterPanel, GraphFilters, DEFAULT_GRAPH_FILTERS } from "./components/GraphFilterPanel";
import { TagsPanel } from "./components/TagsPanel";
import { EditorPane, EditorPaneHandle } from "./components/EditorPane";
import { useConfirm } from "./components/ConfirmDialog";
import { lazyWithReload } from "./lib/lazyLoad";
import "./App.css";

// react-force-graph-2d/3d + three + three-spritetext only load once the graph
// overlay is actually opened — see ForceGraphView.tsx for the refs/effects that
// talk to THREE directly. GraphView (sidebar "Graph" tab + folder graphs) pulls
// react-force-graph-2d too, so it rides the same lazy path.
const ForceGraphView = lazyWithReload(() => import("./components/ForceGraphView").then(m => ({ default: m.ForceGraphView })));
const GraphView = lazyWithReload(() => import("./components/GraphView").then(m => ({ default: m.GraphView })));
// Learn & Retain — native observatory (src/learn/). Pulls react-force-graph-3d,
// so it rides the same lazy path and only loads when the mode is first opened.
const LearnMode = lazyWithReload(() => import("./learn/LearnMode").then(m => ({ default: m.LearnMode })));

// Some WebViews / browsers (hardware accel off, sandboxed GPU) can't create a
// WebGL context. ForceGraph3D throws synchronously in that case and white-screens
// the whole view, so we detect support up front and default to the 2D canvas graph.
function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

function App() {
  useNexusRegistration("Vault");
  const { user, signOut } = useNexusAuth();
  const { graph, graphData, savePositions, loadGraph, createNode, deleteNode, addEdge, removeEdge, addTag, removeTag, setTagColor, createTag, renameTag, deleteTagGlobal } = useGraph();

  const { confirm, dialog: confirmDialog } = useConfirm();

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
  // Top-level dual mode: the Vault workspace vs. the Learn & Retain concept map.
  const [appMode, setAppMode] = useState<"vault" | "learn">("vault");
  // Cross-app calendar (PathFinder's day, read+written via shared Supabase session)
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarEntries, setCalendarEntries] = useState<PfCalEntry[]>([]);
  const [calEditor, setCalEditor] = useState<CalEditorState | null>(null);
  const refreshCalendar = async () => {
    try {
      setCalendarEntries(await loadPathfinderDay(new Date()));
    } catch {
      setCalendarEntries([]);
    }
  };
  // Mount the Learn iframe once, then keep it (hidden) — remounting the heavy 3D
  // app churns WebGL contexts and hangs the tab.
  const [learnMounted, setLearnMounted] = useState(false);

  // WebGL support is fixed for the page's lifetime; compute once.
  const webglSupported = useMemo(detectWebGL, []);
  const [is3D, setIs3D] = useState(webglSupported);

  const graphContainerRef = useRef<HTMLDivElement>(null);
  const [graphSize, setGraphSize] = useState({ width: 240, height: 400 });
  const newNameInputRef = useRef<HTMLInputElement>(null);
  const pdfImportRef = useRef<HTMLInputElement>(null);
  const videoImportRef = useRef<HTMLInputElement>(null);
  const parsedImportRef = useRef<HTMLInputElement>(null);
  const [importingParsed, setImportingParsed] = useState(false);
  const sidebarResize = useResizableWidth("nexus.vault.sidebarWidth", 240, 200, 520);

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

  // A chunk-load failure earlier this session forced a reload (see lazyLoad.ts);
  // once we've booted cleanly, clear the guard so a future failure can retry.
  useEffect(() => { sessionStorage.removeItem("vault.chunk-reload"); }, []);

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

  // Import a folder of parsed book chapters (chNN_*/*.md + figure images) as a
  // Parsed node: upload figures, convert markdown→full-fidelity HTML, save it.
  async function handleImportParsed(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;

    type Chapter = { md?: File; images: Map<string, File> };
    const byChapter = new Map<string, Chapter>();
    let topFolder = "";
    for (const f of files) {
      const rel = (f as any).webkitRelativePath || f.name;
      const parts = rel.split("/");
      if (!topFolder && parts.length > 1) topFolder = parts[0];
      const chapter = parts.length >= 2 ? parts[parts.length - 2] : "root";
      const fname = parts[parts.length - 1];
      if (!byChapter.has(chapter)) byChapter.set(chapter, { images: new Map() });
      const entry = byChapter.get(chapter)!;
      if (/\.md$/i.test(fname)) entry.md = f;
      else if (/\.(jpe?g|png|gif|webp|svg)$/i.test(fname)) entry.images.set(fname, f);
    }
    const chapters = [...byChapter.keys()].filter((c) => byChapter.get(c)!.md).sort();
    if (!chapters.length) { alert("No chapter .md files found in that folder."); return; }

    const pretty = (topFolder || "Parsed book").replace(/[_-]+/g, " ").trim();
    const name = window.prompt("Name for the imported parsed book:", pretty);
    if (!name) return;

    setImportingParsed(true);
    try {
      const oldIds = new Set(Object.keys(graph.nodes));
      const g = await createNode(name, "Parsed");
      const newId = Object.keys(g.nodes).find((id) => !oldIds.has(id));
      if (!newId) throw new Error("Could not create Parsed node");

      const combined: string[] = [];
      for (const chapter of chapters) {
        const { md, images } = byChapter.get(chapter)!;
        let text = await md!.text();
        for (const [fname, file] of images) {
          const url = await api.uploadParsedFigure(newId, chapter, fname, file);
          text = text.split(`](${fname})`).join(`](${url})`);
        }
        combined.push(blockifyDisplayMath(text));
      }
      const html = markdownToParsedHtml(combined.join("\n\n"));
      await api.saveContent(newId, html);
      selectNode(newId);
    } catch (err) {
      console.error("Parsed import failed:", err);
      alert("Import failed: " + (err instanceof Error ? err.message : String(err)));
    } finally {
      setImportingParsed(false);
    }
  }

  // Every node deletion in the app funnels through here — the tree row ×, the
  // sidebar/folder graph Delete button, the full-graph Delete button, and
  // EditorPane (which receives this as its `deleteNode` prop). Gating it here
  // means there is exactly one place a delete can start without a confirmation.
  async function handleDeleteNode(id: string): Promise<boolean> {
    const node = graph.nodes[id];
    if (!node) return false;
    const childCount  = (graph.edges[id] ?? []).length;
    const parentCount = (graph.back_edges[id] ?? []).length;

    const details = [
      `Kind: ${node.kind.type}`,
      "Its content — notes, annotations, highlights, journal pages — is deleted with it.",
      ...(childCount  ? [`${childCount} child node${childCount === 1 ? "" : "s"} will be kept, but unlinked from this node.`] : []),
      ...(parentCount ? [`${parentCount} link${parentCount === 1 ? "" : "s"} from parent node${parentCount === 1 ? "" : "s"} will be removed.`] : []),
      "This cannot be undone.",
    ];

    const ok = await confirm({
      title: `Delete "${node.name}"?`,
      details,
      confirmLabel: "Delete node",
    });
    if (!ok) return false;

    await deleteNode(id);
    Object.values(paneRefs.current).forEach(ref => ref.current?.closeTabIfOpen(id));
    return true;
  }

  async function handleDeleteTagGlobal(tag: string) {
    const used = Object.values(graph.nodes).filter(n => n.tags.includes(tag)).length;
    const ok = await confirm({
      title: `Delete tag "${tag}"?`,
      details: [
        used ? `Removed from ${used} node${used === 1 ? "" : "s"}.` : "Not currently on any node.",
        "The nodes themselves are kept.",
        "This cannot be undone.",
      ],
      confirmLabel: "Delete tag",
    });
    if (!ok) return;
    await deleteTagGlobal(tag);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <NexusHeader
        appName="Vault"
        userEmail={user?.email}
        onSignOut={() => signOut()}
        onCalendar={() => { setCalendarOpen(true); void refreshCalendar(); }}
        center={
          <div className="app-mode-toggle">
            <button className={appMode === "vault" ? "active" : ""} onClick={() => setAppMode("vault")}>Vault</button>
            <button className={appMode === "learn" ? "active" : ""} onClick={() => { setLearnMounted(true); setAppMode("learn"); }}>Learn &amp; Retain</button>
          </div>
        }
      />
    <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
    <div className="app" style={{ flex: 1, minHeight: 0, minWidth: 0, height: "auto", display: appMode === "vault" ? undefined : "none" }}>
      {fullGraph && appMode === "vault" && (
        <div className="fullgraph-overlay">
          {filteredGraphData.nodes.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
              {graph && Object.keys(graph.nodes).length === 0 ? "No nodes in vault yet" : "Loading graph…"}
            </div>
          ) : (
            <Suspense fallback={<div className="loading-state">Loading graph…</div>}>
              <ForceGraphView
                graph={graph}
                filteredGraphData={filteredGraphData}
                graphFilters={graphFilters}
                is3D={is3D}
                setIs3D={setIs3D}
                selectedId={selectedId}
                linkMode={linkMode}
                linkSource={linkSource}
                fullGraph={fullGraph}
                appMode={appMode}
                onNodeClick={handleGraphNodeClick}
                savePositions={savePositions}
              />
            </Suspense>
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
                  disabled={!webglSupported}
                  title={webglSupported ? "Toggle 3D view" : "3D unavailable — WebGL is disabled in this browser/WebView"}
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
        style={sidebarOpen ? { left: sidebarResize.width } : undefined}
      >{sidebarOpen ? "‹" : "›"}</button>

      <aside
        className={`sidebar${sidebarOpen ? "" : " sidebar-hidden"}`}
        style={{
          width: sidebarOpen ? sidebarResize.width : 0,
          minWidth: sidebarOpen ? sidebarResize.width : 0,
          transition: sidebarResize.dragging ? "none" : undefined,
        }}
      >
        {sidebarOpen && <div className="resize-handle" onPointerDown={sidebarResize.startResize} title="Drag to resize" />}
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
              <input
                ref={parsedImportRef}
                type="file"
                // @ts-expect-error non-standard folder-picker attributes
                webkitdirectory=""
                directory=""
                multiple
                style={{ display: "none" }}
                onChange={handleImportParsed}
              />
              <button className="import-pdf-btn" onClick={() => pdfImportRef.current?.click()}>
                Import PDF
              </button>
              <button className="import-pdf-btn" onClick={() => videoImportRef.current?.click()}>
                Import Video
              </button>
              <button className="import-pdf-btn" disabled={importingParsed} onClick={() => parsedImportRef.current?.click()}>
                {importingParsed ? "Importing…" : "Import Parsed"}
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
            onDeleteTag={handleDeleteTagGlobal}
            onSetTagColor={setTagColor}
          />
        ) : (
          <div className="graph-container" ref={graphContainerRef}>
            <Suspense fallback={<div className="loading-state">Loading graph…</div>}>
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
            </Suspense>
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
              addEdge={addEdge}
              createNode={createNode}
              deleteNode={handleDeleteNode}
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
    {learnMounted && (
      // Mounted once and kept alive so its graph/camera state survive. Map3D
      // pauses its render loop via `active` while hidden, so keeping it mounted
      // doesn't cost animation frames next to the Vault graph's GL context.
      <div
        className="learn-fullbleed learn-host"
        style={{ display: appMode === "learn" ? undefined : "none" }}
      >
        <Suspense fallback={null}>
          <LearnMode active={appMode === "learn"} />
        </Suspense>
      </div>
    )}
    </div>
      <CalendarSidebar
        isOpen={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        date={new Date()}
        events={calendarEntries.map(entryToEvent)}
        onSlotClick={(hour) =>
          setCalEditor({
            mode: "create",
            date: toIsoDate(new Date()),
            startTime: `${String(hour).padStart(2, "0")}:00`,
          })
        }
        onEventClick={(ev) => {
          const entry = calendarEntries.find((e) => e.key === ev.id);
          if (entry) setCalEditor({ mode: "edit", entry });
        }}
      />
    </div>
    {calEditor && (
      <CalendarBlockEditor
        state={calEditor}
        onClose={() => setCalEditor(null)}
        onSaved={() => { setCalEditor(null); void refreshCalendar(); }}
      />
    )}
    {confirmDialog}
    </div>
  );
}

export default App;
