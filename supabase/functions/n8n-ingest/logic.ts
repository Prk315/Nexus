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
 * `score` is an integer 0–100, higher = more urgent, and the panel reads
 * `score desc nulls first`. The range is pinned *here* rather than left to
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
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

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
 * A score in `[SCORE_MIN, SCORE_MAX]`, or `null` if the payload does not
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
export function clampScore(value: unknown): number | null {
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    n = Number(value);
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(n)));
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

// MARK: - The two axes, and the task-shaped fields

/**
 * `importance` and `urgency` share PathFinder's domain exactly.
 *
 * That is the whole point of the alignment: `pf_tasks.priority` and
 * `pf_task_planning.urgency` use these three values and nothing else, so a mail
 * converts into a draft task without a translation table in between — and a
 * translation table is precisely where two vocabularies silently drift apart.
 */
export const AXIS_VALUES = ["high", "medium", "low"] as const;
export type Axis = (typeof AXIS_VALUES)[number];

/**
 * One of the three axis values, or `null`.
 *
 * A closed set, matched case-insensitively after trimming, because "High" and
 * "HIGH" are the same verdict spelled by a model that does not care. Anything
 * outside it — "urgent", "critical", "p1", a number — is `null` rather than a
 * nearest-neighbour guess: mapping "critical" onto "high" invents a verdict the
 * model did not give, and the whole nullable design exists to keep "no verdict"
 * distinguishable from a real one.
 */
export function parseAxis(value: unknown): Axis | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return (AXIS_VALUES as readonly string[]).includes(v) ? (v as Axis) : null;
}

/**
 * The largest `time_estimate` worth believing, in minutes. A week of solid work
 * is already absurd for a reply to an email; past that it is a malformed
 * verdict (a model emitting seconds, or milliseconds, or a hallucinated
 * constant) rather than an estimate.
 */
export const MAX_TIME_ESTIMATE = 60 * 24 * 7;

/**
 * A positive, bounded whole number of minutes, or `null`.
 *
 * Deliberately **not** clamped at the ends. Clamping 999999 to 10080 would
 * store a confident "one week" that nothing produced, and a value that far out
 * is not an estimate that overshot — it is a unit error or a hallucination, and
 * the honest record of it is the same `null` an absent field gets. Zero is also
 * null: "this takes no time" is not an estimate anyone means.
 */
export function parseMinutes(value: unknown): number | null {
  const n = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim().length > 0
    ? Number(value)
    : NaN;
  if (!Number.isFinite(n)) return null;
  const m = Math.round(n);
  return m > 0 && m <= MAX_TIME_ESTIMATE ? m : null;
}

/**
 * A due date as `YYYY-MM-DD`, or `null`.
 *
 * **Why a calendar date and not a timestamp.** A deadline the model read out of
 * "can you get this to me by Friday" is a *day*, not an instant. Storing an
 * instant would mean inventing a time of day, and then rendering it in the
 * viewer's zone can move it to Thursday or Saturday — the classic off-by-one
 * that makes a deadline column untrustworthy. The column is `date`-shaped on
 * unit 1's side and this form is also unambiguous if it is `timestamptz`
 * (it reads as UTC midnight), so the same value is correct either way.
 *
 * It routes through `coerceTimestamp` first, which is what applies the
 * offset-less-is-UTC rule. Without that, `"2026-08-25T09:00:00"` would be read
 * in the *runtime's* zone and could land on the 24th — the exact bug caught in
 * the timestamp path earlier, and it is worth restating that `Date.parse` does
 * this silently and only on some hosts.
 */
