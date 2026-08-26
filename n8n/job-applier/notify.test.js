/**
 * Tests for `notify.js`.
 *
 *   node --test notify.test.js
 *
 * Same posture as `extract.test.js` and `evaluate.test.js`: every case is either
 * a rule the pipeline depends on or a way a stranger-authored string could reach
 * somewhere it must not. There are no coverage-driven cases here.
 *
 * The heavy end is `validateRecipient` and `safeUrl`, because those two are the
 * only things standing between a scraped `mailto:` and an application mailed to
 * an address nobody chose.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  applySubject,
  buildDecisionEmail,
  clampLine,
  danishSignals,
  escapeHtml,
  looksDanish,
  pairedSourceIndex,
  safeUrl,
  sanitizeBlock,
  validateRecipient,
} from "./notify.js";

// MARK: - clampLine

test("clampLine strips CR and LF — a job title must not be able to add a header", () => {
  assert.equal(clampLine("Engineer\nBcc: everyone@example.com"), "Engineer Bcc: everyone@example.com");
  assert.equal(clampLine("Engineer\r\nX-Spam: no"), "Engineer X-Spam: no");
  assert.ok(!clampLine("a\u2028b").includes("\u2028"), "LINE SEPARATOR is a line break too");
});

test("clampLine collapses runs of whitespace and trims", () => {
  assert.equal(clampLine("  Senior   ML \t Engineer  "), "Senior ML Engineer");
});

test("clampLine truncates with an ellipsis rather than mid-word silence", () => {
  const out = clampLine("abcdefghij", 5);
  assert.equal(out.length, 5);
  assert.ok(out.endsWith("…"));
});

test("clampLine turns null and undefined into an empty string, never 'null'", () => {
  assert.equal(clampLine(null), "");
  assert.equal(clampLine(undefined), "");
  assert.equal(clampLine(0), "0");
});

// MARK: - sanitizeBlock

test("sanitizeBlock keeps the newlines and tabs a human wrote", () => {
  const body = "Kære Unity ApS,\n\n\tJeg skriver fordi…\n\nVenlig hilsen";
  assert.equal(sanitizeBlock(body), body);
});

test("sanitizeBlock normalises CRLF so pre-wrap does not render a box glyph", () => {
  assert.equal(sanitizeBlock("one\r\ntwo\rthree"), "one\ntwo\nthree");
});

test("sanitizeBlock removes zero-width and bidi characters", () => {
  const dirty = "Dear\u202Ehiring\u200B manager\uFEFF";
  const out = sanitizeBlock(dirty);
  assert.equal(out, "Dearhiring manager");
});

test("sanitizeBlock truncates a runaway body and says so", () => {
  const out = sanitizeBlock("x".repeat(50), 10);
  assert.ok(out.startsWith("xxxxxxxxxx\n\n["));
  assert.ok(out.includes("the stored draft is complete"));
});

// MARK: - escapeHtml

test("escapeHtml escapes all five characters that matter", () => {
  assert.equal(escapeHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("a script tag in a job title cannot survive into the email as markup", () => {
  const html = escapeHtml("<script>fetch('//evil')</script>");
  assert.ok(!html.includes("<script"), "raw tag reached the email body");
});

// MARK: - safeUrl

test("safeUrl accepts ordinary http and https", () => {
  assert.equal(safeUrl("https://www.jobindex.dk/vis-job/h1691819"), "https://www.jobindex.dk/vis-job/h1691819");
  assert.equal(safeUrl("http://example.dk/a?b=c#d"), "http://example.dk/a?b=c#d");
});

test("safeUrl refuses javascript: and data: — this is the one place an ad URL becomes clickable", () => {
  assert.equal(safeUrl("javascript:alert(1)"), null);
  assert.equal(safeUrl("JavaScript:alert(1)"), null);
  assert.equal(safeUrl("data:text/html,<script>x</script>"), null);
});

test("safeUrl refuses a scheme broken up by whitespace", () => {
  // clampLine collapses the newline to a space first, which is what makes the
  // scheme check see `java script:` rather than a valid scheme.
  assert.equal(safeUrl("java\nscript:alert(1)"), null);
  assert.equal(safeUrl("  https://ok.dk/x  "), "https://ok.dk/x");
});

test("safeUrl refuses a protocol-relative URL", () => {
  assert.equal(safeUrl("//evil.example/x"), null);
});

test("safeUrl refuses a URL long enough to be a payload", () => {
  assert.equal(safeUrl(`https://x.dk/${"a".repeat(3000)}`), null);
});

test("safeUrl returns null, not an empty string, for nothing", () => {
  assert.equal(safeUrl(""), null);
  assert.equal(safeUrl(null), null);
  assert.equal(safeUrl(undefined), null);
});

// MARK: - validateRecipient

test("validateRecipient accepts one plain address", () => {
  assert.equal(validateRecipient("job@unity.dk"), "job@unity.dk");
  assert.equal(validateRecipient(" hr@sub.example.co.uk "), "hr@sub.example.co.uk");
});

test("validateRecipient strips a mailto: prefix", () => {
  assert.equal(validateRecipient("mailto:hr@example.dk"), "hr@example.dk");
  assert.equal(validateRecipient("MAILTO:hr@example.dk"), "hr@example.dk");
});

test("validateRecipient drops a mailto query — a ?bcc= is the whole reason this function exists", () => {
  assert.equal(validateRecipient("mailto:hr@example.dk?bcc=evil@x.io&subject=hi"), "hr@example.dk");
});

test("validateRecipient refuses a comma or semicolon list", () => {
  assert.equal(validateRecipient("a@b.dk, c@d.dk"), null);
  assert.equal(validateRecipient("a@b.dk;c@d.dk"), null);
});

test("validateRecipient refuses the display-name form even though it is legal", () => {
  // Legal per RFC 5322 and refused anyway: angle brackets in an address that came
  // off a scraped page are a decision we decline to make automatically.
  assert.equal(validateRecipient("HR Team <hr@example.dk>"), null);
});

test("validateRecipient refuses an address that is not obviously an address", () => {
  assert.equal(validateRecipient("hr@example"), null);
  assert.equal(validateRecipient("hr@@example.dk"), null);
  assert.equal(validateRecipient("@example.dk"), null);
  assert.equal(validateRecipient("hr@.example.dk"), null);
  assert.equal(validateRecipient("hr@example..dk"), null);
  assert.equal(validateRecipient(".hr@example.dk"), null);
});

test("validateRecipient refuses embedded whitespace and quoting", () => {
  assert.equal(validateRecipient("hr @example.dk"), null);
  assert.equal(validateRecipient('"hr"@example.dk'), null);
  assert.equal(validateRecipient("hr@example.dk\nBcc: x@y.io"), null);
});

test("validateRecipient returns null for nothing at all", () => {
  assert.equal(validateRecipient(""), null);
  assert.equal(validateRecipient(null), null);
  assert.equal(validateRecipient(undefined), null);
});

// MARK: - looksDanish

const DANISH_BODY = [
  "Kære Unity ApS,",
  "",
  "Jeg skriver til jer, fordi stillingen som gameplay-programmør passer med",
  "den erfaring jeg har med Unity og C#.",
  "",
  "Venlig hilsen",
  "Bastian",
].join("\n");

const ENGLISH_BODY = [
  "Dear Unity ApS,",
  "",
  "I am writing about the gameplay programmer role. I have shipped two Unity",
  "titles and I work in C# every day.",
  "",
  "Best regards,",
  "Bastian",
].join("\n");

test("a Danish application body is detected", () => {
  assert.equal(looksDanish(DANISH_BODY), true);
});

test("an English application body is not", () => {
  assert.equal(looksDanish(ENGLISH_BODY), false);
});

test("an English body naming a Danish company does not flip to Danish", () => {
  // Ørsted twice: two æøå characters, zero Danish function words. The one-marker
  // rule requires a function word as well, precisely so this stays English.
  const body = ENGLISH_BODY.replace(/Unity ApS/g, "Ørsted").replace(/two Unity/, "two Ørsted");
  assert.equal(looksDanish(body), false);
});

test("a short Danish note still classifies", () => {
  assert.equal(looksDanish("Jeg søger stillingen hos jer."), true);
});

test("nothing is not Danish", () => {
  assert.equal(looksDanish(""), false);
  assert.equal(looksDanish(null), false);
  assert.equal(looksDanish(undefined), false);
});

test("danishSignals exposes the evidence behind the verdict", () => {
  const s = danishSignals(DANISH_BODY);
  assert.ok(s.hits >= 2, `expected ≥2 marker hits, got ${s.hits}`);
  assert.ok(s.daChars > 0);
  assert.ok(s.letters > 50);
});

// MARK: - applySubject

test("applySubject picks Ansøgning for a Danish body", () => {
  const subject = applySubject({ body: DANISH_BODY, posting: { title: "Gameplay Programmør" } });
  assert.equal(subject, "Ansøgning: Gameplay Programmør");
});

test("applySubject picks Application for an English body", () => {
  const subject = applySubject({ body: ENGLISH_BODY, posting: { title: "Gameplay Programmer" } });
  assert.equal(subject, "Application: Gameplay Programmer");
});

test("applySubject with no title is a bare word, not a dangling colon", () => {
  assert.equal(applySubject({ body: ENGLISH_BODY, posting: {} }), "Application");
  assert.equal(applySubject({}), "Application");
  assert.equal(applySubject(null), "Application");
});

test("applySubject cannot inject a mail header", () => {
  const subject = applySubject({
    body: ENGLISH_BODY,
    posting: { title: "Engineer\r\nBcc: everyone@example.com" },
  });
  assert.ok(!/[\r\n]/.test(subject), "a CR or LF reached the subject line");
  assert.equal(subject, "Application: Engineer Bcc: everyone@example.com");
});

test("applySubject bounds a runaway title", () => {
  const subject = applySubject({ body: "", posting: { title: "x".repeat(500) } });
  assert.ok(subject.length <= 180);
});

// MARK: - pairedSourceIndex

test("pairedSourceIndex unwraps every shape n8n uses", () => {
  assert.equal(pairedSourceIndex(3, 0), 3);
  assert.equal(pairedSourceIndex({ item: 2 }, 0), 2);
  assert.equal(pairedSourceIndex([{ item: 5 }], 0), 5);
  assert.equal(pairedSourceIndex([1], 0), 1);
});

test("pairedSourceIndex falls back to the positional index when nothing is paired", () => {
  // Correct whenever nothing failed, which is the common case.
  assert.equal(pairedSourceIndex(undefined, 4), 4);
  assert.equal(pairedSourceIndex(null, 0), 0);
  assert.equal(pairedSourceIndex({}, 7), 7);
  assert.equal(pairedSourceIndex([], 1), 1);
  assert.equal(pairedSourceIndex("nonsense", 2), 2);
});

// MARK: - buildDecisionEmail

const REVIEW_URL = "https://nexus.example.dk/jobs/approve/abc-123";
const AD_URL = "https://thehub.io/jobs/unity-gameplay";

function queued(overrides) {
  return {
    application_id: "app-abc-123",
    body: ENGLISH_BODY,
    missing_slots: [],
    score: 78,
    reasoning: "Unity and C# are both required and both present in the profile.",
    matched_skills: ["unity", "c#"],
    missing_skills: ["hlsl"],
    profile_name: "Games",
    posting: {
      title: "Gameplay Programmer",
      company: "Unity ApS",
      location: "København",
      url: AD_URL,
      apply_channel: "email",
      apply_email: "job@unity.dk",
      valid_through: "2026-09-30T00:00:00+02:00",
    },
    review_url: REVIEW_URL,
    ...overrides,
  };
}

function hrefs(html) {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
}

test("the subject carries score, title, company and profile", () => {
  const { subject } = buildDecisionEmail(queued());
  assert.equal(subject, "[Job 78] Gameplay Programmer — Unity ApS (Games)");
});

test("a missing company leaves no dangling em dash in the subject", () => {
  const { subject } = buildDecisionEmail(queued({ posting: { title: "Gameplay Programmer" } }));
  assert.equal(subject, "[Job 78] Gameplay Programmer (Games)");
  assert.ok(!subject.includes("—"));
});

test("a null score renders as ? rather than as 0", () => {
  // The same rule as mail `priority` and `blocking_state`: unscored is not zero.
  const { subject, html } = buildDecisionEmail(queued({ score: null }));
  assert.ok(subject.startsWith("[Job ?]"));
  assert.ok(!html.includes(">0<"), "a null score was rendered as a zero badge");
});

test("a non-integer score is rounded, not printed raw", () => {
  const { subject } = buildDecisionEmail(queued({ score: 77.6 }));
  assert.ok(subject.startsWith("[Job 78]"));
});

test("missing_slots produces a loud gap block naming every slot", () => {
  const { html, text } = buildDecisionEmail(queued({ missing_slots: ["closing", "motivation"] }));
  assert.ok(html.includes("This draft has gaps"), "no gap warning in the HTML");
  assert.ok(html.includes("closing, motivation"));
  assert.ok(html.includes("#c0392b"), "the gap block lost its alarm border");
  assert.ok(text.includes("!! THIS DRAFT HAS GAPS"));
});

test("no missing_slots means no gap block at all", () => {
  const { html, text } = buildDecisionEmail(queued({ missing_slots: [] }));
  assert.ok(!html.includes("This draft has gaps"));
  assert.ok(!text.includes("THIS DRAFT HAS GAPS"));
});

test("the full draft body is in the email, escaped and whitespace-preserved", () => {
  const body = "Dear <Unity> & co,\n\n  Two spaces indented.\n\nBest,\nBastian";
  const { html, text } = buildDecisionEmail(queued({ body }));
  assert.ok(html.includes("white-space:pre-wrap"), "paragraph breaks would collapse");
  assert.ok(html.includes("Dear &lt;Unity&gt; &amp; co,"), "the body was not escaped");
  assert.ok(html.includes("\n\n  Two spaces indented."), "the body was reflowed");
  assert.ok(text.includes(body), "the plain-text half dropped the draft");
});

test("the review link is one prominent button and is exactly the given URL", () => {
  const { html } = buildDecisionEmail(queued());
  assert.ok(html.includes(">Review &amp; decide</a>"));
  assert.ok(html.includes(`href="${REVIEW_URL}"`));
});

test("there are no one-click approve or reject links — only the ad and the confirm page", () => {
  // A mail scanner fetches every URL in a message before a human opens it. The
  // terminal action here is mailing a stranger, so no GET in this email may
  // change state. Exactly two hrefs: the ad, and the confirm page.
  const links = hrefs(buildDecisionEmail(queued()).html);
  assert.deepEqual(links.sort(), [AD_URL, REVIEW_URL].sort());
});

test("an unusable review_url becomes a warning, never an href", () => {
  const { html, text } = buildDecisionEmail(queued({ review_url: "javascript:approve()" }));
  assert.ok(!html.includes("javascript:"), "a javascript: URL reached an href");
  assert.ok(html.includes("nothing can be approved until that is fixed"));
  assert.ok(text.includes("nothing can be approved until that is fixed"));
  assert.deepEqual(hrefs(html), [AD_URL]);
});

test("an unusable ad URL is shown as refused text, not linked", () => {
  const posting = { ...queued().posting, url: "javascript:alert(1)" };
  const { html } = buildDecisionEmail(queued({ posting }));
  assert.deepEqual(hrefs(html), [REVIEW_URL]);
  assert.ok(html.includes("no usable link"));
  // The refused URL is echoed as escaped text, on purpose — otherwise "no usable
  // link" is undebuggable. What must not exist is an href pointing at it.
  assert.ok(!/href="javascript/i.test(html), "a javascript: URL reached an href");
  assert.ok(html.includes("refused: javascript:alert(1)"));
});

test("markup in a stranger-authored title cannot become markup in the email", () => {
  const posting = { ...queued().posting, title: '<img src=x onerror=alert(1)>"' };
  const { html } = buildDecisionEmail(queued({ posting }));
  assert.ok(!html.includes("<img"), "an injected tag reached the email");
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
});

test("the email loads no external assets", () => {
  // An email client that blocks remote content must still render this: the user
  // decides whether to apply for a job from it.
  const { html } = buildDecisionEmail(queued());
  assert.ok(!/<img\b/i.test(html));
  assert.ok(!/\bsrc=/i.test(html));
  assert.ok(!/url\(/i.test(html));
  assert.ok(!/<link\b|<style\b|<script\b/i.test(html));
});

test("a deadline is rendered as a date, not as a timestamp", () => {
  const { html, text } = buildDecisionEmail(queued());
  assert.ok(html.includes("2026-09-30"));
  assert.ok(!html.includes("T00:00:00"));
  assert.ok(text.includes("Deadline: 2026-09-30"));
});

test("no deadline means no deadline row", () => {
  const posting = { ...queued().posting, valid_through: null };
  const { html, text } = buildDecisionEmail(queued({ posting }));
  assert.ok(!html.includes("Deadline"));
  assert.ok(!text.includes("Deadline"));
});

test("matched and missing skills both reach the email", () => {
  const { html, text } = buildDecisionEmail(queued());
  assert.ok(html.includes(">unity<") && html.includes(">c#<"));
  assert.ok(html.includes(">hlsl<"));
  assert.equal(text.includes("Matched: unity, c#"), true);
  assert.equal(text.includes("Missing: hlsl"), true);
});

test("the application id is in the email so a reply can be traced to a row", () => {
  const { html, text } = buildDecisionEmail(queued());
  assert.ok(html.includes("app-abc-123"));
  assert.ok(text.includes("app-abc-123"));
});

test("buildDecisionEmail never throws on junk", () => {
  for (const input of [
    null,
    undefined,
    {},
    { posting: null, missing_slots: "nope", matched_skills: 4 },
    { score: "abc", body: 12, review_url: {}, posting: { title: {} } },
    { missing_slots: Array(500).fill("slot"), matched_skills: Array(500).fill("x") },
  ]) {
    const out = buildDecisionEmail(input);
    assert.equal(typeof out.subject, "string");
    assert.equal(typeof out.html, "string");
    assert.equal(typeof out.text, "string");
    assert.ok(out.html.length > 0);
    assert.ok(!/[\r\n]/.test(out.subject));
  }
});
