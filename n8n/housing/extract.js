/**
 * Housing-listing extraction — the canonical implementation.
 *
 * Pure, dependency-free, and deliberately regex-based rather than DOM-based: this
 * file is inlined verbatim into n8n Code nodes, which have no npm modules and no
 * DOM. `n8n/housing/README.md` describes the generated copies that must stay in
 * sync, and `build-housing.mjs` is the only thing allowed to make them.
 *
 * It is a sibling of `n8n/job-applier/extract.js` and repeats a handful of its
 * small helpers (`decodeEntities`, `collapse`, `htmlToText`, `metaContent`).
 * That duplication is deliberate: both files must have **zero imports** so the
 * builders' nine-line "strip `export `" transform stays obviously correct, and
 * this folder sits outside the npm workspace globs for the same reason the job
 * folder does.
 *
 * # Three sources, three completely different shapes
 *
 * Probed live 2026-09-06 (single fetches, nothing logged into, nothing submitted).
 * `HOUSING_PLAN.md` carries the full reconnaissance; the parts that decide code:
 *
 *   - **lejebolig.dk** — a detail page carries a real schema.org
 *     `RealEstateListing`. It is the ONLY one of five private portals that does.
 *     Verified fields: `identifier.value`, `datePosted`, `offers.price`,
 *     `itemOffered.numberOfRooms`, `itemOffered.floorSize.value` (unitCode `MTK`),
 *     `itemOffered.address.{streetAddress,addressLocality,postalCode}`.
 *     **No coordinates and no description** — see `cheapGateHousing`.
 *   - **boligzonen.dk** — zero ld+json. Everything is server-rendered HTML in a
 *     regular `section-bar-label` / `section-bar-value` pair list, plus a
 *     `<p class="description show-more-content">` body. Discovery is the gzipped
 *     sitemap, whose `<lastmod>` is the only real timestamp the source publishes
 *     (the page itself says "I går").
 *   - **mit.s.dk** — a public JSON API. Not an extractor at all; a field rename.
 *
 * Do not try to unify the first two. The job pipeline's header records the same
 * correction being forced on it after the fact, for the same reason.
 *
 * # One rule runs through the whole file
 *
 * **Absent is never a verdict.** A listing with no coordinates is not outside the
 * radius, a listing with no rent is not over budget, and a listing with no
 * `posted_at` is not new. Every one of those is *unknown*, passes the gate with a
 * flag, and is rendered as unknown in the email. The alternative — a confident
 * `false` computed from missing data — is the `blocking_state`-seeding mistake
 * that CLAUDE.md records three separate outings of.
 */

// MARK: - Source kinds
//
// ⚠️ These strings are the seen-set key prefix, and the server never recomputes
// them. `housing-ingest` answers `{action:"config"}` with
// `seen: ["<source_kind> <external_id>", …]`, so a lane that spells its kind
// differently from the rows it wrote gets a seen-set that never matches — and a
// never-matching seen set is not an error, it is a lane that re-fetches and
// re-posts the same listings forever while every run stays green.
//
// The job pipeline lost a whole lane to exactly this (`gmail_alert` singular in
// one vocabulary, `gmail_alerts` plural in another; 28 postings became 0 rows and
// the run finished green). Written once, here, so a Code node body never inlines
// the literal.
// ⚠️⚠️ `lejebolig_jsonld`, **not** `lejebolig_search`. `HOUSING_PLAN.md` §3 names
// the source kind `lejebolig_search`; `housing-ingest`'s `LISTING_SOURCE_KINDS`
// allow-list says `lejebolig_jsonld`, and the server is the one that rejects. A
// listing posted under the plan's spelling comes back in `rejected` with
// `invalid_source_kind` — reported in the response body, not as a failure, so the
// run finishes green with nothing stored. This is the job pipeline's lost lane,
// verbatim, and it was live in this file for one draft.
export const SOURCE_KIND = {
  lejebolig: "lejebolig_jsonld",
  boligzonen: "boligzonen_sitemap",
  sdk: "sdk_api",
  // BoligPortal, findbolig.nu and akutbolig reach us as their own alert emails on
  // the existing mail bus. Nothing in this file fetches them — see the README.
  mailAlert: "mail_alert",
};

/** Politeness cap: detail fetches one run may make per race source. */
export const MAX_DETAIL_FETCHES = 20;

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
  // `[^>]*` is load-bearing, not tidiness. boligzonen writes
  // `<br class="d-lg-block d-none" />` inside its address line; a bare
  // `/<br\s*\/?>/` misses it, the tag falls through to the generic strip, and the
  // street and the postcode arrive as ONE line — whereupon the postcode parse
  // finds nothing and `zipcode` comes back null on every listing from the source.
  t = t.replace(/<br\b[^>]*>/gi, "\n");
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

/**
 * Parse a Danish-formatted number: `21.800,-` → 21800, `8.950 kr.` → 8950,
 * `29 m²` → 29, `1.234,56` → 1234.56.
 *
 * `.` is the thousands separator and `,` the decimal one — the opposite of the
 * English convention, which is why `parseFloat("21.800")` returns **21.8** and a
 * naive read turns a 21,800 kr. flat into one that costs 21 kroner and sails
 * through every budget gate ever written.
 *
 * Returns `null`, never `0` or `NaN`, when there is no number to read. A rent of
 * `0` is a real (if odd) value; "we could not find the rent" is not.
 */
