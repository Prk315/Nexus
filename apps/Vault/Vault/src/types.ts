export type NodeKind =
  | { type: "Folder" }
  | { type: "Note" }
  | { type: "Canvas" }
  | { type: "Pdf" }
  | { type: "Parsed" }
  | { type: "Video" }
  | { type: "CodeFile"; language: string }
  | { type: "Table" }
  | { type: "Database" }
  | { type: "Workbook" }
  | { type: "Journal" }
  | { type: "Books" };

export interface VaultNode {
  id: string;
  name: string;
  kind: NodeKind;
  tags: string[];
}

export interface VaultGraph {
  nodes: Record<string, VaultNode>;
  edges: Record<string, string[]>;
  back_edges: Record<string, string[]>;
  tag_colors: Record<string, string>;
}

// A named highlighter category (e.g. "Definition") owned by a reader node.
export interface HighlighterCategory {
  name: string;
  color: string; // hex
}

// A recorded highlight: one row in the vault_records table. Attached to its
// source node; a Database node above it aggregates records across its subtree.
export interface VaultRecord {
  id: string;
  source_node_id: string;
  category: string;
  color: string;
  text: string;
  location: string; // e.g. "p.42" for a PDF page; "" for a note
  created_at: string;
}
