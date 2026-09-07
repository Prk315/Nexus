/**
 * housing-ingest — pure normalization, geography and gating.
 *
 * Kept out of `index.ts` so it is testable without a Supabase client, exactly as
 * `n8n-ingest/logic.ts` and `job-ingest/logic.ts` are.
 *
 * # Why this imports from a sibling function
 *
 * The secret comparison, the control-character strip and the timestamp coercion
 * are security-shaped code that must behave identically in every ingest path. A
 * second copy of a constant-time compare is how one of them quietly stops being
 * constant-time. Supabase's bundler follows the import graph, so a deploy of
 * `housing-ingest` carries these along.
 */

import {
  coerceTimestamp,
  sanitizeText,
  secretIsUsable,
  secretMatches,
} from "../n8n-ingest/logic.ts";

export { coerceTimestamp, sanitizeText, secretIsUsable, secretMatches };

// MARK: - Limits

/**
 * Listings per request. Lower than mail's 500 and the same as jobs' 200: a
 * boligzonen sitemap diff after a quiet night can carry hundreds of new slugs,
 * and the cap is what stops one fat batch stalling the pipeline permanently.
 */
export const MAX_LISTINGS = 200;
/** Buildings per request. The whole Nørre Campus CIU catalogue is ~38 rows. */
export const MAX_BUILDINGS = 200;

export const MAX_URL = 2048;
export const MAX_EXTERNAL_ID = 256;
export const MAX_DEDUPE_KEY = 512;
export const MAX_TITLE = 512;
export const MAX_NAME = 256;
export const MAX_ADDRESS = 512;
export const MAX_ZIPCODE = 16;
export const MAX_DESCRIPTION = 20_000;
export const MAX_HOUSING_TYPE = 32;
export const MAX_MESSAGE_ID = 256;
export const MAX_RAW_JSON_CHARS = 20_000;

/**
 * `housing_sources.kind`, split by lane because the two batch actions accept
 * different halves of it and mixing them is a real mistake rather than a
 * theoretical one: `sdk_api` yields buildings that have no `posted_at` and never
 * vanish, and letting one arrive down the listings path would file a permanent
 * dorm as a listing that expires in hours.
 *
 * The three portals absent here — boligportal, akutbolig, findbolig — are absent
 * on purpose: each forbids automated collection or robots-disallows its whole
 * search surface, and reaches us as `mail_alert` instead (HOUSING_PLAN.md §5).
 */
export const LISTING_SOURCE_KINDS = [
  "lejebolig_jsonld",
  "boligzonen_sitemap",
  "mail_alert",
  "manual",
] as const;
export const BUILDING_SOURCE_KINDS = ["sdk_api", "manual"] as const;
export const SOURCE_KINDS = [
  "sdk_api",
  "lejebolig_jsonld",
  "boligzonen_sitemap",
  "mail_alert",
  "manual",
] as const;

/** `housing_criteria.types` and `housing_listings.housing_type` share a domain. */
export const HOUSING_TYPES = ["kollegie", "studio", "apartment", "room"] as const;

export const LISTING_STATUSES = [
  "discovered",
  "notified",
  "dismissed",
  "contacted",
  "dead",
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

// MARK: - URL

/**
 * Accept only http(s), and drop tracking noise so the same flat fetched twice
 * from two entry points does not produce two rows.
 *
 * The Danish-portal-specific entries matter as much as the generic ones:
 * boligzonen decorates every link out of its search result with `?sort=`/`?page=`
 * and the BoligAgent emails route through `?utm_campaign=boligagent`, so an
 * un-stripped URL varies by discovery path for what is one flat.
 */
const STRIP_PARAMS = [
  /^utm_/i,
  /^gclid$/i,
  /^fbclid$/i,
  /^ref$/i,
  /^source$/i,
  /^sort$/i,
  /^page$/i,
  /^offset$/i,
];

export function canonicalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  for (const key of [...u.searchParams.keys()]) {
    if (STRIP_PARAMS.some((re) => re.test(key))) u.searchParams.delete(key);
  }
  u.hash = "";
  return u.toString();
}

// MARK: - Small coercions

/**
 * A whole number, or `null`.
 *
 * Accepts a numeric string because JSON-LD quotes prices (`"offers": {"price":
 * "7.995"}`) and because an HTML extractor hands over whatever it scraped. But
 * everything unparseable is `null`, **never 0** — see the `rent` comment in the
 * migration. A price-less ad stored as 0 kr is the cheapest thing in the
 * database and passes every budget gate as a bargain.
 */
export function parseIntOrNull(v: unknown, opts: { min?: number; max?: number } = {}):
  | number
  | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim().length > 0) n = Number(v.trim());
  else return null;
  if (!Number.isFinite(n)) return null;
  n = Math.round(n);
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

/** As `parseIntOrNull`, but keeps the fraction — `rooms` is genuinely 1.5. */
export function parseNumberOrNull(v: unknown, opts: { min?: number; max?: number } = {}):
  | number
  | null {
  let n: number;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim().length > 0) n = Number(v.trim());
  else return null;
  if (!Number.isFinite(n)) return null;
  if (opts.min !== undefined && n < opts.min) return null;
  if (opts.max !== undefined && n > opts.max) return null;
  return n;
}

/** A latitude/longitude pair, or `[null, null]`. Half a coordinate is not half an answer. */
export function parseLatLng(rawLat: unknown, rawLng: unknown): [number | null, number | null] {
  const lat = parseNumberOrNull(rawLat, { min: -90, max: 90 });
  const lng = parseNumberOrNull(rawLng, { min: -180, max: 180 });
  if (lat === null || lng === null) return [null, null];
  // (0, 0) is in the Gulf of Guinea and is what a zeroed struct looks like. In a
  // Copenhagen-only pipeline it is a bug marker, and letting it through would put
  // every such row 5 000 km from campus rather than at an unknown distance —
  // which the radius gate would silently read as a decisive "no".
  if (lat === 0 && lng === 0) return [null, null];
  return [lat, lng];
}

/**
 * A calendar date as `YYYY-MM-DD`, or `null`.
 *
 * Routed through `coerceTimestamp` so every spelling the rest of the pipeline
 * accepts is accepted here too, then truncated to the date. `available_from` is
 * a `date` column: keeping a time on it would make "ledig fra 1. oktober" depend
 * on which side of midnight the harvester ran.
 */
export function coerceDate(value: unknown): string | null {
  const ts = coerceTimestamp(value);
  return ts === null ? null : ts.slice(0, 10);
}

/** Serialize-and-measure, so an oversized `raw` stores NULL instead of failing a batch. */
export function boundedJson(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return null; // cycles, BigInt — store nothing rather than fail the batch
  }
  return serialized.length > MAX_RAW_JSON_CHARS ? null : value;
}

