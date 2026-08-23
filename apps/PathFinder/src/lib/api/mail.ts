// Mail → task: the IO half. The mapping itself is in `../mailConvert`.
//
// `mail_messages` is owner-scoped with **no anon policy at all** (see
// `supabase/migrations/20260823120000_n8n_mail_bus.sql`), so every read here
// goes through the authenticated `supabase` client. `supabasePublic` — the
// anon-role client the productivity tables need — would return an **empty set,
// not an error**, and this function would then cheerfully create a second task
// for a mail that already has one. That is the failure mode CLAUDE.md documents
// three separate times; PathFinder only exports the authenticated client, and
// this file must keep it that way.
//
// ─── INVARIANT: only ever link a task this session just created ────────────
//
// `mail_messages.task_id` is FK'd to `pf_tasks(id)`, but a foreign key cannot
// see RLS, so it does NOT verify that the task belongs to the same person as
// the mail — the migration says so explicitly and hands that job here.
//
// This file has no ownership *check*; it has an ownership *invariant*, and the
// difference is what a future editor needs to know. The only id ever passed to
// `linkMail` is one `createTask` minted moments earlier under `getUserId()`, in
// the same session RLS already restricted the mail row to. Nothing is verified
// because, as written, nothing needs to be.
//
// **So the invariant is a constraint on future changes, not a property you can
// rely on continuing to hold.** Any new path that links an id from somewhere
// else — a "link to an existing task" affordance, a bulk importer, an id
// arriving from the panel — reintroduces exactly the hole the FK cannot close,
// and must verify ownership itself before writing.
//
// Reading back is different and is genuinely enforced: `getTask` on another
// user's task matches no rows under `pf_tasks`' own `auth.uid()` RLS and fails,
// rather than rendering a stranger's task in the panel. (Note that is real
// despite CLAUDE.md still describing every `pf_` table as permissive
// `USING (true)`; the docs are stale, PathFinder's auth is live.)
//
// The two tables also disagree about what a user is — `mail_messages.user_id`
// is `uuid`, `pf_tasks.user_id` is the legacy `text default 'default'`. Nothing
// here compares them, which is why nothing here needs a cast; `getUserId()`
// returns the uid as a string and `createTask` writes it into a text column.

import { supabase } from "./_shared";
import { createTask, deleteTask, getTask } from "./tasks";
import { mailToTaskPayload, type ConvertibleMail } from "../mailConvert";
import type { Task } from "../../types";

/** The table n8n writes and the header reads. */
const MAIL_TABLE = "mail_messages";

/**
 * Every rejection from this module is an `Error`, which is a deliberate
 * departure from `_shared`'s `err()` — that throws a bare string, and the rest
 * of `api/` follows it.
 *
 * The difference matters because of who catches this one. The rest of the data
 * layer is caught by PathFinder's own pages, which know the convention.
 * `convertMailToTask` is handed to `MailPanel` in nexus-core — a package that
 * also serves Vault and Protocol and will reasonably write
 * `catch (e) { show(e.message) }`, which on a string renders the word
 * `undefined`. Converting at this one boundary is cheaper than making every
 * consumer of a shared component defensive about our house style.
 *
 * TypeScript targets ES2020 here, so `Error.cause` is not available; the
 * underlying detail is folded into the message instead. Dropping it is not an
 * option — see `linkMail`.
 */
function fail(message: string, cause?: unknown): Error {
  const detail = describeCause(cause);
  return new Error(detail ? `${message} (${detail})` : message);
}

function describeCause(cause: unknown): string | null {
  if (cause == null) return null;
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  const message = (cause as { message?: unknown }).message;
  return typeof message === "string" ? message : String(cause);
}

/**
 * The state of one mail row's back-link.
 *
 * `exists` and `taskId` are separate because collapsing them costs a task. A
 * row that is gone — deleted, or invisible because the session does not own it
 * — comes back from PostgREST as **no rows, not an error**, which is
 * indistinguishable from "exists, not yet converted" if both are `null`. The
 * conversion would then create a task, fail to link it, and leave the orphan
 * behind. Knowing the row is absent lets it fail before writing anything.
 */
export type MailLinkState = { exists: boolean; taskId: number | null };

/**
 * The seam the tests drive.
 *
 * The interesting behaviour of `convertMailToTask` is not any single query, it
 * is the ordering: what happens when the link write loses a race, when it
 * commits but the response is lost, and when it fails outright after a task
 * already exists. Those are a few lines of decision wrapped in four
 * round-trips, and mocking a PostgREST builder chain to reach them tests the
 * mock. This interface is small enough to be obviously equivalent to the real
 * thing.
 */
export type MailConvertIO = {
  readLink: (mailId: string) => Promise<MailLinkState>;
  /** Writes the back-link only if it is still unset. Resolves to rows matched. */
  linkMail: (mailId: string, taskId: number) => Promise<number>;
  createTask: typeof createTask;
  getTask: typeof getTask;
  deleteTask: typeof deleteTask;
};

