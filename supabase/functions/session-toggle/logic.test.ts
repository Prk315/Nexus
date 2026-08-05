import { assertEquals } from "jsr:@std/assert@1";
import {
  computeStop,
  IDLE_STATE,
  MAX_TASK_NAME,
  parseRequest,
  parseTimestamp,
  rfc3339Utc,
  secretIsUsable,
  secretMatches,
  stateFromRow,
} from "./logic.ts";

const KEY = "x".repeat(32);

// MARK: - Secret validation

Deno.test("secretIsUsable rejects unset and short secrets", () => {
  // The whole point of the length floor: each of these compiles and deploys
  // cleanly, and each would otherwise be a valid credential or an open door.
  assertEquals(secretIsUsable(undefined), false);
  assertEquals(secretIsUsable(""), false);
  assertEquals(secretIsUsable("short"), false);
  assertEquals(secretIsUsable("x".repeat(31)), false);
  assertEquals(secretIsUsable("x".repeat(32)), true);
  assertEquals(secretIsUsable("x".repeat(64)), true);
});

Deno.test("secretMatches is exact", () => {
  assertEquals(secretMatches(KEY, KEY), true);
  assertEquals(secretMatches("", KEY), false);
  assertEquals(secretMatches(KEY + "y", KEY), false);
  assertEquals(secretMatches(KEY.slice(0, 31), KEY), false);
  assertEquals(secretMatches("y" + KEY.slice(1), KEY), false);
  assertEquals(secretMatches(KEY.slice(0, 31) + "y", KEY), false);
});

Deno.test("secretMatches handles multibyte without throwing", () => {
  const k = "ü".repeat(40);
  assertEquals(secretMatches(k, k), true);
  assertEquals(secretMatches("u".repeat(40), k), false);
});

// MARK: - Input validation

Deno.test("parseRequest rejects non-object bodies", () => {
  for (const bad of [null, undefined, 1, "start", [], true]) {
    assertEquals(parseRequest(bad), { ok: false, error: "invalid_body" });
  }
});

Deno.test("parseRequest rejects unknown actions", () => {
  for (const action of [undefined, "", "pause", "STOP", 1, null]) {
    assertEquals(parseRequest({ action }), { ok: false, error: "invalid_action" });
  }
});

Deno.test("parseRequest accepts stop with no other fields", () => {
  assertEquals(parseRequest({ action: "stop" }), { ok: true, action: "stop" });
  // Extra fields on stop are ignored, not an error — the server row is the only
  // description of what's being stopped.
  assertEquals(parseRequest({ action: "stop", taskName: "" }), {
    ok: true,
    action: "stop",
  });
});

Deno.test("parseRequest requires a non-empty, bounded task name for start", () => {
  assertEquals(parseRequest({ action: "start" }), {
    ok: false,
    error: "invalid_taskName",
  });
  assertEquals(parseRequest({ action: "start", taskName: 42 }), {
    ok: false,
    error: "invalid_taskName",
  });
  // Whitespace-only would satisfy a naive length check and then land in a
  // NOT NULL column as a blank label.
  assertEquals(parseRequest({ action: "start", taskName: "   " }), {
    ok: false,
    error: "invalid_taskName",
  });
  assertEquals(parseRequest({ action: "start", taskName: "a".repeat(MAX_TASK_NAME + 1) }), {
    ok: false,
    error: "invalid_taskName",
  });
  assertEquals(parseRequest({ action: "start", taskName: "a".repeat(MAX_TASK_NAME) }), {
    ok: true,
    action: "start",
    taskName: "a".repeat(MAX_TASK_NAME),
    project: null,
  });
});

Deno.test("parseRequest trims the task name", () => {
  assertEquals(parseRequest({ action: "start", taskName: "  Deep work \n" }), {
    ok: true,
    action: "start",
    taskName: "Deep work",
    project: null,
  });
});

Deno.test("parseRequest treats project as optional and normalises blanks to null", () => {
  assertEquals(parseRequest({ action: "start", taskName: "t", project: "Nexus" }), {
    ok: true,
    action: "start",
    taskName: "t",
    project: "Nexus",
  });
  assertEquals(parseRequest({ action: "start", taskName: "t", project: null }), {
    ok: true,
    action: "start",
    taskName: "t",
    project: null,
  });
  assertEquals(parseRequest({ action: "start", taskName: "t", project: "  " }), {
    ok: true,
    action: "start",
    taskName: "t",
    project: null,
  });
  assertEquals(parseRequest({ action: "start", taskName: "t", project: 7 }), {
    ok: false,
    error: "invalid_project",
  });
  assertEquals(
    parseRequest({ action: "start", taskName: "t", project: "p".repeat(121) }),
    { ok: false, error: "invalid_project" },
  );
});

// MARK: - Timestamps

Deno.test("rfc3339Utc drops fractional seconds", () => {
  // ISO8601DateFormatter() in the widget defaults to .withInternetDateTime,
  // which rejects ".123" — a running timer would decode to nil and render as
  // paused.
  assertEquals(rfc3339Utc(new Date("2026-08-05T09:15:30.123Z")), "2026-08-05T09:15:30Z");
  assertEquals(rfc3339Utc(new Date("2026-08-05T09:15:30Z")), "2026-08-05T09:15:30Z");
  assertEquals(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(rfc3339Utc(new Date())), true);
});

// MARK: - Duration

Deno.test("computeStop derives duration from start_time while running", () => {
  const now = new Date("2026-08-05T10:00:00Z");
  assertEquals(
    computeStop({ startTime: "2026-08-05T09:00:00Z", pausedAt: null, now }),
    { durationSeconds: 3600, endTime: "2026-08-05T10:00:00Z" },
  );
});

