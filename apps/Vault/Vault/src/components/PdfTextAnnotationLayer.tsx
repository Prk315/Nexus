import { useState, useRef, useEffect, useCallback } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TextAnnotation {
  id: string;
  pageIdx: number;
  x: number;   // normalized 0..1 within page width
  y: number;   // normalized 0..1 within page height
  text: string;
  fontSize: number;  // logical px, default 14
  color: string;     // hex, default "#1a1a1a"
}

export type TextAnnotations = TextAnnotation[];

// ─── SingleAnnotation ─────────────────────────────────────────────────────────

interface SingleAnnotationProps {
  annot: TextAnnotation;
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  isSelected: boolean;
  onSelect: (id: string | null) => void;
  onChange: (updated: TextAnnotation) => void;
  onDelete: (id: string) => void;
}

function SingleAnnotation({
  annot,
  pageWidth,
  pageHeight,
  zoom,
  isSelected,
  onSelect,
  onChange,
  onDelete,
}: SingleAnnotationProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(annot.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.select();
    }
  }, [editing]);

  // Auto-size textarea
  useEffect(() => {
    if (editing && textareaRef.current) {
      const el = textareaRef.current;
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
      el.style.width  = "auto";
      el.style.width  = Math.max(el.scrollWidth, 60) + "px";
    }
  }, [draft, editing]);

  // ── Drag to move ────────────────────────────────────────────────────────
  const dragStartRef = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (editing) return;
    e.stopPropagation();
    onSelect(annot.id);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      x: annot.x,
      y: annot.y,
    };
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStartRef.current || editing) return;
    const dx = (e.clientX - dragStartRef.current.clientX) / pageWidth;
    const dy = (e.clientY - dragStartRef.current.clientY) / pageHeight;
    const newX = Math.max(0, Math.min(1, dragStartRef.current.x + dx));
    const newY = Math.max(0, Math.min(1, dragStartRef.current.y + dy));
    onChange({ ...annot, x: newX, y: newY });
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    dragStartRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  // ── Edit on double-click ─────────────────────────────────────────────────
  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(annot.text);
    setEditing(true);
  }

  function commitEdit() {
    setEditing(false);
    onChange({ ...annot, text: draft });
  }

  // ── Delete key when selected ─────────────────────────────────────────────
  useEffect(() => {
    if (!isSelected || editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Only delete if nothing else is focused
        const active = document.activeElement;
        if (!active || active === document.body) {
          onDelete(annot.id);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isSelected, editing, annot.id, onDelete]);

  const scaledFontSize = annot.fontSize * zoom;
  const style: React.CSSProperties = {
    left:     `${annot.x * 100}%`,
    top:      `${annot.y * 100}%`,
    fontSize: scaledFontSize,
    color:    annot.color,
  };

  return (
    <div
      className={`pdf-text-annot${isSelected ? " selected" : ""}`}
      style={style}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {isSelected && !editing && (
        <button
          className="pdf-text-annot-delete"
          onPointerDown={e => e.stopPropagation()}
          onClick={e => { e.stopPropagation(); onDelete(annot.id); }}
          title="Delete annotation"
        >
          ×
        </button>
      )}
      {editing ? (
        <textarea
          ref={textareaRef}
          className="pdf-text-annot-textarea"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commitEdit}
          onKeyDown={e => {
            if (e.key === "Escape") { setEditing(false); setDraft(annot.text); }
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commitEdit();
            e.stopPropagation();
          }}
          onClick={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
        />
      ) : (
        <div className="pdf-text-annot-display" style={{ fontSize: scaledFontSize, color: annot.color }}>
          {annot.text || <span style={{ opacity: 0.4 }}>Type…</span>}
        </div>
      )}
    </div>
  );
}

// ─── PdfTextAnnotationLayer ───────────────────────────────────────────────────

interface Props {
  pageIdx: number;
  annotations: TextAnnotation[];
  pageWidth: number;
  pageHeight: number;
  zoom: number;
  tool: string;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (updated: TextAnnotation) => void;
  onCreate: (a: TextAnnotation) => void;
  onDelete: (id: string) => void;
}

export function PdfTextAnnotationLayer({
  pageIdx,
  annotations,
  pageWidth,
  pageHeight,
  zoom,
  tool,
  selectedId,
  onSelect,
  onChange,
  onCreate,
  onDelete,
}: Props) {
  const isTextTool = tool === "text";

  const handleLayerDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTextTool) return;
    // Only create if clicked on the layer background, not on an annotation
    if ((e.target as HTMLElement) !== e.currentTarget) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top)  / rect.height;
    const newAnnot: TextAnnotation = {
      id:       Math.random().toString(36).slice(2),
      pageIdx,
      x:        Math.max(0, Math.min(1, x)),
      y:        Math.max(0, Math.min(1, y)),
      text:     "",
      fontSize: 14,
      color:    "#1a1a1a",
    };
    onCreate(newAnnot);
  }, [isTextTool, pageIdx, onCreate]);

  const handleLayerPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Deselect when clicking empty layer area
    if ((e.target as HTMLElement) === e.currentTarget) {
      onSelect(null);
    }
  }, [onSelect]);

  const layerStyle: React.CSSProperties = {
    pointerEvents: isTextTool ? "all" : "none",
  };

  return (
    <div
      className="pdf-text-annot-layer"
      style={layerStyle}
      onDoubleClick={handleLayerDoubleClick}
      onPointerDown={handleLayerPointerDown}
    >
      {annotations.map(annot => (
        <SingleAnnotation
          key={annot.id}
          annot={annot}
          pageWidth={pageWidth}
          pageHeight={pageHeight}
          zoom={zoom}
          isSelected={selectedId === annot.id}
          onSelect={onSelect}
          onChange={onChange}
          onDelete={onDelete}
        />
      ))}
    </div>
  );
}
