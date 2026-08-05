// Tests for the focus-evaluate decision logic.
//
//   deno test supabase/functions/focus-evaluate/index_test.ts
//
// These import ./logic.ts rather than ./index.ts on purpose: index.ts calls
// Deno.serve at module scope, so importing it from a test would bind a port and
// leave the run hanging. index.ts is I/O only; every rule that decides whether a
// target is blocked lives in logic.ts and is covered here.

import {
  assert,
  assertEquals,
  assertFalse,
} from "jsr:@std/assert@1";

import {
  type BlockedAppRow,
  type BlockedSiteRow,
  blockActive,
  evaluate,
  type EvaluateInput,
  type FocusBlockRow,
  isoWeekday,
  localNow,
  parseDaysOfWeek,
  parseHHMM,
  permanentAppInForce,
  unlockGranted,
  type UnlockRuleRow,
  windowActive,
} from "./logic.ts";

const HM = (h: number, m = 0) => h * 60 + m;

// ── Window: normal ───────────────────────────────────────────────────────────

Deno.test("normal window 09:00-17:00 is active inside and closed outside", () => {
  assertFalse(windowActive("09:00", "17:00", HM(8, 59)));
  assert(windowActive("09:00", "17:00", HM(9, 0)), "inclusive at start");
  assert(windowActive("09:00", "17:00", HM(12)));
  assert(windowActive("09:00", "17:00", HM(16, 59)));
  assertFalse(windowActive("09:00", "17:00", HM(17, 0)), "exclusive at end");
  assertFalse(windowActive("09:00", "17:00", HM(23)));
  assertFalse(windowActive("09:00", "17:00", HM(0)));
});

// ── Window: overnight wrap ───────────────────────────────────────────────────
// The highest-consequence branch in the whole unit: getting it wrong silently
// un-blocks every night shift.

Deno.test("overnight window 22:00-06:00 at 23:00 is active", () => {
  assert(windowActive("22:00", "06:00", HM(23)));
});

Deno.test("overnight window 22:00-06:00 at 01:00 is active", () => {
  assert(windowActive("22:00", "06:00", HM(1)));
});

Deno.test("overnight window 22:00-06:00 at 12:00 is NOT active", () => {
  assertFalse(windowActive("22:00", "06:00", HM(12)));
});

Deno.test("overnight window boundaries are [start, end)", () => {
  assert(windowActive("22:00", "06:00", HM(22, 0)), "inclusive at start");
  assertFalse(windowActive("22:00", "06:00", HM(21, 59)));
  assert(windowActive("22:00", "06:00", HM(5, 59)));
  assertFalse(windowActive("22:00", "06:00", HM(6, 0)), "exclusive at end");
});

Deno.test("start == end is an empty window, not an all-day one", () => {
  assertFalse(windowActive("09:00", "09:00", HM(9)));
  assertFalse(windowActive("09:00", "09:00", HM(15)));
});

Deno.test("unparseable times skip the block rather than blocking always", () => {
  assertEquals(parseHHMM("nonsense"), null);
  assertEquals(parseHHMM("25:00"), null);
  assertEquals(parseHHMM("09:60"), null);
  assertEquals(parseHHMM("09:00"), HM(9));
  assertEquals(parseHHMM("9:05"), HM(9, 5));
  assertEquals(parseHHMM("22:30:00"), HM(22, 30));
  assertFalse(windowActive("nonsense", "17:00", HM(12)));
});

// ── Weekdays ─────────────────────────────────────────────────────────────────

Deno.test("days_of_week is split on commas, not substring-matched", () => {
  assertEquals(parseDaysOfWeek("1,2,3,4,5"), [1, 2, 3, 4, 5]);
  assertEquals(parseDaysOfWeek(" 6 , 7 "), [6, 7]);
  assertEquals(parseDaysOfWeek(""), []);
  // The trap: "11,2".includes("1") is true, but 1 is not in the list.
  assertFalse(parseDaysOfWeek("11,2").includes(1));
});

Deno.test("isoWeekday maps Sunday to 7", () => {
  assertEquals(isoWeekday("2026-08-03"), 1); // Monday
  assertEquals(isoWeekday("2026-08-07"), 5); // Friday
  assertEquals(isoWeekday("2026-08-08"), 6); // Saturday
  assertEquals(isoWeekday("2026-08-09"), 7); // Sunday
});

