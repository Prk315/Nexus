/**
 * Pure logic for `n8n-ingest`, split out of `index.ts` so it can be tested
 * without booting `Deno.serve`, reaching Supabase, or reading a clock. Nothing
 * in here does I/O, and nothing in here is non-deterministic. Same split as
 * `session-toggle` and `focus-evaluate`.
 *
 * Test files are not imported by `index.ts`, so they are never bundled into the
 * deployed function.
 *
 * # The trust boundary this file sits on
 *
 * Everything arriving here has passed through two untrusted stages: an email
 * written by an arbitrary stranger, and a local LLM that read that email. So
 * `subject`, `snippet`, `category` and `suggested_reply` are **data, never
 * instructions** — the same posture `socratic-judge` states for learner
 * answers. Concretely that means this file:
 *
 *   - never branches on their *content*, only on their shape;
 *   - bounds every string, so a model that decides to emit a megabyte of prose
 *     cannot bloat a row that the header renders on every page load;
 *   - strips control, bidi and zero-width characters, which are invisible in a
 *     diff and in a UI but let a crafted subject line rewrite what a terminal
 *     shows, or reverse how a filename reads.
 *
 * Escaping for display belongs to the renderer (React escapes by default); the
 * job here is to make sure what lands in the column is bounded, printable text.
 *
 * # The other half of the job: nothing may poison the batch
 *
 * The write in `index.ts` is one all-or-nothing statement, and n8n retries a
 * failed batch verbatim. So any single message that Postgres *refuses* does not
 * cost one row — it stalls the whole pipeline forever. Three things in here
 * exist only for that reason, and all three have tests: U+0000 is scrubbed out
 * of `raw` (jsonb cannot represent it at all), truncation never splits a
 * surrogate pair (a lone surrogate is rejected by the JSON parser), and
 * `external_id` is charset-constrained (PostgREST does not escape `"` inside an
 * `in.(...)` filter).
 */

// MARK: - Constants

/** Anything shorter is treated as unset — fail closed, never open. */
export const MIN_KEY_LEN = 32;

/** Reject a batch larger than this outright rather than time out mid-insert. */
export const MAX_ITEMS = 500;

/**
 * Priority is an integer 0–100, higher = more urgent, and the panel reads
 * `priority desc nulls first`. The range is pinned *here* rather than left to
 * the model: a triage list whose sort key can be any number the LLM felt like
 * emitting is not a priority list, it is whatever the loudest hallucination
 * was. A value that is present but outside the range clamps to the nearest end.
 *
 * **An absent or unparseable score is NULL, never a number.** NULL means
 * "triage has not produced a verdict for this row" — which is a different fact
 * from "triage ran and scored it medium", and the schema exists to keep them
 * apart. This is the same invariant as `blocking_state`: a missing verdict must
 * never be indistinguishable from a computed one, because the fallback has to
 * be visibly wrong rather than plausibly right. A 50 default would park a
 * message the model failed on in the middle of the list looking scored, and
 * nothing downstream could ever tell. `nulls first` instead surfaces it at the
 * top, where a human notices.
 */
export const PRIORITY_MIN = 0;
export const PRIORITY_MAX = 100;

/**
 * Triage state, owned by the *user*, never by the ingester. It is only ever
 * stamped on a row being created for the first time — see `mergeStatus`.
 */
export const DEFAULT_STATUS = "unread";

/**
 * `external_id` is charset-constrained rather than merely length-bounded, and
 * that is a correctness requirement, not tidiness.
 *
 * It is interpolated into a PostgREST `external_id=in.("a","b")` filter, which
 * lives in the **query string**. `postgrest-js` quotes a value containing `,`
 * `(` or `)` but does **not** escape an embedded `"` or backslash — so an id
 * like `a","b` produces a malformed filter, PostgREST answers 400, and (since
 * n8n retries the identical batch) the pipeline stalls permanently. Gmail
 * message ids are hex; this set is generous enough for any provider id worth
 * storing and contains none of the dangerous bytes.
 *
 * 128 chars also keeps the chunked lookup URL small (see `LOOKUP_CHUNK`).
 * Note this **rejects** rather than truncates: two distinct ids sharing a
 * 128-char prefix would otherwise collapse into one row and silently lose a
 * message.
 */
