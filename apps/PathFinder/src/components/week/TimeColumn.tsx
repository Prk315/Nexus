// One day's timed column, and the all-day task chip with its popup card.

import { useEffect, useState, useCallback, useRef } from "react";
import { Check, RefreshCw, Repeat2, MapPin, GraduationCap, CalendarOff, CalendarRange, Eye, EyeOff, Users } from "lucide-react";
import { cn, layoutCalItems, PRIORITY_LABEL, URGENCY_LABEL, STAGE_LABEL, STAGE_CLASSES } from "../../lib/utils";
import { planningOf, isFullTask } from "../../lib/taskTree";
import { isSystemScheduledOn } from "../../lib/systems";
import { chipBgClasses, chipCheckClasses, PRIORITY_TEXT } from "../task/taskVisual";
import { DueChip } from "../task/DueChip";
import { memberName } from "../../lib/api";
import { TaskActionMenu, InlineEditText } from "../common";
import type { TaskWithContext, SystemEntry, CalBlock, CourseAssignment, ScheduleEntry, TaskSession } from "../../types";
import { BLOCK_COLORS, GRID_END_MIN, HOURS, HOUR_START, fmtWeekMinutes, minutesToPx, pxToTime, timeToMinutes, toISO } from "./_shared";
import type { Span } from "@nexus/core/coverage";
import type { ActualDay } from "../../lib/actual";
import type { CoverageCategoryOption } from "../../lib/api";
import { ActualOverlay, SleepBand } from "./overlays";
import type { WeekInteractions, ExternalDragPayload } from "./useWeekInteractions";

// Resize grab-zone height, and the minimum card height that leaves room for
// one (spec U2 §2: "6px grab zones ... Only on blocks tall enough (≥ 24px)").
const RESIZE_HANDLE_PX = 6;
const RESIZE_MIN_CARD_PX = 24;

