// Supabase Edge Function: usage-ingest
//
// The only write path into `usage_intervals`. That table has owner-scoped RLS
// and no anon policy at all (see the migration), because it holds URLs and page
// titles and the anon key is committed to a public repo.
//
// The Nexus Local daemon has no session — it authenticates with nothing but the
// anon key — so it cannot satisfy `auth.uid()`. Rather than build a refresh-token
// flow into the Rust node, it posts here with a scoped secret and this function
// stamps the owner id server-side with a service-role client. Same shape as
// `habit-toggle` / `session-toggle`.
//
// The secret ships inside a binary on the user's own machine and is extractable.
// What the design buys is a blast radius of "can append usage rows for one
// user" rather than "can read everything the anon role can reach". Do not widen
// it: this function accepts no user id, no table name and no filter from the
// caller, so a leaked key cannot be turned into a read primitive.

import { createClient } from "jsr:@supabase/supabase-js@2";

/** Reject a batch larger than this outright rather than time out mid-insert. */
const MAX_ENTRIES = 500;

/** Anything shorter is treated as unset — fail closed, never open. */
const MIN_KEY_LEN = 32;

type IncomingEntry = {
  kind: "app" | "web";
  app_name?: string | null;
  host?: string | null;
  url?: string | null;
  title?: string | null;
  start: string;
  end: string;
  seconds: number;
  local_date: string;
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Length-independent comparison.
 *
 * Compares hashes rather than bytes so the loop count reveals nothing about the
 * expected secret's length either.
 */
async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

/**
 * Must match what the daemon would compute, but is deliberately recomputed HERE
 * rather than trusted from the request: a caller that could choose its own
 * dedupe key could overwrite an existing row by colliding with it.
 */
function dedupeKey(e: IncomingEntry): string {
  const identity = e.kind === "web" ? (e.url ?? e.host ?? "") : (e.app_name ?? "");
  return `${e.kind}|${e.start}|${identity}`;
}

function validate(e: unknown): IncomingEntry | null {
  if (!e || typeof e !== "object") return null;
  const o = e as Record<string, unknown>;
  if (o.kind !== "app" && o.kind !== "web") return null;
  if (typeof o.start !== "string" || typeof o.end !== "string") return null;
  if (typeof o.local_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.local_date)) return null;
  const seconds = typeof o.seconds === "number" ? Math.floor(o.seconds) : NaN;
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  // Timestamps must actually parse — a bad one would insert and then poison
  // every consumer's date maths rather than failing here.
  if (Number.isNaN(Date.parse(o.start)) || Number.isNaN(Date.parse(o.end))) return null;
  // An app entry with no name, or a web entry with neither host nor url, would
  // aggregate under an empty label forever.
  if (o.kind === "app" && !o.app_name) return null;
  if (o.kind === "web" && !o.host && !o.url) return null;
  return {
    kind: o.kind,
    app_name: typeof o.app_name === "string" ? o.app_name : null,
    host: typeof o.host === "string" ? o.host : null,
    url: typeof o.url === "string" ? o.url : null,
    title: typeof o.title === "string" ? o.title : null,
    start: o.start,
    end: o.end,
    seconds,
    local_date: o.local_date,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expected = Deno.env.get("USAGE_INGEST_KEY") ?? "";
  const owner = Deno.env.get("USAGE_OWNER_UID") ?? "";

  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);
  // A missing or stub secret must never mean "let everyone in".
  if (expected.length < MIN_KEY_LEN) return json({ error: "server_misconfigured" }, 500);
  if (!owner) return json({ error: "server_misconfigured" }, 500);

  const presented = req.headers.get("X-Usage-Key") ?? "";
  if (!(await constantTimeEqual(presented, expected))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: { device_id?: unknown; entries?: unknown; user_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_json" }, 400);
  }

  // Which account these intervals belong to. Absent means the default owner,
  // which is what a config written before profile switching existed sends.
  //
  // A caller-supplied user id is only honoured if it is on the allowlist. That
  // matters: the scoped key ships in a binary on the user's machine and is
  // extractable, and without this check a leaked key could file arbitrary
  // browsing history under any account in the project. The allowlist keeps the
  // blast radius at "the handful of profiles that share this Mac".
  //
  // Deliberately 403 rather than falling back to the owner on a mismatch:
  // attributing one person's usage to another is a worse failure than not
  // storing it, and a silent fallback would hide a misconfigured switch forever.
  const allowed = (Deno.env.get("USAGE_ALLOWED_UIDS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const requested = typeof body.user_id === "string" ? body.user_id.trim() : "";
  if (requested && !allowed.includes(requested)) {
    console.error("usage-ingest: rejected non-allowlisted user_id");
    return json({ error: "user_not_allowed" }, 403);
  }
  const targetUser = requested || owner;

  const deviceId = typeof body.device_id === "string" ? body.device_id : "";
  if (!deviceId) return json({ error: "missing_device_id" }, 400);
  if (!Array.isArray(body.entries)) return json({ error: "missing_entries" }, 400);
  if (body.entries.length > MAX_ENTRIES) return json({ error: "batch_too_large", max: MAX_ENTRIES }, 413);

  const rows = [];
  let rejected = 0;
  for (const raw of body.entries) {
    const e = validate(raw);
    if (!e) {
      rejected++;
      continue;
    }
    rows.push({
      user_id: targetUser,
      device_id: deviceId,
      kind: e.kind,
      app_name: e.app_name,
      host: e.host,
      url: e.url,
      title: e.title,
      started_at: e.start,
      ended_at: e.end,
      seconds: e.seconds,
      local_date: e.local_date,
      dedupe_key: dedupeKey(e),
    });
  }

  if (rows.length === 0) return json({ accepted: 0, rejected });

  const supabase = createClient(url, serviceKey);
  // `ignoreDuplicates` rather than merge: an interval is immutable once closed,
  // and the daemon re-sends on retry. Merging would rewrite `created_at`
  // churn for no gain; erroring would make the daemon retry the same batch
  // forever on a record it already delivered.
  const { error } = await supabase
    .from("usage_intervals")
    .upsert(rows, { onConflict: "user_id,device_id,dedupe_key", ignoreDuplicates: true });

  if (error) {
    console.error("usage-ingest: insert failed —", error.message);
    return json({ error: "insert_failed", detail: error.message }, 500);
  }

  return json({ accepted: rows.length, rejected });
});
