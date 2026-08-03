import { NodeKind, VaultGraph, HighlighterCategory } from "./types";

// Seed highlighter set for a reader node that has none yet.
export const DEFAULT_HIGHLIGHTERS: HighlighterCategory[] = [
  { name: "Definition", color: "#2980b9" },
  { name: "Example",    color: "#27ae60" },
  { name: "Problem",    color: "#e67e22" },
  { name: "Caution",    color: "#e74c3c" },
];

// All descendant node ids reachable from `id` by following outgoing edges
// (children → grandchildren → … down to the last vertices). Cycle-guarded.
// Mirrors App.tsx's getAncestors but walks `edges` instead of `back_edges`.
export function getDescendants(graph: VaultGraph, id: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const stack = [...(graph.edges[id] ?? [])];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur) || cur === id) continue;
    seen.add(cur);
    if (graph.nodes[cur]) out.push(cur);
    for (const next of graph.edges[cur] ?? []) {
      if (!seen.has(next)) stack.push(next);
    }
  }
  return out;
}

// Nearest ancestor node whose kind matches `kindType`, walking incoming edges
// (parents) upward. Returns its id, or null if none. Cycle-guarded.
export function findAncestorOfKind(
  graph: VaultGraph, id: string, kindType: NodeKind["type"]
): string | null {
  const seen = new Set<string>([id]);
  const queue = [...(graph.back_edges[id] ?? [])];
  while (queue.length) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    if (graph.nodes[cur]?.kind.type === kindType) return cur;
    for (const parent of graph.back_edges[cur] ?? []) {
      if (!seen.has(parent)) queue.push(parent);
    }
  }
  return null;
}

export function kindColor(kind: NodeKind): string {
  switch (kind.type) {
    case "Folder":   return "#d4972a";
    case "Note":     return "#3b82f6";
    case "Canvas":   return "#0ea5e9";
    case "Pdf":      return "#ea7340";
    case "Parsed":   return "#14b8a6";
    case "Video":    return "#8b5cf6";
    case "CodeFile": return "#22c55e";
    case "Table":    return "#a855f7";
    case "Database": return "#ef4444";
    case "Workbook": return "#f59e0b";
    case "Journal": return "#f43f5e";
    case "Books":   return "#10b981";
  }
}

export function nodeIcon(kind: NodeKind): string {
  switch (kind.type) {
    case "Folder":   return "⌂";
    case "Note":     return "≡";
    case "Canvas":   return "◻";
    case "Pdf":      return "⎕";
    case "Parsed":   return "❖";
    case "Video":    return "▶";
    case "CodeFile": return "</>";
    case "Table":    return "⊞";
    case "Database": return "◉";
    case "Workbook": return "⊟";
    case "Journal": return "✍";
    case "Books":   return "📚";
  }
}

export function buildKind(type: string): NodeKind {
  if (type === "CodeFile") return { type: "CodeFile", language: "plaintext" };
  return { type } as NodeKind;
}