export function TaskPopupChip({ t, today, parentTitle, scheduledMin, hasSteps, interactions, dragPayload, onToggle, onEdit, onRename }: {
  t: TaskWithContext;
  /** Today's ISO date, for the popup's due chip (overdue/today/plain). */
  today: string;
  /** Set when this is a step of a larger task — shown so it isn't an orphan line. */
  parentTitle?: string | null;
  /** Committed calendar minutes across the task's subtree, all time. */
  scheduledMin: number;
  /** True when the task is broken down — completing it means completing its steps. */
  hasSteps?: boolean;
  /** Undefined on mobile (desktop-only, U3 Part A) and in the mobile all-day
   *  strip — every drag-to-schedule code path below is gated on this. */
  interactions?: WeekInteractions;
  /** Precomputed once per render by the caller (needs allTasks + taskCoverage,
   *  which this component doesn't have) — what dragging this chip onto the
   *  grid would create. Only read when `interactions` is also set. */
  dragPayload?: ExternalDragPayload;
  onToggle: () => void;
  onEdit: () => void;
  /** Present → a compact kebab (hover-reveal) offers Rename + Open. Omit to keep the chip read-only. */
  onRename?: (title: string) => void;
}) {
  const chipRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // Priority tint + done state (spec U3 Part B — the shared task-visual
  // vocabulary) — the SAME hue set and emerald-done rule as every other
  // task surface (Dashboard rows, MonthView pills).
  const chip = chipBgClasses(t.priority, t.done);
  const check = chipCheckClasses(t.priority, t.done);
  const isDraggingThis = interactions?.externalDraggingTaskId === t.id;

  // close on outside click
  useEffect(() => {
    if (!pos) return;
    function down(e: MouseEvent) {
      const t = e.target as Node;
      if (!chipRef.current?.contains(t) && !cardRef.current?.contains(t)) {
        setPos(null);
      }
    }
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, [pos]);

  function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (interactions?.consumeWasDrag()) return; // a real drag just ended — swallow the trailing click
    if (pos) { setPos(null); return; }
    const r = chipRef.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 224) });
  }

  return (
    <>
      <div
        ref={chipRef}
        onClick={toggle}
        onPointerDown={interactions && dragPayload ? (e) => interactions.onExternalDragPointerDown(e, dragPayload) : undefined}
        className={cn(
          "group/chip flex items-center gap-1 px-1.5 py-0.5 rounded border cursor-pointer transition-colors select-none",
          chip,
          interactions && dragPayload && "cursor-grab",
          isDraggingThis && "opacity-30",
        )}
      >
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); if (!hasSteps) onToggle(); }}
          disabled={hasSteps}
          title={hasSteps ? "Finish its steps to complete this" : undefined}
          className={cn(
            "flex h-3 w-3 shrink-0 items-center justify-center rounded border transition-colors",
            check,
            hasSteps && "opacity-40 cursor-default",
          )}
        >
          {t.done && <Check className="h-2 w-2 text-white" />}
        </button>
        {/*
          Density pass (spec U3 Part C): first glance is title + priority tint
          + done state. Urgency used to render here too — it still shows in
          the click popup below, which is where "everything else" belongs.
        */}
        {onRename ? (
          <span
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="min-w-0 flex-1"
          >
            <InlineEditText
              value={t.title}
              onCommit={onRename}
              editing={renaming}
              onEditingChange={setRenaming}
              className={cn("text-[11px] truncate", t.done ? "line-through text-muted-foreground" : "text-foreground")}
            >
              {parentTitle && <span className="opacity-50">{parentTitle} › </span>}
              {t.title}
            </InlineEditText>
          </span>
        ) : (
          <span className={cn("text-[11px] truncate flex-1", t.done ? "line-through text-muted-foreground" : "text-foreground")}>
            {parentTitle && <span className="opacity-50">{parentTitle} › </span>}
            {t.title}
          </span>
        )}
        {/*
          Due here, but no time committed anywhere. This is the one fact a weekly
          overview can tell you that a task list can't, and it is the same
          predicate the board's stage gate uses — so the two views agree.
          Stays first-glance (Part C): it's actionable, not decoration.
        */}
        {t.team_id != null && (
          <span
            className="shrink-0 inline-flex items-center text-muted-foreground/50"
            title={t.assigned_to != null && t.assigned_to !== "all" ? `Team task · ${memberName(t.assigned_to)}` : "Team task · everyone"}
          >
            <Users className="h-2.5 w-2.5" />
          </span>
        )}
        {!t.done && isFullTask(t) && scheduledMin === 0 && (
          <CalendarOff className="h-2.5 w-2.5 shrink-0 text-amber-500" />
        )}
        {onRename && (
          <div
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="shrink-0 opacity-0 group-hover/chip:opacity-100 transition-opacity"
          >
            <TaskActionMenu
              task={t}
              open={menuOpen}
              onOpenChange={setMenuOpen}
              className="h-4 w-4"
              callbacks={{ onRename: () => setRenaming(true), onOpen: onEdit }}
            />
          </div>
        )}
      </div>

      {pos && (
        <div
          ref={cardRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-56 rounded-xl border border-border bg-card shadow-2xl p-3 flex flex-col gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-2">
            <p className={cn("text-xs font-semibold leading-snug flex items-center gap-1", t.done ? "line-through text-muted-foreground" : "text-foreground")}>
              {t.title}
              {t.team_id != null && (
                <Users
                  className="h-2.5 w-2.5 shrink-0 text-muted-foreground/50"
                  aria-label={t.assigned_to != null && t.assigned_to !== "all" ? `Team task · ${memberName(t.assigned_to)}` : "Team task · everyone"}
                />
              )}
            </p>
            {/* "Everything else" the collapsed chip demoted (Part C) — the
                due date lands here, same encoding as every other surface. */}
            {t.due_date && <DueChip due={t.due_date} today={today} />}
          </div>

          <div className="flex flex-col gap-0.5">
            {t.plan_title && <p className="text-[11px] text-muted-foreground truncate">Plan: {t.plan_title}</p>}
            {t.goal_title && <p className="text-[11px] text-muted-foreground truncate">Goal: {t.goal_title}</p>}
          </div>

          <div className="flex items-center gap-2">
            <span className={cn("text-[11px] font-medium", PRIORITY_TEXT[t.priority] ?? "text-muted-foreground")}>
              {PRIORITY_LABEL[t.priority] ?? t.priority} priority
            </span>
            {isFullTask(t) && (
              <span className="text-[11px] text-muted-foreground">
                · {URGENCY_LABEL[planningOf(t).urgency]}
              </span>
            )}
            {t.done && <span className="text-[11px] font-medium text-emerald-500 ml-auto">✓ Done</span>}
          </div>

          {isFullTask(t) && (
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className={cn("rounded-full border px-1.5 py-px font-medium", STAGE_CLASSES[planningOf(t).stage])}>
                {STAGE_LABEL[planningOf(t).stage]}
              </span>
              <span className={cn("tabular-nums", scheduledMin === 0 ? "text-amber-500" : "text-muted-foreground")}>
                {scheduledMin === 0
                  ? "No time booked"
                  : `${fmtWeekMinutes(scheduledMin)} booked${t.aggregate_estimate ? ` of ${fmtWeekMinutes(t.aggregate_estimate)}` : ""}`}
              </span>
            </div>
          )}

          <div className="flex gap-2 pt-1 border-t border-border">
            <button
              onClick={(e) => { e.stopPropagation(); if (!hasSteps) { onToggle(); setPos(null); } }}
              disabled={hasSteps}
              title={hasSteps ? "Finish its steps to complete this" : undefined}
              className="flex-1 text-[11px] py-1 rounded-md border border-border hover:bg-secondary transition-colors text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
            >
              {hasSteps ? "Has steps" : t.done ? "Mark undone" : "Mark done"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); setPos(null); onEdit(); }}
              className="flex-1 text-[11px] py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              Edit
            </button>
          </div>
        </div>
      )}
    </>
  );
}