export const MAX_EXTERNAL_ID = 128;
export const EXTERNAL_ID_RE = /^[A-Za-z0-9._:@+=-]+$/;

export const MAX_SENDER = 512;
/** RFC 5322 caps a header line at 998 octets. */
export const MAX_SUBJECT = 1000;
export const MAX_SNIPPET = 2000;
export const MAX_CATEGORY = 64;
export const MAX_SUGGESTED_REPLY = 8000;
/** e.g. `qwen2.5:14b-instruct` — a model tag, not a description. */
export const MAX_TRIAGE_MODEL = 128;

/**
 * `raw` exists for debugging a bad triage, not as a mail archive.
 *
 * Deliberately small: the batch cap is on item *count*, so `MAX_ITEMS` times
 * this is the floor under the request body a full sync produces. At 32 000 that
 * was a 16 MB upsert, which is another way for one fat batch to stall the
 * pipeline permanently.
 */
export const MAX_RAW_CHARS = 4000;

/** Sanity window for `received_at`. Outside it the timestamp is not a date. */
const MIN_YEAR = 1990;
const MAX_YEAR = 2100;

// MARK: - Secret handling

/**
 * Length-independent comparison so a wrong key can't be recovered by timing.
 * (Length itself still leaks — same as `habit-toggle`/`session-toggle`; it is
 * not the secret.)
 */