/** Four Danish digits, or `null`. Anything else is not a postcode. */
export function parseZipcode(v: unknown): string | null {
  const s = sanitizeText(v, MAX_ZIPCODE);
  if (!s) return null;
  const m = s.match(/\b(\d{4})\b/);
  return m ? m[1] : null;
}

/** One of `HOUSING_TYPES`, or `null` for "the portal did not say". */
export function parseHousingType(v: unknown): string | null {
  const s = sanitizeText(v, MAX_HOUSING_TYPE);
  if (!s) return null;
  const lower = s.toLowerCase();
  return (HOUSING_TYPES as readonly string[]).includes(lower) ? lower : null;
}

// MARK: - Geography

/** Mean Earth radius, km (IUGG). */
const EARTH_RADIUS_KM = 6371.0088;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Great-circle distance in km.
 *
 * Haversine rather than the equirectangular approximation everyone reaches for
 * first: at Copenhagen's latitude the cheap version is off by enough that a
 * 3.0 km radius admits or excludes a whole ring of addresses depending on
 * bearing, and the gate's job is to be the same answer twice.
 *
 * Rounded to metres. An unrounded double lands in a `numeric` column as
 * `2.4180000000000001`, which reads as false precision in a panel and makes two
 * equal distances compare unequal.
 */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  return Math.round(EARTH_RADIUS_KM * c * 1000) / 1000;
}

/** The subset of a criterion row the pure functions read. */
export interface CriterionRow {
  id?: string;
  name?: string | null;
  enabled?: boolean | null;
  max_rent?: number | string | null;
  center_lat?: number | string | null;
  center_lng?: number | string | null;
  radius_km?: number | string | null;
  types?: unknown;
  min_rooms?: number | string | null;
  max_rooms?: number | string | null;
  /** `'NNNN'` / `'NNNN-NNNN'` entries. Empty = no postal gate. See `postalVerdict`. */
  postal_codes?: unknown;
}

// MARK: - The postal gate

/**
 * An inclusive postcode range. A single code parses to `{lo: n, hi: n}`.
 *
 * Both bounds inclusive, and the type deliberately has no "single" variant — a
 * bare `'2200'` is just the degenerate range, so every downstream comparison is
 * one shape and there is no second code path to get wrong.
 */
export interface PostalRange {
  lo: number;
  hi: number;
}

const POSTAL_SINGLE_RE = /^(\d{4})$/;
const POSTAL_RANGE_RE = /^(\d{4})-(\d{4})$/;

/**
 * Parse the allow-list entries. Malformed entries are DROPPED, not thrown on.
 *
 * The grammar, which the migration's comment is the contract for:
 *
 *     'NNNN'        a single postcode      '2200'
 *     'NNNN-NNNN'   an inclusive range     '1300-1799'
 *
 * A reversed range (`'2200-1300'`) is normalized rather than rejected. That
 * asymmetry is deliberate and it runs the opposite way to the renewal guard's:
 * here a dropped entry NARROWS the allow-list, which turns into extra hard
 * drops, and in a race lane a missed listing is the loss. So the forgiving
 * reading is the safe one, and the caller separately notices when NOTHING parsed
 * (see `postalVerdict`) so a wholly broken list cannot silently narrow anything.
 *
 * Non-arrays and non-string elements yield nothing — a column read before the
 * migration lands arrives as `undefined`, and that must behave as "no gate"
 * rather than as an error on the notify path.
 */
export function parsePostalEntries(raw: unknown): PostalRange[] {
  if (!Array.isArray(raw)) return [];
  const out: PostalRange[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const s = entry.trim();
    const single = POSTAL_SINGLE_RE.exec(s);
    if (single) {
      const n = Number(single[1]);
      out.push({ lo: n, hi: n });
      continue;
    }
    const range = POSTAL_RANGE_RE.exec(s);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      out.push(a <= b ? { lo: a, hi: b } : { lo: b, hi: a });
    }
    // Anything else — '22 00', '2200–2400' (en dash), 'København N', '' — is
    // ignored. It cannot be reported from here without giving a pure predicate a
    // side channel; `postalVerdict` reports the case that actually matters.
  }
  return out;
}

/** Is this postcode inside any of the ranges? */
export const postalAllowed = (zip: number, ranges: PostalRange[]): boolean =>
  ranges.some((r) => zip >= r.lo && zip <= r.hi);

/**
 * The five states of the postal gate.
 *
 *   `no_gate`          the list is empty — the column is not in use
 *   `allowed`          a known postcode inside the list
 *   `blocked`          a known postcode outside it — the only HARD drop
 *   `zip_unknown`      no readable postcode — inconclusive, passes flagged
 *   `gate_unreadable`  a non-empty list, none of whose entries parse
 */
export type PostalVerdict =
  | "no_gate"
  | "allowed"
  | "blocked"
  | "zip_unknown"
  | "gate_unreadable";

/**
 * Should this listing's postcode keep it in?
 *
 * ## Why this exists at all, when there is already a radius gate
 *
 * Because the radius gate is INERT on Lane B. The live harvest established that
 * the portals publish no coordinates, so `distance_km` is null for essentially
 * every listing, the radius check records `distance_unknown`, and — by the
 * gate's own correct rule that an unknown is inconclusive and inconclusive
 * passes — a Hillerød flat (3400) and Aarhus listings (8200) reached the notify
 * queue with only rent standing in the way.
 *
 * The fix is not to make an unknown distance fail: that would drop every Lane B
 * listing in the database, in the lane where the entire product is not missing
 * things. It is to gate on data the portals DO publish. Every Danish listing
 * carries a postcode.
 *
 * ## The unknown zipcode still passes, and that is not an oversight
 *
 * `zip_unknown` is inconclusive for exactly the reason `rent_unknown` and
 * `distance_unknown` are: a parser regression that starts returning null for
 * postcode must surface as a flagged listing a human still sees, not as a quiet
 * week. The flag is what stops that being a licence to flood.
 *
 * ## `gate_unreadable` is the case worth being careful about
 *
 * A non-empty list none of whose entries parse is a misconfiguration, and the
 * two obvious readings are both silent and both wrong in opposite directions:
 * treating it as no gate reverts to the Hillerød behaviour, and treating it as
 * "nothing allowed" drops every listing on the strength of a typo. So it passes
 * with its own distinct flag — visible, and impossible to confuse with either
 * "he has not configured this" or "this listing is local".
 */
