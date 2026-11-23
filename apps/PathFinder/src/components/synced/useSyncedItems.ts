// Protocol items on PathFinder's calendar — the read side and every write.
//
// Nothing here is cached beyond the current range: Protocol owns the rows, so
// the freshest copy is always one query away and the right move after any
// write is simply to read again. Ticks are applied optimistically first so
// the checkbox answers immediately; the reload that follows is the truth.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createProtocolApi,
  type ProtocolApi,
  type SyncedItem,
  type SyncedLoadError,
} from "@nexus/core/protocol";
import { getUserId, supabase } from "../../lib/supabase";

/** The session client, never the anon one — protocol_* is auth.uid()-scoped. */
export function protocolApi(): ProtocolApi {
  return createProtocolApi(supabase, getUserId());
}

export interface SyncedState {
  items: SyncedItem[];
  /** Domains that failed to load — shown, never rendered as "nothing planned". */
  errors: SyncedLoadError[];
  loading: boolean;
  /** The last failed write, in words. Cleared by the next successful one. */
  actionError: string | null;
  clearActionError: () => void;
  reload: () => Promise<void>;
  /** Run a write, then reload. Resolves false (and sets actionError) on failure. */
  act: (fn: (api: ProtocolApi) => Promise<unknown>) => Promise<boolean>;
  toggleItem: (item: SyncedItem) => Promise<void>;
  togglePart: (item: SyncedItem, partId: string) => Promise<void>;
}

function withPart(item: SyncedItem, partId: string, done: boolean): SyncedItem {
  const parts = item.parts.map((p) => (p.id === partId ? { ...p, done } : p));
  const n = parts.filter((p) => p.done).length;
  return { ...item, parts, done: n === parts.length, progress: { done: n, total: parts.length } };
}

function withAll(item: SyncedItem, done: boolean): SyncedItem {
  const parts = item.parts.map((p) => ({ ...p, done }));
  return {
    ...item,
    parts,
    done,
    progress: { done: done ? Math.max(parts.length, 1) : 0, total: Math.max(parts.length, 1) },
  };
}

export function useSyncedItems(start: string, end: string): SyncedState {
  const [items, setItems] = useState<SyncedItem[]>([]);
  const [errors, setErrors] = useState<SyncedLoadError[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  // Drops a response for a range the user has already navigated away from.
  const generation = useRef(0);

  const reload = useCallback(async () => {
    const gen = ++generation.current;
    try {
      const res = await protocolApi().loadRange(start, end);
      if (gen !== generation.current) return;
      setItems(res.items);
      setErrors(res.errors);
    } catch (e) {
      if (gen !== generation.current) return;
      // Signed out lands here ("Not authenticated"). Keep whatever was shown
      // and say why, rather than blanking to an empty — and wrong — calendar.
      setErrors([{ kind: "workout", message: e instanceof Error ? e.message : String(e) }]);
    } finally {
      if (gen === generation.current) setLoading(false);
    }
  }, [start, end]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Ticked in Protocol (or on the phone) → visible the moment you come back.
  useEffect(() => {
    const onFocus = () => void reload();
    const onVisible = () => { if (document.visibilityState === "visible") void reload(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reload]);

  const act = useCallback(async (fn: (api: ProtocolApi) => Promise<unknown>) => {
    try {
      await fn(protocolApi());
      setActionError(null);
      return true;
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      await reload();
    }
  }, [reload]);

  const patch = useCallback((key: string, f: (i: SyncedItem) => SyncedItem) => {
    setItems((prev) => prev.map((i) => (i.key === key ? f(i) : i)));
  }, []);

  const toggleItem = useCallback(async (item: SyncedItem) => {
    const done = !item.done;
    patch(item.key, (i) => withAll(i, done));
    await act((api) => api.setDone(item, done));
  }, [act, patch]);

  const togglePart = useCallback(async (item: SyncedItem, partId: string) => {
    const part = item.parts.find((p) => p.id === partId);
    if (!part) return;
    patch(item.key, (i) => withPart(i, partId, !part.done));
    await act((api) => api.setPartDone(item, partId, !part.done));
  }, [act, patch]);

  return useMemo(() => ({
    items, errors, loading, actionError,
    clearActionError: () => setActionError(null),
    reload, act, toggleItem, togglePart,
  }), [items, errors, loading, actionError, reload, act, toggleItem, togglePart]);
}
