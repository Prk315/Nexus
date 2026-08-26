/**
 * Job-post extraction — the canonical implementation.
 *
 * Pure, dependency-free, and deliberately regex-based rather than DOM-based: this
 * file is inlined verbatim into an n8n Code node, which has no npm modules and no
 * DOM. `n8n/job-applier/README.md` describes the copy that must stay in sync.
 *
 * # Two sources, two paths — and the reason they cannot share one
 *
 * The original plan said "one generic extractor": Google Jobs requires schema.org
 * `JobPosting`, so most boards emit it and one parser handles everything. That is
 * true for TheHub and it is NOT true for Jobindex. Probed 2026-08-24:
 *
 *   - TheHub job page          -> one <script type="application/ld+json"> JobPosting
 *   - Jobindex /vis-job/ page  -> ld+json is @type WebSite. No JobPosting anywhere.
 *   - The employer ATS behind it (HR-Manager, SuccessFactors) -> also no JSON-LD.
 *
 * So Jobindex is a genuine HTML scrape, and following the ad out to the employer's
 * ATS does not rescue it. Do not "unify" these two paths without re-probing.
 *
 * # What a Jobindex /vis-job/ page actually is
 *
 * A stub, not an ad: a banner image, an <h4> title link, a location span, and a
 * link out. The body text is NOT on the page — `og:description` carries only the
 * opening sentence (~160 chars). The full text is one fetch further on, at the
 * `<h4>` link, which is either the employer's own site or a `jobindex.dk/
 * jobannonce/...` page that Jobindex hosts itself. Both are handled by
 * `extractReadableText`.
 *
 * # A third lane: job-alert emails
 *
 * `parseLinkedInAlertEmail` is the discoverer for mail that already arrives in the
 * inbox. LinkedIn is deliberately **ingest-only** — there is no API and logged-in
 * pages are never scraped — so the alert email is the whole source of truth, with
 * the public job page as optional enrichment that must be allowed to fail.
 */

// MARK: - Source kinds
//
// ⚠️ `job_postings.source_kind` and `job_sources.kind` are DIFFERENT vocabularies,
// and the alert lane spells the same lane two ways. `job-ingest` validates a
// posting against SOURCE_KINDS = ["jobindex_rss", "thehub_sitemap", "gmail_alert",
// "manual"] — **singular** `gmail_alert` — while the `job_sources` registry row
// (and therefore the Route Source switch) says **plural** `gmail_alerts`.
//
// Sending the plural got every LinkedIn posting rejected with `invalid_source_kind`
// on the first live run: 28 alert postings became 0 rows, and because the ingest
// reports rejects in the response body rather than failing, the workflow finished
// green. Nothing anywhere said the lane had been discarded.
//
// The constants exist so the posting-side spelling is written once. Do not inline
// the string in a Code node body — that is how the two drift back apart.
export const SOURCE_KIND = {
  jobindex: "jobindex_rss",
  thehub: "thehub_sitemap",
  gmailAlert: "gmail_alert",
};

// MARK: - Small helpers

const decodeEntities = (s) =>
  String(s ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&"); // last: an entity may itself be &amp;-escaped

const collapse = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

/** Strip tags to plain text. Scripts and styles go first or their source leaks in. */
function htmlToText(html) {
  let t = String(html ?? "");
  t = t.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<!--[\s\S]*?-->/g, " ");
  t = t.replace(/<\/(p|div|li|tr|h[1-6]|br)>/gi, "\n");
  t = t.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = decodeEntities(t);
  return t
    .split("\n")
    .map((l) => collapse(l))
    .filter(Boolean)
    .join("\n");
}

/** `<meta property="og:x" content="...">` in either attribute order. */
function metaContent(html, prop) {
  const esc = prop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const a = new RegExp(
    `<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']*)["']`,
    "i",
  ).exec(html);
  if (a) return decodeEntities(a[1]);
  const b = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${esc}["']`,
    "i",
  ).exec(html);
  return b ? decodeEntities(b[1]) : null;
}

// MARK: - schema.org JobPosting (TheHub, and most ATS vendors)