export function parseDueDate(value: unknown): string | null {
  const instant = coerceTimestamp(value);
  if (instant === null) return null;
  return instant.slice(0, 10);
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

  // --- the triage triple: these three move together, always ---------------
  /**
   * The model's 0-100 evidence, renamed from `priority`. `null` = triage
   * produced no verdict for this row. Never a default.
   *
   * The number is the model's *evidence*; `importance`/`urgency` below are the
   * verdict, and they are deliberately not part of this triple.
   */
  score: number | null;
  /** When triage scored it. `null` exactly when `score` is null. */
  triaged_at: string | null;
  /** Which model scored it. `null` exactly when `score` is null. */
  triage_model: string | null;

  // --- the two axes, independent of the triple ----------------------------
  /**
   * `high` | `medium` | `low`, or null. **Not** part of the triage triple: a
   * rule can set these without the model ever having run, so they are
   * independently nullable. Same domain as PathFinder's `Priority`/`Urgency`,
   * which is what makes a mail convertible into a draft task.
   */
  importance: Axis | null;
  urgency: Axis | null;
  /**
   * Which `mail_rules` row last set the axes, so "why is this high urgency?"
   * is answerable. `null` when the axes came from the model, or are unset.
   */
  rule_id: string | null;

  // --- task-shaped fields, for the convert-to-task flow --------------------
  /** `YYYY-MM-DD`. See `parseDueDate` for why it is a calendar date. */
  due_date: string | null;
  /** Minutes. Positive and bounded, else null — never a clamped guess. */
  time_estimate: number | null;

  category: string | null;
  suggested_reply: string | null;
  raw: unknown;

  // NOTE: `task_id` is deliberately absent. It is set by the panel's
  // convert-to-task flow and by nothing else; an ingest that wrote it would
  // silently re-point or clear a link the user made.
}

export type NormalizeResult =
  /**
   * `ruleSubject` travels beside the row rather than on it: `list_id` is
   * matchable but is **not** a `mail_messages` column, and an extra key on the
   * row object would reach the upsert as an unknown column and fail the batch.
   * Deriving it from `raw` instead would be worse — `raw` is truncated above
   * `MAX_RAW_CHARS`, so list rules would silently stop matching on long
   * messages only.
   */
  | { ok: true; row: MailRow; ruleSubject: RuleSubject }
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
  const score = clampScore(o.score ?? o.priority);
  const triaged = score !== null;

  return {
    ok: true,
    ruleSubject: {
      sender,
      subject: sanitizeText(o.subject, MAX_SUBJECT),
      list_id: firstText([o.list_id, o.listId], MAX_RULE_VALUE),
    },
    row: {
      external_id: externalId,
      thread_id: optionalId([o.thread_id, o.threadId]),
      sender,
      subject: sanitizeText(o.subject, MAX_SUBJECT),
      snippet: sanitizeText(o.snippet, MAX_SNIPPET, { multiline: true }),
      received_at: receivedAt,
      score,
      // Prefer the moment the model actually ran, which n8n knows; fall back to
      // this ingest so a scored row is never left with a null triage timestamp.
      triaged_at: triaged
        ? (firstTimestamp([o.triaged_at, o.triagedAt]) ?? ingestedAt)
        : null,
      triage_model: triaged
        ? firstText([o.triage_model, o.triageModel, o.model], MAX_TRIAGE_MODEL)
        : null,
      // Read independently of the triple: the model may return an axis without
      // a usable score, and a rule may set one with no model run at all.
      importance: parseAxis(o.importance),
      urgency: parseAxis(o.urgency),
      // Provenance belongs to whatever *sets* the axes. Nothing in the payload
      // may claim it — a rule id is assigned by `applyRules`, server-side.
      rule_id: null,
      due_date: parseDueDate(o.due_date ?? o.dueDate),
      time_estimate: parseMinutes(o.time_estimate ?? o.timeEstimate),
      category: sanitizeText(o.category, MAX_CATEGORY),
      suggested_reply: firstText(
        [o.suggested_reply, o.suggestedReply],
        MAX_SUGGESTED_REPLY,
        { multiline: true },
      ),
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
  | {
    ok: true;
    rows: MailRow[];
    /** Keyed by `external_id`, which is unique after deduplication. */
    ruleSubjects: Map<string, RuleSubject>;
    rejected: number;
    rejectedReasons: Record<string, number>;
  }
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
  const ruleSubjects = new Map<string, RuleSubject>();
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
    // Last write wins, matching `dedupeByExternalId` — so the subject kept here
    // is the one belonging to the row that survives deduplication.
    ruleSubjects.set(parsed.row.external_id, parsed.ruleSubject);
  }

  return { ok: true, rows: dedupeByExternalId(rows), ruleSubjects, rejected, rejectedReasons };
}

// MARK: - Inbox rules

/**
 * The four match fields, in the order the table declares them.
 *
 * Within one rule they are **ANDed**: every non-null field must match, and a
 * null field does not constrain. So a single rule can say "from @bank.dk *and*
 * subject contains invoice" without needing two rules and a cross product.
 */
export const MATCH_FIELDS = [
  "match_sender",
  "match_domain",
  "match_subject",
  "match_list_id",
] as const;

