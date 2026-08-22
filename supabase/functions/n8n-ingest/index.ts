import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  chunk,
  type ExistingRow,
  MAX_ITEMS,
  mergeStatus,
  parsePayload,
  secretIsUsable,
  secretMatches,
} from "./logic.ts";

/**
 * n8n-ingest — the only write path into `mail_messages`.
 *
 * # Why this function exists at all
 *
 * The Gmail triage pipeline runs entirely on the Mac: n8n pulls messages, hands
 * them to a local Qwen via Ollama for a priority score and a suggested reply,
 * and the result has to reach a UI that is served from Vercel and read on an
 * iPhone. Those clients cannot reach `http://localhost:5678` — an HTTPS page
 * cannot fetch plaintext localhost, and the phone is not on the Mac's loopback
 * at all. So the header never talks to n8n. n8n pushes here, Supabase holds the
 * rows, and every client just reads a table.
 *
 * # Security posture — the same five invariants as `habit-toggle`
 *
 * 1. POST only; anything else is 405.
 * 2. Fails closed: a missing or under-32-character `N8N_INGEST_KEY` is
 *    `500 server_misconfigured`. An unset secret must NEVER mean "allow
 *    everyone" — an empty env var deploys perfectly cleanly and would make
 *    `x-n8n-key: ""` a valid credential.
 * 3. Constant-time comparison of the presented key.
 * 4. Service-role client, so the write does not depend on any RLS policy.
 * 5. Server-side owner re-check. The service role *bypasses* RLS, so ownership
 *    is enforced in code here or it is not enforced at all.
 *
 * And the anti-widening rule from `usage-ingest`, which matters more here than
 * anywhere: this function accepts **no table name, no user id and no filter**
 * from the caller. The owner uid is a server-side constant. A leaked key can
 * append triaged mail to one account and nothing else — it cannot be turned
 * into a read primitive over the rest of the project.
 *
 * The residual risk, stated plainly: the key lives in an n8n credential on the
 * user's own Mac. What the design buys is a blast radius of "can write this
 * user's mail triage rows" rather than "can read and write everything the anon
 * role can reach".
 *
 * # The payload is untrusted twice over
 *
 * `subject`, `snippet`, `category` and `suggested_reply` were written by
 * strangers and then rewritten by an LLM that read those strangers' text. They
 * are **data, never instructions** (`socratic-judge` states the same posture for
 * learner answers). Nothing in this function branches on their content; `logic.ts`
 * bounds and de-controls them. In particular `suggested_reply` is a *draft for
 * the user to read and send*, never something any part of this system acts on.
 *
 * # An untriaged row says so
 *
 * `priority` is nullable and NULL means "triage produced no verdict", which is
 * a different fact from "triage scored it medium". `triaged_at` and
 * `triage_model` are NULL exactly when `priority` is. The panel reads
 * `priority desc nulls first`, so a message the model failed on surfaces at the
 * top where a human notices it, rather than sitting mid-list looking scored.
 * This is `blocking_state`'s invariant in a different table: a missing verdict
 * must never be indistinguishable from a computed one.
 */

/**
 * The one account these rows may ever belong to.
 *
 * Sourced the same way `habit-toggle` sources it — a literal in the function,
 * not a header, a body field or a query parameter. That is the whole anti-
 * widening property: there is no input that can move the write to another user.
 */
const OWNER_UID = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

/**
 * How many `external_id`s to ask about per lookup request.
 *
 * PostgREST puts an `in.(...)` filter in the **query string**, so the bound
 * that matters is URL bytes, not rows. `MAX_EXTERNAL_ID` is 128, so a chunk of
 * 50 is at most ~6.5 KB (and ~1 KB for real Gmail ids), comfortably under the
 * gateway's request-line limit. Exceeding it fails as an opaque 414 that names
 * nothing.
 */
