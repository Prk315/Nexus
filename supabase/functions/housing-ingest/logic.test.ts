/**
 * housing-ingest — pure-logic tests.
 *
 * Run:
 *
 *     node --test supabase/functions/housing-ingest/logic.test.ts
 *
 * `node:test` rather than `jsr:@std/assert`, for the reason spelled out at the
 * top of `../job-ingest/logic.test.ts`: there is no Deno on this machine, Node
 * 24 strips types natively, and a test that cannot be executed is a comment.
 * This file's import graph (`./logic.ts` -> `../n8n-ingest/logic.ts`) reaches
 * nothing outside the repo, so it runs with no build step.
 *
 * # Scope
 *
 * Every case here is drawn from something that would go wrong SILENTLY. Three
 * families dominate, because all three failure modes look exactly like a quiet
 * week rather than like an error:
 *
 * 1. **Absent read as zero.** A price-less ad stored as 0 kr is the cheapest
 *    thing in the database and passes every budget gate as a bargain. A
 *    geolocation failure stored as (0, 0) is in the Gulf of Guinea, which the
 *    radius gate reads as a decisive no.
 * 2. **The re-harvest clobber.** Lane B re-ingests the same ad every 15 minutes
 *    by construction, so any column the upsert payload carries is a column a
 *    re-harvest rewrites. `job-ingest` had to be repaired for exactly this.
 * 3. **A gate that is silently over-eager.** A parser regression that starts
 *    returning null for rent must not stop the notifications; it must surface as
 *    an "unknown" flag on a listing a human still sees.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  addMonthsUtc,
  boundedJson,
  buildAckUrl,
  BUILDING_SOURCE_KINDS,
  canonicalizeUrl,
  coerceDate,
  type CriterionRow,
  daysBetween,
  daysInMonth,
  dedupeWithinBatch,
  DEFAULT_NOTIFY,
  DEFAULT_REMINDER_LEAD_DAYS,
  formatYmd,
  gateAgainstCriterion,
  gateListing,
  haversineKm,
  HOUSING_TYPES,
  inRenewalWindow,
  isUuid,
  leadDaysFor,
  LISTING_SOURCE_KINDS,
  MAX_NOTIFY,
  MAX_RENEWALS,
  nearestCriterionDistanceKm,
  normalizeBuilding,
  normalizeListing,
  type NotifyListingRow,
  parseBoolOrNull,
  parseBuildingBatch,
  parseHousingType,
  parseIntOrNull,
  parseLatLng,
  parseListingBatch,
  parseNotifyLimit,
  parseNotifyResult,
  parseNumberOrNull,
  parsePostalEntries,
  parseRenewalResult,
  parseStrictBool,
  parseYmd,
  parseZipcode,
  postalAllowed,
  postalVerdict,
  REMIND_REPEAT_DAYS,
  type RenewalPositionRow,
  renewalDaysLeft,
  renewalDueDate,
  remindThrottlePassed,
  secretIsUsable,
  secretMatches,
  selectNotifyCandidates,
  selectRenewals,
  todayInTz,
  UNKNOWN_INTERVAL_REPEAT_DAYS,
} from "./logic.ts";

const UID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const SRC = "11111111-2222-4333-8444-555555555555";
const NOW = "2026-09-06T12:00:00.000Z";

/** Universitetsparken, Nørre Campus KU. */
const CAMPUS = { lat: 55.7018, lng: 12.5601 };

const listing = (over: Record<string, unknown> = {}) => ({
  source_kind: "lejebolig_jsonld",
  external_id: "1897055",
  url: "https://www.lejebolig.dk/lejebolig/1897055/vaerelse-noerrebro",
  title: "Værelse på Nørrebro",
  dedupe_key: "tagensvej 12|2200|4200",
  ...over,
});

const criterion = (over: Partial<CriterionRow> = {}): CriterionRow => ({
  id: "c0000000-0000-4000-8000-000000000001",
  enabled: true,
  types: [],
  ...over,
});

// ---------------------------------------------------------------------------
describe("security primitives are imported, not re-implemented", () => {
  it("fails closed on a short or absent key", () => {
    // Invariant 2. An empty env var deploys perfectly cleanly, and without this
    // `X-Housing-Key: ""` would be a valid credential.
    assert.equal(secretIsUsable(undefined), false);
    assert.equal(secretIsUsable(""), false);
    assert.equal(secretIsUsable("x".repeat(31)), false);
    assert.equal(secretIsUsable("x".repeat(32)), true);
  });

  it("compares without short-circuiting on the first differing byte", () => {
    const expected = "k".repeat(40);
    assert.equal(secretMatches(expected, expected), true);
    assert.equal(secretMatches("k".repeat(39) + "j", expected), false);
    assert.equal(secretMatches("k".repeat(39), expected), false, "length differs");
    assert.equal(secretMatches("", expected), false);
  });
});

// ---------------------------------------------------------------------------
describe("canonicalizeUrl", () => {
  it("strips the params that make one flat look like several", () => {
    // The same flat reached from the search page, from page 2, and from a
    // BoligAgent email must produce ONE url — otherwise the pre-fetch seen-set
    // misses and the detail page is fetched again every poll.
    assert.equal(
      canonicalizeUrl("https://www.boligzonen.dk/lejeboliger/abc?page=2&sort=nyeste&utm_source=x"),
      "https://www.boligzonen.dk/lejeboliger/abc",
    );
    assert.equal(
      canonicalizeUrl("https://www.lejebolig.dk/lejebolig/1897055/x#gallery"),
      "https://www.lejebolig.dk/lejebolig/1897055/x",
    );
  });

  it("keeps params that identify the listing", () => {
    assert.equal(
      canonicalizeUrl("https://example.dk/bolig?id=42"),
      "https://example.dk/bolig?id=42",
    );
  });

  it("refuses anything that is not http(s)", () => {
    assert.equal(canonicalizeUrl("javascript:alert(1)"), null);
    assert.equal(canonicalizeUrl("mailto:udlejer@example.dk"), null);
    assert.equal(canonicalizeUrl("not a url"), null);
    assert.equal(canonicalizeUrl(null), null);
    assert.equal(canonicalizeUrl(12), null);
  });
});

// ---------------------------------------------------------------------------
describe("absent is never zero", () => {
  it("parseIntOrNull returns null, not 0, for everything unparseable", () => {
    // The single most consequential line in the file. "Pris efter aftale" stored
    // as 0 is the cheapest listing in the database and passes every budget gate.
    assert.equal(parseIntOrNull(undefined), null);
    assert.equal(parseIntOrNull(null), null);
    assert.equal(parseIntOrNull(""), null);
    assert.equal(parseIntOrNull("   "), null);
    assert.equal(parseIntOrNull("efter aftale"), null);
    assert.equal(parseIntOrNull(NaN), null);
    assert.equal(parseIntOrNull(Infinity), null);
    assert.equal(parseIntOrNull({}), null);
    assert.equal(parseIntOrNull(true), null, "a boolean is not a price");
    assert.equal(parseIntOrNull(0), 0, "a real zero survives");
  });

  it("accepts the quoted numbers JSON-LD emits", () => {
    assert.equal(parseIntOrNull("7995"), 7995);
    assert.equal(parseIntOrNull(" 4200 "), 4200);
    assert.equal(parseIntOrNull(4200.6), 4201);
  });

  it("treats an out-of-range value as a unit error, not as a datum", () => {
    // 7 995 000 is öre; a 100 000 m² room is square centimetres. Either would
    // wreck every sort in the panel, and neither is recoverable by rounding.
    assert.equal(parseIntOrNull(7_995_000, { max: 1_000_000 }), null);
    assert.equal(parseIntOrNull(-500, { min: 0 }), null);
  });

  it("parseNumberOrNull keeps the fraction — rooms are genuinely 1.5", () => {
    assert.equal(parseNumberOrNull("1.5"), 1.5);
    assert.equal(parseNumberOrNull("x"), null);
  });
});

