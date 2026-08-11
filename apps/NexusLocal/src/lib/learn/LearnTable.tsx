/**
 * LearnTable — the one place every markdown table in Learn renders through.
 *
 * `Markdown.tsx` wires react-markdown's `table` / `thead` / `tbody` / `tr` /
 * `th` / `td` nodes to `learnTableComponents` below, so every table anywhere
 * in Learn — theory statements, lens notes, drill solutions, exam-workshop
 * content — gets this treatment with zero call-site changes. That is the
 * whole point: nothing that calls `<Markdown>` needs to know tables exist.
 *
 * The visual recipe itself (card container, header rule, zebra stripes,
 * numeric right-align, code-heavy monospace) lives in `Markdown.tsx`'s
 * `LEARN_MD_CSS`, not here — that file is *the* injected stylesheet per its
 * own docstring ("one place... every consumer inherits it"), and splitting
 * table CSS into a second file would reintroduce exactly the "every
 * consumer re-derives its own styling" problem DESIGN.md §8.3 fixed. This
 * file supplies the two things CSS alone can't:
 *
 * 1. `remarkLearnTableMeta` — a remark plugin that inspects each table's RAW
 *    mdast content — before rehype-katex turns `$…$` into rendered KaTeX
 *    span soup — and stamps three rendering hints onto the tree as
 *    `data-*` hast properties: `data-zebra` (table), `data-code-heavy`
 *    (table), `data-numeric` (per numeric column, on both its `th` and its
 *    `td`s). Doing this on mdast instead of walking the rendered React/DOM
 *    tree matters: by the time react-markdown builds React elements, an
 *    `inlineMath` node has already become KaTeX's nested-span HTML, so a
 *    DOM-side "flatten this cell's text" pass would be reading rendered
 *    glyph fragments, not what was authored. Here, `inlineMath` nodes are
 *    still their raw LaTeX source (`\operatorname{rank}A`, `k`, `2b`) —
 *    exactly as short and unspaced as the author typed them.
 *
 *    `Markdown.tsx`'s stylesheet reads the resulting attributes with plain
 *    CSS attribute selectors (`[data-zebra]`, `td[data-numeric]`, …) — no
 *    JS runs at render time, the hint is baked into the tree once at parse
 *    time.
 *
 * 2. `learnTableComponents` — the react-markdown `components` entries
 *    themselves. Each just strips react-markdown's `node` prop (a hast node
 *    reference, not a valid DOM attribute — spreading it onto a real
 *    element makes React warn on every table) and forwards the rest; only
 *    `table` does more, wrapping its `<table>` in the `.learn-md-table`
 *    scroll/card container.
 */

import type { Components } from "react-markdown";
import type { Root, Table, TableCell, TableRow } from "mdast";
import type { Transformer } from "unified";
import { visit } from "unist-util-visit";
import { toString as mdastToString } from "mdast-util-to-string";

// ---------------------------------------------------------------------------
// Heuristics — pure functions, no React/DOM involved, so they're testable in
// isolation from the markdown source alone.
// ---------------------------------------------------------------------------

/**
 * A body cell counts as an "atomic token" when its flattened text has no
 * internal whitespace and is short — the shape a relation-instance value, a
 * type name, or a short symbol/id takes (`nl`, `CHAR(n)`, `aid`, a bare
 * number or year). A prose sentence fails this on both counts: it has
 * spaces, and it usually runs well past this length. Longer symbolic
 * expressions (a full RA query like `πtitle(σtracks>10(Album))`, 25 chars)
 * intentionally fall outside it — those show up paired one-per-row with a
 * prose explanation column, and a 50/50 code/prose split correctly stays
 * below the majority bar below rather than monospacing the prose half.
 */
const ATOMIC_MAX_LEN = 24;

/** Bare number, optionally signed, with `,`/`.` as separators. Not trying to
 *  be locale-correct — this drives a rendering hint, not a parser. */
const NUMERIC_RE = /^[-+]?\d[\d.,]*$/;

/** Currency/percent decoration stripped before the numeric test so `$42`,
 *  `42%`, `kr 42` still read as numeric without teaching the regex above
 *  every symbol that can wrap a number. */
function stripNumericDecoration(text: string): string {
  return text
    .replace(/^(?:[$€]|kr\.?)\s*/i, "")
    .replace(/\s*(?:[%$€]|kr\.?)$/i, "")
    .trim();
}

/** Flatten a table cell's mdast phrasing content to plain text: `text` and
 *  `inlineCode`/`inlineMath` nodes contribute their raw `.value`, `strong`/
 *  `emphasis`/`delete`/`link` recurse into `.children` — see
 *  `mdast-util-to-string`. Crucially this runs on mdast, so `inlineMath`
 *  yields raw LaTeX source, not KaTeX's rendered output. */
