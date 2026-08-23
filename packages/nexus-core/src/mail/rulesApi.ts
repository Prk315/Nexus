/**
 * Writes for the rules editor.
 *
 * Same injection discipline as `createMailLoader`: nexus-core constructs no
 * Supabase client, the app hands over its **authenticated** one, and RLS does
 * the scoping (`mail_rules` is owner-only with no anon policy, so a mismatched
 * client silently writes nothing a read can see).
 *
 * These are the *only* mutations in the mail module. The panel edits rules as
 * data; it never applies them — `n8n-ingest` does that server-side, before the
 * model, so a rule beats the model deterministically.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MAIL_RULES_TABLE, MAIL_RULE_COLUMNS, type MailRule } from "./types";

export type MailRulesApi = {
  create: (rule: Omit<MailRule, "id">) => Promise<MailRule>;
  update: (id: string, patch: Partial<Omit<MailRule, "id">>) => Promise<MailRule>;
  remove: (id: string) => Promise<void>;
  /** Persist a whole renumbered order — see `reorderRules`. */
  reorder: (order: readonly { id: string; sort: number }[]) => Promise<void>;
};

export function createMailRulesApi(
  client: SupabaseClient | null | undefined,
): MailRulesApi {
  function requireClient(): SupabaseClient {
    if (!client) throw new Error("mail: no Supabase client");
    return client;
  }

  return {
    async create(rule) {
      const { data, error } = await requireClient()
        .from(MAIL_RULES_TABLE)
        // `user_id` is deliberately not set here. It defaults to `auth.uid()`
        // server-side; sending it from the client would be a second source of
        // truth, and one the RLS `with check` would reject anyway if they ever
        // disagreed.
        .insert(rule)
        .select(MAIL_RULE_COLUMNS)
        .single();
      if (error) throw new Error(error.message ?? "mail: rule create failed");
      return data as MailRule;
    },

    async update(id, patch) {
      const { data, error } = await requireClient()
        .from(MAIL_RULES_TABLE)
        .update(patch)
        .eq("id", id)
        .select(MAIL_RULE_COLUMNS)
        .single();
      if (error) throw new Error(error.message ?? "mail: rule update failed");
      return data as MailRule;
    },

    async remove(id) {
      const { error } = await requireClient()
        .from(MAIL_RULES_TABLE)
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message ?? "mail: rule delete failed");
    },

    async reorder(order) {
      if (order.length === 0) return;
      // One statement, not N. A per-row loop can fail partway and leave the
      // precedence list interleaved — which, under first-match-wins, silently
      // changes which rule decides every future message. `upsert` on the
      // primary key applies the whole renumbering atomically.
      const { error } = await requireClient()
        .from(MAIL_RULES_TABLE)
        .upsert(order as { id: string; sort: number }[], { onConflict: "id" });
      if (error) throw new Error(error.message ?? "mail: rule reorder failed");
    },
  };
}