/**
 * Pull the first schema.org JobPosting out of a page's ld+json blocks.
 *
 * A block may be a bare object, an array, or a `@graph` wrapper — all three are
 * in the wild, and a parser that only handles the first silently returns null on
 * the other two, which looks exactly like "this page has no JSON-LD".
 */
export function extractJobPostingLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html ?? ""))) !== null) {
    let parsed;
    try {
      parsed = JSON.parse(m[1].trim());
    } catch {
      continue; // one malformed block must not abort the others
    }
    const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
    while (queue.length) {
      const node = queue.shift();
      if (!node || typeof node !== "object") continue;
      if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
      const t = node["@type"];
      const types = Array.isArray(t) ? t : [t];
      if (types.includes("JobPosting")) return node;
    }
  }
  return null;
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v);

/** Flatten schema.org's nested address/organization shapes into flat strings. */
function ldLocation(posting) {
  const loc = firstOf(posting?.jobLocation);
  const addr = loc?.address ?? loc;
  if (!addr) {
    // Fully-remote postings often carry applicantLocationRequirements instead.
    const alr = firstOf(posting?.applicantLocationRequirements);
    return alr?.name ?? null;
  }
  if (typeof addr === "string") return addr;
  const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry]
    .map((p) => (typeof p === "object" ? p?.name : p))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function normalizeLdJobPosting(posting, { url, sourceKind }) {
  if (!posting) return null;
  const org = firstOf(posting.hiringOrganization);
  return {
    source_kind: sourceKind,
    url,
    external_id: String(posting.identifier?.value ?? posting.identifier ?? "") || url,
    title: collapse(posting.title),
    company: collapse(typeof org === "string" ? org : org?.name) || null,
    location: collapse(ldLocation(posting)) || null,
    // `jobLocationType: "TELECOMMUTE"` is schema.org's only formal remote signal.
    remote: posting.jobLocationType === "TELECOMMUTE" ? true : null,
    employment_type: Array.isArray(posting.employmentType)
      ? posting.employmentType.join(",")
      : posting.employmentType ?? null,
    posted_at: posting.datePosted ?? null,
    valid_through: posting.validThrough ?? null,
    description: htmlToText(posting.description ?? ""),
    apply_channel: posting.directApply === true ? "board" : "unknown",
    ld_json: posting,
  };
}

// MARK: - Jobindex RSS

/**
 * Parse a Jobindex RSS feed.
 *
 * The feed declares ISO-8859-1. Decode at the fetch boundary by the declared
 * charset — this function takes an already-decoded string and will happily store
 * mojibake if handed a UTF-8 read of latin-1 bytes.
 *
 * `<title>` is `"<job title>, <company>"`. Splitting on the LAST comma is
 * deliberate: "Student Assistant, Component Sales, Semco Maritime A/S" has two,
 * and the company is always the final segment.
 *
 * ⚠️ That heuristic is a FALLBACK ONLY, because it is wrong whenever the employer's
 * own name contains a comma. Live example from the first run:
 *
 *   "To studentermedhjælpere søges til Det Kongelige Akademi - Arkitektur, Design,
 *    Konservering"
 *
 * — one title, no company segment at all, and the last comma cut it into
 * "…Arkitektur, Design" + "Konservering". The stored employer became
 * "Konservering" ("conservation"), which is a school subject.
 *
 * There is no way to tell the two shapes apart from the feed string, so the fix is
 * not a cleverer split: `extractJobindexStub` reads the employer off the ad page's
 * own toolbar, and `Build Jobindex Posting` prefers it. This split only runs when
 * the stub fetch gave us nothing.
 */
export function parseJobindexFeed(xml) {
  const out = [];
  const items = String(xml ?? "").match(/<item>[\s\S]*?<\/item>/gi) ?? [];
  for (const raw of items) {
    const pick = (tag) => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i").exec(raw);
      return m ? decodeEntities(collapse(m[1])) : null;
    };
    const full = pick("title");
    if (!full) continue;
    const link = pick("link");
    const idx = full.lastIndexOf(",");
    const categories = [...raw.matchAll(/<category>([\s\S]*?)<\/category>/gi)].map((m) =>
      decodeEntities(collapse(m[1])),
    );
    out.push({
      source_kind: SOURCE_KIND.jobindex,
      url: link,
      // /vis-job/h1691819 -> h1691819. Stable per ad and shorter than the URL.
      external_id: link ? link.split("/").filter(Boolean).pop() : null,
      title: idx > 0 ? full.slice(0, idx).trim() : full,
      company: idx > 0 ? full.slice(idx + 1).trim() : null,
      posted_at: pick("pubDate"),
      categories,
    });
  }
  return out;
}