// ---------------------------------------------------------------------------
describe("parseLatLng", () => {
  it("rejects (0, 0), which is a zeroed struct and not a location", () => {
    // The Gulf of Guinea is 5 000 km from campus, so letting it through turns an
    // UNKNOWN distance into a decisive "outside the radius" — the gate failing
    // in the direction that never announces itself.
    assert.deepEqual(parseLatLng(0, 0), [null, null]);
  });

  it("refuses half a coordinate", () => {
    assert.deepEqual(parseLatLng(55.7, null), [null, null]);
    assert.deepEqual(parseLatLng(null, 12.56), [null, null]);
    assert.deepEqual(parseLatLng(55.7, "not a number"), [null, null]);
  });

  it("rejects values outside the real ranges", () => {
    assert.deepEqual(parseLatLng(155.7, 12.56), [null, null]);
    assert.deepEqual(parseLatLng(55.7, 512.56), [null, null]);
  });

  it("accepts the strings a scraped attribute arrives as", () => {
    assert.deepEqual(parseLatLng("55.7018", "12.5601"), [55.7018, 12.5601]);
  });
});

// ---------------------------------------------------------------------------
describe("small field parsers", () => {
  it("parseZipcode takes four digits out of whatever surrounds them", () => {
    assert.equal(parseZipcode("2200"), "2200");
    assert.equal(parseZipcode("2200 København N"), "2200");
    assert.equal(parseZipcode("DK-2100"), "2100");
    assert.equal(parseZipcode("København"), null);
    assert.equal(parseZipcode(null), null);
  });

  it("parseHousingType admits only the shared domain", () => {
    assert.equal(parseHousingType("Kollegie"), "kollegie");
    assert.equal(parseHousingType(" ROOM "), "room");
    // An unrecognised word is null, i.e. "the portal did not say" — NOT a
    // rejection, because the gate must not drop a listing over vocabulary.
    assert.equal(parseHousingType("ungdomsbolig"), null);
    assert.equal(parseHousingType(""), null);
    for (const t of HOUSING_TYPES) assert.equal(parseHousingType(t), t);
  });

  it("coerceDate truncates to the calendar day", () => {
    // `available_from` is a `date` column. Keeping a time on it would make
    // "ledig fra 1. oktober" depend on which side of midnight the harvest ran.
    assert.equal(coerceDate("2026-10-01T00:00:00Z"), "2026-10-01");
    assert.equal(coerceDate("2026-10-01"), "2026-10-01");
    assert.equal(coerceDate("snarest muligt"), null);
    assert.equal(coerceDate(null), null);
  });

  it("parseBoolOrNull keeps 'we did not ask' distinct from 'no'", () => {
    assert.equal(parseBoolOrNull(true), true);
    assert.equal(parseBoolOrNull(false), false);
    assert.equal(parseBoolOrNull(undefined), null);
    assert.equal(parseBoolOrNull("true"), null, "a string is not a verdict here");
    assert.equal(parseBoolOrNull(0), null);
  });

  it("boundedJson stores null rather than failing a batch", () => {
    assert.deepEqual(boundedJson({ a: 1 }), { a: 1 });
    assert.equal(boundedJson(null), null);
    assert.equal(boundedJson({ big: "x".repeat(30_000) }), null);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.equal(boundedJson(cyclic), null);
  });

  it("isUuid", () => {
    assert.equal(isUuid(UID), true);
    assert.equal(isUuid("default"), false);
    assert.equal(isUuid(null), false);
  });
});

// ---------------------------------------------------------------------------
describe("haversineKm", () => {
  it("is zero for a point against itself", () => {
    assert.equal(haversineKm(CAMPUS.lat, CAMPUS.lng, CAMPUS.lat, CAMPUS.lng), 0);
  });

  it("gets one degree of latitude right", () => {
    const d = haversineKm(55, 12, 56, 12);
    assert.ok(Math.abs(d - 111.195) < 0.05, `expected ~111.195 km, got ${d}`);
  });

  it("is symmetric", () => {
    assert.equal(
      haversineKm(55.7018, 12.5601, 55.6867, 12.5451),
      haversineKm(55.6867, 12.5451, 55.7018, 12.5601),
    );
  });

  it("rounds to metres", () => {
    // An unrounded double lands in a `numeric` column as 2.4180000000000001,
    // which reads as false precision and makes two equal distances compare
    // unequal.
    const d = haversineKm(55.7018, 12.5601, 55.7118, 12.5701);
    assert.equal(d, Math.round(d * 1000) / 1000);
  });

  it("puts a nearby Nørrebro address within walking distance", () => {
    // Sanity, not precision: a bug in the radians conversion shows up as a
    // number three orders of magnitude out, which this catches and a tolerance
    // test on a made-up pair would not.
    const d = haversineKm(CAMPUS.lat, CAMPUS.lng, 55.6935, 12.5432);
    assert.ok(d > 0.5 && d < 3, `expected 0.5–3 km, got ${d}`);
  });
});

// ---------------------------------------------------------------------------
describe("nearestCriterionDistanceKm", () => {
  const near = criterion({ id: "near", center_lat: 55.7018, center_lng: 12.5601 });
  const far = criterion({ id: "far", center_lat: 55.6761, center_lng: 12.5683 });

  it("is null — never 0 — when there is nothing to measure", () => {
    // A 0 in a distance column reads as "on campus", the single best value
    // there is, and would sort a geolocation failure to the top of the panel.
    assert.equal(nearestCriterionDistanceKm(null, null, [near]), null);
    assert.equal(nearestCriterionDistanceKm(55.7, 12.5, []), null);
    assert.equal(nearestCriterionDistanceKm(55.7, 12.5, [criterion()]), null);
  });

  it("takes the nearest centre, not the first", () => {
    const d = nearestCriterionDistanceKm(55.6761, 12.5683, [near, far]);
    assert.equal(d, 0, "sitting on the second centre is a distance of zero");
  });

  it("reads a centre supplied as a string", () => {
    const asText = criterion({ center_lat: "55.7018", center_lng: "12.5601" });
    assert.equal(nearestCriterionDistanceKm(55.7018, 12.5601, [asText]), 0);
  });
});

// ---------------------------------------------------------------------------
describe("gateAgainstCriterion — a known value that fails is a hard drop", () => {
  it("drops over budget, with a reason", () => {
    // A drop ALWAYS carries a reason: an unexplained drop is indistinguishable
    // from a crawler bug, and the gate is the component most likely to be
    // silently over-eager.
    const v = gateAgainstCriterion({ rent: 9000 }, criterion({ max_rent: 6000 }));
    assert.equal(v.pass, false);
    assert.deepEqual(v.reasons, ["over_max_rent"]);
  });

  it("treats the cap as inclusive", () => {
    assert.equal(gateAgainstCriterion({ rent: 6000 }, criterion({ max_rent: 6000 })).pass, true);
  });

  it("drops outside the radius and reports the distance", () => {
    const c = criterion({ center_lat: CAMPUS.lat, center_lng: CAMPUS.lng, radius_km: 2 });
    const v = gateAgainstCriterion({ lat: 55.60, lng: 12.30 }, c);
    assert.equal(v.pass, false);
    assert.deepEqual(v.reasons, ["outside_radius"]);
    assert.ok(v.distance_km !== null && v.distance_km > 2);
  });

  it("drops a type the criterion did not ask for", () => {
    const c = criterion({ types: ["kollegie", "room"] });
    assert.equal(gateAgainstCriterion({ housing_type: "apartment" }, c).pass, false);
    assert.equal(gateAgainstCriterion({ housing_type: "kollegie" }, c).pass, true);
  });

  it("drops rooms outside the range", () => {
    const c = criterion({ min_rooms: 1, max_rooms: 2 });
    assert.equal(gateAgainstCriterion({ rooms: 3 }, c).pass, false);
    assert.equal(gateAgainstCriterion({ rooms: 2 }, c).pass, true);
    assert.equal(gateAgainstCriterion({ rooms: "1.5" }, c).pass, true);
  });

  it("computes a distance even with no radius, because the number is worth reporting", () => {
    const c = criterion({ center_lat: CAMPUS.lat, center_lng: CAMPUS.lng });
    const v = gateAgainstCriterion({ lat: 55.6935, lng: 12.5432 }, c);
    assert.equal(v.pass, true);
    assert.ok(v.distance_km !== null && v.distance_km > 0);
  });
});

