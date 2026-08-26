import { describe, it, expect } from "vitest";
import {
  mailToTaskPayload, mailNotes, NO_SUBJECT_TITLE, type ConvertibleMail,
} from "./mailConvert";
import { convertMailToTask, type MailConvertIO } from "./api/mail";
import type { Task } from "../types";

const mail = (o: Partial<ConvertibleMail> = {}): ConvertibleMail => ({
  id: "m1", sender: "alice@example.com", subject: "Invoice overdue",
  snippet: "The March invoice is still unpaid.",
  importance: "high", urgency: "medium", due_date: "2026-08-28",
  time_estimate: 15, category: "Work", suggested_reply: "Paying it today.",
  ...o,
});

/** A payload as a bag of keys, so a test can assert a key is ABSENT. */
const keys = (m: ConvertibleMail) => mailToTaskPayload(m) as Record<string, unknown>;

// ═══════════════════════════════════════════════════════════════════════════
// The mapping
// ═══════════════════════════════════════════════════════════════════════════

describe("mailToTaskPayload — the axes", () => {
  it("copies importance and urgency onto their respective relations' columns", () => {
    // Same domain on both sides, so this is a copy — but see the next two
    // tests for why it is not written as one.
    expect(mailToTaskPayload(mail())).toMatchObject({
      priority: "high", urgency: "medium",
    });
  });

  it("rejects an importance outside the Priority union instead of writing it", () => {
    // pf_tasks.priority has NO CHECK constraint in the database. An 'urgent'
    // here would be accepted, stored, and then fail to place on the matrix pad
    // — a silent write that produces an unrenderable task. The TS union is the
    // only contract there is, so it is enforced here.
    expect("priority" in keys(mail({ importance: "urgent" }))).toBe(false);
    expect("priority" in keys(mail({ importance: "HIGH" }))).toBe(false);
    expect("priority" in keys(mail({ importance: "" }))).toBe(false);
  });

  it("rejects a bad urgency too, rather than letting the database do it", () => {
    // pf_task_planning.urgency IS checked, so this one would fail loudly — but
    // relying on another table's constraint for our own correctness is the
    // coupling that stops holding the moment someone widens the vocabulary.
    expect("urgency" in keys(mail({ urgency: "critical" }))).toBe(false);
  });

  it("omits an undecided axis rather than writing 'medium' explicitly", () => {
    // NULL means the verdict was never made. That is a different fact from a
    // verdict of 'medium', and the column default is how the distinction stays
    // visible: nothing in pf_tasks claims a decision that never happened.
    const k = keys(mail({ importance: null, urgency: null }));
    expect("priority" in k).toBe(false);
    expect("urgency" in k).toBe(false);
  });

  it("sets keys to absent, never to undefined", () => {
    // splitPatch walks Object.entries, so a present-but-undefined planning key
    // survives the split and ends as .update({ urgency: undefined }) — an empty
    // PATCH body.
    const payload = mailToTaskPayload(mail({ importance: null, urgency: null }));
    expect(Object.keys(payload)).toEqual(["title", "time_estimate", "notes"]);
  });
});

