// Turning two stored note documents into something a person can choose between.
//
// The History panel's whole job is to answer "is this the iteration I want?",
// and neither of the two obvious answers works:
//
//  * A timestamp and a byte count answer nothing. Two versions four minutes
//    apart, 41 kB and 41 kB, are indistinguishable.
//  * Mounting a real editor on the old version to render it faithfully is worse
//    than useless — it is dangerous. An editor that exists can emit, and one
//    emit is all it takes to autosave an old document over the current one
//    (lib/noteSchemaGuard.ts says this at more length). It would also make the
//    panel unable to show a version whose schema this build cannot parse, which
//    is exactly the situation the guard exists for and exactly when history is
//    most needed.
//
// So: a flat, read-only projection of block text, and a line diff against what
// the note holds now. Structure is summarised (`## Heading`, `• item`,
// `⟨image⟩`) rather than rendered. That renders anything, including content
// this build's schema would reject, and it cannot write.
//
// React-free and unit-tested, like taskTree.ts and coverage.ts in PathFinder
// and sketch.ts here — the rules are the valuable part and components are not
// where rules should live.

export interface JsonNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown> | null;
  content?: JsonNode[];
}

/** Block types whose inline content becomes exactly one line. */
const LINE_BLOCKS = new Set(["paragraph", "heading", "codeBlock"]);

/**
 * Leaf blocks with no text of their own. Rendered as a marker so that deleting
 * an image or a sketch shows up as a change instead of as nothing at all —
 * their byte cost is enormous and their line cost would otherwise be zero.
 */
const ATOM_LABELS: Record<string, string> = {
  horizontalRule: "⟨divider⟩",
  image: "⟨image⟩",
  blockMath: "⟨math⟩",
  sketchBlock: "⟨sketch⟩",
  inkStroke: "⟨ink⟩",
  drawArrow: "⟨arrow⟩",
  drawEllipse: "⟨ellipse⟩",
  drawPolygon: "⟨polygon⟩",
  pathfinderBlock: "⟨tasks⟩",
  gridBlock: "⟨grid⟩",
  matrixBlock: "⟨matrix⟩",
  graphBlock: "⟨graph⟩",
};

function inlineText(node: JsonNode): string {
  if (typeof node.text === "string") return node.text;
  const type = node.type ?? "";
  if (type === "inlineMath") {
    const latex = (node.attrs as { latex?: unknown } | null)?.latex;
    return typeof latex === "string" ? `$${latex}$` : "$…$";
  }
  if (type === "hardBreak") return " ";
  if (ATOM_LABELS[type]) return ATOM_LABELS[type];
  return (node.content ?? []).map(inlineText).join("");
}

const LIST_TYPES = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * `listDepth` counts enclosing LISTS, not tree depth. Tree depth is not the
 * same number — a list inside a column inside a callout is three levels deeper
 * without being nested any further as a list — and indenting by it makes a
 * top-level bullet appear indented for reasons the reader cannot see.
 */
function walk(node: JsonNode, listDepth: number, out: string[]): void {
  const type = node.type ?? "";

  if (ATOM_LABELS[type] && !node.content?.length) {
    out.push(ATOM_LABELS[type]);
    return;
  }

  if (LINE_BLOCKS.has(type)) {
    const text = inlineText(node).replace(/\s+/g, " ").trim();
    if (type === "heading") {
      const level = Number((node.attrs as { level?: unknown } | null)?.level ?? 1);
      // Clamped rather than trusted: `level` comes from stored JSON that may
      // predate or postdate this build's schema, and "#".repeat(-1) throws.
      const hashes = "#".repeat(Math.min(6, Math.max(1, Number.isFinite(level) ? level : 1)));
      out.push(`${hashes} ${text}`);
      return;
    }
    // An empty paragraph is a spacing decision, not content. Keeping them would
    // fill the diff with blank rows that always match.
    if (text) out.push(type === "codeBlock" ? `｜ ${text}` : text);
    return;
  }

  if (type === "listItem" || type === "taskItem") {
    // Bullet the item's own first line, then let the rest recurse so a nested
    // list indents one further.
    const before = out.length;
    for (const child of node.content ?? []) walk(child, listDepth, out);
    if (out.length > before) {
      out[before] = `${"  ".repeat(Math.max(0, listDepth - 1))}• ${out[before]}`;
    }
    return;
  }

  const nextDepth = LIST_TYPES.has(type) ? listDepth + 1 : listDepth;
  for (const child of node.content ?? []) walk(child, nextDepth, out);
}

/**
 * Flatten a stored `vault_content.data` string into comparable lines.
 *
 * Accepts anything that column can hold: Tiptap JSON (the normal case), the
 * `{ doc: … }` envelope some writers use, legacy HTML from before the JSON
 * migration, and plain text. It never throws — a version that cannot be parsed
 * is still a version somebody may need to look at, so it degrades to showing
 * the raw string rather than to showing nothing.
 */
export function noteLines(raw: string): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Legacy HTML or plain text. Strip tags, split on block boundaries.
    return raw
      .replace(/<(br|\/p|\/h[1-6]|\/li|\/div)[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  }
  if (typeof parsed === "string") {
    return parsed.split("\n").map((l) => l.trim()).filter(Boolean);
  }
  if (!parsed || typeof parsed !== "object") return [];
  const doc = ((parsed as { doc?: JsonNode }).doc ?? parsed) as JsonNode;
  const out: string[] = [];
  walk(doc, 0, out);
  return out;
}

export type DiffKind = "same" | "add" | "del";

export interface DiffRow {
  kind: DiffKind;
  text: string;
}

export interface DiffResult {
  rows: DiffRow[];
  added: number;
  removed: number;
  /** True when the documents were too large to diff and `rows` is the raw
   *  version rather than a comparison. The UI must say so rather than let a
   *  reader believe an unmarked line is unchanged. */
  truncated: boolean;
}

// Above this the O(n·m) table stops being free — 2000×2000 is four million
// cells, which is a visible stall on the iPad for a panel that is supposed to
// open instantly. Notes this long are rare enough that showing them undiffed is
// a better trade than making every open slow.
const MAX_DIFF_LINES = 1200;

/**
 * Line diff of `before` (an old version) against `after` (the current
 * document), by longest common subsequence.
 *
 * The direction matters for how it reads: `add` means "present in the current
 * note but not in this version", `del` means "this version has it and the
 * current note does not". So restoring a version undoes exactly the `add`s and
 * reinstates exactly the `del`s.
 */
export function diffLines(before: string[], after: string[]): DiffResult {
  if (before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES) {
    return {
      rows: before.map((text) => ({ kind: "same" as const, text })),
      added: 0,
      removed: 0,
      truncated: true,
    };
  }

  const n = before.length;
  const m = after.length;
  // lcs[i][j] = length of the LCS of before[i…] and after[j…]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      rows.push({ kind: "same", text: before[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: "del", text: before[i] });
      removed++;
      i++;
    } else {
      rows.push({ kind: "add", text: after[j] });
      added++;
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: "del", text: before[i++] });
    removed++;
  }
  while (j < m) {
    rows.push({ kind: "add", text: after[j++] });
    added++;
  }

  return { rows, added, removed, truncated: false };
}

/** Convenience for the panel: diff two raw stored strings. */
export function diffContent(beforeRaw: string, afterRaw: string): DiffResult {
  return diffLines(noteLines(beforeRaw), noteLines(afterRaw));
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} kB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

