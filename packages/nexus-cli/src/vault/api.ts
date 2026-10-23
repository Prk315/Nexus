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
}

export function createVaultApi(db: SupabaseClient, userId: string) {
  return {
    async loadGraph(): Promise<VaultGraph> {
      const [nodesRes, edgesRes] = await Promise.all([
        db.from("vault_nodes").select("id, name, kind, tags, team_id, user_id"),
        db.from("vault_edges").select("from_id, to_id"),
      ]);
      if (nodesRes.error) fail(nodesRes.error, "vault_nodes");
      if (edgesRes.error) fail(edgesRes.error, "vault_edges");
      return buildGraph(nodesRes.data ?? [], edgesRes.data ?? []);
    },

    async getNode(id: string): Promise<NodeMeta | null> {
      const { data, error } = await db
        .from("vault_nodes").select("id, name, kind, team_id, user_id").eq("id", id).maybeSingle();
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

    async deleteNode(id: string): Promise<void> {
      await Promise.all([
        db.from("vault_content").delete().eq("node_id", id),
        db.from("vault_content").delete().eq("node_id", `${id}_annot`),
        db.from("vault_content").delete().eq("node_id", `${id}_hl`),
        db.from("vault_content").delete().eq("node_id", `${id}_textannot`),
        db.from("vault_content").delete().eq("node_id", `${id}_bookmarks`),
        db.from("vault_content").delete().eq("node_id", `${id}_margins`),
        db.from("vault_journals").delete().eq("node_id", id),
        db.from("vault_records").delete().eq("source_node_id", id),
        db.from("vault_ydoc").delete().eq("node_id", id),
        db.from("vault_content_versions").delete().eq("node_id", id),
        db.from("vault_content_versions").delete().like("node_id", `${id}\\_%`),
      ]);
      const { error } = await db.from("vault_nodes").delete().eq("id", id);
      if (error) fail(error, "vault_nodes delete");
      // vault_edges cascade via FK, as in the app.
    },
  };
}

export type VaultApi = ReturnType<typeof createVaultApi>;