// MARK: - Jobindex /vis-job/ stub

const NON_AD_HOSTS =
  /(?:youtube\.com|youtu\.be|facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com\/(?:shar|company)|google\.[a-z.]+\/maps)/i;

/**
 * Read a /vis-job/ stub: title, location, and the URL where the real ad lives.
 *
 * The target link comes from the `<h4>` heading, NOT from `data-click`. Jobindex
 * stamps `data-click` on every outbound link the employer pasted, so "first
 * data-click link" picks up the banner image link and — verified on a real ad —
 * a YouTube recruitment video. The <h4> is the ad's own title link.
 * `NON_AD_HOSTS` is a second belt on the same trousers.
 *
 * # The employer, and why it is read here rather than split out of the feed title
 *
 * `jix-toolbar-top__company` is the ad's own employer link in the page toolbar. It
 * was present on all 11 stubs of the first live run — paid ads and `r`-prefixed
 * robot-scraped ads alike — and it is a single anchor holding exactly the company
 * name, so there is nothing to parse out of it.
 *
 * Two nearby classes are deliberately NOT used:
 *   - `job-card__company` is the "more jobs from this employer" sidebar. It happens
 *     to agree today because the sidebar lists the same company, but it is a
 *     related-jobs list and would silently attribute the wrong employer the moment
 *     Jobindex mixes recommendations into it.
 *   - `vp-card__name` is the company-profile card. It is a fine second signal and
 *     is used as one, but it is absent on robot-scraped ads (missing on the Royal
 *     Academy stub), so it cannot be first.
 *
 * Returning `null` when neither is present is load-bearing: `Build Jobindex Posting`
 * falls back to the feed split, and a `null` that overwrote a usable feed company
 * would be a regression dressed as a fix.
 */