const LOOKUP_CHUNK = 50;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expected = Deno.env.get("N8N_INGEST_KEY") ?? "";

  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);
  // Fail closed. Never open.
  if (!secretIsUsable(expected)) return json({ error: "server_misconfigured" }, 500);

  if (!secretMatches(req.headers.get("x-n8n-key") ?? "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  // Sampled exactly once and threaded through, so every row in a batch shares
  // one `triaged_at` fallback and `logic.ts` stays clock-free. Same discipline
  // as `session-toggle`, where two clock reads in one request would let
  // `end_time` and `duration_seconds` disagree.
  const parsed = parsePayload(body, new Date().toISOString());
  if (!parsed.ok) {
    return json(
      parsed.error === "batch_too_large"
        ? { error: parsed.error, max: MAX_ITEMS }
        : { error: parsed.error },
      parsed.status,
    );
  }

  const { rows, rejected, rejectedReasons } = parsed;

  // A batch that was entirely rejected is not a success, even though nothing
  // failed. It is what a broken field mapping looks like, and without this it
  // would show up in n8n's execution log as a green 200 forever.
  if (rejected > 0) {
    console.warn("n8n-ingest: rejected", rejected, "of", rejected + rows.length, rejectedReasons);
  }
  if (rows.length === 0) {
    return json({ upserted: 0, inserted: 0, rejected, rejectedReasons });
  }

  const supabase = createClient(url, serviceKey);

  // MARK: - Owner re-check, and why it doubles as status preservation
  //
  // Two jobs in one query, both mandatory:
  //
  // 1. **Ownership.** The service role bypasses RLS, so every statement in this
  //    function names OWNER_UID explicitly — this read, and every row written
  //    below. Defence in depth: there is no input that can move either one to
  //    another account, and a message id that happens to exist under a
  //    different user is simply not visible here.
  //
  // 2. **`status` is the user's, not the ingester's.** n8n re-sends the same
  //    message on every poll; a blind upsert would reset an archived message to
  //    `unread` on the next pass, i.e. the triage list would resurrect
  //    everything the user had just cleared. `mergeStatus` carries the existing
  //    value forward.
  //
  //    Omitting `status` from the payload entirely would also work — PostgREST
  //    only writes `SET col = EXCLUDED.col` for columns present in the payload —
  //    but that makes correctness depend on the column carrying a DEFAULT in a
  //    migration this unit does not own. Reading it is the version that is right
  //    whatever the DDL says. The cost is a read-then-write that is not atomic
  //    against a user archiving in the same instant; that race loses at most one
  //    status flip and cannot corrupt anything.
  const existing: ExistingRow[] = [];
  for (const ids of chunk(rows.map((r) => r.external_id), LOOKUP_CHUNK)) {
    const { data, error: lookupError } = await supabase
      .from("mail_messages")
      .select("external_id,status")
      .eq("user_id", OWNER_UID)
      .in("external_id", ids);

    // Fail loudly, and before any write. A failed lookup means the statuses are
    // unknown, and writing anyway would stamp DEFAULT_STATUS over every archived
    // message in the batch — a fresh-looking wrong state, which is exactly what
    // `focus-evaluate` aborts to avoid. n8n retries; a 500 costs one cycle.
    if (lookupError) {
      console.error("n8n-ingest: status lookup failed —", lookupError.message);
      return json({ error: "lookup_failed" }, 500);
    }
    if (data) existing.push(...data);
  }

  // `user_id` is stamped here, from the module constant. Never from the request.
  const { rows: payload, inserted } = mergeStatus(rows, existing, OWNER_UID);

  // One statement for the whole batch: it either lands or it does not, so a
  // failure leaves the table exactly as it was rather than half-synced.
  // `logic.ts` has already collapsed duplicate `external_id`s within the batch —
  // Postgres rejects an ON CONFLICT DO UPDATE that would touch a row twice
  // (21000), which would fail all 500 messages over one repeat.
  //
  // No `count: "exact"`: with merge-duplicates every payload row is affected, so
  // the returned count is always `payload.length` and the extra counting pass
  // buys nothing. `inserted` is the number that can actually surprise you.
  const { error: upsertError } = await supabase
    .from("mail_messages")
    .upsert(payload, { onConflict: "user_id,external_id" });

  if (upsertError) {
    console.error("n8n-ingest: upsert failed —", upsertError.message);
    return json({ error: "upsert_failed", detail: upsertError.message }, 500);
  }

  return json({
    upserted: payload.length,
    // How many of those were new. A sync that has silently stopped seeing fresh
    // mail reports `inserted: 0` here rather than looking like every other
    // successful poll.
    inserted,
    rejected,
    rejectedReasons,
  });
});