export function postalVerdict(zipcodeRaw: unknown, postalCodes: unknown): PostalVerdict {
  const configured = Array.isArray(postalCodes) &&
    postalCodes.some((e) => typeof e === "string" && e.trim().length > 0);
  if (!configured) return "no_gate";

  const ranges = parsePostalEntries(postalCodes);
  if (ranges.length === 0) return "gate_unreadable";

  // Routed through the same `parseZipcode` the ingest path uses, so the gate and
  // the stored column can never disagree about what counts as a postcode.
  const zip = parseZipcode(zipcodeRaw);
  if (zip === null) return "zip_unknown";

  return postalAllowed(Number(zip), ranges) ? "allowed" : "blocked";
}

/**
 * Distance to the NEAREST enabled criterion that carries a centre, or `null`.
 *
 * Nearest rather than first: the column is a display number meaning "how far is
 * this from somewhere I want to be", and with two criteria (campus, and a
 * girlfriend's neighbourhood) the smaller of the two is the honest answer.
 *
 * `null` when the target has no coordinates or no criterion has a centre. It is
 * never 0 — a 0 in a distance column reads as "on campus", which is exactly the
 * best possible value and would sort a geolocation failure to the top.
 */
export function nearestCriterionDistanceKm(
  lat: number | null,
  lng: number | null,
  criteria: CriterionRow[],
): number | null {
  if (lat === null || lng === null) return null;
  let best: number | null = null;
  for (const c of criteria) {
    const cLat = parseNumberOrNull(c.center_lat, { min: -90, max: 90 });
    const cLng = parseNumberOrNull(c.center_lng, { min: -180, max: 180 });
    if (cLat === null || cLng === null) continue;
    const d = haversineKm(lat, lng, cLat, cLng);
    if (best === null || d < best) best = d;
  }
  return best;
}

// MARK: - The gate

/** The subset of a listing row the gate reads. */
export interface GateListing {
  id?: string;
  rent?: number | string | null;
  rooms?: number | string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  housing_type?: string | null;
  /** The coarse geographic gate. Present on every portal; coordinates are not. */
  zipcode?: string | null;
}

export interface GateVerdict {
  pass: boolean;
  /** Enabled criteria this listing satisfies, in the order supplied. */
  matched: string[];
  /**
   * Why it failed, or — for a passing listing — which checks could not be
   * decided. A drop ALWAYS carries a reason: an unexplained drop is
   * indistinguishable from a crawler bug, and the gate is the component most
   * likely to be silently over-eager.
   */
  reasons: string[];
  /** Recomputed live from `lat`/`lng`; never read off the stored column. */
  distance_km: number | null;
}

/**
 * Does this listing satisfy this criterion?
 *
 * ## Every unknown is INCONCLUSIVE, and inconclusive passes
 *
 * This is the single rule the whole function is built on, and it is the house
 * rule ("absent is never zero") pointed at a gate rather than at a column. A
 * listing with no rent, no room count, no coordinates and no type is a listing
 * we know nothing about — and in a race lane where the product is not missing
 * things, "we could not tell" must surface for a human rather than be silently
 * dropped. The alternative fails in the direction that never announces itself:
 * a parser regression that starts returning `null` for rent would stop the
 * notifications entirely and look exactly like a quiet week.
 *
 * The flags are what stop that being a licence to flood: an inconclusive check
 * is recorded in `reasons` as `rent_unknown` / `distance_unknown` / … so the
 * decision email can say "we could not read the price" rather than implying one.
 *
 * A value that IS known and fails is a hard, quiet drop — that is the gate doing
 * its job.
 */
export function gateAgainstCriterion(
  listing: GateListing,
  criterion: CriterionRow,
): { pass: boolean; reasons: string[]; distance_km: number | null } {
  const reasons: string[] = [];
  let pass = true;

  // Budget.
  const maxRent = parseIntOrNull(criterion.max_rent, { min: 0 });
  const rent = parseIntOrNull(listing.rent, { min: 0 });
  if (maxRent !== null) {
    if (rent === null) reasons.push("rent_unknown");
    else if (rent > maxRent) {
      pass = false;
      reasons.push("over_max_rent");
    }
  }

  // Postcode — the COARSE geographic gate, and on Lane B the only one that
  // actually decides anything. Runs before distance because it is the check that
  // can conclude: the portals publish no coordinates, so the radius check below
  // is almost always `distance_unknown` and therefore inconclusive.
  //
  // Only `blocked` is a hard drop. `zip_unknown` and `gate_unreadable` are
  // inconclusive passes carrying their own flags — see `postalVerdict`.
  switch (postalVerdict(listing.zipcode, criterion.postal_codes)) {
    case "blocked":
      pass = false;
      reasons.push("postal_mismatch");
      break;
    case "zip_unknown":
      reasons.push("zip_unknown");
      break;
    case "gate_unreadable":
      reasons.push("postal_gate_unreadable");
      break;
    // "no_gate" and "allowed" contribute nothing.
  }

  // Distance. Computed even when the criterion has no radius, because the number
  // is worth reporting either way.
  const [lat, lng] = parseLatLng(listing.lat, listing.lng);
  const cLat = parseNumberOrNull(criterion.center_lat, { min: -90, max: 90 });
  const cLng = parseNumberOrNull(criterion.center_lng, { min: -180, max: 180 });
  let distanceKm: number | null = null;
  if (lat !== null && lng !== null && cLat !== null && cLng !== null) {
    distanceKm = haversineKm(lat, lng, cLat, cLng);
  }
  const radius = parseNumberOrNull(criterion.radius_km, { min: 0 });
  if (radius !== null && radius > 0 && cLat !== null && cLng !== null) {
    if (distanceKm === null) reasons.push("distance_unknown");
    else if (distanceKm > radius) {
      pass = false;
      reasons.push("outside_radius");
    }
  }

  // Type.
  const types = Array.isArray(criterion.types)
    ? criterion.types
      .map((t) => (typeof t === "string" ? t.trim().toLowerCase() : ""))
      .filter((t) => t.length > 0)
    : [];
  if (types.length > 0) {
    const kind = typeof listing.housing_type === "string"
      ? listing.housing_type.trim().toLowerCase()
      : "";
    if (!kind) reasons.push("type_unknown");
    else if (!types.includes(kind)) {
      pass = false;
      reasons.push("type_mismatch");
    }
  }

  // Rooms.
  const minRooms = parseNumberOrNull(criterion.min_rooms, { min: 0 });
  const maxRooms = parseNumberOrNull(criterion.max_rooms, { min: 0 });
  if (minRooms !== null || maxRooms !== null) {
    const rooms = parseNumberOrNull(listing.rooms, { min: 0 });
    if (rooms === null) reasons.push("rooms_unknown");
    else if ((minRooms !== null && rooms < minRooms) || (maxRooms !== null && rooms > maxRooms)) {
      pass = false;
      reasons.push("rooms_out_of_range");
    }
  }

  return { pass, reasons, distance_km: distanceKm };
}

