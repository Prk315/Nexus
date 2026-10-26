// ── Label clusters on the 2D graph ──────────────────────────────────────────
//
// A "cluster" here is not a layout force — it is a halo drawn around wherever
// the nodes carrying a tag happen to have settled, plus a label, plus a hit
// target. Pressing it filters the graph to that tag.
//
// The geometry is pure so the hit test can be tested: a halo whose drawn circle
// and clickable circle disagree is the kind of bug that only shows up as "it
// sometimes does nothing", which is worse than not being clickable at all.

export interface ClusterNode {
  id: string;
  tags?: string[];
  x?: number;
  y?: number;
}

export interface ClusterCircle {
  tag: string;
  x: number;
  y: number;
  /** Covers every member, with a little air. */
  r: number;
  count: number;
}

/** Minimum members before a tag is worth drawing as a cluster. */
export const MIN_CLUSTER_SIZE = 2;

/**
 * One circle per tag, centred on its members' centroid.
 *
 * Nodes without coordinates are skipped rather than treated as being at the
 * origin — the simulation has not placed them yet, and (0,0) would drag the
 * centroid of an otherwise settled cluster into the middle of the canvas.
 */
export function tagClusters(
  nodes: ClusterNode[],
  tags: string[],
  minSize: number = MIN_CLUSTER_SIZE,
): ClusterCircle[] {
  const out: ClusterCircle[] = [];
  for (const tag of tags) {
    const members = nodes.filter(
      (n) => (n.tags ?? []).includes(tag) && n.x != null && n.y != null,
    );
    if (members.length < minSize) continue;
    let sx = 0;
    let sy = 0;
    for (const m of members) {
      sx += m.x!;
      sy += m.y!;
    }
    const cx = sx / members.length;
    const cy = sy / members.length;
    let far = 0;
    for (const m of members) {
      far = Math.max(far, Math.hypot(m.x! - cx, m.y! - cy));
    }
    out.push({ tag, x: cx, y: cy, r: far + 14, count: members.length });
  }
  return out;
}

/**
 * Which cluster a point is inside, or null.
 *
 * Smallest containing circle wins: clusters overlap freely (a node can carry
 * two tags), and the smaller circle is always the more specific statement about
 * where the pointer is.
 */
export function hitTestClusters(
  circles: ClusterCircle[],
  pt: { x: number; y: number },
): string | null {
  let best: ClusterCircle | null = null;
  for (const c of circles) {
    if (Math.hypot(pt.x - c.x, pt.y - c.y) > c.r) continue;
    if (!best || c.r < best.r) best = c;
  }
  return best ? best.tag : null;
}
