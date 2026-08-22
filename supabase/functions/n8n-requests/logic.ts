/**
 * Pure logic for `n8n-requests`, split out of `index.ts` so it can be tested
 * without booting `Deno.serve`, reaching Supabase, or reading a clock. Nothing
 * in here does I/O.
 *
 * Test files are not imported by `index.ts`, so they are never bundled into the
 * deployed function.
 */

// MARK: - Secret handling

/** Minimum length for `N8N_REQUESTS_KEY`. Below this the function fails closed. */
export const MIN_SECRET_LENGTH = 32;

/**
 * Is the configured secret usable? An unset or stubby env var must never mean
 * "allow everyone" — an empty string deploys perfectly cleanly and would turn
 * `x-n8n-key: ""` into a valid credential for every caller on the internet.
 */
export function secretIsUsable(expected: string | undefined | null): boolean {
  return typeof expected === "string" && expected.length >= MIN_SECRET_LENGTH;
}

/**
 * Constant-time comparison.
 *
 * Compares SHA-256 digests rather than raw bytes so the loop always runs over a
 * fixed 32 bytes: unlike the byte-wise variant in `session-toggle`, this leaks
 * nothing about the expected secret's *length* either. Same shape as
 * `usage-ingest`.
 */
export async function secretMatches(
  candidate: string,
  expected: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(candidate)),
    crypto.subtle.digest("SHA-256", enc.encode(expected)),
  ]);
  const a = new Uint8Array(ha);
  const b = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// MARK: - The closed allow-list

/**
 * Every `kind` this function will ever act on.
 *
 * **This list is the anti-widening rule** (the same one `usage-ingest` states):
 * the caller names no table and supplies no filter, and `kind` is checked
 * against this list rather than passed through to the query. Without that, a
 * leaked key plus a guessed `kind` would be a way to drain *any* queue that
 * happens to share the table — including one a future feature adds for
 * something more dangerous than reading mail.
 *
 * Adding a kind is a deliberate one-line change here, and must be matched by the
 * producer side and by whatever CHECK constraint `n8n_requests.kind` carries.
 */
export const ALLOWED_KINDS = [
  /** Pull recent threads/messages into Supabase for the header to render. */
  "mail.sync",
  /** Classify + summarise a batch of threads. */
  "mail.triage",
  /** Archive the named threads. */
  "mail.archive",
  /** Compose a reply and leave it in Drafts — never sends. */
  "mail.draft_reply",
] as const;

export type Kind = (typeof ALLOWED_KINDS)[number];

export function isAllowedKind(v: unknown): v is Kind {
  return typeof v === "string" && (ALLOWED_KINDS as readonly string[]).includes(v);
}

// MARK: - Limits

/** How many rows a poll takes when it does not ask. */
export const DEFAULT_LIMIT = 10;

/**
 * Hard ceiling on one claim.
 *
 * Must stay in step with the `least(p_limit, ...)` in `claim_function.sql`. The
 * SQL clamp is the load-bearing one — this is defence in depth for the ordinary
 * path, so an n8n node with a fat-fingered `limit` cannot flip the whole queue to
 * `claimed` in one poll and then die holding all of it.
 */
export const MAX_LIMIT = 50;

/**
 * Clamp an incoming limit into `[1, MAX_LIMIT]`.
 *
 * Absent means "the default", which is what a poll that just wants work sends.
 * A wrong *type* is an error rather than a silent default: `limit: "20"` from a
 * hand-written n8n expression should be fixed, not quietly turned into 10.
 * Out-of-range *numbers* clamp, because 0 and 1000 both plainly mean "as many as
 * you'll give me" / "one at a time" and neither is a bug worth failing a poll for.
 */
export function clampLimit(v: unknown): { ok: true; limit: number } | { ok: false; error: string } {
  if (v === undefined || v === null) return { ok: true, limit: DEFAULT_LIMIT };
  if (typeof v !== "number" || !Number.isFinite(v)) {
    return { ok: false, error: "invalid_limit" };
  }
  const n = Math.floor(v);
  return { ok: true, limit: Math.min(MAX_LIMIT, Math.max(1, n)) };
}

// MARK: - Request parsing

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** `N8N_OWNER_UID` must name one account. Blank must never mean "match anything". */
export function ownerUidIsUsable(v: unknown): v is string {
  return isUuid(v);
}

