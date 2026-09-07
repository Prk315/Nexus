/**
 * Listing-alert emails — pure, dependency-free.
 *
 * Inlined verbatim into the Code nodes of `housing-notify` by `build-housing.mjs`,
 * exactly as `notify.js` is into the two job workflows by `build-apply.mjs`. No
 * imports, top-level `export function` only: the build step strips the `export `
 * prefixes and nothing else, which is what keeps that transform small enough to
 * be obviously correct.
 *
 * # This is not the job decision email, and the difference is the whole design
 *
 * `n8n/job-applier/notify.js` writes an email whose purpose is a **decision**: it
 * carries a score, the model's reasoning, a full draft, and a single link to a
 * confirm page — deliberately *not* an approve link, because a mail scanner can
 * fetch a URL before a human ever opens the message, and the pipeline's terminal
 * action is mailing a stranger.
 *
 * This email's purpose is a **race**. `HOUSING_PLAN.md` §2: a private listing's
 * useful life is measured in hours, "38 min. siden" is a normal top-of-list value,
 * and the only action that matters is opening the portal and writing to the
 * landlord before forty other people do. So:
 *
 *   - **Age is the headline**, above the title, in the largest type on the page.
 *   - **One big link, straight to the listing.** That link is a plain GET of a
 *     public read-only page on a third-party portal. Nothing is approved, nothing
 *     is sent, no state changes. The job pipeline's "no clickable action in an
 *     email" rule is about *state-changing* links and does not apply here; adding
 *     a confirm-page hop would cost seconds in the one email where seconds are
 *     the product.
 *   - **No approve/reject and no score.** There is nothing to approve. The system
 *     never contacts a portal — `HOUSING_PLAN.md` §5: "the pipeline may read
 *     anywhere it is permitted and may compose anything, but it submits nothing
 *     to a third-party portal."
 *
 * # Everything interpolated is stranger-authored
 *
 * Titles, addresses and the listing URL come out of markup somebody else wrote
 * and end up in an HTML body and a mail header. So `escapeHtml` on every single
 * interpolation without exception, `clampLine` (which strips CR/LF) before
 * anything reaches a subject, and `safeUrl` so a `javascript:` or `data:` URL
 * scraped off a page cannot become the href of the one big button this email is
 * built around.
 */

// MARK: - Limits
//
// Bounds, not politeness. A subject line is a header, and an unbounded body in an
// HTML email is a message Gmail clips through the part you need to read.

/** Mail subject. Well under the 998-octet line limit even after UTF-8 expansion. */
const MAX_SUBJECT_CHARS = 180;

/** Listing title inside a subject. Leaves room for the rent and the address. */
const MAX_TITLE_CHARS = 90;

/** Anything rendered as one line of the facts row. */
const MAX_FIELD_CHARS = 200;

/** An href. Longer than this and it is not a URL, it is a payload. */
const MAX_URL_CHARS = 2000;

// C0/C1 controls, zero-width joiners, the bidi overrides and the BOM. Written as
// \u escapes because a literal bidi override in source is, by construction,
// invisible — and a mangled character class here is what lets a CR into a header.
const LINE_KILLERS =
  /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028\u2029\u202A-\u202E\u2066-\u2069\uFEFF]/g;

// MARK: - Small helpers

/**
 * Collapse a value to one printable line, bounded.
 *
 * The CR/LF strip is the load-bearing part: this is the last thing that touches a
 * string before it becomes a mail subject, and `Subject: Lejlighed\nBcc: …` is one
 * listing title away.
 */
