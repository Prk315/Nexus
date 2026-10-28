// Vault reads and writes over a signed-in Supabase client.
//
// Mirrors apps/Vault/Vault/src/lib/api.ts where it matters:
//   - loadGraph carries no client-side user_id filter (RLS is "own OR my
//     team's"; filtering here would hide shared nodes again)
//   - deleteNode removes the same content rows deleteNode there does, because
//     vault_content / vault_journals / vault_records have no FK to vault_nodes
//   - content writes upsert `{node_id, data, user_id, updated_at}` on node_id
//     and read the server's updated_at back
//
// It deliberately does NOT mirror the save queue: a CLI writes one note once.

import type { SupabaseClient } from "@supabase/supabase-js";
import { UserError } from "../errors.ts";
import { buildGraph, type VaultGraph } from "./graph.ts";

function fail(e: { message?: string } | null | undefined, what: string): never {
  throw new UserError(`${what}: ${e?.message ?? String(e)}`);
}

export interface ContentRow {
  data: string;
  updated_at: string | null;
  updated_by: string | null;
}

export interface NodeMeta {
  id: string;
  name: string;
  kind: { type: string };
  team_id: string | null;
  user_id: string;
  /** Set when the node sits in the bin. Writers must refuse such a node. */
  deleted_at: string | null;
}

export function createVaultApi(db: SupabaseClient, userId: string) {
  return {
    async loadGraph(): Promise<VaultGraph> {
      const [nodesRes, edgesRes] = await Promise.all([
        db.from("vault_nodes").select("id, name, kind, tags, team_id, user_id, deleted_at"),
        db.from("vault_edges").select("from_id, to_id"),
      ]);
      if (nodesRes.error) fail(nodesRes.error, "vault_nodes");
      if (edgesRes.error) fail(edgesRes.error, "vault_edges");
      // Binned nodes (deleted_at set) are filtered exactly as the app's
      // loadGraph filters them: dropped from the graph along with every edge
      // touching one. Without this, `tree` and `search` listed binned nodes
      // as live and `note set` would write into the bin.
      const nodes = (nodesRes.data ?? []).filter((n: { deleted_at?: string | null }) => n.deleted_at == null);
      const binned = new Set((nodesRes.data ?? []).filter((n: { deleted_at?: string | null }) => n.deleted_at != null).map((n: { id: string }) => n.id));
      const edges = (edgesRes.data ?? []).filter(
        (e: { from_id: string; to_id: string }) => !binned.has(e.from_id) && !binned.has(e.to_id),
      );
      return buildGraph(nodes, edges);
    },

    async getNode(id: string): Promise<NodeMeta | null> {
      const { data, error } = await db
        .from("vault_nodes").select("id, name, kind, team_id, user_id, deleted_at").eq("id", id).maybeSingle();
      if (error) fail(error, "vault_nodes");
      return (data as NodeMeta | null) ?? null;
    },

    async readContent(id: string): Promise<ContentRow | null> {
      const { data, error } = await db
        .from("vault_content").select("data, updated_at, updated_by").eq("node_id", id).maybeSingle();
      if (error) fail(error, "vault_content");
      if (!data) return null;
      return { data: data.data ?? "", updated_at: data.updated_at ?? null, updated_by: data.updated_by ?? null };
    },

    /** Only the timestamp, for the conflict re-check right before a write. */
    async contentUpdatedAt(id: string): Promise<string | null> {
      const { data, error } = await db.from("vault_content").select("updated_at").eq("node_id", id).maybeSingle();
      if (error) fail(error, "vault_content");
      return data?.updated_at ?? null;
    },

    async writeContent(id: string, content: string): Promise<{ updated_at: string }> {
      const nowIso = new Date().toISOString();
      const { data, error } = await db
        .from("vault_content")
        .upsert({ node_id: id, data: content, user_id: userId, updated_at: nowIso }, { onConflict: "node_id" })
        .select("updated_at")
        .single();
      if (error) fail(error, "vault_content upsert");
      return { updated_at: data?.updated_at ?? nowIso };
    },

    async createNode(id: string, name: string, kind: { type: string }, tags: string[]): Promise<void> {
      const { error } = await db.from("vault_nodes").insert({ id, name, kind, tags, user_id: userId });
      if (error) fail(error, "vault_nodes insert");
    },

    async addEdge(fromId: string, toId: string): Promise<void> {
      const { error } = await db
        .from("vault_edges")
        .upsert({ from_id: fromId, to_id: toId, user_id: userId }, { onConflict: "from_id,to_id" });
      if (error) fail(error, "vault_edges upsert");
      // Same inheritance rule as the app's addEdge: a child placed under a
      // shared parent must carry the parent's team_id or RLS hides it from the
      // team. Best effort, exactly as there.
      const { data: parent } = await db.from("vault_nodes").select("team_id").eq("id", fromId).maybeSingle();
      if (parent?.team_id) await db.from("vault_nodes").update({ team_id: parent.team_id }).eq("id", toId);
    },

    // A bin move, not a delete — the same soft delete as the app's
    // deleteNode. This used to be a copy of the PRE-bin hard delete, which
    // also wiped vault_content_versions: the one mechanism built to survive
    // a bad write did not survive a `vault rm`, on a free plan with no
    // backups. Deletion is a state: deleted_at is set, nothing is destroyed,
    // and the node sits in the app's Bin tab until emptied there. The CLI
    // deliberately has NO hard-delete path; emptying the bin is a decision
    // taken in the app, behind its confirm, by a human.
    async deleteNode(id: string): Promise<void> {
      const { error } = await db
        .from("vault_nodes")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) fail(error, "vault_nodes bin");
      // Edges survive untouched — loadGraph drops the ones touching a binned
      // node, so a restore brings the node back with every link it had.
    },
  };
}

export type VaultApi = ReturnType<typeof createVaultApi>;
