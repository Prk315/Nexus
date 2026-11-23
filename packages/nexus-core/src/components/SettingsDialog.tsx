import type { ReactNode } from "react";
import { Dialog } from "radix-ui";
import { Check, Monitor, Moon, RotateCcw, Sun, X } from "lucide-react";
import { cn } from "../utils";
import { useNexusAppearance } from "../hooks/useAppearance";
import {
  TEXT_SCALE_DEFAULT, TEXT_SCALE_MAX, TEXT_SCALE_MIN,
  UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN, type Theme,
} from "../settings";
import { COLOR_THEMES, colorThemeTokens } from "../colorTheme";

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
  /**
   * Show the Text size slider. Opt-in because it only works in an app whose
   * stylesheet multiplies font sizes by `--nexus-text-scale` — a slider that
   * moves and changes nothing is worse than no slider.
   */
  textSize?: boolean;
  /**
   * Show the colour-theme swatches. Opt-in because themes write the shadcn
   * token names (`--primary`, `--background`, …); an app on its own token
   * vocabulary would see only this dialog change colour.
   */
  colorThemes?: boolean;
}

const THEME_OPTIONS: { value: Theme; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/**
 * The ecosystem-wide Settings dialog, opened from `NexusHeader`'s account
 * menu via `onSettings`. Owns the shared "Appearance" section (theme, UI
 * scale, and — when the app opts in — colour theme and text size, all applied
 * by `useNexusAppearance`); everything app-specific comes in through
 * `sections`.
 */
export function SettingsDialog({ open, onClose, sections, textSize = false, colorThemes = false }: SettingsDialogProps) {
  const {
    theme, uiScale, textScale, colorTheme, isDark,
    setTheme, setUiScale, setTextScale, setColorTheme,
  } = useNexusAppearance();

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

              {/* Colour theme swatches. Each swatch is painted with the
                  theme's own --primary for the CURRENT mode, so what you
                  click is what the buttons will look like. */}
              {colorThemes && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Colour theme</span>
                  <div className="flex flex-wrap items-center gap-2">
                    {COLOR_THEMES.map((t) => {
                      const tokens = colorThemeTokens(t.id, isDark);
                      const selected = colorTheme === t.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => setColorTheme(t.id)}
                          title={t.label}
                          aria-label={`${t.label} colour theme`}
                          aria-pressed={selected}
                          className={cn(
                            "h-7 w-7 rounded-full border inline-flex items-center justify-center transition-shadow",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            selected ? "ring-2 ring-offset-2 ring-offset-popover ring-foreground/60 border-transparent" : "border-border",
                          )}
                          // Neutral has no tokens of its own — it IS the
                          // stylesheet — so its swatch is the foreground ink.
                          style={{ background: tokens?.["--primary"] ?? "var(--foreground)" }}
                        >
                          {selected && (
                            <Check
                              className="h-3.5 w-3.5"
                              style={{ color: tokens?.["--primary-foreground"] ?? "var(--background)" }}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

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

              {/* Text size — fonts only, unlike UI scale which zooms the
                  whole layout. */}
              {textSize && (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label htmlFor="nexus-text-scale" className="text-xs text-muted-foreground">
                      Text size
                    </label>
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs tabular-nums text-foreground">{Math.round(textScale * 100)}%</span>
                      {textScale !== TEXT_SCALE_DEFAULT && (
                        <button
                          onClick={() => setTextScale(TEXT_SCALE_DEFAULT)}
                          title="Reset to 100%"
                          className="h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                        >
                          <RotateCcw className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  </div>
                  <input
                    id="nexus-text-scale"
                    type="range"
                    min={TEXT_SCALE_MIN}
                    max={TEXT_SCALE_MAX}
                    step={0.05}
                    value={textScale}
                    onChange={(e) => setTextScale(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
              )}
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
