import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import katex from "katex";
import "katex/dist/katex.min.css";
import { VaultGraph } from "../types";
import { NoteEditor } from "./NoteEditor";
import { CanvasEditor } from "./CanvasEditor";

// ── Data model ──────────────────────────────────────────────────────────────

type SectionId = "literature" | "notes" | "canvas" | "formulas" | "exercises";

export interface FormulaItem {
  id: string;
  label: string;
  latex: string;
  description: string;
}

// Content block types for exercises
interface ExTextBlock  { id: string; type: "text";  content: string; }
interface ExMathBlock  { id: string; type: "math";  formula: string; }
interface ExCodeBlock  { id: string; type: "code";  lang: string; code: string; }
interface ExImageBlock { id: string; type: "image"; src: string; caption: string; }
type ExBlock = ExTextBlock | ExMathBlock | ExCodeBlock | ExImageBlock;

interface ExerciseItem {
  id: string;
  title: string;
  status: "todo" | "in-progress" | "done" | "skipped";
  difficulty: "easy" | "medium" | "hard" | "";
  blocks: ExBlock[];          // question content
  solutionBlocks: ExBlock[];  // solution content
  collapsed: boolean;         // card folded state (persisted)
}

interface WorkbookData {
  activeSection: SectionId;
  literature: string[];   // PDF node IDs
  notes: string[];        // Note node IDs
  canvas: string[];       // Canvas node IDs
  activeCollectionId: string | null;
  standaloneFormulas: FormulaItem[];
  exercises: ExerciseItem[];
}

// ── Formula collections (localStorage) ──────────────────────────────────────

export interface FormulaCollection {
  id: string;
  name: string;
  formulas: FormulaItem[];
}

const COLLECTIONS_KEY = "vault.formula_collections";

function loadCollections(): FormulaCollection[] {
  try { return JSON.parse(localStorage.getItem(COLLECTIONS_KEY) ?? "null") ?? []; }
  catch { return []; }
}

function saveCollections(cols: FormulaCollection[]) {
  localStorage.setItem(COLLECTIONS_KEY, JSON.stringify(cols));
}

