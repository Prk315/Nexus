// Builds the outline column's tree: headings nested by level, concepts as
// leaves under the heading they fall beneath. Spec §5.
//
// Pure, and takes the pages rather than the DOM, so the tree exists before
// anything renders and a click can navigate to a block on a page that has not
// been scrolled to yet.

import type { ConceptKind } from "./conceptDetect";
import { conceptTitle, detectConcept } from "./conceptDetect";
import type { ReaderBlock, ReaderPage } from "./readerTypes";

export interface OutlineNode {
  /** The block id. Unique across the document, and what onNavigate is given. */
  id: string;
  kind: "heading" | "concept";
  /** 1–3 for headings. Concepts sit at the level below their parent heading. */
  level: number;
  text: string;
  pageIndex: number;
  conceptKind?: ConceptKind;
  children: OutlineNode[];
}

/** Label/name for a concept block, from the JSON if annotate.ts filled it, else parsed here. */
export function blockConcept(block: ReaderBlock): { kind: ConceptKind; title: string } | null {
  if (block.concept) {
    return { kind: block.concept, title: block.name || block.label || block.text };
  }
  const parsed = detectConcept(block.heading ?? block.text);
  return parsed ? { kind: parsed.kind, title: conceptTitle(parsed) } : null;
}

/**
 * Nest headings by level and hang concepts off the innermost open heading.
 *
 * Headings carry ACROSS pages, on purpose: the ten pages are a reading order,
 * and "1.4 Pascals trekant og binomialformelen" opens on p.53 while the results
 * it introduces are on p.54 and p.55. A per-page tree would have orphaned every
 * one of them.
 *
 * The cost of that, and it is visible in this prototype: the ten pages are not
 * contiguous, so a subsection heading on p.124 nests under the last section
 * heading seen, which is four chapters earlier. It is the right trade for a
 * reading order and the wrong one for a whole book; the fix when this grows up
 * is to carry the book's own section numbering, which the extractor already
 * records, rather than to infer nesting from level alone.
 */
export function buildReaderOutline(pages: ReaderPage[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  /** Open headings, outermost first. Never holds a concept: concepts are leaves. */
  const stack: OutlineNode[] = [];

  const attach = (node: OutlineNode) => {
    const parent = stack[stack.length - 1];
    (parent ? parent.children : roots).push(node);
  };

  pages.forEach((page, pageIndex) => {
    for (const block of page.blocks) {
      if (block.type === "heading") {
        const level = block.level ?? 2;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        const node: OutlineNode = {
          id: block.id,
          kind: "heading",
          level,
          text: (block.heading || block.text).trim(),
          pageIndex,
          children: [],
        };
        attach(node);
        stack.push(node);
        continue;
      }

      if (block.type !== "concept") continue;
      const concept = blockConcept(block);
      if (!concept) continue;
      attach({
        id: block.id,
        kind: "concept",
        level: (stack[stack.length - 1]?.level ?? 0) + 1,
        text: concept.title,
        pageIndex,
        conceptKind: concept.kind,
        children: [],
      });
    }
  });

  return roots;
}

/**
 * The deepest outline node covering the reader's current position.
 *
 * Driven by `visibleBlocks` rather than by scroll arithmetic so the mark agrees
 * with what is actually on screen, including the first paint before any scroll
 * event has fired. Returns the ids of that node AND its ancestors, because the
 * column marks the whole path — a mark on a collapsed branch's leaf would be
 * invisible.
 */
export function activeOutlinePath(
  roots: OutlineNode[],
  pages: ReaderPage[],
  visibleBlocks: string[],
): string[] {
  if (!visibleBlocks.length) return [];

  // Document order comes from `pages`, never from parsing block ids. The ids
  // happen to sort correctly for these ten pages because the reading order is
  // also page order; that is a coincidence of the prototype, and the first time
  // someone reorders the ten it would silently stop being true.
  const order = new Map<string, number>();
  let i = 0;
  for (const page of pages) for (const block of page.blocks) order.set(block.id, i++);

  const flat: Array<{ node: OutlineNode; path: string[] }> = [];
  const walk = (nodes: OutlineNode[], path: string[]) => {
    for (const n of nodes) {
      flat.push({ node: n, path: [...path, n.id] });
      walk(n.children, [...path, n.id]);
    }
  };
  walk(roots, []);

  // An outline entry that is itself on screen is the answer outright.
  const visible = new Set(visibleBlocks);
  for (const { node, path } of flat) if (visible.has(node.id)) return path;

  // Otherwise: the last entry scrolled PAST. An outline mark answers "where am
  // I reading", which is the heading above the text in view, not the one below.
  const here = Math.min(...visibleBlocks.map((id) => order.get(id) ?? Infinity));
  let best: string[] = [];
  for (const { node, path } of flat) {
    const at = order.get(node.id);
    if (at === undefined || at > here) continue;
    best = path;
  }
  return best;
}