// ---------------------------------------------------------------------------
describe("gateAgainstCriterion — an unknown is INCONCLUSIVE and passes with a flag", () => {
  it("passes an unpriced listing rather than silently dropping it", () => {
    // The failure this prevents: a parser regression that starts returning null
    // for rent would otherwise stop the notifications entirely and look exactly
    // like a quiet week.
    const v = gateAgainstCriterion({ rent: null }, criterion({ max_rent: 6000 }));
    assert.equal(v.pass, true);
    assert.deepEqual(v.reasons, ["rent_unknown"]);
  });

  it("passes a listing with no coordinates rather than reading it as far away", () => {
    const c = criterion({ center_lat: CAMPUS.lat, center_lng: CAMPUS.lng, radius_km: 2 });
    const v = gateAgainstCriterion({ lat: null, lng: null }, c);
    assert.equal(v.pass, true);
    assert.deepEqual(v.reasons, ["distance_unknown"]);
    assert.equal(v.distance_km, null);
  });

  it("passes an untyped listing against a typed criterion", () => {
    const v = gateAgainstCriterion({ housing_type: null }, criterion({ types: ["kollegie"] }));
    assert.equal(v.pass, true);
    assert.deepEqual(v.reasons, ["type_unknown"]);
  });

  it("passes a listing with no room count", () => {
    const v = gateAgainstCriterion({ rooms: null }, criterion({ min_rooms: 1 }));
    assert.equal(v.pass, true);
    assert.deepEqual(v.reasons, ["rooms_unknown"]);
  });

  it("flags nothing when the criterion does not gate on the missing field", () => {
    // No `max_rent` means no budget gate, so a null rent is not even a question.
    const v = gateAgainstCriterion({ rent: null, rooms: null }, criterion());
    assert.equal(v.pass, true);
    assert.deepEqual(v.reasons, []);
  });

  it("a radius with no centre gates nothing", () => {
    // Half a configuration must not become a decisive verdict. The migration's
    // CHECK forbids half a coordinate; this is the same rule at the gate.
    const v = gateAgainstCriterion({ lat: null, lng: null }, criterion({ radius_km: 2 }));
    assert.equal(v.pass, true);
    assert.deepEqual(v.reasons, []);
  });
});

// ---------------------------------------------------------------------------
describe("gateListing — criteria are alternatives", () => {
  const cheapRoom = criterion({ id: "cheap", max_rent: 4500, types: ["room", "kollegie"] });
  const properFlat = criterion({ id: "flat", max_rent: 9000, min_rooms: 2 });

  it("passes on ANY criterion, not all of them", () => {
    // Adding a second criterion must WIDEN the search. Requiring both would make
    // an insert into the modularity surface narrow it, which is backwards.
    const v = gateListing({ rent: 4200, rooms: 1, housing_type: "room" }, [cheapRoom, properFlat]);
    assert.equal(v.pass, true);
    assert.deepEqual(v.matched, ["cheap"]);
  });

  it("reports every criterion it matched", () => {
    const wide = criterion({ id: "wide" });
    const v = gateListing({ rent: 4200, rooms: 1, housing_type: "room" }, [cheapRoom, wide]);
    assert.deepEqual(v.matched, ["cheap", "wide"]);
  });

  it("fails with 'no_criteria' when nothing is configured", () => {
    // An empty criteria set is "nothing has been set up", NOT "everything
    // matches". The alternative emails about every flat in Copenhagen the moment
    // the panel is cleared — the loudest possible version of failing open.
    const v = gateListing({ rent: 4200 }, []);
    assert.equal(v.pass, false);
    assert.deepEqual(v.reasons, ["no_criteria"]);
  });

  it("ignores disabled criteria", () => {
    const off = criterion({ id: "off", enabled: false, max_rent: 99_000 });
    assert.equal(gateListing({ rent: 50_000 }, [off]).pass, false);
    assert.deepEqual(gateListing({ rent: 50_000 }, [off]).reasons, ["no_criteria"]);
  });

  it("carries only the MATCHED criterion's unknowns into the flags", () => {
    // A `rent_unknown` from a criterion the listing failed on other grounds is
    // noise, and would put "we could not read the price" on an email about a
    // listing that matched a criterion with no budget gate at all.
    const budgeted = criterion({ id: "budget", max_rent: 4000, min_rooms: 9 });
    const anything = criterion({ id: "any" });
    const v = gateListing({ rent: null, rooms: 1 }, [budgeted, anything]);
    assert.equal(v.pass, true);
    assert.deepEqual(v.matched, ["any"]);
    assert.deepEqual(v.reasons, []);
  });

  it("keeps the unknowns of the criterion that DID match", () => {
    const v = gateListing({ rent: null }, [criterion({ id: "c", max_rent: 5000 })]);
    assert.equal(v.pass, true);
    assert.deepEqual(v.reasons, ["rent_unknown"]);
  });

  it("reports the nearest distance across every criterion it looked at", () => {
    const a = criterion({ id: "a", center_lat: 55.7018, center_lng: 12.5601 });
    const b = criterion({ id: "b", center_lat: 55.6761, center_lng: 12.5683 });
    const v = gateListing({ lat: 55.6761, lng: 12.5683 }, [a, b]);
    assert.equal(v.distance_km, 0);
  });

  it("explains a total failure rather than returning an empty reason list", () => {
    const v = gateListing({ rent: 20_000, rooms: 1 }, [cheapRoom, properFlat]);
    assert.equal(v.pass, false);
    assert.ok(v.reasons.includes("over_max_rent"));
    assert.ok(v.reasons.length > 0, "a drop must always be explained");
  });
});

// ---------------------------------------------------------------------------
describe("normalizeListing", () => {
  it("accepts a well-formed listing", () => {
    const r = normalizeListing(
      listing({
        source_id: SRC,
        address: "Tagensvej 12, 2. tv",
        zipcode: "2200 København N",
        lat: "55.6935",
        lng: "12.5432",
        rent: "4200",
        rooms: 1,
        sqm: "18",
        deposit: 12_600,
        available_from: "2026-10-01",
        posted_at: "2026-09-06T09:12:00Z",
        housing_type: "Room",
        description: "Lyst værelse\n\nmed fælleskøkken.",
      }),
      UID,
    );
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    assert.equal(r.listing.user_id, UID);
    assert.equal(r.listing.source_id, SRC);
    assert.equal(r.listing.zipcode, "2200");
    assert.equal(r.listing.rent, 4200);
    assert.equal(r.listing.sqm, 18);
    assert.equal(r.listing.housing_type, "room");
    assert.equal(r.listing.available_from, "2026-10-01");
    assert.equal(r.listing.lat, 55.6935);
    assert.equal(r.listing.description, "Lyst værelse\n\nmed fælleskøkken.");
    assert.equal(r.listing.distance_km, null, "filled in by the caller, which has the criteria");
  });

  it("rejects — with a reason — each of the five identity fields", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ url: "not a url" }, "invalid_url"],
      [{ source_kind: "boligportal_scrape" }, "invalid_source_kind"],
      [{ external_id: "" }, "missing_external_id"],
      [{ title: null }, "missing_title"],
      [{ dedupe_key: "  " }, "missing_dedupe_key"],
    ];
    for (const [over, expected] of cases) {
      const r = normalizeListing(listing(over), UID);
      assert.equal(r.ok, false, `expected a rejection for ${expected}`);
      if (!r.ok) assert.equal(r.error, expected);
    }
    assert.equal(normalizeListing(null, UID).ok, false);
    assert.equal(normalizeListing("a string", UID).ok, false);
  });

  it("never invents a dedupe_key", () => {
    // A locally-invented key does not error, it produces a SECOND row for a flat
    // that is already stored — and downstream that is two enquiries to one
    // landlord. Rejecting with a reason is the loud failure; inventing is the
    // quiet one. (The rule itself lives in the extractor; see the column comment
    // in 20260906120000_housing_pipeline.sql.)
    const r = normalizeListing(listing({ dedupe_key: undefined }), UID);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "missing_dedupe_key");
  });

  it("refuses the Lane A source kinds down the Lane B path", () => {
    // A dorm has no posted_at and never vanishes. Filing one as a listing gives
    // it a status lifecycle it never traverses.
    const r = normalizeListing(listing({ source_kind: "sdk_api" }), UID);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error, "invalid_source_kind");
    for (const k of LISTING_SOURCE_KINDS) {
      assert.equal(normalizeListing(listing({ source_kind: k }), UID).ok, true);
    }
  });

  it("⚠️ carries no status, first_seen_at or notified_at — the clobber invariant", () => {
    // PostgREST builds the DO UPDATE SET list from the keys present in the body.
    // Lane B re-harvests the same ad every 15 minutes, so a payload carrying
    // `status` would walk every notified listing back to un-notified and
    // re-email it, forever, at 96 polls a day. This is the bug that ate
    // `job_matches` between Aug 26 and Sep 3; here it is structural.
    const r = normalizeListing(listing(), UID);
    if (!r.ok) throw new Error("expected ok");
    const keys = Object.keys(r.listing);
    for (const forbidden of ["status", "first_seen_at", "notified_at", "notify_message_id"]) {
      assert.equal(keys.includes(forbidden), false, `${forbidden} must not be in the payload`);
    }
  });

  it("degrades every optional field to null rather than to a number", () => {
    const r = normalizeListing(listing(), UID);
    if (!r.ok) throw new Error("expected ok");
    assert.equal(r.listing.rent, null);
    assert.equal(r.listing.rooms, null);
    assert.equal(r.listing.sqm, null);
    assert.equal(r.listing.deposit, null);
    assert.equal(r.listing.lat, null);
    assert.equal(r.listing.posted_at, null);
    assert.equal(r.listing.housing_type, null);
  });
});