/**
 * A primary key for `n8n_requests`.
 *
 * Deliberately **not** uuid-only. The table is created by a sibling unit and a
 * `bigserial` primary key is an entirely ordinary choice there — but a uuid-only
 * check here would reject every integer id *after* `n8n_claim_requests` had
 * already committed `status = 'claimed'`. The rows would be flipped, dropped
 * from the response, never requeued and never logged: every poll returns
 * `count: 0` and looks exactly like an empty queue while the queue silently
 * drains. Accepting both shapes removes the unwritten contract.
 *
 * Still bounded and still a closed grammar — a uuid or a positive integer,
 * nothing else — so it cannot become a place to smuggle a PostgREST filter.
 */
export type RequestId = string | number;

export function isRequestId(v: unknown): v is RequestId {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0;
  if (typeof v !== "string") return false;
  const s = v.trim();
  return UUID_RE.test(s) || /^[1-9][0-9]{0,18}$/.test(s);
}

/** Normalise an id for use as a query value (trims a string, keeps a number). */
export function normaliseRequestId(v: RequestId): RequestId {
  return typeof v === "string" ? v.trim() : v;
}

/** `n8n_requests.error` is a message for a human, not a payload. */
export const MAX_ERROR_LENGTH = 2000;

/**
 * Ceiling on a serialised result, in UTF-16 code units of its JSON form.
 *
 * A triage run over a fat thread can legitimately be a few tens of KB; a
 * workflow that accidentally pipes an entire mailbox in should be rejected at
 * the door rather than after Postgres has toasted it.
 */
export const MAX_RESULT_CHARS = 64 * 1024;

export type ParsedRequest =
  | { ok: true; action: "claim"; kind: Kind; limit: number }
  | {
    ok: true;
    action: "complete";
    id: RequestId;
    status: "done" | "error";
    result: unknown;
    error: string | null;
  }
  | { ok: false; error: string };

/**
 * Validate the request body.
 *
 * `claim` takes an allow-listed `kind` and an optional bounded `limit`; it names
 * no user, because the owner is stamped server-side (see `index.ts`).
 * `complete` takes the id of a row and its outcome.
 */
export function parseRequest(body: unknown): ParsedRequest {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const o = body as Record<string, unknown>;

  if (o.action === "claim") {
    if (!isAllowedKind(o.kind)) return { ok: false, error: "invalid_kind" };
    const limit = clampLimit(o.limit);
    if (!limit.ok) return { ok: false, error: limit.error };
    return { ok: true, action: "claim", kind: o.kind, limit: limit.limit };
  }

  if (o.action === "complete") {
    if (!isRequestId(o.id)) return { ok: false, error: "invalid_id" };
    const id = normaliseRequestId(o.id);
    if (o.status !== "done" && o.status !== "error") {
      return { ok: false, error: "invalid_status" };
    }

    if (o.status === "error") {
      // An error with no message is the failure mode that costs an hour later:
      // the row goes red and nothing on the machine says why.
      if (typeof o.error !== "string" || o.error.trim().length === 0) {
        return { ok: false, error: "missing_error_message" };
      }
      if (o.error.length > MAX_ERROR_LENGTH) {
        return { ok: false, error: "error_message_too_long" };
      }
      return {
        ok: true,
        action: "complete",
        id,
        status: "error",
        result: null,
        error: o.error.trim(),
      };
    }

    // `done` may carry a result or nothing at all — an archive job has no output.
    const result = o.result === undefined ? null : o.result;
    const sized = resultWithinLimit(result);
    if (!sized.ok) return { ok: false, error: sized.error };

    return { ok: true, action: "complete", id, status: "done", result, error: null };
  }

  return { ok: false, error: "invalid_action" };
}

/**
 * Is the result small enough, and does it survive `JSON.stringify` at all?
 *
 * The second half matters more than the size: a value containing a cycle (or a
 * `BigInt`) throws inside supabase-js's own serialisation, which surfaces as an
 * opaque 500 *after* the row has been read and the state machine consulted.
 * Failing here makes it a 400 with a name.
 */
export function resultWithinLimit(
  result: unknown,
): { ok: true } | { ok: false; error: string } {
  if (result === null || result === undefined) return { ok: true };
  let encoded: string;
  try {
    encoded = JSON.stringify(result);
  } catch {
    return { ok: false, error: "unserialisable_result" };
  }
  // `undefined`, a function, or a symbol stringifies to literally `undefined`.
  if (typeof encoded !== "string") return { ok: false, error: "unserialisable_result" };
  if (encoded.length > MAX_RESULT_CHARS) return { ok: false, error: "result_too_large" };
  return { ok: true };
}

// MARK: - State machine

