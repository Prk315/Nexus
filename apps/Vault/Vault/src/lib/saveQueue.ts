// Per-node write queue for content saves.
//
// Why this exists: every save rewrites a node's ENTIRE document into one
// vault_content row, and callers used to fire saves independently — so the
// moment one save turned slow, the next edit started a second upsert on the
// SAME node_id, which queued on its row lock while holding a PostgREST pool
// connection. Enough of those and the pool is gone for the whole project:
// on 2026-08-15 an editing session did exactly this and wedged the database
// (statement timeouts → PGRST003 pool exhaustion → instance I/O collapse →
// Cloudflare 522 for every app). See postgrest_logs around 18:56 UTC.
//
// Invariants:
//  - SINGLE-FLIGHT per key: at most one write for a given node is ever on the
//    wire. No row-lock convoys.
//  - COALESCING: while a write is in flight, newer content replaces the queued
//    value; when the wire frees up, only the LATEST content is written. A save
//    "succeeds" when its content — or anything newer — lands.
//  - GLOBAL BACKOFF: failures anywhere gate ALL keys (the failure mode is a
//    struggling database, not a struggling row): 1s → 2s → … → 60s cap.
//  - BOUNDED: after MAX_ATTEMPTS consecutive failures for the same pending
//    content the queue gives up, reports "error", and holds the content until
//    a new edit re-arms it. It never hammers and never spins forever.

type RawSave = (id: string, content: string) => Promise<void>;
export type SaveState = "saving" | "saved" | "error";

const BACKOFF_BASE_MS = 1_000;
const BACKOFF_CAP_MS = 60_000;
const MAX_ATTEMPTS = 6;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function makeSaver(rawSave: RawSave, onState?: (id: string, s: SaveState) => void) {
  const pending = new Map<string, string>();  // latest not-yet-persisted content
  const draining = new Set<string>();          // keys with an active drain loop
  // Waiters resolve when their key's pending content has fully drained (or
  // reject when the queue gives up) — so callers can still `await` a save.
  const waiters = new Map<string, { resolve: () => void; reject: (e: Error) => void }[]>();

  // Shared failure gate: consecutive failures across all keys.
  let failStreak = 0;
  let gateUntil = 0;

  function settle(id: string, error?: Error) {
    const list = waiters.get(id) ?? [];
    waiters.delete(id);
    for (const w of list) (error ? w.reject(error) : w.resolve());
  }

  async function drain(id: string): Promise<void> {
    let attempts = 0;
    while (pending.has(id)) {
      const wait = gateUntil - Date.now();
      if (wait > 0) await sleep(wait);

      // Take the latest content only at send time — edits made during the
      // backoff wait coalesce into this write instead of queuing behind it.
      const content = pending.get(id)!;
      try {
        await rawSave(id, content);
        failStreak = 0;
        attempts = 0;
        // Only clear if nothing newer arrived while the write was in flight.
        if (pending.get(id) === content) {
          pending.delete(id);
          onState?.(id, "saved");
          settle(id);
        }
      } catch (e) {
        failStreak += 1;
        attempts += 1;
        gateUntil = Date.now() + Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (failStreak - 1));
        if (attempts >= MAX_ATTEMPTS) {
          // Keep the content pending (a future edit re-arms the drain) but stop
          // retrying on our own — a row that can't save in 6 tries won't make
          // it on the 7th, and 522s taught us what polite clients are worth.
          onState?.(id, "error");
          settle(id, e instanceof Error ? e : new Error(String(e)));
          break;
        }
      }
    }
    draining.delete(id);
  }

  return function save(id: string, content: string): Promise<void> {
    pending.set(id, content);
    onState?.(id, "saving");
    const done = new Promise<void>((resolve, reject) => {
      const list = waiters.get(id) ?? [];
      list.push({ resolve, reject });
      waiters.set(id, list);
    });
    if (!draining.has(id)) {
      draining.add(id);
      void drain(id);
    }
    return done;
  };
}
