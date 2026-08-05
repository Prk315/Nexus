/**
 * Barrel for the productivity stack folded in from TimeTracker.
 *
 * Two mount points, matching the two slots Nexus Local already has:
 *
 *  - `<TimeTrackerPanels />` — visible UI, rendered by `App.tsx` inside the auth
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

// `PomodoroPanel.tsx`, not `Pomodoro.tsx`: the pure phase machine is
// `pomodoro.ts`, and macOS's case-insensitive filesystem makes TypeScript treat
// the two spellings as the same file (TS1261).
import { Pomodoro } from "./PomodoroPanel";

// --- Visible panels -------------------------------------------------------
// Work units append their panel component here.
//   unit 3  TimerPanel
//   unit 4  Pomodoro
//   unit 5  BlockingPanel
//   unit 6  SchedulePanel
//   unit 7  RewardsPanel
const PANELS: Array<() => ReactElement | null> = [
  Pomodoro,
];

export function TimeTrackerPanels() {
  if (PANELS.length === 0) return null;
  return (
    <>
      {PANELS.map((Panel, i) => (
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