export function useFormulaCollections() {
  const [collections, setCollections] = useState<FormulaCollection[]>(loadCollections);

  function persist(next: FormulaCollection[]) {
    setCollections(next);
    saveCollections(next);
  }

  function addCollection(name: string): FormulaCollection {
    const c: FormulaCollection = { id: uid(), name, formulas: [] };
    persist([...collections, c]);
    return c;
  }

  function updateCollection(id: string, patch: Partial<FormulaCollection>) {
    persist(collections.map(c => c.id === id ? { ...c, ...patch } : c));
  }

  function removeCollection(id: string) {
    persist(collections.filter(c => c.id !== id));
  }

  return { collections, addCollection, updateCollection, removeCollection };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string { return Math.random().toString(36).slice(2, 10); }

function defaultData(): WorkbookData {
  return {
    activeSection: "literature",
    literature: [],
    notes: [],
    canvas: [],
    activeCollectionId: null,
    standaloneFormulas: [],
    exercises: [],
  };
}

function parseData(raw: string): WorkbookData {
  if (!raw) return defaultData();
  try {
    const d = JSON.parse(raw);
    return {
      activeSection: d.activeSection ?? "literature",
      literature: Array.isArray(d.literature)
        ? d.literature.map((x: any) => (typeof x === "string" ? x : x.id)).filter(Boolean)
        : [],
      notes: Array.isArray(d.notes) ? d.notes : [],
      canvas: Array.isArray(d.canvas) ? d.canvas : [],
      activeCollectionId: d.activeCollectionId ?? null,
      standaloneFormulas: Array.isArray(d.standaloneFormulas) ? d.standaloneFormulas
        : Array.isArray(d.formulas) ? d.formulas
        : [],
      exercises: Array.isArray(d.exercises) ? d.exercises.map((e: any): ExerciseItem => ({
        id: e.id ?? uid(),
        title: e.title ?? "",
        status: e.status ?? (e.done ? "done" : "todo"),
        difficulty: e.difficulty ?? "",
        collapsed: e.collapsed ?? false,
        blocks: Array.isArray(e.blocks) ? e.blocks
          : (e.question ? [{ id: uid(), type: "text" as const, content: e.question }] : []),
        solutionBlocks: Array.isArray(e.solutionBlocks) ? e.solutionBlocks
          : (e.solution ? [{ id: uid(), type: "text" as const, content: e.solution }] : []),
      })) : [],
    };
  } catch { return defaultData(); }
}

// ── Root component ───────────────────────────────────────────────────────────

interface WorkbookEditorProps {
  nodeId: string;
  name: string;
  content: string;
  onChange: (content: string) => void;
  graph: VaultGraph;
  onOpenNode: (id: string) => void;
}

const TABS: { id: SectionId; label: string }[] = [
  { id: "literature", label: "Literature" },
  { id: "notes",      label: "Notes"      },
  { id: "canvas",     label: "Canvas"     },
  { id: "formulas",   label: "Formulas"   },
  { id: "exercises",  label: "Exercises"  },
];

export function WorkbookEditor({ nodeId, name, content, onChange, graph, onOpenNode }: WorkbookEditorProps) {
  const [data, setData] = useState<WorkbookData>(() => parseData(content));
  const prevNodeId = useRef(nodeId);
  const formulaCollections = useFormulaCollections();

  useEffect(() => {
    if (prevNodeId.current !== nodeId) {
      prevNodeId.current = nodeId;
      setData(parseData(content));
    }
  }, [nodeId, content]);

  useEffect(() => {
    const t = setTimeout(() => onChange(JSON.stringify(data)), 400);
    return () => clearTimeout(t);
  }, [data]);

  const update = useCallback((patch: Partial<WorkbookData>) => {
    setData(prev => ({ ...prev, ...patch }));
  }, []);

  return (
    <div className="wb-root">
      <div className="wb-header">
        <span className="wb-title">{name}</span>
        <div className="wb-tabs">
          {TABS.map(t => (
            <button key={t.id}
              className={`wb-tab${data.activeSection === t.id ? " wb-tab-active" : ""}`}
              onClick={() => update({ activeSection: t.id })}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="wb-body">
        {data.activeSection === "literature" && (
          <LiteratureSection
            linkedIds={data.literature}
            graph={graph}
            onOpenNode={onOpenNode}
            onChange={literature => update({ literature })}
          />
        )}
        {data.activeSection === "notes" && (
          <NotesSection
            linkedIds={data.notes}
            graph={graph}
            onOpenNode={onOpenNode}
            onChange={notes => update({ notes })}
          />
        )}
        {data.activeSection === "canvas" && (
          <CanvasSection
            linkedIds={data.canvas}
            graph={graph}
            onOpenNode={onOpenNode}
            onChange={canvas => update({ canvas })}
          />
        )}
        {data.activeSection === "formulas" && (
          <FormulasSection
            activeCollectionId={data.activeCollectionId}
            standaloneFormulas={data.standaloneFormulas}
            onChangeCollectionId={id => update({ activeCollectionId: id })}
            onChangeStandalone={f => update({ standaloneFormulas: f })}
            collections={formulaCollections}
          />
        )}
        {data.activeSection === "exercises" && (
          <ExercisesSection
            items={data.exercises}
            onChange={exercises => update({ exercises })}
          />
        )}
      </div>
    </div>
  );
}

// ── Literature (PDF links) ────────────────────────────────────────────────────

interface LiteratureSectionProps {
  linkedIds: string[];
  graph: VaultGraph;
  onOpenNode: (id: string) => void;
  onChange: (ids: string[]) => void;
}

function LiteratureSection({ linkedIds, graph, onOpenNode, onChange }: LiteratureSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contentMap, setContentMap] = useState<Record<string, string>>({});

  useEffect(() => {
    const missing = linkedIds.filter(id => !(id in contentMap));
    if (missing.length === 0) return;
    missing.forEach(id => {
      invoke<string>("read_content", { id }).then(c => {
        setContentMap(prev => ({ ...prev, [id]: c }));
      });
    });
  }, [linkedIds.join(",")]);

  const pdfNodes = Object.values(graph.nodes).filter(n => n.kind.type === "Pdf");
  const available = pdfNodes.filter(
    n => !linkedIds.includes(n.id) &&
      (!search.trim() || n.name.toLowerCase().includes(search.toLowerCase()))
  );

  function link(id: string) {
    onChange([...linkedIds, id]);
    setPickerOpen(false);
    setSearch("");
  }

  function unlink(id: string) { onChange(linkedIds.filter(x => x !== id)); }

  return (
    <div className="wb-full-section">
      <div className="wb-section-toolbar">
        <span className="wb-section-title">Books / Papers</span>
        <button className="wb-add-btn" onClick={() => setPickerOpen(v => !v)}>
          {pickerOpen ? "Cancel" : "+ Link PDF"}
        </button>
      </div>

      {pickerOpen && (
        <div className="wb-picker-panel">
          <input
            className="wb-picker-search"
            placeholder="Search PDFs in vault…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          {available.length === 0 && (
            <div className="wb-picker-empty">
              {pdfNodes.length === 0
                ? "No PDF nodes in vault — import a PDF first."
                : "All PDFs already linked, or no match."}
            </div>
          )}
          {available.map(n => (
            <button key={n.id} className="wb-picker-item" onClick={() => link(n.id)}>
              <span className="wb-picker-icon">⎕</span>
              {n.name}
            </button>
          ))}
        </div>
      )}

      {linkedIds.length === 0 && !pickerOpen && (
        <div className="wb-empty">No sources linked. Add a PDF from your vault.</div>
      )}

      {linkedIds.map(id => {
        const node = graph.nodes[id];
        if (!node) return null;
        const src = contentMap[id];
        return (
          <div key={id} className="wb-node-page">
            <div className="wb-node-page-bar">
              <span className="wb-node-page-icon">⎕</span>
              <span className="wb-node-page-name">{node.name}</span>
              <button className="wb-lit-open" onClick={() => onOpenNode(id)} title="Open in tab">↗</button>
              <button className="wb-delete-btn wb-delete-visible" onClick={() => unlink(id)}>×</button>
            </div>
            <div className="wb-node-page-body wb-node-page-pdf">
              {src !== undefined
                ? src ? <iframe src={src} className="wb-pdf-frame" title={node.name} /> : <div className="wb-inline-loading">No content</div>
                : <div className="wb-inline-loading">Loading…</div>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Notes (linked Note / Canvas nodes) ───────────────────────────────────────

interface NotesSectionProps {
  linkedIds: string[];
  graph: VaultGraph;
  onOpenNode: (id: string) => void;
  onChange: (ids: string[]) => void;
}

interface CanvasSectionProps {
  linkedIds: string[];
  graph: VaultGraph;
  onOpenNode: (id: string) => void;
  onChange: (ids: string[]) => void;
}

function NotesSection({ linkedIds, graph, onOpenNode, onChange }: NotesSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const missing = linkedIds.filter(id => !(id in contentMap));
    if (missing.length === 0) return;
    missing.forEach(id => {
      invoke<string>("read_content", { id }).then(c => {
        setContentMap(prev => ({ ...prev, [id]: c }));
      });
    });
  }, [linkedIds.join(",")]);

  const noteNodes = Object.values(graph.nodes).filter(n => n.kind.type === "Note");
  const available = noteNodes.filter(
    n => !linkedIds.includes(n.id) &&
      (!search.trim() || n.name.toLowerCase().includes(search.toLowerCase()))
  );

  function link(id: string) {
    onChange([...linkedIds, id]);
    setPickerOpen(false);
    setSearch("");
  }

  function unlink(id: string) { onChange(linkedIds.filter(x => x !== id)); }

  function handleContentChange(id: string, content: string) {
    setContentMap(prev => ({ ...prev, [id]: content }));
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      invoke("save_content", { id, content });
    }, 400);
  }

  return (
    <div className="wb-full-section">
      <div className="wb-section-toolbar">
        <span className="wb-section-title">Notes</span>
        <button className="wb-add-btn" onClick={() => setPickerOpen(v => !v)}>
          {pickerOpen ? "Cancel" : "+ Link note"}
        </button>
      </div>

      {pickerOpen && (
        <div className="wb-picker-panel">
          <input
            className="wb-picker-search"
            placeholder="Search notes…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          {available.length === 0 && (
            <div className="wb-picker-empty">
              {noteNodes.length === 0 ? "No Note nodes in vault yet." : "All notes already linked."}
            </div>
          )}
          {available.map(n => (
            <button key={n.id} className="wb-picker-item" onClick={() => link(n.id)}>
              <span className="wb-picker-icon">≡</span>
              {n.name}
            </button>
          ))}
        </div>
      )}

      {linkedIds.length === 0 && !pickerOpen && (
        <div className="wb-empty">No notes linked. Connect a Note from your vault.</div>
      )}

      {linkedIds.map(id => {
        const node = graph.nodes[id];
        if (!node) return null;
        const nodeContent = contentMap[id];
        return (
          <div key={id} className="wb-node-page">
            <div className="wb-node-page-bar">
              <span className="wb-node-page-icon">≡</span>
              <span className="wb-node-page-name">{node.name}</span>
              <button className="wb-lit-open" onClick={() => onOpenNode(id)} title="Open note">↗</button>
              <button className="wb-delete-btn wb-delete-visible" onClick={() => unlink(id)}>×</button>
            </div>
            <div className="wb-node-page-body wb-node-page-note">
              {nodeContent === undefined
                ? <div className="wb-inline-loading">Loading…</div>
                : <NoteEditor content={nodeContent} onChange={c => handleContentChange(id, c)} />
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Canvas (linked Canvas nodes) ──────────────────────────────────────────────

function CanvasSection({ linkedIds, graph, onOpenNode, onChange }: CanvasSectionProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [contentMap, setContentMap] = useState<Record<string, string>>({});
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const missing = linkedIds.filter(id => !(id in contentMap));
    if (missing.length === 0) return;
    missing.forEach(id => {
      invoke<string>("read_content", { id }).then(c => {
        setContentMap(prev => ({ ...prev, [id]: c }));
      });
    });
  }, [linkedIds.join(",")]);

  const canvasNodes = Object.values(graph.nodes).filter(n => n.kind.type === "Canvas");
  const available = canvasNodes.filter(
    n => !linkedIds.includes(n.id) &&
      (!search.trim() || n.name.toLowerCase().includes(search.toLowerCase()))
  );

  function link(id: string) {
    onChange([...linkedIds, id]);
    setPickerOpen(false);
    setSearch("");
  }

  function unlink(id: string) { onChange(linkedIds.filter(x => x !== id)); }

  function handleContentChange(id: string, content: string) {
    setContentMap(prev => ({ ...prev, [id]: content }));
    clearTimeout(saveTimers.current[id]);
    saveTimers.current[id] = setTimeout(() => {
      invoke("save_content", { id, content });
    }, 400);
  }

  return (
    <div className="wb-full-section">
      <div className="wb-section-toolbar">
        <span className="wb-section-title">Canvases</span>
        <button className="wb-add-btn" onClick={() => setPickerOpen(v => !v)}>
          {pickerOpen ? "Cancel" : "+ Link canvas"}
        </button>
      </div>

      {pickerOpen && (
        <div className="wb-picker-panel">
          <input
            className="wb-picker-search"
            placeholder="Search canvases…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
          {available.length === 0 && (
            <div className="wb-picker-empty">
              {canvasNodes.length === 0 ? "No Canvas nodes in vault yet." : "All canvases already linked."}
            </div>
          )}
          {available.map(n => (
            <button key={n.id} className="wb-picker-item" onClick={() => link(n.id)}>
              <span className="wb-picker-icon">◻</span>
              {n.name}
            </button>
          ))}
        </div>
      )}

      {linkedIds.length === 0 && !pickerOpen && (
        <div className="wb-empty">No canvases linked. Connect a Canvas from your vault.</div>
      )}

      {linkedIds.map(id => {
        const node = graph.nodes[id];
        if (!node) return null;
        const nodeContent = contentMap[id];
        return (
          <div key={id} className="wb-node-page">
            <div className="wb-node-page-bar">
              <span className="wb-node-page-icon">◻</span>
              <span className="wb-node-page-name">{node.name}</span>
              <button className="wb-lit-open" onClick={() => onOpenNode(id)} title="Open canvas">↗</button>
              <button className="wb-delete-btn wb-delete-visible" onClick={() => unlink(id)}>×</button>
            </div>
            <div className="wb-node-page-body wb-node-page-canvas">
              {nodeContent === undefined
                ? <div className="wb-inline-loading">Loading…</div>
                : <CanvasEditor nodeId={id} content={nodeContent} onChange={c => handleContentChange(id, c)} />
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Formulas ──────────────────────────────────────────────────────────────────

function FormulaPreview({ latex }: { latex: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    if (!latex.trim()) { ref.current.innerHTML = ""; setError(null); return; }
    try {
      katex.render(latex, ref.current, { throwOnError: true, displayMode: true });
      setError(null);
    } catch (e: any) {
      ref.current.innerHTML = "";
      setError(e.message ?? "LaTeX parse error");
    }
  }, [latex]);

  return (
    <>
      <div ref={ref} className="wb-formula-preview" />
      {error && <div className="wb-formula-error">{error}</div>}
    </>
  );
}

export function FormulaList({ items, onChange }: { items: FormulaItem[]; onChange: (items: FormulaItem[]) => void }) {
  function add() { onChange([...items, { id: uid(), label: "", latex: "", description: "" }]); }
  function del(id: string) { onChange(items.filter(i => i.id !== id)); }
  function patch(id: string, p: Partial<FormulaItem>) { onChange(items.map(i => i.id === id ? { ...i, ...p } : i)); }

  return (
    <>
      {items.length === 0 && <div className="wb-empty">No formulas yet. Add a LaTeX formula.</div>}
      {items.map(item => (
        <div key={item.id} className="wb-card wb-card-open">
          <div className="wb-card-header-flat">
            <input className="wb-input wb-input-label" value={item.label}
              placeholder="Label (e.g. Pythagorean theorem)"
              onChange={e => patch(item.id, { label: e.target.value })} />
            <button className="wb-delete-btn wb-delete-visible" onClick={() => del(item.id)}>×</button>
          </div>
          <div className="wb-field-col">
            <label className="wb-label">LaTeX</label>
            <textarea className="wb-textarea wb-textarea-mono" value={item.latex} rows={2}
              placeholder="e.g. a^2 + b^2 = c^2"
              onChange={e => patch(item.id, { latex: e.target.value })} />
          </div>
          <FormulaPreview latex={item.latex} />
          <div className="wb-field-col">
            <label className="wb-label">Description</label>
            <input className="wb-input" value={item.description} placeholder="Brief explanation…"
              onChange={e => patch(item.id, { description: e.target.value })} />
          </div>
        </div>
      ))}
      <button className="wb-add-btn wb-add-formula-btn" onClick={add}>+ Add formula</button>
    </>
  );
}

interface FormulasSectionProps {
  activeCollectionId: string | null;
  standaloneFormulas: FormulaItem[];
  onChangeCollectionId: (id: string | null) => void;
  onChangeStandalone: (items: FormulaItem[]) => void;
  collections: ReturnType<typeof useFormulaCollections>;
}

function FormulasSection({
  activeCollectionId, standaloneFormulas, onChangeCollectionId, onChangeStandalone, collections,
}: FormulasSectionProps) {
  const [newColName, setNewColName] = useState("");
  const [creatingCol, setCreatingCol] = useState(false);

  const { collections: allCollections, addCollection, updateCollection, removeCollection } = collections;
  const activeCol = allCollections.find(c => c.id === activeCollectionId) ?? null;

  function handleCreateCollection() {
    const name = newColName.trim();
    if (!name) return;
    const col = addCollection(name);
    onChangeCollectionId(col.id);
    setNewColName("");
    setCreatingCol(false);
  }

  return (
    <div className="wb-section">
      {/* Collection selector */}
      <div className="wb-col-selector-row">
        <span className="wb-section-title">Collection</span>
        <div className="wb-col-selector-controls">
          <select
            className="wb-col-select"
            value={activeCollectionId ?? ""}
            onChange={e => onChangeCollectionId(e.target.value || null)}
          >
            <option value="">Standalone (this workbook only)</option>
            {allCollections.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button className="wb-add-btn" onClick={() => setCreatingCol(v => !v)}>
            {creatingCol ? "Cancel" : "+ New collection"}
          </button>
        </div>
      </div>

      {creatingCol && (
        <div className="wb-col-create-row">
          <input
            className="wb-input"
            placeholder="Collection name…"
            value={newColName}
            autoFocus
            onChange={e => setNewColName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreateCollection(); if (e.key === "Escape") setCreatingCol(false); }}
          />
          <button className="wb-add-btn" onClick={handleCreateCollection} disabled={!newColName.trim()}>Create</button>
        </div>
      )}

      {/* Active collection name + delete */}
      {activeCol && (
        <div className="wb-col-header">
          <span className="wb-col-name">{activeCol.name}</span>
          <button className="wb-col-delete" onClick={() => {
            if (confirm(`Delete collection "${activeCol.name}"? This cannot be undone.`)) {
              removeCollection(activeCol.id);
              onChangeCollectionId(null);
            }
          }}>Delete collection</button>
        </div>
      )}

      {/* Formula list */}
      {activeCol ? (
        <FormulaList
          items={activeCol.formulas}
          onChange={formulas => updateCollection(activeCol.id, { formulas })}
        />
      ) : (
        <FormulaList items={standaloneFormulas} onChange={onChangeStandalone} />
      )}
    </div>
  );
}

// ── Exercises ─────────────────────────────────────────────────────────────────

const DIFF_LABELS: Record<string, string> = { "": "—", easy: "Easy", medium: "Medium", hard: "Hard" };
const DIFF_COLORS: Record<string, string> = { easy: "#16a34a", medium: "#ca8a04", hard: "#dc2626" };

const STATUS_OPTIONS: { value: ExerciseItem["status"]; label: string; color: string }[] = [
  { value: "todo",        label: "To do",       color: "#6b7280" },
  { value: "in-progress", label: "In progress", color: "#3b82f6" },
  { value: "done",        label: "Done",        color: "#16a34a" },
  { value: "skipped",     label: "Skipped",     color: "#9ca3af" },
];

function pickImageFile(): Promise<string | null> {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

function newTextBlock(): ExTextBlock  { return { id: uid(), type: "text",  content: "" }; }
function newMathBlock(): ExMathBlock  { return { id: uid(), type: "math",  formula: "" }; }
function newCodeBlock(): ExCodeBlock  { return { id: uid(), type: "code",  lang: "python", code: "" }; }

// Single math block editor with live KaTeX preview
function ExMathEditor({ block, onPatch }: { block: ExMathBlock; onPatch: (p: Partial<ExMathBlock>) => void }) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = previewRef.current;
    if (!el) return;
    if (!block.formula.trim()) { el.innerHTML = ""; setError(null); return; }
    try {
      katex.render(block.formula, el, { throwOnError: true, displayMode: true });
      setError(null);
    } catch (e: any) {
      el.innerHTML = "";
      setError(e.message ?? "Invalid LaTeX");
    }
  }, [block.formula]);

  return (
    <div className="ex-math-block">
      <textarea
        className="ex-code-input ex-math-input"
        value={block.formula}
        rows={2}
        placeholder="LaTeX formula… e.g. \frac{1}{2}mv^2"
        onChange={e => onPatch({ formula: e.target.value })}
      />
      {block.formula.trim() && (
        error
          ? <div className="ex-math-error">{error}</div>
          : <div className="ex-math-preview" ref={previewRef} />
      )}
    </div>
  );
}

// Renders/edits a list of ExBlocks (used for both question and solution)
function ExBlockList({
  blocks,
  onUpdate,
}: {
  blocks: ExBlock[];
  onUpdate: (blocks: ExBlock[]) => void;
}) {
  function patchBlock(id: string, p: Partial<ExBlock>) {
    onUpdate(blocks.map(b => b.id === id ? { ...b, ...p } as ExBlock : b));
  }
  function removeBlock(id: string) {
    onUpdate(blocks.filter(b => b.id !== id));
  }

  function handleTextPaste(blockId: string, e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find(it => it.type.startsWith("image/"));
    if (!imageItem) return; // let normal text paste proceed
    e.preventDefault();
    const file = imageItem.getAsFile();
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const imgBlock: ExImageBlock = { id: uid(), type: "image", src, caption: "" };
      const idx = blocks.findIndex(b => b.id === blockId);
      const next = [...blocks];
      next.splice(idx + 1, 0, imgBlock);
      onUpdate(next);
    };
    reader.readAsDataURL(file);
  }

  async function addImage() {
    const src = await pickImageFile();
    if (!src) return;
    onUpdate([...blocks, { id: uid(), type: "image", src, caption: "" }]);
  }

  return (
    <div className="ex-block-list">
      {blocks.map(block => (
        <div key={block.id} className="ex-block-row">
          <div className="ex-block-content">
            {block.type === "text" && (
              <textarea
                className="wb-textarea ex-text-input"
                value={block.content}
                rows={3}
                placeholder="Write here…"
                onChange={e => patchBlock(block.id, { content: e.target.value })}
                onPaste={e => handleTextPaste(block.id, e)}
              />
            )}
            {block.type === "math" && (
              <ExMathEditor
                block={block as ExMathBlock}
                onPatch={p => patchBlock(block.id, p)}
              />
            )}
            {block.type === "code" && (
              <div className="ex-code-block">
                <div className="ex-code-header">
                  <select
                    className="ex-lang-select"
                    value={(block as ExCodeBlock).lang}
                    onChange={e => patchBlock(block.id, { lang: e.target.value })}
                  >
                    {["python","javascript","typescript","java","c","c++","rust","sql","bash","other"].map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
                <textarea
                  className="ex-code-input"
                  value={(block as ExCodeBlock).code}
                  rows={5}
                  spellCheck={false}
                  placeholder="// code…"
                  onChange={e => patchBlock(block.id, { code: e.target.value })}
                />
              </div>
            )}
            {block.type === "image" && (
              <div className="ex-image-block">
                <img src={(block as ExImageBlock).src} className="ex-image-preview" alt="exercise" draggable={false} />
                <input
                  className="ex-image-caption"
                  value={(block as ExImageBlock).caption}
                  placeholder="Caption…"
                  onChange={e => patchBlock(block.id, { caption: e.target.value })}
                />
              </div>
            )}
          </div>
          <button className="ex-block-remove" title="Remove block" onClick={() => removeBlock(block.id)}>×</button>
        </div>
      ))}

      {/* Add-block toolbar */}
      <div className="ex-add-block-row">
        <button className="ex-add-block-btn" onClick={() => onUpdate([...blocks, newTextBlock()])}>+ Text</button>
        <button className="ex-add-block-btn" onClick={() => onUpdate([...blocks, newMathBlock()])}>∑ Math</button>
        <button className="ex-add-block-btn" onClick={() => onUpdate([...blocks, newCodeBlock()])}>{"{ }"} Code</button>
        <button className="ex-add-block-btn" onClick={addImage}>🖼 Image</button>
      </div>
    </div>
  );
}

function ExerciseCard({
  item,
  index,
  onPatch,
  onDelete,
}: {
  item: ExerciseItem;
  index: number;
  onPatch: (p: Partial<ExerciseItem>) => void;
  onDelete: () => void;
}) {
  const [solutionOpen, setSolutionOpen] = useState(false);
  const status = STATUS_OPTIONS.find(s => s.value === item.status) ?? STATUS_OPTIONS[0];

  return (
    <div className={`ex-card${item.status === "done" ? " ex-card-done" : ""}${item.status === "skipped" ? " ex-card-skipped" : ""}`}>
      {/* ── Header ── */}
      <div className="ex-card-header">
        <button
          className="ex-collapse-btn"
          onClick={() => onPatch({ collapsed: !item.collapsed })}
          title={item.collapsed ? "Expand" : "Collapse"}
        >{item.collapsed ? "▸" : "▾"}</button>

        <span className="ex-index">#{index}</span>

        <input
          className="ex-title-input"
          value={item.title}
          placeholder="Exercise title…"
          onChange={e => onPatch({ title: e.target.value })}
        />

        {/* Status selector styled as a badge */}
        <select
          className="ex-status-select"
          value={item.status}
          style={{ color: status.color, borderColor: status.color + "44" }}
          onChange={e => onPatch({ status: e.target.value as ExerciseItem["status"] })}
        >
          {STATUS_OPTIONS.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        {/* Difficulty badge */}
        <select
          className="ex-diff-select"
          value={item.difficulty}
          style={item.difficulty ? { color: DIFF_COLORS[item.difficulty] } : undefined}
          onChange={e => onPatch({ difficulty: e.target.value as ExerciseItem["difficulty"] })}
        >
          {Object.entries(DIFF_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        <button className="ex-delete-btn" onClick={onDelete} title="Delete exercise">×</button>
      </div>

      {/* ── Body (collapsed when item.collapsed) ── */}
      {!item.collapsed && (
        <div className="ex-card-body">
          <ExBlockList
            blocks={item.blocks}
            onUpdate={blocks => onPatch({ blocks })}
          />

          <div className="ex-solution-row">
            <button
              className="wb-reveal-btn"
              onClick={() => setSolutionOpen(v => !v)}
            >
              {solutionOpen ? "▾ Hide solution" : "▸ Show solution"}
            </button>
          </div>

          {solutionOpen && (
            <div className="ex-solution-section">
              <span className="wb-label">Solution</span>
              <ExBlockList
                blocks={item.solutionBlocks}
                onUpdate={solutionBlocks => onPatch({ solutionBlocks })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExercisesSection({ items, onChange }: { items: ExerciseItem[]; onChange: (i: ExerciseItem[]) => void }) {
  function add() {
    onChange([...items, {
      id: uid(), title: "", status: "todo", difficulty: "", collapsed: false,
      blocks: [newTextBlock()], solutionBlocks: [],
    }]);
  }
  function del(id: string) { onChange(items.filter(i => i.id !== id)); }
  function patch(id: string, p: Partial<ExerciseItem>) { onChange(items.map(i => i.id === id ? { ...i, ...p } : i)); }

  const doneCount = items.filter(i => i.status === "done").length;

  return (
    <div className="wb-section">
      <div className="wb-section-header">
        <span className="wb-section-title">Exercises</span>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {items.length > 0 && (
            <span className="ex-progress-label">{doneCount} / {items.length} done</span>
          )}
          <button className="wb-add-btn" onClick={add}>+ Add exercise</button>
        </div>
      </div>
      {items.length === 0 && (
        <div className="wb-empty">No exercises yet — add practice problems with rich content.</div>
      )}
      {items.map((item, i) => (
        <ExerciseCard
          key={item.id}
          item={item}
          index={i + 1}
          onPatch={p => patch(item.id, p)}
          onDelete={() => del(item.id)}
        />
      ))}
    </div>
  );
}