describe("mailToTaskPayload — the deadline is never written as a deadline", () => {
  // The model gets roughly one extracted deadline in three right, measured with
  // the arrival date supplied. `mail_messages.due_date` tolerates that because
  // nothing acts on it. `pf_tasks.due_date` is what Dashboard sorts on and what
  // daily.ts compares against today, so a guess there is indistinguishable from
  // a deadline the owner set — and only discovered by missing it.

  it("never puts due_date on the task, even for a perfectly valid date", () => {
    expect("due_date" in keys(mail())).toBe(false);
    expect("due_date" in keys(mail({ due_date: "2028-02-29" }))).toBe(false);
  });

  it("carries a valid date into notes, labelled unconfirmed", () => {
    expect(mailToTaskPayload(mail()).notes).toContain(
      "Suggested deadline (unconfirmed): 2026-08-28",
    );
    // A genuine leap day is still a real date and must survive.
    expect(mailToTaskPayload(mail({ due_date: "2028-02-29" })).notes).toContain(
      "Suggested deadline (unconfirmed): 2028-02-29",
    );
  });

  it("drops a non-ISO date rather than repeating it in prose", () => {
    // Validation still applies on the way into the note: 'next Friday' in a
    // note headed "Suggested deadline" is its own small lie, and the reader
    // cannot tell it was never a date.
    for (const bad of ["next Friday", "28/08/2026", "2026-08-28T09:00:00Z"]) {
      expect(mailToTaskPayload(mail({ due_date: bad })).notes ?? "").not.toContain(
        "Suggested deadline",
      );
    }
  });

  it("drops a well-shaped date that does not exist", () => {
    // '2026-02-30' passes the pattern and V8 silently rolls it to March 3rd.
    for (const bad of ["2026-02-30", "2026-13-01"]) {
      expect(mailToTaskPayload(mail({ due_date: bad })).notes ?? "").not.toContain(
        "Suggested deadline",
      );
    }
  });

  it("carries a whole number of minutes", () => {
    expect(mailToTaskPayload(mail({ time_estimate: 0 })).time_estimate).toBe(0);
    expect(mailToTaskPayload(mail({ time_estimate: 90 })).time_estimate).toBe(90);
  });

  it("refuses a fractional or negative estimate", () => {
    // pf_tasks.time_estimate is integer, so a float truncates server-side
    // without comment; a negative one propagates up the whole ancestor chain
    // through the aggregate_estimate trigger.
    expect("time_estimate" in keys(mail({ time_estimate: 12.5 }))).toBe(false);
    expect("time_estimate" in keys(mail({ time_estimate: -5 }))).toBe(false);
  });

  it("never writes aggregate_estimate — it is trigger-maintained", () => {
    expect("aggregate_estimate" in keys(mail())).toBe(false);
  });
});

describe("mailToTaskPayload — what must never be written", () => {
  it("never writes pf_tasks.category — that is the ISA discriminator", () => {
    // task_type is generated as coalesce(category, 'task') and category is
    // CHECK-ed to ('reminder','chore','shopping'). 'Work' fails that check
    // outright; a category reading 'reminder' would pass it, re-type the task,
    // and make the sync trigger DELETE the planning row the notes live in.
    const k = keys(mail({ category: "Newsletter" }));
    expect("category" in k).toBe(false);
    expect(k.notes).toContain("Mail category: Newsletter");
  });

  it("never maps score — it is the model's evidence, not a third axis", () => {
    const withScore = { ...mail(), score: 93 } as ConvertibleMail;
    expect("score" in keys(withScore)).toBe(false);
    // And it must not be smuggled in as an axis either.
    expect(mailToTaskPayload(withScore).priority).toBe("high"); // from importance
  });

  it("never sets a stage — 'refine' is the default and IS the draft state", () => {
    // 'active' is unreachable from here by design: setTaskStage refuses it
    // without calendar minutes behind the task, and that gate lives nowhere
    // else.
    expect("stage" in keys(mail())).toBe(false);
  });
});

describe("mailToTaskPayload — title", () => {
  it("uses the subject", () => {
    expect(mailToTaskPayload(mail({ subject: "  Renew lease \n" })).title).toBe("Renew lease");
  });

  it("falls back to a placeholder — pf_tasks.title is not nullable", () => {
    expect(mailToTaskPayload(mail({ subject: null })).title).toBe(NO_SUBJECT_TITLE);
    expect(mailToTaskPayload(mail({ subject: "   " })).title).toBe(NO_SUBJECT_TITLE);
  });
});

