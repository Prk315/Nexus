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

/**
 * BFS depth from the subgraph's roots — the ring each member draws on.
 *
 * Shared by `layoutRadial` and `capFolderGraph` so "which ring" can never
 * disagree between what is kept and where it is placed. Members unreachable
 * from any root (a pure cycle) land on ring 1, as before.
 */
export function subgraphDepths(graph: VaultGraph, sub: SubGraph): Map<string, number> {
  const members = new Set(sub.nodeIds);
  const depth = new Map<string, number>();
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
  for (const id of sub.nodeIds) if (!depth.has(id)) depth.set(id, 1);
  return depth;
}

/**
 * The shallowest whole rings of a subgraph that fit a node budget.
 *
 * The minimap orients; it does not enumerate. On the seeded dev vault the
 * folder graph is a couple of dozen nodes and this returns it unchanged — but
 * on a real vault it is well over a hundred, and 150×120 pixels of radial
 * layout turns that into a uniform grey blob (pf 1225). Dropping the DEEPEST
 * rings first loses the least orientation: the roots and their children are
 * the shape of the directory, ring four is texture.
 *
 * Rings are kept whole or not at all — half a ring reads as "those folders
 * don't exist", a missing ring reads as "the map stops here". Ring 0 is always
 * kept even if it alone exceeds the budget: a map with no roots is no map.
 *
 * `keep` (the currently focused folder) is exempt from the cap along with its
 * breadcrumb chain: the map's one job while zoomed is saying WHERE you are,
 * and a "you are here" dot that disappears past ring two does the opposite.
 * The chain draws as a sparse thread leading out of the kept rings.
 */
export function capFolderGraph(
  graph: VaultGraph,
  sub: SubGraph,
  budget: number,
  keep?: string | null,
): SubGraph {
  if (sub.nodeIds.length <= budget) return sub;
  const depth = subgraphDepths(graph, sub);
  const ringSize = new Map<number, number>();
  for (const id of sub.nodeIds) {
    const d = depth.get(id)!;
    ringSize.set(d, (ringSize.get(d) ?? 0) + 1);
  }
  let keepDepth = 0;
  let total = ringSize.get(0) ?? 0;
  for (let d = 1; ringSize.has(d); d++) {
    if (total + ringSize.get(d)! > budget) break;
    total += ringSize.get(d)!;
    keepDepth = d;
  }
  const members = new Set(sub.nodeIds.filter((id) => depth.get(id)! <= keepDepth));
  if (keep && depth.has(keep)) {
    for (const id of breadcrumb(graph, keep)) if (depth.has(id)) members.add(id);
  }
  return {
    nodeIds: sub.nodeIds.filter((id) => members.has(id)),
    edges: sub.edges.filter(([a, b]) => members.has(a) && members.has(b)),
  };
}

export interface Placed {
  id: string;
  /** Normalised to the unit cube, so the caller owns the pixel size. */
  x: number;
  y: number;
  /** Depth away from the viewer, 0..1. Drives the minimap's perspective. */
  z: number;
  depth: number;
}

/**
 * A layered radial placement for the minimap, in three dimensions.
 *
 * Naive on purpose (this is a minimap, not a layout engine): BFS depth from the
 * roots decides the ring, position within the ring is the index, and the ring
 * is tilted through z so the map reads as a solid rather than a disc.
 *
 * ⚠️ Deterministic, and that is the requirement rather than a nicety. The
 * minimap sits over a graph that is itself a running simulation; if the map
 * moved too there would be nothing on screen holding still, and a map you have
 * to re-read every glance is not doing a map's job.
 */
export function layoutRadial(graph: VaultGraph, sub: SubGraph): Placed[] {
  const depth = subgraphDepths(graph, sub);

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
        placed.push({ id, x: 0.5, y: 0.5, z: 0.5, depth: d });
        return;
      }
      // Offset each ring by half a step so rings don't line up radially.
      const angle = (i / ids.length) * Math.PI * 2 + (d % 2 ? Math.PI / ids.length : 0);
      const r = radius || 0.24;
      placed.push({
        id,
        x: 0.5 + Math.cos(angle) * r,
        y: 0.5 + Math.sin(angle) * r,
        // A ring is tilted rather than flat: z follows the same angle, so a
        // ring reads as a hoop seen at a slant instead of a circle of dots.
        z: clamp01(0.5 + Math.sin(angle + d) * r * 0.9),
        depth: d,
      });
    });
  }
  // Stable order: the caller draws in this order, and z-order should not jitter.
  const index = new Map(sub.nodeIds.map((id, i) => [id, i]));
  placed.sort((a, b) => index.get(a.id)! - index.get(b.id)!);
  return placed;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface Projected {
  id: string;
  /** Pixels, inside the given box. */
  x: number;
  y: number;
  /** 0 (far) .. 1 (near) — the caller spends it on size and opacity. */
  near: number;
}

/**
 * Project a unit-cube point into a box, the cheap way.
 *
 * A second WebGL context for a decorative map is the expensive way, and this
 * app has already been bitten once by force-graph's layout race (see the
 * ForceGraph3D notes in CLAUDE.md). A fixed camera over a fixed layout needs no
 * renderer at all: shift by depth, scale by depth, done — and the result cannot
 * fail to initialise, lose its context, or start a simulation.
 */
export function projectIso(
  p: { x: number; y: number; z: number },
  box: { width: number; height: number; pad?: number },
): Omit<Projected, "id"> {
  const pad = box.pad ?? 10;
  const w = box.width - pad * 2;
  const h = box.height - pad * 2;
  // Nearer points are pushed out from the centre and drawn larger; the skew is
  // what keeps a tilted ring from collapsing back into a flat circle.
  const near = clamp01(p.z);
  const scale = 0.78 + near * 0.32;
  const cx = (p.x - 0.5) * scale + 0.5;
  const cy = (p.y - 0.5) * scale + 0.5 - (near - 0.5) * 0.16;
  return {
    x: pad + clamp01(cx) * w,
    y: pad + clamp01(cy) * h,
    near,
  };
}

export interface SearchResult {
  /** Nodes whose name matches the query — these draw red. */
  matches: Set<string>;
  /** The matches plus everything connected to one; all else is hidden. */
  kept: Set<string>;
}

/**
 * What a graph search shows: the matches, and their connected context.
 *
 * Matching is a case-insensitive substring of the node NAME — the same thing
 * the sidebar shows, so what you can read is what you can find. Context walks
 * edges BOTH ways (a match's parents matter as much as its children: "where
 * does this live" is half of why anyone searches a graph), so `kept` is the
 * union of the weakly-connected components containing a match. The caller
 * draws matches red, the rest of `kept` greyed, and hides everything else —
 * hidden rather than dimmed, exactly like the folder zoom (pf 1223).
 *
 * A blank query is null, not "everything matches": the caller treats null as
 * "search is off" and leaves the graph exactly as it was.
 */
export function searchSubgraph(graph: VaultGraph, query: string): SearchResult | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const matches = new Set<string>();
  for (const node of Object.values(graph.nodes)) {
    if (node.name.toLowerCase().includes(q)) matches.add(node.id);
  }
  const kept = new Set<string>(matches);
  const stack = [...matches];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const next of [...(graph.edges[cur] ?? []), ...(graph.back_edges[cur] ?? [])]) {
      if (kept.has(next) || !graph.nodes[next]) continue;
      kept.add(next);
      stack.push(next);
    }
  }
  return { matches, kept };
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
