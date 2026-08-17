import { supabase, getUserId } from "./supabase";
import { makeSaver } from "./saveQueue";
import { VaultGraph, VaultNode, NodeKind, VaultRecord, HighlighterCategory } from "../types";

function err(e: any): never { throw new Error(e?.message ?? String(e)); }

// ── Graph load ────────────────────────────────────────────────────────────────

export async function loadGraph(): Promise<VaultGraph> {
  const [nodesRes, edgesRes, colorsRes] = await Promise.all([
    supabase.from("vault_nodes").select("id, name, kind, tags").eq("user_id", getUserId()),
    supabase.from("vault_edges").select("from_id, to_id").eq("user_id", getUserId()),
    supabase.from("vault_tag_colors").select("tag, color").eq("user_id", getUserId()),
  ]);
  if (nodesRes.error) err(nodesRes.error);
  if (edgesRes.error) err(edgesRes.error);
  if (colorsRes.error) err(colorsRes.error);

  const nodes: Record<string, VaultNode> = {};
  for (const n of nodesRes.data!) {
    nodes[n.id] = { id: n.id, name: n.name, kind: n.kind as NodeKind, tags: n.tags ?? [] };
  }

  const edges: Record<string, string[]> = {};
  const back_edges: Record<string, string[]> = {};
  for (const e of edgesRes.data!) {
    (edges[e.from_id] ??= []).push(e.to_id);
    (back_edges[e.to_id] ??= []).push(e.from_id);
  }

  const tag_colors: Record<string, string> = {};
  for (const t of colorsRes.data!) {
    tag_colors[t.tag] = t.color;
  }

  return { nodes, edges, back_edges, tag_colors };
}

// ── Node CRUD ─────────────────────────────────────────────────────────────────

export async function createNode(name: string, kind: NodeKind): Promise<VaultGraph> {
  const id = crypto.randomUUID();
  const { error } = await supabase.from("vault_nodes")
    .insert({ id, name, kind, tags: [], user_id: getUserId() });
  if (error) err(error);
  return loadGraph();
}

export async function deleteNode(id: string): Promise<VaultGraph> {
  // Clean up content rows that won't cascade (no FK on vault_content / vault_journals).
  // `_textannot` and `_bookmarks` were a pre-existing orphan gap (same suffix-key
  // shape as `_annot`/`_hl`); `_margins` is the margin-notes layer added alongside.
  await Promise.all([
    supabase.from("vault_content").delete().eq("node_id", id),
    supabase.from("vault_content").delete().eq("node_id", `${id}_annot`),
    supabase.from("vault_content").delete().eq("node_id", `${id}_hl`),
    supabase.from("vault_content").delete().eq("node_id", `${id}_textannot`),
    supabase.from("vault_content").delete().eq("node_id", `${id}_bookmarks`),
    supabase.from("vault_content").delete().eq("node_id", `${id}_margins`),
    supabase.from("vault_journals").delete().eq("node_id", id),
    supabase.from("vault_records").delete().eq("source_node_id", id),
  ]);
  const { error } = await supabase.from("vault_nodes").delete().eq("id", id);
  if (error) err(error);
  // vault_edges cascade-deletes via FK
  return loadGraph();
}

// ── Edge CRUD ─────────────────────────────────────────────────────────────────

export async function addEdge(fromId: string, toId: string): Promise<VaultGraph> {
  const { error } = await supabase.from("vault_edges")
    .upsert({ from_id: fromId, to_id: toId, user_id: getUserId() }, { onConflict: "from_id,to_id" });
  if (error) err(error);
  return loadGraph();
}

export async function removeEdge(fromId: string, toId: string): Promise<VaultGraph> {
  const { error } = await supabase.from("vault_edges")
    .delete().eq("from_id", fromId).eq("to_id", toId);
  if (error) err(error);
  return loadGraph();
}

// ── Tag operations ────────────────────────────────────────────────────────────