export function clampLine(value, max = MAX_FIELD_CHARS) {
  const s = String(value === null || value === undefined ? "" : value)
    .replace(LINE_KILLERS, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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
 * and protocol-relative `//host` are all rejected. This matters more here than in
 * the job email: that one's button goes to our own confirm page, this one's goes
 * to a URL scraped off a stranger's markup, and it is the email's only action.
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
 * Which upstream item produced this one.
 *
 * A node with `onError: continueErrorOutput` splits its items across two outputs,
 * so output 0's index `i` is **not** upstream index `i` the moment one send fails
 * — and pairing a Gmail message id to the wrong `listing_id` marks the wrong row
 * notified, which on this pipeline means a listing you were never told about is
 * recorded as one you were. n8n records the real answer in `pairedItem`; this
 * unwraps its three shapes (number, `{item}`, array of `{item}`) and falls back to
 * the positional index, which is correct whenever nothing failed.
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

// MARK: - Numbers

/**
 * `8950` → `"8.950"`. Danish grouping, because the rent is quoted in kroner in
 * every source and every portal, and an English `8,950` next to a Danish `21.800`
 * in the same inbox is a misreading waiting to happen.
 *
 * Returns null for anything that is not a finite number — **including null and
 * `""`**, which `Number()` would helpfully turn into `0`. A rent rendered as
 * "0 kr." is not a cheap flat, it is a missing field, and this email exists to
 * make him act fast on what it says.
 */
export function formatDkk(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** `2.3` → `"2,3 km"`, Danish decimal comma. Null in, null out. */
export function formatKm(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return `${n.toFixed(1).replace(".", ",")} km`;
}

// MARK: - Age — the headline of this email

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * How old a listing is, as `{ minutes, label, tone, known }`.
 *
 * ## `known: false` is not "just now"
 *
 * A listing with no `posted_at`, or with one that does not parse, has an
 * **unknown** age. It is rendered "age unknown" in grey, never as "0 min" and
 * never as "just now".
 *
 * This is the house rule (`blocking_state` was deliberately never seeded; mail
 * `score` is nullable so untriaged mail sorts to the top rather than to the
 * bottom where `default 0` would bury it) applied where it bites hardest. This
 * email's entire job is to make him drop what he is doing for a listing that is
 * four minutes old. An unknown age rendered as "just now" spends that reflex on a
 * week-old ad, and it spends it *repeatedly*, until he stops trusting the badge —
 * at which point the pipeline still runs and no longer works.
 *
 * lejebolig publishes `datePosted` as a bare **date** (`"2026-09-06"`), which
 * parses to local midnight and so reads as up to 24 hours old on the day it
 * appears. boligzonen has no date on the page at all and gets its `posted_at`
 * from the sitemap's `<lastmod>`, which is a real timestamp. The label therefore
 * tells the truth about a coarse source rather than inventing precision: a
 * date-only value can never render as minutes.
 *
 * A future timestamp (clock skew, or a portal stamping a listing forward) clamps
 * to 0 and reads "just now" — it is a real listing that is at most new.
 */
export function listingAge(postedAt, now = new Date()) {
  const raw = postedAt === null || postedAt === undefined ? "" : String(postedAt).trim();
  if (!raw) return { minutes: null, label: "age unknown", tone: "unknown", known: false };
  const t = new Date(raw).getTime();
  if (Number.isNaN(t)) return { minutes: null, label: "age unknown", tone: "unknown", known: false };

  const ms = Math.max(0, new Date(now).getTime() - t);
  const minutes = Math.floor(ms / MIN);

  // A date with no time component. Local midnight is a floor, not a moment, so
  // anything finer than "today" would be fabricated precision.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);

  let label;
  if (dateOnly) {
    const days = Math.floor(ms / DAY);
    label = days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days old`;
  } else if (ms < MIN) {
    label = "just now";
  } else if (ms < HOUR) {
    label = `${minutes} min old`;
  } else if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    label = `${h} h old`;
  } else {
    const days = Math.floor(ms / DAY);
    label = days === 1 ? "yesterday" : `${days} days old`;
  }

  const tone = ms < HOUR ? "hot" : ms < 6 * HOUR ? "warm" : ms < 2 * DAY ? "cool" : "cold";
  return { minutes, label, tone, known: true };
}

/** Colour band for the age badge. Cosmetic; the label is the real signal. */
function ageTone(tone) {
  if (tone === "hot") return { bg: "#c0392b", fg: "#ffffff" };
  if (tone === "warm") return { bg: "#8a5a00", fg: "#ffffff" };
  if (tone === "cool") return { bg: "#4a4f57", fg: "#ffffff" };
  if (tone === "cold") return { bg: "#eceef1", fg: "#5b6068" };
  return { bg: "#f1f2f4", fg: "#6b7280" }; // unknown
}

// MARK: - The listing email

function factCell(label, value) {
  return (
    '<td valign="top" style="padding:0 16px 0 0;">' +
    `<div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${escapeHtml(
      label,
    )}</div>` +
    `<div style="font-size:15px;font-weight:600;color:#16181d;line-height:22px;">${escapeHtml(
      value,
    )}</div></td>`
  );
}

/**
 * Build the alert email for one pending listing.
 *
 * `item` is a row from `housing-ingest`'s `{action:"notify_pending"}` response:
 * `{listing_id, title, rent, address, url, distance_km, rooms, sqm, posted_at}`.
 *
 * Returns `{ subject, html, text }`. The HTML is table-and-inline-style only with
 * no external assets: an email client that blocks remote content must still render
 * it correctly, because deciding whether to chase a flat happens *in* this message
 * — on a phone, in a hurry, quite possibly on the metro.
 *
 * The `text` half is a genuine plain-text alternative rather than a stub. n8n's
 * Gmail node sends a single body part, so only the HTML is transmitted today; the
 * text is what a raw-MIME sender would attach as `text/plain`, and having it lets
 * the tests pin the *content* of the email independently of its markup.
 */
export function buildListingEmail(item, { now = new Date() } = {}) {
  const it = item || {};

  const title = clampLine(it.title, MAX_TITLE_CHARS) || "(untitled listing)";
  const address = clampLine(it.address, MAX_FIELD_CHARS);
  const rent = formatDkk(it.rent);
  const rooms = formatDkk(it.rooms);
  const sqm = formatDkk(it.sqm);
  const distance = formatKm(it.distance_km);
  const url = safeUrl(it.url);
  const listingId = clampLine(it.listing_id, 64);
  const age = listingAge(it.posted_at, now);
  const tone = ageTone(age.tone);

  // --- subject -------------------------------------------------------------
  // `[Bolig {rent} kr] {title} — {address}`. An unknown rent renders "?" rather
  // than an omitted bracket or a zero: the bracket is what makes these sortable
  // and scannable in a phone's notification list, and "0 kr" would be a lie in the
  // one place it is most likely to be believed.
  let subject = `[Bolig ${rent === null ? "?" : rent} kr] ${title}`;
  if (address) subject += ` — ${address}`;
  subject = clampLine(subject, MAX_SUBJECT_CHARS);

  // --- html ----------------------------------------------------------------
  const parts = [];

  parts.push(
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background:#f4f5f7;margin:0;padding:20px 0;"><tr><td align="center" style="padding:0 12px;">' +
      '<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" ' +
      'style="width:100%;max-width:560px;background:#ffffff;border:1px solid #e3e6ea;border-radius:12px;' +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      'color:#16181d;text-align:left;">',
  );

  // Age first, and biggest. On this lane the age IS the decision.
  parts.push(
    '<tr><td style="padding:20px 22px 12px 22px;">' +
      `<div style="display:inline-block;background:${tone.bg};color:${tone.fg};border-radius:999px;` +
      `padding:6px 16px;font-size:16px;font-weight:700;letter-spacing:.01em;">${escapeHtml(
        age.label,
      )}</div>` +
      `<div style="font-size:20px;font-weight:700;line-height:27px;margin-top:14px;">${escapeHtml(
        title,
      )}</div>` +
      (address
        ? `<div style="font-size:14px;color:#5b6068;margin-top:4px;">${escapeHtml(address)}</div>`
        : "") +
      "</td></tr>",
  );

  // The facts, one row, biggest first. Anything missing is simply absent — a
  // dash-filled grid reads as "we checked and there is nothing", which is a
  // different and untrue claim from "the source did not say".
  const cells = [];
  if (rent !== null) cells.push(factCell("husleje", `${rent} kr.`));
  if (rooms !== null) cells.push(factCell("værelser", rooms));
  if (sqm !== null) cells.push(factCell("størrelse", `${sqm} m²`));
  if (distance !== null) cells.push(factCell("afstand", distance));
  if (cells.length) {
    parts.push(
      '<tr><td style="padding:4px 22px 0 22px;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>' +
        cells.join("") +
        "</tr></table></td></tr>",
    );
  }

  // The one action, and it is deliberately the largest clickable thing here.
  parts.push(
    '<tr><td style="padding:20px 22px 22px 22px;">' +
      (url
        ? `<a href="${escapeHtml(url)}" ` +
          'style="display:block;background:#2f6feb;color:#ffffff;font-size:17px;font-weight:700;' +
          'padding:16px 20px;border-radius:10px;text-decoration:none;text-align:center;">' +
          "Åbn annoncen &rarr;</a>" +
          '<div style="font-size:12px;color:#6b7280;margin-top:10px;line-height:18px;">' +
          "Write to the landlord yourself — nothing here contacts a portal on your behalf." +
          "</div>"
        : '<div style="font-size:13px;color:#8e2318;font-weight:600;">' +
          "No usable link on this row. Nothing to open." +
          "</div>") +
      "</td></tr>",
  );

  parts.push(
    '<tr><td style="padding:0 22px 18px 22px;border-top:1px solid #eceef1;">' +
      `<div style="font-size:11px;color:#9aa0a6;padding-top:12px;">listing ${escapeHtml(
        listingId || "(unknown)",
      )}` +
      (age.known ? "" : " · this source published no date, so the age above is unknown, not new") +
      "</div></td></tr>",
  );

  parts.push("</table></td></tr></table>");
  const html = parts.join("");

  // --- text ----------------------------------------------------------------
  const lines = [];
  lines.push(`${age.label.toUpperCase()} — ${title}`);
  if (address) lines.push(address);
  lines.push("");
  const facts = [];
  if (rent !== null) facts.push(`${rent} kr.`);
  if (rooms !== null) facts.push(`${rooms} vær.`);
  if (sqm !== null) facts.push(`${sqm} m²`);
  if (distance !== null) facts.push(distance);
  if (facts.length) lines.push(facts.join("  ·  "), "");
  lines.push(url ? `Open: ${url}` : "No usable link on this row. Nothing to open.");
  lines.push("");
  lines.push("Write to the landlord yourself — nothing here contacts a portal on your behalf.");
  if (!age.known) lines.push("This source published no date; the age above is unknown, not new.");
  lines.push(`listing ${listingId || "(unknown)"}`);

  return { subject, html, text: lines.join("\n") };
}

// MARK: - The renewal guard's emails
//
// A different pipeline from the listing race, sharing this file only for the
// escaping, the bounds and the pairing helper.
//
// `HOUSING_PLAN.md` §2: Lane A's asset is **seniority**. Waiting times on the
// Nørre Campus dorms run six months to three years, and a list that deletes you
// for a missed reconfirmation does not pause your place — it ends it, and there
// is nothing to re-earn and nobody to appeal to. These two emails guard the most
// valuable and least recoverable thing in the whole system, so every rule below
// is chosen on that basis: loud when unsure, never quietly reassuring, and
// structurally incapable of rendering an unknown as a zero.

/** A waiting-list name inside a subject. */
const MAX_LIST_NAME_CHARS = 90;

/** The free-text note carried on a position row. */
const MAX_NOTES_CHARS = 400;

/**
 * How urgent one renewal row is, as `{ daysLeft, overdue, label, tone, known }`.
 *
 * `days_left` is **negative when overdue**, and the server precomputes an
 * `overdue` boolean beside it "so the email template cannot get the sign wrong".
 * This prefers that flag and falls back to the sign. Two derivations of one fact
 * is normally a smell; here the failure mode of getting it backwards is an email
 * cheerfully announcing "12 days left" about a list that deleted you twelve days
 * ago, so the redundancy is worth its keep.
 *
 * ## `known: false` is not "due today"
 *
 * A `renewals` row always carries `days_left` by shape. If one arrives without a
 * usable number anyway, the label is **"days left unknown"** and the tone is the
 * loudest one — not `0`, and not the quiet grey `listingAge` uses for an unknown
 * listing age.
 *
 * That asymmetry between the two functions in this file is deliberate. An unknown
 * listing age costs a wasted click. An unknown renewal countdown is a row the
 * guard cannot reason about, on a list whose deletion is irreversible — so it
 * fails toward *alarm*, the same way every accidental path in the blocking stack
 * fails toward "still blocked".
 */
export function renewalUrgency(item) {
  const it = item || {};
  const raw = it.days_left;
  const n =
    raw === null || raw === undefined || raw === "" || !Number.isFinite(Number(raw))
      ? null
      : Math.trunc(Number(raw));

  if (n === null) {
    return {
      daysLeft: null,
      overdue: it.overdue === true,
      label: "days left unknown",
      tone: "overdue",
      known: false,
    };
  }

  const overdue = typeof it.overdue === "boolean" ? it.overdue : n < 0;
  let label;
  if (n < 0) label = `${Math.abs(n)} ${Math.abs(n) === 1 ? "day" : "days"} OVERDUE`;
  else if (n === 0) label = "due TODAY";
  else label = `${n} ${n === 1 ? "day" : "days"} left`;

  const tone = n < 0 ? "overdue" : n <= 7 ? "urgent" : n <= 30 ? "soon" : "later";
  return { daysLeft: n, overdue, label, tone, known: true };
}

/** Colour band for the countdown badge. Cosmetic; the label is the real signal. */
function urgencyTone(tone) {
  if (tone === "overdue") return { bg: "#8e2318", fg: "#ffffff", edge: "#c0392b" };
  if (tone === "urgent") return { bg: "#c0392b", fg: "#ffffff", edge: "#c0392b" };
  if (tone === "soon") return { bg: "#8a5a00", fg: "#ffffff", edge: "#d9a441" };
  return { bg: "#4a4f57", fg: "#ffffff", edge: "#c9ced6" };
}

/** `2026-10-15T00:00:00Z` → `2026-10-15`; anything else clamped as a line. */
export function formatYmd(value) {
  const s = clampLine(value, 64);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : s;
}

function renewalRow(label, valueHtml) {
  return (
    `<tr><td style="padding:4px 14px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${escapeHtml(
      label,
    )}</td>` + `<td style="padding:4px 0;font-size:13px;color:#16181d;">${valueHtml}</td></tr>`
  );
}

/**
 * The shell both renewal emails render into. They differ in tone and in what they
 * are allowed to claim, not in structure.
 *
 * ## Both buttons are safe to click, and only one of them can ever write
 *
 * `renewal_url` is a third-party waiting-list page: a plain read-only GET.
 *
 * `ack_url` points at `housing-renew?token=…`, and **that function renders on GET
 * and mutates only on POST**, with a `confirm=renewed` field — so even a bare
 * POST from a link scanner writes nothing. Same posture as the job pipeline's
 * decision email, which links to a confirm page rather than carrying a one-click
 * approve link: mail scanners, link-preview bots and Gmail's own image proxy
 * fetch URLs found in a message *before a human ever opens it*, and a GET that
 * acknowledges is a GET an antivirus appliance can fire at 03:00.
 *
 * Getting that wrong matters more here than it does for a job application. An
 * acknowledgement pushes the due date a whole interval forward and silences the
 * guard for a month, so a scanner "renewing" on his behalf would let the list
 * delete him while the panel showed a freshly-renewed row. Do not turn `ack_url`
 * into anything that acts on GET.
 */
function renewalShell({ badge, tone, heading, subheading, facts, primary, secondary, footer }) {
  const t = urgencyTone(tone);
  const parts = [];

  parts.push(
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
      'style="background:#f4f5f7;margin:0;padding:20px 0;"><tr><td align="center" style="padding:0 12px;">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" ' +
      `style="width:100%;max-width:600px;background:#ffffff;border:2px solid ${t.edge};border-radius:12px;` +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;" +
      'color:#16181d;text-align:left;">',
  );

  parts.push(
    '<tr><td style="padding:20px 22px 14px 22px;">' +
      `<div style="display:inline-block;background:${t.bg};color:${t.fg};border-radius:8px;` +
      `padding:8px 18px;font-size:18px;font-weight:800;letter-spacing:.02em;">${escapeHtml(badge)}</div>` +
      `<div style="font-size:20px;font-weight:700;line-height:27px;margin-top:14px;">${escapeHtml(
        heading,
      )}</div>` +
      (subheading
        ? `<div style="font-size:14px;color:#5b6068;margin-top:6px;line-height:20px;">${escapeHtml(
            subheading,
          )}</div>`
        : "") +
      "</td></tr>",
  );

  if (facts.length) {
    parts.push(
      '<tr><td style="padding:6px 22px 0 22px;">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">' +
        facts.join("") +
        "</table></td></tr>",
    );
  }

  parts.push(
    '<tr><td style="padding:20px 22px 6px 22px;">' +
      (primary.url
        ? `<a href="${escapeHtml(primary.url)}" ` +
          `style="display:block;background:${t.bg};color:${t.fg};font-size:17px;font-weight:700;` +
          'padding:16px 20px;border-radius:10px;text-decoration:none;text-align:center;">' +
          `${escapeHtml(primary.label)} &rarr;</a>`
        : '<div style="font-size:14px;color:#8e2318;font-weight:700;line-height:20px;">' +
          escapeHtml(primary.missing) +
          "</div>") +
      "</td></tr>",
  );

  parts.push(
    '<tr><td style="padding:12px 22px 20px 22px;">' +
      (secondary.url
        ? `<a href="${escapeHtml(secondary.url)}" ` +
          'style="display:inline-block;color:#2f6feb;font-size:14px;font-weight:600;' +
          'text-decoration:underline;">' +
          `${escapeHtml(secondary.label)}</a>` +
          '<div style="font-size:12px;color:#6b7280;margin-top:8px;line-height:18px;">' +
          "That link opens a confirm page — pressing the button on it is what records the " +
          "renewal. Opening it changes nothing, so a mail scanner cannot do it for you." +
          "</div>"
        : '<div style="font-size:13px;color:#8e2318;font-weight:600;">' +
          "No usable confirm link on this row — nothing can be acknowledged until that is fixed." +
          "</div>") +
      "</td></tr>",
  );

  parts.push(
    '<tr><td style="padding:0 22px 18px 22px;border-top:1px solid #eceef1;">' +
      `<div style="font-size:11px;color:#9aa0a6;padding-top:12px;line-height:17px;">${escapeHtml(
        footer,
      )}</div></td></tr>`,
  );

  parts.push("</table></td></tr></table>");
  return parts.join("");
}

/**
 * Build the reminder for one waiting-list row whose renewal rule IS known.
 *
 * `item` is one element of `housing-ingest`'s `{action:"renewal_pending"}`
 * `renewals` array: `{position_id, list_name, due_at, days_left, renewal_url,
 * ack_url, interval_months, position, notes, last_renewed_at, signed_up_at,
 * reminder_lead_days, overdue}`.
 *
 * The last four are **not in the pinned brief** and are worth rendering: the email
 * states what the guard *believes* — "every 12 months, last renewed 2025-09-20" —
 * precisely so a wrong belief can be contradicted by the person reading it. A
 * reminder that shows only its conclusion cannot be corrected.
 */
export function buildRenewalEmail(item, { now = new Date() } = {}) {
  const it = item || {};
  const urgency = renewalUrgency(it);

  const listName = clampLine(it.list_name, MAX_LIST_NAME_CHARS) || "(unnamed waiting list)";
  const dueAt = formatYmd(it.due_at);
  const renewUrl = safeUrl(it.renewal_url);
  const ackUrl = safeUrl(it.ack_url);
  const positionId = clampLine(it.position_id, 64);
  const months = Number.isFinite(Number(it.interval_months))
    ? Math.trunc(Number(it.interval_months))
    : null;
  const position =
    it.position === null || it.position === undefined || it.position === ""
      ? null
      : clampLine(it.position, 32);
  const notes = clampLine(it.notes, MAX_NOTES_CHARS);
  const lastRenewed = formatYmd(it.last_renewed_at);
  const signedUp = formatYmd(it.signed_up_at);
  const lead = Number.isFinite(Number(it.reminder_lead_days))
    ? Math.trunc(Number(it.reminder_lead_days))
    : null;

  // --- subject -------------------------------------------------------------
  // The overdue variant leads with the word, because on a phone the subject often
  // IS the email.
  const tail = urgency.overdue
    ? `OVERDUE ${urgency.daysLeft === null ? "?" : Math.abs(urgency.daysLeft)}d`
    : `renewal due ${dueAt || "(date unknown)"}`;
  const subject = clampLine(`⚠️ Venteliste: ${listName} — ${tail}`, MAX_SUBJECT_CHARS);

  // --- facts ---------------------------------------------------------------
  const facts = [];
  facts.push(
    renewalRow(
      "Due",
      dueAt
        ? `<strong style="color:#8e2318;font-size:15px;">${escapeHtml(dueAt)}</strong>`
        : '<strong style="color:#8e2318;">not known — the guard could not compute a date</strong>',
    ),
  );
  if (months !== null) {
    facts.push(
      renewalRow(
        "Every",
        escapeHtml(`${months} ${months === 1 ? "month" : "months"}`) +
          (lastRenewed
            ? escapeHtml(`, last renewed ${lastRenewed}`)
            : signedUp
              ? escapeHtml(`, counted from signup ${signedUp}`)
              : ""),
      ),
    );
  }
  if (position !== null) facts.push(renewalRow("Position", escapeHtml(position)));
  if (lead !== null) facts.push(renewalRow("Warned from", escapeHtml(`${lead} days before`)));
  if (notes) facts.push(renewalRow("Notes", escapeHtml(notes)));
  facts.push(
    renewalRow(
      "Renewal page",
      renewUrl
        ? `<a href="${escapeHtml(renewUrl)}" style="color:#2f6feb;">${escapeHtml(renewUrl)}</a>`
        : '<span style="color:#8e2318;">none recorded — find it and put it on the row</span>',
    ),
  );

  const html = renewalShell({
    badge: urgency.label,
    tone: urgency.tone,
    heading: listName,
    subheading:
      "Waiting-list seniority is the asset here. A missed reconfirmation does not pause your " +
      "place — it ends it, and there is nothing to re-earn.",
    facts,
    primary: {
      url: renewUrl,
      label: "Go renew",
      missing:
        "No renewal URL on this row. Open the provider's site yourself, renew, then use the " +
        "confirm link below.",
    },
    secondary: { url: ackUrl, label: "I renewed today →" },
    footer:
      `position ${positionId || "(unknown)"} · this reminder repeats every 3 days until you ` +
      "confirm · sending it records nothing — only the confirm page does",
  });

  // --- text ----------------------------------------------------------------
  const lines = [];
  lines.push(`${urgency.label.toUpperCase()} — ${listName}`);
  lines.push("");
  lines.push(`Due:      ${dueAt || "not known — the guard could not compute a date"}`);
  if (months !== null) {
    lines.push(
      `Every:    ${months} ${months === 1 ? "month" : "months"}` +
        (lastRenewed
          ? `, last renewed ${lastRenewed}`
          : signedUp
            ? `, counted from signup ${signedUp}`
            : ""),
    );
  }
  if (position !== null) lines.push(`Position: ${position}`);
  if (lead !== null) lines.push(`Warned:   from ${lead} days before`);
  if (notes) lines.push(`Notes:    ${notes}`);
  lines.push("");
  lines.push(
    renewUrl
      ? `Go renew:        ${renewUrl}`
      : "No renewal URL on this row — open the provider's site yourself.",
  );
  lines.push(
    ackUrl
      ? `I renewed today: ${ackUrl}`
      : "No usable confirm link on this row — nothing can be acknowledged until that is fixed.",
  );
  lines.push("");
  lines.push("That confirm link opens a page; pressing the button on it is what records it.");
  lines.push(`position ${positionId || "(unknown)"}`);

  return { subject, html, text: lines.join("\n") };
}

/**
 * Build the gentler email for a row whose renewal rule was **never established**.
 *
 * `item` is one element of the `unknown_interval` array, whose shape deliberately
 * carries **no `due_at` and no `days_left`** — the server splits the two lists so
 * that a template physically cannot render one of these as though it were due on
 * a date. (⚠️ The pinned brief said the two lists share a shape. They do not, and
 * building this against the brief would have interpolated two undefined fields
 * into an urgent-looking email.)
 *
 * This function honours that split by never reading either field, so even a
 * mis-routed row cannot acquire a deadline here.
 *
 * ⚠️ The routing polarity in the workflow runs the other way, deliberately: an
 * item that arrives carrying a `due_at` goes through `buildRenewalEmail`
 * regardless of which array it came from. A dated row rendered as "no rush" is the
 * failure that costs three years of seniority; an undated row rendered loudly
 * costs one over-urgent email.
 *
 * A NULL interval is emphatically **not** "this list never expires". It is "we
 * have not been told", and the action is research, not renewal — which is why this
 * fires quarterly rather than every three days, and why its primary button goes to
 * the provider's page rather than to a confirm link.
 */
export function buildUnknownIntervalEmail(item, { now = new Date() } = {}) {
  const it = item || {};

  const listName = clampLine(it.list_name, MAX_LIST_NAME_CHARS) || "(unnamed waiting list)";
  const renewUrl = safeUrl(it.renewal_url);
  const ackUrl = safeUrl(it.ack_url);
  const positionId = clampLine(it.position_id, 64);
  const signedUp = formatYmd(it.signed_up_at);
  const position =
    it.position === null || it.position === undefined || it.position === ""
      ? null
      : clampLine(it.position, 32);
  const notes = clampLine(it.notes, MAX_NOTES_CHARS);

  const subject = clampLine(
    `Venteliste: ${listName} — check this list's renewal rule`,
    MAX_SUBJECT_CHARS,
  );

  const facts = [];
  if (signedUp) facts.push(renewalRow("Signed up", escapeHtml(signedUp)));
  if (position !== null) facts.push(renewalRow("Position", escapeHtml(position)));
  if (notes) facts.push(renewalRow("Notes", escapeHtml(notes)));
  facts.push(
    renewalRow(
      "Provider page",
      renewUrl
        ? `<a href="${escapeHtml(renewUrl)}" style="color:#2f6feb;">${escapeHtml(renewUrl)}</a>`
        : '<span style="color:#8e2318;">none recorded</span>',
    ),
  );

  const html = renewalShell({
    badge: "rule unknown",
    tone: "later",
    heading: listName,
    subheading:
      "Nobody has told this guard how often the list must be reconfirmed, so it cannot warn " +
      "you before a deadline. An unknown rule is not the same as no rule — find out what it " +
      "is, put it on the row, and this email stops.",
    facts,
    primary: {
      url: renewUrl,
      label: "Check the provider's page",
      missing:
        "No provider URL on this row either. Find the list's own page and put both the URL " +
        "and the renewal interval on the row.",
    },
    secondary: { url: ackUrl, label: "I renewed today →" },
    footer:
      `position ${positionId || "(unknown)"} · repeats every 90 days while the interval is ` +
      "unknown · no deadline is being tracked for this list",
  });

  const lines = [];
  lines.push(`RULE UNKNOWN — ${listName}`);
  lines.push("");
  lines.push("Nobody has told this guard how often the list must be reconfirmed, so it cannot");
  lines.push("warn you before a deadline. An unknown rule is not the same as no rule.");
  lines.push("");
  if (signedUp) lines.push(`Signed up: ${signedUp}`);
  if (position !== null) lines.push(`Position:  ${position}`);
  if (notes) lines.push(`Notes:     ${notes}`);
  lines.push(renewUrl ? `Provider:  ${renewUrl}` : "Provider:  none recorded");
  if (ackUrl) lines.push(`I renewed today: ${ackUrl}`);
  lines.push("");
  lines.push("No deadline is being tracked for this list.");
  lines.push(`position ${positionId || "(unknown)"}`);

  return { subject, html, text: lines.join("\n") };
}
