/**
 * housing-renew — pure rendering and the acknowledgement rule.
 *
 * The browser half of the waiting-list renewal guard. A link in a reminder email
 * opens this page; he goes and renews on the provider's own site, comes back and
 * presses "I renewed today". That press is the ONLY thing in the entire system
 * that can write `housing_waitlist_positions.last_renewed_at`.
 *
 * Kept out of `index.ts` so the whole thing is testable without booting
 * `Deno.serve` or reaching Supabase — the same split as `job-approve/logic.ts`,
 * which this clones.
 *
 * # What this file imports, and the one exception to job-approve's rule
 *
 * `job-approve/logic.ts` imports **nothing**, for two stated reasons: it must run
 * under `node --test` with no Deno globals and no `jsr:` specifiers, and
 * `escapeHtml` must be readable in full, in one place, with no indirection.
 *
 * Both still hold here, and the escaping below is a local, complete copy for
 * exactly that reason. But the *date math* is imported from
 * `../housing-ingest/logic.ts`, deliberately, because the competing risks are not
 * symmetric:
 *
 *   - A duplicated `escapeHtml` is a security primitive nobody audits. Bad.
 *   - A duplicated **due-date rule** is two implementations of the calculation
 *     that decides whether he keeps three years of seniority — and they would
 *     disagree first about the month-end clamp, silently, in a page whose entire
 *     job is to tell him the correct next due date. Much worse.
 *
 * CLAUDE.md records the cost of the second failure three times over (garmin's
 * mapping, the BIA calibration constants, the systems due-rule written out thrice
 * whose copies already disagreed). So: one rule, one implementation, imported.
 *
 * The import is safe for the test runner because that graph
 * (`../housing-ingest/logic.ts` -> `../n8n-ingest/logic.ts`) reaches nothing
 * outside the repo and uses no Deno globals — the same property
 * `housing-ingest/logic.test.ts` already relies on.
 *
 * # The trust boundary
 *
 * Lower than job-approve's — every value rendered here was typed by the user into
 * his own panel, not scraped from a stranger's job ad. It is escaped anyway,
 * without exception. A sanitizer applied only where the author currently believes
 * it is needed is a sanitizer that fails the first time a field changes source,
 * and `notes` is one paste away from carrying markup from a provider's website.
 */

import {
  addMonthsUtc,
  formatYmd,
  parseYmd,
  type YMD,
} from "../housing-ingest/logic.ts";

export { addMonthsUtc, formatYmd, parseYmd, type YMD };

// MARK: - Escaping

/**
 * HTML-escape, applied to EVERY interpolated value on this page.
 *
 * A verbatim copy of `job-approve/logic.ts`'s, and it should stay verbatim. Five
 * characters, all five needed: `&` first or the later replacements double-escape,
 * `<`/`>` open and close tags, and `"`/`'` break out of attribute values — this
 * page uses `href` and `value`, and a Danish list name (`Egmont H. Petersens
 * Kollegium`) is perfectly capable of carrying an apostrophe.
 *
 * `&#39;` rather than `&apos;`: the named entity is HTML5-only and older parsers
 * render it literally, turning an escape into visible noise.
 *
 * Non-strings become the empty string, never `"null"` — a page that renders the
 * word "null" where a waiting list should be looks like a data bug to a person
 * deciding whether their application still exists.
 */
