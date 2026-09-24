import { VaultGraph } from "../../types";

// ── The two subgraphs the zoom is built on, and the folder-only minimap ─────
//
// Pressing a folder shows that folder's descendants and HIDES everything else;
// pressing a tag cluster shows the nodes carrying that tag. Both are pure
// functions over `VaultGraph` so the rules can be tested without a canvas:
// the descendant set in particular is the one thing a screenshot cannot verify
// (a wrong answer still renders a perfectly plausible little graph).

export interface SubGraph {
  /** Membership, in insertion order. */
  nodeIds: string[];
  /** Edges with BOTH ends inside `nodeIds`, as [from, to]. */
  edges: [string, string][];
}

const EMPTY: SubGraph = { nodeIds: [], edges: [] };

/** Edges of the full graph restricted to a node set. */
function inducedEdges(graph: VaultGraph, members: Set<string>): [string, string][] {
  const edges: [string, string][] = [];
  for (const from of members) {
    for (const to of graph.edges[from] ?? []) {
      if (members.has(to)) edges.push([from, to]);
    }
  }
  return edges;
}

/**
 * A folder and everything reachable DOWNWARD from it.
 *
 * Downward only: `back_edges` would drag in the folder's parents and their other
 * children, which is the whole of the vault two hops later. Cycle-guarded —
 * `vault_edges` does not stop A→B→A, and this runs inside a render.
 *
 * The root itself is included: zooming to Mathematics and not seeing
 * Mathematics reads as the zoom having missed.
 */
export function descendantSubgraph(graph: VaultGraph, rootId: string): SubGraph {
  if (!graph.nodes[rootId]) return EMPTY;
  const members = new Set<string>([rootId]);
  const stack = [rootId];
  const order: string[] = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of graph.edges[cur] ?? []) {
      if (members.has(next) || !graph.nodes[next]) continue;
      members.add(next);
      order.push(next);
      stack.push(next);
    }
  }
  return { nodeIds: order, edges: inducedEdges(graph, members) };
}

/**
 * Every node carrying `tag`, and the edges between them.
 *
 * Deliberately NOT "the tagged nodes plus their neighbours": the press means
 * "show me this label", and pulling in one ring of untagged neighbours would put
 * nodes on screen that the filter says are excluded.
 */
export function tagSubgraph(graph: VaultGraph, tag: string): SubGraph {
  const members = new Set<string>();
  const order: string[] = [];
  for (const node of Object.values(graph.nodes)) {
    if ((node.tags ?? []).includes(tag)) {
      members.add(node.id);
      order.push(node.id);
    }
  }
  return { nodeIds: order, edges: inducedEdges(graph, members) };
}

/**
 * Folders and folder→folder edges only — what the minimap draws.
 *
 * Notes are dropped, which is the point: the minimap is the shape of the
 * directory, and at vault scale the notes are most of the nodes and none of the
 * structure.
 */
export function folderGraph(graph: VaultGraph): SubGraph {
  const members = new Set<string>();
  const order: string[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (node.kind?.type === "Folder") {
      members.add(node.id);
      order.push(node.id);
    }
  }
  order.sort((a, b) => graph.nodes[a].name.localeCompare(graph.nodes[b].name));
  return { nodeIds: order, edges: inducedEdges(graph, members) };
}

export interface Placed {
  id: string;
  /** Normalised to the unit box, so the caller owns the pixel size. */
  x: number;
  y: number;
  depth: number;
}

/**
 * A layered radial placement for the minimap.
 *
 * Naive on purpose (this is a prototype minimap, not a layout engine): BFS
 * depth from the roots decides the ring, position within the ring is the index.
 * It is deterministic, which matters more here than being pretty — a minimap
 * that reshuffles on every render is unreadable as a map.
 */
export function layoutRadial(graph: VaultGraph, sub: SubGraph): Placed[] {
  const members = new Set(sub.nodeIds);
  const depth = new Map<string, number>();

  // Roots of the SUBGRAPH: no parent that is itself a member.
  const roots = sub.nodeIds.filter(
    (id) => !(graph.back_edges[id] ?? []).some((p) => members.has(p)),
  );
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r, 0);
    queue.push(r);
  }
  while (queue.length) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const next of graph.edges[cur] ?? []) {
      if (!members.has(next) || depth.has(next)) continue;
      depth.set(next, d + 1);
      queue.push(next);
    }
  }
  // A member unreachable from any root (a pure cycle) still needs a ring.
  for (const id of sub.nodeIds) if (!depth.has(id)) depth.set(id, 1);

  const byDepth = new Map<number, string[]>();
  for (const id of sub.nodeIds) {
    const d = depth.get(id)!;
    if (!byDepth.has(d)) byDepth.set(d, []);
    byDepth.get(d)!.push(id);
  }
  const maxDepth = Math.max(0, ...byDepth.keys());

  const placed: Placed[] = [];
  for (const [d, ids] of byDepth) {
    const radius = maxDepth === 0 ? 0 : (d / maxDepth) * 0.42;
    ids.forEach((id, i) => {
      if (d === 0 && ids.length === 1) {
        placed.push({ id, x: 0.5, y: 0.5, depth: d });
        return;
      }
      // Offset each ring by half a step so rings don't line up radially.
      const angle = (i / ids.length) * Math.PI * 2 + (d % 2 ? Math.PI / ids.length : 0);
      placed.push({
        id,
        x: 0.5 + Math.cos(angle) * (radius || 0.24),
        y: 0.5 + Math.sin(angle) * (radius || 0.24),
        depth: d,
      });
    });
  }
  // Stable order: the caller draws in this order, and z-order should not jitter.
  const index = new Map(sub.nodeIds.map((id, i) => [id, i]));
  placed.sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  return placed;
}

/**
 * The folder chain above `id`, root-first, ending with `id`.
 *
 * Follows ONE parent at a time (the first): a node can have several, and a
 * breadcrumb that forks is not a breadcrumb. Cycle-guarded.
 */
export function breadcrumb(graph: VaultGraph, id: string): string[] {
  if (!graph.nodes[id]) return [];
  const chain: string[] = [id];
  const seen = new Set<string>([id]);
  let cur = id;
  for (;;) {
    const parent = (graph.back_edges[cur] ?? []).find((p) => graph.nodes[p] && !seen.has(p));
    if (!parent) break;
    chain.unshift(parent);
    seen.add(parent);
    cur = parent;
  }
  return chain;
}

/**
 * The folder whose contents the directory pane should show for a selection.
 *
 * A folder shows itself; anything else shows the folder it lives in, so
 * selecting a note does not empty the pane.
 */
export function containingFolder(graph: VaultGraph, id: string | null): string | null {
  if (!id || !graph.nodes[id]) return null;
  if (graph.nodes[id].kind?.type === "Folder") return id;
  const seen = new Set<string>([id]);
  const queue = [...(graph.back_edges[id] ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (graph.nodes[cur]?.kind?.type === "Folder") return cur;
    for (const p of graph.back_edges[cur] ?? []) if (!seen.has(p)) queue.push(p);
  }
  return null;
}
