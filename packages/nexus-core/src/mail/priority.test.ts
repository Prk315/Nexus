import { describe, expect, it } from "vitest";
import {
  BUCKET_LABEL,
  compareMail,
  groupByBucket,
  isHandled,
  normalizePriority,
  plainLine,
  plainText,
  priorityBucket,
  receivedAtMs,
  sortMail,
  triageInbox,
} from "./priority";
import type { MailMessage, MailStatus } from "./types";

function msg(over: Partial<MailMessage> & { id: string }): MailMessage {
  return {
    external_id: `ext-${over.id}`,
    thread_id: null,
    sender: "someone@example.com",
    subject: null,
    snippet: null,
    received_at: "2026-08-22T09:00:00Z",
    priority: null,
    category: null,
    suggested_reply: null,
    triaged_at: null,
    triage_model: null,
    status: "unread" as MailStatus,
    ...over,
  };
}

describe("normalizePriority", () => {
  it("passes the 0-100 range through", () => {
    expect(normalizePriority(0)).toBe(0);
    expect(normalizePriority(42)).toBe(42);
    expect(normalizePriority(100)).toBe(100);
  });

  it("clamps out-of-range scores rather than discarding the verdict", () => {
    // Mirrors clampPriority in the n8n-ingest function: a value that is present
    // but badly spelled is still a verdict.
    expect(normalizePriority(-20)).toBe(0);
    expect(normalizePriority(9001)).toBe(100);
  });

  it("rounds a float", () => {
    expect(normalizePriority(72.4)).toBe(72);
    expect(normalizePriority(72.6)).toBe(73);
  });

  it("keeps null as null — never coerced to a score", () => {
    // The whole contract: absent is not a verdict. Coercing to 0 would make
    // "not triaged yet" indistinguishable from "triaged, scored lowest".
    expect(normalizePriority(null)).toBeNull();
    expect(normalizePriority(undefined)).toBeNull();
    expect(normalizePriority(Number.NaN)).toBeNull();
    expect(normalizePriority(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("priorityBucket", () => {
  it("maps the scored range onto the four scored buckets", () => {
    expect(priorityBucket(100)).toBe("urgent");
    expect(priorityBucket(80)).toBe("urgent");
    expect(priorityBucket(79)).toBe("high");
    expect(priorityBucket(60)).toBe("high");
    expect(priorityBucket(59)).toBe("normal");
    expect(priorityBucket(30)).toBe("normal");
    expect(priorityBucket(29)).toBe("low");
    expect(priorityBucket(0)).toBe("low");
  });

  it("gives an unscored message its own bucket, distinct from low", () => {
    expect(priorityBucket(null)).toBe("untriaged");
    expect(priorityBucket(null)).not.toBe(priorityBucket(0));
  });

  it("has a label for every bucket it can return", () => {
    for (const p of [null, 0, 29, 30, 59, 60, 79, 80, 100, -5, 999]) {
      expect(BUCKET_LABEL[priorityBucket(p)]).toBeTruthy();
    }
  });
});

describe("isHandled", () => {
  it("recognises the two terminal statuses", () => {
    expect(isHandled("replied")).toBe(true);
    expect(isHandled("archived")).toBe(true);
    expect(isHandled("  Archived ")).toBe(true);
  });

  it("treats unread and read as still open — reading is not triaging", () => {
    expect(isHandled("unread")).toBe(false);
    expect(isHandled("read")).toBe(false);
  });

  it("treats a missing or unknown status as open", () => {
    // Fail toward showing mail if the CHECK vocabulary is ever widened.
    expect(isHandled(null)).toBe(false);
    expect(isHandled("")).toBe(false);
    expect(isHandled("snoozed")).toBe(false);
  });
});

describe("receivedAtMs", () => {
  it("parses an ISO timestamp", () => {
    expect(receivedAtMs(msg({ id: "a", received_at: "2026-08-21T10:00:00Z" }))).toBe(
      Date.parse("2026-08-21T10:00:00Z"),
    );
  });

  it("yields 0 for junk, so the row sorts last rather than becoming 'now'", () => {
    expect(receivedAtMs(msg({ id: "a", received_at: "not a date" }))).toBe(0);
  });
});

describe("sortMail", () => {
  const older = "2026-08-20T09:00:00Z";
  const newer = "2026-08-21T09:00:00Z";

  it("puts higher priority first", () => {
    const sorted = sortMail([
      msg({ id: "low", priority: 10 }),
      msg({ id: "urgent", priority: 95 }),
      msg({ id: "normal", priority: 45 }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["urgent", "normal", "low"]);
  });

  it("puts un-triaged mail above everything scored — nulls first", () => {
    // The contract, not a default: an unscored message is the one most likely
    // to need a human, so it must not sink below a scored-100 row.
    const sorted = sortMail([
      msg({ id: "urgent", priority: 100 }),
      msg({ id: "untriaged", priority: null }),
      msg({ id: "low", priority: 5 }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["untriaged", "urgent", "low"]);
  });

  it("orders two un-triaged messages by recency", () => {
    const sorted = sortMail([
      msg({ id: "old", priority: null, received_at: older }),
      msg({ id: "new", priority: null, received_at: newer }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("breaks a priority tie by recency, newest first", () => {
    const sorted = sortMail([
      msg({ id: "old", priority: 70, received_at: older }),
      msg({ id: "new", priority: 70, received_at: newer }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("is a total order, so equal rows never swap between renders", () => {
    const a = msg({ id: "aaa", priority: 70, received_at: newer });
    const b = msg({ id: "bbb", priority: 70, received_at: newer });
    expect(compareMail(a, b)).toBeLessThan(0);
    expect(compareMail(b, a)).toBeGreaterThan(0);
    expect(compareMail(a, a)).toBe(0);
    expect(sortMail([b, a]).map((m) => m.id)).toEqual(["aaa", "bbb"]);
  });

  it("is antisymmetric across the null boundary", () => {
    const untriaged = msg({ id: "u", priority: null });
    const scored = msg({ id: "s", priority: 100 });
    expect(compareMail(untriaged, scored)).toBeLessThan(0);
    expect(compareMail(scored, untriaged)).toBeGreaterThan(0);
  });

  it("does not mutate the input array", () => {
    const input = [msg({ id: "a", priority: 10 }), msg({ id: "b", priority: 90 })];
    const before = input.map((m) => m.id);
    sortMail(input);
    expect(input.map((m) => m.id)).toEqual(before);
  });
});

describe("triageInbox", () => {
  it("splits on status and sorts each side", () => {
    const t = triageInbox([
      msg({ id: "p-low", priority: 10 }),
      msg({ id: "h", priority: 99, status: "archived" }),
      msg({ id: "p-urgent", priority: 95 }),
      msg({ id: "r", priority: 50, status: "replied" }),
    ]);
    expect(t.pending.map((m) => m.id)).toEqual(["p-urgent", "p-low"]);
    expect(t.handled.map((m) => m.id)).toEqual(["h", "r"]);
    expect(t.total).toBe(4);
  });

  it("counts read mail as pending", () => {
    const t = triageInbox([msg({ id: "a", status: "read" })]);
    expect(t.pending).toHaveLength(1);
  });

  it("reports total as the window size, not a freshness signal", () => {
    // Zero rows means "never run" OR "clean" — MailSnapshot.lastSyncedAt is
    // what tells those apart, deliberately not this number.
    expect(triageInbox([]).total).toBe(0);
  });
});

describe("groupByBucket", () => {
  it("returns un-triaged first, then most urgent down, dropping empty buckets", () => {
    const groups = groupByBucket([
      msg({ id: "a", priority: 10 }),
      msg({ id: "b", priority: 95 }),
      msg({ id: "c", priority: 85 }),
      msg({ id: "d", priority: null }),
    ]);
    expect(groups.map((g) => g.bucket)).toEqual(["untriaged", "urgent", "low"]);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["d"]);
    expect(groups[0].label).toBe("Not yet triaged");
    expect(groups[1].messages.map((m) => m.id)).toEqual(["b", "c"]);
  });

  it("keeps every message exactly once", () => {
    const input = [0, 30, 60, 80, 100, null].map((p, i) => msg({ id: `m${i}`, priority: p }));
    const ids = groupByBucket(input).flatMap((g) => g.messages.map((m) => m.id));
    expect(ids.sort()).toEqual(input.map((m) => m.id).sort());
  });
});

describe("plainText", () => {
  it("strips control characters an LLM-relayed email could smuggle through", () => {
    expect(plainText("hi\u0007 there\u001b[31m")).toBe("hi there[31m");
    expect(plainText("tab\tsep")).toBe("tab sep");
    expect(plainText("del\u007fete")).toBe("delete");
  });

  it("strips zero-width and bidi format characters", () => {
    // An RLO in a subject is the classic "invoice<RLO>gnp.exe" spoof, and JS
    // `\s` never matches U+200B so the whitespace collapse cannot catch it.
    expect(plainText("invoice\u202Egnp.exe")).toBe("invoicegnp.exe");
    expect(plainText("in\u200Bvisible")).toBe("invisible");
  });

  it("keeps paragraph breaks but collapses runs of blank lines", () => {
    expect(plainText("a\n\n\n\n\nb")).toBe("a\n\nb");
    expect(plainText("a\r\nb")).toBe("a\nb");
  });

  it("collapses horizontal whitespace without eating the newlines", () => {
    expect(plainText("a   \t  b\nc")).toBe("a b\nc");
  });

  it("truncates with an ellipsis at the cap", () => {
    const out = plainText("x".repeat(50), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never cuts through an emoji and leaves a lone surrogate", () => {
    const out = plainText("😀".repeat(10), 6);
    expect(Array.from(out)).toHaveLength(6);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });

  it("never returns more than the cap, even at a cap of 0", () => {
    // maxLength - 1 would be a negative slice index and return the tail.
    expect(plainText("xxxxx", 0)).toBe("…");
    expect(plainText("xxxxx", 1)).toBe("…");
  });

  it("returns an empty string for null / undefined rather than 'null'", () => {
    expect(plainText(null)).toBe("");
    expect(plainText(undefined)).toBe("");
  });
});

describe("plainLine", () => {
  it("flattens newlines so a multi-line subject cannot break a row's layout", () => {
    expect(plainLine("subject\nwith\nlines")).toBe("subject with lines");
  });

  it("truncates long values", () => {
    const out = plainLine("y".repeat(500), 20);
    expect(out).toHaveLength(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("leaves a short value untouched", () => {
    expect(plainLine("Invoices", 20)).toBe("Invoices");
  });
});