// ---------------------------------------------------------------------------
describe("normalizeBuilding", () => {
  const building = (over: Record<string, unknown> = {}) => ({
    source_kind: "sdk_api",
    external_id: 43,
    name: "Den Grønne Trekant",
    ...over,
  });

  it("accepts mit.s.dk's numeric pk as an id", () => {
    // `pk` is a number in that JSON, which is normal here in a way it is not for
    // a job board. Rejecting it would make the whole Lane A sync a no-op.
    const r = normalizeBuilding(building(), UID, NOW);
    if (!r.ok) throw new Error(`expected ok, got ${r.error}`);
    assert.equal(r.building.external_id, "43");
    assert.equal(r.building.last_seen_at, NOW);
  });

  it("keeps short_wait and ssl_eligible three-valued", () => {
    // A sync that did not call /short-wait-time/ knows nothing, and a `false`
    // would drop a building off the shortlist on the strength of a fetch that
    // never happened.
    const unasked = normalizeBuilding(building(), UID, NOW);
    if (!unasked.ok) throw new Error("expected ok");
    assert.equal(unasked.building.short_wait, null);
    assert.equal(unasked.building.ssl_eligible, null);

    const asked = normalizeBuilding(building({ short_wait: false }), UID, NOW);
    if (!asked.ok) throw new Error("expected ok");
    assert.equal(asked.building.short_wait, false, "a real false survives");
  });

  it("rejects the Lane B source kinds", () => {
    const r = normalizeBuilding(building({ source_kind: "lejebolig_jsonld" }), UID, NOW);
    assert.equal(r.ok, false);
    for (const k of BUILDING_SOURCE_KINDS) {
      assert.equal(normalizeBuilding(building({ source_kind: k }), UID, NOW).ok, true);
    }
  });

  it("requires a name and reports the id it could not name", () => {
    const r = normalizeBuilding(building({ name: "" }), UID, NOW);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error, "missing_name");
      assert.equal(r.external_id, "43", "the rejection must be traceable to a row");
    }
  });

  it("carries no first_seen_at — the same clobber rule as a listing", () => {
    const r = normalizeBuilding(building(), UID, NOW);
    if (!r.ok) throw new Error("expected ok");
    assert.equal(Object.keys(r.building).includes("first_seen_at"), false);
    assert.equal(
      Object.keys(r.building).includes("last_seen_at"),
      true,
      "last_seen_at DOES refresh — that is what a Lane A sync is for",
    );
  });
});

// ---------------------------------------------------------------------------
describe("batch parsing", () => {
  it("caps the batch instead of letting one fat request stall the pipeline", () => {
    const many = Array.from({ length: 201 }, (_, i) => listing({ external_id: String(i) }));
    assert.equal(parseListingBatch({ user_id: UID, listings: many }).error, "too_many_listings");
    const buildings = Array.from({ length: 201 }, () => ({}));
    assert.equal(
      parseBuildingBatch({ user_id: UID, buildings }, NOW).error,
      "too_many_buildings",
    );
  });

  it("refuses a non-uuid user_id", () => {
    // `user_id = 'default'` is the convention on the thirteen permissive
    // productivity tables. These are `auth.uid()`-scoped and a text id here would
    // create rows no client can ever see or delete.
    assert.equal(parseListingBatch({ user_id: "default", listings: [] }).error, "invalid_user_id");
  });

  it("rejects per item rather than failing the whole batch", () => {
    const parsed = parseListingBatch({
      user_id: UID,
      listings: [listing(), listing({ url: "nope", external_id: "2" })],
    });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.listings?.length, 2);
    assert.equal(parsed.listings?.[0].ok, true);
    assert.equal(parsed.listings?.[1].ok, false);
  });

  it("names the missing array", () => {
    assert.equal(parseListingBatch({ user_id: UID }).error, "listings_not_an_array");
    assert.equal(parseBuildingBatch({ user_id: UID }, NOW).error, "buildings_not_an_array");
  });
});

// ---------------------------------------------------------------------------
describe("dedupeWithinBatch", () => {
  it("collapses a repeated key, last wins", () => {
    // Postgres rejects a single statement that touches the same conflict key
    // twice ("ON CONFLICT DO UPDATE command cannot affect row a second time").
    // A sitemap listing one slug twice is enough to hit it, and the whole batch
    // would fail rather than the duplicate being ignored.
    const rows = [
      { source_kind: "a", external_id: "1", n: 1 },
      { source_kind: "a", external_id: "1", n: 2 },
      { source_kind: "b", external_id: "1", n: 3 },
    ];
    const out = dedupeWithinBatch(rows);
    assert.equal(out.length, 2);
    assert.equal(out[0].n, 2, "the later item is the more recently fetched one");
  });

  it("treats the same id from two sources as two rows", () => {
    // The unique index is (user_id, source_kind, external_id): lejebolig's
    // '1897055' and boligzonen's '1897055' are different flats. Cross-source
    // duplicates are `dedupe_key`'s job, not this function's.
    const out = dedupeWithinBatch([
      { source_kind: "lejebolig_jsonld", external_id: "1897055" },
      { source_kind: "boligzonen_sitemap", external_id: "1897055" },
    ]);
    assert.equal(out.length, 2);
  });
});

// ---------------------------------------------------------------------------
describe("notify_pending", () => {
  const row = (over: Partial<NotifyListingRow> = {}): NotifyListingRow => ({
    id: "l0000000-0000-4000-8000-000000000001",
    title: "Værelse",
    url: "https://www.lejebolig.dk/lejebolig/1/x",
    address: "Tagensvej 12",
    zipcode: "2200",
    rent: 4200,
    rooms: 1,
    sqm: 18,
    lat: 55.6935,
    lng: 12.5432,
    housing_type: "room",
    available_from: "2026-10-01",
    posted_at: "2026-09-06T09:00:00Z",
    first_seen_at: "2026-09-06T09:05:00Z",
    source_kind: "lejebolig_jsonld",
    ...over,
  });

  const near = criterion({
    id: "near",
    max_rent: 6000,
    center_lat: CAMPUS.lat,
    center_lng: CAMPUS.lng,
    radius_km: 3,
  });

  it("returns the gate-passing rows in the order given", () => {
    // The caller queries `first_seen_at asc` and this preserves it. In a race
    // lane the listing that has waited longest is the one closest to being gone;
    // any clever re-sort starves it.
    const out = selectNotifyCandidates(
      [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })],
      [near],
      { limit: 10 },
    );
    assert.deepEqual(out.map((o) => o.listing_id), ["a", "b", "c"]);
  });

  it("drops what the gate drops", () => {
    const out = selectNotifyCandidates(
      [row({ id: "cheap" }), row({ id: "dear", rent: 12_000 })],
      [near],
      { limit: 10 },
    );
    assert.deepEqual(out.map((o) => o.listing_id), ["cheap"]);
  });

  it("honours the limit", () => {
    const out = selectNotifyCandidates([row(), row(), row()], [near], { limit: 2 });
    assert.equal(out.length, 2);
  });

  it("returns an empty list rather than throwing when nothing qualifies", () => {
    // Most polls find nothing. A workflow that reported red on "nothing to ask
    // about" would be red all week and therefore read by nobody.
    assert.deepEqual(selectNotifyCandidates([], [near], { limit: 10 }), []);
    assert.deepEqual(selectNotifyCandidates([row()], [], { limit: 10 }), []);
  });

  it("carries the live distance and the criteria it matched", () => {
    const [item] = selectNotifyCandidates([row()], [near], { limit: 10 });
    assert.deepEqual(item.criteria_ids, ["near"]);
    assert.ok(item.distance_km !== null && item.distance_km > 0 && item.distance_km < 3);
  });

  it("surfaces an unpriced listing WITH a flag rather than implying a price", () => {
    const [item] = selectNotifyCandidates([row({ rent: null })], [near], { limit: 10 });
    assert.equal(item.rent, null, "never 0");
    assert.deepEqual(item.flags, ["rent_unknown"]);
  });

  it("parseNotifyLimit clamps and defaults", () => {
    assert.equal(parseNotifyLimit(undefined), DEFAULT_NOTIFY);
    assert.equal(parseNotifyLimit("abc"), DEFAULT_NOTIFY);
    assert.equal(parseNotifyLimit(0), 1);
    assert.equal(parseNotifyLimit(-5), 1);
    assert.equal(parseNotifyLimit(1000), MAX_NOTIFY);
    assert.equal(parseNotifyLimit("5"), 5);
  });
});