export function secretMatches(candidate: string, expected: string): boolean {
  const enc = new TextEncoder();
  const a = enc.encode(candidate);
  const b = enc.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Is the configured secret usable? An unset or stubby env var must never mean
 * "allow everyone" — an empty string compiles and deploys perfectly cleanly and
 * would turn `x-n8n-key: ""` into a valid credential.
 */
export function secretIsUsable(expected: string | undefined | null): boolean {
  return typeof expected === "string" && expected.length >= MIN_KEY_LEN;
}

// MARK: - Field normalisation

/**
 * Characters that must never reach a column, in three families.
 *
 * **Control (C0/C1).** Invisible in a UI and in a diff, but a lone CR rewrites
 * a terminal line and ESC starts an ANSI sequence — and a subject line is
 * attacker-chosen text that ends up in logs.
 *
 * **Bidi overrides** (U+202A–U+202E, U+2066–U+2069). The classic
 * `Invoice<RLO>gpj.exe` trick: text renders right-to-left from that point on,
 * so a subject or a sender can be made to read as something it is not.
 *
 * **Zero-width and line/paragraph separators** (U+200B–U+200F, U+2028, U+2029,
 * U+2060–U+2064, U+FEFF). Invisible, so two categories or two senders can be
 * made to look identical while comparing unequal.
 *
 * Multiline fields keep LF and TAB (a suggested reply has real paragraphs);
 * single-line fields fold everything to a space, so a crafted "subject" cannot
 * fake extra rows in a plain-text render.
 */
const INVISIBLE =
  "\\u200B-\\u200F\\u2028\\u2029\\u202A-\\u202E\\u2060-\\u2064\\u2066-\\u2069\\uFEFF";
const CONTROL_KEEP_NEWLINES = new RegExp(
  `[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F${INVISIBLE}]`,
  "g",
);
const CONTROL_ALL = new RegExp(
  `[\\u0000-\\u001F\\u007F-\\u009F${INVISIBLE}]`,
  "g",
);

/** U+0000 in a string *value*, which `jsonb` cannot represent at all. */
const NUL = /\u0000/g;

/**
 * Truncate to `max` UTF-16 units without splitting a surrogate pair.
 *
 * A plain `slice` through an emoji leaves a lone high surrogate, which renders
 * as U+FFFD in a text column and — worse — is rejected outright by Postgres's
 * JSON parser when it lands in `raw`. Since the write is one all-or-nothing
 * statement, that turns one badly-placed emoji into a permanently stalled
 * pipeline.
 */
export function truncateSafe(s: string, max: number): string {
  if (s.length <= max) return s;
  const code = s.charCodeAt(max - 1);
  // A high surrogate at the boundary lost its partner; drop it rather than
  // emit an unpaired one.
  return code >= 0xd800 && code <= 0xdbff ? s.slice(0, max - 1) : s.slice(0, max);
}

/**
 * Trim, strip invisible characters, and truncate to `max` characters.
 *
 * Returns `null` for anything that is not a string or is empty once cleaned, so
 * a caller sending `""`, `"   "` or `123` stores a NULL rather than a blank
 * that every consumer then has to special-case.
 *
 * Truncation is silent and by design: rejecting an over-long subject would drop
 * a real message on the floor because a model was verbose.
 */
export function sanitizeText(
  value: unknown,
  max: number,
  opts: { multiline?: boolean } = {},
): string | null {
  if (typeof value !== "string") return null;

  let cleaned: string;
  if (opts.multiline) {
    // CRLF and a bare CR both fold to LF *before* the strip, so a Windows-style
    // draft keeps its paragraphs instead of losing them to the CR removal.
    cleaned = value.replace(/\r\n?/g, "\n").replace(CONTROL_KEEP_NEWLINES, "").trim();
  } else {
    // Collapse the runs the substitution creates, so stripping "a\r\n\tb" gives
    // "a b" rather than "a   b".
    cleaned = value.replace(CONTROL_ALL, " ").replace(/\s+/g, " ").trim();
  }

  if (cleaned.length === 0) return null;
  return truncateSafe(cleaned, max);
}

/**
 * The first candidate that yields usable text, or `null`.
 *
 * Deliberately not `a ?? b`: n8n emits `""` — not `undefined` — for an
 * expression that resolved to nothing, so `??` would stop at the empty string
 * and never reach the fallback spelling it was written to survive. That failure
 * is silent (the message is simply rejected) and would look exactly like an
 * upstream outage.
 */
function firstText(
  candidates: unknown[],
  max: number,
  opts: { multiline?: boolean } = {},
): string | null {
  for (const c of candidates) {
    const t = sanitizeText(c, max, opts);
    if (t !== null) return t;
  }
  return null;
}

/**
 * A provider id that is *metadata* rather than identity.
 *
 * Same charset and length rules as `external_id`, and for the same reason — it
 * rides in the same all-or-nothing statement, so anything Postgres might refuse
 * has to be caught before it can stall a whole batch.
 *
 * The difference is the failure mode: a value that fails the rules yields
 * `null` instead of rejecting the message. `thread_id` is not what identifies a
 * row, and dropping an entire triaged email because its thread id looked odd
 * would be a far worse trade than losing the threading hint. Bounded generously
 * before the length test for the same reason `normalizeItem` does it — checking
 * a truncated value would let an over-long id pass as its own prefix.
 */
function optionalId(candidates: unknown[]): string | null {
  const id = firstText(candidates, 4096);
  if (id === null) return null;
  return id.length <= MAX_EXTERNAL_ID && EXTERNAL_ID_RE.test(id) ? id : null;
}

/**
 * A score in `[PRIORITY_MIN, PRIORITY_MAX]`, or `null` if the payload does not
 * contain one.
 *
 * Accepts a numeric string because LLM JSON routinely quotes numbers. A number
 * outside the range clamps — the model did produce a verdict, it just spelled
 * it badly.
 *
 * Everything else is `null`, **not** a default: `NaN`, `Infinity`, `"urgent!"`,
 * booleans, objects and an absent field all mean triage produced no usable
 * score, and inventing a midpoint for them would erase exactly the distinction
 * the nullable column exists to preserve. `null` is also what the caller keys
 * `triaged_at` off, so a row that was never scored carries no triage timestamp
 * either — the two can never disagree.
 */
export function clampPriority(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    n = Number(value);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  return Math.min(PRIORITY_MAX, Math.max(PRIORITY_MIN, Math.round(n)));
}

/** Epoch seconds and epoch milliseconds are 1000x apart; disambiguate by magnitude. */
function epochToMs(n: number): number {
  if (!Number.isFinite(n)) return NaN;
  // 1e11 ms is 1973; 1e11 s is the year 5138. Anything below the threshold is
  // therefore seconds, anything above is milliseconds.
  return Math.abs(n) < 1e11 ? n * 1000 : n;
}

/** Ends with `Z` or a `+HH:MM` / `-HHMM` offset, i.e. already names an instant. */
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
/** An ISO-ish date *and* time, as opposed to a bare `2026-08-21`. */
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Coerce a timestamp into RFC3339 UTC, or `null` if it names no real instant.
 *
 * Three spellings are live: an RFC3339/ISO string (what an LLM emits), and
 * Gmail's `internalDate`, which is **epoch milliseconds as a string**. Ten
 * digits is read as seconds and thirteen as milliseconds — the two are 1000x
 * apart, so guessing wrong puts the message in 1970 or in the year 55000, and
 * either one silently wrecks a date-sorted list.
 *
 * **An offset-less date-time is read as UTC, explicitly.** `Date.parse` reads
 * that form in the *runtime's* zone per ES2016+, which is a bug waiting for the
 * day this function runs anywhere but a UTC edge worker — and LLMs drop the `Z`
 * constantly. `session-toggle/logic.ts` appends the `Z` for exactly this reason;
 * unlike there, no known writer here means a local wall clock, so UTC is the
 * honest reading rather than a guess.
 *
 * A bare date (`2026-08-21`) is UTC midnight, which is what `Date.parse` already
 * does for that form.
 */
export function coerceTimestamp(value: unknown): string | null {
  let ms: number;

  if (typeof value === "number") {
    ms = epochToMs(value);
  } else if (typeof value === "string") {
    const s = value.trim();
    if (s.length === 0) return null;
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      if (!Number.isFinite(n)) return null;
      ms = epochToMs(n);
    } else if (ISO_DATE_TIME.test(s) && !HAS_OFFSET.test(s)) {
      ms = Date.parse(`${s.replace(" ", "T")}Z`);
    } else {
      ms = Date.parse(s);
    }
  } else {
    return null;
  }

  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  // A date outside this window is not a clock error, it is a unit error — the
  // seconds/milliseconds mix-up above, or a zeroed field. Storing it would sort
  // the message to one extreme of the list forever.
  if (year < MIN_YEAR || year > MAX_YEAR) return null;
  return d.toISOString();
}

