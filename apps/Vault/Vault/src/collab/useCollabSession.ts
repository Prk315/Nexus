// React lifecycle around a CollabSession.
//
// The hook's contract is deliberately narrow: given a node id and whether that
// node is eligible, it returns either a live session or null, plus a `loading`
// flag the caller MUST respect before mounting an editor. That last part is not
// cosmetic — see the note on mount ordering below.
//
// Everything the hook reports is derived through `collab/slot.ts` from a single
// piece of state that carries the node id it was resolved for. Read that file
// before adding a second state variable here: the previous version kept
// `session`, `status` and `loading` as three independent useStates, all of them
// necessarily one render behind the `nodeId` prop, and that lag put note A's
// document into note B.

import { useEffect, useRef, useState } from "react";
import { useNexusAuth } from "@nexus/core";
import { memberColor, memberName } from "@nexus/core/members";
import { loadCollab } from "./loadCollab";
import { nextSeed, resolveSlot, type CollabSlot, type Seed } from "./slot";
import type { CollabSession, CollabStatus } from "./types";

export interface CollabState {
  /**
   * True while the session is being resolved.
   *
   * The caller must render a placeholder rather than an editor while this is
   * set. `useEditor` is called with the default `deps: []`, so it builds its
   * extension list exactly once: an editor mounted before the session resolves
   * can never gain Collaboration afterwards, and would sit there silently
   * non-collaborative for the life of the tab.
   *
   * It is DERIVED, not stored — it flips to true in the very render `nodeId`
   * changes, before any effect has run. Stored, it would be false for exactly
   * one render after a tab switch, and the editor mounted in that render binds
   * to the previous note's Y.Doc.
   */
  loading: boolean;
  session: CollabSession | null;
  status: CollabStatus | "off";
}

export function useCollabSession(nodeId: string | null, enabled: boolean, seedJson: string): CollabState {
  const { user } = useNexusAuth();
  const uid = user?.id;
  const eligible = enabled && !!nodeId && !!uid;

  // The ONE piece of state. It carries its own node id, so a stale slot is
  // recognisably stale rather than silently reused.
  const [slot, setSlot] = useState<CollabSlot | null>(null);
  const resolved = resolveSlot(slot, nodeId, eligible);

  // The seed is the stored JSON projection this node's CRDT is built from when
  // nobody has built one yet. It tracks the prop until the session resolves and
  // then freezes — but only ever for the node it belongs to.
  const seedRef = useRef<Seed>({ nodeId, json: seedJson });
  seedRef.current = nextSeed(seedRef.current, nodeId, seedJson, !resolved.loading && eligible);

  useEffect(() => {
    if (!eligible || !nodeId || !uid) return;

    let cancelled = false;
    let started: CollabSession | null = null;

    // Status updates arrive after the fact and must not resurrect a slot for a
    // node that has since been left — hence the id check inside the updater as
    // well as the `cancelled` guard.
    const publish = (next: CollabStatus, session: CollabSession | null) =>
      setSlot((prev) =>
        prev && prev.nodeId === nodeId && prev.session === session && prev.status === next
          ? prev
          : { nodeId, session, status: next }
      );

    (async () => {
      try {
        const { startCollabSession } = await loadCollab();
        const s = await startCollabSession({
          nodeId,
          seedJson: seedRef.current.json,
          user: { name: memberName(uid), color: memberColor(uid) },
          onStatus: (next) => {
            if (cancelled) return;
            setSlot((prev) => (prev && prev.nodeId === nodeId ? { ...prev, status: next } : prev));
          },
        });
        if (cancelled) {
          // The node changed while we were connecting. Tear the session down
          // rather than leaking its channel and Y.Doc.
          s.destroy();
          return;
        }
        started = s;
        publish(s.status, s);
      } catch (e) {
        console.error("[vault] live co-editing unavailable; falling back to save-on-conflict", e);
        // A resolved FAILURE, not an absence: without publishing it the derived
        // `loading` never clears and the pane sits on "Connecting…" forever
        // instead of falling back to the guarded save path.
        if (!cancelled) publish("error", null);
      }
    })();

    return () => {
      cancelled = true;
      started?.destroy();
      // Drop this node's slot on the way out so a session that has just been
      // destroyed can never be handed to anything. Guarded on the id: a slot
      // already published for the NEXT node must survive this cleanup.
      setSlot((prev) => (prev && prev.nodeId === nodeId ? null : prev));
    };
  }, [nodeId, eligible, uid]);

  // A hard close (lid, tab kill) would otherwise drop up to one persist
  // debounce of edits. `pagehide` is the only event iOS Safari reliably fires.
  const session = resolved.session;
  useEffect(() => {
    if (!session) return;
    const flush = () => session.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session]);

  return resolved;
}