/**
 * The statuses a rule may set. A strict subset of `mail_messages.status`.
 *
 * `replied` is excluded at the database and again here: a rule may pre-read or
 * auto-archive, but nothing automated gets to claim you replied to something.
 * `unread` is excluded too — it is the default, so a rule setting it would only
 * ever be a way to undo another rule.
 */
export const RULE_STATUSES = ["read", "archived"] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

/** Longest match value worth evaluating. Bounds the per-message work. */
export const MAX_RULE_VALUE = 256;

/** Beyond this, a rule set is a configuration mistake, not a rule set. */
export const MAX_RULES = 200;

/**
 * One inbox rule, normalised.
 *
 * Every match value is already trimmed, lower-cased and length-bounded by
 * `normalizeRule`, so `ruleMatches` allocates nothing per rule per message.
 *
 * **There is no regex here and there must never be one.** Rules are
 * user-authored, but the subject they run against is written by strangers, and
 * a catastrophically-backtracking pattern against a 1000-character subject is a
 * denial of service on the ingest path with every message queued behind it. If
 * a pattern language is ever wanted it needs a bounded matcher — globs compiled
 * by us, or RE2 — never `new RegExp(rule.value)`.
 */
export interface MailRule {
  id: string;
  /** Ascending. See `applyRules`: the **highest** sort wins a conflict. */
  sort: number;
  /** Tie-breaker, before `id`. See `normalizeRules`. */
  created_at: string | null;
  match_sender: string | null;
  match_domain: string | null;
  match_subject: string | null;
  match_list_id: string | null;
  set_category: string | null;
  set_importance: Axis | null;
  set_urgency: Axis | null;
  set_status: RuleStatus | null;
}

/** The subset of a message a rule can see. Nothing else is matchable. */
export interface RuleSubject {
  sender: string | null;
  subject: string | null;
  list_id: string | null;
}

export const EMPTY_RULE_SUBJECT: RuleSubject = {
  sender: null,
  subject: null,
  list_id: null,
};

/**
 * The address inside a `From` header, lower-cased.
 *
 * Senders arrive as `Ada Lovelace <ada@example.com>` about as often as bare
 * addresses, and a rule authored as `ada@example.com` has to match both or the
 * feature is quietly useless. Returns null when there is no plausible address,
 * so a rule never matches on a fragment of a display name.
 */
export function senderAddress(sender: string | null): string | null {
  if (!sender) return null;
  const angled = sender.match(/<([^<>]+)>\s*$/);
  const candidate = (angled ? angled[1] : sender).trim().toLowerCase();
  // One `@`, something either side, no whitespace. Deliberately not RFC 5322 —
  // this decides rule matching, not deliverability, and a permissive parse here
  // means a rule matching more mail than its author intended.
  return /^[^\s@]+@[^\s@]+$/.test(candidate) ? candidate : null;
}

/** The domain part of the sender address, lower-cased and without the `@`. */
export function senderDomain(sender: string | null): string | null {
  const address = senderAddress(sender);
  if (address === null) return null;
  const domain = address.slice(address.lastIndexOf("@") + 1);
  return domain.length > 0 ? domain : null;
}

/**
 * Does `domain` equal `suffix`, or is it a subdomain of it?
 *
 * The label-boundary check is the whole function: a bare
 * `domain.endsWith(suffix)` makes a rule for `example.com` also match
 * `notexample.com`, which is a different organisation and very much the shape a
 * phishing domain takes. `match_domain` is stored without the `@`, which is
 * exactly the form this compares.
 */
export function domainMatches(domain: string, suffix: string): boolean {
  if (domain === suffix) return true;
  return domain.endsWith(`.${suffix}`);
}

/** The bare id inside a `List-Id` header, lower-cased. */
export function listIdValue(listId: string | null): string | null {
  if (!listId) return null;
  // RFC 2919: conventionally `Description <list.example.com>`. Match the
  // bracketed id when there is one, the whole value otherwise.
  // `*` not `+`: an empty `<>` must resolve to null rather than falling
  // through and returning the literal "<>" as the list id.
  const bracketed = listId.match(/<([^<>]*)>/);
  const id = (bracketed ? bracketed[1] : listId).trim().toLowerCase();
  return id.length > 0 ? id : null;
}