export const REQUEST_STATUSES = ["queued", "claimed", "done", "error"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export type CompletionDecision =
  /** Write the outcome. The caller still does it as a compare-and-swap. */
  | { action: "apply" }
  /** Already in exactly this terminal state — a retry. Report success, write nothing. */
  | { action: "noop"; reason: string }
  | { action: "reject"; error: string; status: number };

/**
 * May this row be completed, and with what?
 *
 * The rules, and why each one is here:
 *
 * - **A row that doesn't exist, a row belonging to someone else, and a row whose
 *   `kind` is off the allow-list are all the same answer.** The service-role
 *   client bypasses RLS, so ownership is enforced here or nowhere; answering
 *   `404` for all three means a leaked key cannot be used to probe which ids
 *   exist in other accounts.
 * - **The allow-list gates `complete` as well as `claim`.** Checking it only on
 *   the way out would leave a key that may claim nothing but `mail.*` able to
 *   mark *any* row in the table done and write arbitrary JSON into its result —
 *   including a future queue for something more dangerous than reading mail.
 *   The table is named `n8n_requests`, not `mail_requests`, so assume it will
 *   hold one.
 * - **Only a `claimed` row may be completed.** Completing a `queued` row is n8n
 *   reporting on work it never took — and worse, it races a concurrent claim: the
 *   claimer would go on to run the job that has just been marked done, which for
 *   `mail.draft_reply` means a second draft and for anything sending means a
 *   double-send.
 * - **The same terminal state twice is a no-op success, not a conflict.** n8n
 *   retries a step whose HTTP response was lost, and a 409 there turns a
 *   delivered result into a failed workflow. Crucially it does not *rewrite* the
 *   row: the first result stands.
 * - **A different terminal state is a conflict.** `done` becoming `error` (or the
 *   reverse) is two workers disagreeing about one job, and silently letting the
 *   late one win would hide it.
 */
export function decideCompletion(
  row: { status?: unknown; user_id?: unknown; kind?: unknown } | null | undefined,
  ownerUid: string,
  target: "done" | "error",
): CompletionDecision {
  const notFound: CompletionDecision = {
    action: "reject",
    error: "unknown_request",
    status: 404,
  };

  if (!row) return notFound;
  // A blank/garbage owner must refuse everything rather than become a wildcard.
  if (!ownerUidIsUsable(ownerUid)) return notFound;
  if (typeof row.user_id !== "string" || row.user_id !== ownerUid) return notFound;
  if (!isAllowedKind(row.kind)) return notFound;

  const status = row.status;
  if (typeof status !== "string" || !(REQUEST_STATUSES as readonly string[]).includes(status)) {
    return { action: "reject", error: "invalid_state", status: 409 };
  }

  if (status === "claimed") return { action: "apply" };
  if (status === "queued") return { action: "reject", error: "not_claimed", status: 409 };
  if (status === target) return { action: "noop", reason: `already_${status}` };
  return { action: "reject", error: "already_completed", status: 409 };
}

// MARK: - Response shape

export interface ClaimedRequest {
  id: RequestId;
  kind: Kind;
  payload: unknown;
  createdAt: string | null;
  claimedAt: string | null;
}

/**
 * Project a claimed row into the JSON n8n consumes.
 *
 * Deliberately a fixed projection rather than the raw row: `select *` on a table
 * a sibling unit owns would start leaking any column added later (a stored
 * result from a *previous* run, say) to a key whose whole point is a narrow
 * blast radius.
 */
export function toClaimedRequest(row: Record<string, unknown>): ClaimedRequest | null {
  if (!isRequestId(row.id) || !isAllowedKind(row.kind)) return null;
  return {
    id: normaliseRequestId(row.id),
    kind: row.kind,
    payload: row.payload ?? null,
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    claimedAt: typeof row.claimed_at === "string" ? row.claimed_at : null,
  };
}

/**
 * Map an RPC payload to the wire shape.
 *
 * `dropped` is returned, not swallowed. By the time this runs the RPC has
 * already committed `status = 'claimed'`, so a row that fails to map is not a
 * parse nicety — it is work that has been taken out of the queue and will never
 * be delivered, requeued or noticed. The caller logs it loudly; without that,
 * a schema mismatch reads as "the queue is empty".
 */
export function toClaimedRequests(
  rows: unknown,
): { requests: ClaimedRequest[]; dropped: number } {
  if (!Array.isArray(rows)) {
    // A non-array is not "no rows" — the RPC always returns an array on success,
    // so this is a shape the caller should hear about.
    return { requests: [], dropped: rows === null || rows === undefined ? 0 : 1 };
  }
  const requests: ClaimedRequest[] = [];
  let dropped = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object" || Array.isArray(r)) {
      dropped++;
      continue;
    }
    const mapped = toClaimedRequest(r as Record<string, unknown>);
    if (mapped) requests.push(mapped);
    else dropped++;
  }
  return { requests, dropped };
}