Deno.test("a weekday that does not match makes the block inactive", () => {
  const block = {
    enabled: true,
    days_of_week: "1,2,3,4,5", // Mon-Fri
    start_time: "09:00",
    end_time: "17:00",
  };
  assert(blockActive(block, 3, HM(12)), "Wednesday noon is inside");
  assertFalse(blockActive(block, 6, HM(12)), "Saturday noon is not");
  assertFalse(blockActive(block, 7, HM(12)), "Sunday noon is not");
});

Deno.test("a disabled block is never active", () => {
  assertFalse(
    blockActive(
      {
        enabled: false,
        days_of_week: "1,2,3,4,5",
        start_time: "09:00",
        end_time: "17:00",
      },
      3,
      HM(12),
    ),
  );
});

Deno.test("PORTED QUIRK: overnight block tests TODAY's weekday, not the opening day", () => {
  // A 22:00-06:00 block scheduled Mondays only. The original checks the weekday
  // of the current day before evaluating the window, so at 01:00 on Tuesday
  // (weekday 2) the block is NOT active even though its window opened Monday.
  // Pinned so nobody "fixes" this into a behaviour change.
  const mondayNights = {
    enabled: true,
    days_of_week: "1",
    start_time: "22:00",
    end_time: "06:00",
  };
  assert(blockActive(mondayNights, 1, HM(23)), "Monday 23:00 active");
  assertFalse(blockActive(mondayNights, 2, HM(1)), "Tuesday 01:00 NOT active");
  assert(blockActive(mondayNights, 1, HM(1)), "Monday 01:00 active");
});

// ── Unlock thresholds ────────────────────────────────────────────────────────

Deno.test("unlock fires at exactly the threshold and not one minute under", () => {
  const rule = { enabled: true, required_minutes: 60 };
  assert(unlockGranted(rule, 60), "exactly 60 unlocks");
  assertFalse(unlockGranted(rule, 59), "59 does not");
  assert(unlockGranted(rule, 72), "over the threshold unlocks");
});

Deno.test("a disabled unlock rule never grants", () => {
  assertFalse(unlockGranted({ enabled: false, required_minutes: 0 }, 9999));
});

// ── focus_only ───────────────────────────────────────────────────────────────

Deno.test("focus_only blocks only while a session is running", () => {
  const app = { enabled: true, block_mode: "focus_only" };
  assert(permanentAppInForce(app, true), "timer running → blocked");
  assertFalse(permanentAppInForce(app, false), "no timer → not blocked");
});

Deno.test("block_mode 'always' ignores session state", () => {
  const app = { enabled: true, block_mode: "always" };
  assert(permanentAppInForce(app, true));
  assert(permanentAppInForce(app, false));
});

Deno.test("a disabled app row is never in force", () => {
  assertFalse(permanentAppInForce({ enabled: false, block_mode: "always" }, true));
});

// ── evaluate(): the whole verdict ────────────────────────────────────────────

const site = (domain: string, enabled = true): BlockedSiteRow => ({
  user_id: "default",
  domain,
  enabled,
});

const app = (
  process_name: string,
  block_mode = "always",
  enabled = true,
): BlockedAppRow => ({
  user_id: "default",
  display_name: process_name,
  process_name,
  block_mode,
  enabled,
});

const focusBlock = (
  id: string,
  name: string,
  start_time: string,
  end_time: string,
  days_of_week: string,
): FocusBlockRow => ({
  id,
  user_id: "default",
  name,
  start_time,
  end_time,
  days_of_week,
  color: "#4f46e5",
  enabled: true,
});

const rule = (
  target: { domain?: string; process_name?: string },
  required_minutes: number,
  enabled = true,
): UnlockRuleRow => ({
  user_id: "default",
  domain: target.domain ?? null,
  process_name: target.process_name ?? null,
  required_minutes,
  enabled,
});

