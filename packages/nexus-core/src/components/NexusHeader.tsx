import { LayoutGrid, Settings, SlidersHorizontal, UserRound, LogOut, MessageSquare, Clock, Network, Bot, Mail, CalendarDays } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useConnectedApps } from "../hooks/useConnectedApps";
import { cn } from "../utils";
import type { ConnectedApp } from "../types";

interface NexusHeaderProps {
  /** The name of the current app — shown as the home button */
  appName: string;
  /** Navigate to the app's main/home page */
  onHome?: () => void;
  /** Called when the user selects an app from the grid switcher */
  onAppSelect?: (app: ConnectedApp) => void;
  /** Quick access — hub button */
  onHub?: () => void;
  /** Quick access — AI agent button */
  onAgent?: () => void;
  /** Quick access — mail button */
  onMail?: () => void;
  /** Quick access — messages button */
  onMessages?: () => void;
  /** Quick access — clock/time button */
  onClock?: () => void;
  /** Quick access — calendar sidebar button */
  onCalendar?: () => void;
}

export function NexusHeader({ appName, onHome, onAppSelect, onHub, onAgent, onMail, onMessages, onClock, onCalendar }: NexusHeaderProps) {
  const { apps, isNexusRunning } = useConnectedApps();

  return (
    <header className="h-12 border-b border-border bg-background flex items-center px-4 gap-3">

      {/* User settings — round avatar button */}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            className={cn(
              "h-8 w-8 rounded-full shrink-0",
              "bg-muted flex items-center justify-center",
              "hover:bg-accent hover:text-accent-foreground transition-colors",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
          >
            <UserRound className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={6}
            className={cn(
              "z-50 min-w-[180px] rounded-md border border-border",
              "bg-popover text-popover-foreground shadow-md p-1",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              "data-[side=bottom]:slide-in-from-top-2"
            )}
          >
            <DropdownMenu.Label className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
              Account
            </DropdownMenu.Label>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />

            <DropdownMenu.Item
              disabled
              className={cn(
                "relative flex cursor-pointer select-none items-center rounded-sm",
                "px-2 py-1.5 text-sm outline-none gap-2",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:bg-accent focus:text-accent-foreground",
                "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
              )}
            >
              <UserRound className="h-4 w-4" />
              User Settings
            </DropdownMenu.Item>

            <DropdownMenu.Item
              disabled
              className={cn(
                "relative flex cursor-pointer select-none items-center rounded-sm",
                "px-2 py-1.5 text-sm outline-none gap-2",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:bg-accent focus:text-accent-foreground",
                "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
              )}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Preferences
            </DropdownMenu.Item>

            <DropdownMenu.Item
              disabled
              className={cn(
                "relative flex cursor-pointer select-none items-center rounded-sm",
                "px-2 py-1.5 text-sm outline-none gap-2",
                "hover:bg-accent hover:text-accent-foreground",
                "focus:bg-accent focus:text-accent-foreground",
                "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
              )}
            >
              <Settings className="h-4 w-4" />
              Settings
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-border" />

            <DropdownMenu.Item
              disabled
              className={cn(
                "relative flex cursor-pointer select-none items-center rounded-sm",
                "px-2 py-1.5 text-sm outline-none gap-2 text-destructive",
                "hover:bg-accent focus:bg-accent",
                "data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed"
              )}
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

      {/* App name — home button */}
      <button
        onClick={onHome}
        className={cn(
          "flex items-baseline gap-2 px-2 py-1 rounded-md -ml-1",
          "hover:bg-accent hover:text-accent-foreground transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !onHome && "cursor-default hover:bg-transparent hover:text-foreground"
        )}
      >
        <span className="text-sm font-medium">{appName}</span>
        <span className="text-[11px] text-muted-foreground italic tracking-wide">Memento Mori</span>
      </button>

      {/* Right side — quick access + grid switcher */}
      <div className="ml-auto flex items-center gap-1">

        <button
          onClick={onHub}
          className={cn(
            "h-9 w-9 inline-flex items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <Network className="h-4 w-4" />
        </button>

        <button
          onClick={onAgent}
          className={cn(
            "h-9 w-9 inline-flex items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <Bot className="h-4 w-4" />
        </button>

        <button
          onClick={onMail}
          className={cn(
            "h-9 w-9 inline-flex items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <Mail className="h-4 w-4" />
        </button>

        <button
          onClick={onMessages}
          className={cn(
            "h-9 w-9 inline-flex items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <MessageSquare className="h-4 w-4" />
        </button>

        <button
          onClick={onClock}
          className={cn(
            "h-9 w-9 inline-flex items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <Clock className="h-4 w-4" />
        </button>

        <button
          onClick={onCalendar}
          className={cn(
            "h-9 w-9 inline-flex items-center justify-center rounded-md",
            "text-muted-foreground transition-colors",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
        >
          <CalendarDays className="h-4 w-4" />
        </button>

        {/* Grid app switcher */}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              className={cn(
                "h-9 w-9 inline-flex items-center justify-center rounded-md",
                "hover:bg-accent hover:text-accent-foreground transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              )}
            >
              <LayoutGrid className="h-5 w-5" />
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              sideOffset={4}
              className={cn(
                "z-50 min-w-[8rem] rounded-md border border-border",
                "bg-popover text-popover-foreground shadow-md p-1",
                "data-[state=open]:animate-in data-[state=closed]:animate-out",
                "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
                "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
                "data-[side=bottom]:slide-in-from-top-2"
              )}
            >
              {!isNexusRunning ? (
                <DropdownMenu.Item
                  disabled
                  className="px-2 py-1.5 text-sm text-muted-foreground select-none"
                >
                  Nexus not running
                </DropdownMenu.Item>
              ) : apps.length === 0 ? (
                <DropdownMenu.Item
                  disabled
                  className="px-2 py-1.5 text-sm text-muted-foreground select-none"
                >
                  No apps connected
                </DropdownMenu.Item>
              ) : (
                apps.map((app) => (
                  <DropdownMenu.Item
                    key={app.id}
                    onSelect={() => onAppSelect?.(app)}
                    className={cn(
                      "relative flex cursor-pointer select-none items-center rounded-sm",
                      "px-2 py-1.5 text-sm outline-none gap-2",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus:bg-accent focus:text-accent-foreground"
                    )}
                  >
                    <span className="w-5 h-5 rounded bg-muted flex items-center justify-center text-xs font-medium shrink-0">
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
