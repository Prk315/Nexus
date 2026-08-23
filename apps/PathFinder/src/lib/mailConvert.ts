// Turning a triaged Gmail message into a PathFinder task — the pure half.
//
// The IO half lives in `api/mail.ts`. Everything here is React-free and
// Supabase-free on purpose, for the same reason `taskTree.ts` and `coverage.ts`
// are: the interesting mistakes in this feature are mapping mistakes, and a
// mapping you can only exercise through a mocked PostgREST chain is a mapping
// nobody exercises.
//
// Schema of record: `supabase/migrations/20260823120000_n8n_mail_bus.sql`.
//
// ─── Why so much of this file is rejection ─────────────────────────────────
//
// `mail_messages.importance` and `.urgency` are CHECK-constrained to exactly
// PathFinder's three values, so the domains are identical and the mapping is
// nominally a copy. The reason it isn't written as one is an asymmetry on the
// *receiving* side:
//
//   pf_task_planning.urgency  — CHECK-ed to ('high','medium','low')
//   pf_tasks.priority         — text, NO CHECK AT ALL. The domain is convention,
//                               enforced only by the `Priority` union in ../types
//
// So a bad urgency fails loudly at the database, and a bad importance **succeeds
// silently** and produces a row the matrix pad cannot place. Depending on
// another table's CHECK for our own correctness is exactly the coupling that
// stops holding the moment someone backfills, re-runs an older ingest build, or
// widens the vocabulary upstream. Every value is therefore validated here
// against the TypeScript union, which is the real contract, and anything outside
// it is dropped rather than written.

import type { Priority, Urgency } from "../types";

/**
 * The subset of a mail row this conversion reads.
 *
 * Structurally a subset of nexus-core's `MailMessage`, so that type is
 * assignable to this one — but declared here rather than imported so PathFinder
 * does not depend on a `@nexus/core` export that only exists on a branch.
 *
 * Two columns are **deliberately absent**, and their absence is load-bearing:
 *
 * - `score` (0-100) is the model's *evidence* for the two axes, not a third
 *   axis, and it has no task equivalent. Leaving it out of this type is what
 *   makes "map score to something" a compile error rather than a judgement
 *   call. (It is also why the column is not called `priority`: in PathFinder
 *   `priority` means importance and its domain is high/medium/low.)
 * - `task_id` — the back-link is re-read from the database at conversion time
 *   rather than trusted from whatever the panel happened to have cached. It is
 *   `on delete set null`, so a mail that was converted an hour ago may be
 *   unconverted now; and a stale `null` in a dropdown rendered ten minutes ago
 *   is exactly how you get two tasks for one mail.
 */
export type ConvertibleMail = {
  id: string;
  sender: string;
  subject: string | null;
  snippet: string | null;
  /** 'high' | 'medium' | 'low' by CHECK; `null` = not decided, never "low". */
  importance: string | null;
  /** Same domain, same nullability. */
  urgency: string | null;
  /** A real `date` column; PostgREST renders it as 'YYYY-MM-DD'. */
  due_date: string | null;
  /** Minutes. */
  time_estimate: number | null;
  /** Category name. Untrusted free text, and NEVER written to `pf_tasks.category`. */
  category: string | null;
  suggested_reply: string | null;
};

/**
 * The flat payload handed to `createTask`, which splits it across the ISA
 * hierarchy itself (`splitPatch`): `title` / `priority` / `due_date` /
 * `time_estimate` are supertype columns, `urgency` and `notes` belong to
 * `pf_task_planning`.
 *
 * Every optional key is **omitted**, never set to `undefined`. `splitPatch`
 * walks `Object.entries`, so a present-but-undefined planning key survives the
 * split, passes `createTask`'s `Object.keys(planning).length > 0` guard, and
 * ends as `.update({ urgency: undefined })` — which serialises to `{}`, an
 * empty PATCH body. (A supertype key like `priority` is merely dropped by
 * `JSON.stringify` on the INSERT, so it is the harmless half of the same
 * habit.) Absence has to mean absence.
 */
export type MailTaskPayload = {
  title: string;
  priority?: Priority;
  due_date?: string;
  time_estimate?: number;
  urgency?: Urgency;
  notes?: string;
};

/** Used when a mail has no subject; `pf_tasks.title` is not nullable. */
export const NO_SUBJECT_TITLE = "(no subject)";

const AXIS_VALUES = ["high", "medium", "low"] as const;

/**
 * The `Priority` / `Urgency` union as a runtime check.
 *
 * Returns `null` — not `"medium"` — for anything it does not recognise,
 * *including* a mail that simply has no verdict. `null` means "not decided",
 * which is a different fact from "decided, and unremarkable"; the caller turns
 * it into an omitted key so the column's own `not null default 'medium'`
 * applies. The row reads as medium either way, but only one of the two ever
 * claims something decided it.
 */