/** The first candidate that names a real instant, or `null`. See `firstText`. */
function firstTimestamp(candidates: unknown[]): string | null {
  for (const c of candidates) {
    const t = coerceTimestamp(c);
    if (t !== null) return t;
  }
  return null;
}

// MARK: - `raw`

const UNSERIALIZABLE = { truncated: true, reason: "unserializable" };

/**
 * The original payload item, kept for debugging a bad triage.
 *
 * Three properties, in order of how badly getting them wrong hurts:
 *
 * 1. **No U+0000.** Postgres `jsonb` cannot represent it *at all* —
 *    `select '"\\u0000"'::jsonb` is a hard error, not a coercion. One NUL byte
 *    anywhere in one message would therefore fail the whole batch, and n8n
 *    would retry that identical batch forever. The text columns already strip
 *    it; this is the same guarantee for the blob they came from.
 * 2. **Bounded**, and truncated on a code-point boundary — a lone surrogate is
 *    rejected by the JSON parser the same way.
 * 3. **Never throws.** Losing the debug blob is trivially less bad than losing
 *    the message, so anything unserialisable degrades to a marker.
 */
export function boundRaw(item: unknown): unknown {
  let text: string | undefined;
  try {
    // The replacer scrubs NULs out of string *values* without disturbing
    // anything else — no re-encoding, no key rewriting.
    text = JSON.stringify(item, (_k, v) => typeof v === "string" ? v.replace(NUL, "") : v);
  } catch {
    return UNSERIALIZABLE;
  }
  if (typeof text !== "string") return UNSERIALIZABLE;

  // Belt and braces for the one case the replacer cannot reach: a NUL in an
  // object *key*. Only accepted if the result still parses — a value that
  // legitimately contains those six literal characters would be corrupted
  // otherwise, and a corrupted blob is worse than one we can detect.
  if (text.includes("\\u0000")) {
    const netted = text.replace(/\\u0000/g, "");
    try {
      JSON.parse(netted);
      text = netted;
    } catch {
      return UNSERIALIZABLE;
    }
  }

  if (text.length <= MAX_RAW_CHARS) {
    try {
      return JSON.parse(text);
    } catch {
      return UNSERIALIZABLE;
    }
  }
  return { truncated: true, chars: text.length, preview: truncateSafe(text, MAX_RAW_CHARS) };
}

