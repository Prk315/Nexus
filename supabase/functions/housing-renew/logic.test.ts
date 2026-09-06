/**
 * housing-renew — pure-logic tests.
 *
 * Run:
 *
 *     node --test supabase/functions/housing-renew/logic.test.ts
 *
 * `node:test` rather than `jsr:@std/assert`, for the reason spelled out at the top
 * of `../job-approve/logic.test.ts`: there is no Deno on this machine, Node 24
 * strips types natively, and a test that cannot be executed is a comment with
 * extra syntax. This file's import graph (`./logic.ts` ->
 * `../housing-ingest/logic.ts` -> `../n8n-ingest/logic.ts`) reaches nothing
 * outside the repo and uses no Deno globals, so it runs with no build step.
 *
 * # Scope
 *
 * Two families, and they are the two ways this page can cause the failure the
 * whole guard exists to prevent — a deleted waiting list and years of seniority
 * gone:
 *
 * 1. **A wrong or missing date.** The page's entire job is to tell him when the
 *    next renewal falls due. A month-end clamp it got wrong, or a confidently
 *    rendered date for a list whose interval nobody established, is worse than a
 *    blank — because only one of the two sends him to check.
 * 2. **A mutation reached without intent.** Mail scanners prefetch every URL in
 *    every message and some POST to form actions. `parseRenewBody` refusing a
 *    body without `confirm=renewed` is the one programmatic speed bump between a
 *    scanner and a recorded renewal that never happened.
 *
 * Escaping is tested third, and it is the standard reason: a `renderHTML`
 * mismatch is invisible to `tsc` and survives every manual click-through.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  CONFIRM_VALUE,
  describeDaysLeft,
  escapeHtml,
  isUuid,
  nextDueAfter,
  parseRenewBody,
  type RenewView,
  renderErrorPage,
  renderRenewedPage,
  renderRenewPage,
  safeHref,
} from "./logic.ts";

const TOKEN = "99999999-8888-4777-8666-555555555555";

const view = (over: Partial<RenewView> = {}): RenewView => ({
  listName: "KKIK",
  dueAt: "2026-09-10",
  daysLeft: 4,
  intervalMonths: 1,
  renewalUrl: "https://www.kollegierneskontor.dk/",
  lastRenewedAt: "2026-08-10",
  signedUpAt: "2024-03-15",
  position: 42,
  notes: null,
  token: TOKEN,
  today: "2026-09-06",
  ...over,
});

// ---------------------------------------------------------------------------
describe("escapeHtml", () => {
  it("escapes all five characters, ampersand first", () => {
    assert.equal(escapeHtml("<b>&'\""), "&lt;b&gt;&amp;&#39;&quot;");
    // Ampersand first, or the later replacements get double-escaped.
    assert.equal(escapeHtml("&lt;"), "&amp;lt;");
  });

  it("uses the numeric apostrophe entity, not the HTML5-only named one", () => {
    // `&apos;` renders literally in older parsers, turning an escape into noise.
    assert.equal(escapeHtml("Egmont H. Petersens'"), "Egmont H. Petersens&#39;");
  });

  it("renders a non-string as empty, never as the word null", () => {
    // A page showing "null" where a waiting list should be looks like a data bug
    // to a person checking whether their application still exists.
    assert.equal(escapeHtml(null), "");
    assert.equal(escapeHtml(undefined), "");
    assert.equal(escapeHtml({}), "");
    assert.equal(escapeHtml(NaN), "");
    assert.equal(escapeHtml(42), "42");
  });

  it("leaves Danish letters alone", () => {
    assert.equal(escapeHtml("Ærø Kollegiet på Østerbro"), "Ærø Kollegiet på Østerbro");
  });
});

describe("safeHref", () => {
  it("passes http(s) and refuses every scheme that escaping cannot fix", () => {
    // `javascript:alert(1)` contains not one character escapeHtml touches.
    assert.equal(safeHref("https://mit.s.dk/"), "https://mit.s.dk/");
    assert.equal(safeHref("http://example.dk/x"), "http://example.dk/x");
    assert.equal(safeHref("javascript:alert(1)"), null);
    assert.equal(safeHref("data:text/html,<script>"), null);
    assert.equal(safeHref("  JAVASCRIPT:alert(1)"), null);
    assert.equal(safeHref(null), null);
  });

  it("escapes the href it returns, so a quote cannot break the attribute", () => {
    assert.equal(
      safeHref('https://example.dk/?a="onmouseover="x'),
      "https://example.dk/?a=&quot;onmouseover=&quot;x",
    );
  });
});

// ---------------------------------------------------------------------------
describe("describeDaysLeft", () => {
  it("states overdue plainly rather than softening it", () => {
    // On a monthly list an overdue row may already have been deleted. "Due 2 days
    // ago" reads as a grace period; there is none.
    const s = describeDaysLeft(-2);
    assert.match(s, /Overdue by 2 days/);
    assert.match(s, /may already have lapsed/);
    assert.match(describeDaysLeft(-1), /Overdue by 1 day\./);
  });

  it("handles today and singular/plural", () => {
    assert.equal(describeDaysLeft(0), "Due today.");
    assert.equal(describeDaysLeft(1), "1 day left.");
    assert.equal(describeDaysLeft(4), "4 days left.");
  });

  it("says the rule is unrecorded rather than implying no deadline exists", () => {
    // "absent is never a verdict": a null must not read as "nothing to do".
    const s = describeDaysLeft(null);
    assert.match(s, /not recorded/);
    assert.doesNotMatch(s, /never expires/i);
  });
});

describe("nextDueAfter", () => {
  it("adds the interval with Postgres month-end clamping", () => {
    assert.equal(nextDueAfter("2026-01-31", 1), "2026-02-28");
    assert.equal(nextDueAfter("2026-08-31", 1), "2026-09-30");
    assert.equal(nextDueAfter("2026-09-06", 1), "2026-10-06");
    assert.equal(nextDueAfter("2026-09-20", 12), "2027-09-20");
    assert.equal(nextDueAfter("2028-01-31", 1), "2028-02-29"); // leap
  });

  it("returns null rather than guessing when the interval is unknown", () => {
    // The confirmation page then says so. A confidently-rendered wrong deadline is
    // worse than a visible gap, because only the gap prompts him to check.
    assert.equal(nextDueAfter("2026-09-06", null), null);
    assert.equal(nextDueAfter("2026-09-06", 0), null);
    assert.equal(nextDueAfter("2026-09-06", -1), null);
    assert.equal(nextDueAfter("not a date", 1), null);
  });
});

// ---------------------------------------------------------------------------
describe("parseRenewBody", () => {
  it("accepts the form the page actually submits", () => {
    const p = parseRenewBody(
      "application/x-www-form-urlencoded; charset=UTF-8",
      `token=${TOKEN}&confirm=${CONFIRM_VALUE}`,
    );
    assert.equal(p.ok, true);
    if (p.ok) assert.equal(p.request.token, TOKEN);
  });

  it("accepts JSON, so a panel button needs no second function", () => {
    const p = parseRenewBody(
      "application/json",
      JSON.stringify({ token: TOKEN, confirm: CONFIRM_VALUE }),
    );
    assert.equal(p.ok, true);
  });

  it("sniffs JSON with no usable content type, and falls back to form", () => {
    assert.equal(
      parseRenewBody(null, JSON.stringify({ token: TOKEN, confirm: CONFIRM_VALUE })).ok,
      true,
    );
    assert.equal(parseRenewBody(null, `token=${TOKEN}&confirm=${CONFIRM_VALUE}`).ok, true);
    assert.equal(parseRenewBody("application/json", "{oops").ok, false);
  });

  it("REFUSES a body carrying only the token", () => {
    // ⚠️ The load-bearing case. The ack_token is reusable by design and therefore
    // never stops being a write credential, so this field is the only intent
    // signal left. A link scanner replaying the bare URL as a POST lands here and
    // writes nothing.
    assert.deepEqual(parseRenewBody(null, `token=${TOKEN}`), {
      ok: false,
      error: "invalid_confirm",
    });
    assert.equal(parseRenewBody("application/json", JSON.stringify({ token: TOKEN })).ok, false);
    assert.equal(parseRenewBody(null, `token=${TOKEN}&confirm=yes`).ok, false);
    assert.equal(parseRenewBody(null, `token=${TOKEN}&confirm=true`).ok, false);
  });

  it("refuses an empty body and a token that is not a uuid", () => {
    assert.equal(parseRenewBody(null, "").ok, false);
    assert.equal(parseRenewBody(null, undefined).ok, false);
    assert.equal(parseRenewBody(null, `token=42&confirm=${CONFIRM_VALUE}`).ok, false);
    assert.equal(parseRenewBody(null, `confirm=${CONFIRM_VALUE}`).ok, false);
  });

  it("isUuid accepts a v4 and refuses near-misses", () => {
    assert.equal(isUuid(TOKEN), true);
    assert.equal(isUuid(TOKEN.slice(0, -1)), false);
    assert.equal(isUuid("default"), false);
    assert.equal(isUuid(null), false);
  });
});

// ---------------------------------------------------------------------------
describe("renderRenewPage", () => {
  it("carries the token in a hidden field AND the confirm value", () => {
    const out = renderRenewPage(view());
    assert.match(out, new RegExp(`name="token" value="${TOKEN}"`));
    assert.match(out, new RegExp(`name="confirm" value="${CONFIRM_VALUE}"`));
    assert.match(out, /<form method="POST">/);
  });

  it("renders the renewal link prominently, with noreferrer", () => {
    // The token is in the page's own URL, so a referrer would ship it to
    // kollegierneskontor.dk. The response header covers the rest.
    const out = renderRenewPage(view());
    assert.match(out, /class="go" href="https:\/\/www\.kollegierneskontor\.dk\/"/);
    assert.match(out, /rel="noreferrer noopener"/);
  });

  it("escapes a hostile list name and hostile notes", () => {
    const out = renderRenewPage(view({
      listName: '<script>alert(1)</script>',
      notes: '"><img src=x onerror=alert(1)>',
    }));
    assert.doesNotMatch(out, /<script>alert/);
    assert.doesNotMatch(out, /<img src=x/);
    assert.match(out, /&lt;script&gt;/);
  });

  it("refuses to make a javascript: renewal_url into a link", () => {
    const out = renderRenewPage(view({ renewalUrl: "javascript:alert(1)" }));
    assert.doesNotMatch(out, /href="javascript:/);
    // And says what to do instead, rather than silently omitting the step.
    assert.match(out, /No renewal link is recorded/);
  });

  it("warns loudly when the interval is unknown, and names the real rule", () => {
    // "absent is never a verdict", on the surface a human actually reads. The page
    // must not let a missing interval look like "this one is fine".
    const out = renderRenewPage(view({ dueAt: null, daysLeft: null, intervalMonths: null }));
    assert.match(out, /rule is not recorded/);
    assert.match(out, /every month/);
    assert.doesNotMatch(out, /never expires/i);
  });

  it("marks an overdue row visually as well as in words", () => {
    const out = renderRenewPage(view({ daysLeft: -12 }));
    assert.match(out, /class="due late"/);
    assert.match(out, /Overdue by 12 days/);
  });

  it("loads no external resource of any kind", () => {
    const out = renderRenewPage(view());
    assert.doesNotMatch(out, /<script/i);
    assert.doesNotMatch(out, /https?:\/\/(?!www\.kollegierneskontor\.dk)/);
  });

  it("labels the button in the PAST tense", () => {
    // The button records a claim; the link is what makes it true. "I have renewed
    // it" is answerable; "Renew" invites a press that means "yes, I'll do that".
    const out = renderRenewPage(view());
    assert.match(out, /I have renewed it/);
  });
});

describe("renderRenewedPage", () => {
  it("states the NEW due date, which is the question a person actually has", () => {
    const out = renderRenewedPage(view(), "2026-10-06");
    assert.match(out, /Renewal recorded/);
    assert.match(out, /2026-10-06/);
    assert.match(out, /2026-09-06/); // renewed as of today
  });

  it("shows no date and prompts instead when the interval is unknown", () => {
    const out = renderRenewedPage(view({ intervalMonths: null }), null);
    assert.match(out, /No next due date can be shown/);
    assert.match(out, /Set it in the panel/);
  });

  it("shows the just-written date as last renewed, not the stale one", () => {
    // The page reflects what was written. A confirmation echoing the OLD date is
    // how a person concludes the button did not work and presses it again.
    const out = renderRenewedPage(view({ lastRenewedAt: "2026-08-10" }), "2026-10-06");
    assert.match(out, /Last renewed<\/dt><dd>2026-09-06/);
  });

  it("escapes the list name here too", () => {
    const out = renderRenewedPage(view({ listName: "<script>x</script>" }), "2026-10-06");
    assert.doesNotMatch(out, /<script>x/);
  });
});

describe("renderErrorPage", () => {
  it("renders a dead end with no detail and no token", () => {
    const out = renderErrorPage("Link not recognised", "This renewal link is not valid.");
    assert.match(out, /Link not recognised/);
    assert.doesNotMatch(out, new RegExp(TOKEN));
    assert.doesNotMatch(out, /<form/);
  });

  it("escapes its own arguments", () => {
    const out = renderErrorPage("<b>x</b>", "<i>y</i>");
    assert.doesNotMatch(out, /<b>x<\/b>/);
    assert.match(out, /&lt;b&gt;x&lt;\/b&gt;/);
  });
});
