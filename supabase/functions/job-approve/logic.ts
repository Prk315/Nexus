/**
 * job-approve — pure rendering and the approval state machine.
 *
 * Kept out of `index.ts` so the whole thing is testable without booting
 * `Deno.serve` or reaching Supabase, the same split as `job-ingest/logic.ts` and
 * `n8n-ingest/logic.ts`.
 *
 * # This file imports NOTHING, on purpose
 *
 * Not even the shared `sanitizeText` that every other logic module reuses. Two
 * reasons, and the second is the real one:
 *
 *   - It runs with **no Deno globals and no jsr: specifiers**, so `node --test`
 *     executes it directly (Node 24 strips types natively). There is no Deno on
 *     the machine this was written on; a test file that cannot be run is a
 *     comment with extra syntax. See `logic.test.ts`.
 *   - `escapeHtml` is the only thing standing between a stranger-written job ad
 *     and a page rendered in the user's browser. It must be readable in full, in
 *     one place, with no indirection — a sanitizer whose behaviour depends on an
 *     import three files away is a sanitizer nobody audits.
 *
 * # The trust boundary
 *
 * Everything this page renders is untrusted. The company name, the job title, the
 * location and the ad's own text were written by strangers and scraped; the
 * reasoning was written by a 7B model that read that text. The draft body is
 * assembled from the user's own modules, but it carries gap markers and (in a
 * future phase) quoted requirements. So: every interpolation goes through
 * `escapeHtml`, without exception, and the page loads no external resource of any
 * kind — no CDN, no font, no image — so there is nothing for injected markup to
 * reach even if the escaping were somehow bypassed.
 */

// MARK: - Escaping

/**
 * HTML-escape, applied to EVERY interpolated value on this page.
 *
 * Five characters, and all five are needed. `&` first or the later replacements
 * get double-escaped. `<` and `>` close and open tags. `"` and `'` break out of
 * attribute values — this page uses attributes (`href`, `value`), and a company
 * name is perfectly capable of containing an apostrophe by accident before it
 * ever contains one on purpose.
 *
 * `&#39;` rather than `&apos;`: the named entity is HTML5-only and older parsers
 * render it literally, which turns an escape into visible noise. The numeric form
 * has always worked.
 *
 * Non-strings become the empty string, never `"null"` or `"undefined"` — a page
 * that renders the word "null" where a company should be looks like a data bug
 * to a human deciding whether to email that company.
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
 * character `escapeHtml` touches, and `apply_url` on a posting comes from a
 * scraped page. Only http(s) survives; anything else renders as plain text
 * instead of a link.
 */
export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return escapeHtml(trimmed);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// MARK: - The state machine

export type Decision = "approve" | "reject";

export const DECISIONS: readonly Decision[] = ["approve", "reject"];

export const parseDecision = (v: unknown): Decision | null =>
  v === "approve" || v === "reject" ? v : null;

/** The one status a token can act from. Everything else is already decided. */
export const PENDING_STATUS = "needs_approval";

export type Outcome = "approved" | "rejected" | "expired" | "not_pending";

export interface Transition {
  /** The status to write, or `null` when nothing must be written at all. */
  next: string | null;
  outcome: Outcome;
}

/**
 * What a decision does to an application.
 *
 * The full matrix, which `logic.test.ts` pins:
 *
 * | current | decision | deadline passed | -> |
 * |---|---|---|---|
 * | needs_approval | approve | no  | `approved`  |
 * | needs_approval | approve | yes | `expired`   |
 * | needs_approval | reject  | no  | `cancelled` |
 * | needs_approval | reject  | yes | `cancelled` |
 * | anything else  | either  | —   | no write    |
 *
 * ## Reject beats expiry
 *
 * A rejected-and-expired application records `cancelled`, not `expired`. The
 * human said no; that is a fact about their judgement and it survives. `expired`
 * is what we write when *nobody* decided in time, and overwriting a decision with
 * a circumstance loses the only information here a machine could not reproduce.
 *
 * ## Approve does not beat expiry
 *
 * The other way round is not symmetric, and it must not be. Approving a closed ad
 * would queue an email to an employer who is no longer hiring — so the deadline
 * wins, the row goes terminal, and the page says so. This is the same check
 * `apply_queue` runs at send time; both exist because the gap between them is
 * hours or days.
 *
 * ## `not_pending` is not an error
 *
 * A second click, a prefetching mail scanner following the form action, a browser
 * restoring the tab — all of them arrive here, and all of them should see the
 * current state rendered calmly rather than a failure. The token stays valid as a
 * *read* credential forever; it stops being a *write* credential the instant the
 * status leaves `needs_approval`. That is the single-use mechanism, and it is why
 * the token is never nulled.
 */
