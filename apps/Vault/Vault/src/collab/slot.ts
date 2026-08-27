// The two pure rules that keep a collaboration session tied to the note it
// belongs to. Both exist because of one bug, and it is worth naming precisely.
//
// ─── The bug ─────────────────────────────────────────────────────────────────
// `useCollabSession` used to hold the resolved session in plain state and the
// seed in a ref gated on that state:
//
//     const seedRef = useRef(seedJson);
//     seedRef.current = session ? seedRef.current : seedJson;   // ← wrong
//
// Starting a session is asynchronous, so React state describing it necessarily
// LAGS the `nodeId` prop by at least one render. In the first render after a
// tab switch A → B, `nodeId` is already B while `session` is still A's — so:
//
//  1. The seed froze on A's JSON (`session` was truthy), and the session then
//     started for B was seeded from note A's document. When B had no vault_ydoc
//     row yet, that made A's text B's authoritative CRDT state, and the JSON
//     projection wrote it straight into B's vault_content. The user ends up
//     with two notes containing the same document, with no undo and no history
//     — vault_content keeps none.
//
//  2. For the same one render, `session` (A's, about to be destroyed) was
//     handed to the editor mounted for B, binding note B's ProseMirror view to
//     note A's Y.Doc. `loading` did not cover the gap because it was also state,
//     set inside the effect, i.e. one render too late as well.
//
// ─── The rule ────────────────────────────────────────────────────────────────
// Anything derived from an async resolve must carry the id it was resolved FOR,
// and be treated as absent whenever that id is not the one being asked about.
// Both functions below are that rule; the hook holds no `session`/`loading`
// state of its own, so there is no second source of truth to fall out of step.

import type { CollabSession, CollabStatus } from "./types";

/**
 * A resolved (or failed) session, stamped with the node it belongs to.
 *
 * `session: null` with `status: "error"` is a *resolved* slot: setup failed for
 * that node and the caller should fall back to the ordinary save path rather
 * than sit on "Connecting…" forever.
 */
export interface CollabSlot {
  nodeId: string;
  session: CollabSession | null;
  status: CollabStatus;
}

export interface ResolvedCollabState {
  loading: boolean;
  session: CollabSession | null;
  status: CollabStatus | "off";
}

/**
 * What the hook should report for `nodeId`, given whatever slot has resolved.
 *
 * A slot for a DIFFERENT node is not "close enough" — it is the previous note,
 * and reporting it is exactly how note A's document reached note B.
 */
export function resolveSlot(
  slot: CollabSlot | null,
  nodeId: string | null,
  eligible: boolean
): ResolvedCollabState {
  if (!eligible || !nodeId) return { loading: false, session: null, status: "off" };
  const mine = slot && slot.nodeId === nodeId ? slot : null;
  if (!mine) return { loading: true, session: null, status: "loading" };
  return { loading: false, session: mine.session, status: mine.status };
}

export interface Seed {
  nodeId: string | null;
  json: string;
}

/**
 * The seed candidate for the next render.
 *
 * Two rules, in this order:
 *
 *  - A different node ALWAYS takes its own JSON. This is the fix for the
 *    duplication bug; the old code's `session ? keep : take` had no notion of
 *    which node the kept value described.
 *  - The same node keeps tracking the prop only until its slot resolves. After
 *    that the CRDT owns the content and the JSON projection is a lagging
 *    derivative of it — re-seeding from one would reintroduce text the Y.Doc
 *    has already deleted.
 */
export function nextSeed(prev: Seed, nodeId: string | null, seedJson: string, resolved: boolean): Seed {
  if (prev.nodeId !== nodeId) return { nodeId, json: seedJson };
  if (resolved) return prev;
  return prev.json === seedJson ? prev : { nodeId, json: seedJson };
}