/**
 * Does one rule apply to one message?
 *
 * **All non-null match fields must match.** A null field does not constrain.
 * `normalizeRule` guarantees at least one is non-null — as does the
 * `mail_rules_has_match` CHECK — because a rule with no match fields matches
 * *every* message, and with `set_status = 'archived'` that silently empties the
 * inbox while the symptom ("mail stopped arriving") points nowhere near it.
 * The `return false` on an empty criteria set is the belt to that braces.
 */
export function ruleMatches(rule: MailRule, subject: RuleSubject): boolean {
  let constrained = false;

  if (rule.match_sender !== null) {
    constrained = true;
    if (senderAddress(subject.sender) !== rule.match_sender) return false;
  }
  if (rule.match_domain !== null) {
    constrained = true;
    const domain = senderDomain(subject.sender);
    if (domain === null || !domainMatches(domain, rule.match_domain)) return false;
  }
  if (rule.match_subject !== null) {
    constrained = true;
    if (subject.subject === null) return false;
    if (!subject.subject.toLowerCase().includes(rule.match_subject)) return false;
  }
  if (rule.match_list_id !== null) {
    constrained = true;
    if (listIdValue(subject.list_id) !== rule.match_list_id) return false;
  }

  return constrained;
}

/** Trim, bound and lower-case one match value, or null. */
function matchValue(value: unknown): string | null {
  // Lower-cased once here rather than per message: every comparison in
  // `ruleMatches` is case-insensitive, and doing it at normalisation time keeps
  // the hot loop allocation-free.
  return sanitizeText(value, MAX_RULE_VALUE)?.toLowerCase() ?? null;
}

/**
 * Normalise one `mail_rules` row into a `MailRule`, or drop it.
 *
 * Dropping rather than rejecting: one malformed rule must not disable the
 * user's other forty, and it certainly must not fail the ingest — the mail is
 * the thing that matters. The two CHECK constraints are re-asserted here rather
 * than trusted, because this code also runs against whatever a future migration
 * leaves behind.
 */
export function normalizeRule(row: unknown): MailRule | null {
  if (row === null || typeof row !== "object" || Array.isArray(row)) return null;
  const o = row as Record<string, unknown>;

  // `enabled` is filtered in SQL; re-checked here so the pure function is
  // correct on its own and a test cannot pass by accident.
  if (o.enabled === false) return null;

  const id = typeof o.id === "string" && o.id.length > 0 ? o.id : null;
  if (id === null) return null;

  const match_sender = matchValue(o.match_sender);
  const match_domain = matchValue(o.match_domain);
  const match_subject = matchValue(o.match_subject);
  const match_list_id = matchValue(o.match_list_id);
  // mail_rules_has_match: a rule that constrains nothing matches everything.
  if (
    match_sender === null && match_domain === null &&
    match_subject === null && match_list_id === null
  ) {
    return null;
  }

  const set_category = sanitizeText(o.set_category, MAX_CATEGORY);
  const set_importance = parseAxis(o.set_importance);
  const set_urgency = parseAxis(o.set_urgency);
  const rawStatus = sanitizeText(o.set_status, MAX_CATEGORY)?.toLowerCase() ?? null;
  const set_status = (RULE_STATUSES as readonly string[]).includes(rawStatus ?? "")
    ? rawStatus as RuleStatus
    : null;
  // mail_rules_has_action: a rule with no actions is a no-op the user will
  // swear is broken.
  if (
    set_category === null && set_importance === null &&
    set_urgency === null && set_status === null
  ) {
    return null;
  }

  const sort = typeof o.sort === "number" && Number.isFinite(o.sort) ? o.sort : 0;
  const created_at = typeof o.created_at === "string" ? o.created_at : null;

  return {
    id,
    sort,
    created_at,
    match_sender,
    match_domain,
    match_subject,
    match_list_id,
    set_category,
    set_importance,
    set_urgency,
    set_status,
  };
}

/**
 * Normalise and order a rule set: ascending `sort`, ties broken by
 * `created_at` then `id`.
 *
 * `index.ts` already asks Postgres for that order, so this is a second
 * statement of the same thing — deliberately, and not belt-and-braces for its
 * own sake. Two rules sharing a `sort` would otherwise be applied in whatever
 * order the planner returned them, and since the last matching write wins, a
 * conflicting pair would **flip between runs**: the same message re-polled five
 * minutes later would get a different importance, with nothing in the data to
 * explain it. Sorting here also makes the engine deterministic on its own,
 * which is what lets it be tested without a database.
 */
