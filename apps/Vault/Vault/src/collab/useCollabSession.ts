// React lifecycle around a CollabSession.
//
// The hook's contract is deliberately narrow: given a node id and whether that
// node is eligible, it returns either a live session or null, plus a `loading`
// flag the caller MUST respect before mounting an editor. That last part is not
// cosmetic — see the note on mount ordering below.

import { useEffect, useRef, useState } from "react";
import { useNexusAuth } from "@nexus/core";
import { memberColor, memberName } from "@nexus/core/members";
import { loadCollab } from "./loadCollab";
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
   */
  loading: boolean;
  session: CollabSession | null;
  status: CollabStatus | "off";
}

export function useCollabSession(nodeId: string | null, enabled: boolean, seedJson: string): CollabState {
  const { user } = useNexusAuth();
  const [session, setSession] = useState<CollabSession | null>(null);
  const [status, setStatus] = useState<CollabStatus | "off">("off");
  const [loading, setLoading] = useState(false);

  // Read once, at mount. After the session exists the CRDT owns the content and
  // tracking the prop would re-seed from a stale projection.
  const seedRef = useRef(seedJson);
  seedRef.current = session ? seedRef.current : seedJson;

  const uid = user?.id;

  useEffect(() => {
    if (!enabled || !nodeId || !uid) {
      setSession(null);
      setStatus("off");
      setLoading(false);
      return;
    }

    let cancelled = false;
    let started: CollabSession | null = null;
    setLoading(true);
    setStatus("loading");

    (async () => {
      try {
        const { startCollabSession } = await loadCollab();
        const s = await startCollabSession({
          nodeId,
          seedJson: seedRef.current,
          user: { name: memberName(uid), color: memberColor(uid) },
          onStatus: (next) => {
            if (!cancelled) setStatus(next);
          },
        });
        if (cancelled) {
          // The node changed while we were connecting. Tear the session down
          // rather than leaking its channel and Y.Doc.
          s.destroy();
          return;
        }
        started = s;
        setSession(s);
        setStatus(s.status);
      } catch (e) {
        console.error("[vault] live co-editing unavailable; falling back to save-on-conflict", e);
        if (!cancelled) {
          setSession(null);
          setStatus("error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      started?.destroy();
    };
  }, [nodeId, enabled, uid]);

  // A hard close (lid, tab kill) would otherwise drop up to one persist
  // debounce of edits. `pagehide` is the only event iOS Safari reliably fires.
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

  return { loading, session, status };
}
