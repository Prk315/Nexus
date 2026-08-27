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
  sharedNodeIds.clear();
  for (const n of nodesRes.data!) {
    nodes[n.id] = { id: n.id, name: n.name, kind: n.kind as NodeKind, tags: n.tags ?? [], team_id: n.team_id ?? null, user_id: n.user_id };
    // Feeds assertNotCoedited, so the co-editing guard costs a query only on
    // notes that could actually have CRDT state. team_id is already in the
    // select, so this is free.
    if (n.team_id != null) sharedNodeIds.add(n.id);
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
    // The CRDT state for a live co-edited note. Keyed by the real node id, never
    // a "<id>_suffix" key — co-editing covers the note body only.
    supabase.from("vault_ydoc").delete().eq("node_id", id),
    // Content history, for the node body and every suffix key above. `like` is
    // safe to use as a prefix match here because ids are crypto.randomUUID() —
    // hex and dashes only, so neither '%' nor '_' can appear in `id` itself and
    // there is nothing to escape.
    supabase.from("vault_content_versions").delete().eq("node_id", id),
    supabase.from("vault_content_versions").delete().like("node_id", `${id}\\_%`),
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
// last read it. This is the concurrency guard for every surface that is NOT
// live co-edited — which is all of them except a shared Tiptap note, where a
// Yjs CRDT is the merge authority instead (see src/collab/ and
// saveContentProjection below). Callers should tell the user to reload rather
// than silently overwrite the other person's edit. Keyed per node id, one map
// per table since the same id can appear in both.
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
  await assertNotCoedited(id);
}

// Thrown when a note has live co-editing state but this build is saving it the
// old way — i.e. this client is too old (or has the feature switched off) to
// participate, and writing the whole document would silently discard whatever
// the CRDT holds.
//
// This is the guard, and it is the reason the reader has to ship a release
// before the writer. Deploy order alone cannot fix the problem: the iPad is
// installed over a cable on ~7-day certificates and there is no way to know it
// is current. Without this check an old client reads the vault_content
// projection (which the new clients keep freshly written, so it looks perfectly
// healthy), edits it, and saves — the CRDT never sees the edit, and the next
// projection flush overwrites it. vault_content keeps no history.
//
// It is the same doctrine noteSchemaGuard already records for the `__vault`
// envelope: a marker cannot help clients that predate it, so every client has
// to be taught to read it at least one release before anything starts writing.
export class CollabOnlyError extends Error {
  constructor(public nodeId: string) {
    super("This note is being co-edited. Update Vault to edit it.");
    this.name = "CollabOnlyError";
  }
}

// Which nodes are currently shared, refreshed by every loadGraph() (which
// already selects team_id, so this costs nothing). It exists so the guard below
// can skip the round trip for the overwhelming majority of saves.
const sharedNodeIds = new Set<string>();

