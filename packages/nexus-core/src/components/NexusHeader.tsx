import { useRef, useState } from "react";
import { LayoutGrid, Network, Bot, Mail, MessageSquare, Clock, CalendarDays, UserRound, Settings, LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useConnectedApps } from "../hooks/useConnectedApps";
import { cn } from "../utils";
import type { ConnectedApp } from "../types";
import { ClockDropdown, type ClockDropdownProps } from "./ClockDropdown";
import { MailPanel, type MailPanelProps } from "./MailPanel";
import { JobsPanel, type JobsPanelProps } from "./JobsPanel";

// Deployed ecosystem web apps, from per-deployment env vars. Entries with no URL
// are hidden. Used by the header's app switcher to jump between the web apps.
const WEB_APPS: { name: string; url: string }[] = (
  [
    { name: "Vault", url: (import.meta as any).env?.VITE_VAULT_URL as string | undefined },
    { name: "PathFinder", url: (import.meta as any).env?.VITE_PATHFINDER_URL as string | undefined },
    { name: "Protocol", url: (import.meta as any).env?.VITE_PROTOCOL_URL as string | undefined },
  ].filter((a) => !!a.url) as { name: string; url: string }[]
);

interface NexusHeaderProps {
  appName: string;
  /** Optional content rendered centered in the header bar (e.g. a mode switch). */
  center?: React.ReactNode;
  /** When provided, the account menu shows this address and an enabled Sign Out. */
  userEmail?: string;
  onSignOut?: () => void;
  /** When provided, the account menu's Settings item becomes enabled and opens
   *  the shared `SettingsDialog`. Absent apps keep the disabled placeholder. */
  onSettings?: () => void;
  onHome?: () => void;
  onAppSelect?: (app: ConnectedApp) => void;
  onHub?: () => void;
  onAgent?: () => void;
  /** Only used when `loadMail` is absent — see below. */
  onMail?: () => void;
  onMessages?: () => void;
  /** Deprecated: when provided, the Clock button reverts to a plain no-op-able
   *  button instead of the day-stats dropdown (kept for backwards compat —
   *  no app passes this today). */
  onClock?: () => void;
  onCalendar?: () => void;
  /** Optional: today's per-app screen spans, for the Clock dropdown's screen
   *  category and mini timetrack strip. Only apps with a usage bridge pass
   *  this (PathFinder). */
  loadScreenSpans?: ClockDropdownProps["loadScreenSpans"];
  /**
   * Optional: reads n8n's triaged Gmail rows out of Supabase. When present the
   * Mail button becomes the `MailPanel` dropdown; when absent it stays the
   * plain `onMail` button it has always been.
   *
   * Injected rather than built here because `mail_messages` is
   * `auth.uid()`-scoped and only the app owns an authenticated client —
   * `apps/nexus`, `apps/Stonks` and `apps/TimeTrackerApp` have no session at
   * all and pass nothing. Build one with `createMailLoader(supabase)`.
   */
  loadMail?: MailPanelProps["loadMail"];
  /**
   * Writes for the triage-rules editor. Without it the Mail panel is read-only
   * and its Rules button does not render — a form that cannot save is worse
   * than no form.
   */
  mailRulesApi?: MailPanelProps["rulesApi"];
  /**
   * Turn a triaged message into a PathFinder task. Injected for the same
   * reason `loadMail` is: nexus-core cannot import an app, and only the app
   * owns the mail-field → task-field mapping.
   */
  onConvertMailToTask?: MailPanelProps["onConvertToTask"];
  /**
   * The two per-message triage writes — "Done" and "Not important". Build one
   * with `createMailApi(supabase)`. Without it those two row actions do not
   * render, same contract as `mailRulesApi` and `onConvertMailToTask`.
   */
  mailApi?: MailPanelProps["mailApi"];
  /**
   * Reads and writes the job-applier tables (`job_postings`, `job_matches`,
   * `job_applications`, `job_app_modules`). Build one with
   * `createJobsApi(supabase)`.
   *
   * Injected for exactly the reason `loadMail` is, and with one extra
   * consequence worth stating: all five tables are `auth.uid()`-scoped with no
   * anon policy, so a signed-out read returns an **empty set, not an error**.
   * Pass `undefined` when there is no session — the Jobs button still renders
   * and says "sign in to see your job search", which is the one thing row count
   * can never distinguish from "nothing matched".
   *
   * Unlike Mail there is no `onJobs` fallback: the button is new, so an app
   * with no session gets the panel-with-a-sign-in-message rather than a
   * different control.
   */
  jobsApi?: JobsPanelProps["api"];
  /**
   * Opt-in: hide the bar until the pointer reaches the top edge of the window,
   * or something inside it takes focus. Keyboard users therefore never lose it.
   *
   * ABSENT IS THE OLD BEHAVIOUR, exactly — the bar renders in normal flow and
   * nothing about it moves. Every app but the one that asks for this keeps
   * rendering as it always did, which is the whole reason this is a prop rather
   * than a change to the header.
   *
   * When on, the bar leaves the layout (the wrapper is zero-height and the bar
   * is absolutely positioned over the content beneath), so the app below gains
   * the 44px the bar used to occupy. Only a 6px hover strip stays behind.
   */
  autoHide?: boolean;
}

