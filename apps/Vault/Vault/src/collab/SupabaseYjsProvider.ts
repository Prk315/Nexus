// A Yjs provider over a Supabase Realtime broadcast channel.
//
// There is no collaboration server in this ecosystem and there must not be
// one: the doctrine in CLAUDE.md is that nothing load-bearing may depend on
// the Mac being awake (it is why focus-evaluate runs on pg_cron and why mail
// triage explicitly does not). Two browsers relaying CRDT updates through
// Supabase's hosted Realtime needs no always-on box of our own.
//
// The channel is INJECTED rather than created here. That is what lets the
// convergence test wire two providers to each other in-process, with no
// network and no Supabase — which is the only way to test the part that
// actually matters (that two clients converge and that neither re-broadcasts
// the other's updates into an infinite echo).

import * as Y from "yjs";
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from "y-protocols/awareness";
import { toB64, fromB64 } from "./base64";
import { PROVIDER_ORIGIN } from "./seed";
import {
  coalesce,
  encodeDiff,
  encodeStateVector,
  exceedsPayloadCap,
  TIMING,
  type CollabEvent,
  type Envelope,
} from "./protocol";

/** The subset of a Supabase RealtimeChannel this provider uses. */
export interface ChannelLike {
  on(type: "broadcast", filter: { event: string }, cb: (msg: { payload: Envelope }) => void): unknown;
  send(msg: { type: "broadcast"; event: string; payload: Envelope }): unknown;
  subscribe(cb: (status: string, err?: unknown) => void): unknown;
}

export type ProviderStatus = "connecting" | "live" | "offline";

interface ProviderOpts {
  doc: Y.Doc;
  channel: ChannelLike;
  /** Local user, published through awareness so peers can draw the caret. */
  user: { name: string; color: string };
  onStatus?: (s: ProviderStatus) => void;
  /** Called when a peer's update was too big to broadcast and they asked us to
   *  re-read the persisted row instead. */
  onReloadRequest?: () => void;
  /** Called whenever the doc changes and should eventually be persisted. */
  onPersistNeeded?: () => void;
}

export class SupabaseYjsProvider {
  readonly doc: Y.Doc;
  readonly awareness: Awareness;
  status: ProviderStatus = "connecting";
  /** True once we've either heard from a peer or concluded we're alone. Gates
   *  persistence so a client that reconnected but hasn't merged yet cannot
   *  write a regressed state over a peer's newer one. */
  synced = false;

