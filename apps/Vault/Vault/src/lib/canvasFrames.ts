// Which canvas blocks a frame contains, and what folding one hides.
//
// ── ⚠️ Containment is DERIVED from geometry, never stored ──────────────────
//
// A frame is a rectangle with a label. It has no children field, and this
// module deliberately does not add one.
//
// Storing membership would mean every drag has to maintain it: drop a block on
// a frame and something must notice; drag it out and something must notice
// again; resize the frame over a block and the same. Each of those is a place
// for the stored answer to disagree with what the user can plainly see — and a
// block that LOOKS inside a frame but is not in its list is a bug with no
// visible cause. Deriving it means the picture is the model, and dragging a
// block into a frame simply works because there is nothing to update.
//
// The cost is that containment is recomputed rather than looked up. A canvas
// is tens of blocks, and the walk is one pass.
//
// ── Folding hides; it never moves ──────────────────────────────────────────
//
// A folded frame keeps `folded: true` and NOTHING else changes — every block
// keeps its coordinates. The obvious alternative, moving contained blocks out
// of the way or stashing them, needs an inverse that restores them exactly, and
// any bug in that inverse loses work. Hiding has no inverse to get wrong.

/** The rectangle any block occupies. */
export interface Rect { x: number; y: number; width: number; height: number }

export interface FrameLike extends Rect { id: string; type: string; folded?: boolean }
export interface BlockLike extends Rect { id: string; type: string }

/** Height a folded frame collapses to: its title bar. */
export const FOLDED_FRAME_HEIGHT = 34;

/**
 * Is `b` inside `f`?
 *
 * Fully contained, not merely overlapping. A block half in and half out is not
 * "in" a frame in any sense a user would agree with, and folding the frame
 * would make half a diagram vanish for a reason nobody could point at.
 *
 * A frame never contains itself, and geometric containment is not applied to
 * frames-inside-frames here — see `frameOf`.
 */
export function contains(f: Rect, b: Rect): boolean {
  return (
    b.x >= f.x &&
    b.y >= f.y &&
    b.x + b.width <= f.x + f.width &&
    b.y + b.height <= f.y + f.height
  );
}

/**
 * The frame a block belongs to, or null.
 *
 * ⚠️ The INNERMOST containing frame wins, measured by area. Frames nest —
 * "Sprint 1" inside "Q3" — and without a tie-break a block would belong to
 * both, so folding the outer one and then the inner one would hide the block
 * twice and unfolding one of them would reveal it while the other still claims
 * to be closed. Smallest-area-wins makes membership a function, not a relation.
 */
export function frameOf(frames: readonly FrameLike[], b: BlockLike): FrameLike | null {
  let best: FrameLike | null = null;
  let bestArea = Infinity;
  for (const f of frames) {
    if (f.id === b.id || !contains(f, b)) continue;

    // ⚠️ MUTUAL containment needs an antisymmetric tie-break, not merely a
    // deterministic one. Two exactly coincident frames each contain the other,
    // so "smallest area wins" makes ownership a 2-cycle — A inside B inside A —
    // and the fold walk then has to defend against a loop it should never see.
    // Letting the lower id own the higher makes ownership a forest by
    // construction.
    if (contains(b, f) && !(f.id < b.id)) continue;

    const area = f.width * f.height;
    if (area < bestArea || (area === bestArea && best !== null && f.id < best.id)) {
      best = f;
      bestArea = area;
    }
  }
  return best;
}

/**
 * Every block id hidden by the currently folded frames.
 *
 * Transitive: folding "Q3" hides "Sprint 1" AND everything inside Sprint 1,
 * even though those blocks' own innermost frame is Sprint 1 rather than Q3.
 * Without the transitive step a folded outer frame would leave its inner
 * frames' contents floating on the canvas with nothing around them.
 */
export function hiddenBlockIds(blocks: readonly BlockLike[]): Set<string> {
  const frames = blocks.filter((b): b is FrameLike => b.type === "frame");
  const folded = frames.filter((f) => (f as FrameLike).folded);
  const hidden = new Set<string>();
  if (folded.length === 0) return hidden;

  // Direct membership first, then close over folded frames that are themselves
  // hidden. Bounded by the frame count, so no cycle is possible — but `seen`
  // is kept anyway, because a frame exactly coincident with another can make
  // `frameOf` symmetric.
  const owner = new Map<string, string>();
  for (const b of blocks) {
    const f = frameOf(frames, b);
    if (f) owner.set(b.id, f.id);
  }

  const queue = folded.map((f) => f.id);
  const seen = new Set<string>(queue);
  while (queue.length) {
    const frameId = queue.shift()!;
    for (const [blockId, ownerId] of owner) {
      if (ownerId !== frameId || hidden.has(blockId)) continue;
      hidden.add(blockId);
      // A hidden frame hides its own contents too, whether or not it is folded.
      if (!seen.has(blockId) && frames.some((f) => f.id === blockId)) {
        seen.add(blockId);
        queue.push(blockId);
      }
    }
  }
  // A folded frame is not hidden by its OWN foldedness — it still renders as a
  // title bar, which is the only way to unfold it again. That falls out of the
  // walk (nothing owns a top-level frame), so there is deliberately no blanket
  // "un-hide every folded frame" here: an inner folded frame sitting inside a
  // folded outer one MUST stay hidden. Un-hiding it was the first version of
  // this, and it left a stray title bar floating inside a closed group.
  return hidden;
}

/**
 * Where an arrow endpoint should be drawn when its block is hidden.
 *
 * Returns the outermost VISIBLE folded frame containing it, so the arrow lands
 * on the title bar the user can see rather than disappearing. An arrow that
 * simply vanished would read as "this connection was deleted", which is a
 * worse lie than "it points at the closed group".
 */
export function visibleAnchor(
  blocks: readonly BlockLike[],
  hidden: ReadonlySet<string>,
  blockId: string,
): string | null {
  if (!hidden.has(blockId)) return blockId;
  const frames = blocks.filter((b): b is FrameLike => b.type === "frame");
  const byId = new Map(blocks.map((b) => [b.id, b]));

  let current = byId.get(blockId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const f = frameOf(frames, current);
    if (!f) return null;
    if (!hidden.has(f.id)) return f.id;
    current = byId.get(f.id);
  }
  return null;
}

/** How a folded frame renders. The stored height is untouched — unfolding is
 *  then a flag flip rather than a restore that can get the number wrong. */
export function foldedRect(f: FrameLike): Rect {
  return f.folded ? { ...f, height: FOLDED_FRAME_HEIGHT } : f;
}

/**
 * The first non-empty line of a block's text, for a folded block's title.
 *
 * Falls back to null rather than to "Untitled": a folded block with no text
 * should say nothing rather than assert a name it does not have.
 */
export function firstLine(text: string | undefined, max = 60): string | null {
  if (!text) return null;
  const line = text.split("\n").map((l) => l.trim()).find((l) => l !== "");
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
