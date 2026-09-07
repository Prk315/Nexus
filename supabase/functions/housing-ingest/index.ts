import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  buildAckUrl,
  type BuildingRow,
  type CriterionRow,
  dedupeWithinBatch,
  type ListingRow,
  MAX_BUILDINGS,
  MAX_LISTINGS,
  MAX_RENEWALS,
  nearestCriterionDistanceKm,
  NOTIFY_SCAN,
  type NotifyListingRow,
  parseBuildingBatch,
  parseListingBatch,
  parseNotifyLimit,
  parseNotifyResult,
  parseRenewalResult,
  type RenewalPositionRow,
  secretIsUsable,
  secretMatches,
  selectNotifyCandidates,
  selectRenewals,
  todayInTz,
} from "./logic.ts";

/**
 * housing-ingest — the only write path into `housing_listings` and
 * `housing_buildings`.
 *
 * # Why this exists
 *
 * Discovery runs entirely on the Mac: n8n reads lejebolig.dk's JSON-LD,
 * boligzonen's sitemap, mit.s.dk's public JSON API and the BoligAgent /
 * søgeagent alert emails through the existing mail bus. The result has to reach
 * a header panel served from Vercel and read on a phone, neither of which can
 * address `http://localhost:5678`. So n8n pushes here and every client reads a
 * table. Same shape as `job-ingest`, `n8n-ingest` and `usage-ingest`.
 *
 * # Security — the same five invariants as `n8n-ingest` and `job-ingest`
 *
 * 1. POST only; anything else is 405.
 * 2. Fails closed. A missing or under-32-character `HOUSING_INGEST_KEY` is
 *    `500 server_misconfigured`, never "allow everyone" — an empty env var
 *    deploys perfectly cleanly and would make `X-Housing-Key: ""` a valid
 *    credential.
 * 3. Constant-time comparison of the presented key.
 * 4. Service-role client, so the write does not depend on any RLS policy.
 * 5. Server-side owner check. The service role BYPASSES RLS, so `user_id` is
 *    enforced here or it is not enforced at all — every row is stamped with the
 *    verified id from the body, and the id is confirmed to belong to a real user
 *    with real criteria first.
 *
 * The primitives themselves are imported, not re-implemented: `logic.ts` re-
 * exports `secretMatches` / `secretIsUsable` from `../n8n-ingest/logic.ts`. A
 * second copy of a constant-time compare is how one of them quietly stops being
 * constant-time.
 *
 * The header is `X-Housing-Key`; the secret is `HOUSING_INGEST_KEY`.
 * `Headers.get()` is case-insensitive per spec, so the lowercase lookup accepts
 * any casing n8n's credential happens to be saved with.
 *
 * # Actions
 *
 * One endpoint, dispatched on `action`, because every one of them needs the same
 * secret and the same owner check and n8n gets exactly one credential.
 *
 * | action | direction | lane | does |
 * |---|---|---|---|
 * | *(none)* | n8n -> here | B | the harvest batch: upsert listings |
 * | `config` | here -> n8n | both | enabled criteria, sources and the seen-sets |
 * | `buildings_sync` | n8n -> here | A | upsert the catalogue, refresh `last_seen_at` |
 * | `notify_pending` | here -> n8n | B | gate-passing `discovered` listings, oldest first |
 * | `notify_result` | n8n -> here | B | the decision email went out (or did not) |
 * | `renewal_pending` | here -> n8n | A | waiting lists due for reconfirmation |
 * | `renewal_result` | n8n -> here | A | the reminder email went out (or did not) |
 *
 * # The renewal guard is Lane A's real product
 *
 * `renewal_pending` / `renewal_result` protect the thing this whole system is
 * built around: waiting-list seniority. Both Copenhagen lists that matter delete
 * a lapsed application **monthly** — not six-monthly, which is what this was
 * scoped believing — and deletion is final ("Du kan ikke få en slettet ansøgning
 * tilbage"). The verified rules and their sources are in
 * `supabase/migrations/20260906150000_housing_renewal_guard.sql`.
 *
 * These two are structurally the same pair as `notify_pending`/`notify_result`,
 * with one deliberate difference: the acknowledgement does not come back through
 * n8n at all. `renewal_result` records only that an EMAIL WAS SENT. That a
 * renewal actually happened can only be asserted by a human, on the
 * `housing-renew` page, and nothing in this function can write it.
 *

 * # The two lanes are two actions, and that is the point
 *
 * `HOUSING_PLAN.md` §2: a building you QUEUE for and a listing you RACE for are
 * two data models, not two speeds. `buildings_sync` runs daily and refreshes a
 * catalogue that will still be there next year; the default harvest runs every
 * 15 minutes against ads whose median lifetime is measured in hours. Collapsing
 * them would give a dorm a `posted_at` it does not have and a status lifecycle it
 * never traverses.
 *
 * Notice what is NOT here: there is no `apply` action and there deliberately
 * never will be. The pipeline may read where it is permitted and compose
 * anything, but it **submits nothing to a third-party portal** — every message
 * leaves over his own email, from his own client, after he has approved it. That
 * is the same call as "LinkedIn and Indeed are ingest-only, forever", and it is
 * the only version that cannot get his accounts banned.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

/** The columns the gate and the notify payload need. Pinned so a rename shows up. */
const NOTIFY_COLUMNS =
  "id,title,url,address,zipcode,rent,rooms,sqm,lat,lng,housing_type,available_from," +
  "posted_at,first_seen_at,source_kind";