// MARK: - Item normalisation

/**
 * One `mail_messages` row, minus the two columns the *server* owns.
 *
 * `user_id` is deliberately absent: this function accepts no user id, no table
 * name and no filter from the caller, so a leaked key cannot be turned into a
 * read primitive or a way to file mail under someone else's account. `status`
 * is absent for a different reason — it is user triage state and an ingest must
 * never reset it. Both are stamped by `mergeStatus`.
 */
export interface MailRow {
  external_id: string;
  /**
   * Gmail's conversation id. Plain optional metadata — deliberately **not**
   * part of the triage triple below, so a message can have a thread and no
   * score. Coupling it to `priority` would mean an untriaged reply lost its
   * place in the conversation for no reason.
   */
  thread_id: string | null;
  /**
   * NOT NULL in the table, so it is a rejection reason rather than a
   * degradation — see `normalizeItem`.
   */
  sender: string;
  subject: string | null;
  snippet: string | null;
  received_at: string;
  /** `null` = triage produced no verdict for this row. Never a default. */
  priority: number | null;
  category: string | null;
  suggested_reply: string | null;
  /** When triage scored it. `null` exactly when `priority` is null. */
  triaged_at: string | null;
  /** Which model scored it. `null` exactly when `priority` is null. */
  triage_model: string | null;
  raw: unknown;
}

export type NormalizeResult =
  | { ok: true; row: MailRow }
  | { ok: false; error: string };

/**
 * Validate and normalise one incoming message.
 *
 * Only two fields are load-bearing enough to reject on: `external_id`, without
 * which the upsert has no identity and every sync would insert duplicates; and
 * `received_at`, without which the message cannot be placed in a time-sorted
 * list. Everything else degrades to `null` or a default, because a triaged
 * message with a missing subject is still worth showing.
 *
 * Both snake_case and camelCase spellings are accepted for the compound names,
 * as are Gmail's own (`id`, `from`, `internalDate`). n8n expression output is
 * camelCase by habit and the DB is snake_case; a silent `null` there would be a
 * triage list with no suggested replies and no error anywhere to explain it.
 *
 * `ingestedAt` is passed in rather than read from a clock, so this stays pure
 * and so every row in one batch shares one timestamp. It is only used as the
 * fallback `triaged_at` for a row the payload scored but did not date.
 */
