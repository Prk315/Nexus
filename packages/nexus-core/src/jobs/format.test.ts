import { describe, expect, it } from "vitest";
import {
  addChip,
  ago,
  attemptLine,
  attemptOutcome,
  chipsEqual,
  clampPayMax,
  clampPayMin,
  clampThreshold,
  firstLinkUrl,
  formatPayRange,
  isResponseStatus,
  jobsBadgeCount,
  MAX_CV_SCAN,
  parsePayBound,
  pickCvUrl,
  proofMessageId,
  removeChip,
  shortId,
} from "./format";
import type { JobAppModule, JobProfileFull, JobSubmissionAttempt } from "./types";

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

describe("formatPayRange", () => {
  it("renders both halves joined by ' · ' — the notify.js formatPayLine shape", () => {
    expect(
      formatPayRange({
        expected_monthly_min: 42000,
        expected_monthly_max: 50000,
        expected_hourly_min: 230,
        expected_hourly_max: 270,
      }),
    ).toBe("42–50k kr/md · 230–270 kr/t");
  });

  it("renders only the half that has anything stated", () => {
    expect(formatPayRange({ expected_monthly_min: 42000, expected_monthly_max: 50000 })).toBe(
      "42–50k kr/md",
    );
    expect(formatPayRange({ expected_hourly_min: 230, expected_hourly_max: 270 })).toBe(
      "230–270 kr/t",
    );
  });

  it("renders an open-ended bound as at-least / up-to, not a dangling range", () => {
    expect(formatPayRange({ expected_monthly_min: 42000 })).toBe("42k+ kr/md");
    expect(formatPayRange({ expected_hourly_max: 270 })).toBe("op til 270 kr/t");
  });

  it("keeps one decimal for a non-round thousand rather than truncating", () => {
    expect(formatPayRange({ expected_monthly_min: 42500 })).toBe("42.5k+ kr/md");
  });

  it("is null, never a bare label, for nothing stated", () => {
    expect(formatPayRange({})).toBe(null);
    expect(formatPayRange(null)).toBe(null);
    expect(formatPayRange(undefined)).toBe(null);
    expect(
      formatPayRange({
        expected_monthly_min: null,
        expected_monthly_max: null,
        expected_hourly_min: null,
        expected_hourly_max: null,
      }),
    ).toBe(null);
  });

  it("treats a non-finite or non-numeric bound as absent, not as NaN", () => {
    expect(
      formatPayRange({
        expected_monthly_min: Number.NaN,
        expected_monthly_max: "50000" as unknown as number,
        expected_hourly_min: 230,
        expected_hourly_max: 270,
      }),
    ).toBe("230–270 kr/t");
  });

  it("accepts a whole JobProfileFull row directly, extra fields and all", () => {
    // The real call site: JobsPanel passes a snapshot.profiles row straight
    // through rather than remapping four fields onto a smaller shape first.
    const profile: JobProfileFull = {
      id: "p1",
      name: "AI Engineering",
      enabled: true,
      sort: 0,
      keywords: ["python"],
      approval_threshold: 75,
      exclude_terms: [],
      locations: [],
      expected_monthly_min: 42000,
      expected_monthly_max: 50000,
      expected_hourly_min: null,
      expected_hourly_max: null,
    };
    expect(formatPayRange(profile)).toBe("42–50k kr/md");
  });
});

describe("parsePayBound", () => {
  it("parses a plain number or numeric string", () => {
    expect(parsePayBound(42000)).toBe(42000);
    expect(parsePayBound("42000")).toBe(42000);
  });

  it("rounds to an integer — the column is integer DKK", () => {
    expect(parsePayBound(42000.6)).toBe(42001);
  });

  it("is null for empty, half-typed, or negative input — never a floored zero", () => {
    // Unlike clampThreshold, a negative salary is not "held-down arrow key" —
    // it is a typo worth refusing rather than silently flooring to 0.
    expect(parsePayBound("")).toBe(null);
    expect(parsePayBound("   ")).toBe(null);
    expect(parsePayBound("-")).toBe(null);
    expect(parsePayBound(-500)).toBe(null);
    expect(parsePayBound(null)).toBe(null);
    expect(parsePayBound(undefined)).toBe(null);
    expect(parsePayBound(Number.NaN)).toBe(null);
  });

  it("accepts zero", () => {
    expect(parsePayBound(0)).toBe(0);
  });
});