describe("mailNotes", () => {
  it("keeps the sender, the snippet and the suggested reply", () => {
    const notes = mailNotes(mail())!;
    expect(notes).toContain("From: alice@example.com");
    expect(notes).toContain("The March invoice is still unpaid.");
    expect(notes).toContain("Paying it today.");
  });

  it("drops blank sections instead of emitting empty headings", () => {
    const notes = mailNotes(mail({
      snippet: null, suggested_reply: "  ", category: null, due_date: null,
    }))!;
    expect(notes).toBe("From: alice@example.com");
  });

  it("returns null when there is nothing to say", () => {
    expect(mailNotes(mail({
      sender: "", snippet: null, suggested_reply: null, category: null, due_date: null,
    }))).toBeNull();
  });

  it("omits the deadline line when the model gave no date", () => {
    // The absent case has to stay silent: a heading reading "Suggested
    // deadline: none" is a claim about the mail that nobody made.
    const notes = mailNotes(mail({
      snippet: null, suggested_reply: null, category: null, due_date: null,
    }))!;
    expect(notes).not.toContain("Suggested deadline");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// The conversion
// ═══════════════════════════════════════════════════════════════════════════

const task = (id: number): Task => ({
  id, plan_id: null, parent_id: null, goal_id: null, task_type: "task",
  title: "t", done: false, sort_order: 0, priority: "medium", due_date: null,
  created_at: "", time_estimate: null, aggregate_estimate: 0,
  kanban_status: "backlog", category: null, planning: null,
  team_id: null, assigned_to: null,
});

/**
 * A fake `mail_messages` row plus a task store, wired as `MailConvertIO`.
 *
 * `linkMail` reproduces the `.is("task_id", null)` guard rather than stubbing a
 * return value, so the race tests exercise the same rule the database does.
 */
function io(over: Partial<MailConvertIO> = {}, initial: { exists?: boolean; link?: number | null } = {}) {
  // `row` is mutable and shared with the overrides below, so a test can have
  // the database change under the conversion — another click landing, or the
  // mail being deleted — which is the only way to reach the reconciliation
  // paths honestly. A frozen fixture can only ever test the happy path.
  const row: { exists: boolean; link: number | null } = {
    exists: initial.exists ?? true,
    link: initial.link ?? null,
  };
  let nextId = 100;
  const created: unknown[] = [];
  const deleted: number[] = [];

  const base: MailConvertIO = {
    readLink: async () => ({ exists: row.exists, taskId: row.link }),
    linkMail: async (_id, taskId) => {
      if (!row.exists || row.link != null) return 0;
      row.link = taskId;
      return 1;
    },
    createTask: (async (payload: unknown) => {
      created.push(payload);
      return task(nextId++);
    }) as MailConvertIO["createTask"],
    getTask: (async (id: number) => task(id)) as MailConvertIO["getTask"],
    deleteTask: (async (id: number) => { deleted.push(id); }) as MailConvertIO["deleteTask"],
  };

  return { io: { ...base, ...over }, row, created, deleted, linkOf: () => row.link };
}

describe("convertMailToTask", () => {
  it("creates a task and links the mail back to it", async () => {
    const h = io();
    const out = await convertMailToTask(mail(), h.io);
    expect(out.id).toBe(100);
    expect(h.linkOf()).toBe(100);
    expect(h.created).toEqual([mailToTaskPayload(mail())]);
  });

  it("re-converting returns the existing task and creates nothing", async () => {
    // The whole point of the back-link. Without it, every reload of the header
    // dropdown is a fresh chance to duplicate the task.
    const h = io({}, { link: 42 });
    const out = await convertMailToTask(mail(), h.io);
    expect(out.id).toBe(42);
    expect(h.created).toHaveLength(0);
  });

  it("reads the link from the database, not from the row it was handed", async () => {
    // task_id is ON DELETE SET NULL, so a mail converted an hour ago may be
    // unconverted now — and vice versa. A cached row cannot be trusted either
    // way, which is why ConvertibleMail has no task_id field at all.
    const h = io({}, { link: 42 });
    const stale = { ...mail(), task_id: null } as ConvertibleMail;
    expect((await convertMailToTask(stale, h.io)).id).toBe(42);
    expect(h.created).toHaveLength(0);
  });

  it("creates nothing when the mail row is not visible", async () => {
    // RLS renders an unowned row as "no rows, no error". Creating first and
    // discovering that afterwards would leave an orphan task behind every time.
    const h = io({}, { exists: false });
    await expect(convertMailToTask(mail(), h.io)).rejects.toThrow(/no longer available/);
    expect(h.created).toHaveLength(0);
  });

  it("succeeds when the link committed but the response was lost", async () => {
    // The classic distributed-write bug: report failure, invite a retry, and
    // the retry duplicates. Only a re-read can tell a lost ack from a lost
    // write, so every non-success goes through one.
    const h = io();
    h.io.linkMail = async (_id, taskId) => { h.row.link = taskId; throw new Error("timeout"); };
    const out = await convertMailToTask(mail(), h.io);
    expect(out.id).toBe(100);
    expect(h.deleted).toEqual([]);
  });

  it("discards its own duplicate when it loses a race", async () => {
    const h = io();
    h.io.linkMail = async () => { h.row.link = 7; return 0; };   // someone else got there
    const out = await convertMailToTask(mail(), h.io);
    expect(out.id).toBe(7);
    expect(h.deleted).toEqual([100]);
  });

  it("fetches the winner before deleting its own duplicate", async () => {
    // Ordering, not politeness: deleting first and then failing to fetch would
    // leave the user with neither their task nor the winner's.
    const h = io();
    h.io.linkMail = async () => { h.row.link = 7; return 0; };
    h.io.getTask = (async () => { throw new Error("winner unreadable"); }) as MailConvertIO["getTask"];
    await expect(convertMailToTask(mail(), h.io)).rejects.toThrow(/winner unreadable/);
    expect(h.deleted).toEqual([]);
  });

  it("still returns the winner's task if cleaning up the duplicate fails", async () => {
    // A failed cleanup leaves a stray draft task — strictly better than
    // surfacing a cleanup error in place of the task the user asked for.
    const h = io({
      deleteTask: (async () => { throw new Error("network"); }) as MailConvertIO["deleteTask"],
    });
    h.io.linkMail = async () => { h.row.link = 7; return 0; };
    await expect(convertMailToTask(mail(), h.io)).resolves.toMatchObject({ id: 7 });
  });

  it("does not warn about duplicates when the mail was deleted mid-conversion", async () => {
    // A deleted row also reads back as taskId: null. Checking `exists` first is
    // what stops the user being told to beware of duplicating a mail that no
    // longer exists.
    const h = io();
    h.io.linkMail = async () => { h.row.exists = false; return 0; };
    const error: unknown = await convertMailToTask(mail(), h.io).then(() => null, (e) => e);
    expect((error as Error).message).toMatch(/disappeared/);
    expect((error as Error).message).not.toMatch(/duplicate/);
  });

  it("keeps the task and names it when the link genuinely did not happen", async () => {
    // Two writes, no transaction. The task is real and correct; only the
    // bookkeeping failed, and the user must be told a retry would duplicate.
    const h = io({ linkMail: async () => { throw new Error("boom"); } });
    await expect(convertMailToTask(mail(), h.io))
      .rejects.toThrow(/Created task #100.*duplicate/s);
    expect(h.deleted).toEqual([]);
  });

  it("surfaces why the link failed instead of swallowing it", async () => {
    // The likeliest cause by far is `task_id` not existing yet — the mail-bus
    // migration being unapplied fails every conversion identically. Losing the
    // underlying message turns a one-line fix into a debugging session.
    const h = io({
      linkMail: async () => {
        throw new Error(`column "task_id" of relation "mail_messages" does not exist`);
      },
    });
    await expect(convertMailToTask(mail(), h.io)).rejects.toThrow(/column "task_id"/);
  });

  it("does not create a task at all if the link cannot be read", async () => {
    const h = io({ readLink: async () => { throw new Error("denied"); } });
    await expect(convertMailToTask(mail(), h.io)).rejects.toThrow("denied");
    expect(h.created).toHaveLength(0);
  });

  it("rejects with Error objects, so a panel reading e.message gets a string", async () => {
    // nexus-core's MailPanel serves Vault and Protocol too and will reasonably
    // do `catch (e) { show(e.message) }`. The rest of api/ throws bare strings,
    // on which that renders the word "undefined".
    const h = io({}, { exists: false });
    await convertMailToTask(mail(), h.io).catch((e) => {
      expect(e).toBeInstanceOf(Error);
      expect(typeof e.message).toBe("string");
    });
    expect.assertions(2);
  });
});