export function normalizeItem(item: unknown, ingestedAt: string): NormalizeResult {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    return { ok: false, error: "not_an_object" };
  }
  const o = item as Record<string, unknown>;

  // Bounded generously here so the length check below sees the *whole* id:
  // truncating first and then testing would make an over-long id pass as its
  // own prefix, which is the collapse EXTERNAL_ID_RE's doc comment warns about.
  const externalId = firstText([o.external_id, o.externalId, o.id], 4096);
  if (!externalId) return { ok: false, error: "missing_external_id" };
  // Rejected, not truncated and not escaped — see EXTERNAL_ID_RE.
  if (externalId.length > MAX_EXTERNAL_ID || !EXTERNAL_ID_RE.test(externalId)) {
    return { ok: false, error: "invalid_external_id" };
  }

  const receivedAt = firstTimestamp([o.received_at, o.receivedAt, o.internalDate]);
  if (!receivedAt) return { ok: false, error: "invalid_received_at" };

  // `mail_messages.sender` is NOT NULL, so this cannot degrade to null the way
  // `subject` does — a null would be a 23502 that fails the *whole* all-or-
  // nothing batch, turning one nameless message into a permanently stalled
  // pipeline. Rejecting the one message costs one message.
  //
  // The workflow already drops these upstream ("a message we cannot name is not
  // something to invent values for"), so this should never fire in practice.
  // That is exactly why it is here: the two sides agreeing by accident is not
  // the same as the constraint being enforced.
  const sender = firstText([o.sender, o.from], MAX_SENDER);
  if (!sender) return { ok: false, error: "missing_sender" };

  // The three triage columns move as one. `priority === null` is the single
  // signal for "no verdict", and `triaged_at` / `triage_model` are derived from
  // it rather than read independently — otherwise a payload could produce a row
  // that is unscored but carries a fresh `triaged_at`, which is precisely the
  // "looks computed, isn't" state the nullable column exists to prevent.
  const priority = clampPriority(o.priority);
  const triaged = priority !== null;

  return {
    ok: true,
    row: {
      external_id: externalId,
      thread_id: optionalId([o.thread_id, o.threadId]),
      sender,
      subject: sanitizeText(o.subject, MAX_SUBJECT),
      snippet: sanitizeText(o.snippet, MAX_SNIPPET, { multiline: true }),
      received_at: receivedAt,
      priority,
      category: sanitizeText(o.category, MAX_CATEGORY),
      suggested_reply: firstText(
        [o.suggested_reply, o.suggestedReply],
        MAX_SUGGESTED_REPLY,
        { multiline: true },
      ),
      // Prefer the moment the model actually ran, which n8n knows; fall back to
      // this ingest so a scored row is never left with a null triage timestamp.
      triaged_at: triaged
        ? (firstTimestamp([o.triaged_at, o.triagedAt]) ?? ingestedAt)
        : null,
      triage_model: triaged
        ? firstText([o.triage_model, o.triageModel, o.model], MAX_TRIAGE_MODEL)
        : null,
      raw: boundRaw(item),
    },
  };
}

/**
 * Collapse repeats of the same `external_id`, last occurrence winning.
 *
 * This is not tidiness. Postgres refuses an `ON CONFLICT DO UPDATE` that would
 * touch the same row twice in one statement ("cannot affect row a second time",
 * 21000), so a single duplicated id fails the **entire batch** — every other
 * message in that sync is lost with it. n8n retries and paginates, so duplicates
 * inside one payload are ordinary, not exotic.
 *
 * Last wins because a later item in the batch is the fresher triage.
 */
export function dedupeByExternalId(rows: MailRow[]): MailRow[] {
  const byId = new Map<string, MailRow>();
  for (const row of rows) byId.set(row.external_id, row);
  return [...byId.values()];
}

// MARK: - Payload parsing

export type ParsedPayload =
  | { ok: true; rows: MailRow[]; rejected: number; rejectedReasons: Record<string, number> }
  | { ok: false; error: string; status: number };