/**
 * Does this listing satisfy ANY enabled criterion?
 *
 * Any, not all. Criteria are alternatives by construction — "a cheap room near
 * campus" OR "a proper flat in Frederiksberg under 7k" — and requiring a listing
 * to satisfy both would make adding a second criterion narrow the search, which
 * is the opposite of what an insert into a modularity surface should do.
 *
 * With NO enabled criteria the verdict is a fail carrying `no_criteria`. That is
 * deliberate and it is the third outing of the same house rule: an empty
 * criteria set is "nothing has been configured", not "everything matches", and a
 * pipeline that emailed about every flat in Copenhagen the moment the panel was
 * cleared would be the loudest possible version of failing open.
 */
export function gateListing(listing: GateListing, criteria: CriterionRow[]): GateVerdict {
  const enabled = criteria.filter((c) => c.enabled !== false);
  if (enabled.length === 0) {
    return { pass: false, matched: [], reasons: ["no_criteria"], distance_km: null };
  }

  const matched: string[] = [];
  // Two separate accumulators, and keeping them separate is the whole subtlety
  // here. A `rent_unknown` raised by a criterion the listing failed on OTHER
  // grounds is noise — carrying it forward would put "we could not read the
  // price" on an email about a listing that matched a criterion with no budget
  // gate at all. So a passing criterion contributes only its own inconclusive
  // flags, and a failing one contributes only to the explanation of a total
  // failure, which is discarded the moment anything matches.
  const passReasons = new Set<string>();
  const failReasons = new Set<string>();
  let distance: number | null = null;

  for (const c of enabled) {
    const v = gateAgainstCriterion(listing, c);
    if (v.distance_km !== null && (distance === null || v.distance_km < distance)) {
      distance = v.distance_km;
    }
    if (v.pass) {
      matched.push(typeof c.id === "string" ? c.id : "");
      for (const r of v.reasons) passReasons.add(r);
    } else {
      for (const r of v.reasons) failReasons.add(r);
    }
  }

  if (matched.length > 0) {
    return {
      pass: true,
      matched: matched.filter(Boolean),
      reasons: [...passReasons],
      distance_km: distance,
    };
  }
  return { pass: false, matched: [], reasons: [...failReasons], distance_km: distance };
}

// MARK: - Rows

/**
 * The listing upsert payload.
 *
 * ⚠️ **`status`, `first_seen_at`, `notified_at` and `notify_message_id` are
 * absent from this type on purpose, and adding one of them back would
 * reintroduce a bug this pipeline was designed around.**
 *
 * PostgREST builds both the INSERT column list and the DO UPDATE SET list from
 * the keys present in the body, so a column that is absent takes its DEFAULT on
 * insert and is left untouched on conflict. Lane B re-harvests the same ad every
 * 15 minutes by construction; a payload carrying `status: "discovered"` would
 * therefore walk every already-notified listing back to un-notified on the next
 * poll, and it would be re-emailed. That is exactly what `job-ingest`'s harvest
 * clobber did to `job_matches` over the Aug 26 → Sep 3 run.
 *
 * The content columns below DO refresh on conflict, which is what a re-harvest
 * is for: a landlord dropping the rent should update the row, not create one.
 */
export interface ListingRow {
  user_id: string;
  source_kind: string;
  source_id: string | null;
  external_id: string;
  url: string;
  title: string;
  address: string | null;
  zipcode: string | null;
  lat: number | null;
  lng: number | null;
  rent: number | null;
  rooms: number | null;
  sqm: number | null;
  deposit: number | null;
  available_from: string | null;
  posted_at: string | null;
  housing_type: string | null;
  description: string | null;
  distance_km: number | null;
  dedupe_key: string;
}

/**
 * The building upsert payload.
 *
 * `last_seen_at` IS present — refreshing it is the whole point of a Lane A sync,
 * and it is what lets the panel say "this dorm was still in the catalogue this
 * morning" rather than inferring presence from a row's mere existence.
 *
 * `first_seen_at` is absent, for the same reason as on a listing: a default that
 * only fires on insert cannot be rewritten by the daily re-sync.
 */
export interface BuildingRow {
  user_id: string;
  source_kind: string;
  external_id: string;
  name: string;
  address: string | null;
  zipcode: string | null;
  lat: number | null;
  lng: number | null;
  rent_min: number | null;
  rent_max: number | null;
  distance_km: number | null;
  short_wait: boolean | null;
  ssl_eligible: boolean | null;
  administrator: unknown;
  raw: unknown;
  last_seen_at: string;
}

export type NormalizeListingResult =
  | { ok: true; listing: ListingRow }
  | { ok: false; error: string; url?: string };

export type NormalizeBuildingResult =
  | { ok: true; building: BuildingRow }
  | { ok: false; error: string; external_id?: string };

/** Three-state. `null` means "we did not ask", which is not `false`. */
export function parseBoolOrNull(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  return null;
}

/**
 * Normalize one incoming listing.
 *
 * Five fields are required and everything else degrades to `null`: `url`,
 * `source_kind`, `external_id`, `title` and `dedupe_key`. The first four are
 * identity; the fifth is the cross-source matching rule and is deliberately NOT
 * recomputed here — see the long comment on the column in the migration.
 *
 * `distance_km` is filled in by the caller (it needs the criteria) and is left
 * null here.
 */
