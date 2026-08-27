import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { coalesce, docTopic, exceedsPayloadCap, TIMING } from "./protocol";
import { SupabaseYjsProvider, type ChannelLike } from "./SupabaseYjsProvider";
import type { Envelope } from "./protocol";

// ─── A fake broadcast channel ────────────────────────────────────────────────
// This is why SupabaseYjsProvider takes an injected channel instead of calling
// supabase.channel() itself. Convergence and echo behaviour are the only parts
// of the design that can genuinely be wrong in a way review won't catch, and
// they are untestable against a real socket.
class Bus {
  private members: FakeChannel[] = [];
  deliver = true;
  join(c: FakeChannel) { this.members.push(c); }
  publish(from: FakeChannel, event: string, payload: Envelope) {
    if (!this.deliver) return;
    for (const m of this.members) {
      if (m === from) continue; // broadcast self:false
      m.receive(event, payload);
    }
  }
}

class FakeChannel implements ChannelLike {
  handlers = new Map<string, ((msg: { payload: Envelope }) => void)[]>();
  sent: { event: string; payload: Envelope }[] = [];
  private cb: ((status: string) => void) | null = null;
  constructor(private bus: Bus) { bus.join(this); }
  on(_t: "broadcast", filter: { event: string }, cb: (msg: { payload: Envelope }) => void) {
    const list = this.handlers.get(filter.event) ?? [];
    list.push(cb);
    this.handlers.set(filter.event, list);
    return this;
  }
  send(msg: { type: "broadcast"; event: string; payload: Envelope }) {
    this.sent.push({ event: msg.event, payload: msg.payload });
    this.bus.publish(this, msg.event, msg.payload);
    return this;
  }
  subscribe(cb: (status: string) => void) { this.cb = cb; return this; }
  connect() { this.cb?.("SUBSCRIBED"); }
  drop() { this.cb?.("CHANNEL_ERROR"); }
  receive(event: string, payload: Envelope) {
    for (const h of this.handlers.get(event) ?? []) h({ payload });
  }
  countOf(event: string) { return this.sent.filter((s) => s.event === event).length; }
}

function makePeer(bus: Bus, name: string) {
  const doc = new Y.Doc();
  const channel = new FakeChannel(bus);
  const provider = new SupabaseYjsProvider({
    doc, channel, user: { name, color: "#2563eb" },
  });
  return { doc, channel, provider, text: () => doc.getText("t").toString() };
}

describe("topic + payload helpers", () => {
  it("builds the topic shape the RLS policies parse", () => {
    // The migration splits on ':' and checks parts 1..3. Node ids are UUIDs and
    // contain no ':', so this stays a three-part topic.
    expect(docTopic("abc-123")).toBe("vault:doc:abc-123");
    expect(docTopic("abc-123").split(":")).toHaveLength(3);
  });

  it("flags payloads that would exceed the broadcast cap", () => {
    expect(exceedsPayloadCap("x".repeat(1_000))).toBe(false);
    expect(exceedsPayloadCap("x".repeat(250_000))).toBe(true);
  });

  it("coalesces updates into one equivalent update", () => {
    const src = new Y.Doc();
    const updates: Uint8Array[] = [];
    src.on("update", (u) => updates.push(u));
    src.getText("t").insert(0, "a");
    src.getText("t").insert(1, "b");
    src.getText("t").insert(2, "c");
    expect(updates.length).toBe(3);

    const merged = new Y.Doc();
    Y.applyUpdate(merged, coalesce(updates));
    expect(merged.getText("t").toString()).toBe("abc");
  });
});

