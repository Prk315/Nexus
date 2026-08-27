import type { ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Monitor, Moon, RotateCcw, Sun, X } from "lucide-react";
import { cn } from "../utils";
import { useNexusAppearance } from "../hooks/useAppearance";
import { UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN, type Theme } from "../settings";

export interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * App-specific settings, rendered below the shared Appearance section.
   * nexus-core can't know what a given app wants to expose (PathFinder's
   * dashboard-blocks toggles, say), so the caller supplies its own section
   * and this dialog just gives it a consistent frame.
   */
  sections?: ReactNode;
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * The ecosystem-wide Settings dialog, opened from `NexusHeader`'s account
 * menu via `onSettings`. Owns the shared "Appearance" section (theme + UI
 * scale, both applied by `useNexusAppearance`); everything app-specific comes
 * in through `sections`.
 */
export function SettingsDialog({ open, onClose, sections }: SettingsDialogProps) {
  const { theme, uiScale, setTheme, setUiScale } = useNexusAppearance();

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2",
            "max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-popover text-popover-foreground shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          )}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <Dialog.Title className="text-sm font-semibold">Settings</Dialog.Title>
            <Dialog.Close asChild>
              <button
                title="Close"
                className="h-6 w-6 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-4 flex flex-col gap-5">
            {/* ── Appearance ─────────────────────────────────────────────── */}
            <section className="flex flex-col gap-3">
              <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                Appearance
              </h3>

              {/* Theme segmented control */}
              <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
                {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    aria-pressed={theme === value}
                    className={cn(
                      "flex-1 inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                      theme === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              {/* UI scale slider */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label htmlFor="nexus-ui-scale" className="text-xs text-muted-foreground">
                    UI scale
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs tabular-nums text-foreground">{Math.round(uiScale * 100)}%</span>
                    {uiScale !== UI_SCALE_DEFAULT && (
                      <button
                        onClick={() => setUiScale(UI_SCALE_DEFAULT)}
                        title="Reset to 100%"
                        className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                      >
                        <RotateCcw className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                <input
                  id="nexus-ui-scale"
                  type="range"
                  min={UI_SCALE_MIN}
                  max={UI_SCALE_MAX}
                  step={0.05}
                  value={uiScale}
                  onChange={(e) => setUiScale(Number(e.target.value))}
                  className="w-full accent-primary"
                />
              </div>
            </section>

            {sections && (
              <section className="flex flex-col gap-3 border-t border-border pt-4">
                {sections}
              </section>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
