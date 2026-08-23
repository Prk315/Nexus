import { describe, expect, it } from "vitest";
import { createMailLoader } from "./loader";
import {
  MAIL_CATEGORIES_TABLE,
  MAIL_CATEGORY_COLUMNS,
  MAIL_COLUMNS,
  MAIL_RULES_TABLE,
  MAIL_RULE_COLUMNS,
  MAIL_SYNC_KIND,
  MAIL_TABLE,
  N8N_REQUESTS_TABLE,
} from "./types";

/**
 * These tests exist because of a bug that reached production.
 *
 * `score` was called `priority` in the first draft. The rename landed
 * everywhere except one `.order("priority", …)` argument in the loader — and
 * PostgREST does not degrade for an unknown column, it rejects the entire
 * query with `42703 column mail_messages.priority does not exist`. The loader
 * threw, and the panel showed "Mail is unavailable" while correctly triaged
 * mail sat in the table.
 *
 * Nothing could have caught it: a column name inside a string is invisible to
 * `tsc`, the 102 tests around it all operate on already-fetched rows, and the
 * only integration point is a network call. So the query shape itself is
 * pinned here — the assertions are deliberately about the exact strings sent
 * to PostgREST, not about behaviour.
 */

type Recorded = {
  table: string;
  select: string;
  order: string[];
  eq: string[];
  in: string[];
  single: boolean;
};

function stubClient(rows: Record<string, unknown[]> = {}) {
  const calls: Recorded[] = [];
  const from = (table: string) => {
    const rec: Recorded = { table, select: "", order: [], eq: [], in: [], single: false };
    calls.push(rec);
    const builder: Record<string, unknown> = {
      select: (c: string) => ((rec.select = c), builder),
      in: (col: string) => (rec.in.push(col), builder),
      eq: (col: string) => (rec.eq.push(col), builder),
      order: (col: string) => (rec.order.push(col), builder),
      limit: () => builder,
      maybeSingle: () => ((rec.single = true), builder),
      then: (resolve: (v: unknown) => unknown) => {
        const data = rows[table] ?? [];
        return Promise.resolve({
          data: rec.single ? ((data[0] as unknown) ?? null) : data,
          error: null,
        }).then(resolve);
      },
    };
    return builder;
  };
  return { client: { from } as never, calls };
}

const find = (calls: Recorded[], table: string) =>
  calls.find((c) => c.table === table) as Recorded;

describe("createMailLoader query shape", () => {
  it("orders messages by `score`, never the pre-rename `priority`", async () => {
    const { client, calls } = stubClient();
    await createMailLoader(client)();

    const messages = find(calls, MAIL_TABLE);
    expect(messages.order).toEqual(["score", "received_at"]);
    // The specific regression: a column that no longer exists.
    expect(messages.order).not.toContain("priority");
  });

  it("selects exactly the pinned column lists", async () => {
    const { client, calls } = stubClient();
    await createMailLoader(client)();

    expect(find(calls, MAIL_TABLE).select).toBe(MAIL_COLUMNS);
    expect(find(calls, MAIL_CATEGORIES_TABLE).select).toBe(MAIL_CATEGORY_COLUMNS);
    expect(find(calls, MAIL_RULES_TABLE).select).toBe(MAIL_RULE_COLUMNS);
    // `raw` is deliberately never fetched — it is the one column holding
    // anything derived from a message body.
    expect(find(calls, MAIL_TABLE).select).not.toContain("raw");
  });

  it("reads freshness from the request queue, not from a row count", async () => {
    const { client, calls } = stubClient({
      [N8N_REQUESTS_TABLE]: [{ finished_at: "2026-08-23T20:57:10Z" }],
    });
    const snap = await createMailLoader(client)();

    const sync = find(calls, N8N_REQUESTS_TABLE);
    expect(sync.select).toBe("finished_at");
    expect(sync.eq).toEqual(["kind", "status"]);
    expect(sync.order).toEqual(["finished_at"]);
    expect(sync.single).toBe(true);
    expect(snap.lastSyncedAt).toBe("2026-08-23T20:57:10Z");
  });

  it("filters to open statuses in SQL so the row cap stays honest", async () => {
    const { client, calls } = stubClient();
    await createMailLoader(client)();
    expect(find(calls, MAIL_TABLE).in).toEqual(["status"]);
  });

  it("reports never-synced as null rather than inventing a timestamp", async () => {
    const { client } = stubClient();
    const snap = await createMailLoader(client)();
    expect(snap.lastSyncedAt).toBeNull();
    expect(snap.messages).toEqual([]);
  });

  it("throws without a client, rather than resolving to an empty inbox", async () => {
    await expect(createMailLoader(null)()).rejects.toThrow(/no Supabase client/);
  });

  it("uses the agreed queue kind for the freshness read", () => {
    // Pinned separately: this string is shared with n8n-ingest and the
    // migration, and the three disagreed once already (`mail.sync` vs
    // `mail_sync`), which strands rows in `claimed` forever.
    expect(MAIL_SYNC_KIND).toBe("mail_sync");
  });
});
