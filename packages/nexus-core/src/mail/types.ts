/**
 * Shared types for the Gmail-triage surface in `NexusHeader`.
 *
 * A locally-hosted n8n instance reads Gmail, applies the user's `mail_rules`,
 * asks a local Qwen for the rest, and pushes the result into Supabase through
 * the `n8n-ingest` edge function. The header only ever *reads* mail: Vault /
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
 * what a triage list shows. `replied` and `archived` are terminal.
 */
export type MailStatus = "unread" | "read" | "replied" | "archived";

/** Still in the tray. Reading is not triaging. */
export const OPEN_STATUSES: readonly MailStatus[] = ["unread", "read"];

/** Dealt with — hidden from the triage list. */
export const HANDLED_STATUSES: readonly MailStatus[] = ["replied", "archived"];

/**
 * The importance and urgency axes.
 *
 * Deliberately the **same three-value domain as PathFinder's** `pf_tasks.
 * priority` and `pf_task_planning.urgency` (`apps/PathFinder/src/types/index.ts`).
 * That symmetry is the entire reason a triaged mail converts into a task
 * losslessly — no mapping table, no rounding, no "closest equivalent".
 *
 * Both are **nullable here**, which PathFinder's are not: `pf_task_planning.
 * urgency` is `not null default 'medium'`. A mail that has not been triaged, or
 * that the model scored without committing to an axis, genuinely has no value —
 * and "not determined" is not "medium". See `normalizeAxis`, which returns
 * `MailAxis | null` and never invents a level.
 */
export type MailAxis = "high" | "medium" | "low";

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
   * This is the model's **evidence**, not the verdict: `importance` and
   * `urgency` are the verdict, and all three can independently be null. A rule
   * can set the axes without the model ever scoring the row, and the model can
   * score a row the rules said nothing about.
   *
   * `null` means the triage step has not run for this row, which is a different
   * fact from "it ran and scored this low". The ingest function writes a
   * message as soon as it is fetched; the model is the slow second half of the
   * pipeline, so an un-scored row is a normal thing to read. Never coerce it to
   * 0 — see `normalizeScore`, which returns `number | null`, and `compareMail`,
   * which sorts nulls **first**. An un-triaged message is the one most likely
   * to need a human, so it belongs at the top of a triage list rather than
   * buried at the bottom where a `default 0` would have put it.
   */
  score: number | null;

  /** Maps to `pf_tasks.priority` on conversion. Null = not determined. */
  importance: MailAxis | null;
  /** Maps to `pf_task_planning.urgency` on conversion. Null = not determined. */
  urgency: MailAxis | null;

  /** ISO date or timestamp. Maps to `pf_tasks.due_date`. */
  due_date: string | null;
  /** Minutes. Maps to `pf_tasks.time_estimate`. */
  time_estimate: number | null;

  /**
   * Matched **by name** against `mail_categories.name`, with no foreign key —
   * the same loose coupling `pf_cal_blocks.category` uses, and for the same
   * reason: an FK would block ad-hoc categories and make every rename a
   * migration. A name with no matching row still renders; see `resolveCategory`.
   *
   * ⚠️ This is **not** `pf_tasks.category`, which is the ISA subtype
   * discriminator (`task` / `reminder` / `chore` / `shopping`). Sending a mail
   * category into that column would re-type the task. The conversion unit owns
   * that mapping; nothing here should imply the two are the same field.
   */
  category: string | null;

  /**
   * Which `mail_rules` row set the axes, when a rule did rather than the model.
   *
   * Singular, and that is load-bearing: it is only expressible if **one** rule
   * decides a message, i.e. first-match-wins. See `RULE_PRECEDENCE` in
   * `rules.ts` for why the UI states that, and what to re-check if the
   * migration turns out to say otherwise.
   */
  rule_id: string | null;

  /** LLM-authored draft reply. Untrusted text. */
  suggested_reply: string | null;
  /** When the model scored it. `null` exactly when `score` is null. */
  triaged_at: string | null;
  /** e.g. `qwen2.5:14b`. `null` exactly when `score` is null. */
  triage_model: string | null;

  /** Non-null once converted into a PathFinder task. */
  task_id: number | null;

  status: MailStatus;
};

/**
 * A user-defined mail category. Same shape as `coverage_categories`, plus
 * `enabled` — which `coverage_categories` does **not** have, so it is a new
 * idea here rather than a copied one. Disabling hides a category from pickers;
 * messages already tagged with it keep the name and fall through to
 * `resolveCategory`'s unknown-name path.
 */
export type MailCategory = {
  id: string;
  name: string;
  /** A PathFinder `BLOCK_COLORS` key (`teal`, `rose`, …), not a hex value. */
  color: string;
  emoji: string | null;
  sort: number;
  enabled: boolean;
};

/** What a `mail_rules` row matches on. */
export type MailRuleField = "sender" | "domain" | "subject" | "list_id";

/**
 * A user-defined triage rule.
 *
 * The panel **edits** these; it never evaluates them. `n8n-ingest` applies them
 * server-side, before the model, so a rule always beats the model
 * deterministically and the same message cannot be classified two ways by two
 * clients. That split is the same one as `focus-evaluate` → `blocking_state`:
 * the thing that can compute the verdict does so once, and every reader just
 * reads it.
 */
export type MailRule = {
  id: string;
  name: string;
  enabled: boolean;
  /** Precedence. Lower runs first — see `RULE_PRECEDENCE`. */
  sort: number;
  field: MailRuleField;
  /** The value to match. Substring for `subject`, exact-ish otherwise. */
  pattern: string;
  /** Actions. A null action leaves the field for the model to decide. */
  set_category: string | null;
  set_importance: MailAxis | null;
  set_urgency: MailAxis | null;
  /** Skip the tray entirely — the message lands already `archived`. */
  auto_archive: boolean;
};

export const MAIL_TABLE = "mail_messages";
export const MAIL_CATEGORIES_TABLE = "mail_categories";
export const MAIL_RULES_TABLE = "mail_rules";

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
  "id,external_id,thread_id,sender,subject,snippet,received_at,score,importance,urgency," +
  "due_date,time_estimate,category,rule_id,suggested_reply,triaged_at,triage_model,task_id,status";

export const MAIL_CATEGORY_COLUMNS = "id,name,color,emoji,sort,enabled";

export const MAIL_RULE_COLUMNS =
  "id,name,enabled,sort,field,pattern,set_category,set_importance,set_urgency,auto_archive";
