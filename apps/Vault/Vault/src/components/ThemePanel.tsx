import { useCallback, useEffect, useState } from "react";
import {
  applyTheme, readStoredTheme, storeTheme, isDark, normalizeTheme,
  PRESETS, THEME_BOUNDS, DEFAULT_THEME, type Theme,
} from "../lib/theme";

/**
 * The theme, and the six numbers it derives from.
 *
 * Every change applies IMMEDIATELY to the live document rather than to a
 * preview swatch. A colour scheme cannot be judged in a 40px square — the whole
 * question is what a page of text looks like — and the derivation guarantees no
 * setting can produce an unreadable one, so applying live is safe here in a way
 * it would not be with free colour pickers.
 *
 * Persisting is debounced but APPLYING is not: dragging a slider must move the
 * app, while writing localStorage sixty times a second is pointless.
 */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);

  useEffect(() => {
    applyTheme(document.documentElement, theme);
  }, [theme]);

  useEffect(() => {
    const id = setTimeout(() => storeTheme(theme), 250);
    return () => clearTimeout(id);
  }, [theme]);

  return [theme, setTheme];
}

export function ThemePanel({
  theme, onChange,
}: {
  theme: Theme;
  onChange: (t: Theme) => void;
}) {
  const set = useCallback(
    (part: Partial<Theme>) => onChange(normalizeTheme({ ...theme, ...part })),
    [theme, onChange],
  );

  return (
    <div className="theme-panel">
      <div className="theme-presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`theme-swatch${sameTheme(p.theme, theme) ? " is-active" : ""}`}
            onClick={() => onChange(p.theme)}
            title={p.name}
            aria-label={p.name}
            aria-pressed={sameTheme(p.theme, theme)}
            // The swatch shows the theme's own surface and accent, derived by
            // the same function that renders the app — so a preset can never
            // look like something it does not produce.
            style={{
              background: `oklch(${p.theme.bg} ${p.theme.tint} ${p.theme.tintHue})`,
              borderColor: `oklch(${isDark(p.theme) ? 0.7 : 0.5} ${p.theme.accentChroma} ${p.theme.accentHue})`,
            }}
          >
            <span className="theme-swatch-dot"
                  style={{ background: `oklch(${isDark(p.theme) ? 0.72 : 0.45} ${p.theme.accentChroma} ${p.theme.accentHue})` }} />
          </button>
        ))}
        <button
          type="button"
          className="theme-reset"
          onClick={() => onChange(DEFAULT_THEME)}
          title="Back to the default scheme"
        >Reset</button>
      </div>

      <Slider label="Light" value={theme.bg} bounds={THEME_BOUNDS.bg} step={0.005}
              onChange={(bg) => set({ bg })}
              hint={isDark(theme) ? "dark" : "light"} />
      <Slider label="Warmth" value={theme.tint} bounds={THEME_BOUNDS.tint} step={0.001}
              onChange={(tint) => set({ tint })} />
      <Slider label="Warm hue" value={theme.tintHue} bounds={THEME_BOUNDS.tintHue} step={1}
              onChange={(tintHue) => set({ tintHue })} disabled={theme.tint === 0}
              hint={theme.tint === 0 ? "add warmth first" : undefined} />
      <Slider label="Accent" value={theme.accentHue} bounds={THEME_BOUNDS.accentHue} step={1}
              onChange={(accentHue) => set({ accentHue })} />
      <Slider label="Accent strength" value={theme.accentChroma} bounds={THEME_BOUNDS.accentChroma} step={0.005}
              onChange={(accentChroma) => set({ accentChroma })} />
      <Slider label="Contrast" value={theme.contrast} bounds={THEME_BOUNDS.contrast} step={0.005}
              onChange={(contrast) => set({ contrast })} />

      <p className="theme-note">
        Saved on this device. A Mac in a lit room and an iPad in bed want
        different schemes, so the theme deliberately does not follow the account.
      </p>
    </div>
  );
}

function sameTheme(a: Theme, b: Theme): boolean {
  return (Object.keys(a) as Array<keyof Theme>).every((k) => Math.abs(a[k] - b[k]) < 1e-6);
}

function Slider({
  label, value, bounds, step, onChange, disabled, hint,
}: {
  label: string;
  value: number;
  bounds: readonly [number, number];
  step: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <label className={`theme-slider${disabled ? " is-disabled" : ""}`}>
      <span className="theme-slider-label">
        {label}
        {hint ? <em>{hint}</em> : null}
      </span>
      <input
        type="range"
        min={bounds[0]}
        max={bounds[1]}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
