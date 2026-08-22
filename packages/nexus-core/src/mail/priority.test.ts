import { describe, expect, it } from "vitest";
import {
  BUCKET_LABEL,
  DEFAULT_PRIORITY,
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
import type { MailMessage } from "./types";

function msg(over: Partial<MailMessage> & { id: string }): MailMessage {
  return {
    external_id: null,
    sender: null,
    subject: null,
    snippet: null,
    received_at: null,
    priority: null,
    category: null,
    suggested_reply: null,
    status: null,
    ...over,
  };
}

describe("normalizePriority", () => {
  it("passes the in-range values through", () => {
    expect(normalizePriority(1)).toBe(1);
    expect(normalizePriority(5)).toBe(5);
  });

  it("clamps out-of-range integers instead of throwing or bucketing them oddly", () => {
    expect(normalizePriority(0)).toBe(1);
    expect(normalizePriority(-4)).toBe(1);
    expect(normalizePriority(9)).toBe(5);
  });

  it("rounds a float, because a model can emit 4.5 into an int column's payload", () => {
    expect(normalizePriority(4.5)).toBe(5);
    expect(normalizePriority(3.2)).toBe(3);
  });

  it("treats null / undefined / NaN as the middle of the scale, not the bottom", () => {
    // A row n8n failed to score is not evidence that it is unimportant.
    expect(normalizePriority(null)).toBe(DEFAULT_PRIORITY);
    expect(normalizePriority(undefined)).toBe(DEFAULT_PRIORITY);
    expect(normalizePriority(Number.NaN)).toBe(DEFAULT_PRIORITY);
    expect(DEFAULT_PRIORITY).toBe(3);
  });
});

describe("priorityBucket", () => {
  it("maps the whole scale", () => {
    expect(priorityBucket(5)).toBe("urgent");
    expect(priorityBucket(4)).toBe("high");
    expect(priorityBucket(3)).toBe("normal");
    expect(priorityBucket(2)).toBe("low");
    expect(priorityBucket(1)).toBe("low");
  });

  it("buckets an unranked message as normal", () => {
    expect(priorityBucket(null)).toBe("normal");
  });

  it("has a label for every bucket it can return", () => {
    for (const p of [null, 1, 2, 3, 4, 5, 99]) {
      expect(BUCKET_LABEL[priorityBucket(p)]).toBeTruthy();
    }
  });
});

describe("isHandled", () => {
  it("recognises the terminal statuses, case- and whitespace-insensitively", () => {
    expect(isHandled("archived")).toBe(true);
    expect(isHandled("  Replied ")).toBe(true);
    expect(isHandled("DONE")).toBe(true);
  });

  it("treats a missing or unknown status as still pending", () => {
    // Fail toward showing mail. Hiding a real message is the worse error.
    expect(isHandled(null)).toBe(false);
    expect(isHandled("")).toBe(false);
    expect(isHandled("needs_reply")).toBe(false);
    expect(isHandled("some_future_n8n_status")).toBe(false);
  });
});

describe("receivedAtMs", () => {
  it("parses an ISO timestamp", () => {
    expect(receivedAtMs(msg({ id: "a", received_at: "2026-08-21T10:00:00Z" }))).toBe(
      Date.parse("2026-08-21T10:00:00Z"),
    );
  });

  it("yields 0 for missing or junk, so the row sorts last rather than becoming 'now'", () => {
    expect(receivedAtMs(msg({ id: "a" }))).toBe(0);
    expect(receivedAtMs(msg({ id: "a", received_at: "not a date" }))).toBe(0);
  });
});

describe("sortMail", () => {
  const older = "2026-08-20T09:00:00Z";
  const newer = "2026-08-21T09:00:00Z";

  it("puts higher priority first", () => {
    const sorted = sortMail([
      msg({ id: "low", priority: 1 }),
      msg({ id: "urgent", priority: 5 }),
      msg({ id: "normal", priority: 3 }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["urgent", "normal", "low"]);
  });

  it("breaks a priority tie by recency, newest first", () => {
    const sorted = sortMail([
      msg({ id: "old", priority: 4, received_at: older }),
      msg({ id: "new", priority: 4, received_at: newer }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("is a total order, so equal rows never swap between renders", () => {
    const a = msg({ id: "aaa", priority: 4, received_at: newer });
    const b = msg({ id: "bbb", priority: 4, received_at: newer });
    expect(compareMail(a, b)).toBeLessThan(0);
    expect(compareMail(b, a)).toBeGreaterThan(0);
    expect(sortMail([b, a]).map((m) => m.id)).toEqual(["aaa", "bbb"]);
  });

  it("does not mutate the input array", () => {
    const input = [msg({ id: "a", priority: 1 }), msg({ id: "b", priority: 5 })];
    const before = input.map((m) => m.id);
    sortMail(input);
    expect(input.map((m) => m.id)).toEqual(before);
  });

  it("interleaves an unranked message at the 'normal' position, not at the end", () => {
    const sorted = sortMail([
      msg({ id: "unranked", priority: null }),
      msg({ id: "low", priority: 2 }),
      msg({ id: "high", priority: 4 }),
    ]);
    expect(sorted.map((m) => m.id)).toEqual(["high", "unranked", "low"]);
  });
});

describe("triageInbox", () => {
  it("distinguishes 'never synced' from 'synced and clear' via total", () => {
    // The whole reason total exists: these two must not render the same way.
    const neverSynced = triageInbox([]);
    expect(neverSynced.total).toBe(0);
    expect(neverSynced.pending).toEqual([]);

    const allHandled = triageInbox([
      msg({ id: "a", status: "archived" }),
      msg({ id: "b", status: "replied" }),
    ]);
    expect(allHandled.total).toBe(2);
    expect(allHandled.pending).toEqual([]);
    expect(allHandled.handled).toHaveLength(2);
  });

  it("splits and sorts each side", () => {
    const t = triageInbox([
      msg({ id: "p-low", priority: 1 }),
      msg({ id: "h", priority: 5, status: "done" }),
      msg({ id: "p-urgent", priority: 5 }),
    ]);
    expect(t.pending.map((m) => m.id)).toEqual(["p-urgent", "p-low"]);
    expect(t.handled.map((m) => m.id)).toEqual(["h"]);
    expect(t.total).toBe(3);
  });
});

describe("groupByBucket", () => {
  it("returns most-urgent-first and drops empty buckets", () => {
    const groups = groupByBucket([
      msg({ id: "a", priority: 1 }),
      msg({ id: "b", priority: 5 }),
      msg({ id: "c", priority: 5 }),
    ]);
    expect(groups.map((g) => g.bucket)).toEqual(["urgent", "low"]);
    expect(groups[0].messages.map((m) => m.id)).toEqual(["b", "c"]);
    expect(groups[0].label).toBe("Urgent");
  });

  it("keeps every message exactly once", () => {
    const input = [1, 2, 3, 4, 5, null].map((p, i) => msg({ id: `m${i}`, priority: p }));
    const groups = groupByBucket(input);
    const ids = groups.flatMap((g) => g.messages.map((m) => m.id));
    expect(ids.sort()).toEqual(input.map((m) => m.id).sort());
  });
});

describe("plainText", () => {
  it("strips control characters an LLM-relayed email could smuggle through", () => {
    expect(plainText("hi\u0007 there\u001b[31m")).toBe("hi there[31m");
    expect(plainText("tab\tsep")).toBe("tab sep");
    expect(plainText("del\u007fete")).toBe("delete");
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

  it("returns an empty string for null / undefined rather than 'null'", () => {
    expect(plainText(null)).toBe("");
    expect(plainText(undefined)).toBe("");
  });

  it("strips zero-width and bidi format characters", () => {
    // An RLO in a subject is the classic "invoice\u202Egnp.exe" spoof, and JS
    // `\s` never matches U+200B so the whitespace collapse cannot catch it.
    expect(plainText("invoice\u202Egnp.exe")).toBe("invoicegnp.exe");
    expect(plainText("in\u200Bvisible")).toBe("invisible");
  });

  it("never cuts through an emoji and leaves a lone surrogate", () => {
    const out = plainText("\uD83D\uDE00".repeat(10), 6);
    expect(Array.from(out)).toHaveLength(6);
    expect(out).toBe("\uD83D\uDE00\uD83D\uDE00\uD83D\uDE00\uD83D\uDE00\uD83D\uDE00\u2026");
    // A lone high surrogate would round-trip through encodeURI as a bad pair.
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
  });

  it("never returns more than the cap, even at a cap of 0", () => {
    // maxLength - 1 would be a negative slice index and return the tail.
    expect(plainText("xxxxx", 0)).toBe("\u2026");
    expect(plainText("xxxxx", 1)).toBe("\u2026");
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