const input = (over: Partial<EvaluateInput> = {}): EvaluateInput => ({
  sites: [],
  apps: [],
  blocks: [],
  blockApps: new Map(),
  blockSites: new Map(),
  rules: [],
  weekday: 3, // Wednesday
  nowMinutes: HM(12),
  todayMinutes: 0,
  timerActive: false,
  ...over,
});

Deno.test("permanent sites are blocked; disabled ones are not", () => {
  const out = evaluate(
    input({ sites: [site("youtube.com"), site("news.com", false)] }),
  );
  assertEquals(out.effective_domains, ["youtube.com"]);
  assertEquals(out.reasons["youtube.com"], {
    blocked: true,
    source: "permanent",
  });
  assertEquals(out.reasons["news.com"], { blocked: false, source: "disabled" });
});

Deno.test("schedule targets are blocked while the window is open", () => {
  const block = focusBlock("b1", "Deep work", "09:00", "17:00", "1,2,3,4,5");
  const out = evaluate(
    input({
      blocks: [block],
      blockSites: new Map([["b1", ["youtube.com"]]]),
      blockApps: new Map([["b1", ["Slack"]]]),
    }),
  );
  assertEquals(out.effective_domains, ["youtube.com"]);
  assertEquals(out.effective_processes, ["Slack"]);
  assertEquals(out.reasons["youtube.com"], {
    blocked: true,
    source: "focus_block",
    block_name: "Deep work",
  });
});

Deno.test("schedule targets are free once the window closes", () => {
  const block = focusBlock("b1", "Deep work", "09:00", "17:00", "1,2,3,4,5");
  const out = evaluate(
    input({
      nowMinutes: HM(18),
      blocks: [block],
      blockSites: new Map([["b1", ["youtube.com"]]]),
    }),
  );
  assertEquals(out.effective_domains, []);
});

Deno.test("an overnight schedule block still blocks at 01:00 on a scheduled day", () => {
  const block = focusBlock("b1", "Night shield", "22:00", "06:00", "1,2,3,4,5");
  const out = evaluate(
    input({
      weekday: 3,
      nowMinutes: HM(1),
      blocks: [block],
      blockSites: new Map([["b1", ["reddit.com"]]]),
    }),
  );
  assertEquals(out.effective_domains, ["reddit.com"]);
});

Deno.test("an unlock at threshold removes a permanently blocked domain", () => {
  const base = { sites: [site("reddit.com")], rules: [rule({ domain: "reddit.com" }, 60)] };

  const under = evaluate(input({ ...base, todayMinutes: 59 }));
  assertEquals(under.effective_domains, ["reddit.com"], "59 min → still blocked");

  const at = evaluate(input({ ...base, todayMinutes: 60 }));
  assertEquals(at.effective_domains, [], "60 min → unlocked");
  assertEquals(at.reasons["reddit.com"], {
    blocked: false,
    source: "unlock_rule",
    required_minutes: 60,
    today_minutes: 60,
  });
});

Deno.test("an unlock overrides schedule blocking too", () => {
  const block = focusBlock("b1", "Deep work", "09:00", "17:00", "1,2,3,4,5");
  const out = evaluate(
    input({
      todayMinutes: 72,
      blocks: [block],
      blockSites: new Map([["b1", ["reddit.com"]]]),
      rules: [rule({ domain: "reddit.com" }, 60)],
    }),
  );
  assertEquals(out.effective_domains, []);
  assertEquals(out.reasons["reddit.com"], {
    blocked: false,
    source: "unlock_rule",
    required_minutes: 60,
    today_minutes: 72,
  });
});

Deno.test("an unmet unlock rule annotates progress on the still-blocked target", () => {
  const out = evaluate(
    input({
      todayMinutes: 38,
      sites: [site("reddit.com")],
      rules: [rule({ domain: "reddit.com" }, 60)],
    }),
  );
  assertEquals(out.effective_domains, ["reddit.com"]);
  assertEquals(out.reasons["reddit.com"], {
    blocked: true,
    source: "permanent",
    unlock_required_minutes: 60,
    today_minutes: 38,
  });
});

