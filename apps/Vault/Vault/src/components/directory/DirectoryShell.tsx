import { ReactNode, Suspense, useEffect, useMemo, useState } from "react";
import { VaultGraph } from "../../types";
import { lazyWithReload } from "../../lib/lazyLoad";
import { DirectoryTree } from "./DirectoryTree";
import type { ImportKind } from "./DirectoryTree";
import { FolderDirectory } from "./FolderDirectory";
import { Minimap } from "./Minimap";
import { containingFolder, descendantSubgraph, searchSubgraph, tagSubgraph } from "./subgraph";
import { DEFAULT_GRAPH_FILTERS } from "../GraphFilterPanel";
import { ErrorFence } from "./ErrorFence";
import { LayoutSwitch } from "./LayoutSwitch";
import { useElementSize } from "./useDirectory";
import type { LayoutMode } from "./useDirectory";

// GraphView pulls react-force-graph-2d, so it rides the same lazy path App.tsx
// uses for it. Two lazyWithReload calls on one module share a chunk.
const GraphView = lazyWithReload(() => import("../GraphView").then((m) => ({ default: m.GraphView })));
// The main graph is the 3D one — the same component the fullscreen overlay uses,
// now sized by props rather than by the window. It pulls three + both
// force-graph builds, so it rides the same lazy path.
const ForceGraphView = lazyWithReload(() => import("../ForceGraphView").then((m) => ({ default: m.ForceGraphView })));

// ── The prototype shell ─────────────────────────────────────────────────────
//
//   ———————————————— header ————————————————
//   [ sidebar ] [ graph view                ]
//   [ sidebar ] [ graph view                ]
//   [ sidebar ] [ folder directory          ]
//
// The sidebar spans all three rows and stays resizable; the graph takes rows
// 1–2 of the two right-hand columns and the folder directory row 3.

/** What the main graph is currently showing. */
export type Focus =
  | { type: "all" }
  | { type: "folder"; id: string }
  | { type: "tag"; tag: string };

/** How many tags are worth drawing as clusters before the canvas is soup. */
const MAX_CLUSTERS = 8;

interface Props {
  graph: VaultGraph;
  graphData: { nodes: any[]; links: any[] };
  selectedId: string | null;
  currentUserId?: string | null;

  sidebarWidth: number;
  sidebarDragging: boolean;
  onStartResize: (e: React.PointerEvent) => void;

  sidebarView: "list" | "graph" | "tags" | "bin";
  onSidebarView: (v: "list" | "graph" | "tags" | "bin") => void;
  /** Rendered under the sidebar header when the theme panel is open. */
  themeSlot?: ReactNode;
  themeOpen: boolean;
  onToggleTheme: () => void;
  /** The existing TagsPanel, wired by App — this shell owns no tag state. */
  tagsSlot: ReactNode;
  /** The TrashPanel, wired by App like tagsSlot — the shell owns no bin state. */
  binSlot: ReactNode;
  /**
   * The editor panes, wired by App like the other slots. PROVISIONAL CALL
   * (spec: "editor replaces the graph area, or a fourth region"): opening a
   * non-folder node replaces the graph area with this, behind a slim bar
   * whose "‹ Graph" returns. A folder press, a tag press or "All" also return
   * — those are statements about the graph, so the graph answers them.
   */
  editorSlot: ReactNode;

  expanded: Set<string>;
  onToggleExpanded: (id: string) => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  /** parentId === null makes a root node — what the removed block could do. */
  onCreate: (parentId: string | null, name: string, kind: string) => void;
  /** Routes to App's existing import handlers; it owns the file inputs. */
  onImport: (parentId: string | null, kind: ImportKind) => void;
  importingParsed?: boolean;
  onUnlink?: (parentId: string, childId: string) => void;
  onToggleShare?: (id: string, isShared: boolean) => void;

  linkMode: boolean;
  linkSource: string | null;
  onToggleLinkMode: () => void;
  onGraphNodeClick: (id: string) => void;
  onSavePositions: (nodes: any[]) => void;

  onOpenSearch: () => void;
  layout: LayoutMode;
  onLayout: (m: LayoutMode) => void;
}