// ---------------------------------------------------------------------------
describe("parseNotifyResult", () => {
  const base = { user_id: UID, listing_id: SRC, ok: true };

  it("accepts a well-formed report", () => {
    const p = parseNotifyResult({ ...base, message_id: "<abc@mail.gmail.com>" });
    assert.equal(p.ok, true);
    if (p.ok) {
      assert.equal(p.result.listingId, SRC);
      assert.equal(p.result.messageId, "<abc@mail.gmail.com>");
    }
  });

  it("refuses an ambiguous `ok`", () => {
    // n8n emits "" for an expression that resolved to nothing. Coercing that to
    // false makes a broken expression a reported failure, which retries forever;
    // coercing to true marks a listing notified that nobody was told about.
    for (const bad of ["", 0, 1, null, undefined, "yes"]) {
      assert.equal(parseNotifyResult({ ...base, ok: bad }).ok, false);
    }
    assert.equal(parseStrictBool("true"), true);
    assert.equal(parseStrictBool("false"), false);
    assert.equal(parseStrictBool(""), null);
  });

  it("refuses ids that are not uuids", () => {
    assert.equal(parseNotifyResult({ ...base, listing_id: "42" }).ok, false);
    assert.equal(parseNotifyResult({ ...base, user_id: "default" }).ok, false);
  });

  it("accepts a missing message_id as null", () => {
    const p = parseNotifyResult(base);
    assert.equal(p.ok, true);
    if (p.ok) assert.equal(p.result.messageId, null);
  });
});

// ===========================================================================
// The renewal guard
// ===========================================================================
//
// These cases are not about coverage. Every one of them is a way the guard could
// go quiet while looking healthy — and a guard that goes quiet costs the thing
// the whole housing effort is protecting: waiting-list seniority, which both
// Copenhagen lists delete MONTHLY and neither restores.
//
// The verified rules and their sources are quoted verbatim in
// `supabase/migrations/20260906150000_housing_renewal_guard.sql`.

const TODAY = { y: 2026, m: 9, d: 6 };
const TODAY_MS = Date.UTC(2026, 8, 6, 10, 0, 0);
const ACK = (t: string) => `https://x.supabase.co/functions/v1/housing-renew?token=${t}`;
const TOKEN = "99999999-8888-4777-8666-555555555555";

const position = (over: Partial<RenewalPositionRow> = {}): RenewalPositionRow => ({
  id: "aaaaaaaa-1111-4111-8111-111111111111",
  list_name: "KKIK",
  signed_up_at: "2024-03-15",
  last_renewed_at: null,
  renewal_interval_months: 1,
  reminder_lead_days: 7,
  renewal_url: "https://www.kollegierneskontor.dk/",
  last_reminded_at: null,
  ack_token: TOKEN,
  position: 42,
  notes: null,
  ...over,
});

describe("calendar arithmetic", () => {
  it("clamps a month-end rollover exactly as Postgres does", () => {
    // `date '2026-01-31' + interval '1 month'` is 2026-02-28, NOT March 3rd.
    // Naive JS date math gives March 3rd — which on a MONTHLY list is a reminder
    // three days after the application was already deleted. This is the single
    // most consequential line of arithmetic in the guard.
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 1, d: 31 }, 1)), "2026-02-28");
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 1, d: 30 }, 1)), "2026-02-28");
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 1, d: 29 }, 1)), "2026-02-28");
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 1, d: 28 }, 1)), "2026-02-28");
    // A leap year clamps one day later, and 2028 is one.
    assert.equal(formatYmd(addMonthsUtc({ y: 2028, m: 1, d: 31 }, 1)), "2028-02-29");
    // 30-day months clamp too.
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 3, d: 31 }, 1)), "2026-04-30");
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 5, d: 31 }, 1)), "2026-06-30");
  });

  it("does not clamp when it does not have to, and crosses years", () => {
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 1, d: 15 }, 1)), "2026-02-15");
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 12, d: 15 }, 1)), "2027-01-15");
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 11, d: 30 }, 12)), "2027-11-30");
  });

  it("clamping is NOT reversible, and the guard must not assume it is", () => {
    // Jan 31 -> Feb 28 -> Mar 28, not back to Mar 31. This is why the due date is
    // always recomputed from the anchor rather than accumulated month by month:
    // twelve successive +1s would drift a January-31 sign-up to the 28th forever.
    const once = addMonthsUtc({ y: 2026, m: 1, d: 31 }, 1);
    assert.equal(formatYmd(addMonthsUtc(once, 1)), "2026-03-28");
    assert.equal(formatYmd(addMonthsUtc({ y: 2026, m: 1, d: 31 }, 2)), "2026-03-31");
  });

  it("daysInMonth handles the century leap rule", () => {
    assert.equal(daysInMonth(2024, 2), 29);
    assert.equal(daysInMonth(2026, 2), 28);
    assert.equal(daysInMonth(2100, 2), 28); // divisible by 100, not 400
    assert.equal(daysInMonth(2000, 2), 29); // divisible by 400
  });

  it("parseYmd refuses an impossible date instead of rolling it over", () => {
    // `new Date("2026-02-30")` silently becomes March 2nd. A due date computed
    // from a silently-shifted anchor is wrong in the direction that never
    // announces itself.
    assert.equal(parseYmd("2026-02-30"), null);
    assert.equal(parseYmd("2026-13-01"), null);
    assert.equal(parseYmd("2026-00-10"), null);
    assert.equal(parseYmd("2026-04-31"), null);
    assert.equal(parseYmd("2026-02-29"), null); // 2026 is not a leap year
    assert.deepEqual(parseYmd("2028-02-29"), { y: 2028, m: 2, d: 29 });
    // The date half of a timestamp is accepted — `date` columns and timestamps
    // both reach this function.
    assert.deepEqual(parseYmd("2026-03-15T22:14:00Z"), { y: 2026, m: 3, d: 15 });
    assert.equal(parseYmd(null), null);
    assert.equal(parseYmd(""), null);
  });

  it("daysBetween is exact across a DST boundary", () => {
    // Denmark changes clocks on the last Sunday of March and October. A local-time
    // implementation is off by one on those two days a year, and the bug gets
    // blamed on something else both times.
    assert.equal(daysBetween({ y: 2026, m: 3, d: 28 }, { y: 2026, m: 3, d: 30 }), 2);
    assert.equal(daysBetween({ y: 2026, m: 10, d: 24 }, { y: 2026, m: 10, d: 26 }), 2);
    assert.equal(daysBetween({ y: 2026, m: 12, d: 31 }, { y: 2027, m: 1, d: 1 }), 1);
    assert.equal(daysBetween({ y: 2026, m: 9, d: 6 }, { y: 2026, m: 9, d: 6 }), 0);
    assert.equal(daysBetween({ y: 2026, m: 9, d: 8 }, { y: 2026, m: 9, d: 6 }), -2);
  });

  it("todayInTz reads a Copenhagen calendar date, not a UTC one", () => {
    // 22:30 UTC on Sep 6 is already Sep 7 in Copenhagen (CEST, +02:00). A "today"
    // that lags loses a day of margin, and margin is the entire product here.
    assert.deepEqual(todayInTz(Date.UTC(2026, 8, 6, 22, 30)), { y: 2026, m: 9, d: 7 });
    assert.deepEqual(todayInTz(Date.UTC(2026, 8, 6, 10, 0)), { y: 2026, m: 9, d: 6 });
    // Winter is +01:00, so the boundary moves.
    assert.deepEqual(todayInTz(Date.UTC(2026, 0, 6, 23, 30)), { y: 2026, m: 1, d: 7 });
    assert.deepEqual(todayInTz(Date.UTC(2026, 0, 6, 22, 30)), { y: 2026, m: 1, d: 6 });
  });
});

