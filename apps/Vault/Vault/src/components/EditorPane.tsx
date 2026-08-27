import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  forwardRef,
  useImperativeHandle,
  Component,
  Suspense,
} from "react";
import * as api from "../lib/api";
import { TagBar } from "./TagBar";
import { HomePage } from "./HomePage";
import { nodeIcon } from "../nodeUtils";
import type { VaultGraph } from "../types";
import { lazyWithReload } from "../lib/lazyLoad";
import { useCollabSession } from "../collab/useCollabSession";

// Every editor below pulls a heavy transitive dependency (TipTap, pdfjs-dist,
// katex, sql.js, smiles-drawer, react-force-graph-2d, …) that has no business
// loading before the user has even picked a node. Lazy-loading them keeps
// those libs out of the entry chunk; HomePage/TagBar above stay static since
// they're genuinely light and render on every pane.
const NoteEditor = lazyWithReload(() => import("./NoteEditor").then(m => ({ default: m.NoteEditor })));
const CanvasEditor = lazyWithReload(() => import("./CanvasEditor").then(m => ({ default: m.CanvasEditor })));
const PdfViewer = lazyWithReload(() => import("./PdfViewer").then(m => ({ default: m.PdfViewer })));
const ParsedViewer = lazyWithReload(() => import("./ParsedViewer").then(m => ({ default: m.ParsedViewer })));
const VideoViewer = lazyWithReload(() => import("./VideoViewer").then(m => ({ default: m.VideoViewer })));
const WorkbookEditor = lazyWithReload(() => import("./WorkbookEditor").then(m => ({ default: m.WorkbookEditor })));
const BookshelfEditor = lazyWithReload(() => import("./BookshelfEditor").then(m => ({ default: m.BookshelfEditor })));
const JournalEditor = lazyWithReload(() => import("./JournalEditor").then(m => ({ default: m.JournalEditor })));
const DatabaseEditor = lazyWithReload(() => import("./DatabaseEditor").then(m => ({ default: m.DatabaseEditor })));
// GraphView pulls react-force-graph-2d — not "genuinely light" despite being
// canvas-drawn, so it rides the same lazy path as the editors above.
const GraphView = lazyWithReload(() => import("./GraphView").then(m => ({ default: m.GraphView })));

// Shared across all panes for the session — avoids re-reading disk when the
// same note is opened in a second pane or re-opened after tab close.
const globalContentCache = new Map<string, string>();

// What we believe is currently persisted server-side, per node. Distinct from
// globalContentCache, which also holds *unsaved* in-memory edits. Opening a
// node used to fire a full upsert of the bytes we had just read, because the
// autosave effect below runs on mount with no way to tell "loaded" from
// "edited". A missing entry means "unknown", which must fall through to
// saving — never assume clean.
const persistedContent = new Map<string, string>();

/**
 * Forget both cached copies of a node's content.
 *
 * Neither map was ever invalidated, which was survivable while every note had
 * exactly one author. It is not survivable for a shared note: closing a tab and
 * reopening it served your own stale copy back, and on a co-edited note that
 * copy is also the SEED for the CRDT if you happen to be the first one in.
 */
export function invalidateContentCache(id: string): void {
  globalContentCache.delete(id);
  persistedContent.delete(id);
}

/**
 * Live co-editing is opt-in per build so each of the three targets (Vercel web,
 * the Tauri Mac app, the iPad) can be switched on independently and rolled back
 * by redeploying rather than by shipping code. Off unless explicitly enabled.
 */
const COLLAB_ENABLED = import.meta.env.VITE_VAULT_COLLAB === "1";

