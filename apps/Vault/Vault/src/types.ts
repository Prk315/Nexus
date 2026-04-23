export type NodeKind =
  | { type: "Folder" }
  | { type: "Note" }
  | { type: "Canvas" }
  | { type: "Pdf" }
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
