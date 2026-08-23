import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  ALLOWED_KINDS,
  decideCompletion,
  ownerUidIsUsable,
  parseRequest,
  secretIsUsable,
  secretMatches,
  toClaimedRequests,
} from "./logic.ts";

/**
 * n8n-requests — the consumer half of the Supabase work bus.
 *
 * # Why the bus exists at all
 *
 * The shared `NexusHeader` runs inside Vault / PathFinder / Protocol, which are
 * Vercel-served HTTPS pages, and on an iPhone that is not on the LAN. None of
 * those can reach `http://localhost:5678`: mixed content blocks it, CORS blocks
 * it, and the phone has no route to it anyway. So the header never talks to n8n.
 * Clients enqueue rows in `n8n_requests`; the locally-hosted n8n polls this
 * function for them and posts results back.
 *
 * # Why n8n does not just use the service-role key
 *
 * That is the entire point of this function. A self-hosted n8n stores
 * credentials in its own database and pastes them into workflow nodes; handing
 * it a service-role key would put a key that bypasses every RLS policy in the
 * project inside a tool whose job is to run whatever a workflow tells it to.
 * Instead n8n holds one scoped secret good for exactly two operations on exactly
 * one table, for exactly one user — same posture as `habit-toggle`,
 * `session-toggle` and `usage-ingest`:
 *
 *     npx supabase secrets set N8N_REQUESTS_KEY=<64 hex chars> --project-ref efxmzsdisaymtpebaxlp
 *
 * # Anti-widening
 *
 * Following `usage-ingest`: this function accepts **no table name, no user id and
 * no filter** from the caller. `kind` is checked against a closed allow-list in
 * `logic.ts` rather than passed through — otherwise a leaked key plus a guessed
 * string becomes a way to drain any queue that ever shares this table. The one
 * caller-supplied identifier, `complete`'s row id, is re-checked against the
 * owner server-side, because the service role bypasses RLS.
 */

/**
 * Whose queue this function serves.
 *
 * Env-overridable, but with a real default so a deploy that forgets the var
 * fails *closed* (the owner check refuses every row) rather than open. A blank
 * or malformed value is a 500, never "match anything".
 */
const DEFAULT_OWNER_UID = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";

/**
 * Result column on `n8n_requests`, owned by the sibling unit that writes the
 * migration. One constant so a rename there is a one-line change here.
 */
