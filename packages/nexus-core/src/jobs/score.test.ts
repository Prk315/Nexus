import { describe, expect, it } from "vitest";
import {
  applicationGaps,
  compareMatches,
  hasGapMarker,
  moduleNeedsText,
  normalizeScore,
  scoreBand,
} from "./score";
import type { JobApplication, JobMatch } from "./types";

// Every case here is a mistake this codebase has actually made somewhere, not
// coverage for its own sake — same house rule as PathFinder's taskTree tests.

function match(over: Partial<JobMatch>): JobMatch {
  return {
    id: "m",
    posting_id: "p",
    profile_id: "f",
    gate_verdict: "pass",
    gate_reason: null,
    score: null,
    reasoning: null,
    matched_skills: [],
    missing_skills: [],
    evaluated_at: null,
    created_at: "2026-08-20T10:00:00Z",
    ...over,
  };
}

function app(over: Partial<JobApplication>): JobApplication {
  return {
    id: "a",
    posting_id: "p",
    profile_id: "f",
    body: "Dear hiring team,\n\nI build things.",
    module_ids: [],
    missing_slots: [],
    status: "needs_approval",
    approval_requested_at: "2026-08-25T09:00:00Z",
    approved_at: null,
    approved_via: null,
    queued_at: null,
    submitted_at: null,
    fail_reason: null,
    created_at: "2026-08-25T09:00:00Z",
    updated_at: "2026-08-25T09:00:00Z",
    ...over,
  };
}

describe("normalizeScore", () => {
  it("keeps null null — an unevaluated match is not a zero", () => {
    expect(normalizeScore(null)).toBeNull();
    expect(normalizeScore(undefined)).toBeNull();
  });

  it("keeps a real zero", () => {
    // 0 is a verdict the model can legitimately return; only null is 'unknown'.
    expect(normalizeScore(0)).toBe(0);
  });

  it("treats out-of-range as absent rather than clamping", () => {
    // A clamp would promote a corrupt 999 to a perfect 100 and float garbage to
    // the top of the review queue.
    expect(normalizeScore(999)).toBeNull();
    expect(normalizeScore(-5)).toBeNull();
    expect(normalizeScore(Number.NaN)).toBeNull();
  });
});

describe("scoreBand", () => {
  it("gives null its own band, not the bottom one", () => {
    expect(scoreBand(null)).toBe("pending");
    expect(scoreBand(0)).toBe("weak");
    // The whole point: 'not looked at' and 'looked at, poor fit' must not
    // collapse into the same visual.
    expect(scoreBand(null)).not.toBe(scoreBand(0));
  });

  it("bands on inclusive floors", () => {
    expect(scoreBand(85)).toBe("strong");
    expect(scoreBand(84)).toBe("good");
    expect(scoreBand(70)).toBe("good");
    expect(scoreBand(69)).toBe("fair");
    expect(scoreBand(50)).toBe("fair");
    expect(scoreBand(49)).toBe("weak");
  });
});

describe("hasGapMarker", () => {
  it("catches the assembler's marker with its slot name attached", () => {
    expect(hasGapMarker("…experience.\n\n[GAP: no module for 'project']\n\nRegards")).toBe(true);
  });

  it("catches a hand-left TODO stub in any casing", () => {
    expect(hasGapMarker("[todo write the closing]")).toBe(true);
    expect(hasGapMarker("[TODO]")).toBe(true);
  });

  it("does not fire on ordinary prose that merely mentions a gap", () => {
    expect(hasGapMarker("I closed a gap in the team's tooling.")).toBe(false);
  });
});

describe("applicationGaps", () => {
  it("blocks on a missing slot even when the body reads cleanly", () => {
    // A body hand-edited to remove the marker still has the recorded gap.
    const g = applicationGaps(app({ missing_slots: ["project"] }));
    expect(g.blocked).toBe(true);
    expect(g.slots).toEqual(["project"]);
    expect(g.markerInBody).toBe(false);
  });

  it("blocks on a marker even when no slot was recorded missing", () => {
    // A module whose own content holds a [TODO] stub produces this shape.
    const g = applicationGaps(app({ body: "Hi.\n\n[TODO: the Rust project]\n" }));
    expect(g.blocked).toBe(true);
    expect(g.slots).toEqual([]);
    expect(g.markerInBody).toBe(true);
  });

  it("blocks an empty or missing body", () => {
    // `body` is nullable because assembly can fail; nothing is not ready.
    expect(applicationGaps(app({ body: null })).blocked).toBe(true);
    expect(applicationGaps(app({ body: "   \n " })).blocked).toBe(true);
  });

  it("passes a complete draft", () => {
    expect(applicationGaps(app({})).blocked).toBe(false);
  });
});

describe("moduleNeedsText", () => {
  it("flags a stub and an empty module", () => {
    expect(moduleNeedsText({ enabled: true, content: "[TODO write this]" })).toBe(true);
    expect(moduleNeedsText({ enabled: true, content: "  " })).toBe(true);
  });

  it("does not flag a written module just because it is disabled", () => {
    // Disabled is a choice; a stub is unfinished work. Different signals.
    expect(moduleNeedsText({ enabled: false, content: "I shipped a Tauri app." })).toBe(false);
  });
});

describe("compareMatches", () => {
  it("sorts unevaluated matches FIRST, not last", () => {
    const scored = match({ id: "s", score: 92, evaluated_at: "2026-08-25T08:00:00Z" });
    const pending = match({ id: "p", score: null });
    expect([scored, pending].sort(compareMatches).map((m) => m.id)).toEqual(["p", "s"]);
  });

  it("sorts scored matches high to low", () => {
    const a = match({ id: "a", score: 40 });
    const b = match({ id: "b", score: 90 });
    expect([a, b].sort(compareMatches).map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("breaks ties on recency, falling back to created_at when unevaluated", () => {
    const older = match({ id: "old", score: 80, evaluated_at: "2026-08-20T10:00:00Z" });
    const newer = match({ id: "new", score: 80, evaluated_at: "2026-08-24T10:00:00Z" });
    expect([older, newer].sort(compareMatches).map((m) => m.id)).toEqual(["new", "old"]);
  });

  it("does not throw or reorder wildly on an unparseable timestamp", () => {
    const bad = match({ id: "bad", score: 50, evaluated_at: "not a date" });
    const good = match({ id: "good", score: 50, evaluated_at: "2026-08-24T10:00:00Z" });
    expect([bad, good].sort(compareMatches).map((m) => m.id)).toEqual(["good", "bad"]);
  });
});