export function normalizeRules(rows: unknown[]): MailRule[] {
  const rules: MailRule[] = [];
  for (const row of rows.slice(0, MAX_RULES)) {
    const rule = normalizeRule(row);
    if (rule) rules.push(rule);
  }
  return rules.sort((a, b) =>
    a.sort - b.sort ||
    (a.created_at ?? "").localeCompare(b.created_at ?? "") ||
    a.id.localeCompare(b.id)
  );
}

/**
 * How matching rules combine.
 *
 * **`overwrite` is the pinned semantics** (`RULE_PRECEDENCE` below), taken from
 * `mail_rules`' own documentation: every enabled matching rule applies in
 * ascending `sort`, and each non-null action field overwrites what came before,
 * so the **highest `sort`** among matching rules wins a direct conflict.
 *
 * `first_match` is retained, implemented and tested, as the record of why that
 * choice matters rather than as an option anyone should reach for. Under it, a
 * rule that only sets a category would *block* a later rule that only sets
 * urgency — the two become mutually exclusive and the user has to write the
 * cross product of every combination they want. The tests assert the two modes
 * give different answers for the same rule set, which is precisely why this
 * could not be left to whichever was more convenient to implement.
 */
export type RulePrecedence = "overwrite" | "first_match";

/** Pinned from `mail_rules`' documented precedence. */
export const RULE_PRECEDENCE: RulePrecedence = "overwrite";

export interface RuleOutcome {
  category: string | null;
  importance: Axis | null;
  urgency: Axis | null;
  status: RuleStatus | null;
  /**
   * The rule that **last** set either axis, for provenance — which is what
   * answers "why is this high urgency?".
   *
   * One column for two axes, so when one rule sets `importance` and a
   * later one sets `urgency`, this names the later. That is lossy and known;
   * the alternative is two provenance columns for a question users ask about
   * the pair. A rule that set only a category is never recorded here — it did
   * not touch the axes and must not be blamed for them.
   */
  rule_id: string | null;
  /** Every rule that matched, in application order. Diagnostics only. */
  matched: string[];
}

export const NO_RULE_OUTCOME: RuleOutcome = {
  category: null,
  importance: null,
  urgency: null,
  status: null,
  rule_id: null,
  matched: [],
};

/**
 * Apply a rule set to one message.
 *
 * # Why this runs here and not in the n8n workflow
 *
 * A rule always beats the model, **deterministically**. In the workflow the
 * verdict would silently depend on which workflow version happened to run, and
 * re-running triage over history would produce different answers than the live
 * pass did. Here it is a pure function of (payload, rules): the same message
 * and the same rules produce the same row today and on a re-import next year.
 * That is also why this function takes no clock and no client.
 *
 * # What "a rule beats the model" means precisely
 *
 * A rule's action **replaces** the model's value for that field and leaves
 * every field it does not set alone. It never merges and never averages — a
 * rule that says "invoices are high importance" is an instruction, not a hint.
 *
 * `score` is untouched by rules on purpose: it is the model's *evidence*, and
 * overwriting it would destroy the record of what the model actually thought
 * while making the axes look model-derived.
 */
export function applyRules(
  subject: RuleSubject,
  rules: MailRule[],
  precedence: RulePrecedence = RULE_PRECEDENCE,
): RuleOutcome {
  const out: RuleOutcome = { ...NO_RULE_OUTCOME, matched: [] };

  for (const rule of rules) {
    if (!ruleMatches(rule, subject)) continue;
    out.matched.push(rule.id);

    const setsAxis = rule.set_importance !== null || rule.set_urgency !== null;

    if (precedence === "first_match") {
      out.category = rule.set_category;
      out.importance = rule.set_importance;
      out.urgency = rule.set_urgency;
      out.status = rule.set_status;
      out.rule_id = setsAxis ? rule.id : null;
      return out;
    }

    // overwrite: each non-null action wins over whatever came before, so the
    // highest `sort` among matching rules is what survives. A null action does
    // not clear an earlier rule's value — it simply does not constrain.
    if (rule.set_category !== null) out.category = rule.set_category;
    if (rule.set_importance !== null) out.importance = rule.set_importance;
    if (rule.set_urgency !== null) out.urgency = rule.set_urgency;
    if (rule.set_status !== null) out.status = rule.set_status;
    if (setsAxis) out.rule_id = rule.id;
  }

  return out;
}