export function escapeHtml(value: unknown): string {
  if (typeof value !== "string") {
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return "";
  }
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * A URL safe to put in an `href`.
 *
 * Escaping alone is not enough for a link: `javascript:alert(1)` contains not one
 * character `escapeHtml` touches. Only http(s) survives; anything else renders as
 * plain text instead of a link.
 */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return escapeHtml(trimmed);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// MARK: - The view model

export interface RenewView {
  listName: string | null;
  /** `YYYY-MM-DD`, or `null` when the list's interval was never established. */
  dueAt: string | null;
  /** NEGATIVE means overdue. `null` alongside a null `dueAt`. */
  daysLeft: number | null;
  intervalMonths: number | null;
  renewalUrl: string | null;
  lastRenewedAt: string | null;
  signedUpAt: string | null;
  position: number | null;
  notes: string | null;
  token: string;
  /** Today in `HOUSING_TZ`, `YYYY-MM-DD`. Supplied so the renderer stays pure. */
  today: string;
}

/**
 * How the deadline reads in a sentence.
 *
 * Spelled out rather than left as a signed integer because the sign is the whole
 * message and a bare "-2" is ambiguous to a person under time pressure. "Overdue"
 * is stated first and plainly: on a monthly list an overdue row may already have
 * been deleted, and the page must not soften that into "due 2 days ago".
 */
export function describeDaysLeft(daysLeft: number | null): string {
  if (daysLeft === null) return "No due date — this list's renewal rule is not recorded.";
  if (daysLeft < 0) {
    const n = Math.abs(daysLeft);
    return `Overdue by ${n} day${n === 1 ? "" : "s"}. It may already have lapsed — check the list itself.`;
  }
  if (daysLeft === 0) return "Due today.";
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left.`;
}

/**
 * The due date after a renewal confirmed today.
 *
 * `null` when the interval is unknown — the page then says so rather than
 * inventing a date, which is the same refusal `renewalDueDate` makes and for the
 * same reason: a confidently-rendered wrong deadline is worse than a visible gap,
 * because only one of the two prompts him to go and check.
 */
export function nextDueAfter(today: string, intervalMonths: number | null): string | null {
  if (intervalMonths === null || !Number.isFinite(intervalMonths) || intervalMonths < 1) {
    return null;
  }
  const t = parseYmd(today);
  if (t === null) return null;
  return formatYmd(addMonthsUtc(t, Math.floor(intervalMonths)));
}

// MARK: - HTML

/**
 * The page shell. One `<style>`, no external resources of any kind.
 *
 * Both colour schemes are styled: this link is opened from an email client on
 * whatever device is nearest, and a page that assumes light renders as a white
 * flash at midnight.
 */
const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1rem;
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: #f6f7f9; color: #16181d;
}
main { max-width: 40rem; margin: 0 auto; }
.card {
  background: #fff; border: 1px solid #e2e5ea; border-radius: 14px;
  padding: 1.5rem; margin-bottom: 1rem;
}
h1 { font-size: 1.4rem; margin: 0 0 .25rem; line-height: 1.3; }
h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
     color: #6b7280; margin: 0 0 .6rem; }
.sub { color: #6b7280; margin: 0 0 1rem; }
.due { display: inline-block; font-weight: 700; font-size: 1.05rem;
       padding: .15rem .6rem; border-radius: 999px;
       background: #e8f0fe; color: #1a4fa0; }
.due.late { background: #fdeaea; color: #8a2020; }
.due.soon { background: #fff1d6; color: #7a4a05; }
dl { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: .3rem .9rem; }
dt { color: #6b7280; }
dd { margin: 0; }
.go { display: inline-block; font-weight: 600; padding: .7rem 1.4rem;
      border-radius: 10px; background: #1a4fa0; color: #fff;
      text-decoration: none; }
button { font: inherit; font-weight: 600; padding: .7rem 1.4rem; border-radius: 10px;
         border: 1px solid transparent; cursor: pointer;
         background: #1a7f37; color: #fff; }
.warn { background: #fff6e5; border-color: #f0d9a8; }
a { color: #1a4fa0; }
@media (prefers-color-scheme: dark) {
  body { background: #0e1013; color: #e6e8ec; }
  .card { background: #171a1f; border-color: #2a2f38; }
  h2, .sub, dt { color: #99a1ae; }
  .due { background: #14304f; color: #9dc4f5; }
  .due.late { background: #3a1f1f; color: #f0a8a2; }
  .due.soon { background: #3a2f14; color: #f0d09a; }
  .warn { background: #33280f; border-color: #5b4718; }
  a { color: #7fb0f0; }
  .go { background: #1a4fa0; color: #fff; }
}
`;

export function page(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head><body><main>${inner}</main></body></html>`;
}

const dueClass = (daysLeft: number | null): string =>
  daysLeft === null ? "due" : daysLeft < 0 ? "due late" : daysLeft <= 3 ? "due soon" : "due";

function facts(v: RenewView): string {
  const rows: [string, string][] = [];
  if (v.dueAt) rows.push(["Renew before", v.dueAt]);
  if (v.intervalMonths !== null) {
    rows.push([
      "Interval",
      `Every ${v.intervalMonths} month${v.intervalMonths === 1 ? "" : "s"}`,
    ]);
  }
  if (v.lastRenewedAt) rows.push(["Last renewed", v.lastRenewedAt]);
  if (v.signedUpAt) rows.push(["Signed up", v.signedUpAt]);
  if (v.position !== null) rows.push(["Position", String(v.position)]);
  if (rows.length === 0) return "";
  return `<div class="card"><h2>What we have on record</h2><dl>${
    rows.map(([k, val]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(val)}</dd>`).join("")
  }</dl>${
    v.notes ? `<p class="sub" style="margin-top:1rem">${escapeHtml(v.notes)}</p>` : ""
  }</div>`;
}

/**
 * The reminder page.
 *
 * ⚠️ **CODE-REVIEW ASSERTION: rendering this MUST NOT mutate anything.**
 *
 * It is reached by GET, and a GET that changes state is a GET that mail scanners
 * fire. Gmail, Outlook and every corporate link-rewriting proxy prefetch every
 * URL in an email to check it for malware. Here the consequence is specific and
 * severe: a mutating GET would let a scanner stamp `last_renewed_at` — recording
 * a renewal that never happened, pushing the due date a month out, silencing the
 * guard, and letting the list delete him while the panel showed a green row.
 *
 * The whole mutation surface is therefore the POST branch of `index.ts`, and this
 * function is pure — it takes a view model and returns a string. It cannot mutate
 * anything because it holds no client. Keep it that way.
 *
 * ## The renew link comes FIRST and the confirm button SECOND
 *
 * Deliberate ordering, not styling. The button records a claim; the link is what
 * makes the claim true. A page that leads with "I renewed" invites a person on a
 * phone to press it and mean "yes, I'll do that" — and this is the one system
 * where a well-meant lie is indistinguishable from success until the seniority is
 * already gone. So the button's label is "I have renewed it", past tense, and it
 * sits under the link rather than above it.
 */
export function renderRenewPage(v: RenewView): string {
  const link = safeHref(v.renewalUrl);
  const unknown = v.dueAt === null;

  const head = `<div class="card">
<h1>${escapeHtml(v.listName ?? "Waiting list")}</h1>
<p class="sub">Waiting-list renewal</p>
<p><span class="${dueClass(v.daysLeft)}">${escapeHtml(describeDaysLeft(v.daysLeft))}</span></p>
</div>`;

  const unknownNote = unknown
    ? `<div class="card warn">
<h2>This list's rule is not recorded</h2>
<p>We do not know how often ${escapeHtml(v.listName ?? "this list")} requires you to
reconfirm, so no deadline can be shown. That is not the same as "it never
expires" — please check the provider's own terms and set the interval in the
panel.</p>
<p>For reference: Kollegiernes Kontor i København and CIU / s.dk both require
reconfirmation <strong>every month</strong>, and delete the application — and all
accumulated seniority — if you miss it.</p>
</div>`
    : "";

  const action = `<div class="card">
<h2>Step 1 — renew it on their site</h2>
${
    link
      ? `<p><a class="go" href="${link}" rel="noreferrer noopener">Go renew ${escapeHtml(v.listName ?? "this list")}</a></p>`
      : `<p class="sub">No renewal link is recorded for this list. Open the provider's site
and renew there, then come back to this page.</p>`
  }
<h2 style="margin-top:1.5rem">Step 2 — tell us you did</h2>
<p>This only records the date. It does not renew anything on your behalf — nothing
in this system can log in to a housing provider.</p>
<form method="POST">
<input type="hidden" name="token" value="${escapeHtml(v.token)}">
<input type="hidden" name="confirm" value="${escapeHtml(CONFIRM_VALUE)}">
<button type="submit">I have renewed it — record today (${escapeHtml(v.today)})</button>
</form>
</div>`;

  return page(
    `Renew ${v.listName ?? "waiting list"}`,
    head + unknownNote + action + facts(v),
  );
}

/**
 * The confirmation shown after a POST.
 *
 * States the NEW due date, because "saved" is not the information he needs — the
 * question a person actually has at this moment is "when do I have to do this
 * again", and answering it here is what makes the next reminder unsurprising.
 *
 * When the interval is unknown there is deliberately no date and an explicit
 * prompt instead. Rendering a guessed one would be the exact failure this whole
 * feature exists to prevent, wearing a reassuring green tick.
 */
export function renderRenewedPage(v: RenewView, newDueAt: string | null): string {
  const body = newDueAt
    ? `<p>Recorded. <strong>${escapeHtml(v.listName ?? "This list")}</strong> is now
renewed as of <strong>${escapeHtml(v.today)}</strong>.</p>
<p>Next renewal due <span class="due">${escapeHtml(newDueAt)}</span>. You will be
reminded before then.</p>`
    : `<p>Recorded. <strong>${escapeHtml(v.listName ?? "This list")}</strong> is now
renewed as of <strong>${escapeHtml(v.today)}</strong>.</p>
<div class="card warn" style="margin-top:1rem"><p>No next due date can be shown:
this list's renewal interval is not recorded. Set it in the panel, or you will
only be nudged to check it once a quarter.</p></div>`;

  return page(`Renewed — ${v.listName ?? "waiting list"}`, `<div class="card">
<h1>Renewal recorded</h1>
${body}
</div>` + facts({ ...v, lastRenewedAt: v.today, dueAt: newDueAt }));
}

/** A dead end: bad token, unknown token, wrong method. No detail, on purpose. */
export function renderErrorPage(headline: string, detail: string): string {
  return page(
    headline,
    `<div class="card"><h1>${escapeHtml(headline)}</h1><p>${escapeHtml(detail)}</p></div>`,
  );
}

// MARK: - Request body

/**
 * The value the POST must carry alongside the token.
 *
 * ⚠️ **This field is a deliberate speed bump, and it is the only thing standing
 * between an aggressive link scanner and a false renewal.**
 *
 * The `ack_token` is reusable by design — renewal recurs forever, so unlike
 * `job_applications.approval_token` it never stops being a write credential (see
 * the column comment in the migration). That makes the POST body the only place
 * left to require intent. A scanner that replays the bare URL as a POST, or
 * POSTs an empty body, gets a 400 and writes nothing.
 *
 * It is not complete protection: a scanner that parses and submits the rendered
 * form would carry this field too. `job-approve` has exactly the same residual
 * exposure for a strictly more destructive action, and the mitigation here is the
 * one described in the migration — the write is bounded to a date on one row, and
 * every subsequent reminder email states the stored `last_renewed_at` back to
 * him, so a date he does not recognise is visible rather than silent.
 */
export const CONFIRM_VALUE = "renewed";

export interface RenewRequest {
  token: string;
}

export type RenewParse =
  | { ok: true; request: RenewRequest }
  | { ok: false; error: string };

/**
 * Parse the POST body, accepting BOTH form-encoded and JSON.
 *
 * The form path is what the page above submits. The JSON path exists so the same
 * endpoint can be driven from a panel button or an iOS widget later without a
 * second function — and so this is testable with a string rather than a
 * `Request`.
 *
 * The content type is a hint, not a contract: browsers send
 * `application/x-www-form-urlencoded; charset=UTF-8` and some clients send
 * nothing at all. So it is sniffed leniently and a failed JSON parse falls
 * through to the form parse rather than erroring. Same shape as
 * `job-approve/logic.ts`'s `parseDecisionBody`.
 */
export function parseRenewBody(contentType: unknown, raw: unknown): RenewParse {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, error: "empty_body" };
  const ct = typeof contentType === "string" ? contentType.toLowerCase() : "";

  let token: unknown;
  let confirm: unknown;

  const readForm = () => {
    const params = new URLSearchParams(raw);
    token = params.get("token");
    confirm = params.get("confirm");
  };
  const readJson = (): boolean => {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      token = parsed?.token;
      confirm = parsed?.confirm;
      return true;
    } catch {
      return false;
    }
  };

  if (ct.includes("json")) {
    if (!readJson()) return { ok: false, error: "invalid_json" };
  } else if (raw.trimStart().startsWith("{")) {
    if (!readJson()) readForm();
  } else {
    readForm();
  }

  if (!isUuid(token)) return { ok: false, error: "invalid_token" };
  if (confirm !== CONFIRM_VALUE) return { ok: false, error: "invalid_confirm" };
  return { ok: true, request: { token } };
}
