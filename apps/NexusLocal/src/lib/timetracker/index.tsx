/**
 * Barrel for the productivity stack folded in from TimeTracker.
 *
 * Two mount points, matching the two slots Nexus Local already has:
 *
 *  - `<TimeTrackerDashboard />` / `<TimeTrackerSettings />` — visible UI. The
 *    first goes in the main column, the second in the sidebar; see the split
 *    below. Both are rendered by `App.tsx` outside the auth
 *    gate. Each panel is a `<section>` appended to the array below.
 *  - `<TimeTrackerSync />`   — headless, mounted by `main.tsx` *outside* the auth
 *    gate so it runs signed out (these tables are anon-keyed).
 *
 * Work units add their component here and nowhere else. Keeping the two lists in
 * one file is what lets a dozen units merge without fighting over `App.tsx`.
 *
 * ## Conventions
 *
 * - Read/write these tables with `supabasePublic`, **not** `supabase`. They are
 *   keyed `user_id = "default"` under anon-role RLS; the authenticated JWT
 *   returns an empty set rather than an error, which looks exactly like
 *   "no data" and wastes an afternoon.
 * - `invoke()` argument keys are **camelCase** (`{ taskName }`). snake_case
 *   works on macOS and hard-fails on iOS with `invalid args`.
 * - Styling is inline Tailwind utilities on the `#0a0a0f` background; a panel is
 *   `<section className="flex flex-col gap-2">…</section>`.
 */

import type { ReactElement } from "react";
import { TimerPanel } from "./TimerPanel";
import { BlockingPanel } from "./BlockingPanel";
import { SchedulePanel } from "./SchedulePanel";

// `PomodoroPanel.tsx`, not `Pomodoro.tsx`: the pure phase machine is
// `pomodoro.ts`, and macOS's case-insensitive filesystem makes TypeScript treat
// the two spellings as the same file (TS1261).
import { Pomodoro } from "./PomodoroPanel";
import { RewardsPanel } from "./RewardsPanel";
import { EnforcementPanel } from "./EnforcementPanel";
import { UsagePanel } from "./UsagePanel";

// --- Visible panels -------------------------------------------------------
// Work units append their panel component to ONE of the two lists below.
// One entry per line: a dozen units append here in parallel, and a same-line
// edit to `= []` conflicts every single time.
//
// The split is "what is happening" vs "what I have configured".
//
// Dashboard panels answer a question you ask repeatedly through the day, and
// whose answer changes on its own while you watch. Settings panels are lists you
// edit occasionally and then stop thinking about — those live behind the sidebar
// toggle, so the Learn dashboard isn't buried under blocking rules set up last
// week.
//
// The test when adding a panel: does its content change by itself? Timer,
// pomodoro and usage do. A list of blocked sites doesn't.
const DASHBOARD_PANELS: Array<() => ReactElement | null> = [
  TimerPanel,
  Pomodoro,
  // Where the day actually went, as measured rather than as intended. Renders
  // null with no daemon and no data, which is every launch on iOS.
  UsagePanel,
];

const SETTINGS_PANELS: Array<() => ReactElement | null> = [
  SchedulePanel,
  BlockingPanel,
  // Directly after BlockingPanel: that panel shows what *should* be blocked,
  // this one whether this machine is actually doing it. Renders null off macOS.
  EnforcementPanel,
  RewardsPanel,
];

export function TimeTrackerDashboard() {
  if (DASHBOARD_PANELS.length === 0) return null;
  return (
    <>
      {DASHBOARD_PANELS.map((Panel, i) => (
        <Panel key={i} />
      ))}
    </>
  );
}

export function TimeTrackerSettings() {
  if (SETTINGS_PANELS.length === 0) return null;
  return (
    <>
      {SETTINGS_PANELS.map((Panel, i) => (
        <Panel key={i} />
      ))}
    </>
  );
}

// --- Headless sync --------------------------------------------------------
// Components that poll Supabase and push into native bridges. Each returns null.
// Note these are WebView timers: they stop when the app backgrounds. Real
// background refresh is the widget TimelineProvider (unit 10), not this.
const SYNCS: Array<() => null> = [];

export function TimeTrackerSync() {
  return (
    <>
      {SYNCS.map((Sync, i) => (
        <Sync key={i} />
      ))}
    </>
  );
}