/**
 * Fold a rule outcome onto a row.
 *
 * Separate from `applyRules` so the merge is testable on its own and so the
 * "a rule replaces the model" rule is stated in exactly one place.
 *
 * `status` is deliberately **not** folded here: it is not a `MailRow` field,
 * because a rule's status is only ever the default for a *new* row. See
 * `mergeStatus`, which is where the user's own status wins.
 */
export function withRules(row: MailRow, outcome: RuleOutcome): MailRow {
  return {
    ...row,
    category: outcome.category ?? row.category,
    importance: outcome.importance ?? row.importance,
    urgency: outcome.urgency ?? row.urgency,
    rule_id: outcome.rule_id,
  };
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
 * Precedence, highest first: **the user's existing status**, then a rule's
 * auto-archive, then `DEFAULT_STATUS`.
 *
 * `userId` is a parameter rather than a constant so this stays pure and
 * testable; `index.ts` passes its module-level `OWNER_UID` and nothing else can.
 */
export function mergeStatus(
  rows: MailRow[],
  existing: ExistingRow[],
  userId: string,
  /**
   * Per-message status a *rule* asked for, keyed by `external_id` — in practice
   * only ever `archived`, from auto-archive.
   *
   * It is the default for a **new** row, never an override for an existing one.
   * That ordering is the whole point: auto-archive files mail the user has not
   * seen, but the moment they touch a message their status is theirs, and a
   * re-poll five minutes later must not re-archive something they deliberately
   * un-archived. The mail is still written either way — auto-archive archives
   * a message, it does not drop it.
   */
  ruleStatus: ReadonlyMap<string, string> = new Map(),
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
      status: statusById.get(row.external_id) ??
        ruleStatus.get(row.external_id) ??
        DEFAULT_STATUS,
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

// ───────────────────────────────────────────────────────────────────────────
// The `pending` action — the drain queue
// ───────────────────────────────────────────────────────────────────────────
//
// Classification used to happen *before* anything was persisted, so a slow or
// unavailable Ollama, or a lid closing mid-batch, lost the whole batch. The
// pipeline is now split: the trigger writes rows with no verdict, and a
// scheduled drain asks this action which rows still need one.
//
// `score IS NULL` is the queue. That is not a new concept bolted on — it is
// what the column already meant ("nothing has decided this yet", as distinct
// from "decided, and the answer was low"), and `MailPanel` already sorts those
// rows to the top under their own `untriaged` bucket. The queue was implicit in
// the schema from the start; this only makes it readable.
//
// # Why this returns ids and nothing else
//
// A read path in a function whose whole posture is "accepts no table name, no
// user id and no filter" is a widening, so it is kept as narrow as the write
// path: the caller names nothing, and the response carries **external ids
// only** — no sender, no subject, no snippet. A leaked key still cannot read a
// single word of anyone's mail, which is the property that mattered when this
// function was written and still matters now.
//
// The drain re-fetches the body from Gmail by that id. That is not a
// workaround, it is the same rule as everywhere else here: bodies stay on the
// Mac. `raw` deliberately carries no message text, so there is nothing to read
// back even with the service role.

/** Rows returned when the caller asks for no particular number. */
export const PENDING_DEFAULT_LIMIT = 25;

/**
 * Hard ceiling on one drain pass.
 *
 * Not arbitrary: at roughly 24 s per message on the local 7B, 100 rows is ~40
 * minutes of continuous inference. A larger page would simply overlap the next
 * scheduled drain rather than finish sooner.
 */
export const PENDING_MAX_LIMIT = 100;

export type ParsedPending =
  | { ok: true; limit: number }
  | { ok: false; error: "invalid_limit" };

/** True when the body is asking for the queue rather than delivering a batch. */
export function isPendingRequest(body: unknown): boolean {
  return typeof body === "object" && body !== null &&
    (body as { action?: unknown }).action === "pending";
}

/**
 * Validate a `pending` request.
 *
 * An absent limit is the default, not an error. A present-but-nonsense one *is*
 * an error rather than being silently clamped: `limit: "all"` means the caller
 * believes something about this endpoint that is not true, and quietly handing
 * back 25 rows would let that belief survive.
 */
export function parsePendingRequest(body: unknown): ParsedPending {
  const raw = (body as { limit?: unknown } | null)?.limit;
  if (raw === undefined || raw === null) return { ok: true, limit: PENDING_DEFAULT_LIMIT };

  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return { ok: false, error: "invalid_limit" };

  return { ok: true, limit: Math.min(n, PENDING_MAX_LIMIT) };
}