describe("renewal due-date derivation", () => {
  it("derives from last_renewed_at in preference to signed_up_at", () => {
    // The clock restarts from the acknowledgement. Anchoring on sign-up forever
    // would make every renewed row permanently overdue.
    const row = position({ signed_up_at: "2024-03-15", last_renewed_at: "2026-08-20" });
    assert.equal(formatYmd(renewalDueDate(row)!), "2026-09-20");
  });

  it("falls back to signed_up_at before the first renewal", () => {
    const row = position({ signed_up_at: "2026-08-31", last_renewed_at: null });
    assert.equal(formatYmd(renewalDueDate(row)!), "2026-09-30");
  });

  it("has NO due date when the interval is unknown", () => {
    // NULL is "no verdict", not "never expires" and not "due far away". Inventing
    // a date here would be folklore with a deadline on it.
    assert.equal(renewalDueDate(position({ renewal_interval_months: null })), null);
    assert.equal(renewalDaysLeft(position({ renewal_interval_months: null }), TODAY), null);
  });

  it("has NO due date when he is not on the list yet", () => {
    // Both anchors null: a row created while planning to sign up. There is no
    // seniority to protect, and reminding him to renew something he never joined
    // is what teaches a person to ignore this channel.
    const row = position({ signed_up_at: null, last_renewed_at: null });
    assert.equal(renewalDueDate(row), null);
  });

  it("reports days_left NEGATIVE when overdue", () => {
    const row = position({ last_renewed_at: "2026-08-01" }); // due 2026-09-01
    assert.equal(renewalDaysLeft(row, TODAY), -5);
  });

  it("refuses a zero or negative interval rather than treating it as due forever", () => {
    // Mirrors the CHECK constraint. A 0 would put due_at <= the anchor, i.e. due
    // forever — a reminder twice a week for a list that is fine, which is how a
    // guard gets filtered into a folder.
    for (const bad of [0, -1, "0"]) {
      assert.equal(renewalDueDate(position({ renewal_interval_months: bad })), null);
    }
  });

  it("leadDaysFor falls back to the column default, never to zero", () => {
    assert.equal(leadDaysFor(position({ reminder_lead_days: 30 })), 30);
    assert.equal(leadDaysFor(position({ reminder_lead_days: 0 })), 0);
    // A missing or junk lead must not become 0 — "tell him on the day it expires"
    // is too late by the width of one cron tick.
    assert.equal(leadDaysFor(position({ reminder_lead_days: null })), DEFAULT_REMINDER_LEAD_DAYS);
    assert.equal(leadDaysFor(position({ reminder_lead_days: "x" })), DEFAULT_REMINDER_LEAD_DAYS);
    assert.equal(leadDaysFor(position({ reminder_lead_days: -3 })), DEFAULT_REMINDER_LEAD_DAYS);
  });

  it("inRenewalWindow opens at exactly the lead and stays open when overdue", () => {
    assert.equal(inRenewalWindow(8, 7), false);
    assert.equal(inRenewalWindow(7, 7), true); // boundary is inclusive
    assert.equal(inRenewalWindow(0, 7), true);
    assert.equal(inRenewalWindow(-40, 7), true); // overdue never falls out
  });
});

describe("remindThrottlePassed", () => {
  it("passes when never reminded", () => {
    assert.equal(remindThrottlePassed(null, TODAY_MS, REMIND_REPEAT_DAYS), true);
    assert.equal(remindThrottlePassed("", TODAY_MS, REMIND_REPEAT_DAYS), true);
  });

  it("throttles inside the window and releases at exactly the boundary", () => {
    const twoDays = new Date(TODAY_MS - 2 * 86_400_000).toISOString();
    const threeDays = new Date(TODAY_MS - 3 * 86_400_000).toISOString();
    assert.equal(remindThrottlePassed(twoDays, TODAY_MS, REMIND_REPEAT_DAYS), false);
    assert.equal(remindThrottlePassed(threeDays, TODAY_MS, REMIND_REPEAT_DAYS), true);
  });

  it("fails toward REMINDING on every unknown", () => {
    // The asymmetry that defines this feature. A corrupt timestamp costs one
    // redundant email; treating it as "recently reminded" costs the application.
    assert.equal(remindThrottlePassed("not a date", TODAY_MS, REMIND_REPEAT_DAYS), true);
    assert.equal(remindThrottlePassed(12345, TODAY_MS, REMIND_REPEAT_DAYS), true);
    // A FUTURE timestamp (clock skew, hand-edit) would otherwise suppress
    // reminders until that moment arrived — potentially indefinitely.
    const future = new Date(TODAY_MS + 400 * 86_400_000).toISOString();
    assert.equal(remindThrottlePassed(future, TODAY_MS, REMIND_REPEAT_DAYS), true);
  });
});