const RESULT_COLUMN = "result";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expected = Deno.env.get("N8N_REQUESTS_KEY") ?? "";
  const ownerUid = (Deno.env.get("N8N_OWNER_UID") ?? DEFAULT_OWNER_UID).trim();

  if (!url || !serviceKey) return json({ error: "server_misconfigured" }, 500);
  // Fail closed: an unset or stubby secret must never mean "allow everyone".
  if (!secretIsUsable(expected)) return json({ error: "server_misconfigured" }, 500);
  // A blank or non-uuid owner would make every `.eq("user_id", …)` a Postgres
  // cast error rather than an honest refusal, and the claim RPC would 500 on
  // every poll. It must never be allowed to degrade into "match anything".
  if (!ownerUidIsUsable(ownerUid)) return json({ error: "server_misconfigured" }, 500);

  if (!(await secretMatches(req.headers.get("x-n8n-key") ?? "", expected))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const parsed = parseRequest(body);
  if (!parsed.ok) {
    // Echo the allow-list on a bad kind: the caller is a workflow being wired up
    // by hand, and "invalid_kind" alone sends someone reading source for it.
    return parsed.error === "invalid_kind"
      ? json({ error: parsed.error, allowed: ALLOWED_KINDS }, 400)
      : json({ error: parsed.error }, 400);
  }

  const supabase = createClient(url, serviceKey);

  // MARK: - claim

  if (parsed.action === "claim") {
    // One statement, server-side. The `update … where id in (select … for
    // update skip locked limit N) returning *` shape lives in
    // `claim_function.sql` because PostgREST cannot express row locking — and a
    // read-then-write across two round trips is a race that hands the same job
    // to two overlapping polls, which for mail means sending twice.
    //
    // `p_user_id` is stamped from the server's own constant. It is not, and must
    // never become, a field on the request body.
    const { data, error } = await supabase.rpc("n8n_claim_requests", {
      p_user_id: ownerUid,
      p_kind: parsed.kind,
      p_limit: parsed.limit,
    });

    if (error) {
      console.error("n8n-requests: claim failed —", error.message);
      return json({ error: "claim_failed", detail: error.message }, 500);
    }

    const { requests, dropped } = toClaimedRequests(data);
    if (dropped > 0) {
      // These rows are already `claimed` in the database and are about to be
      // delivered to nobody. Silence here would make a schema mismatch look
      // exactly like an empty queue while the queue drains.
      console.error(
        `n8n-requests: DROPPED ${dropped} claimed row(s) for kind=${parsed.kind} — ` +
          "they are marked claimed and will not be delivered or requeued",
      );
    }
    return json({ ok: true, count: requests.length, dropped, requests });
  }

  // MARK: - complete

  // Read before write so the state machine can distinguish "unknown row",
  // "never claimed" and "already finished" — an UPDATE alone reports all three
  // as zero rows, and a retried delivery would look identical to a bogus one.
  //
  // One plain string literal, and only the columns the decision needs. Not a
  // template literal: supabase-js parses the select at the type level and a
  // computed expression collapses the row type to GenericStringError the moment
  // anyone types this client with `createClient<Database>`. And not `*`: the
  // stored `result` is bounded at 64 KB and would be pulled over the wire on
  // every completion for nothing.
  const { data: row, error: lookupError } = await supabase
    .from("n8n_requests")
    .select("id,user_id,status,kind")
    .eq("id", parsed.id)
    .maybeSingle();

  if (lookupError) {
    console.error("n8n-requests: lookup failed —", lookupError.message);
    return json({ error: "lookup_failed" }, 500);
  }

  // Defence in depth: the service role bypasses RLS, so ownership is enforced
  // here or nowhere. A row belonging to someone else — or carrying a `kind` this
  // key may not touch — answers exactly as a row that does not exist, so a
  // leaked key cannot probe for ids.
  const decision = decideCompletion(row, ownerUid, parsed.status);
  if (decision.action === "reject") {
    return json({ error: decision.error, id: parsed.id }, decision.status);
  }
  if (decision.action === "noop") {
    // A retry of a delivery whose response was lost. Report success and leave
    // the stored result alone — the first writer's is the real one.
    return json({ ok: true, id: parsed.id, status: parsed.status, alreadyCompleted: true });
  }

  const patch: Record<string, unknown> = {
    status: parsed.status,
    // Sampled here rather than by Postgres, unlike `claimed_at` which the RPC
    // sets with `now()`. Both are RFC3339 UTC so this is not the two-formats
    // trap, but clock skew between the edge runtime and the database can make
    // `completed_at < claimed_at`. Don't build a duration metric on the pair
    // without moving this to `now()` server-side first.
    completed_at: new Date().toISOString(),
    error: parsed.error,
  };
  patch[RESULT_COLUMN] = parsed.result;

  // Compare-and-swap on `status = 'claimed'`, not just the id. Between the read
  // above and this write another worker can have completed the same row; without
  // this predicate the loser would overwrite the winner's result.
  //
  // `kind` is re-asserted here too, not merely checked against the row that was
  // read: the read and the write are separate round trips, and the allow-list
  // has to hold at the moment of the write.
  const { data: updated, error: updateError } = await supabase
    .from("n8n_requests")
    .update(patch)
    .eq("id", parsed.id)
    .eq("user_id", ownerUid)
    .eq("status", "claimed")
    .in("kind", [...ALLOWED_KINDS])
    .select("id");

  if (updateError) {
    console.error("n8n-requests: complete failed —", updateError.message);
    return json({ error: "complete_failed", detail: updateError.message }, 500);
  }

  // Zero rows means the CAS lost: something changed this row between the read
  // and the write. Re-read before answering, because the overwhelmingly likely
  // cause is the very case the state machine exists to absorb — two overlapping
  // deliveries of the *same* completion, both of which read `claimed`. Returning
  // 409 there would turn a delivered result into a failed n8n workflow, which is
  // exactly what `decideCompletion`'s idempotency rule forbids.
  if (!Array.isArray(updated) || updated.length === 0) {
    const { data: after } = await supabase
      .from("n8n_requests")
      .select("id,user_id,status,kind")
      .eq("id", parsed.id)
      .maybeSingle();

    // Only the `noop` verdict — already in exactly this terminal state — is a
    // success. Anything else (including the row somehow being `claimed` again,
    // i.e. re-claimed by a newer worker) is a genuine disagreement, and this
    // request has no business deciding whose result wins.
    if (decideCompletion(after, ownerUid, parsed.status).action === "noop") {
      return json({ ok: true, id: parsed.id, status: parsed.status, alreadyCompleted: true });
    }
    return json({ error: "state_changed", id: parsed.id }, 409);
  }

  return json({ ok: true, id: parsed.id, status: parsed.status });
});
