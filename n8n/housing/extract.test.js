/**
 * Tests for the housing extractor and the listing-alert email.
 *
 *   node --test n8n/housing/
 *
 * Node's built-in runner, no dependencies — this folder is deliberately outside
 * the npm workspace globs so a housing-pipeline change can never break an app
 * build, exactly like `n8n/job-applier/`.
 *
 * Fixtures are real pages captured 2026-09-06 by single polite fetches
 * (`HOUSING_PLAN.md` records the reconnaissance). They are trimmed — scripts,
 * styles, comments and base64 image payloads stripped, the sitemap cut to its
 * first 40 `<url>` blocks — but every element these tests read is byte-verbatim.
 * Nothing in them is a credential: they are public listing pages.
 *
 * **Every assertion below corresponds to something that was actually wrong**, in
 * this file's own history or in the job pipeline's, rather than to coverage for
 * its own sake. The comments say which.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  HOUSING_TYPES,
  LISTING_FIELDS,
  MAX_DETAIL_FETCHES,
  SOURCE_KIND,
  boligzonenFacts,
  boligzonenSitemapAgeMinutes,
  boligzonenWindow,
  cheapGateHousing,
  dedupeKeyHousing,
  deriveHousingType,
  extractBoligzonenListing,
  extractLejeboligDescription,
  extractRealEstateListingLd,
  haversineKm,
  nextIdRange,
  parseBoligzonenSitemap,
  parseDanishNumber,
  parseLejeboligJsonLd,
  parseLejeboligSearch,
  parseSdkBuildings,
  sitemapXmlFromCandidates,
  toIngestListing,
} from "./extract.js";

import {
  buildListingEmail,
  buildRenewalEmail,
  buildUnknownIntervalEmail,
  clampLine,
  escapeHtml,
  formatDkk,
  formatKm,
  formatYmd,
  listingAge,
  pairedSourceIndex,
  renewalUrgency,
  safeUrl,
} from "./notify-housing.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(join(here, "fixtures", n), "utf8");
const json = (n) => JSON.parse(fixture(n));

const BZ_URL = "https://boligzonen.dk/lejeboliger/3-vaerelses-lejlighed-i-kobenhavn-k-eb1617";
const LB_URL = "https://www.lejebolig.dk/lejebolig/1908105/29-m2-lejlighed-i-valby";

// MARK: - Danish numbers

test("a Danish thousands separator is not a decimal point", () => {
  // parseFloat("21.800") is 21.8. A 21,800 kr. flat would have sailed through
  // every budget gate ever written as a 21 kr. one.
  assert.equal(parseDanishNumber("21.800,-"), 21800);
  assert.equal(parseDanishNumber("8.950 kr. pr. måned"), 8950);
  assert.equal(parseDanishNumber("1.234,56"), 1234.56);
  assert.equal(parseDanishNumber("87 m²"), 87);
  assert.equal(parseDanishNumber(8950), 8950);
});

test("a missing number is null, never zero", () => {
  // `Number(null)` is 0 and `Number("")` is 0. A rent of 0 renders as a free flat.
  for (const v of [null, undefined, "", "Størrelse", "ingen", NaN]) {
    assert.equal(parseDanishNumber(v), null, `${JSON.stringify(v)} should be null`);
  }
  // Zero itself is a real value and must survive.
  assert.equal(parseDanishNumber(0), 0);
});

// MARK: - lejebolig.dk

test("reads every distinct listing id off a real lejebolig search page", () => {
  const rows = parseLejeboligSearch(fixture("lejebolig-search.html"));
  assert.ok(rows.length >= 15, `only ${rows.length} listings found`);
  // Each card links the same listing more than once (image + title). A naive
  // "one anchor is one listing" pass double-counts every single row.
  const ids = rows.map((r) => r.external_id);
  assert.equal(new Set(ids).size, ids.length, "duplicate ids survived");
  for (const r of rows) assert.match(r.url, /^https:\/\/www\.lejebolig\.dk\/lejebolig\/\d+\//);
});

test("search results come back newest first", () => {
  // Sequential ids: highest is newest. `nextIdRange`'s cap takes the head of this
  // list, so an unsorted list would spend the politeness budget on the oldest ads.
  const ids = parseLejeboligSearch(fixture("lejebolig-search.html")).map((r) =>
    Number(r.external_id),
  );
  const sorted = [...ids].sort((a, b) => b - a);
  assert.deepEqual(ids, sorted);
});

test("the lejebolig source kind is the one housing-ingest allows", () => {
  // HOUSING_PLAN.md §3 calls it `lejebolig_search`; the edge function's
  // LISTING_SOURCE_KINDS allow-list says `lejebolig_jsonld`, and the server is the
  // one that rejects — in the RESPONSE BODY, not as a failure, so the run finishes
  // green with nothing stored. Job pipeline, verbatim, 28 postings.
  assert.equal(SOURCE_KIND.lejebolig, "lejebolig_jsonld");
  assert.equal(SOURCE_KIND.boligzonen, "boligzonen_sitemap");
  assert.equal(SOURCE_KIND.sdk, "sdk_api");
});

test("normalizes a real lejebolig RealEstateListing", () => {
  const row = parseLejeboligJsonLd(fixture("lejebolig-listing.html"), { url: LB_URL });
  assert.equal(row.source_kind, SOURCE_KIND.lejebolig);
  assert.equal(row.external_id, "1908105");
  assert.equal(row.rent, 8950);
  assert.equal(row.rooms, 1);
  assert.equal(row.sqm, 29);
  assert.equal(row.zipcode, "2500");
  assert.equal(row.address, "Poul Bundgaards Vej, 2500 Valby");
  assert.equal(row.posted_at, "2026-09-06");
  assert.equal(row.title, "29 m2 lejlighed i Valby");
});

test("lejebolig publishes no coordinates, and they stay null rather than guessed", () => {
  // Probed 2026-09-06: the string `latitude` does not occur anywhere in a detail
  // page. This is why `cheapGateHousing` has a `coords_missing` flag instead of a
  // radius check that would silently drop the entire lane.
  const row = parseLejeboligJsonLd(fixture("lejebolig-listing.html"), { url: LB_URL });
  assert.equal(row.lat, null);
  assert.equal(row.lng, null);
});

test("the lejebolig description stops at the ad and never reaches the footer", () => {
  // "Find lease-text, slice 20 kB, strip tags" returned the ad PLUS
  // "Kundeservice / Guides / Vilkår / Persondatapolitik / CVR-nr. 27258948", and
  // the gate matches exclude_terms against the description — so a footer word
  // becomes an exclusion that fires on every listing from the source.
  const desc = extractLejeboligDescription(fixture("lejebolig-listing.html"));
  assert.ok(desc.length > 500, "description too short — did the block move?");
  assert.doesNotMatch(desc, /Persondatapolitik|CVR-nr|Kundeservice|Udlej bolig gratis/);
  // The same slice starting at the `class=` match leaked the rest of the
  // attribute list as the description's first line.
  assert.doesNotMatch(desc, /col-sm-|lease-text/);
  assert.match(desc, /^Lejligheden på Poul Bundgaards Vej/);
});

test("a page with no RealEstateListing is skipped, not half-built", () => {
  // A row with a title and no rent passes the budget gate on a technicality
  // (rent unknown ⇒ pass) and lands in the notify queue unpriceable.
  assert.equal(parseLejeboligJsonLd("<html><body>nothing</body></html>", { url: LB_URL }), null);
});

test("a RealEstateListing nested in an array or @graph is still found", () => {
  // lejebolig emits a BreadcrumbList array alongside the listing, so the array
  // case is the observed shape, not a hypothetical one.
  const arr = `<script type="application/ld+json">[{"@type":"BreadcrumbList"},{"@type":"RealEstateListing","name":"A"}]</script>`;
  assert.equal(extractRealEstateListingLd(arr).name, "A");
  const graph = `<script type="application/ld+json">{"@graph":[{"@type":"Place"},{"@type":"RealEstateListing","name":"B"}]}</script>`;
  assert.equal(extractRealEstateListingLd(graph).name, "B");
});

test("one malformed ld+json block does not hide a later valid one", () => {
  const html =
    `<script type="application/ld+json">{ not json }</script>` +
    `<script type="application/ld+json">{"@type":"RealEstateListing","name":"Second"}</script>`;
  assert.equal(extractRealEstateListingLd(html).name, "Second");
});

// MARK: - High-water mark

test("nextIdRange takes the NEWEST ids, not the oldest", () => {
  // The job harvester drains its backlog oldest-first so its cursor advances
  // contiguously. That is wrong here: a listing reached on the fourth run of a
  // drain has already been taken. Lane B's product is latency.
  const batch = [10, 11, 12, 13, 14].map((n) => ({ external_id: String(n) }));
  const r = nextIdRange(9, batch, { cap: 2 });
  assert.deepEqual(r.take.map((t) => t.external_id), ["14", "13"]);
  assert.equal(r.fresh, 5);
  assert.equal(r.deferred, 3);
});

test("nextIdRange counts what the cap could not reach", () => {
  // `deferred` is the actionable signal — a cap that quietly eats listings is
  // indistinguishable from a dead source.
  const batch = Array.from({ length: 30 }, (_, i) => ({ external_id: String(100 + i) }));
  const r = nextIdRange(99, batch, { cap: 20 });
  assert.equal(r.take.length, 20);
  assert.equal(r.deferred, 10);
  assert.equal(r.max_id, 129);
});

test("a missing high-water mark is unknown, not 'everything is new'", () => {
  const batch = [1, 2, 3, 4, 5].map((n) => ({ external_id: String(n) }));
  const r = nextIdRange(null, batch, { cap: 2 });
  assert.equal(r.high_water, false);
  // Still only takes `cap`, newest first — a first run must not fetch 8,000 pages.
  assert.deepEqual(r.take.map((t) => t.external_id), ["5", "4"]);
});

test("ids at or below the mark are stale, and are counted as such", () => {
  const batch = [1, 2, 3, 10, 11].map((n) => ({ external_id: String(n) }));
  const r = nextIdRange(3, batch, { cap: 10 });
  assert.equal(r.stale, 3);
  assert.deepEqual(r.take.map((t) => t.external_id), ["11", "10"]);
});

test("the seen set filters regardless of the mark", () => {
  const batch = [10, 11, 12].map((n) => ({ external_id: String(n) }));
  const r = nextIdRange(null, batch, { cap: 10, seen: new Set(["11"]) });
  assert.deepEqual(r.take.map((t) => t.external_id), ["12", "10"]);
  assert.equal(r.stale, 1);
});

test("a non-numeric id is a candidate, not a stale one", () => {
  // boligzonen's ids are slugs. An id that cannot be compared to the floor is
  // unknown, and dropping it would make the lane's yield depend on an id format
  // nobody has committed to.
  const batch = [{ external_id: "abc-1234" }, { external_id: "5" }];
  const r = nextIdRange(10, batch, { cap: 10 });
  assert.deepEqual(r.take.map((t) => t.external_id), ["abc-1234"]);
  assert.equal(r.stale, 1);
});

test("the politeness cap is the default", () => {
  const batch = Array.from({ length: 50 }, (_, i) => ({ external_id: String(i) }));
  assert.equal(nextIdRange(-1, batch).take.length, MAX_DETAIL_FETCHES);
});

// MARK: - boligzonen.dk

test("parses a real boligzonen sitemap", () => {
  const rows = parseBoligzonenSitemap(fixture("boligzonen-sitemap.xml"));
  assert.ok(rows.length > 20, `only ${rows.length} entries`);
  for (const r of rows) {
    assert.match(r.url, /\/lejeboliger\//);
    assert.ok(r.external_id, "no external_id");
  }
  // `lastmod` is the only real timestamp this source has: the detail page says
  // "Oprettet / Opdateret: I går", which is a phrase, not a date.
  assert.ok(rows.filter((r) => r.lastmod).length > 20);
});

test("the sitemap binary is found by sniffing content, not by property name", () => {
  // The first live run died on a hand-rolled version of this rule with
  // "Binary keys: file_0" — the property existed and decoded to nothing, because
  // `binary[key].data` is base64 only in n8n's in-memory mode and a 2 MB payload
  // does not stay in memory. Two nodes now need this answer, so it is one tested
  // function rather than two inline guesses.
  const ok = sitemapXmlFromCandidates([
    { key: "data", text: "\u001f\u008bgzip bytes" },
    { key: "file_0", text: "<?xml version=\"1.0\"?><urlset/>" },
  ]);
  assert.equal(ok.ok, true);
  assert.equal(ok.key, "file_0");
});

test("an unreadable sitemap reports WHICH failure it was", () => {
  // "empty" and "still gzipped" have different fixes — a binary-data-mode problem
  // versus a Compression node that did not run — and a message that says only
  // "did not decompress" sends you to the wrong one.
  const empty = sitemapXmlFromCandidates([{ key: "file_0", text: "" }]);
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /file_0=empty/);
  assert.deepEqual(empty.keys, ["file_0"]);

  const gz = sitemapXmlFromCandidates([{ key: "data", text: "\u001f\u008b\u0008\u0000" }]);
  assert.match(gz.reason, /data=still-gzip/);

  const none = sitemapXmlFromCandidates([]);
  assert.equal(none.reason, "no_binary");
});

test("sitemapXmlFromCandidates returns rather than throws", () => {
  // A Code-node throw fails the WHOLE execution, and that is how one broken lane
  // zeroed a healthy one on the first live run: the lejebolig branch's already-
  // fetched listings never reached the batch POST.
  assert.doesNotThrow(() => sitemapXmlFromCandidates(null));
  assert.equal(sitemapXmlFromCandidates(null).ok, false);
});

test("gzip bytes fed to the sitemap parser yield nothing — which is why the workflow decompresses first", () => {
  // The published sitemap is `application/x-gzip` as a Content-TYPE, not a
  // Content-Encoding, so nothing in the HTTP stack unwraps it. A "text" response
  // straight into this function is a silently dead lane that is green every run.
  assert.deepEqual(parseBoligzonenSitemap(" garbage"), []);
});

test("the window is anchored on the SITEMAP, not on the clock", () => {
  // The bug this replaces was only findable live. boligzonen's sitemap is rebuilt
  // roughly DAILY — measured 30 hours stale on 2026-09-06, the file's own
  // Last-Modified agreeing with its newest <lastmod> to the second. A window
  // measured from `now` therefore matched nothing, and would have matched nothing
  // on every run forever: a lane harvesting zero listings and reporting success.
  // Fixture timestamps are frozen, so no test written against one could have
  // caught it; every synthetic date in this file was "recent" by construction.
  const now = new Date("2026-09-06T21:20:00Z");
  const stale = [
    { url: "newest", lastmod: "2026-09-05T15:24:27Z" }, // 30 h old = the file's own age
    { url: "older", lastmod: "2026-09-05T14:00:00Z" },
    { url: "ancient", lastmod: "2026-06-01T00:00:00Z" },
  ];
  const rows = boligzonenWindow(stale, { now, windowMinutes: 180 });
  assert.deepEqual(rows.map((r) => r.url), ["newest", "older"]);
  assert.equal(boligzonenSitemapAgeMinutes(stale, now), 1796);
});

test("a future lastmod cannot open the window into next week", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  const rows = boligzonenWindow(
    [
      { url: "future", lastmod: "2026-09-20T12:00:00Z" },
      { url: "now", lastmod: "2026-09-06T11:30:00Z" },
      { url: "old", lastmod: "2026-09-01T12:00:00Z" },
    ],
    { now, windowMinutes: 180 },
  );
  // Anchored at `now`, not at the bogus future stamp, so `old` stays out.
  assert.deepEqual(rows.map((r) => r.url), ["future", "now"]);
});

test("sitemap age is null when nothing in the file is dated", () => {
  // Null is "we cannot tell", and the log says so rather than printing 0 minutes
  // next to an empty lane.
  assert.equal(boligzonenSitemapAgeMinutes([{ url: "a", lastmod: null }]), null);
  assert.equal(boligzonenSitemapAgeMinutes([]), null);
});

test("the lastmod window keeps undated entries rather than dropping them", () => {
  // An entry with no lastmod is undated, not old. On a source where the sitemap
  // is the only clock, discarding them narrows the lane to whatever boligzonen
  // happens to timestamp.
  const now = new Date("2026-09-06T12:00:00Z");
  const rows = boligzonenWindow(
    [
      { url: "a", lastmod: "2026-09-06T11:50:00Z" },
      { url: "b", lastmod: "2026-09-06T08:00:00Z" }, // outside a 45 min window
      { url: "c", lastmod: null },
      { url: "d", lastmod: "2026-09-06T11:59:00Z" },
    ],
    { now, windowMinutes: 45 },
  );
  assert.deepEqual(rows.map((r) => r.url), ["d", "a", "c"]);
});

test("extracts a real boligzonen listing from server-rendered HTML", () => {
  const row = extractBoligzonenListing(fixture("boligzonen-listing.html"), {
    url: BZ_URL,
    lastmod: "2026-09-05T02:51:36+02:00",
  });
  assert.equal(row.source_kind, SOURCE_KIND.boligzonen);
  assert.equal(row.rent, 21800);
  assert.equal(row.rooms, 3);
  assert.equal(row.sqm, 87);
  assert.equal(row.title, "3 værelses lejlighed i København K");
  assert.equal(row.available_from, "Snarest muligt");
  assert.equal(row.shared, false);
  assert.ok(row.description.length > 400);
  assert.match(row.description, /Velkommen til denne elegante/);
});

test("boligzonen's external_id is the slug, because that is what discovery can compute", () => {
  // The page carries `data-id="8169434"` and "Sagsnummer: 8169434" — genuinely
  // boligzonen's own id. It loses anyway: `external_id` is the seen-set key, and
  // the sitemap publishes URLs and nothing else. Keying ingest on the number and
  // discovery on the slug means the two never meet, and every run re-fetches and
  // re-notifies everything it has ever seen while finishing green.
  const row = extractBoligzonenListing(fixture("boligzonen-listing.html"), { url: BZ_URL });
  const fromSitemap = parseBoligzonenSitemap(
    `<urlset><url><loc>${BZ_URL}</loc><lastmod>2026-09-05T02:51:36+02:00</lastmod></url></urlset>`,
  )[0];
  assert.equal(row.external_id, fromSitemap.external_id);
});

test("the street and the postcode survive a <br> that carries attributes", () => {
  // boligzonen writes `<br class="d-lg-block d-none" />` inside its address line.
  // A bare /<br\s*\/?>/ misses it, street and postcode flatten into one line, and
  // `zipcode` comes back null on every listing from the source.
  const row = extractBoligzonenListing(fixture("boligzonen-listing.html"), { url: BZ_URL });
  assert.equal(row.zipcode, "1054");
  assert.equal(row.address, "Peder Skrams Gade, 1054 København");
});

test("posted_at comes from the sitemap, and is null when it was not supplied", () => {
  const withMod = extractBoligzonenListing(fixture("boligzonen-listing.html"), {
    url: BZ_URL,
    lastmod: "2026-09-05T02:51:36+02:00",
  });
  assert.equal(withMod.posted_at, "2026-09-05T02:51:36+02:00");
  // The page's own "I går" must never be parsed into a date. Null reaches the
  // email as "age unknown", which is the truth.
  const without = extractBoligzonenListing(fixture("boligzonen-listing.html"), { url: BZ_URL });
  assert.equal(without.posted_at, null);
});

test("boligzonen facts read as a label/value map from both fact blocks", () => {
  const facts = boligzonenFacts(fixture("boligzonen-listing.html"));
  assert.equal(facts["Boligtype"], "Lejlighed");
  assert.equal(facts["Antal værelser"], "3");
  assert.equal(facts["Størrelse"], "87 m²");
  assert.equal(facts["Månedlig husleje"], "21.800,-"); // header card
  assert.equal(facts["Depositum"], "65.400,-"); // detail table
});

// MARK: - Housing type

test("the derived type is always in housing-ingest's four-value domain", () => {
  // `parseHousingType` lowercases the incoming value and returns null for
  // anything outside this list — so a Danish vocabulary here would store
  // `housing_type: null` with no error and no reject, AND would make this file's
  // own gate drop every listing on "type lejlighed not in apartment/room".
  assert.deepEqual(HOUSING_TYPES, ["kollegie", "studio", "apartment", "room"]);
  const derived = [
    { title: "3 værelses lejlighed", rooms: 3 },
    { title: "1 værelses lejlighed", rooms: 1 },
    { title: "Kollegieværelse" },
    { title: "Stort værelse udlejes" },
    { title: "Villa i Hellerup" },
  ].map(deriveHousingType);
  for (const t of derived) {
    assert.ok(t === null || HOUSING_TYPES.includes(t), `${t} is outside the domain`);
  }
});

test("a 3-room flat is an apartment, not a room", () => {
  // This shipped wrong for one draft. Danish ads say "3 VÆRELSES lejlighed" and
  // descriptions say "soveværelse", so a room pattern checked before the flat
  // pattern files every apartment in Denmark as a single room — and hides it from
  // a `types: ['apartment']` criterion.
  const row = extractBoligzonenListing(fixture("boligzonen-listing.html"), { url: BZ_URL });
  assert.equal(row.housing_type, "apartment");
  assert.equal(
    deriveHousingType({ title: "3 værelses lejlighed i København K", rooms: 3 }),
    "apartment",
  );
});

test("a one-room flat is a studio, decided by rooms rather than by prose", () => {
  assert.equal(deriveHousingType({ title: "Lejlighed i Valby", rooms: 1 }), "studio");
  // rooms unknown: the one-room phrasings are the fallback...
  assert.equal(deriveHousingType({ title: "1-værelses lejlighed i Valby" }), "studio");
  // ...and silence stays `apartment`. Guessing studio would hide real flats from
  // a `types: ['apartment']` criterion.
  assert.equal(deriveHousingType({ title: "Lejlighed i Valby" }), "apartment");
});

test("a real lejebolig 1-room flat comes out as a studio", () => {
  const row = parseLejeboligJsonLd(fixture("lejebolig-listing.html"), { url: LB_URL });
  assert.equal(row.rooms, 1);
  assert.equal(row.housing_type, "studio");
});

test("a dorm room is a kollegie, not a room", () => {
  assert.equal(deriveHousingType({ title: "Kollegieværelse på Nørrebro" }), "kollegie");
  // The domain has no ungdomsbolig bucket, and institutional student housing is
  // what both words mean.
  assert.equal(deriveHousingType({ title: "Ungdomsbolig på Amager" }), "kollegie");
});

test("a bare room with no dwelling noun is a room; renting into a shared flat is too", () => {
  assert.equal(deriveHousingType({ title: "Stort værelse udlejes" }), "room");
  assert.equal(deriveHousingType({ title: "Delebolig søger ny beboer" }), "room");
});

test("a house is null, not an apartment", () => {
  // The domain has no house, so no criterion can ask for one. Calling a villa an
  // apartment would sneak it through an `apartment` criterion; null passes
  // flagged as unknown and gets killed by the rent gate like any other 30 000 kr.
  // listing.
  assert.equal(deriveHousingType({ title: "Villa til leje i Hellerup" }), null);
  assert.equal(deriveHousingType({ title: "Rækkehus i Valby" }), null);
});

test("the source's own Boligtype outvotes prose three paragraphs down", () => {
  assert.equal(
    deriveHousingType({
      housing_type: "Lejlighed",
      title: "Bolig i København",
      description: "…soveværelse med indbyggede skabe…",
      rooms: 3,
    }),
    "apartment",
  );
});

test("an underivable type is null, so the gate can call it unknown", () => {
  assert.equal(deriveHousingType({ title: "Bolig i København", description: "" }), null);
});

// MARK: - Dedup

test("the same flat from two portals collides on one key", () => {
  // boligdeal aggregates and the same flat appears on lejebolig and boligzonen
  // under different ids and URLs. A duplicate on a race lane is two emails about
  // one flat, which trains you to stop reading them.
  const a = dedupeKeyHousing("Nørrebrogade 12, 2200 København N", 8950);
  const b = dedupeKeyHousing("Nørrebrogade 12, 3. th, 2200 København N", "8.950");
  assert.equal(a, b);
});

test("Danish letters transliterate before NFKD, or only one of three normalizes", () => {
  // NFKD decomposes `å` into a + combining ring but leaves `æ` and `ø` untouched.
  // A plain NFKD pass therefore normalizes one of the three and looks like it
  // worked.
  assert.equal(
    dedupeKeyHousing("Åboulevard 1", 5000),
    dedupeKeyHousing("Aaboulevard 1", 5000),
  );
  assert.match(dedupeKeyHousing("Nørrebrogade", 1), /noerrebrogade/);
  assert.match(dedupeKeyHousing("Ærøgade", 1), /aeroegade/);
});

test("different rent on the same street is a different listing", () => {
  assert.notEqual(
    dedupeKeyHousing("Nørrebrogade 12", 8950),
    dedupeKeyHousing("Nørrebrogade 12", 9950),
  );
});

test("a missing address or rent yields an empty segment, not a throw", () => {
  assert.equal(dedupeKeyHousing(null, null), "::");
  assert.equal(dedupeKeyHousing("Gade 1", null), "gade 1::");
});

// MARK: - Distance

test("haversine gets a known Copenhagen distance about right", () => {
  // Universitetsparken → Ågården (Kapelvej), both read off the live s.dk API.
  const km = haversineKm({ lat: 55.7015, lng: 12.5605 }, { lat: 55.6858871, lng: 12.55070596 });
  assert.ok(km > 1.5 && km < 2.5, `got ${km}`);
});

test("a missing coordinate is null, never Infinity", () => {
  // Infinity compares greater than every radius, which turns "no coordinates"
  // into "too far away" — the exact collapse this pipeline keeps guarding against.
  assert.equal(haversineKm({ lat: 55, lng: 12 }, { lat: null, lng: null }), null);
  assert.equal(haversineKm({ lat: 55, lng: 12 }, { lat: 55 }), null);
  // (0,0) is a real point in the Gulf of Guinea and must be measured, not waived.
  assert.ok(haversineKm({ lat: 55, lng: 12 }, { lat: 0, lng: 0 }) > 6000);
});

// MARK: - The cheap gate

const CRITERIA = {
  id: "c1",
  max_rent: 6000,
  center_lat: 55.7015,
  center_lng: 12.5605,
  radius_km: 5,
  types: ["kollegie", "room", "studio", "apartment"],
};

test("a listing over budget is dropped, with the numbers in the reason", () => {
  const g = cheapGateHousing({ rent: 21800, title: "Lejlighed" }, CRITERIA);
  assert.equal(g.verdict, "dropped");
  assert.match(g.reason, /21800 > 6000/);
});

test("a listing with no rent passes, flagged — absent is not over budget", () => {
  const g = cheapGateHousing({ rent: null, title: "Lejlighed" }, CRITERIA);
  assert.equal(g.verdict, "pass");
  assert.ok(g.flags.includes("rent_unknown"));
});

test("a listing with no coordinates passes, flagged — and that is EVERY Lane B listing", () => {
  // Neither automatable private portal publishes coordinates (verified
  // 2026-09-06). A radius check that dropped coordinate-less listings would drop
  // the entire lane, silently, and every run would be green.
  const g = cheapGateHousing({ rent: 5000, lat: null, lng: null, title: "Lejlighed" }, CRITERIA);
  assert.equal(g.verdict, "pass");
  assert.ok(g.flags.includes("coords_missing"));
  assert.equal(g.distance_km, null);
});

test("a listing outside the radius is dropped when it CAN be measured", () => {
  const g = cheapGateHousing(
    { rent: 5000, lat: 56.15, lng: 10.2, title: "Lejlighed" }, // Aarhus
    CRITERIA,
  );
  assert.equal(g.verdict, "dropped");
  assert.match(g.reason, /km > 5 km/);
  assert.ok(g.distance_km > 100);
});

test("an underivable type passes, flagged", () => {
  const g = cheapGateHousing({ rent: 5000, title: "Bolig i København" }, CRITERIA);
  assert.equal(g.verdict, "pass");
  assert.ok(g.flags.includes("type_unknown"));
});

test("a positively wrong type is dropped", () => {
  const g = cheapGateHousing({ rent: 5000, title: "Kollegieværelse" }, {
    ...CRITERIA,
    types: ["apartment"],
  });
  assert.equal(g.verdict, "dropped");
  assert.match(g.reason, /type kollegie not in apartment/);
});

test("an absent criterion is a test that is not run, not a test everything passes", () => {
  const g = cheapGateHousing({ rent: 99999, title: "Kollegieværelse" }, { id: "c2" });
  assert.equal(g.verdict, "pass");
  assert.equal(g.reason, null); // nothing was checked, so nothing is claimed
  assert.deepEqual(g.flags, []);
});

test("an excluded term drops on positive evidence", () => {
  const g = cheapGateHousing(
    { rent: 5000, title: "Lejlighed", description: "Kun til expats" },
    { ...CRITERIA, exclude_terms: ["expats"] },
  );
  assert.equal(g.verdict, "dropped");
  assert.match(g.reason, /excluded term: expats/);
});

test("an exclude term matches whole tokens only", () => {
  // The job pipeline passed a chef as an AI Engineering match because "ai" occurs
  // inside "available", "training" and "maintenance".
  const g = cheapGateHousing(
    { rent: 5000, title: "Lejlighed", description: "Nyistandsat med altan" },
    { ...CRITERIA, exclude_terms: ["stand"] },
  );
  assert.equal(g.verdict, "pass");
});

test("a real listing passes a realistic criteria row", () => {
  const row = parseLejeboligJsonLd(fixture("lejebolig-listing.html"), { url: LB_URL });
  const g = cheapGateHousing(row, { ...CRITERIA, max_rent: 9000 });
  assert.equal(g.verdict, "pass");
  assert.match(g.reason, /rent 8950 ≤ 9000/);
  assert.deepEqual(g.flags, ["coords_missing"]);
});

test("the deposit and available_from the server stores are actually sent", () => {
  // Neither is in HOUSING_PLAN.md §3 or the pinned brief; both are columns
  // `normalizeListing` reads. Not sending them leaves three columns permanently
  // null with nothing to say why.
  const row = extractBoligzonenListing(fixture("boligzonen-listing.html"), { url: BZ_URL });
  assert.equal(row.deposit, 65400);
  const wire = toIngestListing(row);
  assert.equal(wire.deposit, 65400);
  assert.equal(wire.available_from, "Snarest muligt");
  assert.equal(wire.housing_type, "apartment");
});

// MARK: - The wire shape

test("toIngestListing sends exactly the contract's fields and nothing else", () => {
  // `housing-ingest` answers {ok, listings, rejected}. An extra field is the kind
  // of thing that lands the whole batch in `rejected`, or is silently dropped, and
  // neither is noticed until someone reads a row.
  const row = extractBoligzonenListing(fixture("boligzonen-listing.html"), { url: BZ_URL });
  assert.equal(row.shared, false, "fixture should carry extras to strip");
  const wire = toIngestListing(row);
  assert.deepEqual(Object.keys(wire).sort(), [...LISTING_FIELDS].sort());
  assert.equal(wire.shared, undefined);
  assert.equal(wire.furnished, undefined);
  // The five fields housing-ingest REQUIRES. A missing one comes back in
  // `rejected` with a named error rather than failing the request.
  for (const k of ["url", "source_kind", "external_id", "title", "dedupe_key"]) {
    assert.ok(wire[k], `required field ${k} is empty`);
  }
});

test("a field the extractor did not set becomes null, not undefined", () => {
  // `undefined` disappears through JSON.stringify, so a column would silently stop
  // being sent rather than being sent as null.
  const wire = toIngestListing({ title: "x" });
  assert.equal(wire.rent, null);
  assert.ok("rent" in JSON.parse(JSON.stringify(wire)));
});

// MARK: - mit.s.dk

test("maps real s.dk search results into the buildings_sync shape", () => {
  const rows = parseSdkBuildings(json("sdk-buildings-search.json"));
  assert.ok(rows.length >= 3);
  const aa = rows.find((r) => r.external_id === "5");
  assert.equal(aa.source_kind, SOURCE_KIND.sdk);
  assert.equal(aa.name, "Ågården");
  assert.equal(aa.address, "Kapelvej 52-56");
  assert.equal(aa.zipcode, "2200");
  assert.equal(aa.rent_min, 2474);
  assert.equal(aa.rent_max, 3671);
  assert.ok(Math.abs(aa.lat - 55.6858871) < 1e-6);
});

test("the detail endpoint's different shape maps to the same row", () => {
  // Search says `min_rent` / `max_rent` and numeric coordinates; detail says
  // `rent_range {min,max}` and STRING coordinates. Handling both costs nothing and
  // means adding a detail sweep later is a workflow change, not a parser change.
  const [row] = parseSdkBuildings(json("sdk-building-detail.json"));
  assert.equal(row.external_id, "43");
  assert.equal(row.name, "Den Grønne Trekant");
  assert.equal(row.rent_min, 2402);
  assert.equal(row.rent_max, 7274);
  assert.equal(typeof row.lat, "number");
  assert.equal(row.ssl_eligible, true);
  assert.equal(row.administrator.email, "udlejning@bo-vita.dk");
});

test("short_wait has three states, and a failed call is not 'false'", () => {
  // /short-wait-time/ is exhaustive, so absence from a SUCCESSFUL call is real
  // evidence. A failed call is evidence of nothing, and marking all 38 buildings
  // false because one request timed out retracts every flag in the database.
  const search = json("sdk-buildings-search.json");
  const unknown = parseSdkBuildings(search);
  assert.equal(unknown[0].short_wait, null);

  const known = parseSdkBuildings(search, { shortWaitPks: ["5"] });
  assert.equal(known.find((r) => r.external_id === "5").short_wait, true);
  assert.equal(known.find((r) => r.external_id !== "5").short_wait, false);
});

test("ssl_eligible from an endpoint that does not publish it is null, not false", () => {
  const [row] = parseSdkBuildings({ results: [{ pk: 1, name: "X" }] });
  assert.equal(row.ssl_eligible, null);
  assert.equal(row.administrator, null);
});

test("tenancies_count never escapes into a top-level field", () => {
  // It is the number of units in the building, NOT vacancies — Lane A publishes no
  // vacancy concept at all. A UI rendering "42 available at Ågården" is lying.
  const [row] = parseSdkBuildings(json("sdk-buildings-search.json"));
  assert.equal(row.tenancies_count, undefined);
  assert.equal(row.raw.tenancies_count, 42);
});

test("parseSdkBuildings accepts a paginated envelope, a bare array and one object", () => {
  const one = { pk: 7, name: "Solo" };
  assert.equal(parseSdkBuildings({ count: 1, results: [one] }).length, 1);
  assert.equal(parseSdkBuildings([one]).length, 1);
  assert.equal(parseSdkBuildings(one).length, 1);
  assert.deepEqual(parseSdkBuildings(null), []);
});

test("the short-wait fixture parses with the same mapper", () => {
  const rows = parseSdkBuildings(json("sdk-short-wait.json"));
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => r.external_id));
});

// MARK: - The email

test("subject is the pinned shape", () => {
  const { subject } = buildListingEmail({
    title: "3 værelses lejlighed i København K",
    rent: 21800,
    address: "Peder Skrams Gade, 1054 København",
  });
  assert.equal(
    subject,
    "[Bolig 21.800 kr] 3 værelses lejlighed i København K — Peder Skrams Gade, 1054 København",
  );
});

test("an unknown rent renders '?' in the subject, never 0", () => {
  const { subject } = buildListingEmail({ title: "Bolig", rent: null });
  assert.match(subject, /^\[Bolig \? kr\]/);
});

test("an unknown age is 'age unknown', never 'just now'", () => {
  // The whole point of this email is to make him drop what he is doing for a
  // four-minute-old listing. Rendering an unknown age as "just now" spends that
  // reflex on a week-old ad, repeatedly, until the badge stops being trusted —
  // and then the pipeline still runs and no longer works.
  for (const v of [null, undefined, "", "I går", "not a date"]) {
    const a = listingAge(v, new Date("2026-09-06T12:00:00Z"));
    assert.equal(a.known, false);
    assert.equal(a.label, "age unknown");
    assert.equal(a.minutes, null);
  }
});

test("age labels scale from minutes to days", () => {
  const now = new Date("2026-09-06T12:00:00Z");
  assert.equal(listingAge("2026-09-06T11:56:00Z", now).label, "4 min old");
  assert.equal(listingAge("2026-09-06T09:00:00Z", now).label, "3 h old");
  assert.equal(listingAge("2026-09-04T12:00:00Z", now).label, "2 days old");
  assert.equal(listingAge("2026-09-06T11:59:59Z", now).label, "just now");
});

test("a date-only posted_at never claims minute precision", () => {
  // lejebolig publishes `datePosted: "2026-09-06"`. Local midnight is a floor, not
  // a moment, so "today" is the honest label and "12 h old" is fabricated.
  const now = new Date("2026-09-06T12:00:00Z");
  assert.equal(listingAge("2026-09-06", now).label, "today");
  assert.equal(listingAge("2026-09-05", now).label, "yesterday");
});

test("a future timestamp clamps to just-now rather than going negative", () => {
  const a = listingAge("2026-09-06T13:00:00Z", new Date("2026-09-06T12:00:00Z"));
  assert.equal(a.minutes, 0);
  assert.equal(a.label, "just now");
});

test("the age badge is above the title in the rendered HTML", () => {
  // Not decoration: on this lane the age IS the decision, and an email that leads
  // with the title reads like every other listing email he ignores.
  const { html } = buildListingEmail(
    { title: "Lejlighed", posted_at: "2026-09-06T11:56:00Z", url: "https://example.dk/x" },
    { now: new Date("2026-09-06T12:00:00Z") },
  );
  assert.ok(html.indexOf("4 min old") < html.indexOf("Lejlighed"));
});

test("the email carries exactly one action and it is the listing itself", () => {
  const { html } = buildListingEmail({ title: "x", url: "https://boligzonen.dk/lejeboliger/y" });
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(hrefs, ["https://boligzonen.dk/lejeboliger/y"]);
  // No approve/reject: the system never contacts a portal.
  assert.doesNotMatch(html, /approve|reject|godkend/i);
});

test("a refused URL renders text, not a link", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "//evil.example", ""]) {
    const { html } = buildListingEmail({ title: "x", url: bad });
    assert.equal(safeUrl(bad), null);
    assert.doesNotMatch(html, /<a href/);
    assert.match(html, /No usable link/);
  }
});

test("every interpolation is HTML-escaped", () => {
  const { html } = buildListingEmail({
    title: '<script>alert(1)</script>',
    address: '"><img onerror=x>',
    listing_id: "<b>",
  });
  assert.doesNotMatch(html, /<script>/);
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /&lt;script&gt;/);
});

test("a newline in a title cannot reach a mail header", () => {
  // `Subject: Lejlighed\nBcc: …` is one listing title away, and the title comes
  // out of markup a stranger wrote.
  const { subject } = buildListingEmail({ title: "Flat\nBcc: someone@example.com", rent: 5000 });
  assert.doesNotMatch(subject, /[\r\n]/);
  assert.equal(clampLine("a\r\nb"), "a b");
});

test("missing facts are absent rather than dashed", () => {
  // A dash-filled grid reads as "we checked and there is nothing", which is a
  // different and untrue claim from "the source did not say".
  const { html, text } = buildListingEmail({ title: "x", rent: null, rooms: null, sqm: null });
  assert.doesNotMatch(html, /husleje/);
  assert.doesNotMatch(text, /kr\./);
});

test("Danish number formatting in the email", () => {
  assert.equal(formatDkk(21800), "21.800");
  assert.equal(formatDkk(950), "950");
  assert.equal(formatDkk(null), null);
  assert.equal(formatDkk(""), null); // Number("") is 0
  assert.equal(formatKm(2.34), "2,3 km");
  assert.equal(formatKm(null), null);
  assert.equal(escapeHtml(null), "");
});

test("pairedItem unwraps all three n8n shapes", () => {
  // Output 0's index i stops being upstream index i the moment one send fails, and
  // the offset would stamp a Gmail message id onto the wrong listing.
  assert.equal(pairedSourceIndex(3, 0), 3);
  assert.equal(pairedSourceIndex({ item: 2 }, 0), 2);
  assert.equal(pairedSourceIndex([{ item: 5 }], 0), 5);
  assert.equal(pairedSourceIndex(undefined, 7), 7);
});

// MARK: - End to end over the fixtures

test("a real boligzonen page survives extract → gate → wire → email", () => {
  const row = extractBoligzonenListing(fixture("boligzonen-listing.html"), {
    url: BZ_URL,
    lastmod: "2026-09-06T11:40:00Z",
  });
  const gate = cheapGateHousing(row, { ...CRITERIA, max_rent: 25000 });
  assert.equal(gate.verdict, "pass");

  const wire = toIngestListing(row);
  const mail = buildListingEmail(
    { listing_id: "uuid-1", ...wire, distance_km: gate.distance_km },
    { now: new Date("2026-09-06T12:00:00Z") },
  );
  assert.match(mail.subject, /^\[Bolig 21\.800 kr\] 3 værelses lejlighed/);
  assert.match(mail.html, /20 min old/);
  assert.match(mail.html, new RegExp(escapeHtml(BZ_URL).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// MARK: - The renewal guard's emails
//
// Lane A's asset is seniority: six months to three years of waiting time that a
// single missed reconfirmation ends outright. Every case below is about not
// getting that wrong quietly.

const RENEWAL = {
  position_id: "11111111-1111-1111-1111-111111111111",
  list_name: "Lægeforeningens Kollegium",
  due_at: "2026-09-20",
  days_left: 14,
  renewal_url: "https://mit.s.dk/renew",
  ack_url: "https://efx.supabase.co/functions/v1/housing-renew?token=abc",
  interval_months: 12,
  position: 412,
  notes: "CIU list",
  last_renewed_at: "2025-09-20",
  signed_up_at: "2024-03-01",
  reminder_lead_days: 30,
  overdue: false,
};

const UNKNOWN = {
  position_id: "22222222-2222-2222-2222-222222222222",
  list_name: "findbolig.nu",
  signed_up_at: "2025-01-05",
  renewal_url: "https://findbolig.nu",
  ack_url: "https://efx.supabase.co/functions/v1/housing-renew?token=xyz",
  position: 88,
  notes: null,
};

test("the due subject is the pinned shape", () => {
  assert.equal(
    buildRenewalEmail(RENEWAL).subject,
    "⚠️ Venteliste: Lægeforeningens Kollegium — renewal due 2026-09-20",
  );
});

test("the overdue subject leads with the word and the absolute day count", () => {
  // `days_left` is NEGATIVE when overdue. A template that printed the raw number
  // would say "renewal due in -5 days", and one that took the sign backwards
  // would cheerfully say "5 days left" about a list that deleted him last week.
  const { subject } = buildRenewalEmail({ ...RENEWAL, days_left: -5, overdue: true });
  assert.equal(subject, "⚠️ Venteliste: Lægeforeningens Kollegium — OVERDUE 5d");
});

test("urgency reads the server's precomputed flag, and falls back to the sign", () => {
  assert.equal(renewalUrgency({ days_left: -1 }).label, "1 day OVERDUE");
  assert.equal(renewalUrgency({ days_left: 0 }).label, "due TODAY");
  assert.equal(renewalUrgency({ days_left: 1 }).label, "1 day left");
  assert.equal(renewalUrgency({ days_left: 14 }).label, "14 days left");
  // No flag: the sign decides.
  assert.equal(renewalUrgency({ days_left: -3 }).overdue, true);
  assert.equal(renewalUrgency({ days_left: 3 }).overdue, false);
});

test("an unknown countdown is LOUD, not zero and not quiet", () => {
  // The opposite polarity to `listingAge`, deliberately. An unknown listing age
  // costs a wasted click; an unknown renewal countdown is a row the guard cannot
  // reason about on a list whose deletion is irreversible, so it fails toward
  // alarm — the same rule as every accidental path in the blocking stack failing
  // toward "still blocked".
  const u = renewalUrgency({ days_left: null });
  assert.equal(u.known, false);
  assert.equal(u.daysLeft, null);
  assert.equal(u.label, "days left unknown");
  assert.equal(u.tone, "overdue");
  assert.equal(renewalUrgency({ days_left: "" }).label, "days left unknown");
});

test("a missing due date says so instead of rendering an empty line", () => {
  const { html, text } = buildRenewalEmail({ ...RENEWAL, due_at: null, days_left: null });
  assert.match(html, /not known — the guard could not compute a date/);
  assert.match(text, /not known — the guard could not compute a date/);
});

test("the email states what the guard BELIEVES, so it can be contradicted", () => {
  // last_renewed_at / interval_months / reminder_lead_days are not in the pinned
  // brief. A reminder that shows only its conclusion cannot be corrected by the
  // person reading it.
  const { text } = buildRenewalEmail(RENEWAL);
  assert.match(text, /Every:    12 months, last renewed 2025-09-20/);
  assert.match(text, /Warned:   from 30 days before/);
  assert.match(text, /Position: 412/);
});

test("with no last_renewed_at the email says the count runs from signup", () => {
  const { text } = buildRenewalEmail({ ...RENEWAL, last_renewed_at: null });
  assert.match(text, /counted from signup 2024-03-01/);
});

test("both links are rendered and the confirm link is described as a page", () => {
  const { html } = buildRenewalEmail(RENEWAL);
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(hrefs), new Set([RENEWAL.renewal_url, RENEWAL.ack_url]));
  // `housing-renew` renders on GET and mutates only on POST (with confirm=renewed),
  // so linking it is safe — but the email must say so, because a one-click
  // acknowledge would let a mail scanner push the due date a month forward.
  assert.match(html, /opens a confirm page/);
  assert.match(html, /a mail scanner cannot do it for you/);
});

test("a missing renewal_url does not cost the confirm link", () => {
  const { html, text } = buildRenewalEmail({ ...RENEWAL, renewal_url: null });
  assert.match(html, /Open the provider&#39;s site yourself/);
  assert.match(text, /I renewed today: https:/);
});

test("a refused ack_url is stated as a defect, not silently omitted", () => {
  for (const bad of ["javascript:alert(1)", "", null]) {
    const { html } = buildRenewalEmail({ ...RENEWAL, ack_url: bad });
    assert.match(html, /nothing can be acknowledged until that is fixed/);
  }
});

test("the unknown-interval email never renders a deadline, even if handed one", () => {
  // The two lists have DIFFERENT shapes — `unknown_interval` carries no `due_at`
  // and no `days_left` — and the brief this was written against claimed they
  // matched. Building against the brief would have interpolated two undefined
  // fields into an urgent-looking email.
  const poisoned = { ...UNKNOWN, due_at: "2026-09-01", days_left: -5, overdue: true };
  const { html, text } = buildUnknownIntervalEmail(poisoned);
  assert.doesNotMatch(html + text, /2026-09-01|OVERDUE|days left|Due:/);
  assert.match(html, /rule unknown/);
});

test("the unknown-interval email says an unknown rule is not no rule", () => {
  const { subject, html } = buildUnknownIntervalEmail(UNKNOWN);
  assert.equal(subject, "Venteliste: findbolig.nu — check this list's renewal rule");
  assert.match(html, /An unknown rule is not the same as no rule/);
  assert.match(html, /no deadline is being tracked for this list/i);
});

test("renewal emails escape every interpolation and cannot inject a header", () => {
  const nasty = {
    ...RENEWAL,
    list_name: "KKIK\nBcc: someone@example.com",
    notes: '<img src=x onerror=alert(1)>',
  };
  const { subject, html } = buildRenewalEmail(nasty);
  assert.doesNotMatch(subject, /[\r\n]/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);

  const u = buildUnknownIntervalEmail({ ...UNKNOWN, list_name: "<script>x</script>" });
  assert.doesNotMatch(u.html, /<script>/);
});

test("a position of 0 is rendered, because 0 is a real queue position", () => {
  // `if (position)` would drop it. Being first in the queue is exactly the row you
  // least want silently blanked.
  assert.match(buildRenewalEmail({ ...RENEWAL, position: 0 }).text, /Position: 0/);
});

test("formatYmd trims a timestamp to a date and leaves anything else alone", () => {
  assert.equal(formatYmd("2026-09-20T00:00:00Z"), "2026-09-20");
  assert.equal(formatYmd("2026-09-20"), "2026-09-20");
  assert.equal(formatYmd("snarest muligt"), "snarest muligt");
  assert.equal(formatYmd(null), null);
});
