// The note's heading outline, on the left, always reachable.
//
// Replaces a panel that had three problems, all of which the structural blocks
// would have made worse:
//
//  1. It read only `editor.getJSON().content` — the document's TOP-LEVEL
//     children. Every heading inside a callout, a column or a toggle would
//     have been invisible to it.
//  2. It matched headings by text, via querySelectorAll('h2') + find(text ===).
//     Two sections called "Notes" both scrolled to the first one.
//  3. It was revealed by hovering near the right edge, so on an iPad — which
//     has no hover — it could not be opened at all.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { useResizableWidth } from "../hooks/useResizableWidth";

export interface OutlineItem {
  /** ProseMirror position of the heading node. This is the identity. */
  pos: number;
  level: number;
  text: string;
  /** Nesting depth derived from the level sequence, not from the level itself. */
  indent: number;
}

/**
 * Walk the WHOLE document, not just its top-level children, so a heading
 * inside a column or a toggle still appears.
 */
export function buildOutline(doc: PMNode): OutlineItem[] {
  const found: Array<{ pos: number; level: number; text: string }> = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return true;
    // textContent picks up text the old JSON walk missed — a heading whose
    // words sit inside a nested inline node rather than a bare text node.
    const text = node.textContent.trim();
    if (text) found.push({ pos, level: node.attrs?.level ?? 1, text });
    return false; // headings don't nest
  });

  // Indent by position in the level sequence rather than by the level number,
  // so a note that starts at H2 or skips H2 entirely doesn't render with a
  // permanent hanging indent.
  const stack: number[] = [];
  return found.map(({ pos, level, text }) => {
    while (stack.length && stack[stack.length - 1] >= level) stack.pop();
    const indent = stack.length;
    stack.push(level);
    return { pos, level, text, indent };
  });
}

interface Props {
  editor: Editor;
  /** The scroll container the headings live in. */
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onClose: () => void;
}

const WIDTH_KEY = "nexus.note.outlineWidth";

