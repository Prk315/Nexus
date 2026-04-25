import { supabase } from "./supabase";
import { VaultGraph, VaultNode, NodeKind } from "../types";

const USER_ID = "default";
function err(e: any): never { throw new Error(e?.message ?? String(e)); }

// ── Graph load ────────────────────────────────────────────────────────────────

export async function loadGraph(): Promise<VaultGraph> {
  const [nodesRes, edgesRes, colorsRes] = await Promise.all([
    supabase.from("vault_nodes").select("id, name, kind, tags").eq("user_id", USER_ID),
    supabase.from("vault_edges").select("from_id, to_id").eq("user_id", USER_ID),
    supabase.from("vault_tag_colors").select("tag, color").eq("user_id", USER_ID),
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
    .insert({ id, name, kind, tags: [], user_id: USER_ID });
  if (error) err(error);
  return loadGraph();
}

export async function deleteNode(id: string): Promise<VaultGraph> {
  // Clean up content rows that won't cascade (no FK on vault_content / vault_journals)
  await Promise.all([
    supabase.from("vault_content").delete().eq("node_id", id),
    supabase.from("vault_content").delete().eq("node_id", `${id}_annot`),
    supabase.from("vault_journals").delete().eq("node_id", id),
  ]);
  const { error } = await supabase.from("vault_nodes").delete().eq("id", id);
  if (error) err(error);
  // vault_edges cascade-deletes via FK
  return loadGraph();
}

// ── Edge CRUD ─────────────────────────────────────────────────────────────────

export async function addEdge(fromId: string, toId: string): Promise<VaultGraph> {
  const { error } = await supabase.from("vault_edges")
    .upsert({ from_id: fromId, to_id: toId, user_id: USER_ID }, { onConflict: "from_id,to_id" });
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
    .upsert({ tag, color, user_id: USER_ID }, { onConflict: "user_id,tag" });
  if (error) err(error);
  return loadGraph();
}

export async function createTag(tag: string, color: string): Promise<VaultGraph> {
  return setTagColor(tag, color);
}

export async function renameTag(oldName: string, newName: string): Promise<VaultGraph> {
  const { error } = await supabase.rpc("vault_rename_tag", {
    p_user_id: USER_ID,
    p_old: oldName,
    p_new: newName,
  });
  if (error) err(error);
  return loadGraph();
}

export async function deleteTagGlobal(tag: string): Promise<VaultGraph> {
  const { error } = await supabase.rpc("vault_delete_tag", {
    p_user_id: USER_ID,
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

export async function saveContent(id: string, content: string): Promise<void> {
  const { error } = await supabase.from("vault_content")
    .upsert({ node_id: id, data: content, user_id: USER_ID, updated_at: new Date().toISOString() },
      { onConflict: "node_id" });
  if (error) err(error);
}

// ── Journals (handwriting stroke data) ───────────────────────────────────────

export async function readJournal(id: string): Promise<string> {
  const { data } = await supabase.from("vault_journals")
    .select("data").eq("node_id", id).maybeSingle();
  return data?.data ?? "";
}

export async function saveJournal(id: string, data: string): Promise<void> {
  const { error } = await supabase.from("vault_journals")
    .upsert({ node_id: id, data, user_id: USER_ID, updated_at: new Date().toISOString() },
      { onConflict: "node_id" });
  if (error) err(error);
}

// ── Assets (PDFs, videos) → Supabase Storage ─────────────────────────────────

export async function uploadAsset(nodeId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop() ?? "bin";
  const path = `${USER_ID}/${nodeId}.${ext}`;
  const { error } = await supabase.storage
    .from("vault-assets")
    .upload(path, file, { upsert: true });
  if (error) err(error);
  const { data } = supabase.storage.from("vault-assets").getPublicUrl(path);
  // Persist the public URL as the node's content so EditorPane can read it back
  await saveContent(nodeId, data.publicUrl);
  return data.publicUrl;
}