/**
 * Validate the whole request body.
 *
 * The batch cap is checked against the *raw* array length, before any
 * normalisation, so an oversized payload is refused rather than partially
 * processed. Individual bad items are counted and skipped instead of failing
 * the batch: one malformed message must not cost the other 499.
 *
 * `rejectedReasons` is a per-reason tally rather than a bare count so that a
 * broken field mapping is diagnosable from the response alone. "500 messages
 * had no received_at" and "500 messages weren't objects" are different bugs and
 * a single number cannot tell them apart.
 *
 * `ingestedAt` is sampled once by the caller and threaded through, so the whole
 * batch shares one timestamp and this function stays clock-free and testable.
 */
export function parsePayload(body: unknown, ingestedAt: string): ParsedPayload {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "invalid_body", status: 400 };
  }
  const { messages } = body as Record<string, unknown>;
  if (!Array.isArray(messages)) {
    return { ok: false, error: "missing_messages", status: 400 };
  }
  if (messages.length > MAX_ITEMS) {
    return { ok: false, error: "batch_too_large", status: 413 };
  }

  const rows: MailRow[] = [];
  const rejectedReasons: Record<string, number> = {};
  let rejected = 0;
  for (const item of messages) {
    const parsed = normalizeItem(item, ingestedAt);
    if (!parsed.ok) {
      rejected++;
      rejectedReasons[parsed.error] = (rejectedReasons[parsed.error] ?? 0) + 1;
      continue;
    }
    rows.push(parsed.row);
  }

  return { ok: true, rows: dedupeByExternalId(rows), rejected, rejectedReasons };
}

// MARK: - Status preservation

/** The shape `index.ts` selects for the owner-scoped existence check. */
export interface ExistingRow {
  external_id?: unknown;
  status?: unknown;
}

export interface MergedPayload {
  /** Ready to upsert: every row carries the server-side `user_id` and a status. */
  rows: Array<MailRow & { user_id: string; status: string }>;
  /** How many of them did not previously exist for this owner. */
  inserted: number;
}

/**
 * Stamp the owner and carry existing triage state forward.
 *
 * **`status` is the user's column, not the ingester's.** It is the one field
 * that records a human decision — read, archived, replied — and n8n re-sends
 * the same message on every poll. A blind upsert would reset an archived
 * message to `unread` on the next pass, i.e. the triage list would resurrect
 * everything the user had just cleared. So an existing status wins, and only a
 * genuinely new row gets `DEFAULT_STATUS`.
 *
 * A row that exists with a NULL or blank status counts as *known* (or the
 * `inserted` tally would call it new on every single sync) but takes the
 * default, which is what "no decision recorded" means.
 *
 * `userId` is a parameter rather than a constant so this stays pure and
 * testable; `index.ts` passes its module-level `OWNER_UID` and nothing else can.
 */
export function mergeStatus(
  rows: MailRow[],
  existing: ExistingRow[],
  userId: string,
): MergedPayload {
  const statusById = new Map<string, string>();
  const known = new Set<string>();
  for (const row of existing) {
    if (typeof row.external_id !== "string") continue;
    known.add(row.external_id);
    if (typeof row.status === "string" && row.status.length > 0) {
      statusById.set(row.external_id, row.status);
    }
  }

  return {
    rows: rows.map((row) => ({
      ...row,
      user_id: userId,
      status: statusById.get(row.external_id) ?? DEFAULT_STATUS,
    })),
    inserted: rows.reduce((n, row) => n + (known.has(row.external_id) ? 0 : 1), 0),
  };
}

// MARK: - The sync marker

/**
 * The one `n8n_requests.kind` this function will ever write.
 *
 * A constant, **never** the caller's `run.kind`. Same closed-allow-list posture
 * as `n8n-requests`'s `ALLOWED_KINDS`: the caller names no table, no filter and
 * no user, and it does not get to name the queue either. Otherwise a leaked key
 * plus a guessed kind would be a way to forge completion markers for queues
 * that have nothing to do with mail — including ones a future feature adds for
 * something more consequential than reading email.
 *
 * WARNING — spelling divergence, flagged rather than resolved. Unit 1's
 * migration comment, unit 4's panel and unit 5's workflow all use `mail_sync`;
 * `n8n-requests`'s allow-list spells the same concept `mail.sync`.
 * `n8n_requests.kind` is free text with no CHECK, so nothing in the database
 * catches it. This unit follows the three that agree, because the *freshness
 * read* is what breaks otherwise. The cost is that a queued `mail.sync` row
 * will not be closed out by the lookup in `index.ts`.
 */