describe("clampPayMin / clampPayMax", () => {
  it("leaves the pair alone when the edit does not cross the other bound", () => {
    expect(clampPayMin(42000, 50000)).toEqual({ min: 42000, max: 50000 });
    expect(clampPayMax(50000, 42000)).toEqual({ min: 42000, max: 50000 });
  });

  it("raises the max to meet a min edited above it — the edit just made wins", () => {
    expect(clampPayMin(60000, 50000)).toEqual({ min: 60000, max: 60000 });
  });

  it("drags the min down to meet a max edited below it", () => {
    expect(clampPayMax(30000, 42000)).toEqual({ min: 30000, max: 30000 });
  });

  it("does not touch the other side when it is null — the CHECK only fires when both are present", () => {
    expect(clampPayMin(60000, null)).toEqual({ min: 60000, max: null });
    expect(clampPayMax(30000, null)).toEqual({ min: null, max: 30000 });
  });

  it("clearing a bound (null) never invents a value on the other side", () => {
    expect(clampPayMin(null, 50000)).toEqual({ min: null, max: 50000 });
    expect(clampPayMax(null, 42000)).toEqual({ min: 42000, max: null });
  });

  it("always returns both halves, so the caller can send one atomic patch", () => {
    const result = clampPayMin(42000, 50000);
    expect(result).toHaveProperty("min");
    expect(result).toHaveProperty("max");
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

// `firstLinkUrl` and `pickCvUrl` are a deliberate, faithful mirror of
// `supabase/functions/job-ingest/logic.ts`'s `extractFirstUrl` and
// `cvUrlFromModules` — see the "CANONICAL SOURCE" banner in format.ts. Every
// case below is ported from that file's `logic.test.ts` (same describe-block
// order, same fixture strings — including the REAL seeded module content,
// `CV_CONTENT` below) precisely so the two cannot silently drift apart: a
// change to the canonical rule that is not ported here fails a test in THIS
// file, not just a visual check of the panel.

const CV_CONTENT = "My CV is at prk315.github.io/personal-website/cv.pdf.";

describe("firstLinkUrl", () => {
  it("finds a bare host/path URL in ordinary prose", () => {
    // The real module content. No scheme, no `www.`, a comma glued to the end.
    expect(
      firstLinkUrl(
        "My CV is at prk315.github.io/personal-website/cv.pdf, and I'm happy to send " +
          "it in whatever format suits your process.",
      ),
    ).toBe("https://prk315.github.io/personal-website/cv.pdf");
  });

  it("does not mistake sentence punctuation for a host", () => {
    // The reason a bare candidate must carry a path: 'process.' and 'e.g.' are
    // host-shaped, and a link to https://process/ helps nobody.
    expect(firstLinkUrl("Send it in whatever format suits your process.")).toBe(null);
    expect(firstLinkUrl("Available on request, e.g. as a PDF.")).toBe(null);
    expect(firstLinkUrl("I finished my B.Sc. in 2026.")).toBe(null);
  });

  it("upgrades http to https and accepts www", () => {
    // This string is pasted into a stranger's form as a link about the
    // candidate. Plaintext is the worse default even when the server redirects.
    expect(firstLinkUrl("CV: http://example.com/cv.pdf")).toBe("https://example.com/cv.pdf");
    expect(firstLinkUrl("CV: www.example.com/cv.pdf")).toBe("https://www.example.com/cv.pdf");
    expect(firstLinkUrl("CV: https://example.com/cv.pdf")).toBe("https://example.com/cv.pdf");
  });

  it("takes the FIRST url and strips trailing punctuation and brackets", () => {
    expect(firstLinkUrl("See (example.com/first.pdf) or example.com/second.pdf.")).toBe(
      "https://example.com/first.pdf",
    );
  });

  it("returns null rather than a half-parsed link", () => {
    // A link that goes nowhere is worse than no link: the human clicks it,
    // gets nothing, and cannot tell whether the CV or the pipeline is broken.
    for (const bad of [null, undefined, 42, "", "   ", "no link here", "ftp://example.com/cv"]) {
      expect(firstLinkUrl(bad as unknown as string)).toBe(null);
    }
  });

  it("is bounded — a runaway string cannot be scanned or returned whole", () => {
    const buried = `${"word ".repeat(MAX_CV_SCAN)}example.com/cv.pdf`;
    expect(firstLinkUrl(buried)).toBe(null);
    expect(firstLinkUrl(`https://example.com/${"x".repeat(4000)}`)).toBe(null);
  });

  it("normalizes through the same rules as every other URL here", () => {
    // canonicalizeUrl: tracking params stripped, fragment dropped.
    expect(firstLinkUrl("https://example.com/cv.pdf?utm_source=mail#page=2")).toBe(
      "https://example.com/cv.pdf",
    );
  });
});

describe("pickCvUrl", () => {
  function module(over: Partial<JobAppModule>): JobAppModule {
    return {
      id: "m1",
      name: "cv",
      slot: "cv_link",
      tags: [],
      lang: "en",
      content: CV_CONTENT,
      enabled: true,
      sort: 0,
      updated_at: "2026-09-01T00:00:00Z",
      ...over,
    };
  }

  it("yields the CV link as a bare URL for the ATS forms — the real seeded content", () => {
    expect(pickCvUrl([module({})])).toBe("https://prk315.github.io/personal-website/cv.pdf");
  });

  it("ignores modules in other slots", () => {
    expect(pickCvUrl([module({ slot: "intro", content: "https://wrong.dev/x" })])).toBe(null);
  });

  it("skips a disabled cv_link module — a turned-off CV must not surface anyway", () => {
    expect(pickCvUrl([module({ enabled: false })])).toBe(null);
  });

  it("refuses an enabled cv_link module that is still a [TODO stub", () => {
    // Enabled-but-stubbed is a real state: the seeded module ships as a stub,
    // and nothing stops someone enabling it before filling it in. Same
    // predicate the send gate uses — a [TODO stub must not read as usable here
    // either, even if it happens to contain something URL-shaped.
    expect(
      pickCvUrl([module({ content: "CV: [TODO https://example.com/cv.pdf]" })]),
    ).toBe(null);
  });

  it("picks the lowest (sort, name, id) among several enabled cv_link modules — same tie-break as the assembler", () => {
    const url = pickCvUrl([
      module({ id: "z", name: "old", sort: 1, content: "old.dev/cv.pdf" }),
      module({ id: "a", name: "new", sort: 0, content: "new.dev/cv.pdf" }),
    ]);
    expect(url).toBe("https://new.dev/cv.pdf");
  });

  it("falls through to the next candidate when the top-ranked module has no usable URL", () => {
    const url = pickCvUrl([
      module({ id: "cvA", sort: 10, content: "I will send my CV on request." }),
      module({ id: "cvB", sort: 20, content: "CV: example.com/me.pdf" }),
    ]);
    expect(url).toBe("https://example.com/me.pdf");
  });

  it("is null for an empty, missing, or slotless catalog", () => {
    expect(pickCvUrl([])).toBe(null);
    expect(pickCvUrl(null)).toBe(null);
    expect(pickCvUrl(undefined)).toBe(null);
    expect(pickCvUrl([module({ slot: "" })])).toBe(null);
  });

  it("slot comparison is case-insensitive", () => {
    expect(pickCvUrl([module({ slot: "CV_Link" })])).toBe(
      "https://prk315.github.io/personal-website/cv.pdf",
    );
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
