import type { CSSProperties } from "react";
import { Check, Repeat2 } from "lucide-react";
import type { SyncedItem } from "@nexus/core/protocol";
import { cn } from "../../lib/utils";
import { SYNCED_META } from "./meta";

/**
 * The tick. A part-based item (routine, stack, meal) shows its count until
 * every part is done; ticking the circle completes — or clears — all of them.
 */
function DoneButton({ item, onToggle }: { item: SyncedItem; onToggle: (i: SyncedItem) => void }) {
  const meta = SYNCED_META[item.kind];
  const partial = !item.done && item.progress.done > 0;
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onToggle(item); }}
      onPointerDown={(e) => e.stopPropagation()}
      title={item.done ? "Mark not done" : item.parts.length > 0 ? "Mark all done" : "Mark done"}
      aria-pressed={item.done}
      className={cn(
        "h-3.5 w-3.5 shrink-0 rounded-full border flex items-center justify-center transition-colors",
        item.done ? meta.ring : "border-current opacity-70 hover:opacity-100",
        partial && "border-dashed",
      )}
    >
      {item.done && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
    </button>
  );
}

function ProgressLabel({ item }: { item: SyncedItem }) {
  if (item.parts.length === 0) return null;
  return (
    <span className="ml-auto shrink-0 text-[10px] tabular-nums opacity-70">
      {item.progress.done}/{item.progress.total}
    </span>
  );
}

/** A Protocol item in the Week / Day time grid. */
export function SyncedCard({ item, style, height, onOpen, onToggle }: {
  item: SyncedItem;
  style: CSSProperties;
  height: number;
  onOpen: (i: SyncedItem) => void;
  onToggle: (i: SyncedItem) => void;
}) {
  const meta = SYNCED_META[item.kind];
  const Icon = meta.icon;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={(e) => { e.stopPropagation(); onOpen(item); }}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(item); } }}
      // The grid treats a press on empty space as "create a block here".
      onPointerDown={(e) => e.stopPropagation()}
      title={`${item.title} — Protocol`}
      className={cn(
        "absolute rounded border px-1.5 py-0.5 overflow-hidden cursor-pointer hover:brightness-110",
        meta.card, meta.text, item.done && "opacity-60",
      )}
      style={style}
    >
      <div className="flex items-center gap-1">
        <DoneButton item={item} onToggle={onToggle} />
        <Icon className="h-2.5 w-2.5 shrink-0 opacity-70" />
        <p className={cn("text-[11px] font-semibold leading-tight truncate", item.done && "line-through")}>{item.title}</p>
        {item.recurring && <Repeat2 className="h-2.5 w-2.5 shrink-0 opacity-60" />}
        <ProgressLabel item={item} />
      </div>
      {height > 30 && item.start_time && (
        <p className={cn("text-[10px] leading-tight opacity-70", item.timeIsDefault && "italic")}>
          {item.start_time}–{item.end_time}
          {item.timeIsDefault && " · default"}
        </p>
      )}
      {height > 46 && item.subtitle && (
        <p className="text-[10px] leading-tight opacity-60 truncate">{item.subtitle}</p>
      )}
    </div>
  );
}

/** A dated-but-untimed Protocol item, in the all-day row. */
export function SyncedChip({ item, onOpen, onToggle }: {
  item: SyncedItem;
  onOpen: (i: SyncedItem) => void;
  onToggle: (i: SyncedItem) => void;
}) {
  const meta = SYNCED_META[item.kind];
  const Icon = meta.icon;
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(item); }}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer hover:brightness-110",
        meta.card, meta.text, item.done && "opacity-60",
      )}
    >
      <DoneButton item={item} onToggle={onToggle} />
      <Icon className="h-2.5 w-2.5 shrink-0 opacity-70" />
      <span className={cn("text-[11px] truncate", item.done && "line-through")}>{item.title}</span>
      <ProgressLabel item={item} />
    </div>
  );
}