export function parseDanishNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const s = String(value ?? "");
  const m = /-?\d[\d.\u00a0\u202f ]*(?:,\d+)?/.exec(s.replace(/\u2212/g, "-"));
  if (!m) return null;
  const cleaned = m[0]
    .replace(/[\u00a0\u202f ]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Coerce to a finite number or null. `Number(null)` is 0; that is the trap. */
function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// MARK: - lejebolig.dk — search page

/**
 * Every listing id linked from a lejebolig search/list page.
 *
 * Listing URLs are `/lejebolig/{id}/{slug}` with **sequential numeric ids**
 * (…1908105, 1908107, 1908108, 1908111 in one live capture), which is what makes
 * the high-water mark in `nextIdRange` cheap enough that a steady-state poll costs
 * exactly one request.
 *
 * Each listing is linked more than once per card (image + title), so results are
 * deduped by id and returned **newest first** — i.e. highest id first, which for a
 * sequential-id source is the same statement. Verified 2026-09-06: 78 anchors, 39
 * distinct listings.
 *
 * The search page's own ld+json is `BreadcrumbList` / `Place` / `FAQPage` /
 * `CollectionPage` — there is no per-listing JSON-LD here. That lives one fetch
 * further on, which is why this returns ids rather than rows.
 */
export function parseLejeboligSearch(html) {
  const h = String(html ?? "");
  const byId = new Map();
  for (const m of h.matchAll(/\/lejebolig\/(\d{4,})\/([a-z0-9\-]*)/gi)) {
    const id = m[1];
    if (byId.has(id)) continue;
    byId.set(id, {
      external_id: id,
      slug: m[2] || "",
      url: `https://www.lejebolig.dk/lejebolig/${id}/${m[2] || ""}`.replace(/\/$/, ""),
    });
  }
  return [...byId.values()].sort((a, b) => Number(b.external_id) - Number(a.external_id));
}

/**
 * Decide which of a batch of sequential ids to fetch this run.
 *
 * Returns `{ take, fresh, stale, deferred, max_id, high_water }`.
 *
 * # What the high-water mark is, and what it is NOT
 *
 * It is a **floor**, not a cursor. The caller passes `max(numeric ids already in
 * the server's seen set)`, so anything at or below it is an id we have already
 * ingested — or one that was already older than something we ingested. It is not
 * a resumable position, and nothing here writes it back.
 *
 * # Why `take` is newest-first, and why the leftovers are dropped rather than queued
 *
 * The job harvester caps its batch and lets the backlog drain over several runs,
 * taking the oldest first so the cursor advances contiguously. That is right for
 * jobs, where an ad is live for weeks.
 *
 * It is wrong here. Lane B's entire product is latency: a listing's useful life is
 * measured in hours, "38 min. siden" is a normal top-of-list value, and a listing
 * reached on the fourth run of a backlog drain is a listing someone else has
 * already taken. So the cap takes the **newest** ids, and the ones it could not
 * reach are counted as `deferred` and reported rather than silently queued — the
 * next run's floor will have moved past them.
 *
 * `deferred > 0` on consecutive runs is the actionable signal: either the cap is
 * too low or the poll is too slow. It is printed by the workflow for exactly that
 * reason; a cap that quietly eats listings is indistinguishable from a dead source.
 *
 * # A missing mark is unknown, not "everything is new"
 *
 * With no mark (first run, or a source whose rows were wiped) the honest position
 * is that we know nothing about what has been seen. The only safe action for
 * *unknown* is the same as the safe action for a first run: take the newest `cap`
 * and let the next run's real mark do the work. `high_water: false` says so out
 * loud rather than pretending the floor was 0 and calling 8,000 ids "fresh".
 */
export function nextIdRange(lastSeenMax, batch, { cap = MAX_DETAIL_FETCHES, seen = null } = {}) {
  const list = Array.isArray(batch) ? batch : [];
  const seenSet = seen instanceof Set ? seen : Array.isArray(seen) ? new Set(seen) : null;
  const floor = num(lastSeenMax);
  const highWater = floor !== null;

  const rows = list
    .map((b) => (b && typeof b === "object" ? b : { external_id: b }))
    .filter((b) => b.external_id !== null && b.external_id !== undefined && b.external_id !== "");

  let stale = 0;
  const candidates = [];
  for (const row of rows) {
    if (seenSet && seenSet.has(String(row.external_id))) {
      stale++;
      continue;
    }
    const id = num(row.external_id);
    // A non-numeric id cannot be compared to the floor. It is therefore *unknown*
    // rather than old, and stays a candidate — dropping it would make the lane's
    // yield depend on an id format nobody has committed to.
    if (highWater && id !== null && id <= floor) {
      stale++;
      continue;
    }
    candidates.push({ ...row, _n: id });
  }

  candidates.sort((a, b) => {
    if (a._n === null) return 1;
    if (b._n === null) return -1;
    return b._n - a._n;
  });

  const take = candidates.slice(0, Math.max(0, cap)).map(({ _n, ...row }) => row);
  const ids = rows.map((r) => num(r.external_id)).filter((n) => n !== null);

  return {
    take,
    fresh: candidates.length,
    stale,
    deferred: candidates.length - take.length,
    max_id: ids.length ? Math.max(...ids) : null,
    high_water: highWater,
  };
}

// MARK: - lejebolig.dk — detail page (schema.org RealEstateListing)

/**
 * Pull the first schema.org `RealEstateListing` out of a page's ld+json blocks.
 *
 * A block may be a bare object, an array, or a `@graph` wrapper — all three are in
 * the wild, and a parser that handles only the first silently returns null on the
 * other two, which looks exactly like "this page has no JSON-LD". lejebolig emits
 * a `BreadcrumbList` array *and* the listing, so the array case is not theoretical
 * here; it is the observed shape.
 */
export function extractRealEstateListingLd(html) {
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
      if (types.includes("RealEstateListing")) return node;
    }
  }
  return null;
}

const firstOf = (v) => (Array.isArray(v) ? v[0] : v);

/**
 * Normalize a lejebolig.dk detail page into the ingest listing shape.
 *
 * Returns null when the page carries no `RealEstateListing`. Null is a **skip**,
 * not a fallback: a row with a title and no rent would sail through the budget
 * gate on a technicality (rent unknown ⇒ pass) and land in the notify queue as a
 * listing nobody can price. Skipping is honest; guessing is not.
 *
 * Two fields the JSON-LD does not carry, and neither does the page (verified
 * 2026-09-06 — the string `latitude` does not occur anywhere in a detail page):
 *
 *   - **coordinates.** `lat`/`lng` are null, and `cheapGateHousing` therefore
 *     passes every lejebolig listing on distance with a `coords_missing` flag.
 *     That is not a gap to be closed with a geocoder guess; it is the reason the
 *     gate has the flag.
 *   - **a body.** `og:description` is boilerplate ("… sat til leje den 06-09-2026.
 *     Sagsnummer: …"), so the real text is read out of the `lease-text` block.
 */
