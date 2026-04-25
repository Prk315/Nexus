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
import { HomePage } from "./HomePage";
import { GraphView } from "./GraphView";
import { nodeIcon } from "../nodeUtils";
import type { VaultGraph } from "../types";

// Shared across all panes for the session — avoids re-reading disk when the
// same note is opened in a second pane or re-opened after tab close.
const globalContentCache = new Map<string, string>();

class WorkbookErrorBoundary extends Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  componentDidCatch(e: Error) {
    console.error("WorkbookEditor crash:", e);
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
          <strong>WorkbookEditor crashed:</strong>
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
      if (!selectedId || isFolderSelected || isPdfSelected || isVideoSelected)
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
                  selectedId={selectedId}
                  linkMode={false}
                  linkSource={null}
                  width={folderAreaSize.width}
                  height={folderAreaSize.height}
                  onNodeClick={selectNode}
                  onEngineStop={() => savePositions(folderGraphData.nodes)}
                  onToggleLinkMode={() => {}}
                  onDeleteEdge={async (a, b) => removeEdge(a, b)}
                  hideToolbar
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
              <PdfViewer content={content} nodeId={selectedId!} />
            ) : selectedNode?.kind.type === "Video" ? (
              <VideoViewer content={content} />
            ) : selectedNode?.kind.type === "Workbook" ? (
              <WorkbookErrorBoundary key={selectedId}>
                <WorkbookEditor
                  nodeId={selectedId!}
                  name={selectedNode.name}
                  content={content}
                  onChange={setContent}
                  graph={graph}
                  onOpenNode={selectNode}
                />
              </WorkbookErrorBoundary>
            ) : selectedNode?.kind.type === "Books" ? (
              <BookshelfEditor
                nodeId={selectedId!}
                name={selectedNode.name}
                content={content}
                onChange={setContent}
              />
            ) : selectedNode?.kind.type === "Journal" ? (
              <JournalEditor key={selectedId} nodeId={selectedId!} />
            ) : (
              <NoteEditor content={content} onChange={setContent} />
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
