import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { evaluateSheet, refName, fmtCell, isFormula, type Grid, type Sheet } from "../lib/sheet";

/**
 * Spreadsheet formulas in a note's table.
 *
 * A cell whose text starts with `=` shows its computed value; the formula
 * itself stays the document's content and is what you see when the caret is in
 * that cell. That is not a flourish — it is the only way a formula stays
 * EDITABLE. Replacing the text with the value would mean the document no longer
 * holds the formula, and every sync, export and older client would see a frozen
 * number where a calculation used to be.
 *
 * Decorations rather than a node view, for the same reason folding is
 * decorations: the value is a projection of the document, not part of it, so it
 * must never be something a save can persist or an undo can strip.
 *
 * ── Why this is cheap enough to run on every transaction ───────────────────
 *
 * The whole sheet is re-evaluated whenever the document changes — no dependency
 * graph, no dirty tracking. A note's table is tens of cells, and an incremental
 * recompute is where spreadsheet bugs live: a stale cell that is right until you
 * delete a row. The `docChanged` check is what keeps a bare selection move (a
 * caret blink, an arrow key) from re-running it.
 */
export const sheetFormulasKey = new PluginKey("vaultSheetFormulas");

/** Beyond this, a table is not a note's table and the projection is skipped
 *  rather than made slow. */
const MAX_TABLES = 12;

interface CellPos { ref: string; from: number; to: number }

/** Read one table into a Sheet, plus where each cell lives in the document. */
function readTable(table: any, tablePos: number): { sheet: Sheet; cells: CellPos[] } {
  const grid: Grid = new Map();
  const cells: CellPos[] = [];
  let rows = 0;
  let cols = 0;

  table.forEach((row: any, rowOffset: number, rowIndex: number) => {
    rows = Math.max(rows, rowIndex + 1);
    let col = 0;
    row.forEach((cell: any, cellOffset: number) => {
      const ref = refName({ col, row: rowIndex });
      const text = cell.textContent;
      if (text.trim() !== "") grid.set(ref, text);
      // +1 for the row node, +1 for the table node itself.
      const from = tablePos + 1 + rowOffset + 1 + cellOffset;
      cells.push({ ref, from, to: from + cell.nodeSize });
      // colspan is honoured for ADDRESSING only: a merged cell occupies its
      // span, so the cell to its right keeps the address it visually has.
      // Reading a merged cell's value from any of its columns would be a
      // second question, and one no formula here asks.
      col += Math.max(1, cell.attrs?.colspan ?? 1);
    });
    cols = Math.max(cols, col);
  });

  return { sheet: { cells: grid, rows, cols }, cells };
}

function build(state: any): DecorationSet {
  const decos: Decoration[] = [];
  const { selection } = state;
  let tables = 0;

  state.doc.descendants((node: any, pos: number) => {
    if (node.type.name !== "table") return true;
    if (++tables > MAX_TABLES) return false;

    const { sheet, cells } = readTable(node, pos);
    // Nothing to project. Skipping here means a note full of ordinary tables
    // costs one textContent pass per table and no evaluation at all.
    if (![...sheet.cells.values()].some(isFormula)) return false;

    const results = evaluateSheet(sheet);

    for (const { ref, from, to } of cells) {
      const raw = sheet.cells.get(ref);
      if (!raw || !isFormula(raw)) continue;

      // The caret is in this cell: show the formula, not its value. This is
      // the whole editing model — you see what you are editing.
      if (selection.from < to && selection.to > from) {
        decos.push(Decoration.node(from, to, { class: "sheet-cell is-editing" }));
        continue;
      }

      const r = results.get(ref);
      decos.push(Decoration.node(from, to, {
        class: `sheet-cell${r?.error ? " is-bad" : ""}`,
        // The value rides on the cell as an attribute and is drawn by CSS
        // `content:`. A widget decoration would be a DOM node inside a table
        // cell that ProseMirror does not own, which its own selection maths
        // then has to step over.
        "data-value": r?.error ? "!" : fmtCell(r?.value ?? null),
        title: r?.error ? `${raw} — ${r.error}` : raw,
      }));
    }
    return false; // a table inside a table is not addressable; don't recurse
  });

  return DecorationSet.create(state.doc, decos);
}

export const SheetFormulas = Extension.create({
  name: "sheetFormulas",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: sheetFormulasKey,
        state: {
          init: (_, state) => build(state),
          apply(tr, prev, _old, state) {
            // Rebuilt on a doc change, and also on a SELECTION change — the
            // caret entering or leaving a cell is what swaps a value for its
            // formula, and selection moves carry no docChanged flag.
            if (!tr.docChanged && !tr.selectionSet) return prev;
            return build(state);
          },
        },
        props: {
          decorations(state) {
            return sheetFormulasKey.getState(state);
          },
        },
      }),
    ];
  },
});