export const MAIL_SYNC_KIND = "mail_sync";

/** `run.source` is a workflow name, e.g. `n8n:mail-triage`. */
export const MAX_RUN_SOURCE = 128;

/** The fixed shape written to `n8n_requests.payload`. */
export interface RunPayload {
  source: string | null;
  fetched: number | null;
  triaged: number | null;
  untriaged: number | null;
}

export interface RunMarker {
  kind: typeof MAIL_SYNC_KIND;
  finished_at: string;
  payload: RunPayload;
}

export type ParsedRun =
  | { ok: true; marker: RunMarker }
  | { ok: false; reason: "absent" | "not_an_object" | "unsupported_kind" };

/** A non-negative integer count, or `null` — never `NaN`, never a guess. */
function countOrNull(value: unknown): number | null {
  const n = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
    ? Number(value)
    : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/**
 * Turn the POST's `run` object into the `n8n_requests` row that records this
 * pass, or say why there is none.
 *
 * # Why this exists at all
 *
 * n8n cannot write `n8n_requests` itself — the table has no anon policy and n8n
 * holds no session — so the workflow ships a summary alongside the messages and
 * this function records it server-side. That row is load-bearing: the newest
 * `kind = 'mail_sync'`, `status = 'done'` row carries the authoritative "last
 * synced" timestamp, because a `mail_messages` row count cannot distinguish
 * "n8n has never run" from "the inbox is clean", and a panel rendering both as
 * "inbox zero" is wrong half the time. Ignoring `run` would deliver mail
 * correctly while the header reported *never synced*, forever.
 *
 * # What it deliberately does not take from the caller
 *
 * `kind` is the constant above, and `status` is set by `index.ts` — a caller
 * cannot mark a run `error`, or `done` on a queue it named itself. `payload` is
 * a **fixed shape**: unrecognised keys are dropped rather than passed through
 * into jsonb, so the marker cannot become an arbitrary caller-controlled blob.
 * Widening it is a deliberate edit here.
 *
 * An absent `run` is `{ ok: false, reason: "absent" }`, not an error: an older
 * workflow that predates the marker must still be able to deliver mail.
 */
export function parseRun(run: unknown, ingestedAt: string): ParsedRun {
  if (run === undefined || run === null) return { ok: false, reason: "absent" };
  if (typeof run !== "object" || Array.isArray(run)) {
    return { ok: false, reason: "not_an_object" };
  }
  const o = run as Record<string, unknown>;

  // A `kind` naming anything else is not a mail sync, so recording it as one
  // would be a lie. Absent is fine — this endpoint only ever ingests mail.
  const kind = sanitizeText(o.kind, MAX_CATEGORY);
  if (kind !== null && kind !== MAIL_SYNC_KIND) {
    return { ok: false, reason: "unsupported_kind" };
  }

  return {
    ok: true,
    marker: {
      kind: MAIL_SYNC_KIND,
      // The moment the workflow says it finished, falling back to this ingest.
      // A marker with no timestamp would be worse than none: `finished_at desc`
      // is how the freshness read picks the newest row, and NULL sorts first
      // under `desc`, so it would shadow every real one.
      finished_at: coerceTimestamp(o.finished_at) ?? ingestedAt,
      payload: {
        source: sanitizeText(o.source, MAX_RUN_SOURCE),
        fetched: countOrNull(o.fetched),
        triaged: countOrNull(o.triaged),
        untriaged: countOrNull(o.untriaged),
      },
    },
  };
}

/** Split `items` into fixed-size chunks. See `LOOKUP_CHUNK` in `index.ts`. */
export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new RangeError("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
