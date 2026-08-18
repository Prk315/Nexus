/**
 * GeneralproveSession — LEARN_PLAN.md "Generalprøve — the final canvas node"
 * (pinned 2026-08-17), P1 slice ONLY: canvas + card tray + arrows +
 * disposition data. No rounds, no scoring, no coach line, no pencil — those
 * are P2–P4 and deliberately absent.
 *
 * Shape notes (why it is built this way):
 *
 * 1. ZERO content refetch. The card inventory is the exact Formelsamling
 *    derivation (`referenceData.ts`), computed from the `path` /
 *    `contentByUnit` / `unlockedUnitIds` props PathPanel already holds —
 *    same rationale as ReferencePanel's header note #1.
 * 2. One transformed div is the whole engine. No d3-zoom, no react-flow, no
 *    konva, no `<canvas>`: a zero-sized (`h-0 w-0`) absolutely-positioned
 *    layer carries `translate(x,y) scale(k)`, cards are absolutely
 *    positioned children in CANVAS coordinates, and a 1×1 `overflow-visible`
 *    SVG paints arrows in the same space. The pan-raw / card-drag-÷k
 *    asymmetry is pinned in `generalprove/canvasMath.ts`'s header.
 * 3. Wheel zoom is a MANUAL non-passive listener — React registers `wheel`
 *    passively, so `preventDefault` in an `onWheel` prop is a silent no-op
 *    and the page scrolls instead of the board zooming. An expanded card's
 *    statement scroller opts out via `[data-noscroll]`, checked in the one
 *    surface handler rather than per-card listeners.
 * 4. Both fetches (`fetchDispositions`, `fetchPrereqEdges`) are non-fatal:
 *    the board must stay fully usable with no network — a one-line muted
 *    footnote is the only trace. `lr_disposition` having 0 rows is the
 *    NORMAL state until the authoring pass lands ("Ingen dispositioner
 *    endnu" is a quiet state, never an error), and the disposition content
 *    shape is rendered fully defensively because the DATA agent authors it
 *    in parallel.
 * 5. Nothing is persisted. All state is in-memory `useState`; closing the
 *    overlay discards the board — that is P1's contract (`lr_rehearsal_run`
 *    arrives with P2's rounds).
 * 6. Danish chrome, as an explicit recorded exception to DESIGN.md's
 *    language rule — every noun on this surface is course vocabulary
 *    (Sætninger, Kort, Pil, Disposition), so English verbs beside them
 *    would read worse than either pure option. See DESIGN.md §Language rule.
 * 7. Arrow colour is ink at .55, auto DAG edges are dashed muted grey —
 *    NEVER indigo/fuchsia (the gradient means earned progress, DESIGN.md
 *    §1.2) and never emerald/red/amber (reserved feedback/warning hues).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { DispositionBeat, LrDisposition, PathUnit, PrereqEdge, UnitContent } from "./types";
import { fetchDispositions, fetchPrereqEdges } from "./api";
import { Markdown } from "./Markdown";
import { useCourse } from "./CourseContext";
import { CARD, FEEDBACK, PLAYER_STYLE, useLensTokens } from "./player/tokens";
import {
  REF_GROUP_CHIP,
  REF_GROUP_LABEL,
  collectReferenceEntries,
  filterRefEntries,
  groupRefEntries,
  refEntryKey,
  type RefEntry,
  type RefGroupKey,
} from "./referenceData";
import {
  CARD_DEFAULT_H,
  CARD_W,
  deriveAutoEdges,
  edgeAnchor,
  edgeKey,
  quadPath,
  toCanvas,
  zoomAt,
  type Rect,
  type View,
} from "./generalprove/canvasMath";

interface PlacedCard {
  /** Instance identity (`crypto.randomUUID()`) — the same statement may be
   * placed twice, so this is NOT the statement's identity. */
  id: string;
  /** `refEntryKey(entry)` — source identity, for the tray's "already placed"
   * ticks. */
  refKey: string;
  /** `entry.box.concept_id` (TheoryBox.concept_id is SINGULAR — types.ts). */
  conceptId: string;
  title: string;
  statementMd: string;
  group: RefGroupKey;
  unitCode: string;
  perspective: string | null;
  /** CANVAS coordinates (see canvasMath.ts's coordinate model). */
  x: number;
  y: number;
  expanded: boolean;
}

/** A user-drawn arrow between two card INSTANCES (never concept ids — the
 * same statement placed twice is two distinct endpoints). */
interface UserArrow {
  id: string;
  from: string;
  to: string;
}