  private channel: ChannelLike;
  private opts: ProviderOpts;
  private pending: Uint8Array[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private awarenessTimer: ReturnType<typeof setTimeout> | null = null;
  private noPeerTimer: ReturnType<typeof setTimeout> | null = null;
  /** Peers we've already answered with our own state vector. Without this
   *  guard two clients answer each other's `sv` with an `sv` forever. */
  private sentSvTo = new Set<number>();
  private destroyed = false;

  constructor(opts: ProviderOpts) {
    this.opts = opts;
    this.doc = opts.doc;
    this.channel = opts.channel;

    this.awareness = new Awareness(this.doc);
    this.awareness.setLocalStateField("user", opts.user);

    this.doc.on("update", this.onDocUpdate);
    this.awareness.on("update", this.onAwarenessUpdate);

    this.channel.on("broadcast", { event: "sv" }, ({ payload }) => this.onSv(payload));
    this.channel.on("broadcast", { event: "u" }, ({ payload }) => this.onUpdate(payload));
    this.channel.on("broadcast", { event: "a" }, ({ payload }) => this.onAwareness(payload));
    this.channel.on("broadcast", { event: "reload" }, () => this.opts.onReloadRequest?.());
    this.channel.on("broadcast", { event: "bye" }, ({ payload }) => this.onBye(payload));

    this.channel.subscribe((status) => this.onSubscribe(status));
  }

  // ── Outgoing ───────────────────────────────────────────────────────────────

  private send(event: CollabEvent, payload: Omit<Envelope, "from">) {
    if (this.destroyed) return;
    this.channel.send({ type: "broadcast", event, payload: { from: this.doc.clientID, ...payload } });
  }

  private onDocUpdate = (update: Uint8Array, origin: unknown) => {
    // Non-negotiable. Without this an update we applied on the network's
    // behalf is re-broadcast, the peer applies and re-broadcasts it back, and
    // two clients saturate the channel forever.
    if (origin !== PROVIDER_ORIGIN) {
      this.pending.push(update);
      if (!this.flushTimer) {
        this.flushTimer = setTimeout(() => this.flushUpdates(), TIMING.UPDATE_FLUSH_MS);
      }
    }
    // Remote edits must persist too — a client that only ever receives is
    // still a client that should be writing the row.
    this.opts.onPersistNeeded?.();
  };

  private flushUpdates() {
    this.flushTimer = null;
    if (this.pending.length === 0) return;
    const merged = coalesce(this.pending);
    this.pending = [];
    const b64 = toB64(merged);
    if (exceedsPayloadCap(b64)) {
      // Rather than build a chunker plus reassembly timeouts plus partial-drop
      // recovery, lean on persistence we have to write anyway: flush the row
      // and tell peers to re-read it.
      this.opts.onPersistNeeded?.();
      this.send("reload", {});
      return;
    }
    this.send("u", { u: b64 });
  }

  private onAwarenessUpdate = (
    { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
    origin: unknown,
  ) => {
    if (origin === PROVIDER_ORIGIN) return;
    const changed = [...added, ...updated, ...removed];
    if (changed.length === 0) return;
    if (this.awarenessTimer) return;
    this.awarenessTimer = setTimeout(() => {
      this.awarenessTimer = null;
      this.send("a", { a: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) });
    }, TIMING.AWARENESS_THROTTLE_MS);
  };

  // ── Incoming ───────────────────────────────────────────────────────────────

  private onSubscribe(status: string) {
    if (this.destroyed) return;
    if (status === "SUBSCRIBED") {
      this.setStatus("live");
      // A reconnect must re-handshake from scratch: we cannot know what we
      // missed while the socket was down, and the state-vector exchange is
      // exactly the mechanism that recovers it.
      this.sentSvTo.clear();
      this.announce();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
      // Losing the socket must never lose edits: the doc keeps accepting
      // changes and the persistence flusher keeps writing vault_ydoc, whose
      // RLS is independent of Realtime.
      this.setStatus("offline");
    }
  }

  private announce() {
    this.send("sv", { sv: encodeStateVector(this.doc) });
    if (this.noPeerTimer) clearTimeout(this.noPeerTimer);
    this.noPeerTimer = setTimeout(() => {
      this.noPeerTimer = null;
      // Nobody answered. We are the only editor here, so our state is
      // authoritative and persistence may proceed.
      this.synced = true;
    }, TIMING.NO_PEER_MS);
  }

  private onSv(msg: Envelope) {
    if (msg.from === this.doc.clientID || !msg.sv) return;
    this.markSynced();
    // Answer with everything they're missing…
    this.send("u", { u: encodeDiff(this.doc, fromB64(msg.sv)) });
    this.send("a", { a: toB64(encodeAwarenessUpdate(this.awareness, [this.doc.clientID])) });
    // …and ask once for what we're missing. Once, or we ping-pong forever.
    if (!this.sentSvTo.has(msg.from)) {
      this.sentSvTo.add(msg.from);
      this.send("sv", { sv: encodeStateVector(this.doc) });
    }
  }

  private onUpdate(msg: Envelope) {
    if (msg.from === this.doc.clientID || !msg.u) return;
    this.markSynced();
    Y.applyUpdate(this.doc, fromB64(msg.u), PROVIDER_ORIGIN);
  }

  private onAwareness(msg: Envelope) {
    if (msg.from === this.doc.clientID || !msg.a) return;
    applyAwarenessUpdate(this.awareness, fromB64(msg.a), PROVIDER_ORIGIN);
  }

  private onBye(msg: Envelope) {
    if (msg.from === this.doc.clientID) return;
    // The polite case. The impolite one (closed lid, dead network) is handled
    // by y-protocols' own 30s outdatedTimeout, which expires remote states
    // that stop re-announcing — so ghost carets clear themselves and we need
    // no presence machinery for it.
    removeAwarenessStates(this.awareness, [msg.from], PROVIDER_ORIGIN);
  }

  private markSynced() {
    if (this.noPeerTimer) {
      clearTimeout(this.noPeerTimer);
      this.noPeerTimer = null;
    }
    this.synced = true;
  }

  private setStatus(s: ProviderStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }

  // ── Teardown ───────────────────────────────────────────────────────────────

  /** Push anything queued immediately, e.g. on tab close. */
  flush() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushUpdates();
  }

  destroy() {
    if (this.destroyed) return;
    this.flush();
    this.send("bye", {});
    this.destroyed = true;
    if (this.awarenessTimer) clearTimeout(this.awarenessTimer);
    if (this.noPeerTimer) clearTimeout(this.noPeerTimer);
    this.doc.off("update", this.onDocUpdate);
    this.awareness.off("update", this.onAwarenessUpdate);
    this.awareness.destroy();
  }
}