export function extractJobindexStub(html) {
  const h = String(html ?? "");
  let target = null;
  const h4 = /<h4[^>]*>\s*<a[^>]+href=["']([^"']+)["']/i.exec(h);
  if (h4) target = decodeEntities(h4[1]);
  if (!target || NON_AD_HOSTS.test(target)) {
    for (const m of h.matchAll(/<a[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*data-click=/gi)) {
      const u = decodeEntities(m[1]);
      if (!/jobindex\.dk/i.test(u) && !NON_AD_HOSTS.test(u)) {
        target = u;
        break;
      }
    }
  }
  const area = /class=["'][^"']*jix_robotjob--area[^"']*["'][^>]*>([^<]*)</i.exec(h);
  const areaText = area ? decodeEntities(collapse(area[1])) : null;
  return {
    title: metaContent(h, "og:title"),
    company: extractJobindexCompany(h),
    // "Bjerringbro, Hybrid position" / "Copenhagen (Hybrid)" — one field, two facts.
    location: areaText,
    remote: areaText ? /hybrid|remote|hjemmearbejde|distance/i.test(areaText) : null,
    lead: metaContent(h, "og:description"),
    target_url: target && !NON_AD_HOSTS.test(target) ? target : null,
  };
}

/** The employer named on a /vis-job/ stub, or null. See `extractJobindexStub`. */
export function extractJobindexCompany(html) {
  const h = String(html ?? "");
  // The toolbar entry is `<div class="jix-toolbar-top__company"><a ...>Name</a></div>`
  // on paid ads. Robot-scraped ads use the same class with the name inline, so the
  // anchor is optional.
  const toolbar =
    /class=["'][^"']*jix-toolbar-top__company[^"']*["'][^>]*>\s*(?:<a\b[^>]*>)?\s*([^<]{1,200})/i.exec(h);
  const fromToolbar = toolbar ? decodeEntities(collapse(toolbar[1])) : "";
  if (fromToolbar) return fromToolbar;

  const card = /class=["'][^"']*vp-card__name[^"']*["'][^>]*>\s*([^<]{1,200})/i.exec(h);
  const fromCard = card ? decodeEntities(collapse(card[1])) : "";
  return fromCard || null;
}

// MARK: - Readable text from an arbitrary ad page

/** Cookie/consent boilerplate outweighs the ad on some pages. See below. */
const BOILERPLATE =
  /(cookies og personoplysninger|vi og vores samarbejdspartnere|accepter alle|cookiepolitik|privacy policy|consent)/i;

/**
 * Best-effort body text for a page with no JSON-LD.
 *
 * Tries Jobindex's own `jobcontent` container first, then falls back to the
 * largest plausible text block.
 *
 * The fallback filters `BOILERPLATE` for a concrete reason: on a Jobindex
 * `/jobannonce/` page the single largest <div> is the **cookie-consent banner**
 * (743 chars of it), which beat the real ad in a naive "longest block wins" pass.
 * A generic readability heuristic that skips this check silently fills the
 * database with GDPR notices, and every downstream score is then computed against
 * a cookie policy.
 */
export function extractReadableText(html) {
  const h = String(html ?? "");
  const named = /class=["'][^"']*jobcontent[^"']*["']/i.exec(h);
  if (named) {
    const text = htmlToText(h.slice(named.index, named.index + 30000));
    if (text.length > 300) return text;
  }
  const stripped = h
    .replace(/<(script|style|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  let best = "";
  for (const m of stripped.matchAll(/<(?:div|section|article)\b[^>]*>([\s\S]*?)<\/(?:div|section|article)>/gi)) {
    const text = htmlToText(m[1]);
    if (text.length > best.length && !BOILERPLATE.test(text)) best = text;
  }
  return best.length > 200 ? best : htmlToText(stripped);
}

// MARK: - Dedup

/**
 * Cross-source dedup key.
 *
 * The same ad reaches us from Jobindex, from TheHub and (later) from a LinkedIn
 * alert under three different URLs, so a URL-keyed dedup produces triplicates —
 * and three applications to one company, which is worse than a missed one.
 *
 * Company suffixes are stripped because sources disagree about them: "Grundfos
 * A/S" in a Jobindex feed is "Grundfos" in TheHub's hiringOrganization.
 */
export function dedupeKey(company, title) {
  const norm = (s) =>
    String(s ?? "")
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(a\/s|aps|ivs|k\/s|p\/s|inc|ltd|llc|gmbh|ab|as|oy|bv|nv)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `${norm(company)}::${norm(title)}`;
}

/**
 * Normalize one alert-email job into the posting shape the other two lanes emit.
 *
 * `enrichment` is a `normalizeLdJobPosting` row from the public job page, or null.
 * **Null is the expected case, not the error case**: `linkedin.com/jobs/view/<id>`
 * authwalls unpredictably, and when it does there is no JSON-LD to read. Every
 * field therefore falls back to what the email already told us, and a job whose
 * enrichment failed is ingested with a title, a company and a location rather than
 * being dropped. Dropping it would silently make the lane's yield depend on
 * LinkedIn's mood.
 *
 * Nothing here is inferred. `remote` stays null unless schema.org said
 * `TELECOMMUTE`; `apply_channel` stays "unknown" unless the page said
 * `directApply`. A guessed `remote: false` would be read by the gate as a real
 * fact and drop an actually-remote job on a location miss.
 */
export function buildAlertPosting(job, { sourceKind, sourceId = null, enrichment = null } = {}) {
  const company = job.company ?? enrichment?.company ?? null;
  const title = job.title ?? enrichment?.title ?? "";
  return {
    source_kind: sourceKind,
    source_id: sourceId,
    url: job.url,
    source_url: null,
    apply_url: job.url,
    external_id: job.external_id ?? job.url,
    dedupe_key: dedupeKey(company, title),
    title,
    company,
    location: job.location ?? enrichment?.location ?? null,
    remote: enrichment?.remote ?? null,
    employment_type: enrichment?.employment_type ?? null,
    posted_at: job.posted_at ?? enrichment?.posted_at ?? null,
    valid_through: enrichment?.valid_through ?? null,
    description: pickDescription(job.description, enrichment?.description) || null,
    ld_json: enrichment?.ld_json ?? null,
    apply_channel: enrichment?.apply_channel ?? "unknown",
    categories: [],
  };
}

// MARK: - Job-alert emails (LinkedIn)

/**
 * Canonicalize a LinkedIn job link and recover the job id.
 *
 * Alert mail never links to the clean URL. Every anchor points at
 * `linkedin.com/comm/jobs/view/<id>/?trackingId=…&refId=…&midToken=…&trk=…
 * &trkEmail=…&eid=…&otpToken=…` — roughly 800 characters, most of it
 * per-recipient tracking. Two reasons that has to be reduced to
 * `https://www.linkedin.com/jobs/view/<id>/`:
 *
 *  - `otpToken` is a **credential**. It signs the recipient into the page. It must
 *    not be stored in Supabase and must certainly not be re-fetched by anything.
 *  - The same job in tomorrow's alert carries a different `trackingId`, so a
 *    URL-keyed `seen` set would treat it as new every single day.
 *
 * The numeric id in the path is the stable identity and becomes `external_id`.
 * Note `jobid_<id>` also appears inside the `trk` parameter; anchoring on
 * `/jobs/view/` is what stops the tracking copy being read instead.
 */
export function canonicalLinkedInJobUrl(href) {
  const m = /linkedin\.com\/(?:comm\/)?jobs\/view\/(\d{5,})/i.exec(
    decodeEntities(String(href ?? "")),
  );
  if (!m) return null;
  return { external_id: m[1], url: `https://www.linkedin.com/jobs/view/${m[1]}/` };
}

/** LinkedIn writes "Company · Location" with U+00B7, not a hyphen or a comma. */
const LINKEDIN_CARD_SEP = "·";

/**
 * Company and location for one card.
 *
 * `tail` is the markup between the title link and the start of the next card;
 * `card` is the whole card. The first non-empty `<p>` after the title is the
 * "Company · Location" line — what follows it is the "job-card-flavor" strip
 * ("Aktivt rekrutterende", "Din profil matcher"), which is not either of them.
 * Bounding both slices at the next card is what stops a card with no location
 * line borrowing the next job's company.
 */
function linkedInCardFacts(tail, card) {
  for (const p of tail.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = collapse(htmlToText(p[1]));
    if (!text) continue;
    const i = text.indexOf(LINKEDIN_CARD_SEP);
    if (i === -1) break; // not the header line — stop rather than scan into flavor text
    return {
      company: text.slice(0, i).trim() || null,
      location: text.slice(i + LINKEDIN_CARD_SEP.length).trim() || null,
    };
  }
  // The logo image's `alt` is the company name and nothing else — a real fallback
  // rather than a guess. Location stays null: an absent location must not become
  // an invented one, because the gate drops on location.
  const alt = /<img\b[^>]*\balt=["']([^"']+)["']/i.exec(card);
  return { company: alt ? decodeEntities(collapse(alt[1])) : null, location: null };
}

/**
 * Pull every job out of a LinkedIn job-alert digest email.
 *
 * Each card links the same job **three times** — logo image, an outer wrapper
 * anchor, and the bold title anchor — so a naive "one anchor is one job" pass
 * reports five jobs as fifteen. Grouping by the id in the href collapses that
 * without depending on LinkedIn's utility-class names, which are generated and
 * change without notice.
 *
 * Within a group the first anchor with any text is the title: the logo anchor
 * wraps only an `<img>` and yields the empty string. The wrapper anchor's capture
 * stops at the *inner* title anchor's `</a>` — non-greedy matching — so it yields
 * exactly the title too, which is why this needs no nesting-aware parse.
 *
 * Returns `[]` for anything that is not such an email. A digest with a layout we
 * do not recognise must produce no jobs, never a throw: one odd email in a batch
 * of twenty must not take the other nineteen down with it.
 */
export function parseLinkedInAlertEmail(html) {
  const h = String(html ?? "");
  const re =
    /<a\b[^>]*href=["']([^"']*linkedin\.com\/(?:comm\/)?jobs\/view\/\d{5,}[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;

  const order = [];
  const byId = new Map();
  let m;
  while ((m = re.exec(h)) !== null) {
    const canon = canonicalLinkedInJobUrl(m[1]);
    if (!canon) continue;
    if (!byId.has(canon.external_id)) {
      byId.set(canon.external_id, []);
      order.push(canon.external_id);
    }
    byId.get(canon.external_id).push({
      ...canon,
      start: m.index,
      end: re.lastIndex,
      text: collapse(htmlToText(m[2])),
    });
  }

  const out = [];
  for (let i = 0; i < order.length; i++) {
    const group = byId.get(order[i]);
    const titled = group.find((a) => a.text);
    if (!titled) continue; // an id that only ever appeared as a bare logo link
    const cardEnd = i + 1 < order.length ? byId.get(order[i + 1])[0].start : h.length;
    const facts = linkedInCardFacts(h.slice(titled.end, cardEnd), h.slice(group[0].start, cardEnd));
    out.push({
      title: titled.text,
      company: facts.company,
      location: facts.location,
      url: titled.url,
      external_id: titled.external_id,
      // The digest carries no ad body. Left null rather than "" so that a later
      // enrichment failure is distinguishable from an ad that really is blank.
      description: null,
    });
  }
  return out;
}

/**
 * LinkedIn ends every guest page's `og:description` with a stock sentence. It is
 * not part of the ad, and leaving it in puts the tokens "job" and "LinkedIn" into
 * the haystack the keyword gate matches against.
 */
const GUEST_PAGE_SUFFIX =
  /\s*(?:…|\.\.\.)?\s*(?:Se dette og tilsvarende job på LinkedIn|See this and similar jobs on LinkedIn)\.?\s*$/i;

/**
 * Best-effort enrichment from a public job page, for the alert lane.
 *
 * Returns null when the page yields nothing — which the caller must treat as
 * normal. Probed live 2026-08-25 against two real ids from the fixtures:
 * `linkedin.com/jobs/view/<id>/` answers **200 with zero ld+json blocks**. It is
 * a JavaScript shell, so the schema.org path that carries TheHub is simply not
 * available here, and a lane that depended on it would harvest nothing at all.
 *
 * What the shell *does* carry is `og:description` — the ad's opening sentence,
 * the same ~150-character lead a Jobindex `/vis-job/` stub gives. That is enough
 * for the gate to see body text instead of a bare title.
 *
 * `extractReadableText` is deliberately NOT used as a third fallback. On a
 * 290 KB single-page-app shell the largest text block is chrome, not the ad —
 * the same failure that made a cookie banner the "description" of a Jobindex ad,
 * and storing navigation furniture as a job description is worse than storing
 * nothing, because everything downstream then scores against it.
 */
export function extractAlertPageEnrichment(html, { url, sourceKind }) {
  const h = String(html ?? "");
  const ld = extractJobPostingLd(h);
  if (ld) return normalizeLdJobPosting(ld, { url, sourceKind });

  const lead = metaContent(h, "og:description");
  const description = lead ? collapse(lead).replace(GUEST_PAGE_SUFFIX, "") : "";
  if (description.length < 40) return null; // a stub or an interstitial, not an ad
  return { description, remote: null, ld_json: null };
}

// MARK: - Keyword matching

/**
 * Does `term` occur in `hay` as a whole token (or phrase)?
 *
 * ## Why this is not `hay.includes(term)`
 *
 * A live dry run over eight real ads passed a **chef** and a **Head of Legal** as
 * AI Engineering matches, and two Field Service Engineers as Game Dev. The cause
 * was substring matching: `"ai"` occurs inside *available*, *training* and
 * *maintenance*; `"engine"` occurs inside *Engineer*; `"game"` inside nothing
 * useful but `"developer"` and `"c#"` behaved just as loosely.
 *
 * Short keywords are the common case in a profile — `ai`, `ml`, `go`, `c#` — and
 * every one of them is a substring of ordinary English. A gate that admits
 * everything is worse than no gate: it hands the model a queue of chefs to score,
 * which costs seconds each and buries the real matches.
 *
 * `\b` is not usable because it is defined in terms of word characters, so it
 * fails immediately after `+` or `#` — `/\bc\+\+\b/` never matches "c++". Hence
 * explicit lookarounds on the alphanumeric class, which handle `c++`, `c#`,
 * `.net` and multi-word phrases alike.
 *
 * The trailing class also excludes `+` and `#`, which is not cosmetic: without
 * it the keyword `c` matches "c++" and "c#", and those are three different
 * languages. `c++` as a keyword still matches "c++ is required" because what
 * follows the matched `++` is a space.
 */
export function termHit(hay, term) {
  const t = String(term ?? "").toLowerCase().trim();
  if (!t) return false;
  const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9+#])`, "i").test(hay);
}

/**
 * Pick the best of several description candidates: simply the longest.
 *
 * Following a Jobindex ad out to its "apply" link frequently lands on an
 * application *form* rather than the ad — `hr-manager.net/ApplicationInit.aspx`
 * is a live example — and the form's boilerplate is short. Taking the last
 * successful extraction therefore overwrote a decent `og:description` lead with
 * 34 characters of form furniture, which is what the dry run showed.
 *
 * Longest-wins is crude, but every candidate here is already a plausible
 * description, and the failure it prevents (silently storing a login form as the
 * job ad, then scoring against it) is much worse than occasionally keeping a
 * slightly longer one.
 */
export function pickDescription(...candidates) {
  let best = "";
  for (const c of candidates) {
    const s = typeof c === "string" ? c.trim() : "";
    if (s.length > best.length) best = s;
  }
  return best;
}

// MARK: - Location

/**
 * Country names that are positively NOT Denmark.
 *
 * This list exists so `locationVerdict` can tell "somewhere else" from "somewhere
 * I don't recognise", which are very different facts. It is deliberately a list of
 * COUNTRIES and not of cities: the sources that carry a country always carry it in
 * full (TheHub emits "City, Region, Country"), whereas the Danish sources emit a
 * bare municipality and no country at all.
 *
 * An omission here is harmless — an unlisted country reads as "unknown" and the
 * posting survives to be judged on keywords. A wrong entry silently deletes a whole
 * country's jobs. So when in doubt, leave it out.
 */
const FOREIGN_COUNTRIES = new Set([
  "sweden", "sverige", "norway", "norge", "finland", "iceland", "island",
  "germany", "tyskland", "deutschland", "netherlands", "nederland", "holland",
  "belgium", "belgien", "luxembourg", "france", "frankrig", "spain", "spanien",
  "españa", "portugal", "italy", "italien", "italia", "greece", "grækenland",
  "austria", "østrig", "switzerland", "schweiz", "poland", "polen", "czechia",
  "czech republic", "tjekkiet", "slovakia", "hungary", "ungarn", "romania",
  "bulgaria", "croatia", "slovenia", "serbia", "estonia", "estland", "latvia",
  "letland", "lithuania", "litauen", "ireland", "irland", "united kingdom", "uk",
  "england", "scotland", "wales", "storbritannien", "united states",
  "united states of america", "usa", "canada", "mexico", "brazil", "argentina",
  "india", "indien", "china", "kina", "japan", "singapore", "australia",
  "australien", "new zealand", "south africa", "israel", "turkey", "tyrkiet",
  "ukraine", "ukraine", "russia", "rusland", "united arab emirates", "uae",
]);

/**
 * Decide a posting's location against a profile's allowed locations.
 *
 * Returns `"allow"`, `"deny"` or `"unknown"` — and the third value is the whole
 * point of this function.
 *
 * The first live run dropped 32 of 69 postings on location, and roughly a third of
 * those drops were wrong: "Ishøj, Ishøj" (a Data Engineer role in Greater
 * Copenhagen), "Gentofte" (Student Data Engineer), "Taastrup", "Ballerup",
 * "Glostrup", "Roskilde", "Humlebæk", "Hørsholm". The allow-list is
 * ["copenhagen", "københavn", "remote", "denmark", "danmark"] and the old test was
 * a plain substring `includes`, so any Danish municipality that is not literally
 * named "København" or "Denmark" failed to match — and a failure to match was
 * treated as a positive mismatch and dropped the ad.
 *
 * That is the same mistake as seeding `blocking_state` with zeros (CLAUDE.md): it
 * collapses "no evidence" into a confident negative verdict. Here the correct
 * reading of "Ishøj" is *I do not know whether this is in scope*, and the honest
 * response is to let the keyword rule decide rather than to delete the row.
 *
 * So a deny now requires positive evidence — a recognised foreign country. Every
 * other unmatched string is `"unknown"` and survives. The cost is that a bare
 * foreign city ("Kraków" with no country) also survives; it still has to pass the
 * keyword gate, which is a far cheaper failure than dropping real local jobs.
 */
export function locationVerdict(location, allowed) {
  const locs = (allowed ?? []).map((x) => String(x ?? "").toLowerCase().trim()).filter(Boolean);
  const raw = String(location ?? "").toLowerCase().trim();
  if (!locs.length || !raw) return "unknown";

  if (locs.some((x) => raw.includes(x))) return "allow";

  // "København (Hybridarbejde)" / "Glostrup (På arbejdesstedet)" — LinkedIn staples
  // a work-arrangement note onto the place. Strip it before naming segments, or
  // every parenthesised location is unrecognisable.
  const segments = raw
    .replace(/\([^)]*\)/g, " ")
    .split(/[,/|·–—]| - /)
    .map((s) => collapse(s))
    .filter(Boolean);

  if (segments.some((s) => FOREIGN_COUNTRIES.has(s))) return "deny";
  return "unknown";
}

// MARK: - The cheap gate

/**
 * Rule-only screening, run BEFORE the model is ever woken.
 *
 * Same posture as `mail_rules`: a 7B model on this Mac costs seconds per posting,
 * and most of a Jobindex feed is droppable on a regex. Every drop records a
 * reason — an unexplained drop is indistinguishable from a crawler bug.
 *
 * `now` is injected rather than read from the clock so the expiry branch is
 * testable without freezing time.
 */
export function cheapGate(posting, profile, now = new Date()) {
  const hay = `${posting.title ?? ""} ${posting.description ?? ""}`.toLowerCase();

  for (const term of profile.exclude_terms ?? []) {
    if (term && termHit(hay, term))
      return { verdict: "dropped", reason: `excluded term: ${term}` };
  }

  if (posting.valid_through) {
    const vt = new Date(posting.valid_through);
    // An unparseable date must NOT read as expired — that would silently drop
    // every ad from a source with a date format we have not met yet.
    if (!Number.isNaN(vt.getTime()) && vt < now)
      return { verdict: "dropped", reason: `closed ${posting.valid_through}` };
  }

  const cats = profile.category_allow ?? [];
  if (cats.length && Array.isArray(posting.categories) && posting.categories.length) {
    if (!posting.categories.some((c) => cats.includes(c)))
      return { verdict: "dropped", reason: `category ${posting.categories.join("/")}` };
  }

  // Only a POSITIVELY foreign location drops the ad; an unrecognised one does not.
  // See `locationVerdict` — this is where 32 of 69 postings died on the first run.
  // Remote still overrides — a remote job in Oslo is viable.
  if (locationVerdict(posting.location, profile.locations) === "deny" && posting.remote !== true)
    return { verdict: "dropped", reason: `location ${posting.location}` };

  const kw = profile.keywords ?? [];
  if (kw.length) {
    // Record WHICH keyword matched. A bare "pass" made the first run's one stored
    // row unexplainable: an architecture-school ad passed the Game Dev profile and
    // it took a database round-trip and a local replay to discover the ad really
    // does say "erfaring med unity, unreal, blender 3d" — it is a gamelab job. The
    // verdict was right; the record of it was simply silent about why.
    const hit = kw.find((k) => termHit(hay, k));
    if (!hit) return { verdict: "dropped", reason: "no profile keyword present" };
    return { verdict: "pass", reason: `keyword: ${hit}` };
  }

  return { verdict: "pass", reason: null };
}

export const __internal = { htmlToText, metaContent, decodeEntities, collapse };
