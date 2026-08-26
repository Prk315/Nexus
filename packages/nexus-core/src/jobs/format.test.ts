import { describe, expect, it } from "vitest";
import {
  addChip,
  ago,
  attemptLine,
  attemptOutcome,
  chipsEqual,
  clampThreshold,
  isResponseStatus,
  jobsBadgeCount,
  proofMessageId,
  removeChip,
  shortId,
} from "./format";
import type { JobSubmissionAttempt } from "./types";

// Same house rule as score.test.ts: every case here is a mistake that has been
// made in this codebase, or one the surrounding comments say would be silent.

const NOW = Date.parse("2026-08-26T12:00:00Z");

function attempt(over: Partial<JobSubmissionAttempt>): JobSubmissionAttempt {
  return {
    id: "at",
    application_id: "app",
    started_at: "2026-08-26T10:00:00Z",
    finished_at: null,
    ok: null,
    proof: null,
    error: null,
    created_at: "2026-08-26T10:00:00Z",
    ...over,
  };
}

describe("ago", () => {
  it("is empty, never a guess, for an unparseable or absent timestamp", () => {
    expect(ago(null, NOW)).toBe("");
    expect(ago(undefined, NOW)).toBe("");
    // `time_entries` holds two timestamp formats in one text column; a helper
    // that invented a date for the bad one would shift durations invisibly.
    expect(ago("Local::now() with no offset", NOW)).toBe("");
  });

  it("reads clock skew as 'just now' rather than as a negative age", () => {
    expect(ago("2026-08-26T12:05:00Z", NOW)).toBe("just now");
  });

  it("steps minutes → hours → days", () => {
    expect(ago("2026-08-26T11:30:00Z", NOW)).toBe("30m ago");
    expect(ago("2026-08-26T09:00:00Z", NOW)).toBe("3h ago");
    expect(ago("2026-08-24T12:00:00Z", NOW)).toBe("2d ago");
  });
});

describe("jobsBadgeCount", () => {
  it("adds replies to pending approvals — a reply is not a lesser event", () => {
    expect(jobsBadgeCount(3, 1)).toBe(4);
  });

  it("is null only when BOTH halves are unknown", () => {
    expect(jobsBadgeCount(null, null)).toBe(null);
    expect(jobsBadgeCount(undefined, undefined)).toBe(null);
  });

  it("does not suppress a known half because the other one failed", () => {
    // The failure mode this exists to prevent: one count erroring and the badge
    // going dark while three drafts sit waiting.
    expect(jobsBadgeCount(3, null)).toBe(3);
    expect(jobsBadgeCount(null, 2)).toBe(2);
  });

  it("never treats a failed count as a zero", () => {
    // `null` in means unknown; 0 in means counted-and-empty. They must not
    // produce the same output — the blocking_state seeding mistake again.
    expect(jobsBadgeCount(null, null)).not.toBe(0);
    expect(jobsBadgeCount(0, 0)).toBe(0);
  });

  it("survives a NaN count", () => {
    expect(jobsBadgeCount(Number.NaN, 2)).toBe(2);
  });
});

describe("isResponseStatus", () => {
  it("recognises only the reply status", () => {
    expect(isResponseStatus("response")).toBe(true);
    expect(isResponseStatus("submitted")).toBe(false);
    // Free-text column: an unknown value is not a reply, and must not throw.
    expect(isResponseStatus("something_the_pipeline_invented")).toBe(false);
    expect(isResponseStatus(null)).toBe(false);
  });
});

describe("clampThreshold", () => {
  it("clamps out-of-range numbers rather than rejecting them", () => {
    // Unlike normalizeScore: 999 from a model is corrupt, 999 from a held-down
    // arrow key is a person meaning 100.
    expect(clampThreshold(999)).toBe(100);
    expect(clampThreshold(-40)).toBe(0);
  });

  it("rounds to an integer", () => {
    expect(clampThreshold(74.6)).toBe(75);
    expect(clampThreshold("80.2")).toBe(80);
  });

  it("returns null for an empty or half-typed field, so the stored value survives", () => {
    // Writing 0 here would set the profile to "ask me about every posting" —
    // the loudest possible failure — because someone pressed backspace.
    expect(clampThreshold("")).toBe(null);
    expect(clampThreshold("   ")).toBe(null);
    expect(clampThreshold("-")).toBe(null);
    expect(clampThreshold("7e")).toBe(null);
    expect(clampThreshold(null)).toBe(null);
    expect(clampThreshold(undefined)).toBe(null);
    expect(clampThreshold(Number.NaN)).toBe(null);
    expect(clampThreshold(Number.POSITIVE_INFINITY)).toBe(null);
  });

  it("accepts the boundaries", () => {
    expect(clampThreshold(0)).toBe(0);
    expect(clampThreshold(100)).toBe(100);
  });
});