describe("SupabaseYjsProvider", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("converges two peers editing concurrently", () => {
    const bus = new Bus();
    const a = makePeer(bus, "A");
    const b = makePeer(bus, "B");
    a.channel.connect();
    b.channel.connect();
    vi.advanceTimersByTime(TIMING.UPDATE_FLUSH_MS * 2);

    a.doc.getText("t").insert(0, "hello ");
    b.doc.getText("t").insert(0, "world");
    vi.advanceTimersByTime(TIMING.UPDATE_FLUSH_MS * 2);

    expect(a.text()).toBe(b.text());
    // Both edits survived — a CRDT merges rather than picking a winner.
    expect(a.text()).toContain("hello");
    expect(a.text()).toContain("world");
  });

  // The single most destructive bug this protocol can have. Without the origin
  // sentinel, an update applied on the network's behalf is re-broadcast, the
  // peer applies and re-broadcasts it back, and two clients saturate the
  // channel forever. It shows up as unbounded message growth, so count.
  it("never re-broadcasts an update it received", () => {
    const bus = new Bus();
    const a = makePeer(bus, "A");
    const b = makePeer(bus, "B");
    a.channel.connect();
    b.channel.connect();
    vi.advanceTimersByTime(TIMING.NO_PEER_MS * 2);

    const before = b.channel.countOf("u");
    a.doc.getText("t").insert(0, "one keystroke");
    vi.advanceTimersByTime(TIMING.UPDATE_FLUSH_MS * 4);

    // B applied A's update. B must not have emitted one of its own for it.
    expect(b.text()).toBe("one keystroke");
    expect(b.channel.countOf("u")).toBe(before);
  });

  // Two clients answering each other's state vector with a state vector is an
  // infinite ping-pong at socket speed. The sentSvTo guard bounds it.
  it("answers a peer's state vector at most once per connection", () => {
    const bus = new Bus();
    const a = makePeer(bus, "A");
    const b = makePeer(bus, "B");
    a.channel.connect();
    b.channel.connect();
    vi.advanceTimersByTime(TIMING.NO_PEER_MS * 2);

    expect(a.channel.countOf("sv")).toBeLessThanOrEqual(2);
    expect(b.channel.countOf("sv")).toBeLessThanOrEqual(2);
  });

  it("recovers edits missed while disconnected, via the state-vector diff", () => {
    const bus = new Bus();
    const a = makePeer(bus, "A");
    const b = makePeer(bus, "B");
    a.channel.connect();
    b.channel.connect();
    vi.advanceTimersByTime(TIMING.NO_PEER_MS * 2);

    // The socket dies and A keeps typing into the void.
    bus.deliver = false;
    a.doc.getText("t").insert(0, "written while offline");
    vi.advanceTimersByTime(TIMING.UPDATE_FLUSH_MS * 4);
    expect(b.text()).toBe("");

    // Reconnect. The handshake — not a replay of missed messages — is what
    // closes the gap, which is why the protocol is state-vector based.
    bus.deliver = true;
    b.channel.connect();
    vi.advanceTimersByTime(TIMING.UPDATE_FLUSH_MS * 4);

    expect(b.text()).toBe("written while offline");
  });

  it("marks itself synced when nobody answers, so persistence can proceed", () => {
    const bus = new Bus();
    const solo = makePeer(bus, "A");
    solo.channel.connect();
    expect(solo.provider.synced).toBe(false);
    vi.advanceTimersByTime(TIMING.NO_PEER_MS + 50);
    expect(solo.provider.synced).toBe(true);
  });

  it("goes offline rather than throwing when the channel errors", () => {
    const bus = new Bus();
    const a = makePeer(bus, "A");
    a.channel.drop();
    expect(a.provider.status).toBe("offline");
    // Editing must keep working — losing the socket must never lose edits.
    expect(() => a.doc.getText("t").insert(0, "still typing")).not.toThrow();
    expect(a.text()).toBe("still typing");
  });

  it("says goodbye on destroy so the peer's caret goes immediately", () => {
    const bus = new Bus();
    const a = makePeer(bus, "A");
    a.channel.connect();
    a.provider.destroy();
    expect(a.channel.countOf("bye")).toBe(1);
  });

  it("publishes the local user through awareness, which is what draws the caret", () => {
    const bus = new Bus();
    const a = makePeer(bus, "A");
    expect(a.provider.awareness.getLocalState()?.user).toEqual({ name: "A", color: "#2563eb" });
  });
});