export function decideTransition(
  current: unknown,
  decision: Decision,
  deadlineHasPassed: boolean,
): Transition {
  if (current !== PENDING_STATUS) return { next: null, outcome: "not_pending" };
  if (decision === "reject") return { next: "cancelled", outcome: "rejected" };
  if (deadlineHasPassed) return { next: "expired", outcome: "expired" };
  return { next: "approved", outcome: "approved" };
}

/**
 * Has the ad's deadline passed?
 *
 * NULL and unparseable both mean NO. Most Danish ads carry no `validThrough` at
 * all, and folding "unknown" into "over" would expire the majority of the
 * pipeline — the same rule as `job-ingest`'s `deadlinePassed`, `remote` being
 * null rather than false, and `blocking_state` never being seeded.
 */
export function deadlinePassed(validThrough: unknown, nowMs: number): boolean {
  if (typeof validThrough !== "string" || validThrough.trim().length === 0) return false;
  const t = Date.parse(validThrough);
  return Number.isFinite(t) && t < nowMs;
}

/** What a human should be told about a status that is not `needs_approval`. */
export function describeStatus(status: unknown): string {
  switch (status) {
    case "draft":
      return "This application has not been sent for approval yet.";
    case "needs_approval":
      return "Waiting for your decision.";
    case "approved":
      return "Already approved. It is queued to be sent on the next run.";
    case "queued":
      return "Already approved and handed to the sender. It is going out now.";
    case "submitted":
      return "Already sent. Nothing further to decide.";
    case "cancelled":
      return "Rejected. This application will not be sent.";
    case "expired":
      return "The deadline on this posting passed before it was sent.";
    case "failed":
      return "Sending failed. Check the submission attempts for the reason.";
    case "response":
      return "The employer has replied to this application.";
    default:
      return "This application is in a state this page does not recognise.";
  }
}

// MARK: - The view model

export interface ApprovalView {
  status: string;
  title: string | null;
  company: string | null;
  location: string | null;
  postingUrl: string | null;
  applyChannel: string | null;
  applyEmail: string | null;
  validThrough: string | null;
  profileName: string | null;
  score: number | null;
  reasoning: string | null;
  matchedSkills: string[];
  missingSkills: string[];
  missingSlots: string[];
  body: string | null;
  token: string;
  /** From the same `cv_link` module check `apply_queue` runs. */
  cvReady: boolean;
  nowMs: number;
}