// Which node kinds fall through the render chain below to NoteEditor AND are
// worth co-editing. Deliberately narrower than "everything that falls through":
// CodeFile and Table also land on NoteEditor and could be added here in one
// line later, but keeping v1 to plain notes keeps the surface small.
function isCoeditableKind(kind: VaultGraph["nodes"][string]["kind"] | undefined): boolean {
  return kind?.type === "Note";
}

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
  /** Discard both caches and re-read this node from the server. */
  reloadCurrent: () => Promise<void>;
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
  /** Resolves false when the user cancels the confirmation, so callers can skip cleanup. */
  deleteNode: (id: string) => Promise<boolean>;
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

    // Live co-editing applies to a shared note and nothing else. `team_id` is
    // what RLS actually checks, so it is what decides here too.
    const collabEligible =
      COLLAB_ENABLED && !!selectedId && selectedNode?.team_id != null && isCoeditableKind(selectedNode?.kind);
    const collab = useCollabSession(collabEligible ? selectedId : null, collabEligible, content);
    const collabSession = collab.session;

    // Set by handleNoteChange just before setContent, and read by the autosave
    // effect after the state commit — so it describes the change that produced
    // the content being saved. If a local and a remote change batch into one
    // render it reads "remote" and we skip; the projection is then one debounce
    // late and the next local keystroke re-arms it. Benign.
    const lastChangeRemoteRef = useRef(false);

    function handleNoteChange(next: string, meta?: { remote?: boolean }) {
      lastChangeRemoteRef.current = !!meta?.remote;
      setContent(next);
    }
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
      // Byte-identical to what's already on the server — this is the mount pass
      // right after selectNode loaded it, not an edit. Writing it back burns a
      // round-trip per node open and, worse, makes a genuinely blocked/blank
      // editor look like a legitimate save.
      if (persistedContent.get(selectedId) === content) return;
      // A co-editor's keystroke is not ours to persist. Both clients write the
      // projection, but only for their own changes — otherwise every character
      // typed by either person would be written twice, and the 2s debounce
      // would never settle while the other person was mid-sentence.
      if (collabSession && lastChangeRemoteRef.current) return;
      setSaveStatus("saving");
      // Under collaboration vault_content is a derived projection, not the
      // truth (vault_ydoc is), and it is re-derived on every keystroke from
      // either side — so it can afford to be lazier than the 400ms an
      // authoritative save needs.
      const delay = collabSession ? 2000 : 400;
      const timer = setTimeout(async () => {
        try {
          // Queued in api.ts: single-flight per node, coalescing, backoff.
          // Resolves once this content (or something newer) is persisted.
          //
          // saveContentProjection skips the updated_at conflict check, which
          // would otherwise fire constantly: on a co-edited note the row
          // legitimately changes under us several times a minute. The CRDT is
          // the merge authority there, so there is nothing to protect.
          await (collabSession ? api.saveContentProjection : api.saveContent)(selectedId, content);
          persistedContent.set(selectedId, content);
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus(""), 1500);
        } catch (e) {
          if (e instanceof api.CollabOnlyError) {
            // This note has live co-editing state but this build isn't
            // participating — either it predates the feature or the flag is
            // off. Saving would discard whatever the CRDT holds, so don't, and
            // say why. Like "conflict", this must never clear on a timer.
            setSaveStatus("collab-only");
          } else if (e instanceof api.ContentConflictError) {
            // Someone else's newer save is on the server — do NOT clear this
            // status on a timer like "saved": it needs to stay until the note
            // is reloaded, or the next autosave would just overwrite them.
            setSaveStatus("conflict");
          } else {
            // The queue gave up after backoff — say so instead of lying "Saved";
            // the content stays pending and the next edit re-arms the save.
            setSaveStatus("error");
          }
        }
      }, delay);
      return () => clearTimeout(timer);
    }, [content, selectedId, collabSession]);

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
      // deleteNode is App's confirmation-gated handler; keep the selection when
      // the user backs out of the dialog.
      if (await deleteNode(id)) setGraphSelId(null);
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
      // A shared node always re-reads. The cache is never invalidated, so on a
      // note somebody else may have edited it serves a stale copy — and on the
      // co-editing path that stale copy is also the seed the CRDT would be
      // built from if we are the first one in. One row is cheap; being wrong
      // about the seed is not. Private notes keep the cache as-is.
      const mustRefetch = graph.nodes[id]?.team_id != null;
      if (isFolder || isJournal) {
        text = "";
      } else if (globalContentCache.has(id) && !mustRefetch) {
        text = globalContentCache.get(id)!;
      } else {
        setIsLoading(true);
        // For PDF/Video nodes the stored content is the Supabase Storage public URL.
        // For all other types it is the text/JSON content string.
        text = await api.readContent(id);
        globalContentCache.set(id, text);
        persistedContent.set(id, text);
        setIsLoading(false);
      }

      setOpenTabs((prev) => (prev.includes(id) ? prev : [...prev, id]));
      setSelectedId(id);
      setContent(text);
      setShowHomeState(false);
    }

    // The exit from a "conflict". Before this existed the status told the user
    // to reload the note and then offered no way to do it — the pane stayed
    // stuck until the tab was closed, because the status deliberately never
    // clears on a timer (clearing it would let the next autosave overwrite the
    // other person's edit, which is the whole thing it is there to prevent).
    //
    // forgetContentVersion matters as much as the re-read: leaving the stale
    // timestamp cached means the very next save throws the same conflict, and
    // the button looks broken.
    async function reloadCurrent() {
      const id = selectedId;
      if (!id) return;
      invalidateContentCache(id);
      api.forgetContentVersion(id);
      const text = await api.readContent(id);
      globalContentCache.set(id, text);
      persistedContent.set(id, text);
      // NoteEditor's [content] effect performs the actual setContent, because
      // the server value differs from what it last emitted.
      setContent(text);
      setSaveStatus("");
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
                persistedContent.set(nextId, t);
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
      // The exit from a "conflict". Before this existed the status told the
      // user to reload a note and then offered no way to do it — the pane
      // stayed stuck until the tab was closed, because the status deliberately
      // never clears on a timer.
      //
      reloadCurrent,
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
                {collabEligible && collabSession && (
                  <span
                    className="collab-status"
                    title={
                      collab.status === "live"
                        ? "Edits are syncing live with your teammate"
                        : "Not connected — your changes are still being saved"
                    }
                  >
                    {collab.status === "live" ? "Live" : "Offline"}
                  </span>
                )}
                {saveStatus && (
                  <span
                    className="save-status"
                    style={(saveStatus === "error" || saveStatus === "conflict" || saveStatus === "collab-only")
                      ? { color: "#f87171" } : undefined}
                  >
                    {saveStatus === "saving" ? "Saving…"
                      : saveStatus === "error" ? "Not saved — will retry on edit"
                      : saveStatus === "collab-only" ? "Not saved — this note is being co-edited; update Vault to edit it"
                      : saveStatus === "conflict" ? (
                        <>
                          Changed by the other user —{" "}
                          {/* The status used to end at "reload this note to see
                              it" with nothing anywhere that could reload it. */}
                          <button
                            type="button"
                            className="save-status-action"
                            onClick={() => { void reloadCurrent(); }}
                          >
                            Reload
                          </button>
                        </>
                      )
                      : "Saved"}
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

            <Suspense fallback={<div className="loading-state">Loading…</div>}>
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
                key={selectedId}
                content={content}
                onChange={setContent}
                nodeId={selectedId ?? undefined}
              />
            ) : selectedNode?.kind.type === "Pdf" ? (
              <PdfViewer key={selectedId} content={content} nodeId={selectedId!} />
            ) : selectedNode?.kind.type === "Parsed" ? (
              <EditorErrorBoundary key={selectedId} label="ParsedViewer">
                <ParsedViewer content={content} onChange={setContent} nodeId={selectedId!} graph={graph} />
              </EditorErrorBoundary>
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
            ) : collabEligible && collab.loading ? (
              // Do NOT mount the editor yet. useEditor is called with the
              // default deps: [], so it builds its extension list exactly once
              // — an editor mounted before the session resolves can never gain
              // Collaboration afterwards, and would sit there for the life of
              // the tab looking fine while silently saving over the other
              // person. Waiting is the only correct option.
              <div className="loading-state">Connecting…</div>
            ) : (
              // key + boundary match every other editor in this switch. The key
              // matters for more than symmetry: without it the editor instance
              // outlives the node, so undo history bleeds across notes and a
              // Cmd-Z after a tab switch rewrites the *previous* note.
              //
              // The collab suffix extends that: a note unshared (or shared)
              // mid-session must rebuild the editor, for the same reason —
              // the extension list is fixed at mount.
              <EditorErrorBoundary key={`${selectedId}:${collabSession ? "c" : "-"}`} label="NoteEditor">
                <NoteEditor
                  content={content}
                  onChange={handleNoteChange}
                  nodeId={selectedId ?? undefined}
                  graph={graph}
                  collab={collabSession}
                />
              </EditorErrorBoundary>
            )}
            </Suspense>
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