export function normalizeListing(item: unknown, userId: string): NormalizeListingResult {
  if (!item || typeof item !== "object") return { ok: false, error: "not_an_object" };
  const it = item as Record<string, unknown>;

  const url = canonicalizeUrl(it.url);
  if (!url) return { ok: false, error: "invalid_url" };

  const sourceKind = sanitizeText(it.source_kind, 64);
  if (!sourceKind || !(LISTING_SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    return { ok: false, error: "invalid_source_kind", url };
  }

  const externalId = sanitizeText(it.external_id, MAX_EXTERNAL_ID);
  if (!externalId) return { ok: false, error: "missing_external_id", url };

  const title = sanitizeText(it.title, MAX_TITLE);
  if (!title) return { ok: false, error: "missing_title", url };

  const dedupeKey = sanitizeText(it.dedupe_key, MAX_DEDUPE_KEY);
  if (!dedupeKey) return { ok: false, error: "missing_dedupe_key", url };

  const [lat, lng] = parseLatLng(it.lat, it.lng);

  return {
    ok: true,
    listing: {
      user_id: userId,
      source_kind: sourceKind,
      source_id: isUuid(it.source_id) ? it.source_id : null,
      external_id: externalId,
      url,
      title,
      address: sanitizeText(it.address, MAX_ADDRESS),
      zipcode: parseZipcode(it.zipcode),
      lat,
      lng,
      // Upper bounds are unit-error detectors, not opinions about the market: a
      // rent of 7 995 000 is öre, and a `sqm` of 100 000 is square centimetres.
      // Both store null rather than a number that would wreck every sort.
      rent: parseIntOrNull(it.rent, { min: 0, max: 1_000_000 }),
      rooms: parseNumberOrNull(it.rooms, { min: 0, max: 50 }),
      sqm: parseIntOrNull(it.sqm, { min: 0, max: 10_000 }),
      deposit: parseIntOrNull(it.deposit, { min: 0, max: 10_000_000 }),
      available_from: coerceDate(it.available_from),
      posted_at: coerceTimestamp(it.posted_at),
      housing_type: parseHousingType(it.housing_type),
      description: sanitizeText(it.description, MAX_DESCRIPTION, { multiline: true }),
      distance_km: null,
      dedupe_key: dedupeKey,
    },
  };
}

/** Normalize one incoming building. `distance_km` is filled in by the caller. */
export function normalizeBuilding(
  item: unknown,
  userId: string,
  nowIso: string,
): NormalizeBuildingResult {
  if (!item || typeof item !== "object") return { ok: false, error: "not_an_object" };
  const it = item as Record<string, unknown>;

  const sourceKind = sanitizeText(it.source_kind, 64);
  if (!sourceKind || !(BUILDING_SOURCE_KINDS as readonly string[]).includes(sourceKind)) {
    return { ok: false, error: "invalid_source_kind" };
  }

  // mit.s.dk's `pk` is a number in JSON; a numeric external id is normal here in
  // a way it is not for a job board, so coerce rather than reject.
  const rawExternal = typeof it.external_id === "number" && Number.isFinite(it.external_id)
    ? String(it.external_id)
    : it.external_id;
  const externalId = sanitizeText(rawExternal, MAX_EXTERNAL_ID);
  if (!externalId) return { ok: false, error: "missing_external_id" };

  const name = sanitizeText(it.name, MAX_NAME);
  if (!name) return { ok: false, error: "missing_name", external_id: externalId };

  const [lat, lng] = parseLatLng(it.lat, it.lng);

  return {
    ok: true,
    building: {
      user_id: userId,
      source_kind: sourceKind,
      external_id: externalId,
      name,
      address: sanitizeText(it.address, MAX_ADDRESS),
      zipcode: parseZipcode(it.zipcode),
      lat,
      lng,
      rent_min: parseIntOrNull(it.rent_min, { min: 0, max: 1_000_000 }),
      rent_max: parseIntOrNull(it.rent_max, { min: 0, max: 1_000_000 }),
      distance_km: null,
      // Three-state, and it must stay that way: a sync that did not call
      // /short-wait-time/ knows nothing, and a `false` would drop the building
      // off the shortlist on the strength of a fetch that never happened.
      short_wait: parseBoolOrNull(it.short_wait),
      ssl_eligible: parseBoolOrNull(it.ssl_eligible),
      administrator: boundedJson(it.administrator),
      raw: boundedJson(it.raw),
      last_seen_at: nowIso,
    },
  };
}

// MARK: - Batch bodies

export interface ParsedListingBatch {
  ok: boolean;
  error?: string;
  userId?: string;
  listings?: NormalizeListingResult[];
}

export function parseListingBatch(body: unknown): ParsedListingBatch {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;

  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!Array.isArray(b.listings)) return { ok: false, error: "listings_not_an_array" };
  if (b.listings.length > MAX_LISTINGS) return { ok: false, error: "too_many_listings" };

  return {
    ok: true,
    userId: b.user_id,
    listings: b.listings.map((l) => normalizeListing(l, b.user_id as string)),
  };
}

export interface ParsedBuildingBatch {
  ok: boolean;
  error?: string;
  userId?: string;
  buildings?: NormalizeBuildingResult[];
}

export function parseBuildingBatch(body: unknown, nowIso: string): ParsedBuildingBatch {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;

  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!Array.isArray(b.buildings)) return { ok: false, error: "buildings_not_an_array" };
  if (b.buildings.length > MAX_BUILDINGS) return { ok: false, error: "too_many_buildings" };

  return {
    ok: true,
    userId: b.user_id,
    buildings: b.buildings.map((x) => normalizeBuilding(x, b.user_id as string, nowIso)),
  };
}

/**
 * Collapse duplicates inside ONE request.
 *
 * The upsert key is `(user_id, source_kind, external_id)`; Postgres rejects a
 * single statement that touches the same key twice ("ON CONFLICT DO UPDATE
 * command cannot affect row a second time"). A boligzonen sitemap listing one
 * slug twice, or a search page overlapping its own next page, is enough to hit
 * this — so it is deduped here rather than left to fail the whole batch.
 *
 * Last wins, matching `job-ingest`: within one harvest the later item is the
 * more recently fetched one.
 */
export function dedupeWithinBatch<T extends { source_kind: string; external_id: string }>(
  rows: T[],
): T[] {
  const seen = new Map<string, T>();
  for (const r of rows) seen.set(`${r.source_kind} ${r.external_id}`, r);
  return [...seen.values()];
}

// MARK: - notify_pending

export const MAX_NOTIFY = 25;
export const DEFAULT_NOTIFY = 10;
/**
 * How many `discovered` rows are read before the gate runs. The gate is applied
 * in TypeScript (it spans criteria rows and a haversine, neither of which
 * PostgREST can express), so the scan has to be bounded independently of the
 * returned limit. Generous relative to `MAX_NOTIFY` because a scan that is too
 * tight silently starves: the oldest 200 rows could all be over budget, and the
 * matching listing behind them would never be reached.
 */
export const NOTIFY_SCAN = 500;

export function parseNotifyLimit(value: unknown): number {
  const n = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
    ? Number(value)
    : NaN;
  if (!Number.isFinite(n)) return DEFAULT_NOTIFY;
  return Math.min(MAX_NOTIFY, Math.max(1, Math.floor(n)));
}

/** A stored listing, as read for the notify queue. */
export interface NotifyListingRow {
  id: string;
  title: string | null;
  url: string | null;
  address: string | null;
  zipcode: string | null;
  rent: number | string | null;
  rooms: number | string | null;
  sqm: number | string | null;
  lat: number | string | null;
  lng: number | string | null;
  housing_type: string | null;
  available_from: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  source_kind: string | null;
}

export interface NotifyItem {
  listing_id: string;
  title: string | null;
  rent: number | null;
  address: string | null;
  zipcode: string | null;
  rooms: number | null;
  sqm: number | null;
  url: string | null;
  distance_km: number | null;
  housing_type: string | null;
  available_from: string | null;
  posted_at: string | null;
  first_seen_at: string | null;
  source_kind: string | null;
  criteria_ids: string[];
  /** Inconclusive checks. Empty is the healthy case; non-empty must be shown. */
  flags: string[];
}

