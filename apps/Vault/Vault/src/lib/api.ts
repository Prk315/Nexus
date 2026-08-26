import { supabase, getUserId } from "./supabase";
import { makeSaver } from "./saveQueue";
import { VaultGraph, VaultNode, NodeKind, VaultRecord, HighlighterCategory } from "../types";

function err(e: any): never { throw new Error(e?.message ?? String(e)); }

// ── Graph load ────────────────────────────────────────────────────────────────

export async function loadGraph(): Promise<VaultGraph> {
  // vault_nodes / vault_edges deliberately carry NO client-side user_id
  // filter: visibility is "own OR my team's" now, which RLS already encodes
  // (owner_all OR team_shared_select — see 20260826150000_vault_teams.sql).
  // A client-side .eq("user_id", ...) here would silently hide every shared
  // node again regardless of what the database allows. vault_tag_colors stays
  // owner-only (no team policy on it — tag colors are per-viewer).
  const [nodesRes, edgesRes, colorsRes] = await Promise.all([
    supabase.from("vault_nodes").select("id, name, kind, tags, team_id, user_id"),
    supabase.from("vault_edges").select("from_id, to_id"),
    supabase.from("vault_tag_colors").select("tag, color").eq("user_id", getUserId()),
  ]);
  if (nodesRes.error) err(nodesRes.error);
  if (edgesRes.error) err(edgesRes.error);
  if (colorsRes.error) err(colorsRes.error);

  const nodes: Record<string, VaultNode> = {};
  for (const n of nodesRes.data!) {
    nodes[n.id] = { id: n.id, name: n.name, kind: n.kind as NodeKind, tags: n.tags ?? [], team_id: n.team_id ?? null, user_id: n.user_id };
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
  await inheritTeamFromParent(fromId, toId);
  return loadGraph();
}

// A node attached under an already-shared parent must inherit that share —
// otherwise team_id (what RLS actually checks), not the edge, is what stays
// missing, and the child silently never appears for the other team member.
// Best-effort: if the child isn't ours to update yet (not owned, not already
// shared), the update just affects 0 rows rather than throwing, so it never
// blocks the edge creation that already succeeded.
async function inheritTeamFromParent(fromId: string, toId: string): Promise<void> {
  const { data: parent } = await supabase.from("vault_nodes").select("team_id").eq("id", fromId).maybeSingle();
  if (!parent?.team_id) return;
  await supabase.from("vault_nodes").update({ team_id: parent.team_id }).eq("id", toId);
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

// Thrown by saveContent/saveJournal when the row changed since this client
// last read it — the sharing feature's only concurrency guard, since Vault
// has no live co-editing (no CRDT/yjs — see BlockHandle.ts). Callers should
// tell the user to reload rather than silently overwrite the other person's
// edit. Keyed per node id, one map per table since the same id can appear in
// both.
export class ContentConflictError extends Error {
  constructor(public nodeId: string) {
    super("This note was changed elsewhere — reload before saving over it.");
    this.name = "ContentConflictError";
  }
}

const lastKnownContentUpdatedAt = new Map<string, string>();
const lastKnownJournalUpdatedAt = new Map<string, string>();

export async function readContent(id: string): Promise<string> {
  const { data } = await supabase.from("vault_content")
    .select("data, updated_at").eq("node_id", id).maybeSingle();
  if (data?.updated_at) lastKnownContentUpdatedAt.set(id, data.updated_at);
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
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("vault_content")
    .upsert({ node_id: id, data: content, user_id: getUserId(), updated_at: nowIso },
      { onConflict: "node_id" });
  if (error) err(error);
  lastKnownContentUpdatedAt.set(id, nowIso);
}

// Checked OUTSIDE the save queue, same reason MAX_CONTENT_BYTES is: a
// conflict is permanent, not transient, and throwing inside rawSave would
// have the queue retry it 6 times and gate every OTHER node's saves behind
// the resulting global backoff for nothing.
async function assertContentNotConflicted(id: string): Promise<void> {
  const { data } = await supabase.from("vault_content").select("updated_at").eq("node_id", id).maybeSingle();
  const known = lastKnownContentUpdatedAt.get(id);
  if (data?.updated_at && known && data.updated_at !== known) {
    throw new ContentConflictError(id);
  }
}

// A save this big is not a document, it is a bug — almost certainly binary
// inlined as base64 rather than uploaded to the vault-assets bucket. 1.9 MB is
// what wedged Supabase for 2h on 2026-08-15, so refuse above 2 MB rather than
// repeat it. Rejecting surfaces as "error" in the pane's save status and
// leaves the stored content intact; truncating would silently destroy it.
const MAX_CONTENT_BYTES = 2_000_000;

const queuedSaveContent = makeSaver(rawSaveContent);

// The cap is checked HERE, outside the queue, deliberately. Throwing inside
// rawSave would look like a failing database: the queue would retry 6 times
// (pointlessly — the length never changes) and each failure bumps the queue's
// *global* failStreak/gateUntil, stalling saves for every OTHER node by up to
// 60s a round. One oversized note must not take the rest of the vault down
// with it — that is the exact failure this queue exists to prevent.
export const saveContent: (id: string, content: string) => Promise<void> =
  async (id, content) => {
    if (content.length > MAX_CONTENT_BYTES) {
      throw new Error(
        `[vault] refusing to save ${(content.length / 1024 / 1024).toFixed(1)} MB to node ${id} ` +
        `(cap ${MAX_CONTENT_BYTES / 1_000_000} MB). Images belong in Storage via uploadCanvasImage(), not inline.`
      );
    }
    await assertContentNotConflicted(id);
    return queuedSaveContent(id, content);
  };

// ── Journals (handwriting stroke data) ───────────────────────────────────────

export async function readJournal(id: string): Promise<string> {
  const { data } = await supabase.from("vault_journals")
    .select("data, updated_at").eq("node_id", id).maybeSingle();
  if (data?.updated_at) lastKnownJournalUpdatedAt.set(id, data.updated_at);
  return data?.data ?? "";
}

async function rawSaveJournal(id: string, data: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const { error } = await supabase.from("vault_journals")
    .upsert({ node_id: id, data, user_id: getUserId(), updated_at: nowIso },
      { onConflict: "node_id" });
  if (error) err(error);
  lastKnownJournalUpdatedAt.set(id, nowIso);
}

async function assertJournalNotConflicted(id: string): Promise<void> {
  const { data } = await supabase.from("vault_journals").select("updated_at").eq("node_id", id).maybeSingle();
  const known = lastKnownJournalUpdatedAt.get(id);
  if (data?.updated_at && known && data.updated_at !== known) {
    throw new ContentConflictError(id);
  }
}

const queuedSaveJournal = makeSaver(rawSaveJournal);

export const saveJournal: (id: string, data: string) => Promise<void> =
  async (id, data) => {
    await assertJournalNotConflicted(id);
    return queuedSaveJournal(id, data);
  };

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
  // No client-side user_id filter: RLS (owner_all OR team_shared_select via
  // the source node's team_id) already defines the right set — a highlight a
  // teammate made on a shared PDF should show up here too.
  const { data, error } = await supabase.from("vault_records")
    .select("id, source_node_id, category, color, text, location, created_at")
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

// ── Sharing ───────────────────────────────────────────────────────────────────
// Sharing a node = pointing its team_id at the shared pf_teams row (see
// 20260826150000_vault_teams.sql, reusing PathFinder's pf_teams/
// pf_team_members directly — same Supabase project, no vault_-prefixed team
// tables needed). "Share a folder" is the same operation on the whole
// reachable subtree: a folder is just a node with children (TreeRow treats
// graph.edges[id] as children), so there is nothing folder-specific here.

let teamIdPromise: Promise<string | null> | null = null;

// Single-flight: every share/unshare call needs this, and it changes only
// when team membership itself changes (never, in practice, for two people).
async function getMyTeamId(): Promise<string | null> {
  if (!teamIdPromise) {
    teamIdPromise = Promise.resolve(
      supabase.from("pf_team_members")
        .select("team_id").eq("user_id", getUserId()).limit(1).maybeSingle()
    ).then(({ data }) => data?.team_id ?? null);
  }
  return teamIdPromise;
}

function collectDescendants(rootId: string, graph: VaultGraph): string[] {
  const seen = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const childId of graph.edges[id] ?? []) {
      if (!seen.has(childId)) {
        seen.add(childId);
        stack.push(childId);
      }
    }
  }
  return [...seen];
}

