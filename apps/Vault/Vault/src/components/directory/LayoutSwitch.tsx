import type { LayoutMode } from "./useDirectory";

// ⚠️ THE ONE-WAY DOOR THIS FIXES.
//
// The switch used to live only inside `DirectoryShell`'s header — which is
// rendered only by the grid layout. So pressing "Classic layout" once stored
// `classic`, unmounted the shell, and took the switch down with it: the
// preference survives a reload, the control does not, and there is no way back
// short of knowing `?layout=grid` or clearing localStorage. Comparing the two
// layouts is the whole point of the toggle, so the first comparison was a trap.
//
// It is one component rendered by BOTH layouts for exactly that reason: a
// control that turns something off has to exist in the state it produces.

interface Props {
  layout: LayoutMode;
  onLayout: (m: LayoutMode) => void;
  /** Compact form for the classic sidebar header, which is already crowded. */
  compact?: boolean;
}

export function LayoutSwitch({ layout, onLayout, compact }: Props) {
  const next: LayoutMode = layout === "grid" ? "classic" : "grid";
  const label = next === "classic" ? "Classic layout" : "Directory layout";
  return (
    <button
      className={`vault-layout-btn${compact ? " is-compact" : ""}`}
      onClick={() => onLayout(next)}
      title={`Switch to the ${next === "classic" ? "existing" : "directory prototype"} layout`}
      aria-label={label}
    >
      {compact ? "⊞" : label}
    </button>
  );
}