export function NoteOutline({ editor, scrollRef, onClose }: Props) {
  // editor.state.doc is an immutable PM node, so this recomputes only when the
  // text actually changes — not on every cursor move.
  const outline = useMemo(() => buildOutline(editor.state.doc), [editor.state.doc]);
  const [activePos, setActivePos] = useState<number | null>(null);
  const { width, dragging, startResize } = useResizableWidth(WIDTH_KEY, 240, 180, 480);

  // Positions are only valid for the doc they came from, and the outline is
  // rebuilt from editor.state.doc on every doc change — so a cached element
  // lookup never outlives its position by more than a render.
  const domFor = useCallback(
    (pos: number): HTMLElement | null => {
      const dom = editor.view.nodeDOM(pos);
      return dom && (dom as HTMLElement).nodeType === 1 ? (dom as HTMLElement) : null;
    },
    [editor]
  );

  const asideRef = useRef<HTMLElement>(null);

  /**
   * The scroll container.
   *
   * Resolved from this panel's own DOM position rather than trusting the ref
   * prop: NoteOutline is rendered BEFORE the editor in the same flex row, so
   * on the mount commit `scrollRef.current` is still null — the effect below
   * would bail once and never attach a listener, leaving the outline with no
   * active item for the life of the note. Our own ref is attached before our
   * own layout effect runs, so walking from it is deterministic.
   */
  const getScroller = useCallback((): HTMLElement | null => {
    if (scrollRef.current) return scrollRef.current;
    return asideRef.current?.parentElement?.querySelector<HTMLElement>(".tiptap-editor") ?? null;
  }, [scrollRef]);

  // ── Scroll-spy ──────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const scroller = getScroller();
    if (!scroller || outline.length === 0) {
      setActivePos(null);
      return;
    }
    // Throttled, and deliberately so. A scroll-spy that runs on every scroll
    // event does ~20 layout reads per frame, and — worse — anything it
    // triggers that scrolls anything can feed straight back into it. Bounding
    // the rate makes that class of feedback merely slow instead of fatal.
    let last = 0;
    let pending: number | null = null;

    function measure() {
      const top = scroller!.getBoundingClientRect().top;
      let current: number | null = null;
      for (const item of outline) {
        const el = domFor(item.pos);
        // A zero-height rect means the heading is inside a collapsed toggle.
        // It is on screen in no meaningful sense and must never become active.
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        if (rect.height === 0) continue;
        if (rect.top <= top + 60) current = item.pos;
        else break;
      }
      const next = current ?? outline.find((i) => domFor(i.pos))?.pos ?? null;
      // Explicit no-op guard. React would bail on an identical value anyway,
      // but being able to say "this cannot re-render" without reasoning about
      // React's bail-out rules is worth one comparison.
      setActivePos((prev) => (prev === next ? prev : next));
    }

    function onScroll() {
      const now = Date.now();
      if (now - last >= 60) {
        last = now;
        measure();
        return;
      }
      if (pending !== null) return;
      // Trailing edge, so the final resting position is always measured.
      pending = window.setTimeout(() => {
        pending = null;
        last = Date.now();
        measure();
      }, 60);
    }

    measure();
    // Measure again once the editor's DOM has settled. On mount nodeDOM() can
    // still return null for every heading, and without a second pass nothing
    // is ever marked active until the user happens to scroll.
    const settle = window.setTimeout(measure, 80);
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.clearTimeout(settle);
      if (pending !== null) window.clearTimeout(pending);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [outline, getScroller, domFor]);

  const activeRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the active row visible by scrolling THIS LIST and nothing else.
  //
  // The obvious `activeRef.current.scrollIntoView({block:"nearest"})` is a trap
  // here: scrollIntoView scrolls every scrollable ancestor, which includes the
  // editor pane. That fires the scroll handler above, which sets activePos,
  // which runs this effect again — an infinite loop that hard-freezes the
  // renderer. Adjusting listRef.scrollTop directly can't reach the editor.
  useEffect(() => {
    const list = listRef.current;
    const el = activeRef.current;
    if (!list || !el) return;
    const listRect = list.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    if (elRect.top < listRect.top) {
      list.scrollTop -= listRect.top - elRect.top;
    } else if (elRect.bottom > listRect.bottom) {
      list.scrollTop += elRect.bottom - listRect.bottom;
    }
  }, [activePos]);

  function jumpTo(item: OutlineItem) {
    const scroller = getScroller();
    if (!scroller) return;

    // A heading inside a collapsed toggle has nowhere to scroll to, so open
    // every collapsed ancestor first and let the DOM settle before measuring.
    const opened = openCollapsedAncestors(editor, item.pos);
    const go = () => {
      const el = domFor(item.pos);
      if (!el) return;
      const top =
        el.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top +
        scroller.scrollTop -
        8;
      // Instant, not behavior:"smooth" — smooth scrolling is driven by rAF,
      // which is throttled when the tab isn't foregrounded, and a
      // jump-to-section must always land. Same reasoning as ParsedViewer.
      scroller.scrollTop = top;
    };
    // setTimeout, not requestAnimationFrame, for the same reason the scroll
    // above is instant: rAF is throttled to nothing in a background tab, and a
    // jump that silently doesn't happen is worse than one that happens a tick
    // late. A macrotask is enough for the re-render to flush.
    if (opened) window.setTimeout(go, 0);
    else go();
  }

  return (
    <>
      <aside
        ref={asideRef}
        className="note-outline"
        style={{ width }}
        aria-label="Outline"
      >
        <div className="note-outline-head">
          <span className="note-outline-title">Outline</span>
          <button
            type="button"
            className="note-outline-close"
            onClick={onClose}
            title="Hide outline"
            aria-label="Hide outline"
          >
            ×
          </button>
        </div>
        {outline.length === 0 ? (
          <div className="note-outline-empty">No headings yet</div>
        ) : (
          <div className="note-outline-list" ref={listRef}>
            {outline.map((item) => (
              <button
                key={item.pos}
                ref={item.pos === activePos ? activeRef : undefined}
                type="button"
                className={`note-outline-item nol-${Math.min(item.indent, 3)}${
                  item.pos === activePos ? " active" : ""
                }`}
                onClick={() => jumpTo(item)}
                title={item.text}
              >
                {item.text}
              </button>
            ))}
          </div>
        )}
      </aside>
      <div
        className={`pv-resize${dragging ? " dragging" : ""}`}
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
      />
    </>
  );
}

/**
 * Expand every collapsed toggle between the doc root and `pos`.
 * Returns true when anything was opened, so the caller knows to wait a frame
 * before measuring.
 */
function openCollapsedAncestors(editor: Editor, pos: number): boolean {
  const { state } = editor;
  if (pos < 0 || pos > state.doc.content.size) return false;
  const $pos = state.doc.resolve(pos);
  const toOpen: number[] = [];
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    if (node.type.name === "toggleBlock" && node.attrs.open === false) {
      toOpen.push($pos.before(d));
    }
  }
  if (!toOpen.length) return false;

  const tr = state.tr;
  for (const at of toOpen) tr.setNodeAttribute(at, "open", true);
  // Same reasoning as a manual collapse: this is a view concern, not an edit,
  // and Cmd-Z should not undo "the outline expanded a section for me".
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return true;
}
