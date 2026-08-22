/**
 * Builds the `loadMail` function `NexusHeader` takes as a prop.
 *
 * The injected-loader shape is the whole design decision. nexus-core stays
 * presentational and constructs **no** Supabase client of its own here: each
 * app passes its own **authenticated** client, because `mail_messages` is
 * `auth.uid()`-scoped and a mismatched client reads back an empty set rather
 * than an error. `apps/nexus`, `apps/Stonks` and `apps/TimeTrackerApp` have no
 * session at all and simply pass no loader — the Mail button keeps its old
 * behaviour there.
 *
 * (`ClockDropdown` does the opposite — it makes a session-less anon client —
 * for the opposite reason: the productivity tables it reads are gated to the
 * *anon* role. Same trap, mirrored.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { MAIL_COLUMNS, MAIL_TABLE, type MailMessage } from "./types";

/**
 * The most recent N rows. A header is not a mail client, and this bounds the
 * read; `MailPanel` says so out loud when the window comes back full, because
 * a truncated window must never be presented as a whole mailbox.
 */
export const MAIL_FETCH_LIMIT = 100;

export type MailLoaderOptions = {
  /** Row cap. Default `MAIL_FETCH_LIMIT`. */
  limit?: number;
};

/**
 * `() => Promise<MailMessage[]>` over `mail_messages`.
 *
 * Returns **every** row it can see, handled ones included — `triageInbox`
 * partitions them client-side, and its `total` is what lets the panel tell
 * "n8n has never written a row" apart from "everything is triaged". Filtering
 * handled rows out in SQL would destroy that distinction and make a dead
 * pipeline look like a clear inbox.
 *
 * There is deliberately no `.eq("user_id", …)`: RLS is the scoping mechanism,
 * and a hardcoded id here would be a second, drifting source of truth.
 *
 * Throws on any error. `MailPanel` catches and degrades to its unavailable
 * state — the same silent-degradation contract as `ClockDropdown`.
 */
export function createMailLoader(
  client: SupabaseClient | null | undefined,
  options: MailLoaderOptions = {},
): () => Promise<MailMessage[]> {
  const limit = options.limit ?? MAIL_FETCH_LIMIT;
  return async () => {
    if (!client) throw new Error("mail: no Supabase client");
    const { data, error } = await client
      .from(MAIL_TABLE)
      .select(MAIL_COLUMNS)
      // Recency, and deliberately *not* priority — the row cap is applied to
      // this ordering, and sorting by priority lets old `status = 'archived'`,
      // `priority = 5` rows crowd today's pending mail out of the window
      // entirely. The panel would then find nothing pending and announce
      // "inbox clear" off a window that never contained the mail. Priority
      // ordering happens client-side in `compareMail`, which also has to clamp
      // and default nulls in ways this query cannot.
      .order("received_at", { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw new Error(error.message ?? "mail: query failed");
    return (data ?? []) as MailMessage[];
  };
}
