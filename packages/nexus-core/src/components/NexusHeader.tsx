import { LayoutGrid, Network, Bot, Mail, MessageSquare, Clock, CalendarDays, UserRound, Settings, LogOut } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useConnectedApps } from "../hooks/useConnectedApps";
import { cn } from "../utils";
import type { ConnectedApp } from "../types";

interface NexusHeaderProps {
  appName: string;
  onHome?: () => void;
  onAppSelect?: (app: ConnectedApp) => void;
  onHub?: () => void;
  onAgent?: () => void;
  onMail?: () => void;
  onMessages?: () => void;
  onClock?: () => void;
  onCalendar?: () => void;
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

export function NexusHeader({
  appName,
  onHome,
  onAppSelect,
  onHub,
  onAgent,
  onMail,
  onMessages,
  onClock,
  onCalendar,
}: NexusHeaderProps) {
  const { apps, isNexusRunning } = useConnectedApps();

  return (
    <header
      className="h-11 border-b border-border bg-background/95 backdrop-blur-sm flex items-center px-3 gap-2 shrink-0"
      // Allow dragging the window by the header on desktop
      data-tauri-drag-region
    >
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
              <DropdownMenu.Label className="px-2 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Account
              </DropdownMenu.Label>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                disabled
                className="relative flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm gap-2 text-muted-foreground data-[disabled]:opacity-50 hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground outline-none"
              >
                <Settings className="h-3.5 w-3.5" />
                Settings
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item
                disabled
                className="relative flex cursor-default select-none items-center rounded-md px-2 py-1.5 text-sm gap-2 text-destructive data-[disabled]:opacity-50 hover:bg-accent focus:bg-accent outline-none"
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

      {/* ── Spacer (drag region) ─────────────────────────────────── */}
      <div className="flex-1" data-tauri-drag-region />

      {/* ── Right: action icons + app switcher ──────────────────── */}
      <div className="flex items-center gap-0.5">
        <IconBtn onClick={onHub}      title="Network"><Network      className="h-4 w-4" /></IconBtn>
        <IconBtn onClick={onAgent}    title="AI Agent"><Bot         className="h-4 w-4" /></IconBtn>
        <IconBtn onClick={onMail}     title="Mail">   <Mail         className="h-4 w-4" /></IconBtn>
        <IconBtn onClick={onMessages} title="Messages"><MessageSquare className="h-4 w-4" /></IconBtn>
        <IconBtn onClick={onClock}    title="Clock">  <Clock        className="h-4 w-4" /></IconBtn>
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
}