export function parseLejeboligJsonLd(html, { url = null } = {}) {
  const h = String(html ?? "");
  const ld = extractRealEstateListingLd(h);
  if (!ld) return null;

  const item = ld.itemOffered ?? {};
  const addr = firstOf(item.address) ?? {};
  const offer = firstOf(ld.offers) ?? {};

  const externalId =
    String(ld.identifier?.value ?? ld.identifier ?? "") ||
    (/\/lejebolig\/(\d{4,})\//.exec(ld.url ?? ld["@id"] ?? url ?? "") ?? [])[1] ||
    null;

  const street = collapse(addr.streetAddress) || null;
  const zipcode = collapse(addr.postalCode) || null;
  const city = collapse(addr.addressLocality) || null;
  const address = [street, [zipcode, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

  const rent = parseDanishNumber(offer.price ?? null);
  const sqm = parseDanishNumber(item.floorSize?.value ?? null);
  const rooms = parseDanishNumber(item.numberOfRooms ?? null);

  return {
    source_kind: SOURCE_KIND.lejebolig,
    external_id: externalId,
    url: collapse(ld.url ?? ld["@id"] ?? url) || null,
    title: collapse(ld.name ?? ld.headline) || null,
    rent,
    address,
    zipcode,
    // Not published. Left null so the gate flags it rather than inventing a point.
    lat: null,
    lng: null,
    rooms,
    sqm,
    posted_at: collapse(ld.datePosted) || null,
    description: extractLejeboligDescription(h),
    dedupe_key: dedupeKeyHousing(address, rent),
    // `itemOffered["@type"]` is schema.org's own word for the dwelling
    // ("Apartment", "House", "SingleFamilyResidence") and is a better signal than
    // a Danish title, so it goes in as the explicit type. `rooms` is what splits
    // studio from apartment — pass it, or a 1-room flat files as an apartment.
    housing_type: deriveHousingType({
      housing_type: typeof item["@type"] === "string" ? item["@type"] : null,
      title: ld.name,
      rooms,
    }),
    // Not in the JSON-LD, and the prose figure ("depositum er 26.850 kr.") is not
    // worth a regex: getting a deposit wrong by an order of magnitude is worse
    // than not having one.
    deposit: null,
    available_from: null,
  };
}

/**
 * The ad body from a lejebolig detail page.
 *
 * Lives inside a `lease-text` container, as the **first child `<div>`**: bare
 * text separated by `<br />`, with no paragraph tags at all. Everything after it
 * is the fact lists (`<ul id="lease-deposit">`, `lease-time`, `lease-pets`,
 * `lease-casenumber`), which the JSON-LD already gave us in structured form.
 *
 * The end of the block matters as much as the start, and the obvious
 * implementation gets both wrong. "Find `lease-text`, slice 20 kB forward, strip
 * tags" starts at the `class=` match rather than after the opening tag — so the
 * rest of the attribute list (`col-sm-7 col-sm-pull-5 …`) becomes the
 * description's first line — and it has no end, so it runs past the ad into the
 * site footer and returns "Kundeservice / Guides / Vilkår / Persondatapolitik /
 * CVR-nr. 27258948".
 *
 * That is not merely ugly. `cheapGateHousing` matches `exclude_terms` against the
 * description, so a footer word in every row is an exclusion rule that fires on
 * every listing from the source, for reasons nobody would ever look in a footer
 * to find. Same class of bug as the Jobindex cookie banner that became a job ad's
 * description, and the reason the job extractor carries a `BOILERPLATE` filter.
 *
 * Falls back to `og:description`, which on this source is a one-line stub ("… sat
 * til leje den 06-09-2026. Sagsnummer: …") — thin, but honest and short enough
 * that it cannot poison a keyword match.
 *
 * Returns null rather than "" when there is nothing: an empty string is a real
 * value ("the ad has no body"), null is "we did not find one", and only the
 * second should be re-tried by a future extractor change.
 */
export function extractLejeboligDescription(html) {
  const h = String(html ?? "");
  const at = /class=["'][^"']*lease-text[^"']*["'][^>]*>/i.exec(h);
  if (at) {
    // Bounded slice: this runs in a Code node on a Mac that is also running
    // Ollama, and an unbounded scan over a 300 kB page is a stall nobody
    // attributes to the right cause.
    const start = at.index + at[0].length;
    const region = h.slice(start, start + 20000);
    const inner = /<div\b[^>]*>([\s\S]*?)<\/div>/i.exec(region);
    if (inner) {
      const text = htmlToText(inner[1]);
      if (text.length > 60) return text;
    }
    // Layout moved: keep everything up to the first fact list rather than
    // everything up to the byte cap. A wrong-but-bounded description beats a
    // description that is 80% footer.
    const cut = region.search(/<ul\b/i);
    if (cut > 0) {
      const text = htmlToText(region.slice(0, cut));
      if (text.length > 60) return text;
    }
  }
  const og = metaContent(h, "og:description");
  return og ? collapse(og) : null;
}

// MARK: - boligzonen.dk — sitemap

/**
 * Parse boligzonen's sitemap into `{ url, lastmod, external_id }`.
 *
 * ⚠️ **The published sitemap is gzip, and it is gzip as a Content-Type
 * (`application/x-gzip`), not as a Content-Encoding.** Nothing in the HTTP stack
 * unwraps it for you: `curl --compressed` does not, and neither does n8n's HTTP
 * node, which will hand a "text" response the raw DEFLATE bytes. Feeding those to
 * this function yields `[]` — a silently dead lane, green every run. The workflow
 * therefore fetches it as a **file** and puts an n8n Compression node in front,
 * and the Code node throws loudly if what arrives does not start with `<`.
 * There is no uncompressed twin: `/sitemaps/boligzonen-dk.xml` 302s to an HTML
 * page (verified 2026-09-06).
 *
 * # `lastmod` is the only real timestamp this source has
 *
 * The detail page renders "Oprettet / Opdateret: **I går**" — a relative phrase,
 * not a date. So `posted_at` for every boligzonen listing comes from here and is
 * carried forward into `extractBoligzonenListing`. Losing it means the notify
 * email cannot say how old a listing is, which on a race lane is most of the
 * email's value.
 *
 * Verified 2026-09-06: 10,675 `<url>` blocks, of which 8,757 are
 * `/lejeboliger/<slug>` listings; every one carries a `<lastmod>`.
 */
export function parseBoligzonenSitemap(xml) {
  const out = [];
  const blocks = String(xml ?? "").match(/<url>[\s\S]*?<\/url>/gi) ?? [];
  for (const block of blocks) {
    const loc = /<loc>([\s\S]*?)<\/loc>/i.exec(block);
    if (!loc) continue;
    const url = decodeEntities(collapse(loc[1]));
    if (!/\/lejeboliger\//.test(url)) continue;
    const lastmod = /<lastmod>([\s\S]*?)<\/lastmod>/i.exec(block);
    // The slug ends in a short hex discriminator (`…-i-kobenhavn-k-eb1617`). It is
    // stable per listing and is the only id available before the page is fetched,
    // so it is what the seen-set is keyed on at discovery time. The page's own
    // `data-id` is preferred once we have the page — see `extractBoligzonenListing`.
    const slug = (url.split("/").filter(Boolean).pop() ?? "").trim();
    out.push({
      url,
      lastmod: lastmod ? collapse(lastmod[1]) : null,
      external_id: slug || null,
    });
  }
  return out;
}

/**
 * Pick the decompressed sitemap out of whatever the Compression node produced.
 *
 * `candidates` is `[{ key, text }]` — one entry per binary property, already
 * decoded to a string by the caller (only the caller can do that: reading binary
 * in n8n depends on the instance's binary-data mode, which is a runtime concern
 * and not something a pure file can know).
 *
 * # Why this is a function at all, and why it is tested
 *
 * The first live run died here, in a hand-rolled inline version of exactly this
 * rule, with `Binary keys: file_0` — the property existed and its decoded text
 * was not XML. Two call sites now need the same answer (the picker, and the
 * end-of-run lane check), and a second hand-rolled copy of "which property is the
 * sitemap" is the duplication this whole build step exists to prevent.
 *
 * # The rule
 *
 * Take the first property whose text starts with `<`. Not the first property, not
 * the one named `file_0`: n8n's Compression node names its gunzip output after
 * `outputPrefix` + an index, and the HTTP node's own `data` property (the still-
 * gzipped bytes) travels alongside it. Sniffing the content is the only rule that
 * does not depend on a naming convention n8n is free to change.
 *
 * Returns `{ ok: false, reason, keys }` rather than throwing. The caller decides
 * whether a dead sitemap is fatal — and in `housing-harvest` it deliberately is
 * not, because a throw here took the lejebolig branch's results down with it and
 * zero rows landed from a run where one of two lanes was perfectly healthy.
 */
export function sitemapXmlFromCandidates(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const keys = list.map((c) => (c && c.key !== undefined ? String(c.key) : "?"));
  if (!list.length) return { ok: false, reason: "no_binary", keys };

  for (const c of list) {
    const text = typeof c?.text === "string" ? c.text : "";
    if (text.trimStart().startsWith("<")) return { ok: true, xml: text, key: String(c.key) };
  }

  // Say WHICH failure it was. "Empty" and "still gzipped" have different fixes:
  // the first is a binary-data-mode problem (the bytes live on disk and `.data`
  // is a reference, not base64), the second means the Compression node did not
  // run or did not recognise the archive.
  const detail = list
    .map((c) => {
      const text = typeof c?.text === "string" ? c.text : "";
      // 0x1f 0x8b is the gzip magic number.
      const gz = text.charCodeAt(0) === 0x1f && text.charCodeAt(1) === 0x8b;
      return `${c?.key}=${text.length === 0 ? "empty" : gz ? "still-gzip" : `${text.length}b:${JSON.stringify(text.slice(0, 24))}`}`;
    })
    .join(" ");
  return { ok: false, reason: `no_xml_property (${detail})`, keys };
}

/**
 * How stale the sitemap itself is, in minutes, or null if nothing in it is dated.
 *
 * Worth logging every run: it is the number that explains an empty lane, and
 * without it "boligzonen: 0 new" is indistinguishable from a broken parser.
 */
export function boligzonenSitemapAgeMinutes(entries, now = new Date()) {
  let newest = null;
  for (const e of Array.isArray(entries) ? entries : []) {
    const t = e && e.lastmod ? new Date(e.lastmod).getTime() : NaN;
    if (!Number.isNaN(t) && (newest === null || t > newest)) newest = t;
  }
  if (newest === null) return null;
  return Math.max(0, Math.round((new Date(now).getTime() - newest) / 60000));
}

/**
 * The newest slice of the sitemap, newest first.
 *
 * ## ⚠️ The window is anchored on the FILE, not on the clock
 *
 * This is the whole correction, and it took a live run to find. The first version
 * kept entries within `windowMinutes` of **`now`**, on the assumption that a
 * sitemap advertised for crawling is regenerated continuously. **It is not.**
 * Measured 2026-09-06 at 21:20 UTC: boligzonen's newest `<lastmod>` was
 * `2026-09-05T15:24:27Z` and the file's own `Last-Modified` header agreed to the
 * second — **30 hours stale**. It is rebuilt roughly daily.
 *
 * So a 45-minute clock window matched nothing, and would have matched nothing on
 * every run forever: a lane that harvests zero listings for the rest of time,
 * reporting success, which is the exact failure mode this pipeline keeps writing
 * guards against. Nothing in a fixture could have shown it — fixture timestamps
 * are frozen, and the tests that covered this function used synthetic dates that
 * were "recent" by construction.
 *
 * Anchoring on `max(lastmod)` makes the window mean *"the newest listings this
 * file knows about"* regardless of how often the file is rebuilt, and it
 * self-corrects if boligzonen ever speeds up or slows down. A stale file is
 * **not** evidence of no new listings; it is evidence of a stale file.
 *
 * The anchor is clamped to `now` so a future `lastmod` (clock skew, or a portal
 * stamping forward) cannot open the window into next week.
 *
 * ## What actually limits traffic
 *
 * Not this. The window is generous on purpose — the real limiters are the
 * seen-set (an entry fetched once is never fetched again) and `nextIdRange`'s cap
 * of 20 detail fetches per run. Widening the window costs nothing but a longer
 * candidate list; narrowing it costs listings, silently.
 *
 * **An entry with no `lastmod` is kept, not dropped.** It is not "old" — it is
 * undated, and on a source where the sitemap is the only clock, discarding the
 * undated ones would silently narrow the lane to whatever boligzonen happens to
 * timestamp. They sort last, so they only consume budget the dated ones did not.
 */
export function boligzonenWindow(entries, { now = new Date(), windowMinutes = 180 } = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const nowMs = new Date(now).getTime();

  let newest = null;
  for (const e of list) {
    const t = e && e.lastmod ? new Date(e.lastmod).getTime() : NaN;
    if (!Number.isNaN(t) && (newest === null || t > newest)) newest = t;
  }
  const anchor = newest === null ? nowMs : Math.min(newest, nowMs);
  const cutoff = anchor - windowMinutes * 60 * 1000;

  const dated = [];
  const undated = [];
  for (const e of list) {
    const t = e && e.lastmod ? new Date(e.lastmod).getTime() : NaN;
    if (Number.isNaN(t)) {
      undated.push({ ...e, _t: null });
      continue;
    }
    if (t >= cutoff) dated.push({ ...e, _t: t });
  }
  dated.sort((a, b) => b._t - a._t);
  return [...dated, ...undated].map(({ _t, ...e }) => e);
}

// MARK: - boligzonen.dk — detail page (server-rendered HTML, no JSON-LD)

/**
 * Every `section-bar-label` / `section-bar-value` pair on a boligzonen page, as a
 * label → value map.
 *
 * The page renders its facts twice — a compact card in the header ("Månedlig
 * husleje", "Oprettet / Opdateret", "Ledig fra", "Valideret annonce") and the full
 * "Boligens detaljer" table below ("Boligtype", "Antal værelser", "Størrelse",
 * "Husleje", "Aconto", "Depositum", "Lejeperiode", "Ledig fra", "Elevator",
 * "Altan", "Møbleret", "Delevenlig"). Reading both into one map is why this needs
 * no positional assumptions at all: a layout change that moves a fact from one
 * block to the other costs nothing.
 *
 * Later pairs win, so the detail table's precise "Husleje" beats the header's
 * "Månedlig husleje" when both are present and they ever disagree.
 */
export function boligzonenFacts(html) {
  const facts = {};
  const re =
    /class=["'][^"']*section-bar-label[^"']*["'][^>]*>([\s\S]*?)<\/div>[\s\S]{0,200}?class=["'][^"']*section-bar-value[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while ((m = re.exec(String(html ?? ""))) !== null) {
    const label = collapse(decodeEntities(m[1].replace(/<[^>]+>/g, " ")));
    const value = collapse(decodeEntities(m[2].replace(/<[^>]+>/g, " ")));
    if (label) facts[label] = value;
  }
  return facts;
}

/**
 * Normalize a boligzonen detail page into the ingest listing shape.
 *
 * `lastmod` comes from the sitemap and becomes `posted_at` — the page itself only
 * says "I går". Pass it; omitting it does not produce a slightly worse row, it
 * produces a listing the notify email has to render as "age unknown", which is
 * most of what a race-lane email is for.
 *
 * Coordinates are not published here either (`latitude` does not occur in the
 * page source), so `lat`/`lng` stay null and the gate flags it. Same as lejebolig.
 */
export function extractBoligzonenListing(html, { url = null, lastmod = null } = {}) {
  const h = String(html ?? "");
  const facts = boligzonenFacts(h);

  // ⚠️ **The slug wins, and the numeric id loses.** This looks backwards: the page
  // carries `data-id="8169434"` on `property-head` and repeats it as
  // "Sagsnummer: 8169434", and that is unquestionably boligzonen's own stable id,
  // while the slug is a URL artefact that changes if a title is ever re-slugged.
  //
  // But `external_id` is not just an identifier here — it is the **seen-set key**.
  // `housing-ingest` returns `seen: ["<source_kind> <external_id>", …]`, and the
  // only thing discovery has before it fetches a page is the sitemap, which
  // publishes URLs and nothing else. Keying ingest on the numeric id and discovery
  // on the slug means the two never meet: every run re-fetches every listing it
  // has ever seen and re-posts it, forever, and every run finishes green.
  //
  // So the rule is: **`external_id` must be the string discovery can compute.**
  // The cost of the slug is one duplicate row on the day boligzonen re-titles an
  // ad. The cost of the numeric id is a lane that never dedupes at all.
  const slug = url ? (String(url).split("/").filter(Boolean).pop() || null) : null;
  const dataId =
    (/class=["'][^"']*property-head[^"']*["'][^>]*\bdata-id=["'](\d+)["']/i.exec(h) ??
      /\bdata-id=["'](\d+)["']/i.exec(h) ??
      [])[1] ?? null;
  const sag = /Sagsnummer:\s*(\d+)/i.exec(h);
  const externalId = slug || dataId || (sag ? sag[1] : null);

  // `<p class="address-line">Peder Skrams Gade, <br />1054 København</p>`
  const addrBlock = /class=["'][^"']*address-line[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(h);
  const addrLines = addrBlock
    ? htmlToText(addrBlock[1])
        .split("\n")
        .map((l) => collapse(l.replace(/,\s*$/, "")))
        .filter(Boolean)
    : [];
  let zipcode = null;
  let city = null;
  const streetParts = [];
  for (const line of addrLines) {
    // Two shapes, because the `<br>` between street and postcode carries classes
    // and an older tag-stripper flattened them into one line. Handle both: a line
    // that IS a postcode line, and a postcode line trailing a street on one line.
    const own = /^(\d{4})\s+(.+)$/.exec(line);
    if (own) {
      zipcode = own[1];
      city = collapse(own[2]);
      continue;
    }
    const trailing = /^(.*?),?\s*(\d{4})\s+([^,\d]+)$/.exec(line);
    if (trailing && trailing[1].trim()) {
      streetParts.push(collapse(trailing[1].replace(/,\s*$/, "")));
      zipcode = trailing[2];
      city = collapse(trailing[3]);
      continue;
    }
    streetParts.push(line);
  }
  const street = streetParts.join(" ") || null;
  const address = [street, [zipcode, city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;

  // `<h2>3 værelses lejlighed på 87 m<sup>2</sup></h2>` — the fallback for rooms
  // and size when the detail table is absent.
  const headline = (/class=["'][^"']*property-facts-card[^"']*["'][^>]*>[\s\S]{0,400}?<h2[^>]*>([\s\S]*?)<\/h2>/i.exec(
    h,
  ) ?? [])[1];
  const headlineText = headline ? collapse(decodeEntities(headline.replace(/<[^>]+>/g, ""))) : "";

  const rent = parseDanishNumber(facts["Husleje"] ?? facts["Månedlig husleje"] ?? null);
  const rooms =
    parseDanishNumber(facts["Antal værelser"] ?? null) ??
    parseDanishNumber((/(\d+)\s*værelses/i.exec(headlineText) ?? [])[1] ?? null);
  const sqm =
    parseDanishNumber(facts["Størrelse"] ?? null) ??
    parseDanishNumber((/(\d+)\s*m\s*2?/i.exec(headlineText) ?? [])[1] ?? null);

  const title =
    metaContent(h, "og:title") ||
    headlineText ||
    collapse((/<title>([\s\S]*?)<\/title>/i.exec(h) ?? [])[1]) ||
    null;

  const desc = /class=["'][^"']*show-more-content[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(h);
  const description = desc
    ? htmlToText(desc[1]) || null
    : (() => {
        // og:description is prefixed with "Lejlighed - København - 21800 kr - ".
        // Stripping it keeps the facts from being counted twice by anything that
        // later greps the body.
        const og = metaContent(h, "og:description");
        return og ? collapse(og).replace(/^[^-]{0,40}-[^-]{0,40}-\s*[\d.]+\s*kr\s*-\s*/i, "") : null;
      })();

  return {
    source_kind: SOURCE_KIND.boligzonen,
    external_id: externalId,
    url: collapse(url) || null,
    title,
    rent,
    address,
    zipcode,
    lat: null,
    lng: null,
    rooms,
    sqm,
    // From the sitemap. The page's "I går" is a phrase, not a date.
    posted_at: lastmod ? collapse(lastmod) : null,
    description,
    dedupe_key: dedupeKeyHousing(address, rent),
    housing_type: deriveHousingType({
      housing_type: facts["Boligtype"] ?? null,
      title,
      description,
      rooms,
    }),
    deposit: parseDanishNumber(facts["Depositum"] ?? null),
    // "Snarest muligt" is not a date, and the server's `coerceDate` will store
    // null for it. Passing the phrase through is still right: the alternative is
    // this file deciding what "as soon as possible" means as a date.
    available_from: facts["Ledig fra"] ?? null,
    // No columns for these, so `toIngestListing` strips them. Kept on the row
    // because the gate may want them and because dropping a fact at extraction
    // time means re-probing a live site to get it back.
    shared: facts["Delevenlig"] ? /^ja$/i.test(facts["Delevenlig"]) : null,
    furnished: facts["Møbleret"] ? /^ja$/i.test(facts["Møbleret"]) : null,
  };
}

// MARK: - mit.s.dk — a field rename, not an extractor

/**
 * Normalize mit.s.dk building objects into the `buildings_sync` shape.
 *
 * Accepts `{count, results}`, a bare array, or a single object, and accepts both
 * of the API's two shapes for the same building:
 *
 *   - **search** (`/public/buildings/search/`) — `min_rent` / `max_rent` as
 *     floats, `latitude` / `longitude` as numbers, `committee_abbreviation`.
 *     No `is_ssl_enabled`, no `administrator`.
 *   - **detail** (`/public/buildings/{pk}/`) — `rent_range {min,max}`,
 *     `latitude` / `longitude` as **strings**, `app_committee {…}`,
 *     `administrator {…}`, `is_ssl_enabled`.
 *
 * The workflow only calls the search endpoint (38 buildings = 4 paginated calls a
 * day; 38 detail fetches would be a tenfold increase in traffic for a catalogue
 * that does not change hourly). So `ssl_eligible` and `administrator` come back
 * **null**, meaning *not known from this call* — never `false`, which would read
 * as "checked, not eligible" and is exactly the collapse this file exists to
 * avoid. Handling both shapes costs nothing and means adding the detail sweep
 * later is a workflow change with no parser change.
 *
 * # `shortWaitPks` has three states and they are all different
 *
 * `/public/buildings/short-wait-time/` is an exhaustive list, so *absence from a
 * successful call* is real evidence of `short_wait: false`. But a **failed** call
 * is not evidence of anything, and marking all 38 buildings `false` because one
 * request timed out would quietly retract every short-wait flag in the database.
 *
 *   - `null` / omitted → `short_wait: null` for every building (call not made or
 *     failed; unknown).
 *   - a Set/array of pks → `true` for members, `false` for everyone else.
 *
 * ⚠️ `tenancies_count` is the number of units in the building, **not vacancies**.
 * Lane A publishes no vacancy concept at all. It is kept only inside `raw`, so
 * nothing can render "42 available" from a field that means "42 flats exist".
 */
export function parseSdkBuildings(json, { shortWaitPks = null } = {}) {
  const src = json && typeof json === "object" ? json : {};
  const rows = Array.isArray(json)
    ? json
    : Array.isArray(src.results)
      ? src.results
      : src.pk !== undefined
        ? [src]
        : [];

  const shortSet =
    shortWaitPks instanceof Set
      ? shortWaitPks
      : Array.isArray(shortWaitPks)
        ? new Set(shortWaitPks.map((p) => String(p)))
        : null;

  return rows
    .filter((b) => b && b.pk !== undefined && b.pk !== null)
    .map((b) => {
      const pk = String(b.pk);
      const rentMin = num(b.min_rent) ?? num(b.rent_range?.min);
      const rentMax = num(b.max_rent) ?? num(b.rent_range?.max);
      return {
        source_kind: SOURCE_KIND.sdk,
        external_id: pk,
        name: collapse(b.name) || null,
        // `desc_address` is a prose address ("Aldersrogade, Rovsingsgade,
        // Vermundsgade" for a three-street complex). It is the only address the
        // API publishes; do not try to split it into a street and a number.
        address: collapse(b.desc_address) || null,
        zipcode: collapse(b.zipcode) || null,
        lat: num(b.latitude),
        lng: num(b.longitude),
        rent_min: rentMin,
        rent_max: rentMax,
        short_wait: shortSet ? shortSet.has(pk) : null,
        ssl_eligible: b.is_ssl_enabled === undefined ? null : Boolean(b.is_ssl_enabled),
        administrator: b.administrator ?? null,
        raw: b,
      };
    });
}

// MARK: - Egmont Kollegiet — application round watcher

/**
 * Egmont Kollegiet (egmontkollegiet.dk) is the prime kollegie next to campus,
 * and unlike every lane above it takes applications in ROUNDS, not a rolling
 * waitlist. There is no feed, no API and no historical log of past rounds —
 * the only signal the site publishes is a sentence of prose on the homepage:
 * "Ansøgningsrunden er lukket." while a round is shut. Whatever it says when a
 * round is OPEN has never been observed and is not worth guessing at, so this
 * function recognises exactly one thing and treats everything else the same.
 *
 * # The polarity is deliberately inverted from `cheapGateHousing`
 *
 * That gate's rule is "only positive evidence drops" — an unrecognised signal
 * passes quietly, because the miss there (a radius check with no coordinates)
 * would otherwise kill an entire lane, silently, forever. Here the failure
 * this function exists to catch is the opposite shape: a watcher that stays
 * quiet whenever it doesn't recognise the page is a watcher that sleeps
 * through the one event it was built for. So the marker is the ONLY quiet
 * outcome, and it is a narrow, exact one:
 *
 *   - **found** → `closed`. Nothing to do; the round is shut exactly as it
 *     was yesterday.
 *   - **not found** → `open_or_changed`, whatever the reason. The round may
 *     have opened. The page may have been reworded. The site may have been
 *     redesigned. The fetch may have returned a WAF challenge or a 5xx error
 *     body instead of the real page. All four collapse to the same verdict,
 *     because all four are exactly the moment a human has to look — the
 *     absence of "closed" is the alert condition, not evidence of anything in
 *     particular. Distinguishing them would only buy false confidence: a
 *     "changed" verdict that pretended to know it wasn't an open round is a
 *     guess wearing a label.
 *
 * # Why this takes a string, not a fetch result
 *
 * The caller (the workflow's Code node) is the one that knows whether a
 * request even completed — a genuine network failure never reaches this
 * function with real markup, and gets its own subject line one layer up.
 * Folding that distinction in here too would mean two places deciding one
 * thing from different signals, the exact duplication `SOURCE_KIND`'s own
 * header warns against elsewhere in this file. `egmontRoundStatus("")` for a
 * failed fetch and `egmontRoundStatus(realHtmlWithNoMarker)` for a redesign
 * both correctly answer `open_or_changed` — the caller adds the "how" on top.
 *
 * # Why a plain substring, not a smarter parse
 *
 * `htmlToText` already strips tags/scripts/styles, decodes entities (numeric
 * and the handful of named ones this file handles) and collapses whitespace —
 * exactly the normalization every other extractor in this file relies on. A
 * further lowercase + single-space collapse is enough to match the marker
 * however it is capitalised, wherever in the page it sits (a sitewide banner
 * in the nav, or the actual status line in the body — this watcher does not
 * try to tell those apart, because doing so would require assumptions about a
 * layout nobody has committed to keeping), and however its diacritics were
 * written (a literal "ø" or a decimal/hex entity for it). Anything cleverer
 * risks the one failure mode worse than a false alarm: a parser confident
 * enough to stay quiet on a page it misread.
 */
const EGMONT_CLOSED_MARKER = "ansøgningsrunden er lukket";

export function egmontRoundStatus(html) {
  const normalized = htmlToText(String(html ?? ""))
    .toLowerCase()
    .replace(/\s+/g, " ");
  const markerFound = normalized.includes(EGMONT_CLOSED_MARKER);
  return {
    status: markerFound ? "closed" : "open_or_changed",
    marker_found: markerFound,
  };
}

// MARK: - Dedup

/**
 * Cross-source dedup key for a listing.
 *
 * The same flat appears on lejebolig and boligzonen under different ids and
 * different URLs, and boligdeal aggregates both — so a URL-keyed or id-keyed dedup
 * produces duplicates, and a duplicate on a race lane is two notification emails
 * about one flat, which trains you to stop reading them.
 *
 * **The server never recomputes this.** It is computed here, once, and stored, so
 * changing the rule changes only what future rows collide with. That is a
 * deliberate trade: recomputation server-side would mean the normalization lived
 * in two languages, and CLAUDE.md records what two copies of one rule cost twice
 * over (the stale Garmin bridge; the BIA constants).
 *
 * # The rule, written out
 *
 * 1. Danish letters transliterate first — `æ→ae`, `ø→oe`, `å→aa` — *before* NFKD.
 *    NFKD decomposes `å` into `a` + a combining ring but leaves `æ` and `ø`
 *    untouched, so a plain NFKD pass normalizes one of the three and is worse than
 *    doing nothing, because it looks like it worked.
 * 2. Floor and side markers go: `st`, `stuen`, `kld`, `sal`, `th`, `tv`, `mf`,
 *    and a bare floor ordinal (`3.`). "Nørrebrogade 12, 3. th" and "Nørrebrogade
 *    12" are the same address written by two portals, and `tv`/`th` in particular
 *    are not written consistently even within one portal.
 * 3. Everything that is not `[a-z0-9]` collapses to a single space; the result is
 *    trimmed.
 * 4. The rent is rounded to a whole krone and joined with `::`.
 *
 * # Why rooms is not in the key, despite `HOUSING_PLAN.md` §6 naming it
 *
 * The signature is pinned to `(address, rent)` by the ingest contract. Postcode
 * rides inside `address` (callers build `"<street>, <zip> <city>"`), so the plan's
 * "postcode + street + rent" is intact; only rooms is missing. That is survivable
 * and arguably better: a rooms disagreement between two portals for one flat —
 * a "1-værelses" counted as 1 by one and 2 by another with a separate kitchen —
 * would *split* the key and defeat the dedup, which is the failure that costs a
 * duplicate email. Street plus exact rent is already a tight key.
 *
 * A missing address or a missing rent yields an empty segment rather than a
 * throw. Two listings that both lack an address will collide, which is why the
 * caller must not treat a dedupe key as an identity: `external_id` is identity.
 */
export function dedupeKeyHousing(address, rent) {
  const normAddress = String(address ?? "")
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b\d+\s*\.(?=\s|$)/g, " ")
    .replace(/\b(?:st|stuen|kld|kl|sal|th|tv|mf|mfl)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const n = parseDanishNumber(rent);
  return `${normAddress}::${n === null ? "" : Math.round(n)}`;
}

// MARK: - Housing type

/**
 * The **only** four values `housing-ingest` will store, and the same domain
 * `housing_criteria.types` is written in.
 *
 * ⚠️ These are English and this is a Danish pipeline, which is exactly the kind of
 * seam that goes wrong quietly: `parseHousingType` lowercases the incoming value
 * and returns **null** for anything not in this list, so a row sent as
 * `"lejlighed"` stores `housing_type: null` — no error, no reject, just a listing
 * that can never match a `types: ['apartment']` criterion. Worse, the gate in this
 * file compares against `criteria.types`, so a Danish vocabulary here would drop
 * every listing on `type lejlighed not in apartment/room` and log a tidy reason
 * for a decision that was pure vocabulary mismatch.
 */
export const HOUSING_TYPES = ["kollegie", "studio", "apartment", "room"];

/**
 * Danish (and English) type words, ordered by **how specific a dwelling noun each
 * one is**, mapped onto the four-value domain above.
 *
 * `kollegie` first because "kollegieværelse" contains "værelse", and filing a dorm
 * room as a private room hides it from a `types: ['kollegie']` criterion — which
 * is the criterion this whole search exists for. `ungdomsbolig` folds into
 * `kollegie`: the domain has no separate bucket, and institutional student
 * housing is what both words mean.
 *
 * The room pattern is **last**, and that ordering is the fix for a bug this file
 * shipped with for one draft: a 3-room flat came back as a room, because Danish
 * ads say "3 **værelses** lejlighed" and the description said "soveværelse". Both
 * contain the substring the room pattern was looking for. The rule that resolves
 * it is not a cleverer regex, it is precedence: **if the text names a flat, it is
 * a flat, however many rooms it mentions.** A bare `værelse` with no dwelling
 * noun beside it is a room, and so is a `delebolig` — renting into a shared flat
 * is renting a room, whatever the flat is.
 *
 * House words (`villa`, `rækkehus`) map to **null**, not to `apartment`. The
 * domain has no house, so no criterion can ask for one; calling a villa an
 * apartment would sneak it through an `apartment` criterion, whereas null passes
 * flagged as unknown and gets killed by the rent gate like any other 30 000 kr.
 * listing.
 */
const HOUSING_TYPE_PATTERNS = [
  ["kollegie", /kollegie|kollegium|dormitory|ungdomsbolig|youth housing/i],
  ["apartment", /lejlighed|apartment|\bflat\b/i],
  [null, /\bvilla\b|rækkehus|raekkehus|\bhus til leje\b|townhouse/i],
  ["room", /delebolig|delevenlig|bofaellesskab|bofællesskab|roommate|shared flat/i],
  ["room", /værelse|vaerelse|room to rent/i],
];

/** One room, in any of the ways the sources say it. */
const ONE_ROOM = /\b(?:1|et|én|en)[- ]?værelses|\b1[- ]?vaerelses|\bstudio\b|\bet-?værelses\b/i;

/**
 * Best guess at a listing's type, in `housing-ingest`'s vocabulary.
 *
 * Reads, in order of trust:
 *
 *   1. `listing.housing_type` **alone**, when the source published one.
 *      boligzonen's "Boligtype: Lejlighed" is the source's own answer and beats
 *      any inference; folding it into the same haystack as the prose let a
 *      "soveværelse" three paragraphs down outvote it.
 *   2. the title.
 *   3. the first 400 characters of the description — a last resort, and bounded,
 *      because the further into an ad you read the more it describes the
 *      *neighbourhood* rather than the dwelling.
 *
 * A flat with exactly one room is a `studio`, and `rooms` is what decides it
 * rather than the prose: a "1-værelses lejlighed" and a "studio" are the same
 * thing under two names, and the JSON-LD already told us `numberOfRooms: 1`.
 * Where `rooms` is unknown, the one-room phrasings are the fallback and anything
 * else stays `apartment` — guessing `studio` from silence would hide real flats
 * from a `types: ['apartment']` criterion.
 *
 * Returns **null** when nothing matches, and null must reach the gate as
 * *unknown* rather than as a mismatch — see `cheapGateHousing`. A source that
 * words its ads differently must not silently disappear from a typed criterion.
 */
export function deriveHousingType(listing) {
  const l = listing || {};
  const candidates = [
    collapse(l.housing_type),
    collapse(l.title),
    collapse(l.description).slice(0, 400),
  ];
  for (const hay of candidates) {
    if (!hay) continue;
    for (const [name, re] of HOUSING_TYPE_PATTERNS) {
      if (!re.test(hay)) continue;
      if (name !== "apartment") return name;
      const rooms = parseDanishNumber(l.rooms);
      if (rooms === 1) return "studio";
      if (rooms === null && ONE_ROOM.test(`${collapse(l.title)} ${hay}`)) return "studio";
      return "apartment";
    }
  }
  return null;
}

// MARK: - Distance

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (d) => (Number(d) * Math.PI) / 180;

/**
 * Great-circle distance in km between two `{lat, lng}` points, or null if either
 * is not a real point.
 *
 * Null rather than `Infinity` on missing input, deliberately: `Infinity` compares
 * greater than every radius and would turn "no coordinates" into "too far away",
 * which is the whole failure this file keeps flagging. `(0, 0)` is treated as a
 * real point because it is one — it is in the Gulf of Guinea, and a listing that
 * genuinely claims to be there deserves to be dropped on distance rather than
 * quietly waved through by a null check that guessed.
 */
export function haversineKm(a, b) {
  const lat1 = num(a?.lat);
  const lng1 = num(a?.lng);
  const lat2 = num(b?.lat);
  const lng2 = num(b?.lng);
  if (lat1 === null || lng1 === null || lat2 === null || lng2 === null) return null;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

// MARK: - The cheap gate

/**
 * Rule-only screening of one listing against one criteria row, run before
 * anything expensive (a model, an email, a database write) happens.
 *
 * Returns `{ verdict, reason, flags, distance_km }` where `verdict` is `"pass"`
 * or `"dropped"`.
 *
 * # Polarity: only positive evidence drops
 *
 * This is the same posture as the job pipeline's `cheapGate`, and it is here
 * because that one had to be corrected after a live run dropped 32 of 69 postings
 * on location, roughly a third of them wrongly, by treating "unrecognised" as
 * "mismatched".
 *
 * The housing version of that mistake is worse, because the miss is systematic
 * rather than occasional: **neither** automatable private portal publishes
 * coordinates. Verified 2026-09-06 — the string `latitude` does not appear in a
 * lejebolig or a boligzonen detail page. A radius check that dropped listings with
 * no coordinates would therefore drop *every single Lane B listing*, and would do
 * it silently, and the run would be green.
 *
 * So: a missing rent, a missing coordinate pair and an underivable type each add a
 * **flag** and pass. Flags are the audit trail — `["coords_missing"]` on every row
 * is the signal that the radius is decorative on this source and the postcode
 * list is doing the real work, and it is visible rather than inferred.
 *
 * A criterion that is itself absent (no `max_rent`, no centre, no `types`) is not
 * a test that everything passes; it is a test that is not run. Both end in "pass",
 * but only one of them belongs in `reason`.
 */
export function cheapGateHousing(listing, criteria) {
  const l = listing || {};
  const c = criteria || {};
  const flags = [];
  const reasons = [];

  // --- excluded terms ------------------------------------------------------
  // Positive evidence, checked first: an explicit "kun til expats" or "erhverv"
  // is a fact about the listing, not an absence.
  const hay = `${collapse(l.title)} ${collapse(l.description)}`.toLowerCase();
  for (const term of c.exclude_terms ?? []) {
    const t = String(term ?? "").toLowerCase().trim();
    if (!t) continue;
    const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![a-z0-9])${esc}(?![a-z0-9])`, "i").test(hay)) {
      return { verdict: "dropped", reason: `excluded term: ${t}`, flags, distance_km: null };
    }
  }

  // --- rent ----------------------------------------------------------------
  const maxRent = num(c.max_rent);
  const rent = parseDanishNumber(l.rent);
  if (maxRent !== null && maxRent > 0) {
    if (rent === null) {
      flags.push("rent_unknown");
    } else if (rent > maxRent) {
      return {
        verdict: "dropped",
        reason: `rent ${Math.round(rent)} > ${Math.round(maxRent)}`,
        flags,
        distance_km: null,
      };
    } else {
      reasons.push(`rent ${Math.round(rent)} ≤ ${Math.round(maxRent)}`);
    }
  }

  // --- distance ------------------------------------------------------------
  const centre = { lat: num(c.center_lat), lng: num(c.center_lng) };
  const radius = num(c.radius_km);
  let distanceKm = null;
  if (centre.lat !== null && centre.lng !== null && radius !== null && radius > 0) {
    distanceKm = haversineKm(centre, { lat: l.lat, lng: l.lng });
    if (distanceKm === null) {
      // Not "outside the radius". Not measurable. Every Lane B listing lands here.
      flags.push("coords_missing");
    } else if (distanceKm > radius) {
      return {
        verdict: "dropped",
        reason: `${distanceKm.toFixed(1)} km > ${radius} km`,
        flags,
        distance_km: distanceKm,
      };
    } else {
      reasons.push(`${distanceKm.toFixed(1)} km`);
    }
  }

  // --- type ----------------------------------------------------------------
  const types = (Array.isArray(c.types) ? c.types : [])
    .map((t) => String(t ?? "").toLowerCase().trim())
    .filter(Boolean);
  if (types.length) {
    const derived = l.housing_type ? String(l.housing_type).toLowerCase() : deriveHousingType(l);
    if (!derived) {
      flags.push("type_unknown");
    } else if (!types.includes(derived)) {
      return {
        verdict: "dropped",
        reason: `type ${derived} not in ${types.join("/")}`,
        flags,
        distance_km: distanceKm,
      };
    } else {
      reasons.push(`type ${derived}`);
    }
  }

  return {
    verdict: "pass",
    reason: reasons.length ? reasons.join(", ") : null,
    flags,
    distance_km: distanceKm,
  };
}

/**
 * Exactly the fields `housing-ingest`'s `normalizeListing` reads off a listing.
 * Order is cosmetic.
 *
 * `url`, `source_kind`, `external_id`, `title` and `dedupe_key` are **required**
 * server-side — a listing missing any of them comes back in `rejected` with a
 * named error rather than failing the request, so the run finishes green.
 * `housing-harvest`'s `Check Listing Rejects` node exists to turn that into a red
 * execution.
 *
 * `housing_type`, `deposit` and `available_from` are here because the server
 * stores them, and they were NOT in the contract this workflow was first written
 * against — `HOUSING_PLAN.md` §3 and the pinned brief both stop at `dedupe_key`.
 * Sending them costs nothing and not sending them would leave three columns
 * permanently null with nothing to say why.
 */
export const LISTING_FIELDS = [
  "source_kind",
  "external_id",
  "url",
  "title",
  "rent",
  "address",
  "zipcode",
  "lat",
  "lng",
  "rooms",
  "sqm",
  "deposit",
  "available_from",
  "housing_type",
  "posted_at",
  "description",
  "dedupe_key",
];

/**
 * Reduce an internal listing to exactly the ingest contract's field set.
 *
 * The extractors deliberately carry more than the server stores — `shared`,
 * `furnished` — because the gate may want them and because dropping a fact at
 * extraction time means re-probing a live site to get it back. None of it may
 * reach the wire.
 *
 * Deriving the wire shape from one constant is what stops the workflow and the
 * contract drifting: adding a field means adding it to `LISTING_FIELDS`, not
 * editing a literal in a Code node body.
 */
export function toIngestListing(listing) {
  const l = listing || {};
  const out = {};
  for (const key of LISTING_FIELDS) out[key] = l[key] === undefined ? null : l[key];
  return out;
}

export const __internal = { htmlToText, metaContent, decodeEntities, collapse, num, firstOf };
