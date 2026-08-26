// The wire format spoken over a Supabase Realtime broadcast channel.
//
// Kept pure and transport-free so the two-provider convergence test can run it
// in-process with a fake channel. Nothing here imports Supabase.

import * as Y from "yjs";
import { toB64 } from "./base64";

/** Topic grammar. Must match the RLS policies in the vault_ydoc migration,
 *  which parse it with split_part(realtime.topic(), ':', n). Node ids are
 *  crypto.randomUUID() and contain no ':' so the split is exact. */
export function docTopic(nodeId: string): string {
  return `vault:doc:${nodeId}`;
}

export type CollabEvent = "sv" | "u" | "a" | "reload" | "bye";

export interface Envelope {
  /** Sender's Y.Doc clientID. Used to ignore our own echo and to expire
   *  awareness state when a peer says goodbye. */
  from: number;
  /** base64 state vector — `sv` only. */
  sv?: string;
  /** base64 Yjs update — `u` only. */
  u?: string;
  /** base64 awareness update — `a` only. */
  a?: string;
}

/**
 * Supabase Realtime's max broadcast payload is 256 kB on the free plan. Cap
 * well under it: the base64 rides inside a JSON envelope with the event name
 * and topic, and going over does not error usefully — the message is simply
 * dropped, which presents as "the other person's edit never arrived".
 */
const PAYLOAD_CAP_B64 = 200_000;

export function exceedsPayloadCap(b64: string): boolean {
  return b64.length > PAYLOAD_CAP_B64;
}

/**
 * Merge queued updates into one.
 *
 * Coalescing is what keeps a fast typist inside the project-wide 100
 * messages/second budget: at a 60 ms flush interval one client emits at most
 * ~16/s, so two clients plus awareness sit around 50/s with headroom.
 * `Y.mergeUpdates` is exact — applying the merged update is equivalent to
 * applying each in order.
 */
export function coalesce(updates: Uint8Array[]): Uint8Array {
  return updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
}

export function encodeStateVector(doc: Y.Doc): string {
  return toB64(Y.encodeStateVector(doc));
}

/** The diff a peer needs, given the state vector they told us they have. */
export function encodeDiff(doc: Y.Doc, theirStateVector: Uint8Array): string {
  return toB64(Y.encodeStateAsUpdate(doc, theirStateVector));
}

/** Flush/broadcast cadences, together so they can be reasoned about at once. */
export const TIMING = {
  /** Coalescing window for outgoing document updates. */
  UPDATE_FLUSH_MS: 60,
  /** Awareness (caret position) throttle. Cheap messages, but they fire on
   *  every cursor move, so they need their own slower valve. */
  AWARENESS_THROTTLE_MS: 100,
  /** How long to wait for any peer to answer our state vector before deciding
   *  we are alone and marking the session synced. */
  NO_PEER_MS: 2_000,
  /** Debounce before persisting Y state to vault_ydoc. */
  PERSIST_DEBOUNCE_MS: 1_500,
  /** Hard ceiling so continuous typing still persists. */
  PERSIST_MAX_MS: 15_000,
} as const;