describe("selectRenewals", () => {
  const opts = { today: TODAY, nowMs: TODAY_MS, ackUrl: ACK };

  it("returns a row inside its window, with a server-built ack_url", () => {
    // Due 2026-09-10, lead 7 -> 4 days left, in window.
    const row = position({ last_renewed_at: "2026-08-10", reminder_lead_days: 7 });
    const out = selectRenewals([row], opts);
    assert.equal(out.renewals.length, 1);
    assert.equal(out.renewals[0].due_at, "2026-09-10");
    assert.equal(out.renewals[0].days_left, 4);
    assert.equal(out.renewals[0].overdue, false);
    assert.equal(out.renewals[0].interval_months, 1);
    assert.equal(out.renewals[0].ack_url, ACK(TOKEN));
    assert.equal(out.unknown_interval.length, 0);
  });

  it("drops a row that is not yet in its window", () => {
    // Due 2026-10-01, lead 7 -> 25 days left. Nothing to say yet.
    const row = position({ last_renewed_at: "2026-09-01", reminder_lead_days: 7 });
    assert.equal(selectRenewals([row], opts).renewals.length, 0);
  });

  it("keeps an OVERDUE row and marks it, rather than dropping it as past", () => {
    // The single worst possible bug would be a window that closes behind the due
    // date, silently retiring the row that is most urgent.
    const row = position({ last_renewed_at: "2026-06-01" }); // due 2026-07-01
    const out = selectRenewals([row], opts);
    assert.equal(out.renewals.length, 1);
    assert.equal(out.renewals[0].days_left, -67);
    assert.equal(out.renewals[0].overdue, true);
  });

  it("sorts overdue first, then by days_left, with a stable name tiebreak", () => {
    const rows = [
      position({ id: "a", list_name: "Zeta", last_renewed_at: "2026-08-10" }), //  +4
      position({ id: "b", list_name: "Alpha", last_renewed_at: "2026-07-20" }), // -17
      position({ id: "c", list_name: "Beta", last_renewed_at: "2026-08-06" }), //   0
      position({ id: "d", list_name: "Aaa", last_renewed_at: "2026-08-10" }), //   +4, ties with Zeta
    ];
    const out = selectRenewals(rows, opts);
    assert.deepEqual(out.renewals.map((r) => r.list_name), ["Alpha", "Beta", "Aaa", "Zeta"]);
  });

  it("throttles a row reminded less than REMIND_REPEAT_DAYS ago", () => {
    const base = position({ last_renewed_at: "2026-08-10" });
    const recent = { ...base, last_reminded_at: new Date(TODAY_MS - 86_400_000).toISOString() };
    const old = { ...base, last_reminded_at: new Date(TODAY_MS - 4 * 86_400_000).toISOString() };
    assert.equal(selectRenewals([recent], opts).renewals.length, 0);
    assert.equal(selectRenewals([old], opts).renewals.length, 1);
  });

  it("keeps unknown-interval rows in a SEPARATE list with no due date at all", () => {
    // Structural separation, not a flag: these items have no `due_at` and no
    // `days_left` field, so a template physically cannot render one as though it
    // were due on a date. Merging the lists would work right up until the first
    // template that forgot to check the flag.
    const row = position({ list_name: "KAB ventelistenummer", renewal_interval_months: null });
    const out = selectRenewals([row], opts);
    assert.equal(out.renewals.length, 0);
    assert.equal(out.unknown_interval.length, 1);
    assert.equal(out.unknown_interval[0].list_name, "KAB ventelistenummer");
    assert.equal(out.unknown_interval[0].ack_url, ACK(TOKEN));
    assert.equal("due_at" in out.unknown_interval[0], false);
    assert.equal("days_left" in out.unknown_interval[0], false);
  });

  it("nudges an unknown-interval row quarterly, not every three days", () => {
    const row = position({ renewal_interval_months: null });
    const d = (n: number) => new Date(TODAY_MS - n * 86_400_000).toISOString();
    assert.equal(
      selectRenewals([{ ...row, last_reminded_at: d(10) }], opts).unknown_interval.length,
      0,
    );
    assert.equal(
      selectRenewals([{ ...row, last_reminded_at: d(UNKNOWN_INTERVAL_REPEAT_DAYS) }], opts)
        .unknown_interval.length,
      1,
    );
  });

  it("NEVER treats an unknown interval as 'never expires'", () => {
    // The load-bearing assertion of the whole feature. A NULL interval must
    // produce CONTACT, on some cadence — silence is the failure mode that costs
    // the seniority, and it is the one that looks like everything is fine.
    const out = selectRenewals([position({ renewal_interval_months: null })], opts);
    assert.equal(out.renewals.length + out.unknown_interval.length, 1);
  });

  it("drops a row he has not signed up for, in both branches", () => {
    const blank = { signed_up_at: null, last_renewed_at: null };
    assert.deepEqual(selectRenewals([position(blank)], opts), {
      renewals: [],
      unknown_interval: [],
    });
    assert.deepEqual(
      selectRenewals([position({ ...blank, renewal_interval_months: null })], opts),
      { renewals: [], unknown_interval: [] },
    );
  });

  it("skips a row with no ack_token rather than emitting a dead-end reminder", () => {
    const out = selectRenewals([position({ ack_token: null })], opts);
    assert.equal(out.renewals.length, 0);
  });

  it("honours the limit and clamps it to MAX_RENEWALS", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      position({ id: `r${i}`, list_name: `L${i}`, last_renewed_at: "2026-08-10" }));
    assert.equal(selectRenewals(rows, { ...opts, limit: 3 }).renewals.length, 3);
    assert.equal(selectRenewals(rows, { ...opts, limit: 9999 }).renewals.length, 8);
    assert.equal(selectRenewals(rows, opts).renewals.length, 8);
    assert.equal(MAX_RENEWALS >= 8, true);
  });

  it("returns empty lists rather than throwing when nothing is due", () => {
    assert.deepEqual(selectRenewals([], opts), { renewals: [], unknown_interval: [] });
  });

  it("reproduces the real KKIK monthly cycle end to end", () => {
    // Renewed Aug 31 on a monthly list -> due Sep 30 (September has 30 days, so
    // no clamp), lead 7 -> not in window on Sep 6, in window on Sep 23.
    const row = position({ last_renewed_at: "2026-08-31", reminder_lead_days: 7 });
    assert.equal(selectRenewals([row], opts).renewals.length, 0);
    const later = selectRenewals([row], {
      ...opts,
      today: { y: 2026, m: 9, d: 23 },
      nowMs: Date.UTC(2026, 8, 23, 10),
    });
    assert.equal(later.renewals.length, 1);
    assert.equal(later.renewals[0].due_at, "2026-09-30");
    assert.equal(later.renewals[0].days_left, 7);
  });

  it("gives an annual findbolig-style row a long lead", () => {
    // 12-month interval, 30-day lead: the post-reminder grace period for the
    // ajourføringsgebyr is no longer defined in law, so the margin has to be ours.
    const row = position({
      list_name: "findbolig.nu",
      renewal_interval_months: 12,
      reminder_lead_days: 30,
      last_renewed_at: "2025-09-20",
    });
    const out = selectRenewals([row], opts);
    assert.equal(out.renewals.length, 1);
    assert.equal(out.renewals[0].due_at, "2026-09-20");
    assert.equal(out.renewals[0].days_left, 14);
  });
});

describe("buildAckUrl", () => {
  it("builds the confirm link server-side, tolerating a trailing slash", () => {
    assert.equal(
      buildAckUrl("https://x.supabase.co", TOKEN),
      `https://x.supabase.co/functions/v1/housing-renew?token=${TOKEN}`,
    );
    assert.equal(
      buildAckUrl("https://x.supabase.co/", TOKEN),
      `https://x.supabase.co/functions/v1/housing-renew?token=${TOKEN}`,
    );
  });
});

describe("parseRenewalResult", () => {
  const base = {
    user_id: UID,
    position_id: "aaaaaaaa-1111-4111-8111-111111111111",
    ok: true,
  };

  it("accepts a well-formed report", () => {
    const p = parseRenewalResult({ ...base, message_id: "<abc@mail>" });
    assert.equal(p.ok, true);
    if (p.ok) assert.equal(p.result.messageId, "<abc@mail>");
  });

  it("refuses an ambiguous `ok`", () => {
    // Sharper here than for notify: a truthy coercion of a broken n8n expression
    // stamps last_reminded_at for an email that never left, and the guard goes
    // quiet for three days on a list that may have four days to live.
    for (const bad of ["", 0, 1, null, undefined, "yes"]) {
      assert.equal(parseRenewalResult({ ...base, ok: bad }).ok, false);
    }
  });

  it("refuses ids that are not uuids", () => {
    assert.equal(parseRenewalResult({ ...base, position_id: "42" }).ok, false);
    assert.equal(parseRenewalResult({ ...base, user_id: "default" }).ok, false);
    assert.equal(parseRenewalResult({ user_id: UID, ok: true }).ok, false);
  });
});

// ===========================================================================
// The postal gate
// ===========================================================================
//
// Added after the live harvest disproved a precondition of the radius gate: the
// Lane B portals publish NO coordinates, so `distance_km` is null for
// essentially every listing, the radius check records `distance_unknown`, and —
// by the gate's own correct rule that an unknown is inconclusive and
// inconclusive passes — a Hillerød flat (3400) and Aarhus listings (8200)
// reached the notify queue filtered by nothing but rent.
//
// So these cases pull in two directions at once, and both must hold:
//   * a KNOWN out-of-area postcode is a hard drop (the whole point);
//   * an UNKNOWN postcode still passes, flagged (the house rule — a parser
//     regression must not read as a quiet week).

describe("parsePostalEntries", () => {
  it("parses a single code as a degenerate range", () => {
    assert.deepEqual(parsePostalEntries(["2200"]), [{ lo: 2200, hi: 2200 }]);
  });

  it("parses an inclusive range", () => {
    assert.deepEqual(parsePostalEntries(["1300-1799"]), [{ lo: 1300, hi: 1799 }]);
  });

  it("normalizes a reversed range rather than dropping it", () => {
    // The asymmetry runs opposite to the renewal guard's: a DROPPED entry narrows
    // the allow-list, which becomes extra hard drops, and in a race lane a missed
    // listing is the loss. So be forgiving here.
    assert.deepEqual(parsePostalEntries(["2200-1300"]), [{ lo: 1300, hi: 2200 }]);
  });

  it("ignores malformed entries without crashing", () => {
    const out = parsePostalEntries([
      "2200",
      "22 00",
      "220",
      "22000",
      "2200–2400", // en dash, not a hyphen
      "København N",
      "",
      "   ",
      "1300-",
      "-1799",
      "1300-179",
      null,
      42,
      undefined,
      {},
      ["2200"],
    ]);
    assert.deepEqual(out, [{ lo: 2200, hi: 2200 }]);
  });

  it("tolerates surrounding whitespace", () => {
    assert.deepEqual(parsePostalEntries([" 2200 ", "\t1300-1799\n"]), [
      { lo: 2200, hi: 2200 },
      { lo: 1300, hi: 1799 },
    ]);
  });

  it("yields nothing for a non-array, including a column read before the migration", () => {
    assert.deepEqual(parsePostalEntries(undefined), []);
    assert.deepEqual(parsePostalEntries(null), []);
    assert.deepEqual(parsePostalEntries("2200"), []);
    assert.deepEqual(parsePostalEntries({}), []);
  });
});

describe("postalAllowed", () => {
  it("is inclusive at both bounds", () => {
    const r = [{ lo: 1300, hi: 1799 }];
    assert.equal(postalAllowed(1300, r), true);
    assert.equal(postalAllowed(1799, r), true);
    assert.equal(postalAllowed(1299, r), false);
    assert.equal(postalAllowed(1800, r), false);
  });

  it("matches any range in the list", () => {
    const r = parsePostalEntries(["2100", "2200", "1300-1799"]);
    assert.equal(postalAllowed(2100, r), true);
    assert.equal(postalAllowed(1500, r), true);
    assert.equal(postalAllowed(2400, r), false);
  });
});

