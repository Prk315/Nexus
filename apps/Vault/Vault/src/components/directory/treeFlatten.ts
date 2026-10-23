import { VaultGraph } from "../../types";

// ── Flattening the vault tree into rows ─────────────────────────────────────
//
// The directory sidebar does NOT indent. Every row's text starts at the same x,
// and depth is carried entirely by a strip of thin grey guide segments drawn
// before the text — one segment per level, the innermost one turning right into
// the row so it reads as "this lives inside that".
//
// That makes the rendering a function of one flat list rather than of a
// recursive component, so the rules that are easy to get subtly wrong (which
// levels still have a vertical line running through them, which row is the last
// child, which guides light up when you hover) are decided here, in a pure
// function with tests, rather than inside JSX.

/**
 * What to draw in one guide column of one row.
 *
 * - `trunk`  │  an ancestor at this level still has siblings below, so the line
 *               passes straight through this row.
 * - `none`   ␣  that ancestor was its parent's last child — nothing below it, so
 *               nothing to draw. (Absent is not a shorter line, it is no line.)
 * - `branch` ├  the innermost column of a row that has siblings after it.
 * - `last`   └  the innermost column of the last child: the vertical stops
 *               halfway and turns into the row.
 */
export type GuideKind = "trunk" | "none" | "branch" | "last";

export interface GuideSegment {
  /** 0-based level this column stands for. */
  depth: number;
  kind: GuideKind;
  /**
   * The ancestor whose CHILD LIST this column draws — so column 0 is the root's
   * child column, and the innermost is the parent's.
   *
   * ⚠️ Which ancestor decides whether a line is there is the level BELOW this
   * one: column d keeps running past this row only if the path's node at level
   * d+1 still has siblings to come. Reading this row's own ancestor at level d
   * instead is an off-by-one that looks nearly right — every guide is one level
   * stale, so a last child still trails a line and the tree reads as though a
   * folder had contents it does not.
   */
  ancestorId: string;
}

export interface FlatRow {
  /**
   * Identity of this ROW, not of the node. A node with two parents legitimately
   * appears twice in the tree; keying React on `nodeId` would collapse them and
   * make one of the two un-expandable.
   */
  key: string;
  nodeId: string;
  parentId: string | null;
  depth: number;
  /** Exactly `depth` entries, outermost level first. */
  guides: GuideSegment[];
  /** Root-first, excluding this node. */
  ancestorIds: string[];
  hasChildren: boolean;
  expanded: boolean;
  isLast: boolean;
  /** Shared with the team at all — drawn as a small mark, never a separate box. */
  shared: boolean;
  /** Shared *with* me by someone else, rather than by me. */
  foreign: boolean;
}

export interface FlattenOptions {
  /** Needed only to tell "shared by me" from "shared with me". */
  currentUserId?: string | null;
}

/**
 * Root nodes, in display order.
 *
 * A node shared directly with me can arrive with no visible back-edges at all
 * (see App.tsx's note on `team_shared_select`), so it lands here too — which is
 * the point: the old build put those in their own "Shared with you" box, and
 * this branch removes that box. They are ordinary rows carrying a small mark.
 */
export function rootNodeIds(graph: VaultGraph): string[] {
  return Object.values(graph.nodes)
    .filter((n) => (graph.back_edges[n.id] ?? []).length === 0)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((n) => n.id);
}

/** Children of `id` that actually exist, in stored edge order. */
export function childIdsOf(graph: VaultGraph, id: string): string[] {
  return (graph.edges[id] ?? []).filter((c) => graph.nodes[c]);
}

/**
 * Walk the expanded tree depth-first and produce one row per visible node.
 *
 * Cycle-guarded on the PATH rather than globally: `vault_edges` has no
 * constraint preventing A→B→A, and an unguarded walk here is an infinite loop
 * inside a render, which takes the tab with it. Guarding on the path (and not
 * on a global seen-set) is deliberate — the same node under two different
 * parents is a legitimate second row, only a node inside itself is not.
 */
