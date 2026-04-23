import { NodeKind } from "./types";

export function kindColor(kind: NodeKind): string {
  switch (kind.type) {
    case "Folder":   return "#d4972a";
    case "Note":     return "#3b82f6";
    case "Canvas":   return "#0ea5e9";
    case "Pdf":      return "#ea7340";
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
