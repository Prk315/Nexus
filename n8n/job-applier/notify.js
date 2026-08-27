/**
 * Decision emails and outbound application framing — pure, dependency-free.
 *
 * Inlined verbatim into the Code nodes of `job-notify` and `job-apply` by
 * `build-apply.mjs`, exactly as `extract.js` and `evaluate.js` are by their own
 * builders. No imports, top-level `export function` only: the build step strips
 * the `export ` prefixes and nothing else, which is what keeps that transform
 * small enough to be obviously correct.
 *
 * # Two emails, and only one of them is safe to get wrong
 *
 * `buildDecisionEmail` writes to **the user's own inbox**. It can be ugly, it can
 * be wrong, it can be resent — the cost is one bad-looking email.
 *
 * `applySubject` / `validateRecipient` frame an email that goes to **a real
 * company**, once, unretractably. There is no draft folder and no undo. So the
 * rules here are deliberately asymmetric: the decision email interpolates
 * everything it is given (escaped), while the outbound path *refuses* anything it
 * does not positively recognise. A refusal is recoverable — the row is marked
 * failed and a human looks at it. A send to the wrong address is not.
 *
 * # Everything interpolated is stranger-authored
 *
 * Job titles, company names, locations and the ad URL all come from a page some
 * third party wrote. They reach an HTML email body and a mail header. So:
 *
 * - `escapeHtml` on every single interpolation. No exceptions, including the
 *   fields that "obviously" hold a number.
 * - `clampLine` strips CR/LF before anything reaches a subject line. A newline in
 *   a header is header injection, and a job title is an attacker-controlled
 *   string that we put in a header.
 * - `safeUrl` refuses anything that is not `http(s)://…`, so a `javascript:` or
 *   `data:` URL scraped off an ad cannot become an `href` in an email the user
 *   is being invited to click a button in.
 *
 * None of this is theoretical politeness: `extract.js` pulls `url` and `title`
 * straight out of markup written by whoever posted the ad.
 */

// MARK: - Limits
//
// Bounds, not politeness. A subject line is a header, an href is a header-shaped
// thing, and an unbounded draft body in an HTML email is a 4 MB message Gmail
// clips halfway through the part the user needs to read.

/** Mail subject. Well under the 998-octet line limit even after UTF-8 expansion. */
const MAX_SUBJECT_CHARS = 180;

/** Job title inside a subject. Leaves room for score, company and profile. */
const MAX_TITLE_CHARS = 120;

/** Anything rendered as a single line of the facts table. */
const MAX_FIELD_CHARS = 200;

/** The model's reasoning paragraph. Matches `evaluate.js`'s own bound. */
const MAX_REASONING_CHARS = 1000;

/** Draft body rendered into the decision email. Gmail clips around 102 kB. */
const MAX_BODY_CHARS = 20000;

/** An href. Longer than this and it is not a URL, it is a payload. */
const MAX_URL_CHARS = 2000;

/** RFC 5321 caps a path at 256 octets; 320 is the usual practical address bound. */
const MAX_EMAIL_CHARS = 320;

/** Skill/slot chips per row. More than this and the list is noise anyway. */
const MAX_CHIPS = 30;

// MARK: - Small helpers

// C0/C1 controls, zero-width joiners, the bidi overrides and the BOM. Written as
// \u escapes because a literal bidi override in source is, by construction,
// invisible — and a mangled character class here is what lets a CR through into
// a mail header.
const CONTROL_CHARS =
  /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Everything the control class kills, plus the newlines a single line may not hold. */
const LINE_KILLERS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/**
 * Collapse a value to one printable line, bounded.
 *
 * The CR/LF strip is the load-bearing part: this is the last thing that touches a
 * string before it becomes a mail subject, and `Subject: Engineer\nBcc: …` is a
 * job title away.
 */
