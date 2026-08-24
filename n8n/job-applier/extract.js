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
 */

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
      source_kind: "jobindex_rss",
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
    // "Bjerringbro, Hybrid position" / "Copenhagen (Hybrid)" — one field, two facts.
    location: areaText,
    remote: areaText ? /hybrid|remote|hjemmearbejde|distance/i.test(areaText) : null,
    lead: metaContent(h, "og:description"),
    target_url: target && !NON_AD_HOSTS.test(target) ? target : null,
  };
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

  const locs = profile.locations ?? [];
  if (locs.length && posting.location) {
    const l = posting.location.toLowerCase();
    const hit = locs.some((x) => l.includes(String(x).toLowerCase()));
    // Remote overrides a location miss — a remote job in Aarhus is still viable.
    if (!hit && posting.remote !== true)
      return { verdict: "dropped", reason: `location ${posting.location}` };
  }

  const kw = profile.keywords ?? [];
  if (kw.length && !kw.some((k) => termHit(hay, k)))
    return { verdict: "dropped", reason: "no profile keyword present" };

  return { verdict: "pass", reason: null };
}

export const __internal = { htmlToText, metaContent, decodeEntities, collapse };