function axis<T extends Priority | Urgency>(value: string | null | undefined): T | null {
  return value != null && (AXIS_VALUES as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/**
 * `pf_tasks.due_date` is **`text`**, not a date — it predates the migrations
 * directory, so nothing in the database will reject `'next Friday'` or
 * `'21/08/2026'`.
 *
 * That column is read as if it were ISO-comparable, everywhere: `daily.ts`
 * decides what is overdue with the string comparison `t.due_date! < today`, and
 * queries it with `.lte("due_date", today)` against a `toISOString().slice(0,10)`.
 * Every task PathFinder itself creates comes from an `<input type="date">`, so
 * 'YYYY-MM-DD' is not a preference — it is the format the whole app's date logic
 * silently assumes. One row in another format does not error; it sorts into the
 * wrong place and stays there.
 *
 * The mail side is a real `date`, so PostgREST hands back 'YYYY-MM-DD' under ISO
 * DateStyle and this should never fire. It exists because "should never fire" is
 * not a property a text column can enforce, and because this is the only place a
 * value from outside PathFinder enters that column.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(value: string | null | undefined): string | null {
  if (value == null || !ISO_DATE.test(value)) return null;
  // Shape is not validity: '2026-02-30' matches the pattern and would compare
  // as a date that does not exist. The round-trip rejects it — Date normalises
  // it to '2026-03-02', which no longer equals the input.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

/**
 * Minutes. `pf_tasks.time_estimate` is `integer`, so a float would be truncated
 * server-side without comment; a negative one is nonsense that the rollup would
 * then propagate up the whole ancestor chain via `aggregate_estimate`.
 */
function minutes(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (!Number.isInteger(value) || value < 0) return null;
  return value;
}

/**
 * Composes the planning note.
 *
 * This is where the mail's `category` goes, explicitly labelled as the *mail's*
 * category. It must never reach `pf_tasks.category`, which is the subtype
 * discriminator behind the generated `task_type` column and is itself CHECK-ed
 * to ('reminder','chore','shopping'). A category like 'Newsletter' fails that
 * check outright; one that happens to read 'reminder' passes, re-types the task,
 * and makes the sync trigger DELETE the planning row this very note lives in.
 * Losing the note would be the polite version of that bug; the impolite one is a
 * task that has silently stopped being a task.
 *
 * Sections are dropped entirely when blank, so an un-triaged mail produces a
 * short note about who it is from rather than a form full of empty headings.
 */
export function mailNotes(mail: ConvertibleMail): string | null {
  const parts: string[] = [];
  const from = mail.sender?.trim();
  if (from) parts.push(`From: ${from}`);

  const category = mail.category?.trim();
  // "Mail category", never bare "Category" — see above. The label is the only
  // thing stopping someone reading this note and helpfully "fixing" it by
  // moving the value onto the task.
  if (category) parts.push(`Mail category: ${category}`);

  const snippet = mail.snippet?.trim();
  if (snippet) parts.push(`Snippet:\n${snippet}`);

  const reply = mail.suggested_reply?.trim();
  if (reply) parts.push(`Suggested reply:\n${reply}`);

  return parts.length ? parts.join("\n\n") : null;
}

/**
 * The whole mapping, in one place.
 *
 * What is deliberately NOT written, and why:
 *
 * - `category` — the discriminator. See `mailNotes`. A converted mail is a
 *   plain task, which means `category` stays NULL so the generated `task_type`
 *   is `'task'` and the trigger materialises its planning row.
 * - `score` — not a task field. See `ConvertibleMail`.
 * - `stage` — `pf_task_planning.stage` already defaults to `'refine'`, and
 *   `'refine'` *is* the draft state this feature is asked for. Setting it
 *   explicitly would only be a second place to keep in step with the default.
 *   `'active'` is not reachable from here at all: `setTaskStage` refuses it
 *   without calendar minutes behind the task, and that gate exists nowhere else.
 * - `aggregate_estimate` — trigger-maintained. `time_estimate` is what a task
 *   claims for itself and is the only one of the pair anyone may write.
 */
export function mailToTaskPayload(mail: ConvertibleMail): MailTaskPayload {
  const payload: MailTaskPayload = {
    title: mail.subject?.trim() || NO_SUBJECT_TITLE,
  };

  const importance = axis<Priority>(mail.importance);
  if (importance) payload.priority = importance;

  const urgency = axis<Urgency>(mail.urgency);
  if (urgency) payload.urgency = urgency;

  const due = isoDate(mail.due_date);
  if (due) payload.due_date = due;

  const estimate = minutes(mail.time_estimate);
  if (estimate != null) payload.time_estimate = estimate;

  const notes = mailNotes(mail);
  if (notes) payload.notes = notes;

  return payload;
}
