import { describe, it, expect, vi, beforeEach } from "vitest";

// The Supabase client is replaced wholesale: what is worth testing here is the
// PROTOCOL — who is subscribed, who is ignored, what is sent — not that
// supabase-js can open a websocket.
const sent: Array<{ topic: string; payload: any }> = [];
const handlers = new Map<string, (msg: any) => void>();
const configs = new Map<string, any>();
const removed: string[] = [];

vi.mock("./supabase", () => ({
  supabase: {
    channel(topic: string, config: any) {
      configs.set(topic, config);
      const ch = {
        topic,
        on(_type: string, _filter: any, cb: (msg: any) => void) { handlers.set(topic, cb); return ch; },
        subscribe() { return ch; },
        send(msg: any) { sent.push({ topic, payload: msg.payload }); return Promise.resolve("ok"); },
      };
      return ch;
    },
    removeChannel(ch: any) { removed.push(ch.topic); return Promise.resolve("ok"); },
  },
}));

const { subscribeShares, newClientId } = await import("./shareChannel");

beforeEach(() => { sent.length = 0; handlers.clear(); configs.clear(); removed.length = 0; });

/** Deliver a broadcast to a topic, as the server would. */
const deliver = (shareId: string, from: string) =>
  handlers.get(`vault:share:${shareId}`)?.({ payload: { from } });

describe("subscribeShares", () => {
  it("opens one channel per share, on a topic derived from the share key", () => {
    subscribeShares(["abc", "def"], "me", () => {});
    expect([...configs.keys()].sort()).toEqual(["vault:share:abc", "vault:share:def"]);
  });

  // ⚠️ Same note as the CRDT channel: RLS on realtime.messages is only
  // consulted for PRIVATE joins. Without this flag a client joins the same
  // topic and reads every announcement, and the anon key is committed.
  it("joins privately", () => {
    subscribeShares(["abc"], "me", () => {});
    expect(configs.get("vault:share:abc").config.private).toBe(true);
  });

  // ⚠️ Two notes open side by side are the MAIN case and are one Supabase
  // client on one socket. `self: false` is client-granular, so relying on it
  // risks suppressing exactly the delivery this feature exists for. We opt in
  // and filter by sender id instead.
  it("does not rely on `self: false` to avoid its own echo", () => {
    subscribeShares(["abc"], "me", () => {});
    expect(configs.get("vault:share:abc").config.broadcast.self).toBe(true);
  });

  it("notifies on someone else's announcement", () => {
    const seen: string[] = [];
    subscribeShares(["abc"], "me", (id) => seen.push(id));
    deliver("abc", "someone-else");
    expect(seen).toEqual(["abc"]);
  });

  it("ignores its own announcement", () => {
    const seen: string[] = [];
    subscribeShares(["abc"], "me", (id) => seen.push(id));
    deliver("abc", "me");
    expect(seen).toEqual([]);
  });

  it("survives a malformed message rather than throwing into the socket", () => {
    const seen: string[] = [];
    subscribeShares(["abc"], "me", (id) => seen.push(id));
    expect(() => handlers.get("vault:share:abc")!(undefined as never)).not.toThrow();
    expect(() => handlers.get("vault:share:abc")!({} as never)).not.toThrow();
    // No `from` at all is not us, so it counts as a remote change.
    expect(seen.length).toBeGreaterThanOrEqual(1);
  });

  it("announces with its own id so peers can filter it", () => {
    const ch = subscribeShares(["abc"], "me", () => {});
    ch.announce("abc");
    expect(sent).toEqual([{ topic: "vault:share:abc", payload: { from: "me" } }]);
  });

  // A save can race a re-subscribe. Opening a channel as a side effect of a
  // write would be a socket leak; dropping the announcement only costs the
  // peer a stale copy until it reopens — which is the pre-existing behaviour.
  it("drops an announcement for a share it is not subscribed to", () => {
    const ch = subscribeShares(["abc"], "me", () => {});
    ch.announce("not-subscribed");
    expect(sent).toEqual([]);
  });

  it("closes every channel it opened", () => {
    const ch = subscribeShares(["abc", "def"], "me", () => {});
    ch.close();
    expect(removed.sort()).toEqual(["vault:share:abc", "vault:share:def"]);
    // And announcing afterwards is inert rather than an error.
    expect(() => ch.announce("abc")).not.toThrow();
    expect(sent).toEqual([]);
  });

  it("opens nothing for an empty set", () => {
    subscribeShares([], "me", () => {});
    expect(configs.size).toBe(0);
  });
});

describe("newClientId", () => {
  // Per hook instance, not per browser: two panes in one window must be able
  // to notify each other.
  it("is distinct each time", () => {
    const ids = new Set(Array.from({ length: 20 }, newClientId));
    expect(ids.size).toBe(20);
  });
});
