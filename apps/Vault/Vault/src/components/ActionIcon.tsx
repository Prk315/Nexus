import { Icon } from "../extensions/icons";
import type { BlockAction } from "../extensions/blockRegistry";

/**
 * One place every surface draws an action's icon.
 *
 * There are four of them — toolbar buttons, the toolbar's menus, the bubble and
 * the slash list — and before this each interpolated `a.icon` itself. That is
 * how the set drifted: an action added with a glyph looked fine in the one
 * surface its author was looking at.
 *
 * The legacy `icon` string is still the fallback, but `iconCoverage.test.ts`
 * asserts no action reaches it. A single Unicode glyph among sixty SVGs is more
 * obviously wrong than sixty inconsistent glyphs were, so the mixed state is
 * refused at test time rather than allowed to appear quietly.
 */
export function ActionIcon({ action, size }: { action: BlockAction; size?: number }) {
  if (action.iconName) return <Icon name={action.iconName} size={size} />;
  return <>{action.icon}</>;
}