// ── Nested cal block card ────────────────────────────────────────────────────
//
// A block can contain its own children (a Deep-work segment scheduled inside
// a 10-13 "transport" task) — this component is what makes a block a
// CONTAINER instead of a flat leaf. It renders itself, then recurses into its
// own children the same way, so "tasks within tasks" is just this component
// calling itself with `depth + 1`.
//
// Coordinate system: `style` (passed in by the caller) is this card's own
// absolute box — {top, height, left, right} in the SAME minute→px units the
// grid uses for everything else. A child's position is computed the same
// way and made relative to ITS PARENT's box, so a child 11:00–11:45 inside a
// parent 10:57–12:06 sits at exactly the pixel offset (11:00 - 10:57) from
// the parent's own top — proportional to real time, not to the parent's
// rendered pixel height. The header (title/time/tick) is an OVERLAY pinned
// to the card's top edge rather than a flow element that reserves space —
// reserving space would shift every child down by the header's height and
// break that exact alignment.
const NEST_INSET_PX = 8;
const NEST_MAX_INSET_LEVEL = 3; // inset visually caps after this many levels; deeper data still renders
const NEST_MIN_PARENT_PX = 48;  // below this, children collapse to a count badge instead of drawing slivers
const NEST_MIN_CHILD_PX = 14;   // ...or if ANY child would render thinner than this
const NEST_MAX_DEPTH = 24;      // pure runaway-recursion guard; real chains are refused at write time

