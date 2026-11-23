// The Dashboard-blocks section of the shared Settings dialog: show/hide each
// block (the original pf.dash.blocks toggles) and — since 868 — arrange them:
// drag a block's grip to reorder it within its column, or send it to the
// other column with the arrow button.
//
// Lives in PathFinder, not nexus-core: nexus-core has no notion of a
// "Dashboard" or what's on it. Both stores are the getter/setter/subscribe
// shape of nexus-core's settings.ts, scoped to `pf.dash.*`.

import { Fragment, useSyncExternalStore } from "react";
import { ArrowLeftToLine, ArrowRightToLine, RotateCcw } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  DASH_BLOCK_LABELS,
  getDashBlockVisibility,
  getDashLayout,
  moveDashBlock,
  resetDashLayout,
  setDashBlockVisible,
  setDashLayout,
  subscribeDashBlocks,
  DASH_LAYOUT_DEFAULT,
  type DashBlockId,
  type DashLayoutBlockId,
  type DashRegion,
} from "../../lib/dashBlocks";
import { useRowReorder, GripHandle, ReorderIndicator } from "../common";

function VisibilityBox({ id, checked }: { id: DashBlockId; checked: boolean }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => setDashBlockVisible(id, e.target.checked)}
      className="h-3.5 w-3.5 rounded border-input accent-primary"
    />
  );
}

/** One column's blocks — a sibling group for useRowReorder, which already
 *  owns the threshold/insertion-line/Escape contract the task trees use. */
function RegionList({ region, ids, title }: { region: DashRegion; ids: DashLayoutBlockId[]; title: string }) {
  const visibility = useSyncExternalStore(subscribeDashBlocks, getDashBlockVisibility);
  // The ids are strings; useRowReorder is keyed by number, so index them.
  const reorder = useRowReorder(ids.map((_, i) => i), (orderedIdx) => {
    const layout = getDashLayout();
    const next = orderedIdx.map((i) => ids[i]);
    setDashLayout(region === "main" ? { ...layout, main: next } : { ...layout, rail: next });
  });
  const other: DashRegion = region === "main" ? "rail" : "main";

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{title}</span>
      {ids.length === 0 && (
        <p className="text-[11px] italic text-muted-foreground/60 px-1 py-1">Empty</p>
      )}
      {ids.map((id, i) => (
        <Fragment key={id}>
          {reorder.insertion === i && <ReorderIndicator />}
          <div
            ref={reorder.registerRow(i)}
            className={cn(
              "group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-secondary/50",
              reorder.draggingId === i && "opacity-40",
            )}
          >
            <GripHandle onPointerDown={reorder.handlePointerDown(i)} />
            <label className="flex flex-1 min-w-0 items-center gap-2 text-sm text-foreground cursor-pointer select-none">
              <VisibilityBox id={id} checked={visibility[id]} />
              <span className={cn("truncate", !visibility[id] && "text-muted-foreground line-through")}>
                {DASH_BLOCK_LABELS[id]}
              </span>
            </label>
            <button
              type="button"
              title={other === "rail" ? "Move to the side rail" : "Move to the main column"}
              onClick={() => {
                const layout = getDashLayout();
                setDashLayout(moveDashBlock(layout, id, other, layout[other].length));
              }}
              className="shrink-0 rounded p-0.5 text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
            >
              {other === "rail" ? <ArrowRightToLine className="h-3.5 w-3.5" /> : <ArrowLeftToLine className="h-3.5 w-3.5" />}
            </button>
          </div>
        </Fragment>
      ))}
      {reorder.insertion === ids.length && <ReorderIndicator />}
    </div>
  );
}

export function DashBlocksSettings() {
  const visibility = useSyncExternalStore(subscribeDashBlocks, getDashBlockVisibility);
  const layout = useSyncExternalStore(subscribeDashBlocks, getDashLayout);
  const isDefault =
    layout.main.join() === DASH_LAYOUT_DEFAULT.main.join() &&
    layout.rail.join() === DASH_LAYOUT_DEFAULT.rail.join();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          Dashboard blocks
        </h3>
        {!isDefault && (
          <button
            type="button"
            onClick={resetDashLayout}
            title="Restore the default arrangement"
            className="inline-flex items-center gap-1 rounded px-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Reset layout
          </button>
        )}
      </div>

      {/* The welcome header spans both columns, so it has no position to
          choose — only visibility. */}
      <label className="flex items-center gap-2 px-1 text-sm text-foreground cursor-pointer select-none">
        <VisibilityBox id="welcome" checked={visibility.welcome} />
        {DASH_BLOCK_LABELS.welcome}
        <span className="text-[11px] text-muted-foreground/60">(top)</span>
      </label>

      <RegionList region="main" ids={layout.main} title="Main column" />
      <RegionList region="rail" ids={layout.rail} title="Side rail (desktop only)" />
      <p className="text-[11px] text-muted-foreground/60">
        Drag the grip to reorder; the arrow moves a block to the other column.
        The side rail's width is resized by dragging its edge on the dashboard.
      </p>
    </div>
  );
}
