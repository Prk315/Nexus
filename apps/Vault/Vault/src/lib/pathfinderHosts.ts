// Which task block is under a point on the screen.
//
// A drag that can leave the block it started in needs to answer that, and the
// block it lands on is a DIFFERENT React tree — a separate ProseMirror node
// view, possibly in a different pane. There is no parent component holding both
// to route through, so the lookup goes through the DOM and a module-scope
// registry instead.
//
// Deliberately not React context: context reaches descendants, and the two
// blocks in a cross-block drag are siblings at best. A note can also hold a
// dozen blocks, and the drop target is decided by geometry, not by hierarchy.

import type { PfBlockSpec } from "./pathfinderBlock";

/** The attribute the lookup keys on. Rendered by PathfinderBlock's wrapper. */
export const HOST_ATTR = "data-pf-host";

export interface BlockHost {
  id: string;
  /** Live — re-registered on every render, so a drop reads the CURRENT filter
   *  rather than whatever it was when the block mounted. */
  spec: PfBlockSpec;
  /** Today, as the block computed it. A block filtered to "due today" dates a
   *  task dropped into it, and both blocks must agree on which day that is. */
  today: string;
}

const hosts = new Map<string, BlockHost>();

let seq = 0;
/** A per-mount id. Not the node's position: a block moved in the document is
 *  the same block, and positions change under editing. */
export function nextHostId(): string {
  seq += 1;
  return `pfh-${seq}`;
}

export function registerHost(host: BlockHost): void {
  hosts.set(host.id, host);
}

export function unregisterHost(id: string): void {
  hosts.delete(id);
}

/**
 * The block under a viewport point, or null.
 *
 * Reads the DOM at call time rather than caching rectangles: blocks reflow
 * while a drag is in flight (a row highlights, a list scrolls), and a cached
 * rect resolves the drop to the wrong block without ever looking wrong.
 *
 * `elementFromPoint` returns the TOPMOST element, so a block nested inside
 * another — a task block inside a container inside a note — resolves to the
 * innermost one, which is the one the pointer is actually over.
 */
export function hostAt(x: number, y: number): BlockHost | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const root = el?.closest?.(`[${HOST_ATTR}]`) as HTMLElement | null;
  const id = root?.getAttribute(HOST_ATTR);
  if (!id) return null;
  // A registered id whose element is gone means the block unmounted mid-drag.
  // Returning the stale spec would move the task somewhere no longer on screen.
  return hosts.get(id) ?? null;
}

/** Only for tests — the registry is module state and would leak between them. */
export function __resetHosts(): void {
  hosts.clear();
  seq = 0;
}