function flattenCell(cell: TableCell): string {
  return mdastToString(cell).trim();
}

function isAtomicToken(text: string): boolean {
  return text.length > 0 && text.length <= ATOMIC_MAX_LEN && !/\s/.test(text);
}

function isNumericCell(text: string): boolean {
  if (!text) return false;
  return NUMERIC_RE.test(stripNumericDecoration(text));
}

/**
 * Stamp a `data-*` hast property onto an mdast node via `data.hProperties`
 * (the standard mdast→hast passthrough channel: `mdast-util-to-hast`
 * shallow-merges `node.data.hProperties` onto the hast element it produces).
 * Typed loosely on purpose — whether `@types/mdast`'s `Data` interface has
 * been augmented with `hProperties` in this compilation depends on some
 * other file in the program having pulled in `mdast-util-to-hast`'s types
 * first, which is true today (via `react-markdown` → `remark-rehype`) but
 * isn't a contract worth depending on here.
 */
function setHProperty(node: { data?: unknown }, key: string, value: string): void {
  const anyNode = node as { data?: Record<string, unknown> };
  const data = anyNode.data ?? (anyNode.data = {});
  const hProperties = (data.hProperties ?? (data.hProperties = {})) as Record<
    string,
    string
  >;
  hProperties[key] = value;
}

/**
 * Remark plugin. Must run after `remark-gfm` (builds the `table` nodes this
 * visits) and after `remark-math` (builds the `inlineMath` nodes this reads
 * as raw LaTeX) in the `remarkPlugins` array — unified runs transforms in
 * list order, and both need to have already produced their node types.
 *
 * Three independent hints, each with its own bar:
 *
 * - `data-zebra` (table): body has ≥ 4 rows. Below that, stripes read as
 *   decoration with nothing to organise.
 * - `data-numeric` (per column, th + td): a strict majority (> 50%) of that
 *   column's non-empty body cells are bare numbers once decoration is
 *   stripped. Applies to the header too, so its alignment matches its data.
 * - `data-code-heavy` (table): a strict majority (> 50%) of *all* body
 *   cells table-wide are atomic tokens (see above) — deliberately
 *   whole-table, not per-column. A two-column "term | explanation" table
 *   (e.g. the SQL type table: `` `CHAR(n)` `` next to a full sentence) is
 *   exactly half atomic in column 1 and all prose in column 2; monospacing
 *   the prose column would be wrong, and the atomic column's `` `code` ``
 *   spans already render monospace for free via `.learn-md code`. This
 *   hint is for tables that are short-token *everywhere* — the shape a
 *   relation instance takes if it's ever authored as a markdown table
 *   instead of the ASCII-art code fences the DBMS course uses today.
 */
export function remarkLearnTableMeta(): Transformer<Root, Root> {
  return (tree) => {
    visit(tree, "table", (table: Table) => {
      const rows = table.children as TableRow[];
      const [headerRow, ...bodyRows] = rows;
      if (!headerRow) return;

      if (bodyRows.length >= 4) {
        setHProperty(table, "data-zebra", "true");
      }

      let atomicCount = 0;
      let cellCount = 0;
      for (const row of bodyRows) {
        for (const cell of row.children as TableCell[]) {
          const text = flattenCell(cell);
          if (!text) continue;
          cellCount++;
          if (isAtomicToken(text)) atomicCount++;
        }
      }
      if (cellCount > 0 && atomicCount / cellCount > 0.5) {
        setHProperty(table, "data-code-heavy", "true");
      }

      const colCount = headerRow.children.length;
      for (let c = 0; c < colCount; c++) {
        let numericCount = 0;
        let nonEmpty = 0;
        for (const row of bodyRows) {
          const cell = (row.children as TableCell[])[c];
          if (!cell) continue;
          const text = flattenCell(cell);
          if (!text) continue;
          nonEmpty++;
          if (isNumericCell(text)) numericCount++;
        }
        if (nonEmpty > 0 && numericCount / nonEmpty > 0.5) {
          for (const row of rows) {
            const cell = (row.children as TableCell[])[c];
            if (cell) setHProperty(cell, "data-numeric", "true");
          }
        }
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

export const learnTableComponents: Partial<Components> = {
  table: ({ node: _node, ...props }) => (
    <div className="learn-md-table">
      <table {...props} />
    </div>
  ),
  thead: ({ node: _node, ...props }) => <thead {...props} />,
  tbody: ({ node: _node, ...props }) => <tbody {...props} />,
  tr: ({ node: _node, ...props }) => <tr {...props} />,
  th: ({ node: _node, ...props }) => <th {...props} />,
  td: ({ node: _node, ...props }) => <td {...props} />,
};