Deno.test("computeStop ends a paused session at paused_at, not now", () => {
  // A session paused at 09:30 and stopped at 18:00 must bill 30 minutes, not
  // nine hours. Same single formula as session.rs::tt_session_stop, and it
  // agrees with the elapsed_seconds pause snapshot by construction.
  assertEquals(
    computeStop({
      startTime: "2026-08-05T09:00:00Z",
      pausedAt: "2026-08-05T09:30:00Z",
      now: new Date("2026-08-05T18:00:00Z"),
    }),
    { durationSeconds: 1800, endTime: "2026-08-05T09:30:00Z" },
  );
});

Deno.test("computeStop clamps to zero and never emits NaN", () => {
  const now = new Date("2026-08-05T10:00:00Z");
  // Clock skew / a hand-edited row: a negative duration would subtract from
  // today's total.
  assertEquals(
    computeStop({ startTime: "2026-08-05T11:00:00Z", pausedAt: null, now }).durationSeconds,
    0,
  );
  // Unparseable start_time: NaN would go to Postgres as null and drop the entry
  // out of every total.
  for (const startTime of ["not a date", null, "", "   "]) {
    const r = computeStop({ startTime, pausedAt: null, now });
    assertEquals(r.durationSeconds, 0);
    assertEquals(Number.isFinite(r.durationSeconds), true);
  }
  // An unparseable paused_at falls back to now rather than poisoning end_time.
  assertEquals(
    computeStop({ startTime: "2026-08-05T09:00:00Z", pausedAt: "junk", now }),
    { durationSeconds: 3600, endTime: "2026-08-05T10:00:00Z" },
  );
  // Empty-string paused_at is "not paused", matching stateFromRow.
  assertEquals(
    computeStop({ startTime: "2026-08-05T09:00:00Z", pausedAt: "", now }).endTime,
    "2026-08-05T10:00:00Z",
  );
});

Deno.test("computeStop parses TimeTracker's legacy offset-less timestamps", () => {
  // Rows written before the RFC3339 rule look like "2026-07-02T14:47" or
  // "2026-07-02 14:47:00". Both must yield a real number, not NaN.
  for (const startTime of ["2026-08-05T09:00", "2026-08-05 09:00:00", "2026-08-05T09:00:00"]) {
    const r = computeStop({
      startTime,
      pausedAt: null,
      now: new Date("2026-08-05T23:00:00Z"),
    });
    assertEquals(Number.isFinite(r.durationSeconds), true);
    assertEquals(r.durationSeconds >= 0, true);
  }
});

Deno.test("computeStop is stable for a paused row, so a stop retry writes the same entry", () => {
  // Idempotency of stop leans on this: a paused row's end_time comes from the
  // row, not from the clock, so retrying produces a byte-identical entry and the
  // (device_id, start_time, task_name) upsert dedupes instead of double-counting.
  const of = (now: string) =>
    computeStop({
      startTime: "2026-08-05T09:00:00Z",
      pausedAt: "2026-08-05T09:30:00Z",
      now: new Date(now),
    });
  assertEquals(of("2026-08-05T10:00:00Z"), of("2026-08-05T12:00:00Z"));
});

Deno.test("parseTimestamp returns null only for genuinely unusable input", () => {
  assertEquals(parseTimestamp(null), null);
  assertEquals(parseTimestamp(undefined), null);
  assertEquals(parseTimestamp(""), null);
  assertEquals(parseTimestamp("   "), null);
  assertEquals(parseTimestamp("nonsense"), null);
  assertEquals(
    parseTimestamp("2026-08-05T09:00:00Z")?.toISOString(),
    "2026-08-05T09:00:00.000Z",
  );
  // chrono's to_rfc3339() spelling, which the Rust path writes.
  assertEquals(
    parseTimestamp("2026-08-05T09:00:00+00:00")?.toISOString(),
    "2026-08-05T09:00:00.000Z",
  );
  assertEquals(parseTimestamp("  2026-08-05T09:00:00Z  ")?.toISOString(),
    "2026-08-05T09:00:00.000Z");
  assertEquals(parseTimestamp("2026-08-05 09:00:00") !== null, true);
});

// MARK: - Response projection

Deno.test("stateFromRow reports idle for a missing row", () => {
  assertEquals(stateFromRow(null), IDLE_STATE);
  assertEquals(IDLE_STATE.running, false);
});

Deno.test("stateFromRow mirrors the widget's running predicate", () => {
  assertEquals(
    stateFromRow({
      task_name: "Deep work",
      project: "Nexus",
      start_time: "2026-08-05T09:00:00Z",
      paused_at: null,
      elapsed_seconds: 0,
    }),
    {
      running: true,
      taskName: "Deep work",
      project: "Nexus",
      startTime: "2026-08-05T09:00:00Z",
      pausedAt: null,
      elapsedSeconds: 0,
    },
  );

  const paused = stateFromRow({
    task_name: "Deep work",
    project: null,
    start_time: "2026-08-05T09:00:00Z",
    paused_at: "2026-08-05T09:30:00Z",
    elapsed_seconds: 1800,
  });
  assertEquals(paused.running, false);
  assertEquals(paused.elapsedSeconds, 1800);

  // An empty-string paused_at is not "paused" — TimeTrackerProvider only checks
  // for nil, so treating "" as paused here would desync the two.
  assertEquals(
    stateFromRow({
      task_name: "t",
      project: null,
      start_time: "2026-08-05T09:00:00Z",
      paused_at: "",
      elapsed_seconds: 0,
    }).running,
    true,
  );
});