export async function addTag(id: string, tag: string): Promise<VaultGraph> {
  const { data: node, error: fetchErr } = await supabase.from("vault_nodes")
    .select("tags").eq("id", id).single();
  if (fetchErr) err(fetchErr);
  const tags: string[] = node!.tags ?? [];
  if (!tags.includes(tag)) {
    const { error } = await supabase.from("vault_nodes")
      .update({ tags: [...tags, tag] }).eq("id", id);
    if (error) err(error);
  }
  return loadGraph();
}

export async function removeTag(id: string, tag: string): Promise<VaultGraph> {
  const { data: node, error: fetchErr } = await supabase.from("vault_nodes")
    .select("tags").eq("id", id).single();
  if (fetchErr) err(fetchErr);
  const tags = (node!.tags as string[]).filter(t => t !== tag);
  const { error } = await supabase.from("vault_nodes").update({ tags }).eq("id", id);
  if (error) err(error);
  return loadGraph();
}

export async function setTagColor(tag: string, color: string): Promise<VaultGraph> {
  const { error } = await supabase.from("vault_tag_colors")
    .upsert({ tag, color, user_id: getUserId() }, { onConflict: "user_id,tag" });
  if (error) err(error);
  return loadGraph();
}

export async function createTag(tag: string, color: string): Promise<VaultGraph> {
  return setTagColor(tag, color);
}

export async function renameTag(oldName: string, newName: string): Promise<VaultGraph> {
  const { error } = await supabase.rpc("vault_rename_tag", {
    p_user_id: getUserId(),
    p_old: oldName,
    p_new: newName,
  });
  if (error) err(error);
  return loadGraph();
}

export async function deleteTagGlobal(tag: string): Promise<VaultGraph> {
  const { error } = await supabase.rpc("vault_delete_tag", {
    p_user_id: getUserId(),
    p_tag: tag,
  });
  if (error) err(error);
  return loadGraph();
}

// ── Content (notes, canvas, workbook, PDF URL, annotations) ──────────────────

export async function readContent(id: string): Promise<string> {
  const { data } = await supabase.from("vault_content")
    .select("data").eq("node_id", id).maybeSingle();
  return data?.data ?? "";
}

// All content writes go through the save queue (single-flight per node,
// latest-write-wins, backoff on failure) — never call Supabase directly for
// these. Unserialized upserts to the same node_id queue on its row lock while
// each holds a pool connection, which is how one slow save wedged the whole
// database on 2026-08-15 (see lib/saveQueue.ts).
async function rawSaveContent(id: string, content: string): Promise<void> {
  // Telemetry for the 2026-08-15 save incident (1.9MB canvas autosave wedged
  // Supabase for 2h) — a loud signal before a save gets that big again.
  if (content.length > 500_000) {
    console.warn(`[vault] large content save: ${(content.length / 1024).toFixed(0)} kB for node ${id}`);
  }
  const { error } = await supabase.from("vault_content")
    .upsert({ node_id: id, data: content, user_id: getUserId(), updated_at: new Date().toISOString() },
      { onConflict: "node_id" });
  if (error) err(error);
}

export const saveContent: (id: string, content: string) => Promise<void> =
  makeSaver(rawSaveContent);

// ── Journals (handwriting stroke data) ───────────────────────────────────────

export async function readJournal(id: string): Promise<string> {
  const { data } = await supabase.from("vault_journals")
    .select("data").eq("node_id", id).maybeSingle();
  return data?.data ?? "";
}

async function rawSaveJournal(id: string, data: string): Promise<void> {
  const { error } = await supabase.from("vault_journals")
    .upsert({ node_id: id, data, user_id: getUserId(), updated_at: new Date().toISOString() },
      { onConflict: "node_id" });
  if (error) err(error);
}

export const saveJournal: (id: string, data: string) => Promise<void> =
  makeSaver(rawSaveJournal);

// ── Assets (PDFs, videos) → Supabase Storage ─────────────────────────────────