describe("addChip / removeChip", () => {
  it("preserves the typed casing — the gate lowercases both sides itself", () => {
    expect(addChip(["python"], "PyTorch")).toEqual(["python", "PyTorch"]);
    expect(addChip([], "C#")).toEqual(["C#"]);
  });

  it("de-duplicates case-insensitively", () => {
    expect(addChip(["Python"], "python")).toEqual(["Python"]);
  });

  it("ignores empty and whitespace-only input", () => {
    expect(addChip(["ai"], "")).toEqual(["ai"]);
    expect(addChip(["ai"], "   ")).toEqual(["ai"]);
  });

  it("trims what it does add", () => {
    expect(addChip([], "  unity  ")).toEqual(["unity"]);
  });

  it("removes case-insensitively, and removing something absent is a no-op", () => {
    expect(removeChip(["Python", "Go"], "python")).toEqual(["Go"]);
    expect(removeChip(["Python"], "rust")).toEqual(["Python"]);
  });

  it("drops blanks already sitting in a stored array", () => {
    expect(addChip(["ai", "", "  "], "ml")).toEqual(["ai", "ml"]);
  });

  it("returns a new array, never the caller's", () => {
    const list = ["ai"];
    expect(addChip(list, "")).not.toBe(list);
  });
});

describe("chipsEqual", () => {
  it("is the 'is this worth a write?' test", () => {
    // A no-op update still bumps updated_at and still costs a round trip on
    // every stray Enter.
    expect(chipsEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(chipsEqual(["a"], ["a", "b"])).toBe(false);
    expect(chipsEqual(["a", "b"], ["b", "a"])).toBe(false);
  });
});

describe("attemptOutcome", () => {
  it("keeps 'we never heard' distinct from 'we know it failed'", () => {
    // The migration makes `ok` nullable for exactly this reason: collapsing null
    // into false invents failures, collapsing it into true invents sent letters.
    expect(attemptOutcome(true)).toBe("ok");
    expect(attemptOutcome(false)).toBe("failed");
    expect(attemptOutcome(null)).toBe("pending");
    expect(attemptOutcome(undefined)).toBe("pending");
  });
});

describe("proofMessageId", () => {
  it("reads the Gmail message id out of jsonb", () => {
    expect(proofMessageId({ gmail_message_id: "18f2ab99c0" })).toBe("18f2ab99c0");
  });

  it("accepts the alternate spellings a workflow edit produces", () => {
    expect(proofMessageId({ message_id: "abc" })).toBe("abc");
    expect(proofMessageId({ messageId: "abc" })).toBe("abc");
  });

  it("never throws on whatever n8n actually wrote", () => {
    // `proof` is a record of what an external system said, not a relation this
    // code controls. A TypeError here takes out the whole attempt list.
    expect(proofMessageId(null)).toBe(null);
    expect(proofMessageId(undefined)).toBe(null);
    expect(proofMessageId("a bare string")).toBe(null);
    expect(proofMessageId([1, 2, 3])).toBe(null);
    expect(proofMessageId({ gmail_message_id: 42 })).toBe(null);
    expect(proofMessageId({ gmail_message_id: "   " })).toBe(null);
  });
});

describe("shortId", () => {
  it("head-truncates only when it needs to", () => {
    expect(shortId("18f2ab99c0")).toBe("18f2ab99c0");
    expect(shortId("18f2ab99c0deadbeef")).toBe("18f2ab99c0de…");
  });

  it("is null, not an empty chip, for a missing id", () => {
    expect(shortId(null)).toBe(null);
    expect(shortId("")).toBe(null);
    expect(shortId("   ")).toBe(null);
  });
});

describe("attemptLine", () => {
  it("renders a successful send with its proof", () => {
    const line = attemptLine(
      attempt({ ok: true, proof: { gmail_message_id: "18f2ab99c0deadbeef" } }),
      NOW,
    );
    expect(line.outcome).toBe("ok");
    expect(line.mark).toBe("✓");
    expect(line.when).toBe("2h ago");
    expect(line.proofId).toBe("18f2ab99c0de…");
    expect(line.error).toBe(null);
  });

  it("renders a failure with its reason", () => {
    const line = attemptLine(attempt({ ok: false, error: "  rate limited  " }), NOW);
    expect(line.outcome).toBe("failed");
    expect(line.mark).toBe("✗");
    expect(line.error).toBe("rate limited");
  });

  it("renders an attempt that never reported back as pending, not failed", () => {
    const line = attemptLine(attempt({ ok: null }), NOW);
    expect(line.outcome).toBe("pending");
    expect(line.mark).toBe("…");
    // No invented failure text for something that simply never answered.
    expect(line.error).toBe(null);
  });

  it("treats a blank error string as no error", () => {
    expect(attemptLine(attempt({ ok: false, error: "   " }), NOW).error).toBe(null);
  });

  it("falls back to created_at when started_at is unusable", () => {
    const line = attemptLine(
      attempt({ started_at: "not a date", created_at: "2026-08-26T09:00:00Z" }),
      NOW,
    );
    expect(line.when).toBe("3h ago");
  });
});
