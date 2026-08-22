import { assertEquals } from "jsr:@std/assert@1";
import {
  ALLOWED_KINDS,
  clampLimit,
  type CompletionDecision,
  decideCompletion,
  DEFAULT_LIMIT,
  isAllowedKind,
  isRequestId,
  isUuid,
  MAX_ERROR_LENGTH,
  MAX_LIMIT,
  MAX_RESULT_CHARS,
  ownerUidIsUsable,
  parseRequest,
  resultWithinLimit,
  secretIsUsable,
  secretMatches,
  toClaimedRequest,
  toClaimedRequests,
} from "./logic.ts";

const KEY = "k".repeat(48);
const OWNER = "a33625c2-4dd2-44fa-b2e5-4d455eeac59d";
const OTHER = "870ca14b-0000-4000-8000-000000000001";
const ID = "11111111-2222-4333-8444-555555555555";

// MARK: - Secret handling

Deno.test("secretIsUsable fails closed on unset and stubby secrets", () => {
  // Each of these deploys perfectly cleanly, and each would otherwise be a valid
  // credential for anyone on the internet.
  assertEquals(secretIsUsable(undefined), false);
  assertEquals(secretIsUsable(null), false);
  assertEquals(secretIsUsable(""), false);
  assertEquals(secretIsUsable("dev"), false);
  assertEquals(secretIsUsable("x".repeat(31)), false);
  assertEquals(secretIsUsable("x".repeat(32)), true);
});

Deno.test("secretMatches is exact", async () => {
  assertEquals(await secretMatches(KEY, KEY), true);
  assertEquals(await secretMatches("", KEY), false);
  assertEquals(await secretMatches(KEY + "z", KEY), false);
  assertEquals(await secretMatches(KEY.slice(0, -1), KEY), false);
  assertEquals(await secretMatches("z" + KEY.slice(1), KEY), false);
  assertEquals(await secretMatches(KEY.slice(0, -1) + "z", KEY), false);
});

Deno.test("secretMatches handles multibyte without throwing", async () => {
  const k = "ø".repeat(40);
  assertEquals(await secretMatches(k, k), true);
  assertEquals(await secretMatches("o".repeat(40), k), false);
});

// MARK: - The closed allow-list

