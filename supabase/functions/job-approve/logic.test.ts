/**
 * job-approve — pure-logic tests.
 *
 * Run:
 *
 *     node --test supabase/functions/job-approve/logic.test.ts
 *
 * # Why `node:test` and not `jsr:@std/assert` like the other three
 *
 * `n8n-ingest`, `n8n-requests` and `session-toggle` write Deno-style tests. There
 * is no Deno on this machine (CLAUDE.md's environment section: `supabase` itself
 * is only reachable through `npx`), so those three have never been executed here
 * — and a test that cannot be run is a comment with extra syntax.
 *
 * Node 24 strips TypeScript natively, so `node --test` runs this file as-is with
 * no build step, no transpile directory and no import rewriting. `logic.ts`
 * imports nothing at all, precisely so this works. Test files are never part of
 * `index.ts`'s import graph and so are never bundled into the deployed function.
 *
 * # What is tested, and why these things
 *
 * Every case below is a mistake that would be invisible: a state machine that
 * silently runs backwards, an escaping hole that only shows up when a company
 * name happens to contain a `<`, a form parser that reads a browser's POST as
 * empty. None of them fail a typecheck and none of them are visible in a
 * click-through with well-behaved data.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  deadlinePassed,
  decideTransition,
  describeStatus,
  escapeHtml,
  guardRows,
  isUuid,
  parseDecision,
  parseDecisionBody,
  renderResultPage,
  renderReviewPage,
  safeHref,
  type ApprovalView,
} from "./logic.ts";

const NOW = Date.parse("2026-08-26T12:00:00Z");
const TOKEN = "11111111-2222-4333-8444-555555555555";

const view = (over: Partial<ApprovalView> = {}): ApprovalView => ({
  status: "needs_approval",
  title: "AI Engineer",
  company: "Acme A/S",
  location: "København",
  postingUrl: "https://example.com/job/1",
  applyChannel: "email",
  applyEmail: "jobs@example.com",
  validThrough: "2026-12-01T00:00:00Z",
  profileName: "AI Engineering",
  score: 88,
  reasoning: "Strong overlap on Python and PyTorch.",
  matchedSkills: ["python", "pytorch"],
  missingSkills: ["kubernetes"],
  missingSlots: [],
  body: "Application: AI Engineer — Acme A/S\n\nDear team,",
  token: TOKEN,
  cvReady: true,
  nowMs: NOW,
  ...over,
});

// ---------------------------------------------------------------------------
describe("the transition matrix", () => {
  // The whole point of the state machine, enumerated. Every status that is not
  // `needs_approval` must be inert for BOTH decisions — that inertness is what
  // makes the token single-use, so it is asserted exhaustively rather than
  // spot-checked.
  const OTHER_STATUSES = [
    "draft",
    "approved",
    "queued",
    "submitted",
    "cancelled",
    "expired",
    "failed",
    "response",
    "",
    "NEEDS_APPROVAL", // case matters: the guard is an exact match
  ];

  it("approves a live posting", () => {
    assert.deepEqual(decideTransition("needs_approval", "approve", false), {
      next: "approved",
      outcome: "approved",
    });
  });

  it("expires instead of approving a closed posting", () => {
    assert.deepEqual(decideTransition("needs_approval", "approve", true), {
      next: "expired",
      outcome: "expired",
    });
  });

  it("rejects regardless of the deadline — a decision outranks a circumstance", () => {
    for (const passed of [false, true]) {
      assert.deepEqual(decideTransition("needs_approval", "reject", passed), {
        next: "cancelled",
        outcome: "rejected",
      });
    }
  });

  it("writes nothing from any other status", () => {
    for (const status of OTHER_STATUSES) {
      for (const decision of ["approve", "reject"] as const) {
        for (const passed of [false, true]) {
          const t = decideTransition(status, decision, passed);
          assert.equal(t.next, null, `${status} / ${decision} must not write`);
          assert.equal(t.outcome, "not_pending");
        }
      }
    }
  });

  it("treats a null or undefined status as not pending", () => {
    assert.equal(decideTransition(null, "approve", false).next, null);
    assert.equal(decideTransition(undefined, "approve", false).next, null);
  });

  it("names every status it can be handed", () => {
    for (const s of ["draft", "needs_approval", "approved", "queued", "submitted",
      "cancelled", "expired", "failed", "response"]) {
      assert.notEqual(
        describeStatus(s),
        describeStatus("something-else-entirely"),
        `${s} must not fall through to the unknown-status text`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
describe("deadlines", () => {
  it("does not treat a missing deadline as passed", () => {
    // The rule this file shares with job-ingest, `remote`, `score` and
    // `blocking_state`: unknown is never folded into a value.
    assert.equal(deadlinePassed(null, NOW), false);
    assert.equal(deadlinePassed(undefined, NOW), false);
    assert.equal(deadlinePassed("", NOW), false);
    assert.equal(deadlinePassed("   ", NOW), false);
    assert.equal(deadlinePassed("not a date", NOW), false);
    assert.equal(deadlinePassed(1756209600000, NOW), false); // not a string
  });

  it("compares real instants", () => {
    assert.equal(deadlinePassed("2026-08-25T00:00:00Z", NOW), true);
    assert.equal(deadlinePassed("2026-08-27T00:00:00Z", NOW), false);
  });
});

// ---------------------------------------------------------------------------
describe("escaping — everything on this page is stranger-written", () => {
  it("renders a script tag in a company name inert", () => {
    const html = renderReviewPage(view({ company: "<script>alert(1)</script>" }));
    assert.equal(html.includes("<script>"), false);
    assert.equal(html.includes("</script>"), false);
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("renders a script tag in the draft body inert", () => {
    const html = renderReviewPage(view({ body: "Dear <script>alert(1)</script> team" }));
    assert.equal(html.includes("<script>"), false);
    assert.ok(html.includes("&lt;script&gt;"));
  });

  it("renders markup in the model's reasoning inert", () => {
    const html = renderReviewPage(view({ reasoning: '"><img src=x onerror=alert(1)>' }));
    // Note what is and is not asserted: the literal text `onerror=alert(1)` DOES
    // survive into the page, and must — it is what the model wrote and the human
    // is entitled to read it. What must not survive is it being inside a tag.
    assert.equal(html.includes("<img"), false);
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });

  it("escapes quotes so an attribute cannot be broken out of", () => {
    // `token` is interpolated into a value="" attribute.
    const html = renderReviewPage(view({ token: '" autofocus onfocus="alert(1)' }));
    assert.equal(html.includes('onfocus="alert(1)"'), false);
    assert.ok(html.includes("&quot;"));
  });

  it("escapes all five characters, ampersand first", () => {
    assert.equal(escapeHtml("&<>\"'"), "&amp;&lt;&gt;&quot;&#39;");
    assert.equal(escapeHtml("&lt;"), "&amp;lt;", "must not double-decode");
  });

  it("renders a non-string as empty, never as the word null", () => {
    for (const v of [null, undefined, {}, [], true]) assert.equal(escapeHtml(v), "");
    assert.equal(escapeHtml(88), "88");
  });

  it("refuses a javascript: url — escaping alone would let it through", () => {
    assert.equal(safeHref("javascript:alert(1)"), null);
    assert.equal(safeHref("JaVaScRiPt:alert(1)"), null);
    assert.equal(safeHref("data:text/html,<script>"), null);
    assert.equal(safeHref("/relative"), null);
    assert.equal(safeHref("https://example.com/x?a=1&b=2"), "https://example.com/x?a=1&amp;b=2");
  });

  it("omits the posting link entirely when the url is not http(s)", () => {
    const html = renderReviewPage(view({ postingUrl: "javascript:alert(1)" }));
    assert.equal(html.includes("View the original posting"), false);
  });
});

// ---------------------------------------------------------------------------
describe("the review page", () => {
  it("offers both buttons only from needs_approval", () => {
    const html = renderReviewPage(view());
    assert.ok(html.includes('value="approve"'));
    assert.ok(html.includes('value="reject"'));
    // Scoped to the button, not the whole document — the stylesheet carries a
    // `button[disabled]` rule, so a bare substring search always matches.
    assert.equal(html.includes('value="approve" disabled'), false);
  });

  it("shows state instead of buttons once decided", () => {
    for (const status of ["approved", "queued", "submitted", "cancelled", "expired", "failed"]) {
      const html = renderReviewPage(view({ status }));
      assert.equal(html.includes('value="approve"'), false, `${status} must not offer approve`);
      assert.ok(html.includes("Nothing to decide"));
    }
  });

  it("disables approve but still renders the page when the deadline has passed", () => {
    const html = renderReviewPage(view({ validThrough: "2026-01-01T00:00:00Z" }));
    assert.ok(html.includes('value="approve" disabled'));
    assert.ok(html.includes('value="reject"'));
    assert.ok(html.includes("deadline on this posting has passed"));
  });

  it("submits by POST — a GET form would be approvable by a link prefetch", () => {
    // The code-review assertion this file can actually make mechanically. The
    // other half — that the GET handler holds no client — is enforced by
    // `renderReviewPage` being a pure (view) => string with no I/O in its
    // signature, which is why it lives in this dependency-free module at all.
    const html = renderReviewPage(view());
    assert.ok(html.includes('<form method="POST"'));
    assert.equal(/<form[^>]*method="GET"/i.test(html), false);
  });

  it("loads no external resource", () => {
    const html = renderReviewPage(view({ company: "Acme" }));
    assert.equal(/<script/i.test(html), false);
    assert.equal(/<link\b/i.test(html), false);
    assert.equal(/https?:\/\//.test(html.replace(/href="https?:\/\/[^"]*"/g, "")), false);
  });

  it("surfaces the unwritten sections when missing_slots is non-empty", () => {
    const html = renderReviewPage(view({ missingSlots: ["project", "cv_link"] }));
    assert.ok(html.includes("Unwritten sections"));
    assert.ok(html.includes("<li>project</li>"));
  });

  it("omits the gap card when nothing is missing", () => {
    assert.equal(renderReviewPage(view()).includes("Unwritten sections"), false);
  });
});

// ---------------------------------------------------------------------------
describe("the guard preview", () => {
  const byLabel = (v: ApprovalView, label: string) =>
    guardRows(v).find((g) => g.label === label)!;

  it("flags a body that still carries markers", () => {
    assert.equal(byLabel(view({ body: "a\n\n[GAP: no module for 'project']" }), "Draft complete").ok, false);
    assert.equal(byLabel(view({ body: "see my cv: [TODO]" }), "Draft complete").ok, false);
    assert.equal(byLabel(view(), "Draft complete").ok, true);
  });

  it("flags a non-email channel and a missing address", () => {
    assert.equal(byLabel(view({ applyChannel: "ats" }), "Email channel").ok, false);
    assert.equal(byLabel(view({ applyEmail: "  " }), "Email channel").ok, false);
    assert.equal(byLabel(view({ applyChannel: "EMAIL" }), "Email channel").ok, true);
  });

  it("flags a missing CV", () => {
    assert.equal(byLabel(view({ cvReady: false }), "CV link ready").ok, false);
  });

  it("does not flag a posting with no deadline", () => {
    assert.equal(byLabel(view({ validThrough: null }), "Deadline").ok, true);
  });
});

// ---------------------------------------------------------------------------
describe("the result page", () => {
  it("names the outcome", () => {
    assert.ok(renderResultPage("approved", view({ status: "approved" })).includes("Approved"));
    assert.ok(renderResultPage("rejected", view({ status: "cancelled" })).includes("Rejected"));
    assert.ok(renderResultPage("expired", view({ status: "expired" })).includes("Too late"));
    assert.ok(
      renderResultPage("not_pending", view({ status: "submitted" })).includes("Already sent"),
    );
  });

  it("escapes the company on the confirmation too", () => {
    const html = renderResultPage("approved", view({ company: "<b>x</b>" }));
    assert.equal(html.includes("<b>x</b>"), false);
  });
});

// ---------------------------------------------------------------------------
describe("reading the POST body", () => {
  it("reads what a browser form actually sends", () => {
    const r = parseDecisionBody(
      "application/x-www-form-urlencoded; charset=UTF-8",
      `token=${TOKEN}&decision=approve`,
    );
    assert.deepEqual(r, { ok: true, request: { token: TOKEN, decision: "approve" } });
  });

  it("reads JSON", () => {
    const r = parseDecisionBody(
      "application/json",
      JSON.stringify({ token: TOKEN, decision: "reject" }),
    );
    assert.deepEqual(r, { ok: true, request: { token: TOKEN, decision: "reject" } });
  });

  it("reads JSON with no content type at all", () => {
    const r = parseDecisionBody(null, JSON.stringify({ token: TOKEN, decision: "approve" }));
    assert.equal(r.ok, true);
  });

  it("rejects a token that is not a uuid", () => {
    assert.deepEqual(parseDecisionBody(null, "token=abc&decision=approve"), {
      ok: false,
      error: "invalid_token",
    });
  });

  it("rejects a decision that is not one of the two", () => {
    for (const d of ["Approve", "yes", "delete", ""]) {
      const r = parseDecisionBody(null, `token=${TOKEN}&decision=${d}`);
      assert.equal(r.ok, false, `"${d}" must not be accepted`);
    }
  });

  it("rejects an empty body", () => {
    assert.deepEqual(parseDecisionBody(null, ""), { ok: false, error: "empty_body" });
    assert.equal(parseDecisionBody(null, undefined).ok, false);
  });

  it("does not accept extra fields as instructions", () => {
    const r = parseDecisionBody(
      "application/json",
      JSON.stringify({ token: TOKEN, decision: "approve", status: "submitted", user_id: "x" }),
    );
    assert.ok(r.ok);
    assert.deepEqual(Object.keys(r.request).sort(), ["decision", "token"]);
  });
});

// ---------------------------------------------------------------------------
describe("small guards", () => {
  it("validates uuids", () => {
    assert.equal(isUuid(TOKEN), true);
    assert.equal(isUuid(TOKEN.toUpperCase()), true);
    assert.equal(isUuid(`${TOKEN} `), false);
    assert.equal(isUuid(TOKEN.slice(0, -1)), false);
    assert.equal(isUuid(null), false);
  });

  it("parses only the two decisions", () => {
    assert.equal(parseDecision("approve"), "approve");
    assert.equal(parseDecision("reject"), "reject");
    assert.equal(parseDecision("APPROVE"), null);
    assert.equal(parseDecision(true), null);
  });
});
