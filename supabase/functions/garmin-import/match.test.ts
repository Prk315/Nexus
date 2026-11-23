// Tests for garmin-import's plan-matching rule.
//
//   node --test supabase/functions/garmin-import/match.test.ts
//
// node:test + node:assert rather than the jsr:@std/assert the sibling
// functions use: Deno is not installed on this Mac, and Node 24 strips the
// types natively. `deno test` runs node:test suites too, so this stays
// runnable wherever the other function tests are.
//
// Imports ./match.ts, never ./index.ts — index.ts calls Deno.serve at module
// scope.

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  type ActivityIn,
  type Candidate,
  canClaim,
  claimableDates,
  isImportedRow,
  matchPlans,
  minutesOfDay,
  planImport,
} from "./match.ts";

const DAY = "2026-11-23";

function act(over: Partial<ActivityIn> & { externalId: string }): ActivityIn {
  return {
    kind: "workout",
    stableId: `stable-${over.externalId}`,
    date: DAY,
    startLocal: `${DAY} 18:00:00`,
    typeKey: "strength_training",
    ...over,
  };
}

function plan(id: string, start_time: string | null, created_at = "2026-11-20T10:00:00+00:00", over: Partial<Candidate> = {}): Candidate {
  return { id, date: DAY, start_time, created_at, notes: null, ...over };
}

describe("canClaim — which Garmin types may complete a plan", () => {
  it("strength completes a workout; a walk, ride or hike never does", () => {
    assert.equal(canClaim("workout", "strength_training"), true);
    assert.equal(canClaim("workout", "walking"), false);
    assert.equal(canClaim("workout", "cycling"), false);
    assert.equal(canClaim("workout", "hiking"), false);
    assert.equal(canClaim("workout", "yoga"), false);
  });

  it("running variants complete a run; a walk (which the bridge files as 'run') does not", () => {
    assert.equal(canClaim("run", "running"), true);
    assert.equal(canClaim("run", "trail_running"), true);
    assert.equal(canClaim("run", "treadmill_running"), true);
    assert.equal(canClaim("run", "walking"), false);
    assert.equal(canClaim("run", "casual_walking"), false);
  });

  it("no type_key (bridge older than this change) never claims", () => {
    assert.equal(canClaim("workout", null), false);
    assert.equal(canClaim("run", null), false);
  });
});

describe("walk vs strength, end to end", () => {
  it("a walk on leg day is inserted; the planned leg day stays untouched", () => {
    const walk = act({ externalId: "garmin:1", typeKey: "walking", startLocal: `${DAY} 17:55:00` });
    const d = planImport([walk], [], [plan("leg-day", "18:00:00")]);
    assert.deepEqual(d, [{ action: "upsert", id: "stable-garmin:1" }]);
  });

  it("the strength session that same day claims it", () => {
    const walk = act({ externalId: "garmin:1", typeKey: "walking", startLocal: `${DAY} 17:55:00` });
    const lift = act({ externalId: "garmin:2", typeKey: "strength_training", startLocal: `${DAY} 19:30:00` });
    const d = planImport([walk, lift], [], [plan("leg-day", "18:00:00")]);
    assert.deepEqual(d, [
      { action: "upsert", id: "stable-garmin:1" },
      { action: "claim", id: "leg-day" },
    ]);
  });
});

describe("choosing among candidates", () => {
  it("nearest start_time wins", () => {
    const a = act({ externalId: "garmin:1", startLocal: `${DAY} 17:40:00` });
    const d = planImport([a], [], [plan("morning", "07:00:00"), plan("evening", "18:00:00")]);
    assert.deepEqual(d, [{ action: "claim", id: "evening" }]);
  });

  it("a planned row with no start_time sorts after every timed one", () => {
    const a = act({ externalId: "garmin:1", startLocal: `${DAY} 06:00:00` });
    // The untimed plan is older, and would win on created_at — but a timed
    // plan 16 hours away still beats it.
    const d = planImport([a], [], [
      plan("untimed", null, "2026-01-01T00:00:00Z"),
      plan("late", "22:00:00", "2026-11-22T00:00:00Z"),
    ]);
    assert.deepEqual(d, [{ action: "claim", id: "late" }]);
  });

  it("an untimed plan is still claimed when it is the only one", () => {
    const a = act({ externalId: "garmin:1" });
    assert.deepEqual(planImport([a], [], [plan("untimed", null)]), [{ action: "claim", id: "untimed" }]);
  });

  it("ties (and all-untimed) go to the oldest created_at, compared as instants", () => {
    const a = act({ externalId: "garmin:1", startLocal: null });
    const d = planImport([a], [], [
      plan("newer", "18:00:00", "2026-11-21T10:00:00Z"),
      // Same instant spelled differently would compare wrong as a string;
      // this one is genuinely older.
      plan("older", "09:00:00", "2026-11-21T09:00:00+00:00"),
    ]);
    assert.deepEqual(d, [{ action: "claim", id: "older" }]);
  });

  it("equal distance either side → oldest created_at", () => {
    const a = act({ externalId: "garmin:1", startLocal: `${DAY} 12:00:00` });
    const d = planImport([a], [], [
      plan("b", "13:00:00", "2026-11-22T00:00:00Z"),
      plan("a", "11:00:00", "2026-11-21T00:00:00Z"),
    ]);
    assert.deepEqual(d, [{ action: "claim", id: "a" }]);
  });

  it("a plan on another day is not a candidate", () => {
    const a = act({ externalId: "garmin:1" });
    const d = planImport([a], [], [plan("tomorrow", "18:00:00", undefined, { date: "2026-11-24" })]);
    assert.deepEqual(d, [{ action: "upsert", id: "stable-garmin:1" }]);
  });

  it("rows written by another importer are never candidates", () => {
    const a = act({ externalId: "garmin:1" });
    const d = planImport([a], [], [
      plan("oura", "18:00:00", undefined, { notes: "Synced from Oura" }),
      plan("strava-run", "18:00:00", undefined, { notes: "Strava: Lunch Run (+3m)" }),
      plan("strava-wo", "18:00:00", undefined, { notes: "Strava (Styrketræning)" }),
      plan("old-garmin", "18:00:00", undefined, { notes: "Garmin import" }),
    ]);
    assert.deepEqual(d, [{ action: "upsert", id: "stable-garmin:1" }]);
  });

  it("a user's own notes do not disqualify a plan", () => {
    assert.equal(isImportedRow("Morning short"), false);
    assert.equal(isImportedRow("Stravaganza day"), false);
    assert.equal(isImportedRow(null), false);
  });
});