// Upload a parsed-book figure into a per-node/chapter folder; returns public URL.
export async function uploadParsedFigure(nodeId: string, chapter: string, filename: string, file: File | Blob): Promise<string> {
  const path = `${getUserId()}/parsed/${nodeId}/${chapter}/${filename}`;
  const { error } = await supabase.storage.from("vault-assets").upload(path, file, { upsert: true });
  if (error) err(error);
  return supabase.storage.from("vault-assets").getPublicUrl(path).data.publicUrl;
}

export async function uploadAsset(nodeId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${getUserId()}/${nodeId}.${ext}`;
  const { error } = await supabase.storage
    .from("vault-assets")
    .upload(path, file, { upsert: true });
  if (error) err(error);
  const { data } = supabase.storage.from("vault-assets").getPublicUrl(path);
  // Persist the public URL as the node's content so EditorPane can read it back
  await saveContent(nodeId, data.publicUrl);
  return data.publicUrl;
}

/// Canvas images: file in the bucket, URL in the document. Inline base64 is
/// what made canvas rows megabytes — 69% of the 1.9 MB document that took the
/// database down on 2026-08-15 was five pasted screenshots, re-written in full
/// by every autosave. Unlike uploadAsset this does NOT touch vault_content;
/// the caller owns where the URL lands.
export async function uploadCanvasImage(blob: Blob): Promise<string> {
  const ext = (blob.type.split("/")[1] ?? "png").replace("jpeg", "jpg").replace("svg+xml", "svg");
  const path = `${getUserId()}/canvas/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage
    .from("vault-assets")
    .upload(path, blob, { contentType: blob.type || "image/png" });
  if (error) err(error);
  return supabase.storage.from("vault-assets").getPublicUrl(path).data.publicUrl;
}

// ── Highlighter categories (per reader node) ─────────────────────────────────
// Stored as JSON in vault_content under the `${nodeId}_hl` suffix key,
// following the existing `${id}_annot` convention.

export async function readHighlighters(nodeId: string): Promise<HighlighterCategory[]> {
  const raw = await readContent(`${nodeId}_hl`);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveHighlighters(nodeId: string, sets: HighlighterCategory[]): Promise<void> {
  await saveContent(`${nodeId}_hl`, JSON.stringify(sets));
}

// ── Records (highlight entries) ──────────────────────────────────────────────

export async function insertRecord(
  rec: Omit<VaultRecord, "id" | "created_at"> & { id?: string }
): Promise<VaultRecord> {
  const id = rec.id ?? crypto.randomUUID();
  const row = {
    id,
    source_node_id: rec.source_node_id,
    category: rec.category,
    color: rec.color,
    text: rec.text,
    location: rec.location ?? "",
    user_id: getUserId(),
  };
  const { data, error } = await supabase.from("vault_records")
    .insert(row).select("id, source_node_id, category, color, text, location, created_at").single();
  if (error) err(error);
  return data as VaultRecord;
}

export async function readRecordsForSources(sourceIds: string[]): Promise<VaultRecord[]> {
  if (sourceIds.length === 0) return [];
  const { data, error } = await supabase.from("vault_records")
    .select("id, source_node_id, category, color, text, location, created_at")
    .eq("user_id", getUserId())
    .in("source_node_id", sourceIds)
    .order("created_at", { ascending: true });
  if (error) err(error);
  return (data ?? []) as VaultRecord[];
}

export async function deleteRecord(id: string): Promise<void> {
  const { error } = await supabase.from("vault_records").delete().eq("id", id);
  if (error) err(error);
}

// ── Book clean-text sources (parsed statements for snapping OCR highlights) ──

export interface BookSourceItem {
  type?: string;
  number?: string;
  title?: string;
  statement: string;
  key_terms?: string[];
}

export async function readBookSources(bookNodeId: string): Promise<BookSourceItem[]> {
  const { data } = await supabase.from("vault_book_sources")
    .select("items").eq("book_node_id", bookNodeId).eq("user_id", getUserId()).maybeSingle();
  return (data?.items as BookSourceItem[]) ?? [];
}