/**
 * The notify queue: `discovered` listings that pass the gate, oldest first.
 *
 * Order is preserved from the caller's query (`first_seen_at asc`) rather than
 * re-sorted by anything clever. In a race lane the listing that has been waiting
 * longest is also the one closest to being gone, and a score-sorted queue would
 * starve it — the same reasoning as `job-ingest`'s `notify_queue`, which reads
 * `created_at asc` for the same reason.
 *
 * An empty result is `{ok: true, notify: []}`, never an error. Most polls find
 * nothing: at a 15-minute cadence against a tight radius, a *rare* email is the
 * healthy steady state, and a workflow that reported red on "nothing to ask
 * about" would be red all week and therefore read by nobody.
 */
export function selectNotifyCandidates(
  rows: NotifyListingRow[],
  criteria: CriterionRow[],
  opts: { limit: number },
): NotifyItem[] {
  const out: NotifyItem[] = [];
  for (const r of rows) {
    if (out.length >= opts.limit) break;
    const verdict = gateListing(r, criteria);
    if (!verdict.pass) continue;
    out.push({
      listing_id: r.id,
      title: r.title ?? null,
      rent: parseIntOrNull(r.rent, { min: 0 }),
      address: r.address ?? null,
      zipcode: r.zipcode ?? null,
      rooms: parseNumberOrNull(r.rooms, { min: 0 }),
      sqm: parseIntOrNull(r.sqm, { min: 0 }),
      url: r.url ?? null,
      distance_km: verdict.distance_km,
      housing_type: r.housing_type ?? null,
      available_from: r.available_from ?? null,
      posted_at: r.posted_at ?? null,
      first_seen_at: r.first_seen_at ?? null,
      source_kind: r.source_kind ?? null,
      criteria_ids: verdict.matched,
      flags: verdict.reasons,
    });
  }
  return out;
}

// MARK: - notify_result body

export interface NotifyResultInput {
  userId: string;
  listingId: string;
  ok: boolean;
  messageId: string | null;
}

export type NotifyResultParse =
  | { ok: true; result: NotifyResultInput }
  | { ok: false; error: string };

/**
 * `true`/`false` only — no coercion.
 *
 * `"false"`, `0` and `""` are all falsy in JS and all mean "the send failed",
 * but an n8n expression that resolved to nothing also produces `""`. Coercing
 * would turn a broken expression into a *reported failure*, which retries
 * forever, and a truthy coercion would turn it into a reported success, which
 * marks a listing notified that nobody was told about. Refuse the ambiguity.
 */
export function parseStrictBool(value: unknown): boolean | null {
  if (value === true || value === false) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

export function parseNotifyResult(body: unknown): NotifyResultParse {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!isUuid(b.listing_id)) return { ok: false, error: "invalid_listing_id" };
  const ok = parseStrictBool(b.ok);
  if (ok === null) return { ok: false, error: "invalid_ok" };
  return {
    ok: true,
    result: {
      userId: b.user_id,
      listingId: b.listing_id,
      ok,
      messageId: sanitizeText(b.message_id, MAX_MESSAGE_ID),
    },
  };
}

// ===========================================================================
// MARK: - The renewal guard
// ===========================================================================
//
// The one part of this pipeline whose failure is unrecoverable. A missed listing
// is a flat someone else got; a missed RENEWAL is a deleted application and
// three years of seniority that no support ticket restores — KKIK states it
// flatly: "Du kan ikke få en slettet ansøgning tilbage".
//
// Both lists that matter reconfirm **monthly**, not six-monthly as this was
// scoped believing. The verbatim sources and the full derivation rule live in
// `supabase/migrations/20260906150000_housing_renewal_guard.sql`; this file is
// the single implementation of that rule and deliberately the only one.
//
// Every branch below fails toward REMINDING. Unparseable date, unreadable
// throttle, missing interval — each of them produces more contact, never less.
// That is the opposite of the gate above, where an unknown passes with a flag;
// the asymmetry is intentional, because the costs are asymmetric.

/**
 * Days between reminders while a row stays inside its window.
 *
 * The reminder repeats because the row is still un-renewed — that is the entire
 * point of a guard, and it stops the moment he acts (the confirm page clears
 * `last_reminded_at` and pushes `last_renewed_at` forward, which closes the
 * window). Three days is short enough that a monthly list with a 7-day lead gets
 * three attempts before deletion, and long enough not to become filterable noise.
 */
export const REMIND_REPEAT_DAYS = 3;

/**
 * Days between "go and find out what this list's rule is" nudges.
 *
 * Deliberately an order of magnitude slower than `REMIND_REPEAT_DAYS`. It is a
 * standing research task, not a deadline, and putting it on the same cadence as
 * a real due date is how a guard trains its reader to ignore it. Quarterly is
 * often enough that an unverified list cannot sit unexamined for a year.
 */
export const UNKNOWN_INTERVAL_REPEAT_DAYS = 90;

/** The migration's column default, mirrored so a row read without it behaves. */
export const DEFAULT_REMINDER_LEAD_DAYS = 14;

/**
 * Rows returned per `renewal_pending` call. Unbounded is not an option even on a
 * hand-maintained table, and nobody is on 50 waiting lists.
 */
export const MAX_RENEWALS = 50;

/**
 * The timezone the guard's "today" is computed in.
 *
 * It has to be *a* zone, and UTC is the wrong one: at 00:30 CEST it is still
 * yesterday in UTC, so a renewal confirmed just after midnight would be stamped
 * with the previous day and a due date computed at 01:00 would be a day stale.
 * Neither is catastrophic against a monthly cadence, but the direction matters —
 * a "today" that lags loses a day of margin, and margin is the product here.
 *
 * Same reasoning as the `SESSION_LOCAL_TZ` secret on `session-toggle`: a date is
 * a local-calendar fact about a person, not an instant.
 */
export const HOUSING_TZ = "Europe/Copenhagen";

// MARK: - Calendar arithmetic

