import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
  Component,
} from "react";
import * as api from "../lib/api";
import { TagBar } from "./TagBar";
import { NoteEditor } from "./NoteEditor";
import { CanvasEditor } from "./CanvasEditor";
import { PdfViewer } from "./PdfViewer";
import { VideoViewer } from "./VideoViewer";
import { WorkbookEditor } from "./WorkbookEditor";
import { BookshelfEditor } from "./BookshelfEditor";
import { JournalEditor } from "./JournalEditor";
import { DatabaseEditor } from "./DatabaseEditor";
import { HomePage } from "./HomePage";
import { GraphView } from "./GraphView";
import { nodeIcon } from "../nodeUtils";
import type { VaultGraph } from "../types";

// Shared across all panes for the session — avoids re-reading disk when the
// same note is opened in a second pane or re-opened after tab close.
const globalContentCache = new Map<string, string>();

class EditorErrorBoundary extends Component<
  { label: string; children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { label: string; children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidCatch(e: Error) {
    console.error(`${this.props.label} crash:`, e);
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 32,
            color: "#ef4444",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
          }}
        >
          <strong>{this.props.label} crashed:</strong>
          {"\n\n"}
          {this.state.error}
        </div>
      );
    }
    return this.props.children;
  }
}

export interface EditorPaneHandle {
  selectNode: (id: string) => void;
  closeTabIfOpen: (id: string) => void;
  showHome: () => void;
  selectNextTab: () => void;
  selectPrevTab: () => void;
  closeCurrentTab: () => void;
}

interface EditorPaneProps {
  graph: VaultGraph;
  isActive: boolean;
  canClose: boolean;
  onActivate: () => void;
  onClose: () => void;
  onAddPane: () => void;
  onSelectionChange: (nodeId: string | null) => void;
  removeEdge: (a: string, b: string) => Promise<void>;
  addEdge: (a: string, b: string) => Promise<void>;
  createNode: (name: string, kind: string) => Promise<VaultGraph>;
  deleteNode: (id: string) => Promise<void>;
  addTag: (id: string, tag: string) => Promise<void>;
  removeTag: (id: string, tag: string) => Promise<void>;
  setTagColor: (tag: string, color: string) => void;
  savePositions: (nodes: any[]) => void;
  style?: React.CSSProperties;
}