describe("postalVerdict", () => {
  const CPH = ["2100", "2200", "2400", "1300-1899", "2000"];

  it("is no_gate when the list is empty — every absent gate input means this", () => {
    assert.equal(postalVerdict("3400", []), "no_gate");
    assert.equal(postalVerdict("3400", undefined), "no_gate");
    // Whitespace-only entries are not a configuration either.
    assert.equal(postalVerdict("3400", ["", "  "]), "no_gate");
  });

  it("allows a postcode inside the list, by exact match and by range", () => {
    assert.equal(postalVerdict("2200", CPH), "allowed");
    assert.equal(postalVerdict("1500", CPH), "allowed"); // inside 1300-1899
    assert.equal(postalVerdict("1300", CPH), "allowed"); // lower bound
    assert.equal(postalVerdict("1899", CPH), "allowed"); // upper bound
  });

  it("HARD DROPS the exact listings that motivated this gate", () => {
    // These reached the notify queue in the live harvest.
    assert.equal(postalVerdict("3400", CPH), "blocked"); // Hillerød
    assert.equal(postalVerdict("8200", CPH), "blocked"); // Aarhus N
    assert.equal(postalVerdict("2300", CPH), "blocked"); // Amager — near, still out
    assert.equal(postalVerdict("1050", CPH), "blocked"); // K, below the range
  });

  it("passes an UNREADABLE postcode as inconclusive, never as a drop", () => {
    // Same rule as rent_unknown and distance_unknown. A parser regression that
    // starts returning null must surface as a flagged listing a human still sees,
    // not as a silently emptier queue.
    assert.equal(postalVerdict(null, CPH), "zip_unknown");
    assert.equal(postalVerdict("", CPH), "zip_unknown");
    assert.equal(postalVerdict("pris efter aftale", CPH), "zip_unknown");
    assert.equal(postalVerdict(undefined, CPH), "zip_unknown");
  });

  it("reports gate_unreadable rather than silently reverting to no gate", () => {
    // A non-empty list none of whose entries parse is a misconfiguration. Reading
    // it as "no gate" would silently restore the Hillerød behaviour; reading it as
    // "nothing allowed" would drop every listing on the strength of a typo. So:
    // pass, with its own distinct flag.
    assert.equal(postalVerdict("3400", ["København N", "22 00"]), "gate_unreadable");
    assert.equal(postalVerdict(null, ["nonsense"]), "gate_unreadable");
  });

  it("still gates when only SOME entries are malformed", () => {
    // A partially-broken list must not become a free pass.
    assert.equal(postalVerdict("3400", ["2200", "København N"]), "blocked");
    assert.equal(postalVerdict("2200", ["2200", "København N"]), "allowed");
  });

  it("reads a postcode embedded in a longer string, as the ingest path does", () => {
    // Routed through the same `parseZipcode`, so the gate and the stored column
    // can never disagree about what counts as a postcode.
    assert.equal(postalVerdict("2200 København N", CPH), "allowed");
    assert.equal(postalVerdict("DK-3400 Hillerød", CPH), "blocked");
  });
});

describe("the postal gate inside gateAgainstCriterion", () => {
  const criterion: CriterionRow = {
    id: "c1",
    enabled: true,
    max_rent: 9000,
    postal_codes: ["2100", "2200", "2400", "1300-1899", "2000"],
  };

  it("drops the Hillerød flat that rent alone let through", () => {
    // The regression this whole gate exists for: cheap, no coordinates, 60 km away.
    const v = gateAgainstCriterion(
      { rent: 6500, zipcode: "3400", lat: null, lng: null },
      criterion,
    );
    assert.equal(v.pass, false);
    assert.ok(v.reasons.includes("postal_mismatch"));
  });

  it("drops the Aarhus listings too", () => {
    const v = gateAgainstCriterion({ rent: 5200, zipcode: "8200" }, criterion);
    assert.equal(v.pass, false);
    assert.ok(v.reasons.includes("postal_mismatch"));
  });

  it("keeps a Nørrebro listing with no coordinates at all", () => {
    // The case the radius gate could never decide, and the reason a coarse gate
    // beats a precise one that has no input.
    const v = gateAgainstCriterion(
      { rent: 6500, zipcode: "2200", lat: null, lng: null },
      criterion,
    );
    assert.equal(v.pass, true);
    assert.equal(v.reasons.includes("postal_mismatch"), false);
  });

  it("passes a zipcode-less listing WITH a flag rather than implying a location", () => {
    const v = gateAgainstCriterion({ rent: 6500, zipcode: null }, criterion);
    assert.equal(v.pass, true);
    assert.ok(v.reasons.includes("zip_unknown"));
  });

  it("is a no-op for a criterion that has not configured it", () => {
    // Additive change: every existing criterion takes the '{}' default and must
    // behave exactly as it did before.
    const v = gateAgainstCriterion({ rent: 6500, zipcode: "3400" }, {
      id: "c1",
      enabled: true,
      max_rent: 9000,
      postal_codes: [],
    });
    assert.equal(v.pass, true);
    assert.equal(v.reasons.length, 0);
  });

  it("surfaces a misconfigured list without dropping anything", () => {
    const v = gateAgainstCriterion({ rent: 6500, zipcode: "3400" }, {
      id: "c1",
      enabled: true,
      postal_codes: ["Storkøbenhavn"],
    });
    assert.equal(v.pass, true);
    assert.ok(v.reasons.includes("postal_gate_unreadable"));
  });

  it("combines with the radius gate rather than replacing it", () => {
    // A listing that DOES carry coordinates still gets both. Postcode is coarse;
    // 400 m from campus and 3 km from campus are the same postcode.
    const withRadius: CriterionRow = {
      ...criterion,
      center_lat: CAMPUS.lat,
      center_lng: CAMPUS.lng,
      radius_km: 1,
    };
    const near = gateAgainstCriterion(
      { rent: 6500, zipcode: "2200", lat: 55.6995, lng: 12.5555 },
      withRadius,
    );
    assert.equal(near.pass, true);
    // Same postcode, but outside the 1 km radius: the fine gate still decides.
    const far = gateAgainstCriterion(
      { rent: 6500, zipcode: "2200", lat: 55.6870, lng: 12.5300 },
      withRadius,
    );
    assert.equal(far.pass, false);
    assert.ok(far.reasons.includes("outside_radius"));
  });
});

describe("the postal gate through selectNotifyCandidates", () => {
  const criteria: CriterionRow[] = [{
    id: "c1",
    enabled: true,
    max_rent: 9000,
    postal_codes: ["2100", "2200", "2400", "1300-1899", "2000"],
  }];

  const listing = (over: Partial<NotifyListingRow>): NotifyListingRow => ({
    id: "11111111-2222-4333-8444-555555555555",
    title: "Room",
    url: "https://lejebolig.dk/1",
    address: null,
    zipcode: null,
    rent: 6500,
    rooms: null,
    sqm: null,
    lat: null,
    lng: null,
    housing_type: null,
    available_from: null,
    posted_at: null,
    first_seen_at: "2026-09-01T00:00:00Z",
    source_kind: "lejebolig_jsonld",
    ...over,
  });

  it("removes the out-of-area rows from the live queue and keeps the local ones", () => {
    const out = selectNotifyCandidates(
      [
        listing({ id: "aaaaaaaa-2222-4333-8444-555555555555", zipcode: "3400" }),
        listing({ id: "bbbbbbbb-2222-4333-8444-555555555555", zipcode: "2200" }),
        listing({ id: "cccccccc-2222-4333-8444-555555555555", zipcode: "8200" }),
        listing({ id: "dddddddd-2222-4333-8444-555555555555", zipcode: "1500" }),
      ],
      criteria,
      { limit: 10 },
    );
    assert.deepEqual(out.map((r) => r.zipcode), ["2200", "1500"]);
  });

  it("keeps a zipcode-less listing in the queue, carrying the flag", () => {
    const out = selectNotifyCandidates([listing({ zipcode: null })], criteria, { limit: 10 });
    assert.equal(out.length, 1);
    assert.ok(out[0].flags.includes("zip_unknown"));
  });
});