/** A calendar date with no time and no zone. What a `date` column holds. */
export interface YMD {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

/** Days in a month, Gregorian. Explicit rather than via `Date`, so it is auditable. */
export function daysInMonth(y: number, m: number): number {
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

/**
 * Parse a `YYYY-MM-DD` (or the date half of a timestamp) into a `YMD`.
 *
 * Rejects impossible dates rather than letting `Date` roll them over: `Date`
 * turns `2026-02-30` into March 2nd silently, and a due date computed from a
 * silently-shifted start is wrong in the direction that never announces itself.
 */
export function parseYmd(value: unknown): YMD | null {
  if (typeof value !== "string") return null;
  const m = DATE_RE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > daysInMonth(y, mo)) return null;
  return { y, m: mo, d };
}

export const formatYmd = (v: YMD): string =>
  `${String(v.y).padStart(4, "0")}-${String(v.m).padStart(2, "0")}-${String(v.d).padStart(2, "0")}`;

/**
 * Add whole calendar months, **clamping at month end exactly as Postgres does**.
 *
 * `date '2026-01-31' + interval '1 month'` is `2026-02-28`. This must reproduce
 * that, and `logic.test.ts` pins it, because the two implementations of the
 * derivation rule that could exist — this one and a human reading the SQL in the
 * migration — have to agree about the case a person signs up on the 31st.
 *
 * The naive `new Date(y, m + 1, d)` gets it wrong in the dangerous direction:
 * Jan 31 becomes **March 3rd**, which on a monthly list is a reminder three days
 * after the application was deleted.
 */
export function addMonthsUtc(date: YMD, months: number): YMD {
  const total = date.y * 12 + (date.m - 1) + months;
  const y = Math.floor(total / 12);
  // `%` keeps the sign of the dividend in JS; months are never negative in this
  // pipeline, but a guard that quietly produced month 0 would be worse than one
  // that is simply correct for both signs.
  const m = ((total % 12) + 12) % 12 + 1;
  return { y, m, d: Math.min(date.d, daysInMonth(y, m)) };
}

/**
 * `b - a`, in whole days.
 *
 * Via `Date.UTC` on purpose: UTC has no DST, so the difference of two midnights
 * is always an exact multiple of 86 400 000 and the division never lands on
 * 23.958. A local-time implementation is off by one across the two Sundays a
 * year that Denmark changes clocks, which is a bug that appears twice and is
 * blamed on something else both times.
 */
export function daysBetween(a: YMD, b: YMD): number {
  const ms = Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d);
  return Math.round(ms / 86_400_000);
}

/**
 * Today, as a calendar date in `HOUSING_TZ`.
 *
 * `formatToParts` rather than trusting an `en-CA` format string to come back in
 * ISO order — the locale's ordering is a convention, not a guarantee, and a
 * silently reordered date would be off by months rather than days.
 */
export function todayInTz(nowMs: number, tz: string = HOUSING_TZ): YMD {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? NaN);
  const y = get("year");
  const m = get("month");
  const d = get("day");
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    // Unreachable with a real ICU build. If it ever happened, UTC is a far
    // better answer than throwing on the one path that protects his seniority.
    const utc = new Date(nowMs);
    return { y: utc.getUTCFullYear(), m: utc.getUTCMonth() + 1, d: utc.getUTCDate() };
  }
  return { y, m, d };
}

// MARK: - The rule

/** The subset of a waiting-list row the renewal guard reads. */
export interface RenewalPositionRow {
  id: string;
  list_name: string | null;
  signed_up_at: string | null;
  last_renewed_at: string | null;
  renewal_interval_months: number | string | null;
  reminder_lead_days: number | string | null;
  renewal_url: string | null;
  last_reminded_at: string | null;
  ack_token: string | null;
  position: number | string | null;
  notes: string | null;
}

/**
 * The date this row's renewal falls due, or `null` when it has none.
 *
 * `null` has exactly two causes and they are different facts:
 *
 *   - **no interval** — the rule is not known, so no due date can honestly be
 *     computed. These rows leave through `unknown_interval`, never through the
 *     due list. Inventing a date here would be folklore with a deadline on it.
 *   - **no start** — neither `last_renewed_at` nor `signed_up_at` is set, so he
 *     is not on the list yet. There is no seniority to protect and a reminder to
 *     renew something he never joined is what teaches a person to ignore this
 *     channel.
 *
 * The anchor is `coalesce(last_renewed_at, signed_up_at)` — the clock restarts
 * from the last acknowledgement. Never `now()`: a due date derived from the
 * current time can never arrive.
 */
export function renewalDueDate(row: RenewalPositionRow): YMD | null {
  const months = parseIntOrNull(row.renewal_interval_months, { min: 1 });
  if (months === null) return null;
  const anchor = parseYmd(row.last_renewed_at) ?? parseYmd(row.signed_up_at);
  if (anchor === null) return null;
  return addMonthsUtc(anchor, months);
}

/** `due_at - today`, in days. NEGATIVE means overdue. `null` when there is no due date. */
export function renewalDaysLeft(row: RenewalPositionRow, today: YMD): number | null {
  const due = renewalDueDate(row);
  return due === null ? null : daysBetween(today, due);
}

/**
 * How early this row's window opens. Falls back to the column default when the
 * value is missing or unreadable, never to 0 — a 0 lead means "tell him on the
 * day it expires", which for a list that deletes on the day is too late by the
 * width of one cron tick.
 */
export function leadDaysFor(row: RenewalPositionRow): number {
  const lead = parseIntOrNull(row.reminder_lead_days, { min: 0, max: 3650 });
  return lead === null ? DEFAULT_REMINDER_LEAD_DAYS : lead;
}

/** In the reminder window, or already past due. */
export const inRenewalWindow = (daysLeft: number, leadDays: number): boolean =>
  daysLeft <= leadDays;

/**
 * Has enough time passed since the last reminder to send another?
 *
 * Every unknown answers YES:
 *
 *   - `null` — never reminded. Obviously due.
 *   - unparseable — a corrupt timestamp must not silence the guard. This is the
 *     one place where "fail toward doing the thing" means sending a possibly
 *     redundant email, and a redundant email costs nothing measured against a
 *     deleted application.
 *   - **in the future** — a clock skew or a hand-edit would otherwise suppress
 *     reminders until that future moment arrives, which could be indefinitely.
 *     A negative elapsed time is treated as "no usable evidence", not as "very
 *     recently reminded".
 */
export function remindThrottlePassed(
  lastRemindedAt: unknown,
  nowMs: number,
  repeatDays: number,
): boolean {
  if (typeof lastRemindedAt !== "string" || lastRemindedAt.trim().length === 0) return true;
  const t = Date.parse(lastRemindedAt);
  if (!Number.isFinite(t)) return true;
  const elapsedMs = nowMs - t;
  if (elapsedMs < 0) return true;
  return elapsedMs >= repeatDays * 86_400_000;
}

/** One row that needs renewing, as handed to n8n. */
export interface RenewalItem {
  position_id: string;
  list_name: string | null;
  /** `YYYY-MM-DD`. Always present on this list — a row without one cannot be here. */
  due_at: string;
  /** NEGATIVE means overdue. */
  days_left: number;
  renewal_url: string | null;
  ack_url: string;
  interval_months: number;
  position: number | null;
  notes: string | null;
  /** Echoed back so the email can state what the guard believes, and be contradicted. */
  last_renewed_at: string | null;
  signed_up_at: string | null;
  reminder_lead_days: number;
  /** True when `days_left < 0`. Precomputed so the email template cannot get the sign wrong. */
  overdue: boolean;
}