export const EditorPane = forwardRef<EditorPaneHandle, EditorPaneProps>(
  function EditorPane(
    {
      graph,
      isActive,
      canClose,
      onActivate,
      onClose,
      onAddPane,
      onSelectionChange,
      removeEdge,
      addEdge,
      createNode,
      deleteNode,
      addTag,
      removeTag,
      setTagColor,
      savePositions,
      style,
    },
    ref
  ) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [content, setContent] = useState("");
    const [openTabs, setOpenTabs] = useState<string[]>([]);
    const [showHomeState, setShowHomeState] = useState(true);
    const [saveStatus, setSaveStatus] = useState("");
    const [newTag, setNewTag] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    // Folder-graph editing: connect (link mode), add child, select-then-delete.
    const [linkMode, setLinkMode] = useState(false);
    const [linkSource, setLinkSource] = useState<string | null>(null);
    const [graphSelId, setGraphSelId] = useState<string | null>(null);
    const lastGraphClickRef = useRef<{ id: string; t: number }>({ id: "", t: 0 });

    const folderAreaRef = useRef<HTMLDivElement>(null);
    const [folderAreaSize, setFolderAreaSize] = useState({
      width: 800,
      height: 600,
    });

    const isFolderSelected = selectedId
      ? graph.nodes[selectedId]?.kind.type === "Folder"
      : false;
    const isPdfSelected = selectedId
      ? graph.nodes[selectedId]?.kind.type === "Pdf"
      : false;
    const isVideoSelected = selectedId
      ? graph.nodes[selectedId]?.kind.type === "Video"
      : false;
    const isDatabaseSelected = selectedId
      ? graph.nodes[selectedId]?.kind.type === "Database"
      : false;

    const selectedNode = selectedId ? graph.nodes[selectedId] : null;
    const edgeChildren = selectedId
      ? (graph.edges[selectedId] ?? []).filter((id) => graph.nodes[id])
      : [];

    useEffect(() => {
      const el = folderAreaRef.current;
      if (!el || !isFolderSelected) return;
      const w = el.offsetWidth,
        h = el.offsetHeight;
      setFolderAreaSize((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );
      const ro = new ResizeObserver(([entry]) => {
        const { width, height } = entry.contentRect;
        setFolderAreaSize((prev) =>
          prev.width === width && prev.height === height
            ? prev
            : { width, height }
        );
      });
      ro.observe(el);
      return () => ro.disconnect();
    }, [isFolderSelected]);

    const folderGraphData = useMemo(() => {
      if (!isFolderSelected || !selectedId || !selectedNode) return null;
      const seen = new Set<string>([selectedId]);
      const nodes: { id: string; name: string; kind: any; tags: string[] }[] =
        [
          {
            id: selectedId,
            name: selectedNode.name,
            kind: selectedNode.kind,
            tags: selectedNode.tags,
          },
        ];
      const links: { source: string; target: string }[] = [];
      for (const childId of edgeChildren) {
        const child = graph.nodes[childId];
        if (!child || seen.has(childId)) continue;
        seen.add(childId);
        nodes.push({
          id: child.id,
          name: child.name,
          kind: child.kind,
          tags: child.tags,
        });
        links.push({ source: selectedId, target: childId });
        for (const grandId of graph.edges[childId] ?? []) {
          const grand = graph.nodes[grandId];
          if (!grand || seen.has(grandId)) continue;
          seen.add(grandId);
          nodes.push({
            id: grand.id,
            name: grand.name,
            kind: grand.kind,
            tags: grand.tags,
          });
          links.push({ source: childId, target: grandId });
        }
      }
      return { nodes, links };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFolderSelected, selectedId, edgeChildren.join(","), graph]);

    // Auto-save
    useEffect(() => {
      if (!selectedId || isFolderSelected || isPdfSelected || isVideoSelected || isDatabaseSelected)
        return;
      setSaveStatus("saving");
      const timer = setTimeout(async () => {
        await api.saveContent(selectedId, content);
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus(""), 1500);
      }, 400);
      return () => clearTimeout(timer);
    }, [content, selectedId]);

    // Keep global cache in sync with in-memory edits so other panes benefit.
    useEffect(() => {
      if (
        selectedId &&
        !isFolderSelected &&
        !isPdfSelected &&
        !isVideoSelected
      ) {
        globalContentCache.set(selectedId, content);
      }
    }, [content, selectedId]);

    // Notify parent of selection changes
    useEffect(() => {
      onSelectionChange(selectedId);
    }, [selectedId]);

    // Reset folder-graph editing state when the viewed node changes.
    useEffect(() => {
      setGraphSelId(null);
      setLinkMode(false);
      setLinkSource(null);
    }, [selectedId]);


    // ── Folder-graph editing ────────────────────────────────────────────────
    // Single click selects (highlights) a node; double click opens it. In link
    // mode, clicks connect a source → target instead.
    function handleFolderNodeClick(id: string) {
      const now = Date.now();
      const last = lastGraphClickRef.current;
      lastGraphClickRef.current = { id, t: now };
      if (last.id === id && now - last.t < 300) {
        // double click → open
        setGraphSelId(null);
        selectNode(id);
        return;
      }
      if (linkMode) {
        if (!linkSource) { setLinkSource(id); return; }
        if (linkSource === id) { setLinkSource(null); return; }
        addEdge(linkSource, id).catch(() => {});
        setLinkSource(null);
        return;
      }
      setGraphSelId(id);
    }

    function toggleFolderLinkMode() {
      setLinkMode((v) => !v);
      setLinkSource(null);
    }

    // Create a node as a child of the folder currently shown, so it appears in
    // this folder's graph (mirrors App.handleCreateChild).
    async function handleFolderCreateNode(name: string, kind: string) {
      if (!selectedId) return;
      const oldIds = new Set(Object.keys(graph.nodes));
      const g = await createNode(name, kind);
      const newId = Object.keys(g.nodes).find((id) => !oldIds.has(id));
      if (newId) await addEdge(selectedId, newId);
    }

    async function handleFolderDeleteNode(id: string) {
      await deleteNode(id);
      setGraphSelId(null);
    }

    async function selectNode(id: string) {
      const node = graph.nodes[id];
      if (!node) return;
      const isFolder = node.kind.type === "Folder";
      const isJournal = node.kind.type === "Journal";

      if (selectedId && selectedId !== id) {
        globalContentCache.set(selectedId, content);
      }

      let text: string;
      if (isFolder || isJournal) {
        text = "";
      } else if (globalContentCache.has(id)) {
        text = globalContentCache.get(id)!;
      } else {
        setIsLoading(true);
        // For PDF/Video nodes the stored content is the Supabase Storage public URL.
        // For all other types it is the text/JSON content string.
        text = await api.readContent(id);
        globalContentCache.set(id, text);
        setIsLoading(false);
      }

      setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setSelectedId(id);
      setContent(text);
      setShowHomeState(false);
    }

    function closeTab(id: string) {
      setOpenTabs((prev) => {
        const idx = prev.indexOf(id);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t !== id);

        if (selectedId === id) {
          const nextId = next[idx] ?? next[idx - 1] ?? null;
          if (nextId) {
            const nextNode = graph.nodes[nextId];
            const isFolder = nextNode?.kind.type === "Folder";
            const cached = globalContentCache.get(nextId);
            setSelectedId(nextId);
            setContent(cached ?? "");
            if (!isFolder && cached === undefined) {
              api.readContent(nextId).then((t) => {
                globalContentCache.set(nextId, t);
                setContent(t);
              });
            }
          } else {
            setSelectedId(null);
            setContent("");
            setShowHomeState(true);
          }
        }
        // Global cache is intentionally kept — other panes or future re-opens benefit from it.
        return next;
      });
    }

    useImperativeHandle(ref, () => ({
      selectNode,
      closeTabIfOpen(id: string) {
        closeTab(id);
      },
      showHome() {
        setShowHomeState(true);
        setSelectedId(null);
        setContent("");
      },
      selectNextTab() {
        setOpenTabs((prev) => {
          if (!prev.length) return prev;
          const idx = prev.indexOf(selectedId ?? "");
          selectNode(prev[(idx + 1) % prev.length]);
          return prev;
        });
      },
      selectPrevTab() {
        setOpenTabs((prev) => {
          if (!prev.length) return prev;
          const idx = prev.indexOf(selectedId ?? "");
          selectNode(prev[(idx - 1 + prev.length) % prev.length]);
          return prev;
        });
      },
      closeCurrentTab() {
        if (selectedId) closeTab(selectedId);
      },
    }));

    return (
      <div
        className={`editor-pane${isActive ? " pane-active" : ""}`}
        onMouseDown={onActivate}
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          ...style,
        }}
      >
        <div className="tab-bar">
          {openTabs.map((id) => {
            const node = graph.nodes[id];
            if (!node) return null;
            return (
              <button
                key={id}
                className={`tab-item${selectedId === id ? " tab-active" : ""}`}
                onClick={() => selectNode(id)}
              >
                <span className="tab-label">
                  {nodeIcon(node.kind)} {node.name}
                </span>
                <span
                  className="tab-close"
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(id);
                  }}
                >
                  ×
                </span>
              </button>
            );
          })}
          <button
            className="tab-bar-split"
            onClick={(e) => {
              e.stopPropagation();
              onAddPane();
            }}
            title="Split pane right"
          >
            ⊞
          </button>
          {canClose && (
            <button
              className="tab-bar-pane-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              title="Close pane"
            >
              ✕
            </button>
          )}
        </div>

        {showHomeState ? (
          <HomePage graph={graph} onSelectNode={selectNode} />
        ) : selectedNode ? (
          <>
            <div className="editor-toolbar">
              <span className="note-title">
                {nodeIcon(selectedNode.kind)} {selectedNode.name}
              </span>
              <div className="toolbar-actions">
                {saveStatus && (
                  <span className="save-status">
                    {saveStatus === "saving" ? "Saving…" : "Saved"}
                  </span>
                )}
              </div>
            </div>

            <TagBar
              nodeId={selectedId!}
              graph={graph}
              newTag={newTag}
              onNewTagChange={setNewTag}
              onAddTag={(tag) => {
                addTag(selectedId!, tag);
                setNewTag("");
              }}
              onRemoveTag={(tag) => removeTag(selectedId!, tag)}
              onSetTagColor={setTagColor}
            />

            {(() => {
              const outgoing = (graph.edges[selectedId!] ?? []).filter(
                (id) => graph.nodes[id]
              );
              const incoming = (graph.back_edges[selectedId!] ?? []).filter(
                (id) => graph.nodes[id]
              );
              if (outgoing.length === 0 && incoming.length === 0) return null;
              return (
                <div className="edge-bar">
                  {outgoing.map((id) => (
                    <span key={id} className="edge-chip edge-chip-out">
                      → {graph.nodes[id].name}
                      <button
                        className="edge-chip-remove"
                        onClick={() => removeEdge(selectedId!, id)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {incoming.map((id) => (
                    <span key={id} className="edge-chip edge-chip-in">
                      ← {graph.nodes[id].name}
                      <button
                        className="edge-chip-remove"
                        onClick={() => removeEdge(id, selectedId!)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              );
            })()}

            {isFolderSelected && folderGraphData ? (
              <div
                ref={folderAreaRef}
                style={{ flex: 1, minHeight: 0, overflow: "hidden" }}
              >
                <GraphView
                  graph={graph}
                  graphData={folderGraphData}
                  selectedId={graphSelId}
                  linkMode={linkMode}
                  linkSource={linkSource}
                  width={folderAreaSize.width}
                  height={folderAreaSize.height}
                  onNodeClick={handleFolderNodeClick}
                  onEngineStop={() => savePositions(folderGraphData.nodes)}
                  onToggleLinkMode={toggleFolderLinkMode}
                  onCreateNode={handleFolderCreateNode}
                  onDeleteNode={handleFolderDeleteNode}
                  onDeleteEdge={async (a, b) => removeEdge(a, b)}
                />
              </div>
            ) : isFolderSelected ? (
              <div className="empty-state">
                <p>This folder is empty — add children from the sidebar.</p>
              </div>
            ) : isLoading ? (
              <div className="loading-state">Loading…</div>
            ) : selectedNode?.kind.type === "Canvas" ? (
              <CanvasEditor
                content={content}
                onChange={setContent}
                nodeId={selectedId ?? undefined}
              />
            ) : selectedNode?.kind.type === "Pdf" ? (
              <PdfViewer key={selectedId} content={content} nodeId={selectedId!} />
            ) : selectedNode?.kind.type === "Video" ? (
              <VideoViewer content={content} />
            ) : selectedNode?.kind.type === "Workbook" ? (
              <EditorErrorBoundary key={selectedId} label="WorkbookEditor">
                <WorkbookEditor
                  nodeId={selectedId!}
                  name={selectedNode.name}
                  content={content}
                  onChange={setContent}
                  graph={graph}
                  onOpenNode={selectNode}
                />
              </EditorErrorBoundary>
            ) : selectedNode?.kind.type === "Books" ? (
              <EditorErrorBoundary key={selectedId} label="BookshelfEditor">
                <BookshelfEditor
                  nodeId={selectedId!}
                  name={selectedNode.name}
                  content={content}
                  onChange={setContent}
                />
              </EditorErrorBoundary>
            ) : selectedNode?.kind.type === "Journal" ? (
              <JournalEditor key={selectedId} nodeId={selectedId!} />
            ) : selectedNode?.kind.type === "Database" ? (
              <EditorErrorBoundary key={selectedId} label="DatabaseEditor">
                <DatabaseEditor
                  nodeId={selectedId!}
                  graph={graph}
                  onOpenNode={selectNode}
                />
              </EditorErrorBoundary>
            ) : (
              <NoteEditor
                content={content}
                onChange={setContent}
                nodeId={selectedId ?? undefined}
                graph={graph}
              />
            )}
          </>
        ) : (
          <div className="empty-state">
            <p>Select a node or create a new one</p>
          </div>
        )}
      </div>
    );
  }
);
