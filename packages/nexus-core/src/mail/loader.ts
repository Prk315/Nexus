/**
 * Builds the `loadMail` function `NexusHeader` takes as a prop.
 *
 * The injected-loader shape is the whole design decision. nexus-core
 * constructs **no** Supabase client here: each app passes its own
 * **authenticated** client, because `mail_messages` and `n8n_requests` both
 * carry owner-only RLS with no anon policy at all, and a mismatched client
 * reads back an empty set rather than an error. `apps/nexus`, `apps/Stonks`
 * and `apps/TimeTrackerApp` have no session and simply pass no loader — the
 * Mail button keeps its old behaviour there.
 *
 * (`ClockDropdown` does the opposite — it makes a session-less anon client —
 * for the opposite reason: the productivity tables it reads are gated to the
 * *anon* role. Same trap, mirrored.)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAIL_CATEGORIES_TABLE,
  MAIL_CATEGORY_COLUMNS,
  MAIL_COLUMNS,
  MAIL_RULES_TABLE,
  MAIL_RULE_COLUMNS,
  MAIL_SYNC_KIND,
  MAIL_TABLE,
  N8N_REQUESTS_TABLE,
  OPEN_STATUSES,
  type MailCategory,
  type MailMessage,
  type MailRule,
} from "./types";

/**
 * The most recent N open messages. A header is not a mail client, and this
 * bounds the read; `MailPanel` says so out loud when the window comes back
 * full, because a truncated window must never be presented as a whole mailbox.
 */
export const MAIL_FETCH_LIMIT = 100;

/**
 * What one open of the panel sees.
 *
 * `lastSyncedAt` is separate from `messages` because **row count is not a
 * freshness signal**. Zero rows means "n8n has never run" *or* "the inbox is
 * clean", and a panel that renders both as "Inbox zero" is lying half the
 * time — the same failure as seeding `blocking_state` with zeros. The
 * authoritative answer is the newest `n8n_requests` row with
 * `kind = 'mail_sync'` and `status = 'done'`; `null` here means no such row
 * exists, i.e. *unknown*, and the panel must say so rather than claim an empty
 * inbox.
 */
export type MailSnapshot = {
  messages: MailMessage[];
  /**
   * The user's categories, including disabled ones. Disabled rows are kept so
   * a message already filed under one still resolves — see `resolveCategory`.
   */
  categories: MailCategory[];
  /** The user's rules, for the editor. The panel never evaluates them. */
  rules: MailRule[];
  /** ISO timestamp of the last completed sync, or `null` if n8n has never run. */
  lastSyncedAt: string | null;
};

export type MailLoader = () => Promise<MailSnapshot>;

export type MailLoaderOptions = {
  /** Row cap. Default `MAIL_FETCH_LIMIT`. */
  limit?: number;
};

/**
 * A `MailLoader` over `mail_messages` + the `n8n_requests` freshness read.
 *
 * The two queries are independent, so they run concurrently. Neither is
 * scoped by `user_id` in the query: RLS is the scoping mechanism, and a
 * hardcoded id here would be a second, drifting source of truth.
 *
 * Throws on any error. `MailPanel` catches and degrades to its unavailable
 * state, keeping the last good snapshot — the same silent-degradation contract
 * as `ClockDropdown`.
 */
export function createMailLoader(
  client: SupabaseClient | null | undefined,
  options: MailLoaderOptions = {},
): MailLoader {
  const limit = options.limit ?? MAIL_FETCH_LIMIT;
  return async () => {
    if (!client) throw new Error("mail: no Supabase client");

    const [messagesRes, categoriesRes, rulesRes, syncRes] = await Promise.all([
      client
        .from(MAIL_TABLE)
        .select(MAIL_COLUMNS)
        // Open mail only. Filtering in SQL rather than after the fact is what
        // keeps the row cap honest: fetching everything and partitioning
        // client-side lets old `archived` rows fill the window, leaving nothing
        // pending in it and making the panel announce "inbox clear" off a
        // window that never contained the mail.
        .in("status", OPEN_STATUSES as readonly string[])
        // `score desc nulls first, received_at desc` — the ordering
        // `mail_messages_user_score` is built for. `nullsFirst` is the
        // contract, not a default: un-triaged mail is the most likely to need a
        // human, so it must survive the cap, not be the first thing dropped.
        //
        // The column is `score`, NOT `priority`. It was renamed precisely
        // because `pf_tasks.priority` means *importance* on a high|medium|low
        // domain, and a 0-100 `priority` in the same database would be the same
        // word with the opposite meaning. This call was the one place the
        // rename was missed, and the failure was total rather than partial:
        // PostgREST rejects the whole query with `42703 column
        // mail_messages.priority does not exist`, the loader throws, and the
        // panel shows "Mail is unavailable" — with real, correctly-triaged mail
        // sitting in the table. Nothing in `tsc` can catch a column name in a
        // string, which is why `MAIL_COLUMNS` is a pinned constant; this
        // `.order()` argument was outside it.
        .order("score", { ascending: false, nullsFirst: true })
        .order("received_at", { ascending: false })
        .limit(limit),
      client
        .from(MAIL_CATEGORIES_TABLE)
        .select(MAIL_CATEGORY_COLUMNS)
        // Disabled categories are fetched too: `enabled` governs what a picker
        // offers, not what an already-filed message can display. Filtering here
        // would make mail filed under a disabled category look uncategorised.
        .order("sort", { ascending: true }),
      client
        .from(MAIL_RULES_TABLE)
        .select(MAIL_RULE_COLUMNS)
        // `sort` is precedence, so this is evaluation order. Disabled rules
        // keep their place — see `orderRules`.
        .order("sort", { ascending: true }),
      client
        .from(N8N_REQUESTS_TABLE)
        .select("finished_at")
        .eq("kind", MAIL_SYNC_KIND)
        .eq("status", "done")
        // Covered by `n8n_requests_user_kind_finished (user_id, kind, status,
        // finished_at desc)`.
        .order("finished_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (messagesRes.error) throw new Error(messagesRes.error.message ?? "mail: query failed");
    // Categories and rules are *decoration and configuration*, not the mail
    // itself. A failure in either degrades to an empty list — every category
    // then resolves through the unknown-name path, which renders visibly, and
    // the rules editor shows its own empty state. Failing the whole load would
    // hide real mail behind a broken config read.
    const categories: MailCategory[] = categoriesRes.error
      ? []
      : ((categoriesRes.data ?? []) as unknown as MailCategory[]);
    const rules: MailRule[] = rulesRes.error
      ? []
      : ((rulesRes.data ?? []) as unknown as MailRule[]);
    // A freshness read that fails must not be reported as "never synced" —
    // that is the very conflation this field exists to prevent. Fail the whole
    // load instead and let the panel show "unavailable" over the last good
    // snapshot.
    if (syncRes.error) throw new Error(syncRes.error.message ?? "mail: freshness query failed");

    return {
      messages: (messagesRes.data ?? []) as unknown as MailMessage[],
      categories,
      rules,
      lastSyncedAt: (syncRes.data?.finished_at as string | null | undefined) ?? null,
    };
  };
}
