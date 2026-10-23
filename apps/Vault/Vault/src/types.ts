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
  | { type: "Books" }
  // A book read as the PDF draws it, with the parsed blocks underneath.
  // Its vault_content row is a pointer to the reader JSON, not the document —
  // see components/reader/loadReader.ts. EVERY switch on NodeKind must grow a
  // case for it: EditorPane's render chain falls through to NoteEditor, which
  // would mount Tiptap on that pointer and let the 400ms autosave write a blank
  // document over it (lib/noteSchemaGuard.ts explains why that is unrecoverable
  // — vault_content keeps no history of its own).
  | { type: "Reader" };

export interface VaultNode {
  id: string;
  name: string;
  kind: NodeKind;
  tags: string[];
  // Set when this node (or an ancestor folder) was shared — see
  // shareNode/unshareNode in lib/api.ts. null/undefined = not shared.
  team_id?: string | null;
  // Owner's auth uid. Needed to tell "shared BY me" (stays in my own tree)
  // apart from "shared WITH me" (needs its own sidebar section — see App.tsx
  // topLevelNodes/sharedRootNodes) since a node shared with me can arrive
  // with no visible back-edges at all when its real parent isn't shared.
  user_id: string;
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