export function flattenTree(
  graph: VaultGraph,
  roots: string[],
  expanded: Set<string>,
  opts: FlattenOptions = {},
): FlatRow[] {
  const out: FlatRow[] = [];
  const me = opts.currentUserId ?? null;

  // `trunks[k]` — the node this path passes through at level k has a sibling
  // after it, so its parent's child-column keeps running below this row.
  function walk(ids: string[], ancestors: string[], trunks: boolean[]) {
    const visible = ids.filter((id) => graph.nodes[id] && !ancestors.includes(id));
    visible.forEach((id, i) => {
      const node = graph.nodes[id];
      const isLast = i === visible.length - 1;
      const depth = ancestors.length;

      const guides: GuideSegment[] = [];
      for (let d = 0; d < depth; d++) {
        guides.push(
          d === depth - 1
            ? { depth: d, kind: isLast ? "last" : "branch", ancestorId: ancestors[d] }
            : { depth: d, kind: trunks[d + 1] ? "trunk" : "none", ancestorId: ancestors[d] },
        );
      }

      const children = childIdsOf(graph, id).filter(
        (c) => c !== id && !ancestors.includes(c),
      );
      const isExpanded = expanded.has(id);
      const shared = node.team_id != null;

      out.push({
        key: [...ancestors, id].join("/"),
        nodeId: id,
        parentId: ancestors.length ? ancestors[ancestors.length - 1] : null,
        depth,
        guides,
        ancestorIds: [...ancestors],
        hasChildren: children.length > 0,
        expanded: isExpanded,
        isLast,
        shared,
        foreign: shared && me != null && node.user_id !== me,
      });

      if (children.length > 0 && isExpanded) {
        walk(children, [...ancestors, id], [...trunks, !isLast]);
      }
    });
  }

  walk(roots, [], []);
  return out;
}

/**
 * Index one past the last row of the subtree rooted at `index`.
 *
 * A depth-first flatten makes a subtree contiguous, so this is "keep going
 * while the rows are deeper than mine". It is what lets a draft row for a new
 * child be inserted AFTER the folder's existing children rather than jumping
 * the queue above them.
 */
export function subtreeEnd(rows: FlatRow[], index: number): number {
  if (index < 0 || index >= rows.length) return rows.length;
  const depth = rows[index].depth;
  let i = index + 1;
  while (i < rows.length && rows[i].depth > depth) i++;
  return i;
}

/**
 * The guide strip for a row being typed in as the new LAST child of `parent`.
 *
 * The parent's own connector becomes a through-line (or nothing, if the parent
 * was itself a last child), and the draft gets an elbow. Without this the new
 * row draws at the parent's depth and the tree visibly lies about where the
 * thing you are naming is going to land.
 */
export function draftGuides(parent: FlatRow | null): GuideSegment[] {
  if (!parent) return [];
  const carried: GuideSegment[] = parent.guides.map((g, d) =>
    d === parent.guides.length - 1
      ? { depth: d, kind: g.kind === "branch" ? "trunk" : "none", ancestorId: g.ancestorId }
      : g,
  );
  return [...carried, { depth: parent.depth, kind: "last", ancestorId: parent.nodeId }];
}

/**
 * Which guide segments light up for the hovered/selected row.
 *
 * "Highlights its guide back to the root" is a property of the whole visible
 * strip, not of one row: the lit line has to run from each ancestor's row down
 * to the active one, through the trunk columns of every row in between.
 *
 * A subtree is contiguous in a depth-first flatten, so a row whose guide at
 * depth d belongs to a lit ancestor is inside that ancestor's subtree — and
 * capping at the active row's index is what stops the line continuing past it
 * into siblings below.
 *
 * Returns keys of the form `${rowIndex}:${depth}`.
 */
export function guideHighlight(rows: FlatRow[], activeKey: string | null): Set<string> {
  const lit = new Set<string>();
  if (!activeKey) return lit;
  const activeIndex = rows.findIndex((r) => r.key === activeKey);
  if (activeIndex < 0) return lit;

  const onPath = new Set(rows[activeIndex].ancestorIds);
  for (let i = 0; i <= activeIndex; i++) {
    const row = rows[i];
    row.guides.forEach((g, d) => {
      if (onPath.has(g.ancestorId)) lit.add(`${i}:${d}`);
    });
  }
  return lit;
}