type Tool = "select" | "arrow";

type DragState =
  | { kind: "pan"; pointerId: number; lastX: number; lastY: number }
  | {
      kind: "card";
      pointerId: number;
      cardId: string;
      lastX: number;
      lastY: number;
      startTime: number;
      moved: number;
    };

interface TrayDragState {
  entry: RefEntry;
  pointerId: number;
  startX: number;
  startY: number;
  ghost: boolean;
}

/** Tap thresholds — under both, a card-header pointer sequence toggles
 * `expanded` instead of having been a drag. */
const TAP_MOVE_PX = 4;
const TAP_MS = 400;
/** A tray row becomes a drag-to-place ghost past this movement. */
const TRAY_DRAG_PX = 6;

export function GeneralproveSession({
  path,
  contentByUnit,
  unlockedUnitIds,
  onClose,
}: {
  path: PathUnit[];
  contentByUnit: Map<number, UnitContent>;
  unlockedUnitIds: Set<number>;
  onClose: () => void;
}) {
  const { course } = useCourse();
  const LENS = useLensTokens();

  // ── Board state — all in-memory, nothing persisted (header note #5) ──────
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [cards, setCards] = useState<PlacedCard[]>([]);
  const [arrows, setArrows] = useState<UserArrow[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [arrowFrom, setArrowFrom] = useState<string | null>(null);
  const [trayQuery, setTrayQuery] = useState("");
  const [trayOpen, setTrayOpen] = useState(false); // phone bottom sheet only
  const [pickerOpen, setPickerOpen] = useState(false);
  const [selectedDisposition, setSelectedDisposition] = useState<LrDisposition | null>(null);
  const [dispSheetOpen, setDispSheetOpen] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  // Measured card sizes for arrow geometry — state (not a ref) because a
  // card expanding MUST re-run the edge geometry; the ResizeObserver
  // callback only writes when a size actually changed, so no feedback loop.
  const [cardSizes, setCardSizes] = useState<Map<string, { w: number; h: number }>>(new Map());
  const [ghost, setGhost] = useState<{ entry: RefEntry; x: number; y: number } | null>(null);

  // ── Reference data (non-fatal, header note #4) ───────────────────────────
  const [dispositions, setDispositions] = useState<LrDisposition[]>([]);
  const [edges, setEdges] = useState<PrereqEdge[]>([]);
  const [failed, setFailed] = useState<{ disp: boolean; edges: boolean }>({ disp: false, edges: false });

  useEffect(() => {
    let cancelled = false;
    fetchDispositions(course.courseId)
      .then((rows) => {
        if (!cancelled) setDispositions(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed((f) => ({ ...f, disp: true }));
      });
    fetchPrereqEdges(course.courseId)
      .then((rows) => {
        if (!cancelled) setEdges(rows);
      })
      .catch(() => {
        if (!cancelled) setFailed((f) => ({ ...f, edges: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [course.courseId]);

  // ── Inventory — the Formelsamling derivation, zero refetch (note #1) ─────
  const inventory = useMemo(
    () => collectReferenceEntries(path, contentByUnit, unlockedUnitIds),
    [path, contentByUnit, unlockedUnitIds]
  );
  const trayGroups = useMemo(() => groupRefEntries(filterRefEntries(inventory, trayQuery)), [inventory, trayQuery]);
  const placedKeys = useMemo(() => new Set(cards.map((c) => c.refKey)), [cards]);

  // ── Automatic DAG edges ──────────────────────────────────────────────────
  const pairs = useMemo(() => new Set(edges.map((e) => edgeKey(e.prereqId, e.conceptId))), [edges]);
  const autoEdges = useMemo(() => deriveAutoEdges(cards, arrows, pairs), [cards, arrows, pairs]);
  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  // ── Refs for the gesture machinery ───────────────────────────────────────
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const trayDragRef = useRef<TrayDragState | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ startDist: number; startView: View } | null>(null);
  const pendingRef = useRef<{ x: number; y: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const clearTimerRef = useRef<number | null>(null);
  const cardElsRef = useRef(new Map<string, HTMLElement>());

  // One shared ResizeObserver across every card (created once, lazily).
  const roRef = useRef<ResizeObserver | null>(null);
  if (roRef.current === null && typeof ResizeObserver !== "undefined") {
    roRef.current = new ResizeObserver((entries) => {
      setCardSizes((prev) => {
        let next: Map<string, { w: number; h: number }> | null = null;
        for (const en of entries) {
          const el = en.target as HTMLElement;
          const id = el.dataset.cardId;
          if (!id) continue;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          const cur = prev.get(id);
          if (!cur || cur.w !== w || cur.h !== h) {
            if (!next) next = new Map(prev);
            next.set(id, { w, h });
          }
        }
        return next ?? prev;
      });
    });
  }
  useEffect(() => {
    return () => roRef.current?.disconnect();
  }, []);

  function cardRefCb(cardId: string, el: HTMLElement | null) {
    const prev = cardElsRef.current.get(cardId);
    if (prev && prev !== el) roRef.current?.unobserve(prev);
    if (el) {
      cardElsRef.current.set(cardId, el);
      roRef.current?.observe(el);
    } else {
      cardElsRef.current.delete(cardId);
    }
  }

  // ── Wheel zoom — manual non-passive listener (header note #3) ────────────
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // An expanded statement's scroller scrolls natively instead of zooming.
      if ((e.target as HTMLElement | null)?.closest?.("[data-noscroll]")) return;
      e.preventDefault();
      const r = el.getBoundingClientRect();
      // `ctrlKey === true` is how Safari/Chrome report a trackpad pinch.
      setView((v) => zoomAt(v, e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── Esc cascade: pending arrow → open sheet/list → close overlay ─────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (arrowFrom !== null) {
        setArrowFrom(null);
        return;
      }
      if (pickerOpen) {
        setPickerOpen(false);
        return;
      }
      if (trayOpen) {
        setTrayOpen(false);
        return;
      }
      if (selectedDisposition && dispSheetOpen) {
        setDispSheetOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [arrowFrom, pickerOpen, trayOpen, dispSheetOpen, selectedDisposition, onClose]);

  useEffect(() => {
    return () => {
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // ── Pointer machinery — pan / card drag / pinch, rAF-coalesced ───────────

  function flushMove() {
    rafRef.current = null;
    const d = dragRef.current;
    const p = pendingRef.current;
    pendingRef.current = null;
    if (!d || !p) return;
    const dx = p.x - d.lastX;
    const dy = p.y - d.lastY;
    if (dx === 0 && dy === 0) return;
    d.lastX = p.x;
    d.lastY = p.y;
    if (d.kind === "pan") {
      // Pan is screen-space: RAW client deltas, never divided by k.
      setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
    } else {
      d.moved += Math.hypot(dx, dy);
      // Card coords are canvas-space: divide by k. This asymmetry with pan
      // above is the classic bug in this pattern — see canvasMath.ts.
      const k = viewRef.current.k;
      const cardId = d.cardId;
      setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, x: c.x + dx / k, y: c.y + dy / k } : c)));
    }
  }

  function onSurfacePointerDown(e: React.PointerEvent) {
    const el = surfaceRef.current;
    if (!el) return;
    if (e.pointerType === "touch") {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointersRef.current.size === 2) {
        const [a, b] = [...pointersRef.current.values()];
        pinchRef.current = { startDist: Math.hypot(a.x - b.x, a.y - b.y), startView: viewRef.current };
        dragRef.current = null; // a second finger ends any pan/drag
        return;
      }
    }
    if (e.target !== el && e.target !== transformRef.current) return; // background only
    el.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "pan", pointerId: e.pointerId, lastX: e.clientX, lastY: e.clientY };
  }

  function onSurfacePointerMove(e: React.PointerEvent) {
    if (e.pointerType === "touch" && pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pinch = pinchRef.current;
      if (pinch && pointersRef.current.size >= 2) {
        const [a, b] = [...pointersRef.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (dist > 0 && pinch.startDist > 0) {
          const r = surfaceRef.current!.getBoundingClientRect();
          const midX = (a.x + b.x) / 2 - r.left;
          const midY = (a.y + b.y) / 2 - r.top;
          // Ratio applied to the gesture-start view, never compounded.
          setView(zoomAt(pinch.startView, midX, midY, dist / pinch.startDist));
        }
        return;
      }
    }
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    pendingRef.current = { x: e.clientX, y: e.clientY };
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(flushMove);
  }

  function endPointer(e: React.PointerEvent, allowTap: boolean) {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    dragRef.current = null;
    if (
      allowTap &&
      d.kind === "card" &&
      d.moved < TAP_MOVE_PX &&
      performance.now() - d.startTime < TAP_MS
    ) {
      const cardId = d.cardId;
      setCards((cs) => cs.map((c) => (c.id === cardId ? { ...c, expanded: !c.expanded } : c)));
    }
  }

  function onCardHeaderPointerDown(e: React.PointerEvent, cardId: string) {
    // While the arrow tool is active, card dragging is disabled — otherwise
    // a tap gets swallowed by a 2px drag; taps route via onClick instead.
    if (tool === "arrow") return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.stopPropagation();
    const el = surfaceRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    dragRef.current = {
      kind: "card",
      cardId,
      pointerId: e.pointerId,
      lastX: e.clientX,
      lastY: e.clientY,
      startTime: performance.now(),
      moved: 0,
    };
  }

  // ── Arrows ───────────────────────────────────────────────────────────────

  function handleArrowTap(cardId: string) {
    if (arrowFrom === null) {
      setArrowFrom(cardId);
      return;
    }
    if (arrowFrom === cardId) {
      setArrowFrom(null); // tap the from-card again = cancel
      return;
    }
    const from = arrowFrom;
    // Reject exact duplicates; to→from stays allowed (a different claim).
    if (!arrows.some((a) => a.from === from && a.to === cardId)) {
      setArrows((arr) => [...arr, { id: crypto.randomUUID(), from, to: cardId }]);
    }
    setArrowFrom(null);
  }

  function removeArrow(arrowId: string) {
    setArrows((arr) => arr.filter((a) => a.id !== arrowId));
  }

  function removeCard(cardId: string) {
    setCards((cs) => cs.filter((c) => c.id !== cardId));
    setArrows((arr) => arr.filter((a) => a.from !== cardId && a.to !== cardId));
    setArrowFrom((cur) => (cur === cardId ? null : cur));
  }

  // ── Placing cards from the tray ──────────────────────────────────────────

  function placeEntry(entry: RefEntry, atClient?: { x: number; y: number }) {
    const el = surfaceRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let x: number;
    let y: number;
    if (atClient) {
      const c = toCanvas(atClient.x - r.left, atClient.y - r.top, viewRef.current);
      x = c.x - CARD_W / 2;
      y = c.y - 48;
    } else {
      // Viewport centre, with a deterministic scatter so repeats never stack
      // pixel-exactly.
      const c = toCanvas(r.width / 2, r.height / 2, viewRef.current);
      const n = cards.length % 6;
      x = c.x - CARD_W / 2 + n * 18;
      y = c.y - 48 + n * 18;
    }
    setCards((cs) => [
      ...cs,
      {
        id: crypto.randomUUID(),
        refKey: refEntryKey(entry),
        conceptId: entry.box.concept_id,
        title: entry.box.title,
        statementMd: entry.box.statement_md,
        group: entry.group,
        unitCode: entry.unitCode,
        perspective: entry.box.perspective,
        x,
        y,
        expanded: false,
      },
    ]);
    setTrayOpen(false); // phone sheet closes so you see what you placed
  }

  function onTrayRowPointerDown(e: React.PointerEvent, entry: RefEntry) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    trayDragRef.current = { entry, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, ghost: false };
  }

  function onTrayRowPointerMove(e: React.PointerEvent) {
    const t = trayDragRef.current;
    if (!t || t.pointerId !== e.pointerId) return;
    if (!t.ghost && Math.hypot(e.clientX - t.startX, e.clientY - t.startY) > TRAY_DRAG_PX) t.ghost = true;
    if (t.ghost) setGhost({ entry: t.entry, x: e.clientX, y: e.clientY });
  }

  function onTrayRowPointerUp(e: React.PointerEvent) {
    const t = trayDragRef.current;
    trayDragRef.current = null;
    setGhost(null);
    if (!t || t.pointerId !== e.pointerId) return;
    if (t.ghost) {
      const r = surfaceRef.current?.getBoundingClientRect();
      const inside =
        r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (inside) placeEntry(t.entry, { x: e.clientX, y: e.clientY });
      // Dropped outside the surface = cancel, silently.
    } else {
      // Below the drag threshold it falls through to tap-to-add.
      placeEntry(t.entry);
    }
  }

  function onTrayRowPointerCancel() {
    trayDragRef.current = null;
    setGhost(null);
  }

  // ── Ryd tavlen — two-tap confirm (never window.confirm: silent no-op in
  // iOS WKWebView) ─────────────────────────────────────────────────────────

  function handleClear() {
    if (!clearArmed) {
      setClearArmed(true);
      if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => setClearArmed(false), 3000);
      return;
    }
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    setClearArmed(false);
    setCards([]);
    setArrows([]);
    setArrowFrom(null);
  }

  // ── Geometry helpers ─────────────────────────────────────────────────────

  function rectOf(c: PlacedCard): Rect {
    const s = cardSizes.get(c.id) ?? { w: CARD_W, h: CARD_DEFAULT_H };
    return { x: c.x, y: c.y, w: s.w, h: s.h };
  }

  function pathBetween(fromId: string, toId: string): string | null {
    const a = cardById.get(fromId);
    const b = cardById.get(toId);
    if (!a || !b) return null;
    const ra = rectOf(a);
    const rb = rectOf(b);
    return quadPath(edgeAnchor(ra, rb), edgeAnchor(rb, ra));
  }

  const headerBtn =
    "flex min-h-[36px] items-center gap-1 rounded-lg px-2.5 text-[11px] text-[#6E6E78] ring-1 ring-black/10 transition active:bg-black/[0.05]";

  const trayContent = (
    <>
      <div className="shrink-0 border-b border-black/[0.06] px-3 py-2.5">
        <input
          value={trayQuery}
          onChange={(e) => setTrayQuery(e.target.value)}
          placeholder="Søg i sætninger, definitioner …"
          className="w-full rounded-lg bg-white px-3 py-2 text-sm text-[#1A1A24] ring-1 ring-black/10 outline-none placeholder:text-[#6E6E78]/60 focus:ring-indigo-400/60"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-8">
        {trayGroups.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-[#6E6E78]">
            {trayQuery.trim() ? "Ingen opslag matcher søgningen." : "Ingen opslag endnu — lås en lektion op først."}
          </div>
        )}
        {trayGroups.map(([group, list]) => (
          <div key={group}>
            <div className="sticky top-0 z-10 bg-[#F6F5F1]/95 px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#6E6E78] backdrop-blur">
              {REF_GROUP_LABEL[group]} · {list.length}
            </div>
            {list.map((e) => {
              const key = refEntryKey(e);
              return (
                <button
                  key={key}
                  type="button"
                  onPointerDown={(ev) => onTrayRowPointerDown(ev, e)}
                  onPointerMove={onTrayRowPointerMove}
                  onPointerUp={onTrayRowPointerUp}
                  onPointerCancel={onTrayRowPointerCancel}
                  className="flex min-h-[36px] w-full items-center gap-2 rounded-lg px-2 text-left transition-colors active:bg-black/[0.04] md:hover:bg-black/[0.03]"
                >
                  <span className="shrink-0 rounded bg-black/[0.04] px-1 py-0.5 text-[8px] font-semibold tracking-wide text-[#6E6E78]">
                    {REF_GROUP_CHIP[group]}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[#1A1A24]/85">{e.box.title}</span>
                  <span className="shrink-0 rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[9px] text-[#6E6E78]">
                    {e.unitCode}
                  </span>
                  {placedKeys.has(key) && <span className="shrink-0 text-[10px] text-indigo-600">✓</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </>
  );

  const dispositionBody = selectedDisposition ? <DispositionBody disp={selectedDisposition} /> : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col animate-[learn-overlay_.22s_ease-out] bg-[#F6F5F1]/97 backdrop-blur-xl text-[#1A1A24]">
      <style>{PLAYER_STYLE}</style>

      <header className="shrink-0 border-b border-black/[0.08] px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))] md:px-5">
        <div className="flex flex-wrap items-center gap-1.5 md:gap-2">
          <button
            type="button"
            onClick={onClose}
            aria-label="Luk"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#6E6E78] active:bg-black/[0.05]"
          >
            ✕
          </button>
          <span className="truncate text-[13px] font-medium text-[#1A1A24]/85">Generalprøve</span>

          <div className="ml-auto flex flex-wrap items-center gap-1.5 md:gap-2">
            <span className="hidden text-[10px] text-[#6E6E78]/70 sm:block">stiplet = forudsætning</span>

            <button
              type="button"
              onClick={() => setTrayOpen((o) => !o)}
              className={`${headerBtn} md:hidden`}
            >
              Kort
            </button>

            <button
              type="button"
              onClick={() => {
                setTool((t) => (t === "arrow" ? "select" : "arrow"));
                setArrowFrom(null);
              }}
              aria-pressed={tool === "arrow"}
              className={
                tool === "arrow"
                  ? "flex min-h-[36px] items-center gap-1 rounded-lg bg-indigo-50 px-2.5 text-[11px] text-indigo-700 ring-1 ring-indigo-400/60 transition"
                  : headerBtn
              }
            >
              Pil
            </button>

            <button type="button" onClick={handleClear} className={headerBtn}>
              {clearArmed ? "Ryd? Tryk igen" : "Ryd tavlen"}
            </button>

            <button
              type="button"
              onClick={() => setView({ x: 0, y: 0, k: 1 })}
              className={headerBtn}
            >
              Nulstil zoom
              <span className="font-mono tabular-nums text-[10px] text-[#6E6E78]/70">{Math.round(view.k * 100)}%</span>
            </button>

            {/* Disposition picker — a real list, not a native <select>: an
                <option> cannot carry the KLADDE chip (DESIGN.md §1.3). */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setPickerOpen((o) => !o)}
                aria-expanded={pickerOpen}
                className={headerBtn}
              >
                {selectedDisposition ? selectedDisposition.code : "Disposition"}
                <span className="text-[#6E6E78]/60">▾</span>
              </button>
              {pickerOpen && (
                <div
                  className={`${CARD} absolute right-0 top-full z-30 mt-1 max-h-[50vh] w-72 overflow-y-auto overscroll-contain p-1`}
                >
                  {dispositions.length === 0 && (
                    <div className="px-3 py-4 text-center text-[12px] text-[#6E6E78]">Ingen dispositioner endnu</div>
                  )}
                  {dispositions.map((d) => (
                    <button
                      key={d.disposition_id}
                      type="button"
                      onClick={() => {
                        setSelectedDisposition(d);
                        setDispSheetOpen(true);
                        setPickerOpen(false);
                      }}
                      className={`flex min-h-[44px] w-full items-center gap-2 rounded-lg px-2.5 text-left transition-colors active:bg-black/[0.04] md:hover:bg-black/[0.03] ${
                        selectedDisposition?.disposition_id === d.disposition_id ? "bg-black/[0.03]" : ""
                      }`}
                    >
                      <span className="shrink-0 text-[12px] font-medium text-[#1A1A24]/85">{d.code}</span>
                      <span className="min-w-0 flex-1 truncate text-[12px] text-[#6E6E78]">{d.title}</span>
                      {d.status === "draft" && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${FEEDBACK.draft}`}
                        >
                          KLADDE
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Card tray — desktop left rail. */}
        <aside className="hidden w-[280px] shrink-0 flex-col border-r border-black/[0.08] md:flex">{trayContent}</aside>

        {/* The board. */}
        <div className="relative min-h-0 flex-1">
          <div
            ref={surfaceRef}
            className="absolute inset-0 touch-none overflow-hidden overscroll-contain bg-[#F6F5F1]"
            onPointerDown={onSurfacePointerDown}
            onPointerMove={onSurfacePointerMove}
            onPointerUp={(e) => endPointer(e, true)}
            onPointerCancel={(e) => endPointer(e, false)}
          >
            <div
              ref={transformRef}
              className="absolute left-0 top-0 h-0 w-0 will-change-transform"
              style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`, transformOrigin: "0 0" }}
            >
              {/* 1×1 + overflow-visible: paints the whole plane without
                  contributing layout. pointer-events restored ONLY on the
                  fat invisible hit paths. */}
              <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
                <defs>
                  {/* userSpaceOnUse keeps the head in CANVAS units, so it
                      scales with the board like everything else. */}
                  <marker
                    id="gp-arrow"
                    markerUnits="userSpaceOnUse"
                    markerWidth="10"
                    markerHeight="8"
                    refX="8.5"
                    refY="4"
                    orient="auto"
                  >
                    <path d="M0 0 L9 4 L0 8 Z" fill="#1A1A24" opacity="0.55" />
                  </marker>
                </defs>
                {/* Auto DAG edges first, so user arrows paint on top. */}
                {autoEdges.map((e) => {
                  const d = pathBetween(e.from, e.to);
                  if (!d) return null;
                  return (
                    <path
                      key={`auto-${e.from}-${e.to}`}
                      d={d}
                      fill="none"
                      stroke="#6E6E78"
                      strokeWidth={1.75}
                      strokeDasharray="6 6"
                      opacity={0.32}
                    />
                  );
                })}
                {arrows.map((ar) => {
                  const d = pathBetween(ar.from, ar.to);
                  if (!d) return null;
                  return (
                    <g key={ar.id}>
                      {/* fill="none" is mandatory — the quad's implicit fill
                          would otherwise become the hit region. */}
                      <path
                        d={d}
                        fill="none"
                        stroke="#1A1A24"
                        strokeWidth={1.75}
                        opacity={0.55}
                        markerEnd="url(#gp-arrow)"
                      />
                      <path
                        d={d}
                        fill="none"
                        stroke="transparent"
                        strokeWidth={18}
                        pointerEvents="stroke"
                        className="cursor-pointer"
                        onPointerDown={(ev) => {
                          ev.stopPropagation();
                          removeArrow(ar.id);
                        }}
                      />
                    </g>
                  );
                })}
              </svg>

              {cards.map((c) => {
                const lens = c.perspective ? LENS[c.perspective] : null;
                const isFrom = arrowFrom === c.id;
                return (
                  <div
                    key={c.id}
                    ref={(el) => cardRefCb(c.id, el)}
                    data-card-id={c.id}
                    onClick={tool === "arrow" ? () => handleArrowTap(c.id) : undefined}
                    className={`${CARD} absolute w-60 select-none ${
                      tool === "arrow"
                        ? `cursor-crosshair ${isFrom ? "ring-2 ring-indigo-500" : "ring-1 ring-indigo-400/50"}`
                        : ""
                    }`}
                    style={{ left: c.x, top: c.y }}
                  >
                    <div
                      className={`flex items-start gap-1.5 px-2.5 py-2 ${
                        tool === "arrow" ? "" : "cursor-grab active:cursor-grabbing"
                      }`}
                      onPointerDown={(e) => onCardHeaderPointerDown(e, c.id)}
                    >
                      <span className="mt-0.5 shrink-0 rounded bg-black/[0.04] px-1 py-0.5 text-[9px] font-semibold tracking-wide text-[#6E6E78]">
                        {REF_GROUP_CHIP[c.group]}
                      </span>
                      <span className="min-w-0 flex-1 text-[12.5px] font-medium leading-snug text-[#1A1A24] line-clamp-2">
                        {c.title}
                      </span>
                      {lens && (
                        <span className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${lens.chip}`}>
                          {lens.label}
                        </span>
                      )}
                      <span className="mt-0.5 shrink-0 rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[9px] text-[#6E6E78]">
                        {c.unitCode}
                      </span>
                      {/* Expanded hit area via ::before, not a 44px square —
                          PathPanel's refresh-button trick. */}
                      <button
                        type="button"
                        aria-label="Fjern kort"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          removeCard(c.id);
                        }}
                        className="relative mt-0.5 shrink-0 text-[11px] text-[#6E6E78]/60 before:absolute before:-inset-2 before:content-[''] active:text-[#1A1A24]"
                      >
                        ✕
                      </button>
                    </div>
                    {c.expanded && (
                      <div
                        data-noscroll
                        className="max-h-[40vh] overflow-y-auto overscroll-contain border-t border-black/[0.05] px-2.5 py-2"
                      >
                        <Markdown className="text-[12px]">{c.statementMd}</Markdown>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {cards.length === 0 && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-[13px] text-[#6E6E78]/70">
              Træk et kort fra listen for at begynde.
            </div>
          )}

          {(failed.disp || failed.edges) && (
            <div className="pointer-events-none absolute bottom-2 left-2 text-[10px] text-[#6E6E78]/60">
              {failed.disp && failed.edges
                ? "Dispositioner og forudsætningspile kunne ikke hentes — tavlen virker stadig."
                : failed.disp
                  ? "Dispositioner kunne ikke hentes — tavlen virker stadig."
                  : "Forudsætningspile kunne ikke hentes — tavlen virker stadig."}
            </div>
          )}

          {/* Phone card tray — bottom sheet; rows close it on add. */}
          {trayOpen && (
            <div className="absolute inset-x-0 bottom-0 z-10 flex h-[62vh] flex-col rounded-t-2xl bg-[#F6F5F1] shadow-[0_-8px_32px_rgba(0,0,0,0.12)] md:hidden">
              {trayContent}
            </div>
          )}

          {/* Phone disposition sheet. */}
          {selectedDisposition && dispSheetOpen && (
            <div className="absolute inset-x-0 bottom-0 z-10 flex h-[62vh] flex-col rounded-t-2xl bg-[#F6F5F1] shadow-[0_-8px_32px_rgba(0,0,0,0.12)] md:hidden">
              <DispositionSheetHeader disp={selectedDisposition} onCollapse={() => setDispSheetOpen(false)} />
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">{dispositionBody}</div>
            </div>
          )}
        </div>

        {/* Desktop disposition sheet — read-only reference material (P1:
            selecting one filters nothing, places nothing, scores nothing). */}
        {selectedDisposition && dispSheetOpen && (
          <aside className="hidden w-[320px] shrink-0 flex-col border-l border-black/[0.08] md:flex">
            <DispositionSheetHeader disp={selectedDisposition} onCollapse={() => setDispSheetOpen(false)} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-8">{dispositionBody}</div>
          </aside>
        )}
      </div>

      {/* Drag-to-place ghost — follows the pointer above everything. */}
      {ghost && (
        <div
          className={`${CARD} pointer-events-none fixed z-50 w-60 px-2.5 py-2 opacity-80`}
          style={{ left: ghost.x - CARD_W / 2, top: ghost.y - 24 }}
        >
          <div className="flex items-start gap-1.5">
            <span className="shrink-0 rounded bg-black/[0.04] px-1 py-0.5 text-[9px] font-semibold tracking-wide text-[#6E6E78]">
              {REF_GROUP_CHIP[ghost.entry.group]}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-[#1A1A24]">
              {ghost.entry.box.title}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function DispositionSheetHeader({ disp, onCollapse }: { disp: LrDisposition; onCollapse: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-black/[0.06] px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold tracking-tight text-[#1A1A24]">
            {disp.code} · {disp.title}
          </span>
          {disp.status === "draft" && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] ${FEEDBACK.draft}`}>
              KLADDE
            </span>
          )}
        </div>
        <div className="text-[11px] text-[#6E6E78]">Disposition</div>
      </div>
      <button
        type="button"
        onClick={onCollapse}
        aria-label="Skjul disposition"
        className="flex h-8 w-8 items-center justify-center rounded-full text-[#6E6E78] ring-1 ring-black/10 transition hover:bg-black/[0.04]"
      >
        ›
      </button>
    </div>
  );
}

/**
 * Renders `lr_disposition.content` fully defensively — the DATA agent
 * authors these rows in parallel with this slice, so every field is treated
 * as possibly missing or oddly shaped, and nothing here ever throws (types.ts
 * `DispositionBeat` is all-optional for the same reason).
 */
function DispositionBody({ disp }: { disp: LrDisposition }) {
  const content = disp.content ?? {};
  const introMd = typeof content.intro_md === "string" ? content.intro_md : null;
  const rawBeats: DispositionBeat[] = Array.isArray(content.beats)
    ? content.beats.filter((b): b is DispositionBeat => !!b && typeof b === "object")
    : [];
  // Ordered by `idx` (planned) or `order` (the live rows' authored spelling)
  // when present, authored array order otherwise.
  const beats = rawBeats
    .map((b, i) => ({
      beat: b,
      ord: typeof b.idx === "number" ? b.idx : typeof b.order === "number" ? b.order : i + 1,
    }))
    .sort((a, b) => a.ord - b.ord);

  return (
    <div className="pt-3">
      {introMd && <Markdown className="mb-3 text-[12px]">{introMd}</Markdown>}
      {beats.length === 0 && (
        <div className="py-6 text-center text-[12px] text-[#6E6E78]">Ingen beats i denne disposition endnu.</div>
      )}
      {beats.map(({ beat, ord }, i) => {
        // `statements` is the planned key, `statement_titles` the authored
        // one — read both, planned name first.
        const rawStatements = Array.isArray(beat.statements)
          ? beat.statements
          : Array.isArray(beat.statement_titles)
            ? beat.statement_titles
            : [];
        const statements = rawStatements.filter((s): s is string => typeof s === "string");
        const conceptIds = Array.isArray(beat.concept_ids)
          ? beat.concept_ids.filter((s): s is string => typeof s === "string")
          : [];
        return (
          <div key={i} className="mb-2 rounded-xl bg-white p-3 ring-1 ring-black/[0.06]">
            <div className="flex items-start gap-2">
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[#6E6E78]/70">{ord}.</span>
              <span className="min-w-0 flex-1 text-[12.5px] font-medium text-[#1A1A24]/90">
                {typeof beat.title === "string" && beat.title ? beat.title : "—"}
              </span>
              {typeof beat.minutes === "number" && (
                <span className="shrink-0 font-mono text-[10px] tabular-nums text-[#6E6E78]/60">{beat.minutes} min</span>
              )}
            </div>
            {statements.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 pl-6">
                {statements.map((s, j) => (
                  <li key={j} className="list-disc text-[11.5px] text-[#1A1A24]/75">
                    {s}
                  </li>
                ))}
              </ul>
            )}
            {typeof beat.notes_md === "string" && beat.notes_md && (
              <div className="mt-1.5 pl-6">
                <Markdown className="text-[11.5px]">{beat.notes_md}</Markdown>
              </div>
            )}
            {conceptIds.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1 pl-6">
                {conceptIds.map((cid) => (
                  <span key={cid} className="rounded-full bg-black/[0.04] px-1.5 py-0.5 text-[9px] text-[#6E6E78]">
                    {cid}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