function CalBlockCard({
  block, depth, style, childrenOf, categories, sessionsByBlock, hiddenIds, toggleHidden, onClickBlock, onToggleWorked,
  hourPx, interactions, columnIso,
}: {
  block: CalBlock;
  /** 0 for a top-level (parentless) block, 1 for its direct children, and so on. */
  depth: number;
  style: React.CSSProperties;
  childrenOf: Map<number, CalBlock[]>;
  categories: CoverageCategoryOption[];
  sessionsByBlock: Map<number, TaskSession>;
  hiddenIds: Set<string>;
  toggleHidden: (id: string) => void;
  onClickBlock: (b: CalBlock) => void;
  onToggleWorked: (b: CalBlock) => void;
  hourPx: number;
  /** Undefined on mobile — every pointer-drag code path below is gated on this. */
  interactions?: WeekInteractions;
  /** The day column this card (and its whole subtree) belongs to. */
  columnIso: string;
}) {
  if (depth > NEST_MAX_DEPTH) return null; // defensive only — cycles are refused before they can be saved

  const clr = BLOCK_COLORS[block.color] ?? BLOCK_COLORS.blue;
  const cbId = `cb-${block.recurring_id ?? block.id}-${block.date}`;
  const cbHidden = hiddenIds.has(cbId);
  // A block committed to a task can be worked off right here at ANY depth: a
  // child linked to a subtask is ticked independently of its parent/siblings.
  const worked = block.task_id != null && sessionsByBlock.has(block.id);
  const children = childrenOf.get(block.id) ?? [];
  const small = depth > 0;

  const startMin = timeToMinutes(block.start_time);
  const endMin = timeToMinutes(block.end_time);
  const heightPx = typeof style.height === "number" ? style.height : Number(style.height ?? 0) || 0;

  // Each child's position/height within THIS card, proportional to real time
  // and clamped into this card's own span — a child whose times spill past
  // the parent is rendered clamped with a warning edge rather than hidden.
  const childLayout = children.map((child) => {
    const cStart = timeToMinutes(child.start_time);
    const cEnd = timeToMinutes(child.end_time);
    // Clamp BOTH ends into [startMin, endMin] — a child entirely before or
    // entirely after the parent's span (e.g. the parent was edited shorter
    // after the child was created) must still land inside the card as a
    // clamped sliver, not at an out-of-box offset that `overflow-hidden`
    // then clips into invisibility.
    const clampedStart = Math.min(Math.max(cStart, startMin), endMin);
    const clampedEnd = Math.max(Math.min(cEnd, endMin), startMin);
    const top = minutesToPx(clampedStart, hourPx) - minutesToPx(startMin, hourPx);
    const height = Math.max(1, minutesToPx(clampedEnd, hourPx) - minutesToPx(clampedStart, hourPx));
    const spills = cStart < startMin || cEnd > endMin;
    return { child, top, height, spills };
  });

  const collapse = children.length > 0 && (
    heightPx < NEST_MIN_PARENT_PX || childLayout.some((c) => c.height < NEST_MIN_CHILD_PX)
  );

  // U2: pointer-drag wiring — entirely additive, and a no-op tree whenever
  // `interactions` is undefined (mobile). `draggable` false for virtual
  // recurring occurrences: cursor-default, no handlers armed at all (spec §2).
  const draggable = interactions ? interactions.isDraggable(block) : false;
  const isDragSource = interactions?.draggingId === block.id;
  const isDropTarget = interactions?.isDropTarget(block.id) ?? false;
  // Resize handles are offered only on LEAF cards (no children): a parent's
  // top edge sits directly under the header, and its body zone can start a
  // child at the parent's own start time (the common "Add segment" prefill)
  // — layering a pointer-events-auto resize strip there would re-create the
  // exact header-eats-child-clicks bug the U1 review just fixed. Resizing a
  // parent stays a modal edit, same as before U2.
  const canResize = interactions && draggable && children.length === 0 && heightPx >= RESIZE_MIN_CARD_PX;

  return (
    <div
      style={style}
      className={cn(
        "absolute rounded border overflow-hidden group",
        small ? "px-1 py-px" : "px-1.5 py-0.5",
        clr.bg, clr.border,
        interactions ? (draggable ? "cursor-pointer" : "cursor-default") : "cursor-pointer",
        cbHidden && "opacity-15",
        worked && "ring-1 ring-emerald-400/60",
        isDragSource && "opacity-30",
        isDropTarget && "ring-2 ring-primary ring-offset-1",
      )}
      onPointerDown={interactions ? (e) => {
        // Stops the column background's own pointerdown (pan / click-to-
        // create) from also seeing this gesture — the same delegation-guard
        // role the click handler's stopPropagation already played below.
        e.stopPropagation();
        // Called unconditionally (not just when `draggable`) — the hook
        // itself now no-ops for a non-draggable (virtual recurring) block,
        // and that no-op path is what clears a stale wasDragRef flag left
        // over from an unrelated drag elsewhere (see useWeekInteractions).
        interactions.onBlockPointerDown(e, block, columnIso);
      } : undefined}
      onClick={(e) => {
        e.stopPropagation();
        if (interactions?.consumeWasDrag()) return; // a real drag just ended — swallow the trailing click
        onClickBlock(block);
      }}
    >
      {canResize && (
        <>
          <div
            className="absolute top-0 left-0 right-0 z-30"
            style={{ height: RESIZE_HANDLE_PX, cursor: "ns-resize" }}
            onPointerDown={(e) => { e.stopPropagation(); interactions!.onResizePointerDown(e, block, "top", columnIso); }}
            onClick={(e) => e.stopPropagation()}
          />
          <div
            className="absolute bottom-0 left-0 right-0 z-30"
            style={{ height: RESIZE_HANDLE_PX, cursor: "ns-resize" }}
            onPointerDown={(e) => { e.stopPropagation(); interactions!.onResizePointerDown(e, block, "bottom", columnIso); }}
            onClick={(e) => e.stopPropagation()}
          />
        </>
      )}
      {/* Visibility toggle — top-level only. Hiding a parent hides its whole
          subtree for free (the parent's own DOM node, children included,
          just dims); a per-child toggle isn't offered, matching the header
          zone spec (title/time/tick only). */}
      {depth === 0 && (
        <button
          className={cn("absolute top-0.5 right-0.5 z-20 p-0.5 rounded transition-opacity", cbHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); toggleHidden(cbId); }}
        >
          {cbHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
        </button>
      )}

      {/* Header zone — pinned to the top of the card (relative flow, but the
          body below is absolutely positioned so it never pushes on this).
          `pointer-events-none` on the wrapper is load-bearing: a child that
          starts at (or near) this card's own start time — the common case,
          since an empty parent's first free sub-span IS the parent's start —
          renders directly underneath this header in the body zone below.
          Without this, the header's bounding box (blank space included, not
          just the glyphs) would win hit-testing over that whole area and
          every click there would open the PARENT instead of the child.
          Interactive header controls opt back in with pointer-events-auto. */}
      <div className="relative z-10 pointer-events-none">
        <div className="flex items-center gap-1">
          {block.task_id != null && (
            <button
              title={worked ? "Worked — click to undo" : "Mark this block as worked"}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onToggleWorked(block); }}
              className={cn(
                "pointer-events-auto flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                worked
                  ? "bg-emerald-500 border-emerald-500 text-white"
                  : cn("border-current opacity-50 hover:opacity-100", clr.text),
              )}
            >
              {worked && <Check className="h-2 w-2" />}
            </button>
          )}
          {block.is_recurring && <Repeat2 className={cn("h-2.5 w-2.5 shrink-0 opacity-70", clr.text)} />}
          <p className={cn(small ? "text-[10px]" : "text-[11px]", "font-semibold leading-tight truncate", clr.text, worked && "line-through opacity-70")}>
            {block.category && categories.find((c) => c.name === block.category)?.emoji
              ? `${categories.find((c) => c.name === block.category)!.emoji} `
              : ""}
            {block.title}
          </p>
          {/* Degradation: too small to draw children as real cards — a count
              badge instead of slivers. */}
          {collapse && (
            <span className={cn("pointer-events-auto ml-auto shrink-0 text-[9px] font-medium opacity-80", clr.text)} title={`${children.length} nested inside`}>
              ▤ {children.length}
            </span>
          )}
        </div>
        {heightPx > 30 && (
          <p className={cn("text-[10px] leading-tight opacity-70", clr.text)}>{block.start_time}–{block.end_time}</p>
        )}
        {heightPx > 46 && block.location && (
          <div className={cn("flex items-center gap-0.5 mt-0.5", clr.text)}>
            <MapPin className="h-2.5 w-2.5 shrink-0 opacity-70" />
            <p className="text-[10px] leading-tight opacity-70 truncate">{block.location}</p>
          </div>
        )}
      </div>

      {/* Body zone — children, absolutely positioned by real time within
          this card. The parent's own background stays visible around them
          (unsegmented time), and recursion is just this component rendering
          its own children the same way. */}
      {children.length > 0 && !collapse && (
        <div className="absolute inset-0">
          {childLayout.map(({ child, top, height, spills }) => {
            const inset = depth + 1 <= NEST_MAX_INSET_LEVEL ? NEST_INSET_PX : 0;
            return (
              <CalBlockCard
                key={child.id}
                block={child}
                depth={depth + 1}
                style={{
                  position: "absolute", top, height, left: inset, right: inset,
                  // Spill warning — a thin amber edge, not a hide. The child
                  // still renders clamped into this card's own box (`top`/
                  // `height` above are already clamped to [startMin, endMin]).
                  boxShadow: spills ? "inset 0 0 0 1.5px rgba(245, 158, 11, 0.85)" : undefined,
                }}
                childrenOf={childrenOf}
                categories={categories}
                sessionsByBlock={sessionsByBlock}
                hiddenIds={hiddenIds}
                toggleHidden={toggleHidden}
                onClickBlock={onClickBlock}
                onToggleWorked={onToggleWorked}
                hourPx={hourPx}
                interactions={interactions}
                columnIso={columnIso}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Time column ───────────────────────────────────────────────────────────────

export function TimeColumn({ date, isToday, blocks, systems, courseAssignments, scheduleEntries, actual, sleepSpans, categories, sessionsByBlock, hourPx, interactions, onClickSlot, onClickBlock, onToggleWorked }: {
  date: Date; isToday: boolean;
  blocks: CalBlock[];
  systems: SystemEntry[];
  courseAssignments: CourseAssignment[];
  scheduleEntries: ScheduleEntry[];
  actual?: ActualDay;
  /** Always-on sleep band spans for this day — independent of `actual`/the Actual toggle. */
  sleepSpans?: Span[];
  /** For the block-label emoji prefix; empty array renders blocks with no prefix. */
  categories: CoverageCategoryOption[];
  /** Sessions already logged, keyed by the occurrence's cal_block_id. */
  sessionsByBlock: Map<number, TaskSession>;
  /** Pixels-per-hour — the desktop zoom scale, or the fixed HOUR_PX default on mobile. */
  hourPx: number;
  /** Undefined on mobile: every U2 pointer-drag/pan code path below is gated on this. */
  interactions?: WeekInteractions;
  onClickSlot: (date: string, time: string) => void;
  onClickBlock: (b: CalBlock) => void;
  onToggleWorked: (b: CalBlock) => void;
}) {
  const iso = toISO(date);
  const colRef = useRef<HTMLDivElement>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const toggleHidden = useCallback((id: string) => {
    setHiddenIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  // Reports this column's own grid element up to the interactions hook, so
  // it can turn a clientX/clientY into "which day, which minute" without
  // TimeColumn needing to know anything about drag geometry itself. A no-op
  // on mobile (`interactions` undefined).
  useEffect(() => {
    interactions?.registerColumn(iso, colRef.current);
    return () => interactions?.registerColumn(iso, null);
  }, [interactions, iso]);

  function handleClick(e: React.MouseEvent) {
    if (!colRef.current) return;
    const rect = colRef.current.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const time = pxToTime(y, HOURS.length * hourPx, hourPx);
    onClickSlot(iso, time);
  }

  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowPx = minutesToPx(nowMin, hourPx);
  // GRID_END_MIN (midnight), not HOUR_END * 60 (23:00) — see the comment on
  // GRID_END_MIN. With the old bound the now-line silently vanished for the
  // whole 23:00-24:00 hour.
  const showNow = isToday && nowMin >= HOUR_START * 60 && nowMin <= GRID_END_MIN;

  return (
    <div className={cn("flex-1 min-w-0 border-r border-border relative", isToday && "bg-primary/[0.03]")}>
      {/* Time grid */}
      <div
        ref={colRef}
        className="relative flex-1 cursor-crosshair"
        style={{ height: HOURS.length * hourPx }}
        // Below the 4px threshold this fires onClickSlot exactly like the
        // old onClick did (spec §3: "Plain click on empty cell still
        // creates a block"); past it, it pans the scroll container instead
        // and no modal opens. Mobile (`interactions` undefined) keeps the
        // original plain onClick untouched.
        onPointerDown={interactions ? (e) => interactions.onBackgroundPointerDown(e, iso) : undefined}
        onClick={interactions ? undefined : handleClick}
      >
        {/* Hour lines */}
        {HOURS.map((h, i) => (
          <div key={h} className="absolute left-0 right-0 border-t border-border/30"
            style={{ top: i * hourPx }} />
        ))}
        {/* Half-hour lines */}
        {HOURS.slice(0, -1).map((h, i) => (
          <div key={`${h}h`} className="absolute left-0 right-0 border-t border-border/10 border-dashed"
            style={{ top: i * hourPx + hourPx / 2 }} />
        ))}

        {/* Sleep band — ALWAYS on, independent of the Actual toggle */}
        {sleepSpans && sleepSpans.length > 0 && <SleepBand spans={sleepSpans} iso={iso} hourPx={hourPx} />}

        {/* Actual-day overlay (screen/training) — behind everything else, purely visual */}
        {actual && <ActualOverlay actual={actual} iso={iso} hourPx={hourPx} />}

        {/* Current time indicator */}
        {showNow && (
          <div className="absolute left-0 right-0 z-10 flex items-center pointer-events-none"
            style={{ top: nowPx }}>
            <div className="h-2 w-2 rounded-full bg-primary shrink-0 -ml-1" />
            <div className="flex-1 border-t-2 border-primary" />
          </div>
        )}

        {/* All timed events — unified overlap layout */}
        {(() => {
          const timedSys = systems.filter((s) => s.start_time && isSystemScheduledOn(s, iso));
          const timedCAs = courseAssignments.filter((a) => a.start_time);
          const timedSEs = scheduleEntries.filter((e) => e.start_time);

          // Nested blocks: a block whose parent_block_id points at another
          // block present in THIS day's list attaches under it and never
          // claims its own overlap column. Orphans — no parent, a parent on
          // another date (impossible here since `blocks` is already this
          // day's only), or a parent that's been deleted/not loaded — render
          // top-level, same as before nesting existed. A block is never
          // dropped. `pid !== b.id` is a defensive no-op (the DB CHECK
          // already refuses a self-parent) and `blocksById.has` alone can't
          // walk a multi-hop cycle, so a stale cyclic chain sitting in
          // already-loaded data (which the write-time guard cannot happen
          // after the fact) is capped by depth, not detected here — see
          // CalBlockCard's own depth guard below.
          const blocksById = new Map(blocks.map((b) => [b.id, b]));
          const childrenOf = new Map<number, CalBlock[]>();
          const topLevelBlocks: CalBlock[] = [];
          for (const b of blocks) {
            const pid = b.parent_block_id;
            if (pid != null && pid !== b.id && blocksById.has(pid)) {
              const list = childrenOf.get(pid);
              if (list) list.push(b); else childrenOf.set(pid, [b]);
            } else {
              topLevelBlocks.push(b);
            }
          }

          type WkEvt =
            | { kind: "sys"; startMin: number; endMin: number; s: SystemEntry }
            | { kind: "ca";  startMin: number; endMin: number; a: CourseAssignment }
            | { kind: "blk"; startMin: number; endMin: number; b: CalBlock }
            | { kind: "se";  startMin: number; endMin: number; e: ScheduleEntry };

          const evts: WkEvt[] = [
            ...timedSys.map((s) => ({
              kind: "sys" as const,
              startMin: timeToMinutes(s.start_time!),
              endMin:   s.end_time ? timeToMinutes(s.end_time) : timeToMinutes(s.start_time!) + 60,
              s,
            })),
            ...timedCAs.map((a) => ({
              kind: "ca" as const,
              startMin: timeToMinutes(a.start_time!),
              endMin:   a.end_time ? timeToMinutes(a.end_time) : timeToMinutes(a.start_time!) + 60,
              a,
            })),
            // Only TOP-LEVEL blocks go through the overlap algorithm —
            // children are drawn inside their parent's own card, below.
            ...topLevelBlocks.map((b) => ({
              kind: "blk" as const,
              startMin: timeToMinutes(b.start_time),
              endMin:   timeToMinutes(b.end_time),
              b,
            })),
            ...timedSEs.map((e) => ({
              kind: "se" as const,
              startMin: timeToMinutes(e.start_time!),
              endMin:   e.end_time ? timeToMinutes(e.end_time) : timeToMinutes(e.start_time!) + 60,
              e,
            })),
          ];

          return layoutCalItems(evts).map(({ item, col, totalCols }) => {
            const top    = minutesToPx(item.startMin, hourPx);
            const height = Math.max(20, minutesToPx(item.endMin, hourPx) - top);
            const left   = `calc(${(col / totalCols) * 100}% + 1px)`;
            const right  = `calc(${((totalCols - col - 1) / totalCols) * 100}% + 1px)`;

            if (item.kind === "sys") {
              const { s } = item;
              const sysId = `sys-${s.id}-${iso}`;
              const sysHidden = hiddenIds.has(sysId);
              return (
                <div key={`sys-${s.id}`}
                  className={cn("absolute rounded border px-1.5 py-0.5 overflow-hidden bg-emerald-500/15 border-emerald-400/40 group", sysHidden && "opacity-15")}
                  style={{ top, height, left, right }}
                >
                  <button
                    className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", sysHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    onClick={(e) => { e.stopPropagation(); toggleHidden(sysId); }}
                  >
                    {sysHidden ? <EyeOff className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" /> : <Eye className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />}
                  </button>
                  <div className="flex items-center gap-1">
                    <RefreshCw className="h-2.5 w-2.5 shrink-0 text-emerald-600 dark:text-emerald-400 opacity-70" />
                    <p className="text-[11px] font-semibold leading-tight truncate text-emerald-700 dark:text-emerald-300">{s.title}</p>
                  </div>
                  {height > 30 && (
                    <p className="text-[10px] leading-tight opacity-70 text-emerald-700 dark:text-emerald-300">
                      {s.start_time}{s.end_time ? `–${s.end_time}` : ""}
                    </p>
                  )}
                </div>
              );
            }

            if (item.kind === "ca") {
              const { a } = item;
              const isTheory = a.assignment_type === "theory";
              const caBg   = isTheory ? "bg-orange-500/15 border-orange-400/40" : "bg-indigo-500/15 border-indigo-400/40";
              const caTxt  = isTheory ? "text-orange-700 dark:text-orange-300"  : "text-indigo-700 dark:text-indigo-300";
              const caIcon = isTheory ? "text-orange-600 dark:text-orange-400"  : "text-indigo-600 dark:text-indigo-400";
              const caId = `ca-${a.id}-${iso}`;
              const caHidden = hiddenIds.has(caId);
              return (
                <div key={`ca-${a.id}`}
                  className={cn("absolute rounded border px-1.5 py-0.5 overflow-hidden group", caBg, caHidden && "opacity-15")}
                  style={{ top, height, left, right }}
                >
                  <button
                    className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", caHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    onClick={(e) => { e.stopPropagation(); toggleHidden(caId); }}
                  >
                    {caHidden ? <EyeOff className={cn("h-3.5 w-3.5", caIcon)} /> : <Eye className={cn("h-3.5 w-3.5", caIcon)} />}
                  </button>
                  <div className="flex items-center gap-1">
                    <GraduationCap className={cn("h-2.5 w-2.5 shrink-0 opacity-70", caIcon)} />
                    <p className={cn("text-[11px] font-semibold leading-tight truncate", caTxt)}>{a.title}</p>
                  </div>
                  {height > 30 && (
                    <p className={cn("text-[10px] leading-tight opacity-70", caTxt)}>
                      {a.start_time}{a.end_time ? `–${a.end_time}` : ""}
                    </p>
                  )}
                  {height > 46 && (
                    <p className={cn("text-[10px] leading-tight opacity-60 truncate", caTxt)}>{a.plan_title}</p>
                  )}
                </div>
              );
            }

            if (item.kind === "se") {
              const { e } = item;
              const clr = BLOCK_COLORS[e.color] ?? BLOCK_COLORS.teal;
              const seId = `se-${e.id}-${e.date}`;
              const seHidden = hiddenIds.has(seId);
              return (
                <div key={`se-${e.id}-${e.date}`}
                  className={cn("absolute rounded border px-1.5 py-0.5 overflow-hidden group", clr.bg, clr.border, seHidden && "opacity-15")}
                  style={{ top, height, left, right }}
                >
                  <button
                    className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", seHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                    onClick={(ev) => { ev.stopPropagation(); toggleHidden(seId); }}
                  >
                    {seHidden ? <EyeOff className={cn("h-3.5 w-3.5", clr.text)} /> : <Eye className={cn("h-3.5 w-3.5", clr.text)} />}
                  </button>
                  <div className="flex items-center gap-1">
                    <CalendarRange className={cn("h-2.5 w-2.5 shrink-0 opacity-70", clr.text)} />
                    <p className={cn("text-[11px] font-semibold leading-tight truncate", clr.text)}>{e.title}</p>
                  </div>
                  {height > 30 && (
                    <p className={cn("text-[10px] leading-tight opacity-70", clr.text)}>
                      {e.start_time}{e.end_time ? `–${e.end_time}` : ""}
                    </p>
                  )}
                  {height > 46 && e.location && (
                    <div className={cn("flex items-center gap-0.5 mt-0.5", clr.text)}>
                      <MapPin className="h-2.5 w-2.5 shrink-0 opacity-70" />
                      <p className="text-[10px] leading-tight opacity-70 truncate">{e.location}</p>
                    </div>
                  )}
                  {height > 58 && (
                    <p className={cn("text-[10px] leading-tight opacity-60 truncate", clr.text)}>{e.plan_title}</p>
                  )}
                </div>
              );
            }

            // cal block — a top-level card that may contain its own nested
            // children (recursively rendered by CalBlockCard itself).
            const { b } = item;
            return (
              <CalBlockCard
                key={`${b.is_recurring ? "r" : "b"}-${b.recurring_id ?? b.id}-${b.date}`}
                block={b}
                depth={0}
                style={{ position: "absolute", top, height, left, right }}
                childrenOf={childrenOf}
                categories={categories}
                sessionsByBlock={sessionsByBlock}
                hiddenIds={hiddenIds}
                toggleHidden={toggleHidden}
                onClickBlock={onClickBlock}
                onToggleWorked={onToggleWorked}
                hourPx={hourPx}
                interactions={interactions}
                columnIso={iso}
              />
            );
          });
        })()}
      </div>
    </div>
  );
}