// Shares nodeId and every node reachable from it via outgoing edges — for a
// leaf note that's just itself, for a folder it's the whole subtree. Only the
// owner can do this in practice: team_shared_update requires team_id already
// set, so a node that isn't already shared can only be updated by its owner.
export async function shareNode(nodeId: string, graph: VaultGraph): Promise<VaultGraph> {
  const teamId = await getMyTeamId();
  if (!teamId) throw new Error("You're not on a team yet — see pf_team_members.");
  const ids = collectDescendants(nodeId, graph);
  const { error } = await supabase.from("vault_nodes").update({ team_id: teamId }).in("id", ids);
  if (error) err(error);
  return loadGraph();
}

// Mirrors shareNode's descendant walk: unsharing a folder unshares everything
// in it too. A partial unshare (folder row goes private, contents stay
// team_id-set) would strand those children with no visible parent for the
// other person — they'd resurface as unexplained loose root nodes rather
// than actually being revoked, so cascading is the only option that means
// what "unshare" says.
export async function unshareNode(nodeId: string, graph: VaultGraph): Promise<VaultGraph> {
  const ids = collectDescendants(nodeId, graph);
  const { error } = await supabase.from("vault_nodes").update({ team_id: null }).in("id", ids);
  if (error) err(error);
  return loadGraph();
}
