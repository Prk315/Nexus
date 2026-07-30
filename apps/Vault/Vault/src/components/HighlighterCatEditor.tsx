import { HighlighterCategory } from "../types";

interface Props {
  cats: HighlighterCategory[];
  onChange: (next: HighlighterCategory[]) => void;
  onClose: () => void;
}

const PRESET = ["#f1c40f", "#27ae60", "#2980b9", "#e74c3c", "#8e44ad", "#e67e22"];

// Small popover for adding / renaming / recoloring / removing a reader node's
// highlighter categories. Shared by PdfViewer and NoteEditor.
export function HighlighterCatEditor({ cats, onChange, onClose }: Props) {
  function update(i: number, patch: Partial<HighlighterCategory>) {
    onChange(cats.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }
  function remove(i: number) {
    onChange(cats.filter((_, idx) => idx !== i));
  }
  function add() {
    const color = PRESET[cats.length % PRESET.length];
    onChange([...cats, { name: `Category ${cats.length + 1}`, color }]);
  }

  return (
    <div className="hl-cat-editor">
      <div className="hl-cat-editor-head">
        <span>Highlighters</span>
        <button className="hl-cat-close" onClick={onClose} title="Close">×</button>
      </div>
      <div className="hl-cat-rows">
        {cats.map((c, i) => (
          <div className="hl-cat-row" key={i}>
            <input
              type="color"
              className="hl-cat-color"
              value={c.color}
              onChange={(e) => update(i, { color: e.target.value })}
              title="Color"
            />
            <input
              className="hl-cat-name"
              value={c.name}
              onChange={(e) => update(i, { name: e.target.value })}
              placeholder="Name"
            />
            <button className="hl-cat-del" onClick={() => remove(i)} title="Remove">×</button>
          </div>
        ))}
      </div>
      <button className="hl-cat-add" onClick={add}>+ Add category</button>
    </div>
  );
}