Deno.test("isAllowedKind admits only the listed kinds", () => {
  for (const k of ALLOWED_KINDS) assertEquals(isAllowedKind(k), true);
  // The whole anti-widening point: no wildcards, no prefixes, no case slop, and
  // nothing that could name a queue this key has no business draining.
  for (
    const bad of [
      "",
      "*",
      "mail",
      "mail.",
      "mail.*",
      "mail.SYNC",
      " mail.sync",
      "mail.sync ",
      "mail.send",
      "mail.delete",
      "grid.exec",
      null,
      undefined,
      1,
      {},
      ["mail.sync"],
    ]
  ) {
    assertEquals(isAllowedKind(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test("the allow-list is pinned, so widening it is a deliberate edit", () => {
  // A snapshot rather than a predicate on purpose. A "contains no kind with
  // 'send' in the name" check passes happily for `mail.deliver` or
  // `mail.reply_now`, which do the exact thing the list is meant to keep out:
  // a duplicate claim of a sending kind is a duplicate email. Pinning the whole
  // list forces any addition through this test.
  assertEquals([...ALLOWED_KINDS], [
    "mail.sync",
    "mail.triage",
    "mail.archive",
    "mail.draft_reply",
  ]);
});

// MARK: - Limits

Deno.test("clampLimit defaults when absent", () => {
  assertEquals(clampLimit(undefined), { ok: true, limit: DEFAULT_LIMIT });
  assertEquals(clampLimit(null), { ok: true, limit: DEFAULT_LIMIT });
});

Deno.test("clampLimit clamps out-of-range numbers into [1, MAX_LIMIT]", () => {
  assertEquals(clampLimit(0), { ok: true, limit: 1 });
  assertEquals(clampLimit(-5), { ok: true, limit: 1 });
  assertEquals(clampLimit(1), { ok: true, limit: 1 });
  assertEquals(clampLimit(10), { ok: true, limit: 10 });
  assertEquals(clampLimit(MAX_LIMIT), { ok: true, limit: MAX_LIMIT });
  // A fat-fingered limit must not let one poll flip the whole queue to
  // `claimed` and then die holding all of it.
  assertEquals(clampLimit(MAX_LIMIT + 1), { ok: true, limit: MAX_LIMIT });
  assertEquals(clampLimit(1_000_000), { ok: true, limit: MAX_LIMIT });
  // Fractions floor rather than reaching Postgres as a non-integer.
  assertEquals(clampLimit(7.9), { ok: true, limit: 7 });
  assertEquals(clampLimit(0.4), { ok: true, limit: 1 });
});

Deno.test("clampLimit rejects wrong types rather than silently defaulting", () => {
  // `limit: "20"` is the classic n8n expression typo. Quietly turning it into 10
  // makes the workflow look like it works while claiming half what it asked for.
  for (const bad of ["20", true, {}, [], NaN, Infinity, -Infinity]) {
    assertEquals(clampLimit(bad), { ok: false, error: "invalid_limit" });
  }
});

// MARK: - Request parsing: shape

Deno.test("parseRequest rejects non-object bodies", () => {
  for (const bad of [null, undefined, 1, "claim", [], true]) {
    assertEquals(parseRequest(bad), { ok: false, error: "invalid_body" });
  }
});

Deno.test("parseRequest rejects unknown actions", () => {
  for (const action of [undefined, "", "CLAIM", "requeue", "delete", 1, null]) {
    assertEquals(parseRequest({ action }), { ok: false, error: "invalid_action" });
  }
});

// MARK: - Request parsing: claim

Deno.test("parseRequest accepts a claim with an allow-listed kind", () => {
  assertEquals(parseRequest({ action: "claim", kind: "mail.triage" }), {
    ok: true,
    action: "claim",
    kind: "mail.triage",
    limit: DEFAULT_LIMIT,
  });
  assertEquals(parseRequest({ action: "claim", kind: "mail.sync", limit: 3 }), {
    ok: true,
    action: "claim",
    kind: "mail.sync",
    limit: 3,
  });
});

Deno.test("parseRequest refuses a claim for a kind off the list", () => {
  for (const kind of [undefined, "", "mail.send", "*", "pf_tasks"]) {
    assertEquals(parseRequest({ action: "claim", kind }), {
      ok: false,
      error: "invalid_kind",
    });
  }
});

Deno.test("parseRequest ignores a caller-supplied user_id on claim", () => {
  // The owner is stamped server-side. If this ever started echoing a caller's
  // user id, a leaked key would become a way to drain someone else's queue.
  const parsed = parseRequest({
    action: "claim",
    kind: "mail.sync",
    user_id: OTHER,
    table: "pf_tasks",
  });
  assertEquals(parsed, { ok: true, action: "claim", kind: "mail.sync", limit: DEFAULT_LIMIT });
  assertEquals("user_id" in parsed, false);
  assertEquals("table" in parsed, false);
});

// MARK: - Request parsing: complete

Deno.test("parseRequest requires a well-formed id on complete", () => {
  for (const id of [undefined, null, "", "   ", "not-a-uuid", 0, -1, 1.5, {}, [], true]) {
    assertEquals(parseRequest({ action: "complete", id, status: "done" }), {
      ok: false,
      error: "invalid_id",
    });
  }
  assertEquals(isUuid(ID), true);
});

Deno.test("isRequestId accepts both uuid and integer primary keys", () => {
  // The sibling unit owns the DDL and `bigserial` is an ordinary choice there.
  // A uuid-only check here would reject every id *after* the claim RPC had
  // already flipped those rows to `claimed` — draining the queue into a black
  // hole that reads as "no work".
  assertEquals(isRequestId(ID), true);
  assertEquals(isRequestId(ID.toUpperCase()), true);
  assertEquals(isRequestId(1), true);
  assertEquals(isRequestId(9007199254740991), true);
  assertEquals(isRequestId("42"), true);
  assertEquals(isRequestId(" 42 "), true);

  // Still a closed grammar — it must not become a place to smuggle a filter.
  for (
    const bad of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      "",
      "  ",
      "042",
      "1;drop",
      "eq.1",
      "*",
      "1,2",
      "9".repeat(20),
      null,
      undefined,
      {},
      [1],
      true,
    ]
  ) {
    assertEquals(isRequestId(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test("parseRequest accepts an integer id and trims a string one", () => {
  assertEquals(parseRequest({ action: "complete", id: 7, status: "done" }), {
    ok: true,
    action: "complete",
    id: 7,
    status: "done",
    result: null,
    error: null,
  });
  assertEquals(parseRequest({ action: "complete", id: ` ${ID} `, status: "done" }), {
    ok: true,
    action: "complete",
    id: ID,
    status: "done",
    result: null,
    error: null,
  });
});

// MARK: - Owner uid

Deno.test("ownerUidIsUsable refuses anything that isn't one account", () => {
  // A blank N8N_OWNER_UID must be a 500, never a wildcard that matches every row.
  assertEquals(ownerUidIsUsable(OWNER), true);
  for (const bad of [undefined, null, "", "   ", "default", "*", OWNER.slice(0, -1), 1]) {
    assertEquals(ownerUidIsUsable(bad), false, `should reject ${JSON.stringify(bad)}`);
  }
});

Deno.test("parseRequest rejects statuses that aren't terminal", () => {
  // `queued` and `claimed` are the machine's business, not a worker's: letting a
  // caller write them back would let n8n un-claim or re-queue arbitrary rows.
  for (const status of [undefined, "queued", "claimed", "DONE", "ok", "failed", 1]) {
    assertEquals(parseRequest({ action: "complete", id: ID, status }), {
      ok: false,
      error: "invalid_status",
    });
  }
});

Deno.test("parseRequest accepts done with and without a result", () => {
  assertEquals(parseRequest({ action: "complete", id: ID, status: "done" }), {
    ok: true,
    action: "complete",
    id: ID,
    status: "done",
    result: null,
    error: null,
  });
  assertEquals(
    parseRequest({ action: "complete", id: ID, status: "done", result: { archived: 4 } }),
    {
      ok: true,
      action: "complete",
      id: ID,
      status: "done",
      result: { archived: 4 },
      error: null,
    },
  );
});

Deno.test("parseRequest drops any error message supplied alongside done", () => {
  // Otherwise a row reads `status: done` with a populated error column and every
  // consumer has to guess which one to believe.
  assertEquals(
    parseRequest({ action: "complete", id: ID, status: "done", error: "boom" }),
    { ok: true, action: "complete", id: ID, status: "done", result: null, error: null },
  );
});

Deno.test("parseRequest demands a real message on error", () => {
  for (const error of [undefined, null, "", "   ", 42, {}]) {
    assertEquals(parseRequest({ action: "complete", id: ID, status: "error", error }), {
      ok: false,
      error: "missing_error_message",
    });
  }
  assertEquals(
    parseRequest({ action: "complete", id: ID, status: "error", error: "  gmail 429  " }),
    { ok: true, action: "complete", id: ID, status: "error", result: null, error: "gmail 429" },
  );
});

Deno.test("parseRequest bounds the error message", () => {
  const ok = "e".repeat(MAX_ERROR_LENGTH);
  assertEquals(parseRequest({ action: "complete", id: ID, status: "error", error: ok }).ok, true);
  assertEquals(
    parseRequest({ action: "complete", id: ID, status: "error", error: ok + "e" }),
    { ok: false, error: "error_message_too_long" },
  );
});

Deno.test("parseRequest discards any result attached to an error", () => {
  const parsed = parseRequest({
    action: "complete",
    id: ID,
    status: "error",
    error: "nope",
    result: { partial: true },
  });
  assertEquals(parsed, {
    ok: true,
    action: "complete",
    id: ID,
    status: "error",
    result: null,
    error: "nope",
  });
});

// MARK: - Result size

Deno.test("resultWithinLimit allows nothing and small payloads", () => {
  assertEquals(resultWithinLimit(null), { ok: true });
  assertEquals(resultWithinLimit(undefined), { ok: true });
  assertEquals(resultWithinLimit({ threads: [1, 2, 3] }), { ok: true });
  assertEquals(resultWithinLimit("a summary"), { ok: true });
});

Deno.test("resultWithinLimit pins the boundary exactly", () => {
  // `JSON.stringify("x".repeat(n))` is n + 2 (the quotes), so this lands on
  // exactly MAX_RESULT_CHARS and the next one on exactly one over.
  assertEquals(resultWithinLimit("x".repeat(MAX_RESULT_CHARS - 2)), { ok: true });
  assertEquals(resultWithinLimit("x".repeat(MAX_RESULT_CHARS - 1)), {
    ok: false,
    error: "result_too_large",
  });
});

Deno.test("resultWithinLimit rejects an oversized result", () => {
  const big = { blob: "x".repeat(MAX_RESULT_CHARS) };
  assertEquals(resultWithinLimit(big), { ok: false, error: "result_too_large" });
  assertEquals(
    parseRequest({ action: "complete", id: ID, status: "done", result: big }),
    { ok: false, error: "result_too_large" },
  );
});

Deno.test("resultWithinLimit rejects values JSON cannot express", () => {
  // A cycle would otherwise throw inside supabase-js's own serialisation, i.e.
  // an opaque 500 after the state machine had already been consulted.
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assertEquals(resultWithinLimit(cyclic), { ok: false, error: "unserialisable_result" });
  assertEquals(resultWithinLimit(() => {}), { ok: false, error: "unserialisable_result" });
});

// MARK: - The state machine

/** A row that passes every gate except the one under test. */
const row = (over: Record<string, unknown> = {}) => ({
  status: "claimed",
  user_id: OWNER,
  kind: "mail.triage",
  ...over,
});

const NOT_FOUND: CompletionDecision = {
  action: "reject",
  error: "unknown_request",
  status: 404,
};

Deno.test("only a claimed row may be completed", () => {
  assertEquals(decideCompletion(row(), OWNER, "done"), { action: "apply" });
  assertEquals(decideCompletion(row(), OWNER, "error"), { action: "apply" });
});

Deno.test("a queued row is refused, not completed", () => {
  // This is the double-send guard: completing a row nobody claimed races the
  // claim itself, and the claimer would then run a job already marked done.
  const notClaimed: CompletionDecision = {
    action: "reject",
    error: "not_claimed",
    status: 409,
  };
  assertEquals(decideCompletion(row({ status: "queued" }), OWNER, "done"), notClaimed);
  assertEquals(decideCompletion(row({ status: "queued" }), OWNER, "error"), notClaimed);
});

Deno.test("re-completing into the same terminal state is an idempotent no-op", () => {
  // n8n retries a step whose HTTP response was lost. A 409 there turns a
  // delivered result into a failed workflow — and the no-op must not rewrite the
  // row, so the first writer's result stands.
  assertEquals(decideCompletion(row({ status: "done" }), OWNER, "done"), {
    action: "noop",
    reason: "already_done",
  });
  assertEquals(decideCompletion(row({ status: "error" }), OWNER, "error"), {
    action: "noop",
    reason: "already_error",
  });
});

Deno.test("flipping between terminal states is a conflict", () => {
  // Two workers disagreeing about one job. Letting the late one win would hide it.
  const conflict: CompletionDecision = {
    action: "reject",
    error: "already_completed",
    status: 409,
  };
  assertEquals(decideCompletion(row({ status: "done" }), OWNER, "error"), conflict);
  assertEquals(decideCompletion(row({ status: "error" }), OWNER, "done"), conflict);
});

Deno.test("a missing row and another user's row answer identically", () => {
  // The service role bypasses RLS, so ownership is enforced here or nowhere —
  // and answering 404 for both is what stops a leaked key probing for ids.
  assertEquals(decideCompletion(null, OWNER, "done"), NOT_FOUND);
  assertEquals(decideCompletion(undefined, OWNER, "done"), NOT_FOUND);
  assertEquals(decideCompletion(row({ user_id: OTHER }), OWNER, "done"), NOT_FOUND);
  // Missing or non-string owner must never pass the check.
  assertEquals(decideCompletion({ status: "claimed", kind: "mail.sync" }, OWNER, "done"), NOT_FOUND);
  assertEquals(decideCompletion(row({ user_id: null }), OWNER, "done"), NOT_FOUND);
  assertEquals(decideCompletion(row({ user_id: 1 }), OWNER, "done"), NOT_FOUND);
});

Deno.test("the allow-list gates complete, not just claim", () => {
  // Checking `kind` only on the way out would leave this key able to mark ANY
  // row in n8n_requests done and write arbitrary JSON into its result — the
  // table is `n8n_requests`, not `mail_requests`, so assume it will one day hold
  // a queue for something more dangerous than reading mail.
  for (const kind of [undefined, null, "", "grid.exec", "mail.send", "MAIL.SYNC", 7]) {
    assertEquals(
      decideCompletion(row({ kind }), OWNER, "done"),
      NOT_FOUND,
      `should refuse kind ${JSON.stringify(kind)}`,
    );
  }
  // …and it is indistinguishable from a row that does not exist, so it is not a
  // probe oracle for which ids are real.
  assertEquals(decideCompletion(row({ kind: "grid.exec" }), OWNER, "done"), NOT_FOUND);
});

Deno.test("a blank or malformed owner refuses everything", () => {
  // A deploy with a blank N8N_OWNER_UID must not turn the check into a wildcard,
  // and must not accidentally match a row whose user_id is equally blank.
  for (const owner of ["", "   ", "default", "not-a-uuid"]) {
    assertEquals(decideCompletion(row(), owner, "done"), NOT_FOUND);
    assertEquals(decideCompletion(row({ user_id: owner }), owner, "done"), NOT_FOUND);
  }
});

Deno.test("an unrecognised status is refused rather than assumed completable", () => {
  for (const status of [undefined, null, "", "running", "DONE", 3, {}]) {
    assertEquals(
      decideCompletion(row({ status }), OWNER, "done"),
      { action: "reject", error: "invalid_state", status: 409 },
    );
  }
});

// MARK: - Response projection

Deno.test("toClaimedRequest projects a fixed shape", () => {
  assertEquals(
    toClaimedRequest({
      id: ID,
      user_id: OWNER,
      kind: "mail.triage",
      payload: { threadIds: ["a"] },
      status: "claimed",
      created_at: "2026-08-22T10:00:00Z",
      claimed_at: "2026-08-22T10:00:05Z",
      completed_at: null,
      error: null,
      result: { secret: "from a previous run" },
    }),
    {
      id: ID,
      kind: "mail.triage",
      payload: { threadIds: ["a"] },
      createdAt: "2026-08-22T10:00:00Z",
      claimedAt: "2026-08-22T10:00:05Z",
    },
  );
});

Deno.test("toClaimedRequest leaks no column the projection doesn't name", () => {
  const projected = toClaimedRequest({
    id: ID,
    kind: "mail.sync",
    payload: null,
    user_id: OWNER,
    result: "previous run output",
    error: "previous run error",
    internal_note: "should never ship",
  })!;
  assertEquals(Object.keys(projected).sort(), [
    "claimedAt",
    "createdAt",
    "id",
    "kind",
    "payload",
  ]);
});

Deno.test("toClaimedRequest handles an integer primary key", () => {
  assertEquals(toClaimedRequest({ id: 12, kind: "mail.sync", payload: { a: 1 } }), {
    id: 12,
    kind: "mail.sync",
    payload: { a: 1 },
    createdAt: null,
    claimedAt: null,
  });
});

Deno.test("toClaimedRequests counts every row it drops", () => {
  // A dropped row has ALREADY been flipped to `claimed` by the RPC. Swallowing
  // it would mean work taken out of the queue and delivered to nobody, showing
  // up as `count: 0` — indistinguishable from an empty queue.
  assertEquals(toClaimedRequests(null), { requests: [], dropped: 0 });
  assertEquals(toClaimedRequests(undefined), { requests: [], dropped: 0 });
  // A non-array IS a surprise: the RPC always returns an array on success.
  assertEquals(toClaimedRequests({}), { requests: [], dropped: 1 });

  assertEquals(
    toClaimedRequests([
      { id: ID, kind: "mail.sync", payload: null },
      { id: "nope", kind: "mail.sync" },
      { id: ID, kind: 7 },
      { id: ID, kind: "grid.exec" },
      null,
      "row",
      [],
    ]),
    {
      requests: [{ id: ID, kind: "mail.sync", payload: null, createdAt: null, claimedAt: null }],
      dropped: 6,
    },
  );
});