const liveIO: MailConvertIO = {
  readLink: async (mailId) => {
    // `maybeSingle`, not `single`: zero rows is a real answer here (see
    // MailLinkState), and `single` would turn it into an opaque PGRST116.
    const { data, error } = await supabase
      .from(MAIL_TABLE).select("task_id").eq("id", mailId).maybeSingle();
    if (error) throw fail("Could not read this mail.", error);
    if (!data) return { exists: false, taskId: null };
    return { exists: true, taskId: data.task_id != null ? Number(data.task_id) : null };
  },

  // `.is("task_id", null)` is the whole concurrency story. Two clicks on the
  // same message race four round-trips apart; without the guard the second one
  // overwrites the first one's link and orphans its task forever. With it, the
  // loser matches zero rows and can clean up after itself.
  linkMail: async (mailId, taskId) => {
    const { data, error } = await supabase
      .from(MAIL_TABLE)
      .update({ task_id: taskId })
      .eq("id", mailId)
      .is("task_id", null)
      .select("id");
    if (error) throw fail("Could not link the mail to its task.", error);
    return (data ?? []).length;
  },

  createTask,
  getTask,
  deleteTask,
};

/**
 * Converts a triaged mail into a draft PathFinder task, once.
 *
 * Returns the task either way: a mail that has already been converted resolves
 * to its existing task rather than making a second one. That idempotence is
 * what lets `MailPanel` render "already a task" instead of an ever-growing pile
 * of duplicates, and it is enforced by re-reading `mail_messages.task_id` here
 * rather than by anything the panel remembers.
 *
 * ─── The failure this cannot design away ───────────────────────────────────
 *
 * The task and the back-link are two writes across two tables with no
 * transaction between them, so after `createTask` succeeds there is a window in
 * which the outcome is genuinely unknown. Four different things are
 * indistinguishable at the call site — the update matched nothing, the update
 * errored, the update *committed and the response was lost*, or another click
 * got there first — and they want four different answers. Guessing from the
 * local result is what produces the two classic bugs: telling a user their
 * mail was not linked when it was (so the retry they are invited to make
 * duplicates it), and leaving an orphan task behind.
 *
 * So every non-success collapses into one reconciling re-read, and the database
 * decides:
 *
 * - the mail is **gone** → it was deleted mid-conversion. The task stays, but
 *   the "converting again will duplicate" warning would be nonsense: there is
 *   nothing left to convert again.
 * - links to **this** task → the write landed and only the acknowledgement was
 *   lost. Success.
 * - links to **another** task → lost the race. This task is a duplicate that
 *   never existed as far as the user is concerned, so it is deleted and the
 *   winner returned.
 * - links to **nothing** → the write really did not happen. It **keeps the
 *   task**: the user asked for a task, the task is real and correct, and the
 *   only thing that failed is bookkeeping they cannot see. The error names the
 *   task and warns that converting again will duplicate it, which is the one
 *   thing they cannot work out for themselves.
 */
export const convertMailToTask = async (
  mail: ConvertibleMail,
  io: MailConvertIO = liveIO,
): Promise<Task> => {
  const existing = await io.readLink(mail.id);
  // Bail before creating anything if the row is not there to be linked. RLS
  // makes an unowned row read as "no rows, no error", so without this a signed-
  // out-and-back-in session would silently manufacture orphan tasks.
  if (!existing.exists) {
    throw fail("That mail is no longer available — it may have been deleted, or you may need to sign in again.");
  }
  // Safe to trust the id without checking the task still exists: `task_id` is
  // FK'd ON DELETE SET NULL, so deleting the task un-links the mail and makes
  // it convertible again. A dangling id is not a state this table can be in.
  if (existing.taskId != null) return io.getTask(existing.taskId);

  const task = await io.createTask(mailToTaskPayload(mail));

  // A thrown link is not more informative than a zero match — both mean "the
  // local result does not tell us what the database did" — so they share the
  // reconciliation below rather than getting a shortcut that can be wrong.
  //
  // The reason it is *kept* rather than discarded: the reconciliation reports
  // "could not link" without ever saying why, and the most likely why by far is
  // a schema mismatch — `task_id` missing because the mail-bus migration has
  // not been applied yet, which fails every conversion identically. Losing that
  // string turns a one-line fix into a debugging session.
  let linkError: unknown = null;
  const matched = await io.linkMail(mail.id, task.id).catch((e) => {
    linkError = e;
    return 0;
  });
  if (matched > 0) return task;

  const after = await io.readLink(mail.id).catch(() => null);

  // Check `exists` before `taskId`: a deleted row also reports `taskId: null`,
  // and falling through would tell the user that converting again duplicates a
  // mail that is no longer there.
  if (after && !after.exists) {
    throw fail(
      `Created task #${task.id}, but the mail disappeared before it could be linked. ` +
      "The task is in your workspace.",
      linkError,
    );
  }

  if (after?.taskId === task.id) return task;

  if (after?.taskId != null) {
    // Fetch the winner BEFORE deleting ours. If the fetch fails, we still have
    // a task; deleting first would leave the user with neither their task nor
    // the winner's, which is the one outcome worse than a stray draft.
    const winner = await io.getTask(after.taskId);
    // Best effort: a failed cleanup leaves a stray draft task, strictly better
    // than surfacing a cleanup error in place of the task the user wanted.
    await io.deleteTask(task.id).catch(() => {});
    return winner;
  }

  throw fail(
    `Created task #${task.id}, but could not link the mail to it. ` +
    "The task is in your workspace; converting this mail again will create a duplicate.",
    linkError,
  );
};