/**
 * A row whose renewal rule is not known. A research task, not a deadline.
 *
 * Kept in its own list and given its own shape — deliberately with **no
 * `due_at` and no `days_left`** — so it is structurally impossible for a
 * template to render one of these as though it were due on a date. Merging the
 * two lists and flagging the difference would work right up until the first
 * template that forgot to check the flag.
 */
export interface UnknownIntervalItem {
  position_id: string;
  list_name: string | null;
  signed_up_at: string | null;
  renewal_url: string | null;
  ack_url: string;
  position: number | null;
  notes: string | null;
}

export interface RenewalSelection {
  renewals: RenewalItem[];
  unknown_interval: UnknownIntervalItem[];
}

/**
 * Split the waiting-list rows into "renew this by X" and "find out what the rule
 * is", applying the window and the repeat throttle.
 *
 * ## The four outcomes, and why each row lands where it does
 *
 * | row | -> |
 * |---|---|
 * | interval known, in window or overdue, throttle passed | `renewals` |
 * | interval known, in window, reminded < 3 days ago | dropped (throttled) |
 * | interval known, not yet in window | dropped (nothing to say) |
 * | interval NULL, signed up, throttle passed (90d) | `unknown_interval` |
 * | interval NULL, never signed up | dropped — not on the list yet |
 * | no start date at all | dropped — see `renewalDueDate` |
 *
 * ## Ordering is `days_left` ascending, and overdue therefore sorts FIRST
 *
 * Negative sorts before positive, so the row that is already past its deadline
 * is the first thing in the email. That is the opposite of the notify queue's
 * arrival-order rule and it is right for the opposite reason: in a race lane
 * every listing is equally live, whereas here the rows are strictly ranked by
 * how close they are to being irrecoverable.
 *
 * A stable tiebreak on `list_name` keeps two rows due the same day in a fixed
 * order — an email whose contents shuffle between sends reads as new information
 * when it is not.
 */
export function selectRenewals(
  rows: RenewalPositionRow[],
  opts: { today: YMD; nowMs: number; ackUrl: (token: string) => string; limit?: number },
): RenewalSelection {
  const limit = Math.max(1, Math.min(MAX_RENEWALS, opts.limit ?? MAX_RENEWALS));
  const renewals: RenewalItem[] = [];
  const unknown: UnknownIntervalItem[] = [];

  for (const row of rows) {
    // No token means no acknowledgement is possible, so a reminder would be a
    // dead end. The column is NOT NULL, so this only fires on a partial select —
    // which is a bug in the caller, and is logged there rather than papered over.
    if (typeof row.ack_token !== "string" || row.ack_token.length === 0) continue;

    const months = parseIntOrNull(row.renewal_interval_months, { min: 1 });
    const started = parseYmd(row.last_renewed_at) ?? parseYmd(row.signed_up_at);

    // Not on the list yet. Not the "absent" trap: the absence of a start date is
    // a positive, checkable fact about not having started.
    if (started === null) continue;

    if (months === null) {
      if (!remindThrottlePassed(row.last_reminded_at, opts.nowMs, UNKNOWN_INTERVAL_REPEAT_DAYS)) {
        continue;
      }
      unknown.push({
        position_id: row.id,
        list_name: row.list_name ?? null,
        signed_up_at: row.signed_up_at ?? null,
        renewal_url: row.renewal_url ?? null,
        ack_url: opts.ackUrl(row.ack_token),
        position: parseIntOrNull(row.position),
        notes: row.notes ?? null,
      });
      continue;
    }

    const due = addMonthsUtc(started, months);
    const daysLeft = daysBetween(opts.today, due);
    const lead = leadDaysFor(row);
    if (!inRenewalWindow(daysLeft, lead)) continue;
    if (!remindThrottlePassed(row.last_reminded_at, opts.nowMs, REMIND_REPEAT_DAYS)) continue;

    renewals.push({
      position_id: row.id,
      list_name: row.list_name ?? null,
      due_at: formatYmd(due),
      days_left: daysLeft,
      renewal_url: row.renewal_url ?? null,
      ack_url: opts.ackUrl(row.ack_token),
      interval_months: months,
      position: parseIntOrNull(row.position),
      notes: row.notes ?? null,
      last_renewed_at: row.last_renewed_at ?? null,
      signed_up_at: row.signed_up_at ?? null,
      reminder_lead_days: lead,
      overdue: daysLeft < 0,
    });
  }

  renewals.sort((a, b) =>
    a.days_left - b.days_left || (a.list_name ?? "").localeCompare(b.list_name ?? "")
  );
  unknown.sort((a, b) => (a.list_name ?? "").localeCompare(b.list_name ?? ""));

  return { renewals: renewals.slice(0, limit), unknown_interval: unknown.slice(0, limit) };
}

// MARK: - renewal_result body

export interface RenewalResultInput {
  userId: string;
  positionId: string;
  ok: boolean;
  messageId: string | null;
}

export type RenewalResultParse =
  | { ok: true; result: RenewalResultInput }
  | { ok: false; error: string };

/**
 * Parse a `renewal_result` body. Identical in shape to `parseNotifyResult`, and
 * identical in its refusal to coerce `ok` — see `parseStrictBool`. Here the
 * asymmetry is sharper still: a truthy coercion of a broken n8n expression would
 * stamp `last_reminded_at` for an email that never left, and the guard would go
 * quiet for three days on a list that may have four days to live.
 */
export function parseRenewalResult(body: unknown): RenewalResultParse {
  if (!body || typeof body !== "object") return { ok: false, error: "invalid_body" };
  const b = body as Record<string, unknown>;
  if (!isUuid(b.user_id)) return { ok: false, error: "invalid_user_id" };
  if (!isUuid(b.position_id)) return { ok: false, error: "invalid_position_id" };
  const ok = parseStrictBool(b.ok);
  if (ok === null) return { ok: false, error: "invalid_ok" };
  return {
    ok: true,
    result: {
      userId: b.user_id,
      positionId: b.position_id,
      ok,
      messageId: sanitizeText(b.message_id, MAX_MESSAGE_ID),
    },
  };
}

/**
 * The `ack_url` handed to n8n, built SERVER-SIDE.
 *
 * n8n never constructs this. It has the token only because we send it inside a
 * URL, and a workflow that assembled the link itself would be a second place the
 * function name and query-parameter name are written down — a rename would then
 * produce links that 404, discovered by a person clicking one on the last day
 * before deletion.
 */
export const buildAckUrl = (supabaseUrl: string, token: string): string =>
  `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/housing-renew?token=${encodeURIComponent(token)}`;