async function assertNotCoedited(id: string): Promise<void> {
  // Only a SHARED note can have CRDT state, so only a shared note is worth a
  // query. Without this the guard adds a round trip to every autosave of every
  // private note in the vault, forever, to defend against something that by
  // construction cannot happen to them.
  //
  // Suffix keys ("<id>_annot", "<id>_hl", …) are never co-edited either — CRDT
  // scope is the note body — and they are excluded for free, since a suffix key
  // is never a vault_nodes id and so never lands in the set.
  if (!sharedNodeIds.has(id)) return;
  // NOTE the deliberately ignored `error`. Before the migration is applied
  // PostgREST answers PGRST205 ("could not find the table") and `data` is null,
  // so this fails OPEN and saving keeps working. That is the right direction to
  // fail — an unapplied migration should not brick the editor — but it does
  // mean the guard is silently inert until the table exists.
  const { data } = await supabase.from("vault_ydoc").select("node_id").eq("node_id", id).maybeSingle();
  if (data) throw new CollabOnlyError(id);
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

// The write path for a note that is being live co-edited.
//
// Deliberately a SEPARATE EXPORTED FUNCTION rather than an option on
// saveContent. A boolean parameter is exactly the kind of thing a later
// refactor drops or defaults, and dropping it here would disable the conflict
// guard for every PRIVATE note in the vault — a bug with no symptom at all
// until two devices quietly overwrite each other. A name that isn't called
// cannot be reached by accident.
//
// It skips assertContentNotConflicted because on a co-edited note "the row
// changed since I read it" is the normal case, not a conflict: both clients
// write a projection derived from the same converged CRDT, several times a
// minute. Leaving the check in would make live typing throw constantly.
// Everything else is identical — same size cap, checked outside the queue for
// the same reason, and the same single-flight queue.
export const saveContentProjection: (id: string, content: string) => Promise<void> =
  async (id, content) => {
    if (content.length > MAX_CONTENT_BYTES) {
      throw new Error(
        `[vault] refusing to save ${(content.length / 1024 / 1024).toFixed(1)} MB to node ${id} ` +
        `(cap ${MAX_CONTENT_BYTES / 1_000_000} MB). Images belong in Storage via uploadCanvasImage(), not inline.`
      );
    }
    return queuedSaveContent(id, content);
  };

// Drop our record of when a node's content row was last written.
//
// Needed in two places, and both are bugs without it:
//  * the Reload button — reloading with the stale timestamp still cached means
//    the very next save re-throws the same conflict, so the button appears not
//    to work;
//  * collab teardown (a note unshared mid-session) — the projection writer
//    never refreshes the OTHER client's cached timestamp, so falling back to
//    the guarded path with a stale entry produces a permanent, unclearable
//    "conflict" on a note nobody else is touching.
// A missing entry passes the guard, via its `known &&` short-circuit.
export function forgetContentVersion(id: string): void {
  lastKnownContentUpdatedAt.delete(id);
}

// ── Content history ──────────────────────────────────────────────────────────
// See supabase/migrations/20260827160000_vault_content_versions.sql. Snapshots
// of the PREVIOUS document are taken by a trigger on vault_content, at most one
// per node per five minutes; everything here either reads them or adds an
// explicit one before a destructive action.

export type VersionOrigin = "autosave" | "conflict" | "restore" | "overwrite" | "manual";

export interface ContentVersion {
  id: number;
  node_id: string;
  byte_len: number;
  user_id: string;
  origin: VersionOrigin;
  created_at: string;
}

/**
 * The history list — deliberately WITHOUT `data`.
 *
 * Forty versions of a note is forty whole documents; selecting the payload to
 * render a list of timestamps would pull megabytes to draw a sidebar, and would
 * do it every time the panel opened. The body is fetched one version at a time,
 * when one is actually chosen.
 */
export async function listContentVersions(nodeId: string, limit = 40): Promise<ContentVersion[]> {
  const { data, error } = await supabase.from("vault_content_versions")
    .select("id, node_id, byte_len, user_id, origin, created_at")
    .eq("node_id", nodeId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  if (error) err(error);
  return (data ?? []) as ContentVersion[];
}

export async function readContentVersion(versionId: number): Promise<string> {
  const { data, error } = await supabase.from("vault_content_versions")
    .select("data").eq("id", versionId).maybeSingle();
  if (error) err(error);
  return data?.data ?? "";
}

/**
 * Snapshot whatever the server currently holds, bypassing the trigger's
 * five-minute gate.
 *
 * Called before every action that replaces the stored document with something
 * other than the natural next edit — restoring an old version, or resolving a
 * conflict in your favour. The gate is right for autosaves and wrong here: the
 * whole risk of those two actions is that they discard a document somebody
 * still wants, and "we already took a snapshot four minutes ago" does not
 * describe the thing about to be destroyed.
 *
 * Returns the stored text it preserved, or null when there was nothing to
 * preserve. Never throws: a failed snapshot must not block the user's action,
 * but the caller may want to say the safety net was missing.
 */
export async function snapshotCurrentContent(
  nodeId: string,
  origin: VersionOrigin
): Promise<string | null> {
  try {
    const { data } = await supabase.from("vault_content")
      .select("data, user_id").eq("node_id", nodeId).maybeSingle();
    const text: string = data?.data ?? "";
    if (!text) return null;
    // No byte_len: it is a generated column, and sending it is an error rather
    // than a redundancy.
    const { error } = await supabase.from("vault_content_versions").insert({
      node_id: nodeId,
      data: text,
      user_id: data?.user_id ?? "",
      origin,
    });
    if (error) throw error;
    return text;
  } catch (e) {
    console.error("[vault] could not snapshot content before overwriting it", e);
    return null;
  }
}

/**
 * "Keep mine": replace the server's copy with this client's document.
 *
 * The deliberate ordering is snapshot → refresh the guard → write. Refreshing
 * `lastKnownContentUpdatedAt` from the row we just read is what makes the write
 * pass assertContentNotConflicted, and doing it AFTER the snapshot means a
 * snapshot that fails leaves the conflict standing rather than clearing the
 * guard for a write with no safety net behind it.
 *
 * This is the only sanctioned way past the conflict guard. It is a separate
 * exported name rather than a `force` flag on saveContent for the same reason
 * saveContentProjection is: a boolean parameter is the kind of thing a refactor
 * defaults, and defaulting this one would disable conflict detection for every
 * note in the vault with no symptom until two devices quietly overwrote each
 * other.
 */
export async function overwriteContent(nodeId: string, content: string): Promise<void> {
  const preserved = await snapshotCurrentContent(nodeId, "overwrite");
  if (preserved === null) {
    // Nothing on the server (or the snapshot failed). Re-reading still refreshes
    // the guard; an empty row means there was nothing to lose anyway.
    await readContent(nodeId);
  } else {
    const { data } = await supabase.from("vault_content")
      .select("updated_at").eq("node_id", nodeId).maybeSingle();
    if (data?.updated_at) lastKnownContentUpdatedAt.set(nodeId, data.updated_at);
  }
  await saveContent(nodeId, content);
}

// ── CRDT state for live co-edited notes ──────────────────────────────────────
// One row per co-edited note, holding base64(Y.encodeStateAsUpdate(doc)).
// vault_content.data stays the authoritative-looking JSON *projection* that
// every other reader uses (the schema guard, PDF export, WorkbookEditor, and
// any client too old to know about CRDTs); this table is the actual truth while
// a note is being co-edited. See supabase/migrations/20260827120000.

export async function readYdoc(nodeId: string): Promise<string | null> {
  const { data, error } = await supabase.from("vault_ydoc")
    .select("state").eq("node_id", nodeId).maybeSingle();
  if (error) err(error);
  return data ? (data.state ?? "") : null;
}

/**
 * The seed election.
 *
 * Two clients hydrating a Y.Doc from the same stored JSON produce two
 * INDEPENDENT documents — merging them duplicates the note end to end (see
 * src/collab/seed.ts). So exactly one client's bytes win, and the caller then
 * hydrates from whatever this returns regardless of whether it won.
 *
 * `ignoreDuplicates: true` is PostgREST's ON CONFLICT DO NOTHING. The re-read
 * afterwards is unconditional and that is the whole point: there is no
 * "did I win?" branch for a later refactor to get wrong.
 */
export async function seedYdoc(nodeId: string, state: string): Promise<string> {
  const { error } = await supabase.from("vault_ydoc")
    .upsert({ node_id: nodeId, state }, { onConflict: "node_id", ignoreDuplicates: true });
  if (error) err(error);
  return (await readYdoc(nodeId)) ?? "";
}

async function rawSaveYdoc(nodeId: string, state: string): Promise<void> {
  const { error } = await supabase.from("vault_ydoc")
    .upsert({ node_id: nodeId, state, updated_at: new Date().toISOString() },
      { onConflict: "node_id" });
  if (error) err(error);
}

const queuedSaveYdoc = makeSaver(rawSaveYdoc);

// Yjs state grows monotonically — deleted content is collected but the delete
// set and clocks are not, so a note edited for a year is several times its own
// text. There is no safe automatic compaction: rebuilding the doc mints fresh
// clientIDs and would re-collide with any live peer, i.e. reintroduce the
// duplication bug as a scheduled job. So warn, and cap the same way content is
// capped — outside the queue, so a permanently-oversized row cannot retry six
// times and gate every other node's saves behind the shared backoff.
// Recovery is manual and documented: with nobody editing, the owner deletes the
// vault_ydoc row and the next open re-seeds from the projection.
const MAX_YDOC_BYTES = 2_000_000;

export const saveYdoc: (nodeId: string, state: string) => Promise<void> =
  async (nodeId, state) => {
    if (state.length > 512_000) {
      console.warn(`[vault] large CRDT state: ${(state.length / 1024).toFixed(0)} kB for node ${nodeId}`);
    }
    if (state.length > MAX_YDOC_BYTES) {
      throw new Error(
        `[vault] refusing to persist ${(state.length / 1024 / 1024).toFixed(1)} MB of CRDT state for node ${nodeId}. ` +
        `Live editing continues; recover by deleting the vault_ydoc row while nobody is editing.`
      );
    }
    return queuedSaveYdoc(nodeId, state);
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

// Exported so callers that need to act on the same set share/unshare acts on
// (cache invalidation, for one) cannot disagree with it about what "the
// subtree" means.
export function collectDescendants(rootId: string, graph: VaultGraph): string[] {
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
  // Drop the CRDT state BEFORE clearing team_id: vault_ydoc's team policies are
  // gated on vault_can_coedit(), which goes false the moment the node is
  // unshared, so a teammate doing this would lose the permission to clean up
  // and strand the rows. (The owner's own owner_all policy would still reach
  // them, but relying on who happened to click is not a rule.)
  //
  // They must go. Re-sharing later re-seeds from vault_content, and a surviving
  // CRDT would resurrect whatever the document looked like when sharing
  // stopped — silently overwriting every private edit made in between.
  await supabase.from("vault_ydoc").delete().in("node_id", ids);
  for (const id of ids) forgetContentVersion(id);
  const { error } = await supabase.from("vault_nodes").update({ team_id: null }).in("id", ids);
  if (error) err(error);
  return loadGraph();
}