export function clampLine(value, max = MAX_FIELD_CHARS) {
  const s = String(value === null || value === undefined ? "" : value)
    .replace(LINE_KILLERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/**
 * Clean a multi-line block, keeping newlines and tabs.
 *
 * Used for the draft body, which is human prose whose paragraph breaks are the
 * whole point. CRLF is normalised so `white-space: pre-wrap` does not render a
 * stray carriage return as a box glyph in some clients.
 */
export function sanitizeBlock(value, max = MAX_BODY_CHARS) {
  const s = String(value === null || value === undefined ? "" : value)
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "");
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n\n[…truncated for this email — the stored draft is complete]`;
}

/** HTML entity-escape. Applied to every interpolation without exception. */
export function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Return the value only if it is an ordinary http(s) URL, else null.
 *
 * A caller that gets null must render text, not a link. `javascript:`, `data:`
 * and protocol-relative `//host` are all rejected — the ad URL comes out of
 * stranger-authored markup, and this is the one place it becomes clickable.
 */
export function safeUrl(value) {
  const raw = String(value === null || value === undefined ? "" : value);
  if (raw.length > MAX_URL_CHARS) return null;
  const s = clampLine(raw, MAX_URL_CHARS);
  if (!s) return null;
  if (!/^https?:\/\/[^\s<>"']+$/i.test(s)) return null;
  return s;
}

/**
 * Normalise an application recipient, or null if it is not unambiguously one
 * plain address.
 *
 * Deliberately stricter than any RFC. `Name <a@b.dk>` is a legal address and is
 * refused anyway, as is anything containing a comma or semicolon: those are the
 * two characters that turn one recipient into several, and this address arrives
 * from a scraped `mailto:` on a page nobody here controls. Being refused costs a
 * row marked failed and a glance from a human. Being permissive costs an
 * application mailed to a list.
 */
export function validateRecipient(value) {
  let s = clampLine(value, MAX_EMAIL_CHARS + 8);
  if (!s) return null;
  // A stored `mailto:hr@example.dk?subject=…` is a link, not an address. Take the
  // address and drop the query — a `?bcc=` in a mailto is exactly the trick this
  // function exists to refuse.
  const m = /^mailto:([^?]*)/i.exec(s);
  if (m) s = m[1].trim();
  if (!s || s.length > MAX_EMAIL_CHARS) return null;
  if (/[,;<>"'\s\\]/.test(s)) return null;
  if (!/^[^@]+@[^@]+\.[^@.\s]+$/.test(s)) return null;
  if (s.includes("..")) return null;
  // Check the two halves separately. Testing the whole string for a leading or
  // trailing dot misses `hr@.example.dk`, which is the shape a naive
  // `mailto:` join produces and which a permissive check waves through.
  const [local, domain] = s.split("@");
  for (const half of [local, domain]) {
    if (!half || half.startsWith(".") || half.endsWith(".")) return null;
  }
  return s;
}

// MARK: - Language detection

// Function words that are Danish and are not also English words. "for", "en",
// "man" and "under" are all shared and would fire on an English draft, so they
// are not here. This list is short on purpose: it decides one word of a subject
// line, and a dumb rule that is wrong in an obvious direction beats a clever one
// that is wrong in a surprising one.
const DANISH_MARKERS = [
  "jeg",
  "og",
  "til",
  "med",
  "som",
  "ikke",
  "på",
  "hos",
  "mine",
  "mit",
  "stilling",
  "ansøgning",
  "erfaring",
  "hilsen",
  "venlig",
  "arbejde",
  "virksomhed",
  "kompetencer",
  "erfaringer",
  "opslag",
];

/**
 * Signals behind `looksDanish`, exposed so a test can assert on the evidence
 * rather than only on the verdict.
 */
export function danishSignals(text) {
  const lower = String(text === null || text === undefined ? "" : text).toLowerCase();
  // Replace every non-letter with a space so markers can be matched as whole
  // words by substring. \p{L} keeps æøå, which is the entire point.
  const words = ` ${lower.replace(/[^\p{L}]+/gu, " ")} `;
  let hits = 0;
  for (const w of DANISH_MARKERS) {
    if (words.includes(` ${w} `)) hits++;
  }
  const letters = (lower.match(/\p{L}/gu) || []).length;
  const daChars = (lower.match(/[æøå]/g) || []).length;
  return { hits, letters, daChars };
}

/**
 * Is this application body written in Danish?
 *
 * Two independent function words, or one plus a couple of æ/ø/å. The one-marker
 * bar exists so a short Danish note still classifies; the two-æøå bar exists so
 * an English application to Ørsted that names the company twice does not. This
 * only picks between "Ansøgning:" and "Application:" in a subject line — getting
 * it wrong is a cosmetic embarrassment, not a failure, so it stays this dumb
 * rather than growing a model.
 */
export function looksDanish(text) {
  const { hits, daChars } = danishSignals(text);
  if (hits >= 2) return true;
  return hits >= 1 && daChars >= 2;
}

/**
 * Subject for an outbound application: `Ansøgning: <title>` or
 * `Application: <title>`, decided by the language of the body a human wrote.
 */
export function applySubject(item) {
  const it = item || {};
  const posting = it.posting || {};
  const title = clampLine(posting.title, MAX_TITLE_CHARS);
  const word = looksDanish(it.body) ? "Ansøgning" : "Application";
  return clampLine(title ? `${word}: ${title}` : word, MAX_SUBJECT_CHARS);
}

// MARK: - Item pairing across an error output

/**
 * Which upstream item produced this one.
 *
 * A node with `onError: continueErrorOutput` splits its items across two
 * outputs, so output 0's index `i` is **not** upstream index `i` the moment one
 * send fails — and pairing a Gmail message id to the wrong `application_id`
 * marks the wrong row sent. n8n records the real answer in `pairedItem`; this
 * unwraps its three shapes (number, `{item}`, array of `{item}`) and falls back
 * to the positional index, which is correct whenever nothing failed.
 */
export function pairedSourceIndex(pairedItem, fallback) {
  const fb = Number.isInteger(fallback) ? fallback : 0;
  if (Number.isInteger(pairedItem)) return pairedItem;
  if (pairedItem && Number.isInteger(pairedItem.item)) return pairedItem.item;
  if (Array.isArray(pairedItem) && pairedItem.length) {
    const first = pairedItem[0];
    if (Number.isInteger(first)) return first;
    if (first && Number.isInteger(first.item)) return first.item;
  }
  return fb;
}

// MARK: - The decision email

/** Bounded, escaped chip list. Returns null when there is nothing to show. */
function chips(values, tone) {
  const list = Array.isArray(values) ? values : [];
  const cleaned = [];
  for (const v of list) {
    const s = clampLine(v, 64);
    if (s) cleaned.push(s);
    if (cleaned.length >= MAX_CHIPS) break;
  }
  if (!cleaned.length) return null;
  const style =
    tone === "good"
      ? "background:#e6f4ea;color:#14683a;border:1px solid #b7e0c4;"
      : "background:#f1f2f4;color:#4a4f57;border:1px solid #dcdfe4;";
  return cleaned
    .map(
      (s) =>
        `<span style="display:inline-block;${style}border-radius:999px;padding:3px 10px;margin:0 6px 6px 0;font-size:13px;line-height:18px;">${escapeHtml(
          s,
        )}</span>`,
    )
    .join("");
}

/** Plain-text chip list, same bounds. */
function chipsText(values) {
  const list = Array.isArray(values) ? values : [];
  const cleaned = [];
  for (const v of list) {
    const s = clampLine(v, 64);
    if (s) cleaned.push(s);
    if (cleaned.length >= MAX_CHIPS) break;
  }
  return cleaned.length ? cleaned.join(", ") : "—";
}

/** `2026-09-30T00:00:00Z` → `2026-09-30`; anything else clamped as a line. */
function formatDeadline(value) {
  const s = clampLine(value, 64);
  if (!s) return "";
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s;
}

/** Colour band for the score badge. Cosmetic; the number is the real signal. */
function scoreTone(score) {
  if (score === null) return { bg: "#f1f2f4", fg: "#4a4f57" };
  if (score >= 80) return { bg: "#14683a", fg: "#ffffff" };
  if (score >= 60) return { bg: "#8a5a00", fg: "#ffffff" };
  return { bg: "#5b6068", fg: "#ffffff" };
}

function factRow(label, valueHtml) {
  return (
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(
      label,
    )}</td>` + `<td style="padding:4px 0;font-size:13px;color:#16181d;">${valueHtml}</td></tr>`
  );
}

/**
 * Build the decision email for one queued application.
 *
 * Returns `{ subject, html, text }`. The HTML is table-and-inline-style only,
 * with no external assets: an email client that blocks remote content must still
 * render this correctly, because the user decides whether to apply for a job
 * from it.
 *
 * The `text` half is a genuine plain-text alternative, not a stub. n8n's Gmail
 * node sends a single body part, so today only the HTML is transmitted — but the
 * text is what a raw-MIME sender would attach as `text/plain`, and having it lets
 * the tests pin the *content* of the email independently of its markup.
 */
export function buildDecisionEmail(item) {
  const it = item || {};
  const posting = it.posting || {};

  // `Number(null)` is 0 and `Number("")` is 0, so a bare `Number.isFinite` check
  // renders an *unscored* row as a confident zero — the same collapse as seeding
  // `blocking_state` or defaulting mail `priority` to 0. Missing must stay
  // visibly missing, so the guard is on the value before the coercion.
  const hasScore =
    it.score !== null && it.score !== undefined && it.score !== "" && Number.isFinite(Number(it.score));
  const score = hasScore ? Math.round(Number(it.score)) : null;
  const title = clampLine(posting.title, MAX_TITLE_CHARS) || "(untitled posting)";
  const company = clampLine(posting.company, MAX_FIELD_CHARS);
  const location = clampLine(posting.location, MAX_FIELD_CHARS);
  const profile = clampLine(it.profile_name, 64);
  const channel = clampLine(posting.apply_channel, 64);
  const applyEmail = clampLine(posting.apply_email, MAX_EMAIL_CHARS);
  const deadline = formatDeadline(posting.valid_through);
  const reasoning = clampLine(it.reasoning, MAX_REASONING_CHARS);
  const body = sanitizeBlock(it.body);
  const adUrl = safeUrl(posting.url);
  const reviewUrl = safeUrl(it.review_url);
  const applicationId = clampLine(it.application_id, 64);

  const gaps = (Array.isArray(it.missing_slots) ? it.missing_slots : [])
    .map((s) => clampLine(s, 64))
    .filter(Boolean)
    .slice(0, MAX_CHIPS);

  // --- subject -------------------------------------------------------------
  let subject = `[Job ${score === null ? "?" : score}] ${title}`;
  // No dangling em dash when the company is unknown — the same rule
  // `assembleApplication` follows for the draft's own header line.
  if (company) subject += ` — ${company}`;
  if (profile) subject += ` (${profile})`;
  subject = clampLine(subject, MAX_SUBJECT_CHARS);

  // --- html ----------------------------------------------------------------
  const tone = scoreTone(score);
  const parts = [];

  parts.push(
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background:#f4f5f7;margin:0;padding:24px 0;"><tr><td align="center" style="padding:0 12px;">' +
      '<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" ' +
      'style="width:100%;max-width:640px;background:#ffffff;border:1px solid #e3e6ea;border-radius:12px;' +
      'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;' +
      'color:#16181d;text-align:left;">',
  );

  // Header: score, title, company, profile.
  parts.push(
    '<tr><td style="padding:22px 24px 16px 24px;border-bottom:1px solid #eceef1;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>' +
      `<td width="72" valign="top" style="padding-right:14px;">` +
      `<div style="background:${tone.bg};color:${tone.fg};border-radius:10px;text-align:center;padding:10px 0;">` +
      `<div style="font-size:24px;font-weight:700;line-height:26px;">${escapeHtml(
        score === null ? "?" : String(score),
      )}</div>` +
      '<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.85;">score</div>' +
      "</div></td>" +
      '<td valign="top">' +
      `<div style="font-size:18px;font-weight:700;line-height:24px;">${escapeHtml(title)}</div>` +
      `<div style="font-size:14px;color:#5b6068;margin-top:4px;">${escapeHtml(
        [company, location].filter(Boolean).join(" · ") || "—",
      )}</div>` +
      (profile
        ? `<div style="font-size:12px;color:#6b7280;margin-top:6px;">profile: ${escapeHtml(profile)}</div>`
        : "") +
      "</td></tr></table></td></tr>",
  );

  if (reasoning) {
    parts.push(
      '<tr><td style="padding:16px 24px 0 24px;">' +
        '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">why this score</div>' +
        `<div style="font-size:14px;line-height:21px;color:#33383f;">${escapeHtml(reasoning)}</div>` +
        "</td></tr>",
    );
  }

  // The gap block. Loud on purpose: a draft with an unfilled slot carries a
  // literal `[GAP: …]` line, and the whole point of not letting a 7B model write
  // prose is that a gap stays visible instead of being papered over.
  if (gaps.length) {
    parts.push(
      '<tr><td style="padding:16px 24px 0 24px;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
        'style="background:#fdecea;border:2px solid #c0392b;border-radius:10px;"><tr>' +
        '<td style="padding:14px 16px;">' +
        '<div style="font-size:14px;font-weight:700;color:#8e2318;line-height:20px;">' +
        "⚠ This draft has gaps — resolve before it can ever be sent</div>" +
        '<div style="font-size:13px;color:#8e2318;margin-top:6px;line-height:19px;">' +
        `No module covers: <strong>${escapeHtml(gaps.join(", "))}</strong>. ` +
        "The draft below carries a literal <code>[GAP: …]</code> line where each one belongs. " +
        "Write the missing module (or edit the draft) — nothing here is filled in for you." +
        "</div></td></tr></table></td></tr>",
    );
  }

  const matched = chips(it.matched_skills, "good");
  const missing = chips(it.missing_skills, "muted");
  if (matched || missing) {
    parts.push(
      '<tr><td style="padding:16px 24px 0 24px;">' +
        (matched
          ? '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">matched</div>' +
            `<div style="margin-bottom:10px;">${matched}</div>`
          : "") +
        (missing
          ? '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">missing</div>' +
            `<div>${missing}</div>`
          : "") +
        "</td></tr>",
    );
  }

  // The draft, verbatim. `pre-wrap` keeps the paragraph breaks a human wrote;
  // long lines still wrap, because a horizontal scrollbar in an email client is
  // a body nobody reads.
  parts.push(
    '<tr><td style="padding:18px 24px 0 24px;">' +
      '<div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;margin-bottom:6px;">the draft, in full</div>' +
      '<div style="background:#fafbfc;border:1px solid #e3e6ea;border-radius:10px;padding:16px 18px;' +
      "font-size:14px;line-height:22px;color:#16181d;white-space:pre-wrap;word-break:break-word;" +
      `font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${escapeHtml(
        body,
      )}</div></td></tr>`,
  );

  // Posting facts.
  const facts = [];
  if (company) facts.push(factRow("Company", escapeHtml(company)));
  if (location) facts.push(factRow("Location", escapeHtml(location)));
  if (channel) facts.push(factRow("Channel", escapeHtml(channel)));
  if (applyEmail) facts.push(factRow("Apply to", escapeHtml(applyEmail)));
  if (deadline) {
    facts.push(
      factRow("Deadline", `<strong style="color:#8e2318;">${escapeHtml(deadline)}</strong>`),
    );
  }
  facts.push(
    factRow(
      "Ad",
      adUrl
        ? `<a href="${escapeHtml(adUrl)}" style="color:#2f6feb;">${escapeHtml(adUrl)}</a>`
        : `<span style="color:#8e2318;">no usable link${
            posting.url ? ` (refused: ${escapeHtml(clampLine(posting.url, 120))})` : ""
          }</span>`,
    ),
  );
  parts.push(
    '<tr><td style="padding:18px 24px 0 24px;">' +
      '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' +
      facts.join("") +
      "</table></td></tr>",
  );

  // The one action. There is deliberately no "approve" and no "reject" link in
  // this email, and that is a security decision rather than a UX one: mail
  // scanners, link-preview bots and Gmail's own image proxy fetch URLs found in
  // a message *before a human ever opens it*. A GET that approves is therefore a
  // GET that an antivirus appliance can fire on your behalf at 03:00 — and this
  // pipeline's terminal action is mailing a stranger. So the email links to a
  // confirm page and nothing else; the state change happens behind a POST that a
  // person pressed a button for. Do not "simplify" this into one-click links.
  parts.push(
    '<tr><td style="padding:22px 24px 24px 24px;">' +
      (reviewUrl
        ? `<a href="${escapeHtml(reviewUrl)}" ` +
          'style="display:inline-block;background:#2f6feb;color:#ffffff;font-size:15px;font-weight:600;' +
          'padding:13px 26px;border-radius:8px;text-decoration:none;">Review &amp; decide</a>' +
          '<div style="font-size:12px;color:#6b7280;margin-top:10px;line-height:18px;">' +
          "Approving happens on that page, not in this email — a link that approves is a link a " +
          "mail scanner can click for you." +
          "</div>"
        : '<div style="font-size:13px;color:#8e2318;font-weight:600;">' +
          "No usable review link on this row — nothing can be approved until that is fixed." +
          "</div>") +
      "</td></tr>",
  );

  parts.push(
    '<tr><td style="padding:0 24px 20px 24px;border-top:1px solid #eceef1;">' +
      `<div style="font-size:11px;color:#9aa0a6;padding-top:12px;">application ${escapeHtml(
        applicationId || "(unknown)",
      )} · nothing is sent until you approve it</div>` +
      "</td></tr>",
  );

  parts.push("</table></td></tr></table>");
  const html = parts.join("");

  // --- text ----------------------------------------------------------------
  const textLines = [];
  textLines.push(`Score ${score === null ? "?" : score}/100 — ${title}`);
  const where = [company, location].filter(Boolean).join(" · ");
  if (where) textLines.push(where);
  if (profile) textLines.push(`Profile: ${profile}`);
  textLines.push("");
  if (reasoning) {
    textLines.push(reasoning, "");
  }
  if (gaps.length) {
    textLines.push(
      "!! THIS DRAFT HAS GAPS — resolve before it can ever be sent.",
      `   No module covers: ${gaps.join(", ")}`,
      "",
    );
  }
  textLines.push(`Matched: ${chipsText(it.matched_skills)}`);
  textLines.push(`Missing: ${chipsText(it.missing_skills)}`);
  textLines.push("");
  textLines.push("--- draft ---");
  textLines.push(body);
  textLines.push("--- end draft ---");
  textLines.push("");
  if (channel) textLines.push(`Channel:  ${channel}`);
  if (applyEmail) textLines.push(`Apply to: ${applyEmail}`);
  if (deadline) textLines.push(`Deadline: ${deadline}`);
  textLines.push(`Ad:       ${adUrl || "(no usable link)"}`);
  textLines.push("");
  textLines.push(
    reviewUrl
      ? `Review & decide: ${reviewUrl}`
      : "No usable review link on this row — nothing can be approved until that is fixed.",
  );
  textLines.push(
    "(One link, to a confirm page. A link that approves is a link a mail scanner can click for you.)",
  );
  textLines.push(`application ${applicationId || "(unknown)"}`);

  return { subject, html, text: textLines.join("\n") };
}