export interface GuardRow {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * A preview of the guards `apply_queue` will re-run at send time.
 *
 * Shown because "I approved it and nothing happened" is the failure this page can
 * prevent for free. Every one of these is checked again server-side before
 * anything is sent — this is information, not enforcement, and the two must never
 * be confused: a green row here is a prediction, and the send-time check is the
 * decision.
 */
export function guardRows(v: ApprovalView): GuardRow[] {
  const gaps = typeof v.body === "string" && (v.body.includes("[GAP") || v.body.includes("[TODO"));
  const expired = deadlinePassed(v.validThrough, v.nowMs);
  const emailable =
    String(v.applyChannel ?? "").toLowerCase() === "email" &&
    typeof v.applyEmail === "string" &&
    v.applyEmail.trim().length > 0;

  return [
    {
      label: "Draft complete",
      ok: !gaps,
      detail: gaps
        ? "Contains unfilled [GAP or [TODO markers — it will be held back until you write the module."
        : "No gap markers.",
    },
    {
      label: "Email channel",
      ok: emailable,
      detail: emailable
        ? `Will be sent to ${v.applyEmail}`
        : "This posting is not an email-apply channel. Approving records your decision, but sending stays manual.",
    },
    {
      label: "CV link ready",
      ok: v.cvReady,
      detail: v.cvReady
        ? "A cv_link module is written and enabled."
        : "The cv_link module is missing or still a [TODO stub. Nothing will be sent until it is filled in.",
    },
    {
      label: "Deadline",
      ok: !expired,
      detail: expired
        ? "The posting's deadline has passed."
        : v.validThrough
        ? `Open until ${v.validThrough}`
        : "No deadline given.",
    },
  ];
}

// MARK: - HTML

/**
 * The page shell. One `<style>`, no external resources of any kind.
 *
 * Both colour schemes are styled. This link is opened from an email client on
 * whatever device is nearest, and a page that assumes light renders as a white
 * flash at midnight — CLAUDE.md's artifact rule applied to the one HTML surface
 * this backend serves.
 */
const STYLE = `
:root { color-scheme: light dark; }
* { box-sizing: border-box; }
body {
  margin: 0; padding: 2rem 1rem;
  font: 15px/1.6 ui-sans-serif, -apple-system, "Segoe UI", Roboto, sans-serif;
  background: #f6f7f9; color: #16181d;
}
main { max-width: 46rem; margin: 0 auto; }
.card {
  background: #fff; border: 1px solid #e2e5ea; border-radius: 14px;
  padding: 1.5rem; margin-bottom: 1rem;
}
h1 { font-size: 1.4rem; margin: 0 0 .25rem; line-height: 1.3; }
h2 { font-size: .8rem; text-transform: uppercase; letter-spacing: .08em;
     color: #6b7280; margin: 0 0 .6rem; }
.sub { color: #6b7280; margin: 0 0 1rem; }
.score { display: inline-block; font-weight: 700; font-size: 1.05rem;
         padding: .15rem .6rem; border-radius: 999px;
         background: #e8f0fe; color: #1a4fa0; }
pre { white-space: pre-wrap; word-wrap: break-word; margin: 0;
      font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, monospace;
      background: #f6f7f9; border: 1px solid #e2e5ea; border-radius: 10px;
      padding: 1rem; max-height: 30rem; overflow: auto; }
ul { margin: 0; padding-left: 1.1rem; }
li { margin: .2rem 0; }
.tag { display: inline-block; padding: .1rem .5rem; margin: .15rem .25rem .15rem 0;
       border-radius: 6px; background: #eef0f3; font-size: .85rem; }
.tag.miss { background: #fdeaea; color: #8a2020; }
.guard { display: flex; gap: .6rem; align-items: baseline; margin: .35rem 0; }
.guard .mark { font-weight: 700; width: 1.2rem; flex: none; }
.ok .mark { color: #1a7f37; }
.no .mark { color: #b3261e; }
.warn { background: #fff6e5; border-color: #f0d9a8; }
.actions { display: flex; gap: .75rem; flex-wrap: wrap; }
button { font: inherit; font-weight: 600; padding: .7rem 1.4rem; border-radius: 10px;
         border: 1px solid transparent; cursor: pointer; }
.approve { background: #1a7f37; color: #fff; }
.reject { background: #fff; color: #b3261e; border-color: #e4b4b0; }
button[disabled] { opacity: .45; cursor: not-allowed; }
a { color: #1a4fa0; }
@media (prefers-color-scheme: dark) {
  body { background: #0e1013; color: #e6e8ec; }
  .card { background: #171a1f; border-color: #2a2f38; }
  h2, .sub { color: #99a1ae; }
  pre { background: #0e1013; border-color: #2a2f38; }
  .tag { background: #232833; }
  .tag.miss { background: #3a1f1f; color: #f0a8a2; }
  .score { background: #14304f; color: #9dc4f5; }
  .warn { background: #33280f; border-color: #5b4718; }
  .reject { background: #171a1f; color: #f0a8a2; border-color: #5b2b28; }
  a { color: #7fb0f0; }
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

const tags = (values: string[], cls = "tag"): string =>
  values.length === 0
    ? '<span class="sub">none</span>'
    : values.map((s) => `<span class="${cls}">${escapeHtml(s)}</span>`).join("");

function header(v: ApprovalView): string {
  const link = safeHref(v.postingUrl);
  const where = [v.company, v.location].filter(Boolean).map((s) => escapeHtml(s)).join(" · ");
  return `<div class="card">
<h1>${escapeHtml(v.title ?? "Untitled position")}</h1>
<p class="sub">${where || "Unknown employer"}</p>
<p>${v.score === null ? "" : `<span class="score">${escapeHtml(v.score)}</span> `}
${v.profileName ? `matched against <strong>${escapeHtml(v.profileName)}</strong>` : ""}</p>
${link ? `<p><a href="${link}" rel="noreferrer noopener">View the original posting</a></p>` : ""}
</div>`;
}

function verdict(v: ApprovalView): string {
  return `<div class="card">
<h2>Why the model scored it this way</h2>
<p>${v.reasoning ? escapeHtml(v.reasoning) : '<span class="sub">No reasoning recorded.</span>'}</p>
<h2>Matched skills</h2><p>${tags(v.matchedSkills)}</p>
<h2>Missing skills</h2><p>${tags(v.missingSkills, "tag miss")}</p>
</div>`;
}

function gaps(v: ApprovalView): string {
  if (v.missingSlots.length === 0) return "";
  return `<div class="card warn">
<h2>Unwritten sections</h2>
<p>The draft below carries a visible gap marker for each of these. Nothing will be
sent while they are unfilled — write the module, or delete the line.</p>
<ul>${v.missingSlots.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
</div>`;
}

function guards(v: ApprovalView): string {
  const rows = guardRows(v)
    .map(
      (g) =>
        `<div class="guard ${g.ok ? "ok" : "no"}"><span class="mark">${g.ok ? "✓" : "✕"}</span>
<span><strong>${escapeHtml(g.label)}</strong> — ${escapeHtml(g.detail)}</span></div>`,
    )
    .join("");
  return `<div class="card"><h2>Checked again before anything is sent</h2>${rows}</div>`;
}

function draft(v: ApprovalView): string {
  return `<div class="card">
<h2>The letter that will be sent, in full</h2>
<pre>${escapeHtml(v.body ?? "")}</pre>
</div>`;
}

/**
 * The review page.
 *
 * ⚠️ **CODE-REVIEW ASSERTION: rendering this MUST NOT mutate anything.**
 *
 * It is reached by GET, and a GET that changes state is a GET that mail scanners
 * fire. Gmail, Outlook and every corporate link-rewriting proxy prefetch every
 * URL in an email to check it for malware — so a mutating GET here would let a
 * robot approve job applications on the user's behalf, before they have read a
 * word. That is not a hypothetical: it is the single most common way "click to
 * confirm" links get silently confirmed.
 *
 * The whole mutation surface is therefore the POST branch of `index.ts`, and this
 * function is pure — it takes a view model and returns a string. It cannot mutate
 * anything because it holds no client. Keep it that way: if this page ever needs
 * to record that it was *viewed*, that is a reason to add a separate beacon, not
 * a reason to give the renderer a database handle.
 *
 * The expired case renders a disabled Approve button rather than hiding it, so
 * the reason nothing can be done is visible. The POST re-checks the deadline
 * regardless — a disabled attribute is a courtesy, not a control.
 */
export function renderReviewPage(v: ApprovalView): string {
  if (v.status !== PENDING_STATUS) {
    return page(
      "Job application",
      header(v) +
        `<div class="card"><h2>Nothing to decide</h2><p>${escapeHtml(describeStatus(v.status))}</p></div>` +
        verdict(v) + draft(v),
    );
  }

  const expired = deadlinePassed(v.validThrough, v.nowMs);
  const form = `<div class="card">
<h2>Your decision</h2>
${expired ? "<p><strong>The deadline on this posting has passed.</strong> Approving it now would only record it as expired.</p>" : "<p>Nothing is sent until you approve. Approving queues it; the sender re-checks every guard above first.</p>"}
<form method="POST" class="actions">
<input type="hidden" name="token" value="${escapeHtml(v.token)}">
<button class="approve" type="submit" name="decision" value="approve"${expired ? " disabled" : ""}>Approve and send</button>
<button class="reject" type="submit" name="decision" value="reject">Reject</button>
</form>
</div>`;

  return page(
    "Approve job application",
    header(v) + verdict(v) + gaps(v) + guards(v) + draft(v) + form,
  );
}

/** The confirmation shown after a POST. Small, and states the resulting status. */
export function renderResultPage(outcome: Outcome, v: ApprovalView): string {
  const headline =
    outcome === "approved"
      ? "Approved"
      : outcome === "rejected"
      ? "Rejected"
      : outcome === "expired"
      ? "Too late"
      : "Already decided";

  const detail =
    outcome === "approved"
      ? "It will be sent on the next run, after the send-time guards are re-checked."
      : outcome === "rejected"
      ? "This application will not be sent."
      : outcome === "expired"
      ? "The posting's deadline passed before this was approved, so it has been marked expired rather than queued."
      : describeStatus(v.status);

  return page(
    `${headline} — job application`,
    `<div class="card"><h1>${escapeHtml(headline)}</h1>
<p class="sub">${escapeHtml(v.title ?? "Untitled position")}${v.company ? ` · ${escapeHtml(v.company)}` : ""}</p>
<p>${escapeHtml(detail)}</p></div>`,
  );
}

/** A dead end: bad token, unknown token, wrong method. No detail, on purpose. */
export function renderErrorPage(headline: string, detail: string): string {
  return page(
    headline,
    `<div class="card"><h1>${escapeHtml(headline)}</h1><p>${escapeHtml(detail)}</p></div>`,
  );
}

// MARK: - Request body

export interface DecisionRequest {
  token: string;
  decision: Decision;
}

export type DecisionParse =
  | { ok: true; request: DecisionRequest }
  | { ok: false; error: string };

/**
 * Parse the POST body, accepting BOTH form-encoded and JSON.
 *
 * The form-encoded path is what an actual browser submits from the page above.
 * The JSON path exists so the same endpoint can be driven from a panel button or
 * a widget later without a second function — and so this is testable with a
 * string rather than a `Request`.
 *
 * The content type is a hint, not a contract: browsers send
 * `application/x-www-form-urlencoded; charset=UTF-8` and some clients send
 * nothing at all. So it is sniffed leniently and the JSON parse is allowed to
 * fail into the form parse rather than erroring.
 */
export function parseDecisionBody(contentType: unknown, raw: unknown): DecisionParse {
  if (typeof raw !== "string" || raw.length === 0) return { ok: false, error: "empty_body" };
  const ct = typeof contentType === "string" ? contentType.toLowerCase() : "";

  let token: unknown;
  let decision: unknown;

  const readForm = () => {
    const params = new URLSearchParams(raw);
    token = params.get("token");
    decision = params.get("decision");
  };

  if (ct.includes("json")) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      token = parsed?.token;
      decision = parsed?.decision;
    } catch {
      return { ok: false, error: "invalid_json" };
    }
  } else if (raw.trimStart().startsWith("{")) {
    // No usable content type, but it is plainly JSON. Try it, fall back to form.
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      token = parsed?.token;
      decision = parsed?.decision;
    } catch {
      readForm();
    }
  } else {
    readForm();
  }

  if (!isUuid(token)) return { ok: false, error: "invalid_token" };
  const d = parseDecision(decision);
  if (!d) return { ok: false, error: "invalid_decision" };
  return { ok: true, request: { token, decision: d } };
}