describe("one claim per row, one row per activity", () => {
  it("two activities, one plan: only one claims, the other inserts", () => {
    const a1 = act({ externalId: "garmin:1", startLocal: `${DAY} 18:10:00` });
    const a2 = act({ externalId: "garmin:2", startLocal: `${DAY} 18:05:00` });
    const d = planImport([a1, a2], [], [plan("p", "18:00:00")]);
    // The closer one (18:05) claims, even though it is listed second.
    assert.deepEqual(d, [
      { action: "upsert", id: "stable-garmin:1" },
      { action: "claim", id: "p" },
    ]);
  });

  it("two activities, two plans: closest pairing of the day wins globally", () => {
    // Activity-order greedy would hand 11:00 the 12:00 plan and leave 12:00
    // with 09:00. Global ranking pairs 12:00↔12:00 first.
    const a1 = act({ externalId: "garmin:1", startLocal: `${DAY} 11:00:00` });
    const a2 = act({ externalId: "garmin:2", startLocal: `${DAY} 12:00:00` });
    const d = planImport([a1, a2], [], [plan("nine", "09:00:00"), plan("noon", "12:00:00")]);
    assert.deepEqual(d, [
      { action: "claim", id: "nine" },
      { action: "claim", id: "noon" },
    ]);
  });

  it("matchPlans never hands one plan to two activities", () => {
    const acts = [1, 2, 3].map((n) => act({ externalId: `garmin:${n}` }));
    const m = matchPlans(acts, [0, 1, 2], [plan("only", null)]);
    assert.equal(m.size, 1);
    assert.equal(new Set(m.values()).size, m.size);
  });

  it("an already-completed plan is still a candidate (ticked by hand, then synced)", () => {
    // `completed` is deliberately not part of Candidate — it cannot matter.
    const a = act({ externalId: "garmin:1" });
    assert.deepEqual(planImport([a], [], [plan("ticked", "18:00:00")]), [{ action: "claim", id: "ticked" }]);
  });

  it("the same activity twice in one payload is written once", () => {
    const a = act({ externalId: "garmin:1" });
    const d = planImport([a, { ...a }], [], [plan("p", "18:00:00"), plan("q", "18:00:00")]);
    assert.deepEqual(d, [{ action: "claim", id: "p" }, { action: "duplicate" }]);
  });
});

describe("re-sync of an activity that already has a row", () => {
  it("a row claimed earlier is reused under ITS id, metrics only — never re-claimed, never re-keyed", () => {
    const a = act({ externalId: "garmin:1" });
    const d = planImport(
      [a],
      [{ id: "planned-random-uuid", external_id: "garmin:1" }],
      // Another open plan that day must not pull the activity away.
      [plan("other", "18:00:00")],
    );
    assert.deepEqual(d, [{ action: "resync-claimed", id: "planned-random-uuid" }]);
  });

  it("a row this function inserted is upserted under its own (stable) id, as before", () => {
    const a = act({ externalId: "garmin:1" });
    const d = planImport([a], [{ id: "stable-garmin:1", external_id: "garmin:1" }], [plan("p", "18:00:00")]);
    assert.deepEqual(d, [{ action: "upsert", id: "stable-garmin:1" }]);
  });

  it("existing activities do not trigger a candidate lookup for their date", () => {
    const a = act({ externalId: "garmin:1" });
    const b = act({ externalId: "garmin:2", date: "2026-11-22" });
    const walk = act({ externalId: "garmin:3", date: "2026-11-21", typeKey: "walking" });
    assert.deepEqual(claimableDates([a, b, walk], [{ id: "x", external_id: "garmin:1" }]), ["2026-11-22"]);
  });
});

describe("minutesOfDay", () => {
  it("reads Postgres time and Garmin's naive local stamp", () => {
    assert.equal(minutesOfDay("18:03:21"), 18 * 60 + 3);
    assert.equal(minutesOfDay("07:30"), 7 * 60 + 30);
    assert.equal(minutesOfDay("2026-08-15 18:03:21"), 18 * 60 + 3);
    assert.equal(minutesOfDay("2026-08-15T06:05:00"), 6 * 60 + 5);
  });

  it("absent or unparseable is null, never midnight", () => {
    assert.equal(minutesOfDay(null), null);
    assert.equal(minutesOfDay(""), null);
    assert.equal(minutesOfDay("2026-08-15"), null);
    assert.equal(minutesOfDay("25:00:00"), null);
  });
});
