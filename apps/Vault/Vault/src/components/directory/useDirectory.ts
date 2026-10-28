import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

// Small hooks the directory prototype needs. All of them scope their listeners
// to an element or to nothing at all — this branch adds no `window` keydown
// handler, because one already exists (`hooks/useKeyBindings.ts`) and two
// listeners disagreeing about who owns Escape is how a shortcut stops working
// in one view only.

/**
 * Measure an element.
 *
 * `GraphView` takes width and height as numbers — a canvas cannot be sized by
 * CSS alone — so the grid cell holding it has to be measured rather than
 * assumed. ResizeObserver rather than a window resize listener: the sidebar is
 * draggable, so the graph cell changes size while the window does not.
 */
export function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const { width, height } = el.getBoundingClientRect();
      setSize((prev) =>
        Math.abs(prev.width - width) < 1 && Math.abs(prev.height - height) < 1
          ? prev
          : { width, height },
      );
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, size };
}

// ⚠️ The key is versioned, and that is a fix rather than a tidy-up.
//
// The first build stored `classic` under `nexus.vault.layout` the moment anyone
// pressed the toggle — and the toggle lived inside the grid shell, so pressing
// it removed the only way back (see LayoutSwitch.tsx). Every reload afterwards
// read that value and rendered the old layout: the prototype was "not on the
// screen" and there was "no way to get there", with nothing wrong in the build,
// the console or the server.
//
// Bumping the key retires those stored values instead of asking anyone to clear
// site data. A layout preference is the cheapest possible thing to lose, and the
// branch's whole purpose is that the new layout is what you see.
const LAYOUT_KEY = "nexus.vault.layout.v2";
export type LayoutMode = "grid" | "classic";

/**
 * Which shell to render.
 *
 * `?layout=classic` wins over the stored choice, is written back, and is then
 * STRIPPED from the URL — so a link is enough to compare the two, but a
 * bookmarked or reloaded URL cannot keep overriding the toggle forever
 * (which was exactly the one-way-door symptom the versioned key fixed, back
 * for anyone who arrived via a link).
 */
export function useLayoutMode(): [LayoutMode, (m: LayoutMode) => void] {
  const [mode, setMode] = useState<LayoutMode>(() => {
    let fromQuery: string | null = null;
    try {
      fromQuery = new URLSearchParams(window.location.search).get("layout");
    } catch {
      /* no URL in a non-browser host */
    }
    if (fromQuery === "grid" || fromQuery === "classic") return fromQuery;
    try {
      const stored = localStorage.getItem(LAYOUT_KEY);
      if (stored === "grid" || stored === "classic") return stored;
    } catch {
      /* private mode / blocked storage */
    }
    return "grid";
  });

  // The write-back and strip live in an effect so the initializer stays a
  // read. replaceState, not pushState: the cleaned URL must not add a
  // history entry, or Back walks through every variant of the same page.
  useEffect(() => {
    let fromQuery: string | null = null;
    try {
      fromQuery = new URLSearchParams(window.location.search).get("layout");
    } catch {
      return;
    }
    if (fromQuery !== "grid" && fromQuery !== "classic") return;
    try {
      localStorage.setItem(LAYOUT_KEY, fromQuery);
    } catch {
      /* the choice just does not survive a reload */
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("layout");
      window.history.replaceState(window.history.state, "", url);
    } catch {
      /* a host without history still honoured the param this load */
    }
  }, []);

  const set = useCallback((m: LayoutMode) => {
    setMode(m);
    try {
      localStorage.setItem(LAYOUT_KEY, m);
    } catch {
      /* the choice just does not survive a reload */
    }
  }, []);

  return [mode, set];
}

const EXPANDED_KEY = "nexus.vault.expandedNodes";

/**
 * Expanded folders, remembered across reloads.
 *
 * Ids of deleted nodes are harmless here — `flattenTree` only ever asks whether
 * a node it is already drawing is expanded — so nothing prunes the stored set.
 */
export function usePersistentExpanded(): [
  Set<string>,
  Dispatch<SetStateAction<Set<string>>>,
] {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(EXPANDED_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return new Set(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_KEY, JSON.stringify([...expanded]));
    } catch {
      /* not worth failing a render over */
    }
  }, [expanded]);

  return [expanded, setExpanded];
}
