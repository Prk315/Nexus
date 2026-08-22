/**
 * Shared types for the Gmail-triage surface in `NexusHeader`.
 *
 * A locally-hosted n8n instance reads Gmail, asks an LLM to rank and draft a
 * reply, and writes the result into Supabase's `mail_messages`. The header only
 * ever *reads* that table: Vault / PathFinder / Protocol are Vercel HTTPS pages
 * that cannot reach a localhost n8n, and a phone never can. Supabase is the
 * only thing all three can see.
 *
 * `mail_messages` is `auth.uid()`-scoped, so every read must go through an
 * **authenticated** client. A mismatched client (the anon `supabasePublic`, or
 * a signed-out session) returns an **empty set, not an error** — which is
 * indistinguishable from "no mail". That is why the loader is injected by each
 * app rather than constructed here, and why `MailPanel` treats "zero rows" as
 * its own distinct state rather than as an inbox that happens to be clear.
 */

/**
 * One triaged message.
 *
 * Column names are snake_case because these objects come straight off
 * PostgREST — no mapping layer, so a schema change shows up as a type error
 * rather than as a quietly-undefined field.
 *
 * `raw jsonb` exists on the table but is deliberately **not** part of this
 * shape: it holds the full message payload and the header has no use for it.
 * Selecting it would ship a whole mailbox into a dropdown.
 */
export type MailMessage = {
  id: string;
  /** Gmail's message id — the idempotency key n8n upserts on. */
  external_id: string | null;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  /** ISO-8601 timestamp. */
  received_at: string | null;
  /**
   * 1–5, **higher = more urgent**. See `normalizePriority` — anything outside
   * that range is clamped, and a null is treated as "unranked", not as zero.
   */
  priority: number | null;
  /** LLM-authored. Untrusted text — render as plain text, never as markup. */
  category: string | null;
  /** LLM-authored draft reply. Same: untrusted text. */
  suggested_reply: string | null;
  /** Triage lifecycle — see `isHandled` for the values that mean "done". */
  status: string | null;
};

/** The table n8n writes and the header reads. */
export const MAIL_TABLE = "mail_messages";

/**
 * The exact column list to select. Pinned as a constant so the query and the
 * `MailMessage` type cannot drift apart, and so `raw` is never accidentally
 * pulled along by a `select("*")`.
 */
export const MAIL_COLUMNS =
  "id,external_id,sender,subject,snippet,received_at,priority,category,suggested_reply,status";
