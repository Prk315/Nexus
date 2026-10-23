// The Vault graph as the CLI sees it: nodes + edges, assembled the same way
// apps/Vault/Vault/src/lib/api.ts loadGraph() does. Pure: no client here.
//
// `vault_edges.from_id` is the PARENT and `to_id` the child. A root is a node
// with no incoming edge. A node can have several parents (it is a graph, not a
// tree), so `tree()` walks by edges and guards against cycles.

export interface VaultNode {
  id: string;
  name: string;
  kind: { type: string; [k: string]: unknown };
  tags: string[];
  team_id: string | null;
  user_id: string;
}

export interface VaultGraph {
  nodes: Record<string, VaultNode>;
  /** parent id → child ids */
  children: Record<string, string[]>;
  /** child id → parent ids */
  parents: Record<string, string[]>;
}

export function buildGraph(
  nodeRows: Array<{ id: string; name: string; kind: unknown; tags: string[] | null; team_id?: string | null; user_id: string }>,
  edgeRows: Array<{ from_id: string; to_id: string }>,
): VaultGraph {
  const nodes: Record<string, VaultNode> = {};
  for (const n of nodeRows) {
    const kind = n.kind && typeof n.kind === "object" ? (n.kind as VaultNode["kind"]) : { type: String(n.kind ?? "?") };
    nodes[n.id] = { id: n.id, name: n.name, kind, tags: n.tags ?? [], team_id: n.team_id ?? null, user_id: n.user_id };
  }
  const children: Record<string, string[]> = {};
  const parents: Record<string, string[]> = {};
  for (const e of edgeRows) {
    // Edges to or from nodes we cannot see (a teammate's unshared parent) are
    // kept out of the graph rather than pointing at nothing.
    if (!nodes[e.from_id] || !nodes[e.to_id]) continue;
    (children[e.from_id] ??= []).push(e.to_id);
    (parents[e.to_id] ??= []).push(e.from_id);
  }
  const byName = (a: string, b: string) => nodes[a].name.localeCompare(nodes[b].name);
  for (const k in children) children[k].sort(byName);
  for (const k in parents) parents[k].sort(byName);
  return { nodes, children, parents };
}

export function roots(g: VaultGraph): VaultNode[] {
  return Object.values(g.nodes)
    .filter((n) => !(g.parents[n.id]?.length))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function kindName(n: VaultNode): string {
  return n.kind.type;
}

export function isFolder(n: VaultNode): boolean {
  return n.kind.type === "Folder";
}

/**
 * Resolves `--root <id|name>`: an exact id, else an exact name match, else a
 * unique case-insensitive name match. Ambiguity is an error rather than a
 * guess, because the tree printed for the wrong "Notes" folder looks right.
 */
export function resolveNode(g: VaultGraph, ref: string): { node: VaultNode } | { error: string } {
  if (g.nodes[ref]) return { node: g.nodes[ref] };
  const exact = Object.values(g.nodes).filter((n) => n.name === ref);
  if (exact.length === 1) return { node: exact[0] };
  if (exact.length > 1) return { error: `"${ref}" matches ${exact.length} nodes: ${exact.map((n) => n.id).join(", ")}` };
  const loose = Object.values(g.nodes).filter((n) => n.name.toLowerCase() === ref.toLowerCase());
  if (loose.length === 1) return { node: loose[0] };
  if (loose.length > 1) return { error: `"${ref}" matches ${loose.length} nodes: ${loose.map((n) => n.id).join(", ")}` };
  return { error: `no node with id or name "${ref}"` };
}

export interface TreeRow {
  id: string;
  name: string;
  kind: string;
  tags: string[];
  depth: number;
  /** Set when this node was already printed higher up (a second parent, or a cycle). */
  repeat?: boolean;
  children?: TreeRow[];
}

/** Depth-first tree from `rootId`, folders first then by name, capped at `maxDepth` levels below the root. */
export function tree(g: VaultGraph, rootId: string, maxDepth: number, foldersOnly: boolean): TreeRow {
  const seen = new Set<string>();
  const walk = (id: string, depth: number): TreeRow => {
    const n = g.nodes[id];
    const row: TreeRow = { id, name: n.name, kind: kindName(n), tags: n.tags, depth };
    if (seen.has(id)) {
      row.repeat = true;
      return row;
    }
    seen.add(id);
    if (depth >= maxDepth) return row;
    const kids = (g.children[id] ?? [])
      .map((c) => g.nodes[c])
      .filter((c) => !foldersOnly || isFolder(c))
      .sort((a, b) => Number(isFolder(b)) - Number(isFolder(a)) || a.name.localeCompare(b.name));
    if (kids.length) row.children = kids.map((c) => walk(c.id, depth + 1));
    return row;
  };
  return walk(rootId, 0);
}

export function flattenTree(row: TreeRow, out: TreeRow[] = []): TreeRow[] {
  out.push(row);
  for (const c of row.children ?? []) flattenTree(c, out);
  return out;
}

export function renderTree(row: TreeRow, showTags: boolean): string {
  const lines: string[] = [];
  const rec = (r: TreeRow, prefix: string, isLast: boolean, isRoot: boolean) => {
    const branch = isRoot ? "" : isLast ? "└─ " : "├─ ";
    const tags = showTags && r.tags.length ? `  #${r.tags.join(" #")}` : "";
    const kind = r.kind === "Folder" ? "" : ` (${r.kind})`;
    const rep = r.repeat ? "  ↺" : "";
    lines.push(`${prefix}${branch}${r.name}${kind}  ${r.id}${tags}${rep}`);
    const kids = r.children ?? [];
    kids.forEach((c, i) => rec(c, isRoot ? "" : prefix + (isLast ? "   " : "│  "), i === kids.length - 1, false));
  };
  rec(row, "", true, true);
  return lines.join("\n");
}

export function searchNodes(g: VaultGraph, text: string): VaultNode[] {
  const q = text.toLowerCase();
  return Object.values(g.nodes)
    .filter((n) => n.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
