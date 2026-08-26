// The live co-editing runtime.
//
// This is the ONLY module that statically imports yjs, y-protocols and the two
// Tiptap collaboration packages, and it is reached through exactly one dynamic
// import (loadCollab.ts). Everything else in the app refers to a session
// through `collab/types.ts`, which is types-only. Keep it that way: one stray
// value import elsewhere puts the whole stack in the eager note bundle for
// every private-note user and on the iPad.

import * as Y from "yjs";
import Collaboration, { isChangeOrigin } from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type { Transaction } from "@tiptap/pm/state";
import { supabase } from "../lib/supabase";
import * as api from "../lib/api";
import { noteSchema } from "../extensions/noteExtensions";
import { toB64, fromB64 } from "./base64";
import { FRAGMENT, PROVIDER_ORIGIN, buildSeedState, hydrate, readSeedWidth, shouldSeed } from "./seed";
import { docTopic, TIMING } from "./protocol";
import { SupabaseYjsProvider, type ChannelLike } from "./SupabaseYjsProvider";
import type { CollabSession, CollabStatus } from "./types";

export interface StartOpts {
  nodeId: string;
  /** The stored vault_content.data for this note — the seed input. */
  seedJson: string;
  user: { name: string; color: string };
  onStatus: (s: CollabStatus) => void;
}

function parseContent(raw: string): unknown {
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function startCollabSession(opts: StartOpts): Promise<CollabSession> {
  const { nodeId, seedJson, user, onStatus } = opts;

  // The realtime access token is set ASYNCHRONOUSLY inside SupabaseClient's
  // constructor. Subscribing to a PRIVATE channel before it lands fails as a
  // bare CHANNEL_ERROR with no useful message — the single most likely
  // "co-editing just doesn't work" bug in this feature.
  await supabase.auth.getSession();

  // ── Seed election (see seed.ts for why a naive hydrate duplicates the note)
  let authoritative = await api.readYdoc(nodeId);
  if (authoritative == null) {
    authoritative = shouldSeed(seedJson)
      ? await api.seedYdoc(nodeId, buildSeedState(parseContent(seedJson), noteSchema()))
      : "";
  }
  const doc = hydrate(authoritative);

  // ── Persistence: debounced, capped, and gated on having synced ─────────────
  let persistTimer: ReturnType<typeof setTimeout> | null = null;
  let firstDirtyAt = 0;
  let destroyed = false;

  const persistNow = () => {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    firstDirtyAt = 0;
    // A client that reconnected but has not yet merged the peer's diff holds an
    // older document. Writing it would regress the row — recoverable on the
    // next flush, but it also corrupts the seed source for anyone opening cold
    // in that window. Gating is free.
    if (!provider.synced || destroyed) return;
    void api.saveYdoc(nodeId, toB64(Y.encodeStateAsUpdate(doc))).catch((e) => {
      console.error("[vault] could not persist CRDT state", e);
      onStatus("error");
    });
  };

  const schedulePersist = () => {
    if (destroyed) return;
    const now = Date.now();
    if (!firstDirtyAt) firstDirtyAt = now;
    // Continuous typing must still reach the database: without the ceiling the
    // debounce keeps resetting and a long uninterrupted session never persists.
    if (now - firstDirtyAt >= TIMING.PERSIST_MAX_MS) {
      persistNow();
      return;
    }
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, TIMING.PERSIST_DEBOUNCE_MS);
  };

  const channel = supabase.channel(docTopic(nodeId), {
    config: {
      // ⚠️ Necessary, NOT sufficient. RLS on realtime.messages is only consulted
      // for private joins, so a client that omits this flag joins the same
      // topic and reads every delta. The anon key is committed and this repo is
      // public, so the project-wide "Allow public access" setting must ALSO be
      // off — see the migration header and DEPLOY.md.
      private: true,
      // Our own updates are already in our doc; echoing them back only spends
      // the message budget.
      broadcast: { self: false, ack: false },
    },
  }) as unknown as ChannelLike;

  const provider = new SupabaseYjsProvider({
    doc,
    channel,
    user,
    onStatus: (s) => onStatus(s === "live" ? "live" : "offline"),
    onPersistNeeded: schedulePersist,
    onReloadRequest: async () => {
      // A peer's update was too large for a broadcast payload, so they wrote it
      // to vault_ydoc and asked us to re-read rather than us building a chunked
      // transfer protocol with its own reassembly and partial-drop recovery.
      const state = await api.readYdoc(nodeId);
      if (state && !destroyed) Y.applyUpdate(doc, fromB64(state), PROVIDER_ORIGIN);
    },
  });

  const extensions = [
    Collaboration.configure({ document: doc, field: FRAGMENT }),
    // Duck-typed: the extension only ever touches `provider.awareness`, so the
    // provider needs no Hocuspocus-shaped surface. `color` must be 6-digit hex
    // — y-tiptap validates it and silently substitutes orange otherwise.
    CollaborationCaret.configure({ provider, user }),
  ];

  return {
    status: "live",
    extensions,
    isRemoteTransaction: (tr: Transaction) => isChangeOrigin(tr),
    seedWidth: readSeedWidth(seedJson),
    flush: () => {
      provider.flush();
      persistNow();
    },
    destroy: () => {
      if (destroyed) return;
      // Order matters. Persist while the doc is still alive, then tear the
      // network down, then the doc.
      persistNow();
      destroyed = true;
      provider.destroy();
      // Without removeChannel, realtime-js keeps the topic in its internal
      // array forever — one leaked websocket topic per note opened. This is the
      // easiest thing in the whole feature to forget.
      void supabase.removeChannel(channel as never);
      doc.destroy();
    },
  };
}