export function DirectoryShell(props: Props) {
  const {
    graph,
    graphData,
    selectedId,
    currentUserId,
    sidebarWidth,
    sidebarDragging,
    onStartResize,
    sidebarView,
    onSidebarView,
    themeSlot,
    themeOpen,
    onToggleTheme,
    tagsSlot,
    binSlot,
    editorSlot,
    expanded,
    onToggleExpanded,
    onSelect,
    onDelete,
    onCreate,
    onImport,
    importingParsed,
    onUnlink,
    onToggleShare,
    linkMode,
    linkSource,
    onToggleLinkMode,
    onGraphNodeClick,
    onSavePositions,
    onOpenSearch,
    layout,
    onLayout,
  } = props;

  const [focus, setFocus] = useState<Focus>({ type: "all" });
  /**
   * 3D unless the graph itself says otherwise. `ForceGraphView` wraps the WebGL
   * canvas in an error boundary that calls this with `false`, so a machine (or a
   * WebView) that cannot make a context degrades to the 2D canvas instead of
   * white-screening the pane.
   */
  const [is3D, setIs3D] = useState(true);
  /** null = the top of the vault. Follows the focus, or the selection. */
  const [openFolder, setOpenFolder] = useState<string | null>(null);

  const graphCell = useElementSize<HTMLDivElement>();
  const sideCell = useElementSize<HTMLDivElement>();

  // ── What the graph shows ──────────────────────────────────────────────────
  // Everything outside the focus is HIDDEN, not dimmed: the point of pressing a
  // folder is that what is left on screen is the answer.
  const visible = useMemo(() => {
    if (focus.type === "folder") return new Set(descendantSubgraph(graph, focus.id).nodeIds);
    if (focus.type === "tag") return new Set(tagSubgraph(graph, focus.tag).nodeIds);
    return null;
  }, [graph, focus]);

  const focusedData = useMemo(() => {
    if (!visible) return graphData;
    const end = (v: any) => (typeof v === "object" && v ? v.id : v);
    return {
      nodes: graphData.nodes.filter((n: any) => visible.has(n.id)),
      links: graphData.links.filter(
        (l: any) => visible.has(end(l.source)) && visible.has(end(l.target)),
      ),
    };
  }, [graphData, visible]);

  // Search layers ON TOP of the focus: zoom to UNI, search "linear", and the
  // hits light up within UNI. Matches draw red, their connected context stays
  // greyed, everything else is hidden — the same hide-not-dim rule as the
  // folder zoom (pf 1223).
  const [searchText, setSearchText] = useState("");
  const search = useMemo(() => searchSubgraph(graph, searchText), [graph, searchText]);
  const shownData = useMemo(() => {
    if (!search) return focusedData;
    const end = (v: any) => (typeof v === "object" && v ? v.id : v);
    return {
      nodes: focusedData.nodes.filter((n: any) => search.kept.has(n.id)),
      links: focusedData.links.filter(
        (l: any) => search.kept.has(end(l.source)) && search.kept.has(end(l.target)),
      ),
    };
  }, [focusedData, search]);
  // Matches the graph can actually show — a hit outside the current focus is
  // real but off screen, and the count should not claim otherwise.
  const shownMatches = useMemo(
    () => (search ? focusedData.nodes.filter((n: any) => search.matches.has(n.id)).length : 0),
    [focusedData, search],
  );

  // Tags worth drawing as clusters, most-used first.
  const clusterTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of focusedData.nodes as any[]) {
      for (const t of n.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, c]) => c > 1)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, MAX_CLUSTERS)
      .map(([t]) => t);
  }, [focusedData]);

  // Whether the editor stands where the graph does. Selection does not carry
  // this by itself: a note stays selected while you go back to the graph, so
  // the two are separate facts.
  const [editorOpen, setEditorOpen] = useState(false);

  // Selection arriving from OUTSIDE the shell must open the editor exactly as
  // the shell's own selectNode does. ⌘S search, the PDF/Video/Parsed import
  // handlers and the full-graph overlay all go through App.selectNode, which
  // only knows the pane handle — before this effect, those paths loaded the
  // note into the display:none pane while the graph stayed on screen, and
  // "nothing visibly happened". Keyed on the id CHANGING, so "‹ Graph" (which
  // deliberately keeps the selection) is not reopened by its own selection.
  useEffect(() => {
    // `graph` is read but intentionally not a dependency: a graph reload must
    // not reopen an editor someone just closed over an unchanged selection.
    if (selectedId && graph.nodes[selectedId] && graph.nodes[selectedId].kind?.type !== "Folder") {
      setEditorOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function focusFolder(id: string) {
    setFocus({ type: "folder", id });
    setOpenFolder(id);
    setEditorOpen(false);
  }

  function focusTag(tag: string) {
    setFocus((f) => (f.type === "tag" && f.tag === tag ? { type: "all" } : { type: "tag", tag }));
    setEditorOpen(false);
  }

  function resetFocus() {
    setFocus({ type: "all" });
    setEditorOpen(false);
  }

  function selectNode(id: string) {
    onSelect(id);
    const folder = containingFolder(graph, id);
    setOpenFolder(folder);
    if (graph.nodes[id] && graph.nodes[id].kind?.type !== "Folder") setEditorOpen(true);
  }

  // The pane follows the SELECTION, not the graph focus: picking a note in
  // another branch while zoomed should show where that note lives, otherwise
  // the pane is describing something nobody is looking at. Focusing a folder
  // sets both, so pressing a folder still moves the pane.
  const currentFolder = openFolder;
  const focusLabel =
    focus.type === "folder"
      ? graph.nodes[focus.id]?.name ?? "—"
      : focus.type === "tag"
        ? `#${focus.tag}`
        : null;

  // Changing what is on screen should re-frame it; the key is what changed.
  const fitSignal = `${focus.type}:${focus.type === "folder" ? focus.id : focus.type === "tag" ? focus.tag : ""}:${shownData.nodes.length}:${search ? searchText.trim().toLowerCase() : ""}`;

  return (
    <div className="dir-shell">
      <header className="vault-header">
        <span className="vault-header-brand">Vault</span>
        <div className="sidebar-toggle vault-header-switch">
          <button className={sidebarView === "list" ? "active" : ""} onClick={() => onSidebarView("list")}>
            List
          </button>
          <button className={sidebarView === "graph" ? "active" : ""} onClick={() => onSidebarView("graph")}>
            Graph
          </button>
          <button className={sidebarView === "tags" ? "active" : ""} onClick={() => onSidebarView("tags")}>
            Tags
          </button>
          <button className={sidebarView === "bin" ? "active" : ""} onClick={() => onSidebarView("bin")}>
            Bin
          </button>
        </div>
        <button className="vault-search-stub" onClick={onOpenSearch} title="Search (⌘S)">
          <span>Search the vault</span>
          <kbd>⌘S</kbd>
        </button>
        <div className="vault-header-right">
          <button
            className={`sidebar-theme-btn${themeOpen ? " active" : ""}`}
            onClick={onToggleTheme}
            title="Colour scheme"
            aria-pressed={themeOpen}
          >
            ◐
          </button>
          <LayoutSwitch layout={layout} onLayout={onLayout} />
        </div>
      </header>

      <div className="dir-grid">
        <aside
          className="dir-sidebar"
          style={{
            width: sidebarWidth,
            minWidth: sidebarWidth,
            transition: sidebarDragging ? "none" : undefined,
          }}
        >
          <div className="resize-handle" onPointerDown={onStartResize} title="Drag to resize" />
          {themeOpen ? themeSlot : null}
          {sidebarView === "list" ? (
            <div className="dtree-scroll">
              <DirectoryTree
                graph={graph}
                selectedId={selectedId}
                expanded={expanded}
                currentUserId={currentUserId}
                onSelect={selectNode}
                onToggle={onToggleExpanded}
                onDelete={onDelete}
                onCreate={onCreate}
                onImport={onImport}
                importingParsed={importingParsed}
                onUnlink={onUnlink}
                onToggleShare={onToggleShare}
                onFocusFolder={focusFolder}
              />
            </div>
          ) : sidebarView === "tags" ? (
            tagsSlot
          ) : sidebarView === "bin" ? (
            binSlot
          ) : (
            <div className="dir-side-graph" ref={sideCell.ref}>
              {sideCell.size.width > 0 && (
                <ErrorFence label="The graph could not be drawn.">
                <Suspense fallback={<div className="loading-state">Loading graph…</div>}>
                  <GraphView
                    graph={graph}
                    graphData={graphData}
                    selectedId={selectedId}
                    linkMode={linkMode}
                    linkSource={linkSource}
                    width={sideCell.size.width}
                    height={sideCell.size.height}
                    hideToolbar
                    onNodeClick={onGraphNodeClick}
                    onEngineStop={() => onSavePositions(graphData.nodes)}
                    onToggleLinkMode={onToggleLinkMode}
                  />
                </Suspense>
                </ErrorFence>
              )}
            </div>
          )}
        </aside>

        <section className="dir-graph" aria-label={editorOpen ? "Editor" : "Graph"}>
          {/* The editor is mounted WHETHER OR NOT it is shown. Selection
              reaches it through an imperative pane handle (App.selectNode →
              activePaneRef), and a pane that only mounts once something is
              selected is a null ref at exactly the moment the selection is
              delivered. display:none keeps its tabs alive across the
              graph ↔ editor swap for free. */}
          {editorOpen && selectedId && graph.nodes[selectedId] ? (
            // The editor standing where the graph stood — see editorSlot.
            <div className="dir-editor-bar">
              <button className="dir-focus-chip" onClick={() => setEditorOpen(false)}>
                ‹ Graph
              </button>
              <span className="dir-editor-name">{graph.nodes[selectedId].name}</span>
            </div>
          ) : (
            <>
          <div className="dir-graph-bar">
            <div className="dir-focus">
              <button
                className={`dir-focus-chip${focus.type === "all" ? " is-current" : ""}`}
                onClick={resetFocus}
              >
                All
              </button>
              {focusLabel && (
                <>
                  <span className="dir-crumb-sep">/</span>
                  <span className="dir-focus-chip is-current">{focusLabel}</span>
                  <span className="dir-focus-count">{focusedData.nodes.length} nodes</span>
                </>
              )}
            </div>
            <div className="dir-graph-search">
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearchText("");
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="Search the graph…"
                aria-label="Search the graph"
              />
              {search && (
                <span className="dir-search-count" aria-live="polite">
                  {shownMatches} match{shownMatches === 1 ? "" : "es"}
                </span>
              )}
            </div>
            <div className="dir-tagbar">
              {clusterTags.map((tag) => (
                <button
                  key={tag}
                  className={`dir-tag-chip${focus.type === "tag" && focus.tag === tag ? " is-current" : ""}`}
                  onClick={() => focusTag(tag)}
                  style={
                    graph.tag_colors[tag]
                      ? { borderColor: graph.tag_colors[tag], color: graph.tag_colors[tag] }
                      : undefined
                  }
                  title={`Show only #${tag}`}
                >
                  {tag}
                </button>
              ))}
            </div>
            <button
              className={`gtb-btn${linkMode ? " active" : ""}`}
              onClick={onToggleLinkMode}
              title={linkMode ? "Cancel linking" : "Link two nodes"}
              aria-label="Link two nodes"
              aria-pressed={linkMode}
            >
              ⊸
            </button>
            {linkMode && (
              <span className="gtb-hint">{linkSource ? "Select target…" : "Select source…"}</span>
            )}
          </div>

          <div className="dir-graph-canvas" ref={graphCell.ref}>
            {/* Gate the mount on having nodes: an empty graphData is what trips
                the kapsule/layout race CLAUDE.md documents, and "nothing here"
                deserves a sentence rather than an empty canvas anyway. */}
            {focusedData.nodes.length === 0 ? (
              <div className="graph-empty-state">
                {Object.keys(graph.nodes).length === 0
                  ? "No nodes in vault yet"
                  : "Nothing here — press All to go back"}
              </div>
            ) : (
              graphCell.size.width > 0 && (
                <ErrorFence label="The graph could not be drawn.">
                <Suspense fallback={<div className="loading-state">Loading graph…</div>}>
                  <ForceGraphView
                    graph={graph}
                    filteredGraphData={shownData}
                    searchMatches={search ? search.matches : null}
                    graphFilters={DEFAULT_GRAPH_FILTERS}
                    is3D={is3D}
                    setIs3D={setIs3D}
                    selectedId={selectedId}
                    linkMode={linkMode}
                    linkSource={linkSource}
                    // Both are "is this graph live?" gates inside the component;
                    // in this shell it always is.
                    fullGraph
                    appMode="vault"
                    width={graphCell.size.width}
                    height={graphCell.size.height}
                    fitSignal={fitSignal}
                    onClusterClick={focusTag}
                    onNodeClick={(id: string) => {
                      onGraphNodeClick(id);
                      setOpenFolder(containingFolder(graph, id));
                      // A note clicked in the graph opens like one clicked in
                      // the tree — unless the click is one half of a link.
                      if (!linkMode && graph.nodes[id]?.kind?.type !== "Folder") setEditorOpen(true);
                    }}
                    savePositions={onSavePositions}
                  />
                </Suspense>
                </ErrorFence>
              )
            )}
            <Minimap
              graph={graph}
              currentId={focus.type === "folder" ? focus.id : null}
              onPick={focusFolder}
            />
          </div>
            </>
          )}
          <div
            className="dir-editor-hold"
            style={{ display: editorOpen && selectedId && graph.nodes[selectedId] ? undefined : "none" }}
          >
            {editorSlot}
          </div>
        </section>

        <FolderDirectory
          graph={graph}
          folderId={currentFolder}
          selectedId={selectedId}
          onOpenFolder={(id) => {
            setOpenFolder(id);
            if (id) focusFolder(id);
            else resetFocus();
          }}
          onSelect={selectNode}
        />
      </div>
    </div>
  );
}