// Small icon button — used for the right-side action row
function IconBtn({
  onClick,
  title,
  children,
}: {
  onClick?: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-8 w-8 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

// data-tauri-drag-region triggers Tauri's start_dragging IPC which is a
// desktop-only capability — it throws on iOS. Omit it on mobile devices.
const isMobileDevice =
  typeof navigator !== "undefined" &&
  /iPad|iPhone|iPod|Android/.test(navigator.userAgent);

export function NexusHeader({
  appName,
  center,
  userEmail,
  onSignOut,
  onSettings,
  onHome,
  onAppSelect,
  onHub,
  onAgent,
  onMail,
  onMessages,
  onClock,
  onCalendar,
  loadScreenSpans,
  loadMail,
  mailRulesApi,
  onConvertMailToTask,
  mailApi,
  jobsApi,
  autoHide,
}: NexusHeaderProps) {
  const { apps, isNexusRunning } = useConnectedApps();

  // Auto-hide reveal state. Two independent reasons to be visible, so neither
  // can switch the other off: the pointer is in the top edge, or focus is
  // somewhere inside the bar. Both are plain React handlers on the wrapper —
  // there is no window listener here, and the "hover zone" is a real element
  // rather than a mousemove watcher.
  const autoHideRef = useRef<HTMLDivElement>(null);
  const [pointerInside, setPointerInside] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const revealed = !autoHide || pointerInside || focusInside;

  const bar = (
    <header
      className={cn(
        "h-11 border-b border-border bg-background/95 backdrop-blur-sm flex items-center px-3 gap-2 shrink-0",
        // `absolute` is also a containing block, so the center slot below keeps
        // positioning against the bar either way.
        autoHide ? "absolute inset-x-0 top-0 transition-[transform,opacity] duration-200 ease-out" : "relative",
        // Hidden with transform + opacity, never `visibility`/`display`: those
        // would take the bar out of the tab order, and focusing it from the
        // keyboard is the other half of how it is reached.
        autoHide && !revealed && "-translate-y-full opacity-0 pointer-events-none"
      )}
      // Allow dragging the window by the header on desktop only
      data-tauri-drag-region={isMobileDevice ? undefined : ""}
    >
      {/* ── Center slot (e.g. app mode switch) ──────────────────── */}
      {center && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
          {center}
        </div>
      )}
      {/* ── Left: avatar + app name ──────────────────────────────── */}
      <div className="flex items-center gap-2 min-w-0">

        {/* User avatar dropdown */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="h-7 w-7 rounded-full bg-muted flex items-center justify-center hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring shrink-0"
              title="Account"
            >
              <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="start"
              sideOffset={6}
              className="z-50 min-w-[160px] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              <DropdownMenu.Label className="px-2 py-1 text-[11px] font-medium text-muted-foreground tracking-wider truncate max-w-[200px]">
                {userEmail ?? "Account"}
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                disabled={!onSettings}
                onSelect={onSettings}
                className="relative flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-sm gap-2 text-muted-foreground data-[disabled]:opacity-50 data-[disabled]:cursor-default hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground outline-none"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                disabled={!onSignOut}
                onSelect={onSignOut}
                className="relative flex cursor-pointer select-none items-center rounded-md px-2 py-1.5 text-sm gap-2 text-destructive data-[disabled]:opacity-50 data-[disabled]:cursor-default hover:bg-accent focus:bg-accent outline-none"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign Out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>

        {/* App name */}
        <button
          onClick={onHome}
          className={cn(
            "flex items-baseline gap-1.5 rounded-md px-2 py-1 -ml-1",
            "hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            !onHome && "pointer-events-none"
          )}
        >
          <span className="text-sm font-semibold tracking-tight">{appName}</span>
          <span className="text-[10px] text-muted-foreground italic hidden sm:inline">
            Memento Mori
          </span>
        </button>
      </div>

      {/* ── Spacer (drag region on desktop only) ────────────────── */}
      <div className="flex-1" data-tauri-drag-region={isMobileDevice ? undefined : ""} />

      {/* ── Right: action icons + app switcher ──────────────────── */}
      <div className="flex items-center gap-0.5">
        <IconBtn onClick={onHub}      title="Network"><Network      className="h-4 w-4" /></IconBtn>
        <IconBtn onClick={onAgent}    title="AI Agent"><Bot         className="h-4 w-4" /></IconBtn>
        {/* No loader (nexus / Stonks / TimeTracker — no session) → unchanged button. */}
        {loadMail
          ? <MailPanel loadMail={loadMail} rulesApi={mailRulesApi} onConvertToTask={onConvertMailToTask} mailApi={mailApi} />
          : <IconBtn onClick={onMail} title="Mail"><Mail className="h-4 w-4" /></IconBtn>}
        {/* Beside mail, because it is the same kind of thing: a queue somebody
            else filled that occasionally needs a human. */}
        <JobsPanel api={jobsApi} />
        <IconBtn onClick={onMessages} title="Messages"><MessageSquare className="h-4 w-4" /></IconBtn>
        {onClock
          ? <IconBtn onClick={onClock} title="Clock"><Clock className="h-4 w-4" /></IconBtn>
          : <ClockDropdown loadScreenSpans={loadScreenSpans} />}
        <IconBtn onClick={onCalendar} title="Calendar"><CalendarDays className="h-4 w-4" /></IconBtn>

        {/* App grid switcher */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ml-1"
              title="Switch app"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={6}
              className="z-50 min-w-[160px] rounded-lg border border-border bg-popover text-popover-foreground shadow-lg p-1 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              {/* Ecosystem web apps (navigate between deployed apps) */}
              {WEB_APPS.length > 0 && (
                <>
                  <DropdownMenu.Label className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Apps
                  </DropdownMenu.Label>
                  {WEB_APPS.map((a) => {
                    const current = a.name === appName;
                    return (
                      <DropdownMenu.Item
                        key={a.name}
                        disabled={current}
                        onSelect={() => { if (!current) window.location.href = a.url; }}
                        className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground data-[disabled]:opacity-50 data-[disabled]:cursor-default"
                      >
                        <span className="h-5 w-5 rounded bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                          {a.name.charAt(0).toUpperCase()}
                        </span>
                        {a.name}
                        {current && <span className="ml-auto text-[10px] text-muted-foreground">current</span>}
                      </DropdownMenu.Item>
                    );
                  })}
                  <DropdownMenu.Separator className="my-1 h-px bg-border" />
                </>
              )}

              {/* Nexus IPC status indicator */}
              <div className="flex items-center gap-2 px-2 py-1.5 border-b border-border mb-1">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  isNexusRunning ? "bg-green-500" : "bg-muted-foreground/30"
                )} />
                <span className="text-[11px] text-muted-foreground">
                  {isNexusRunning ? "IPC online" : "IPC offline"}
                </span>
              </div>

              {apps.length === 0 ? (
                <DropdownMenu.Item
                  disabled
                  className="px-2 py-1.5 text-xs text-muted-foreground/60 select-none"
                >
                  No apps connected
                </DropdownMenu.Item>
              ) : (
                apps.map((app) => (
                  <DropdownMenu.Item
                    key={app.id}
                    onSelect={() => onAppSelect?.(app)}
                    className="flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
                  >
                    <span className="h-5 w-5 rounded bg-muted flex items-center justify-center text-xs font-medium shrink-0">
                      {app.name.charAt(0).toUpperCase()}
                    </span>
                    {app.name}
                  </DropdownMenu.Item>
                ))
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </header>
  );

  if (!autoHide) return bar;

  return (
    <div
      ref={autoHideRef}
      className="relative h-0 shrink-0 z-50"
      onMouseEnter={() => setPointerInside(true)}
      onMouseLeave={() => {
        // A Radix menu renders in a PORTAL, outside this subtree — so moving
        // the pointer from the trigger into its own open menu reads here as
        // leaving the header, and the bar would slide away underneath the menu
        // the user is still reading. The trigger keeps `data-state="open"`
        // while that is true, which is the one tell that survives the portal.
        if (autoHideRef.current?.querySelector('[data-state="open"]')) return;
        setPointerInside(false);
      }}
      // React's onFocus/onBlur bubble (the native events do not), so these see
      // focus landing on any control inside the bar.
      onFocus={() => setFocusInside(true)}
      onBlur={() => setFocusInside(false)}
    >
      {/* The hover zone — all that is left holding the top edge once the bar
          itself is out of flow. Deliberately thin: it sits over the top of
          whatever the app renders beneath and swallows clicks there. */}
      <div className="absolute inset-x-0 top-0 h-1.5" aria-hidden="true" />
      {bar}
    </div>
  );
}