/**
 * ⚠️ `postal_codes` is load-bearing here. `readCriteria` feeds `gateListing`, and
 * a criterion read WITHOUT this column arrives with `postal_codes: undefined` —
 * which `postalVerdict` correctly reads as "no gate". So omitting it does not
 * error, it silently switches the postal gate off and lets Hillerød and Aarhus
 * back into the notify queue. Exactly the `TASK_SELECT` trap CLAUDE.md records:
 * a missing embed does not fail, it yields a quiet default.
 */
const CRITERIA_COLUMNS =
  "id,name,enabled,max_rent,center_lat,center_lng,radius_km,types,min_rooms,max_rooms," +
  "postal_codes";

/**
 * The renewal guard's read set. Pinned as a constant for the reason `MAIL_COLUMNS`
 * is: a column name inside a string is invisible to `tsc`, and PostgREST rejects
 * an unknown column outright (42703) rather than ignoring it — so a rename here
 * takes the whole guard down with a 500, on the one feature whose silence costs
 * three years of seniority.
 *
 * `ack_token` is load-bearing: `selectRenewals` skips any row without one,
 * because a reminder carrying no acknowledgement link is a dead end.
 */
const RENEWAL_COLUMNS =
  "id,list_name,signed_up_at,last_renewed_at,renewal_interval_months," +
  "reminder_lead_days,renewal_url,last_reminded_at,ack_token,position,notes";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expected = Deno.env.get("HOUSING_INGEST_KEY") ?? "";

  if (!url || !serviceKey || !secretIsUsable(expected)) {
    console.error("housing-ingest: missing or unusable configuration");
    return json({ error: "server_misconfigured" }, 500);
  }
  if (!secretMatches(req.headers.get("x-housing-key") ?? "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  const asRecord = (body ?? {}) as Record<string, unknown>;

  /**
   * The enabled criteria, read once per action that needs geography.
   *
   * Every distance in this function is derived from these rows and nothing else.
   * n8n never sends a centre: the criteria are the modularity surface, and a
   * workflow carrying a copy of the campus coordinates is a workflow that has to
   * be edited when he moves the pin.
   */
  const readCriteria = async (uid: string): Promise<CriterionRow[] | null> => {
    const { data, error } = await supabase
      .from("housing_criteria")
      .select(CRITERIA_COLUMNS)
      .eq("user_id", uid)
      .eq("enabled", true)
      .order("sort", { ascending: true });
    if (error) {
      console.error("housing-ingest: criteria read failed —", error.message);
      return null;
    }
    return (data ?? []) as unknown as CriterionRow[];
  };

  // MARK: - action: config
  //
  // n8n needs the enabled criteria and sources in order to know what to fetch,
  // but it has no session and therefore cannot satisfy `auth.uid()` against these
  // RLS-scoped tables. The alternative — handing n8n a service-role key — would
  // put a key that bypasses RLS on every table in this project inside a Docker
  // container, to read ten columns. Serving config through the same scoped secret
  // keeps the blast radius at "this user's housing search".
  //
  // It also keeps `housing_criteria` honest as the modularity surface: the
  // workflow stays a dumb pipe and adding "Frederiksberg under 7k" remains an
  // insert, not a workflow edit.
  if (asRecord.action === "config") {
    const uid = asRecord.user_id;
    if (typeof uid !== "string") return json({ error: "invalid_user_id" }, 400);

    const [criteria, sources, recentListings, recentBuildings] = await Promise.all([
      supabase.from("housing_criteria").select("*").eq("user_id", uid).eq("enabled", true)
        .order("sort", { ascending: true }),
      supabase.from("housing_sources").select("*").eq("user_id", uid).eq("enabled", true),
      // The seen-set for cheap dedup before any detail page is fetched. This is
      // what turns a normal lejebolig poll into ONE request: the ids are
      // sequential, so the harvester only fetches ids it has not seen.
      //
      // Bounded, and that bound is an optimisation rather than a correctness
      // mechanism — the unique index is what actually guarantees no duplicate
      // row. A short list costs a few wasted fetches, never a double row.
      supabase
        .from("housing_listings")
        .select("source_kind,external_id,url")
        .eq("user_id", uid)
        .order("first_seen_at", { ascending: false })
        .limit(2000),
      // Lane A's equivalent. The catalogue is ~40 rows per committee, so this is
      // effectively complete rather than a window.
      supabase
        .from("housing_buildings")
        .select("source_kind,external_id")
        .eq("user_id", uid)
        .limit(2000),
    ]);

    const failed = criteria.error ?? sources.error ?? recentListings.error ??
      recentBuildings.error;
    if (failed) {
      console.error("housing-ingest: config read failed —", failed.message);
      return json({ error: "config_failed", detail: failed.message }, 500);
    }

    type SeenRow = { source_kind: string; external_id: string; url?: string };
    const seenRows = (recentListings.data ?? []) as SeenRow[];
    const seenBuildings = (recentBuildings.data ?? []) as SeenRow[];
    return json({
      ok: true,
      criteria: criteria.data ?? [],
      sources: sources.data ?? [],
      seen: seenRows.map((r) => `${r.source_kind} ${r.external_id}`),
      // Additive to the pinned contract. `seen_urls` lets a sitemap diff filter
      // by URL before it has parsed an id out of a slug; `seen_buildings` is the
      // Lane A high-water mark and has no other action to come from.
      seen_urls: seenRows.map((r) => r.url ?? "").filter(Boolean),
      seen_buildings: seenBuildings.map((r) => `${r.source_kind} ${r.external_id}`),
    });
  }

  // MARK: - action: buildings_sync
  //
  // Lane A. The daily mit.s.dk catalogue pull, upserted in place.
  //
  // ## What refreshes and what does not
  //
  // `last_seen_at` refreshes on every sync — that is the whole point, and it is
  // what lets the panel distinguish "still in the catalogue this morning" from
  // "a row that exists because we saw it in March". `first_seen_at` is absent
  // from the payload so its column default only fires on insert; a daily re-sync
  // that rewrote it would erase the only history Lane A has.
  //
  // ## `distance_km` is computed HERE, not by the harvester
  //
  // The harvester does not know the criteria and should not: they are rows in
  // this database and n8n reads them through `config`. Computing distance
  // server-side also means the number cannot drift between a workflow's copy of
  // the campus coordinates and the panel's.
  //
  // It is a display denormalization only. A criterion added tomorrow leaves
  // every stored distance stale, so nothing gates on this column — `gateListing`
  // recomputes from `lat`/`lng` every time it runs.
  if (asRecord.action === "buildings_sync") {
    const nowIso = new Date().toISOString();
    const parsed = parseBuildingBatch(body, nowIso);
    if (!parsed.ok || !parsed.userId || !parsed.buildings) {
      return json({ error: parsed.error ?? "invalid_body", max_buildings: MAX_BUILDINGS }, 400);
    }

    const owner = await ownerCheck(supabase, parsed.userId);
    if (owner) return owner;

    const criteria = await readCriteria(parsed.userId);
    if (criteria === null) return json({ error: "config_failed" }, 500);

    const accepted: BuildingRow[] = [];
    const rejected: { external_id?: string; error: string }[] = [];
    for (const r of parsed.buildings) {
      if (!r.ok) {
        rejected.push({ external_id: r.external_id, error: r.error });
        continue;
      }
      r.building.distance_km = nearestCriterionDistanceKm(
        r.building.lat,
        r.building.lng,
        criteria,
      );
      accepted.push(r.building);
    }

    if (accepted.length === 0) return json({ ok: true, buildings: 0, rejected });

    const { data: upserted, error: upsertError } = await supabase
      .from("housing_buildings")
      .upsert(dedupeWithinBatch(accepted), {
        onConflict: "user_id,source_kind,external_id",
        ignoreDuplicates: false,
      })
      .select("id");

    if (upsertError) {
      console.error("housing-ingest: building upsert failed —", upsertError.message);
      return json({ error: "buildings_failed", detail: upsertError.message }, 500);
    }

    return json({ ok: true, buildings: upserted?.length ?? 0, rejected });
  }

  // MARK: - action: notify_pending
  //
  // Listings worth a human's attention: `status = 'discovered'`, passing the gate
  // against at least one enabled criterion, oldest first.
  //
  // ## Why the gate runs here rather than in the query
  //
  // It spans the criteria rows and a haversine, neither of which PostgREST can
  // express — and pushing it into a Postgres function would put a second copy of
  // the matching rule in the tree, which is the mistake CLAUDE.md records the
  // cost of twice (garmin's mapping, the BIA constants). So: a bounded scan, then
  // one pure function. `NOTIFY_SCAN` is what makes the bound safe.
  //
  // ## The queue predicate is `status = 'discovered'`, and `notified_at` is the
  // backstop
  //
  // Both are checked. The status is the ordinary filter; the null timestamp is a
  // claim about the world — no email has ever gone out about this flat. If a bug
  // or a hand-edit walked a row back to `discovered` after its email had been
  // sent, the status test alone would send a second one, and two decision emails
  // for one flat means two enquiries to one landlord. `notify_result` stamps the
  // timestamp and nothing clears it.
  //
  // Empty is `{ok: true, notify: []}`, never an error. At a 15-minute cadence
  // against a tight radius, most polls find nothing — a workflow that reported
  // red on "nothing to ask about" would be red all week and read by nobody.
  if (asRecord.action === "notify_pending") {
    const uid = asRecord.user_id;
    if (typeof uid !== "string") return json({ error: "invalid_user_id" }, 400);
    const limit = parseNotifyLimit(asRecord.limit);

    const criteria = await readCriteria(uid);
    if (criteria === null) return json({ error: "notify_pending_failed" }, 500);

    const { data: rows, error: rowsError } = await supabase
      .from("housing_listings")
      .select(NOTIFY_COLUMNS)
      .eq("user_id", uid)
      .eq("status", "discovered")
      .is("notified_at", null)
      // Oldest first: in a race lane the listing that has waited longest is also
      // the one closest to being gone. `housing_listings_user_status_idx` covers
      // this scan.
      .order("first_seen_at", { ascending: true })
      .limit(NOTIFY_SCAN);

    if (rowsError) {
      console.error("housing-ingest: notify_pending read failed —", rowsError.message);
      return json({ error: "notify_pending_failed", detail: rowsError.message }, 500);
    }

    return json({
      ok: true,
      notify: selectNotifyCandidates(
        (rows ?? []) as unknown as NotifyListingRow[],
        criteria,
        { limit },
      ),
    });
  }

  // MARK: - action: notify_result
  //
  // The email went out (or did not).
  //
  // A FAILED send leaves the row completely untouched — still `discovered`, still
  // a null `notified_at` — so the next poll picks it up again. That is the whole
  // retry mechanism, and it is why this reports rather than throws: a listing
  // nobody was told about must stay in the queue, not become a silently stalled
  // row that looks decided.
  //
  // The transition is guarded on `status = 'discovered'` in the UPDATE itself.
  // Without that, a slow notify workflow finishing after he has already dismissed
  // or contacted the listing through the panel would drag it back to `notified` —
  // a state machine that can run backwards is not one.
  if (asRecord.action === "notify_result") {
    const parsedNotify = parseNotifyResult(body);
    if (!parsedNotify.ok) return json({ error: parsedNotify.error }, 400);
    const n = parsedNotify.result;

    if (!n.ok) {
      // Nothing is written. Deliberately: see above.
      console.error("housing-ingest: notify send failed for", n.listingId);
      return json({
        ok: true,
        listing_id: n.listingId,
        status: "discovered",
        updated: false,
      });
    }

    const { data: updated, error: notifyError } = await supabase
      .from("housing_listings")
      .update({
        status: "notified",
        notified_at: new Date().toISOString(),
        notify_message_id: n.messageId,
      })
      .eq("id", n.listingId)
      // Invariant 5: service role bypasses RLS, so the owner check is this line.
      // Without it anything holding the ingest secret could stamp `notified` onto
      // any listing in the database.
      .eq("user_id", n.userId)
      .eq("status", "discovered")
      .select("id,status")
      .maybeSingle();

    if (notifyError) {
      console.error("housing-ingest: notify_result update failed —", notifyError.message);
      return json({ error: "notify_result_failed", detail: notifyError.message }, 500);
    }

    // No row matched: either the id is not this user's, or the listing has
    // already moved on. Both are `updated: false` rather than an error — the
    // email really was sent, and n8n has nothing useful to do with a 404.
    return json({
      ok: true,
      listing_id: n.listingId,
      status: updated?.status ?? null,
      updated: Boolean(updated),
    });
  }

  // MARK: - action: renewal_pending
  //
  // Lane A's renewal guard: waiting-list rows inside their reminder window, or
  // already overdue, that have not been reminded in the last three days.
  //
  // ## Two lists come back, and they must never be merged
  //
  // `renewals` are rows with a KNOWN interval and therefore a real due date.
  // `unknown_interval` are rows whose rule was never established — they carry no
  // `due_at` and no `days_left` at all, by shape, so a template physically
  // cannot render one as though it were due on a date. That separation is the
  // "absent is never a verdict" rule made structural rather than a flag someone
  // has to remember to check.
  //
  // A NULL interval is emphatically **not** "this list never expires". It is "we
  // have not been told", and the correct action is to go and find out — which is
  // why those rows still generate mail, just quarterly instead of every three
  // days.
  //
  // ## The whole scan is read into memory, on purpose
  //
  // The predicate needs a calendar-month addition and a per-row lead, neither of
  // which PostgREST can express — and pushing it into a Postgres function would
  // put a second copy of the derivation rule in the tree, the mistake CLAUDE.md
  // records the cost of three times over. The table is hand-maintained and tens
  // of rows; there is nothing to bound against.
  //
  // Empty is `{ok: true, renewals: [], unknown_interval: []}`, never an error.
  // On a daily schedule most days have nothing due, and a workflow that reported
  // red on "nothing to renew" would be red all month and read by nobody.
  if (asRecord.action === "renewal_pending") {
    const uid = asRecord.user_id;
    if (typeof uid !== "string") return json({ error: "invalid_user_id" }, 400);

    const { data: rows, error: rowsError } = await supabase
      .from("housing_waitlist_positions")
      .select(RENEWAL_COLUMNS)
      .eq("user_id", uid)
      .limit(MAX_RENEWALS * 4);

    if (rowsError) {
      console.error("housing-ingest: renewal_pending read failed —", rowsError.message);
      return json({ error: "renewal_pending_failed", detail: rowsError.message }, 500);
    }

    // Unlike `notify_pending`, the default is the MAXIMUM rather than a small
    // page. A renewal digest that silently truncated would drop exactly the rows
    // furthest from their deadline — which are the ones a person is least likely
    // to notice are missing.
    const rawLimit = asRecord.limit;
    const limit = typeof rawLimit === "number" && Number.isFinite(rawLimit)
      ? Math.min(MAX_RENEWALS, Math.max(1, Math.floor(rawLimit)))
      : MAX_RENEWALS;

    const nowMs = Date.now();
    const selection = selectRenewals((rows ?? []) as unknown as RenewalPositionRow[], {
      today: todayInTz(nowMs),
      nowMs,
      // Built here, never by n8n: the workflow holds the token only because we
      // put it inside a URL, and a workflow assembling the link itself would be
      // a second place the function name is written down.
      ackUrl: (token) => buildAckUrl(url, token),
      limit,
    });

    return json({ ok: true, ...selection });
  }

  // MARK: - action: renewal_result
  //
  // ⚠️ **This stamps `last_reminded_at` — "we told him". It does NOT and must
  // never touch `last_renewed_at` — "he did it".**
  //
  // The two column names differ by four characters and their meanings are
  // opposites, which makes this the single most dangerous line in the pipeline
  // to get wrong. Writing the acknowledgement here would push the due date a
  // whole interval forward on the strength of an email having been *sent*,
  // silence the guard for a month, and let the list delete him while the panel
  // showed a freshly-renewed row. Only a human POSTing on `housing-renew` can
  // assert a renewal.
  //
  // A FAILED send writes nothing at all, so the next daily pass picks the row up
  // again — the same retry mechanism as `notify_result`, and the same reason: a
  // person nobody managed to warn must stay in the queue rather than become a
  // row that looks handled.
  if (asRecord.action === "renewal_result") {
    const parsedRenewal = parseRenewalResult(body);
    if (!parsedRenewal.ok) return json({ error: parsedRenewal.error }, 400);
    const r = parsedRenewal.result;

    if (!r.ok) {
      console.error("housing-ingest: renewal reminder send failed for", r.positionId);
      return json({ ok: true, position_id: r.positionId, updated: false });
    }

    const { data: updated, error: renewalError } = await supabase
      .from("housing_waitlist_positions")
      .update({ last_reminded_at: new Date().toISOString() })
      .eq("id", r.positionId)
      // Invariant 5: the service role bypasses RLS, so this line IS the owner
      // check. Without it anything holding the ingest secret could suppress
      // another user's renewal reminders for three days at a time.
      .eq("user_id", r.userId)
      .select("id")
      .maybeSingle();

    if (renewalError) {
      console.error("housing-ingest: renewal_result update failed —", renewalError.message);
      return json({ error: "renewal_result_failed", detail: renewalError.message }, 500);
    }

    // No row matched: the id is not this user's, or the row was deleted between
    // the reminder and the report. `updated: false` rather than an error — the
    // email really was sent and n8n has nothing useful to do with a 404. The
    // only consequence of the un-stamped row is one more reminder tomorrow,
    // which is the safe direction.
    return json({ ok: true, position_id: r.positionId, updated: Boolean(updated) });
  }

  // MARK: - default: the Lane B harvest batch
  //
  // Every 15 minutes, for every enabled Lane B source. Most of what arrives is
  // already stored — the sequential-id high-water mark makes a steady-state poll
  // cheap, but a boligzonen sitemap diff after a quiet night is a real batch.
  const parsed = parseListingBatch(body);
  if (!parsed.ok || !parsed.userId || !parsed.listings) {
    return json({ error: parsed.error ?? "invalid_body", max_listings: MAX_LISTINGS }, 400);
  }

  const ownerFailure = await ownerCheck(supabase, parsed.userId);
  if (ownerFailure) return ownerFailure;

  const criteria = await readCriteria(parsed.userId);
  if (criteria === null) return json({ error: "config_failed" }, 500);

  const accepted: ListingRow[] = [];
  const rejected: { url?: string; error: string }[] = [];

  for (const r of parsed.listings) {
    if (!r.ok) {
      rejected.push({ url: r.url, error: r.error });
      continue;
    }
    // Display denormalization, same rule as `buildings_sync`: computed here
    // because the harvester does not know the criteria, and never read by the
    // gate, which recomputes from `lat`/`lng`.
    r.listing.distance_km = nearestCriterionDistanceKm(r.listing.lat, r.listing.lng, criteria);
    accepted.push(r.listing);
  }

  if (accepted.length === 0) {
    return json({ ok: true, listings: 0, rejected });
  }

  // ⚠️ The payload carries NO `status`, `first_seen_at`, `notified_at` or
  // `notify_message_id` — see the `ListingRow` comment in `logic.ts` and the
  // clobber note on `housing_listings_user_source_ext_idx`. PostgREST builds both
  // the INSERT column list and the DO UPDATE SET list from the keys present in
  // the body, so those four take their DEFAULT on insert and are left untouched
  // on conflict.
  //
  // That is the entire fix for the bug that ate `job_matches`: Lane B re-harvests
  // the same ad every 15 minutes by construction, so a DO-UPDATE upsert carrying
  // `status: 'discovered'` would walk every notified listing back to un-notified
  // and re-email it — forever, at 96 polls a day.
  //
  // `ignoreDuplicates: false` (= DO UPDATE) is still correct for the content
  // columns: a landlord dropping the rent must update the row, not create a
  // second one.
  const { data: upserted, error: upsertError } = await supabase
    .from("housing_listings")
    .upsert(dedupeWithinBatch(accepted), {
      onConflict: "user_id,source_kind,external_id",
      ignoreDuplicates: false,
    })
    .select("id");

  if (upsertError) {
    console.error("housing-ingest: listing upsert failed —", upsertError.message);
    return json({ error: "upsert_failed", detail: upsertError.message }, 500);
  }

  return json({ ok: true, listings: upserted?.length ?? 0, rejected });
});

/**
 * Invariant 5, factored out because three actions need it.
 *
 * Returns a `Response` on failure and `null` on success, so a caller reads as
 * `if (await ownerCheck(...)) return it`.
 *
 * Without this a caller holding the ingest secret could write rows under any
 * uuid it liked, including one that does not exist — orphaned rows no client can
 * ever see or delete. Checking `housing_criteria` rather than `auth.users`
 * doubles as a useful signal: no criteria means nothing to gate against anyway,
 * so the panel has not been set up yet.
 */
async function ownerCheck(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  userId: string,
): Promise<Response | null> {
  const { data: owner, error } = await supabase
    .from("housing_criteria")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("housing-ingest: owner check failed —", error.message);
    return json({ error: "owner_check_failed" }, 500);
  }
  if (!owner) return json({ error: "unknown_user_or_no_criteria" }, 403);
  return null;
}
