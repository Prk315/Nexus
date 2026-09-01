// Telling other open notes that a shared block changed.
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// `useSharedBlocks` reads a share's row when a note OPENS. That is enough when
// you edit one note, close it and open the other — but not when both are open
// at once, which is the whole point of a shared block: a dashboard note beside
// the note the content really lives in. Without this, the second note sits
// there showing a stale copy until you reopen it, and the feature looks broken
// in exactly the situation it was built for.
//
// ── ⚠️ A ping, not the payload ─────────────────────────────────────────────
//
// The broadcast carries only "share X changed", and the receiver re-reads the
// row. Sending the content instead would be one round trip fewer and would
// inherit Realtime's payload ceiling — the same ceiling the CRDT provider has
// to work around with `onReloadRequest` and a re-read. A shared block has no
// size limit of its own, so the moment one grew past the cap the sync would
// stop working with no error, only for large blocks. Re-reading is uniform:
// it costs one query and cannot silently fail on size.
//
// ── ⚠️ Why the sender id is explicit, and `self` is not trusted ────────────
//
// Two notes open side by side in ONE window is the main case, and they are the
// same Supabase client on the same socket. `broadcast: { self: false }` is
// documented as "don't send it back to me" — at client granularity, not per
// channel instance — so relying on it risks suppressing exactly the delivery
// this feature needs. Each subscriber therefore carries its own id and drops
// only its OWN messages, which is unambiguous whatever `self` does.

import { supabase } from "./supabase";
import { shareKey } from "./sharedBlocks";

/** Distinct per hook instance, not per browser: two panes in one window must
 *  be able to notify each other. */
export function newClientId(): string {
  return crypto.randomUUID().slice(0, 8);
}

const EVENT = "share-changed";

/** Topic per share, so a note only hears about the blocks it actually holds. */
function topic(shareId: string): string {
  return `vault:${shareKey(shareId)}`;
}

export interface ShareChannel {
  /** Tell everyone else holding this share that its row moved on. */
  announce(shareId: string): void;
  close(): void;
}

/**
 * Subscribe to a set of shares.
 *
 * Returns a handle whose `announce` is a no-op for shares outside the set —
 * a save can race a re-subscribe, and dropping the announcement is better than
 * opening a channel as a side effect of a write.
 */
export function subscribeShares(
  shareIds: readonly string[],
  clientId: string,
  onChanged: (shareId: string) => void,
): ShareChannel {
  const channels = new Map<string, ReturnType<typeof supabase.channel>>();

  for (const id of shareIds) {
    const ch = supabase.channel(topic(id), {
      config: {
        // ⚠️ Necessary, not sufficient — same note as the CRDT channel. RLS on
        // realtime.messages is only consulted for private joins, and the anon
        // key is committed, so the project-wide "Allow public access" setting
        // must also be off.
        private: true,
        broadcast: { self: true, ack: false },
      },
    });
    ch.on("broadcast", { event: EVENT }, (msg: any) => {
      // Our own echo. See the header for why this is explicit rather than
      // `self: false`.
      if (msg?.payload?.from === clientId) return;
      onChanged(id);
    });
    ch.subscribe();
    channels.set(id, ch);
  }

  return {
    announce(shareId) {
      const ch = channels.get(shareId);
      if (!ch) return;
      // Fire and forget: a dropped announcement costs the other note a stale
      // copy until it is reopened, which is exactly the behaviour before this
      // existed. Failing loudly here would turn a degraded sync into a broken
      // save.
      void ch.send({ type: "broadcast", event: EVENT, payload: { from: clientId } });
    },
    close() {
      for (const ch of channels.values()) void supabase.removeChannel(ch);
      channels.clear();
    },
  };
}
