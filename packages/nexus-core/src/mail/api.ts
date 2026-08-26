/**
 * Per-message triage writes: "Done" and "Not important".
 *
 * Same injection discipline as `createMailRulesApi` and `createJobsApi`:
 * nexus-core constructs no Supabase client here, the app hands over its own
 * **authenticated** one, and RLS does the scoping — `mail_messages` has no
 * anon policy at all, so a mismatched client would write nothing a read can
 * see, exactly like every other mail write.
 *
 * Neither write guards on the row's prior state, unlike `JobsApi.approve` /
 * `.reject`. Those guard because the approval email can decide the same row
 * first; nothing else races `status` or `importance` here — n8n's ingest
 * deliberately never overwrites a status the user has already set
 * (`mergeStatus` in `n8n-ingest`, see CLAUDE.md's mail-triage section) — so
 * archiving or de-prioritising a message from any prior state is always a
 * legitimate, idempotent transition.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MAIL_COLUMNS, MAIL_TABLE, type MailMessage } from "./types";

export type MailApi = {
  /**
   * `status → 'archived'`. A terminal status (`isHandled`), so the row leaves
   * the open triage list the moment the caller re-partitions with
   * `triageInbox` — no separate "hide it" step needed.
   */
  markDone: (id: string) => Promise<MailMessage | null>;
  /**
   * `importance → 'low'`. Stays in the open list — this is a demotion, not a
   * dismissal — but sinks to the bottom of its score bucket; see
   * `sinkLowImportance` in `./score`.
   */
  markNotImportant: (id: string) => Promise<MailMessage | null>;
};

export function createMailApi(client: SupabaseClient | null | undefined): MailApi {
  function requireClient(): SupabaseClient {
    if (!client) throw new Error("mail: no Supabase client");
    return client;
  }

  return {
    async markDone(id) {
      const { data, error } = await requireClient()
        .from(MAIL_TABLE)
        .update({ status: "archived" })
        .eq("id", id)
        .select(MAIL_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message ?? "mail: mark done failed");
      return (data as unknown as MailMessage) ?? null;
    },

    async markNotImportant(id) {
      const { data, error } = await requireClient()
        .from(MAIL_TABLE)
        .update({ importance: "low" })
        .eq("id", id)
        .select(MAIL_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message ?? "mail: mark not important failed");
      return (data as unknown as MailMessage) ?? null;
    },
  };
}