Deno.test("focus_only app: blocked with a running session, free without", () => {
  const sut = { apps: [app("Slack", "focus_only")] };

  const idle = evaluate(input({ ...sut, timerActive: false }));
  assertEquals(idle.effective_processes, []);
  assertEquals(idle.reasons["Slack"], {
    blocked: false,
    source: "focus_only",
    note: "no session running",
    display_name: "Slack",
  });

  const running = evaluate(input({ ...sut, timerActive: true }));
  assertEquals(running.effective_processes, ["Slack"]);
  assertEquals(running.reasons["Slack"], {
    blocked: true,
    source: "focus_only",
    display_name: "Slack",
  });
});

Deno.test("focus_only does not apply to schedule targets", () => {
  // block_mode lives on blocked_apps rows; a schedule target is blocked by the
  // window alone, with no session running.
  const block = focusBlock("b1", "Deep work", "09:00", "17:00", "1,2,3,4,5");
  const out = evaluate(
    input({
      timerActive: false,
      apps: [app("Slack", "focus_only")],
      blocks: [block],
      blockApps: new Map([["b1", ["Slack"]]]),
    }),
  );
  assertEquals(out.effective_processes, ["Slack"]);
  assertEquals(out.reasons["Slack"], {
    blocked: true,
    source: "focus_block",
    block_name: "Deep work",
  });
});

Deno.test("a disabled permanent site is still blocked when a schedule claims it", () => {
  const block = focusBlock("b1", "Deep work", "09:00", "17:00", "1,2,3,4,5");
  const out = evaluate(
    input({
      sites: [site("youtube.com", false)],
      blocks: [block],
      blockSites: new Map([["b1", ["youtube.com"]]]),
    }),
  );
  assertEquals(out.effective_domains, ["youtube.com"]);
  assertEquals(out.reasons["youtube.com"], {
    blocked: true,
    source: "focus_block",
    block_name: "Deep work",
  });
});

Deno.test("output arrays are sorted so back-to-back runs are byte-identical", () => {
  const out = evaluate(
    input({ sites: [site("zzz.com"), site("aaa.com"), site("mmm.com")] }),
  );
  assertEquals(out.effective_domains, ["aaa.com", "mmm.com", "zzz.com"]);

  const again = evaluate(
    input({ sites: [site("mmm.com"), site("zzz.com"), site("aaa.com")] }),
  );
  assertEquals(again.effective_domains, out.effective_domains);
});

Deno.test("empty config yields an empty verdict, not a crash", () => {
  const out = evaluate(input());
  assertEquals(out.effective_domains, []);
  assertEquals(out.effective_processes, []);
  assertEquals(out.reasons, {});
  assertEquals(out.today_minutes, 0);
});

// ── Timezone resolution ──────────────────────────────────────────────────────

Deno.test("localNow resolves UTC into Europe/Copenhagen local space", () => {
  // Summer (CEST, UTC+2): 21:30Z is 23:30 local on the SAME day.
  assertEquals(localNow(new Date("2026-08-05T21:30:00Z")), {
    date: "2026-08-05",
    minutes: HM(23, 30),
  });

  // Summer, past local midnight: 22:30Z is 00:30 local on the NEXT day.
  // This is the off-by-hours bug the timezone handling exists to prevent — a
  // naive UTC read would put this at 22:30 on the 5th.
  assertEquals(localNow(new Date("2026-08-05T22:30:00Z")), {
    date: "2026-08-06",
    minutes: HM(0, 30),
  });

  // Winter (CET, UTC+1).
  assertEquals(localNow(new Date("2026-01-15T12:00:00Z")), {
    date: "2026-01-15",
    minutes: HM(13),
  });
});

Deno.test("localNow renders local midnight as 0 minutes, not 1440", () => {
  // hourCycle h23 vs hour12:false — the latter yields "24" under some ICU
  // builds, which would push nowMinutes to 1440 and make every normal window
  // read as already-ended for the first hour of the day.
  const { minutes } = localNow(new Date("2026-08-05T22:00:00Z")); // 00:00 CEST
  assertEquals(minutes, 0);
});

Deno.test("the local date drives the weekday used for schedule matching", () => {
  // 22:30Z Saturday is 00:30 Sunday local — weekday must be 7, not 6.
  const { date } = localNow(new Date("2026-08-08T22:30:00Z"));
  assertEquals(date, "2026-08-09");
  assertEquals(isoWeekday(date), 7);
});
