/**
 * Shared types for the Gmail-triage surface in `NexusHeader`.
 *
 * A locally-hosted n8n instance reads Gmail, asks a local Qwen to rank each
 * message and draft a reply, and pushes the result into Supabase through the
 * `n8n-ingest` edge function. The header only ever *reads* those rows: Vault /
 * PathFinder / Protocol are Vercel HTTPS pages that structurally cannot fetch
 * `http://localhost:5678`, and a phone is not even on the same host. Supabase
 * is the only thing all of them can see.
 *
 * `mail_messages` has **no anon policy at all** — reads require `auth.uid()`,
 * exactly like `usage_intervals`, and for a stronger reason: it holds sender
 * addresses, subjects, body snippets and a draft reply written in the user's
 * voice. A mismatched client (anon, or a signed-out session) therefore returns
 * an **empty set, not an error**, which is indistinguishable from "no mail".
 * That is why the loader is injected by each app from its own authenticated
 * client rather than constructed in nexus-core.
 *
 * Schema of record: `supabase/migrations/20260822120000_n8n_mail_bus.sql`.
 */

/**
 * Where the user is with a message. CHECK-constrained in the database, so this
 * union is exhaustive rather than aspirational.
 *
 * `unread` and `read` are *open* — both still need dealing with, and both are
 * what a triage list shows (the `mail_messages_user_open` partial index is
 * defined on exactly this pair). `replied` and `archived` are terminal.
 */
export type MailStatus = "unread" | "read" | "replied" | "archived";

/** Still in the tray. Reading is not triaging. */
export const OPEN_STATUSES: readonly MailStatus[] = ["unread", "read"];

/** Dealt with — hidden from the triage list. */
export const HANDLED_STATUSES: readonly MailStatus[] = ["replied", "archived"];

/**
 * One row of `mail_messages`.
 *
 * Column names are snake_case because these objects come straight off
 * PostgREST — no mapping layer, so a schema change surfaces as a type error
 * rather than a quietly-undefined field.
 *
 * `raw jsonb` exists on the table but is deliberately **not** in this shape or
 * in `MAIL_COLUMNS`: it is the untouched Gmail payload, kept so a prompt change
 * can be re-run over history. Selecting it would ship whole message bodies into
 * a header dropdown.
 */
export type MailMessage = {
  id: string;
  /** Gmail's immutable message id — the natural key the ingest upsert targets. */
  external_id: string;
  /** Gmail thread id when known. Many messages share one; never a key. */
  thread_id: string | null;
  sender: string;
  subject: string | null;
  snippet: string | null;
  /** ISO-8601. `not null` in the database. */
  received_at: string;

  /**
   * **0–100, higher = more urgent, and nullable — `null` is a state, not a
   * score.**
   *
   * `null` means the triage step has not run for this row, which is a
   * different fact from "it ran and scored this low". The ingest function
   * writes a message as soon as it is fetched; the model is the slow second
   * half of the pipeline, so an un-triaged row is a normal, expected thing to
   * read. Never coerce it to 0 — see `normalizePriority`, which returns
   * `number | null` for precisely this reason, and `compareMail`, which sorts
   * nulls **first**. An un-triaged message is the one most likely to need a
   * human, so it belongs at the top of a triage list rather than buried at the
   * bottom where a `default 0` would have put it.
   */
  priority: number | null;
  /** LLM-authored, free-text vocabulary. Untrusted — render as plain text. */
  category: string | null;
  /** LLM-authored draft reply. Same: untrusted text. */
  suggested_reply: string | null;
  /** When the model scored it. `null` exactly when `priority` is null. */
  triaged_at: string | null;
  /** e.g. `qwen2.5:14b`. `null` exactly when `priority` is null. */
  triage_model: string | null;

  status: MailStatus;
};

/** The table n8n writes and the header reads. */
export const MAIL_TABLE = "mail_messages";

/** The action queue the freshness signal is read from. */
export const N8N_REQUESTS_TABLE = "n8n_requests";

/** The queue `kind` whose newest completed row means "mail was last synced". */
export const MAIL_SYNC_KIND = "mail_sync";

/**
 * The exact column list to select. Pinned as a constant so the query and
 * `MailMessage` cannot drift apart, and so `raw` is never dragged along by a
 * stray `select("*")`.
 */
export const MAIL_COLUMNS =
  "id,external_id,thread_id,sender,subject,snippet,received_at,priority,category,suggested_reply,triaged_at,triage_model,status";
