# Housing finder — harvest, alert and renewal guard

Discovers Copenhagen rental listings from **lejebolig.dk** and **boligzonen.dk**,
mirrors the **mit.s.dk** (CIU) dorm catalogue, screens everything against
rule-only criteria rows, and writes to Supabase through `housing-ingest`. A second
workflow mails a listing alert within ten minutes of a match landing; a third
guards the waiting-list reconfirmations that Lane A's whole value rests on.

```
lejebolig search  ──┐                                       Lane B — the race (30 min)
boligzonen sitemap ─┼─ n8n (Mac) ─ extract ─ gate ─ housing-ingest ─ Supabase ─ alert email
mit.s.dk JSON API ──┘                                       Lane A — the catalogue (daily)
                                                                          │
housing_waitlist_positions ── renewal_pending ── n8n (daily 08:00) ── reminder email
                                                                          │
                                             housing-renew confirm page ──┘  (POST only)

BoligAgent / søgeagent / akutbolig alerts ── Gmail ── existing mail bus (nothing here fetches them)
```

**Status:** harvest verified end to end against live n8n on 2026-09-06 —
`housing_listings` holds rows from both `lejebolig_jsonld` and
`boligzonen_sitemap`, clean run, `{ok: true, listings: n, rejected: []}`. Three
bugs that only a live run could have surfaced are recorded under
[Things that will bite](#things-that-will-bite).

`HOUSING_PLAN.md` at the repo root is the reconnaissance this was built from —
every endpoint below was probed live on 2026-09-06 before a line was written. It
is also where the two-lane split, the ToS posture and the per-source ban risk are
argued. Read it before changing a source.

## Layout

| File | What |
|---|---|
| `extract.js` | **the canonical extractor** — pure, dependency-free |
| `notify-housing.js` | the three emails: listing alert, renewal reminder, unknown-rule nudge |
| `extract.test.js` | `node --test extract.test.js` — 97 cases, covering both source files |
| `build-housing.mjs` | injects both sources into the three templates |
| `workflows/*.template.json` | the three workflows, with `__EXTRACT_JS__` / `__NOTIFY_JS__` placeholders |
| `workflows/housing-{harvest,notify,renewal}.json` | **generated — do not hand-edit** |
| `fixtures/` | real pages and API responses captured 2026-09-06 |
| `../job-applier/patch-deploy.mjs` | copies **all seven** workflows (four job + three housing) to `~/docker/n8n/workflows/` |

This folder sits outside the npm workspace globs (`apps/*`, `packages/*`) on
purpose, exactly like `../job-applier`: it has no dependencies and must never be
able to break an app build.

## The one rule

**Never edit `workflows/housing-*.json` by hand.** n8n Code nodes have no module
system, so `extract.js` is pasted into six separate node bodies and
`notify-housing.js` into four. Editing those copies puts ten untested forks of
the parsing rules in the tree — the exact failure CLAUDE.md records for the stale
Garmin bridge and the duplicated BIA constants.

```bash
cd n8n/housing
node --test extract.test.js && node build-housing.mjs
cd ../job-applier && node patch-deploy.mjs
```

Commit the source and the regenerated workflow together.

**The deployed copy is not the repo copy.** `patch-deploy.mjs` applies two things
that must never live in a public repo or a portable template: the Gmail credential
id (local to this n8n instance — the repo carries the placeholder
`GMAIL_CREDENTIAL_ID`) and a `CLI Trigger` node, because `n8n execute --id` refuses
a workflow whose only entry point is a schedule trigger.
`node patch-deploy.mjs --check` verifies the deployed copies are current and
writes nothing.

## Environment

Three variables are shared with the job pipeline and **one is new**. All live in
`~/docker/n8n/.env` — this repo is public and must never carry the key.

| Var | Value |
|---|---|
| `NEXUS_SUPABASE_URL` | `https://efxmzsdisaymtpebaxlp.supabase.co` — already set |
| `NEXUS_USER_ID` | the `auth.uid()` these rows belong to — already set |
| `JOB_NOTIFY_TO` | where alerts go; defaults to `bastianrthomsen@gmail.com` — already set |
| **`HOUSING_INGEST_KEY`** | **new** — the scoped secret for `housing-ingest`, sent as `X-Housing-Key` |

Generate it the same way `JOB_INGEST_KEY` was, and set it in **two** places or
nothing works:

```bash
# 🍎 MAC
openssl rand -hex 32        # ≥32 chars; housing-ingest fails closed below that

# 1. the function's side
npx supabase secrets set HOUSING_INGEST_KEY=<the value>

# 2. n8n's side — append to ~/docker/n8n/.env, then restart the container
#    (n8n reads .env at boot; an added variable is invisible until it does)
docker compose -f ~/docker/n8n/docker-compose.yml up -d
```

A missing or short key does not degrade quietly: `housing-ingest` refuses the
request, `Load Config` throws, and the run goes red on the first node. That is
deliberate — the alternative is a harvest that finds listings and stores none.

## Import order

`housing-notify` and `housing-renewal` are harmless with no data — both end their
run quietly on an empty queue. `housing-harvest` is not: it starts polling three
sites the moment it is activated, so bring it up last and watch one manual run
before letting the schedule have it.

```bash
# 🍎 MAC — the migration and the edge function must already be live.
#          A deploy does not create tables; see supabase/migrations/APPLY.md.
docker exec n8n n8n import:workflow --input=/home/node/workflows/housing-notify.json
docker exec n8n n8n import:workflow --input=/home/node/workflows/housing-renewal.json
docker exec n8n n8n import:workflow --input=/home/node/workflows/housing-harvest.json

# one manual run, before activating anything
docker exec n8n n8n execute --id nexus-housing-harvest
```

Then seed at least one `housing_criteria` row and the source rows — the workflow
holds **no configuration of its own**, and `Fan Out Sources` throws rather than
guessing if there are no criteria.

⚠️ **A workflow with `active = 1` is not necessarily running.** n8n 2.x versions
workflows, and one is only live when `activeVersionId` is set — which
`import:workflow` clears. Check n8n's startup log (`Currently active workflows:`),
never the `active` column. `../../integrations/n8n/README.md` has the full write-up.

### Source rows

`housing_sources.config` is the only place a URL or a parameter belongs. Nothing
below has a hard-coded value in a Code node; the defaults in the template exist so
a missing config is inert rather than broken.

| `kind` | `config` | Cadence |
|---|---|---|
| `lejebolig_jsonld` | `{"search_url": "https://www.lejebolig.dk/lejeboliger/koebenhavn", "max_detail_fetches": 20}` | every tick |
| `boligzonen_sitemap` | `{"sitemap_url": "https://boligzonen.dk/sitemaps/boligzonen-dk.xml.gz", "window_minutes": 180, "max_detail_fetches": 20}` | every tick |
| `sdk_api` | `{"api_base": "https://mit.s.dk/api/v2/public", "params": {"min_zipcode": 2100, "max_zipcode": 2200, "max_rent": 6000, "min_rooms": 1}, "daily_hour": 7, "max_pages": 10}` | daily |

## The renewal guard — the most valuable thing here, and the least recoverable

`housing-renewal` runs daily at 08:00 and is the only workflow whose failure costs
something that cannot be bought back.

`HOUSING_PLAN.md` §2: Lane A's product is not notification, it is **enrolment**,
and its asset is **seniority**. Waiting times on the Nørre Campus dorms run six
months to three years. A list that deletes you for a missed reconfirmation does
not pause your place — it ends it, and there is nothing to re-earn and nobody to
appeal to. Everything about this workflow is shaped by that asymmetry.

```
08:00 ─ renewal_pending ─┬─ renewals[]          → buildRenewalEmail          (loud)
                         └─ unknown_interval[]  → buildUnknownIntervalEmail  (gentle)
                                                  ↓
                                        Gmail → renewal_result
```

The server does all the deciding: the calendar-month addition, the per-row lead,
the reminder window and the repeat throttle (every 3 days for a dated row, every
90 for an undated one). The workflow renders and sends, and stamps the result. It
derives no policy — same split as `focus-evaluate` → `blocking_state`.

**Four rules it is built on, in descending order of how expensive they are to get
wrong:**

- **`renewal_result` stamps `last_reminded_at` — "we told him". It must never
  touch `last_renewed_at` — "he did it".** The two column names differ by four
  characters and mean opposite things. Writing the acknowledgement on the strength
  of an email having been *sent* would push the due date a whole interval forward,
  silence the guard for a month, and let the list delete him while the panel
  showed a freshly-renewed row. Only a human pressing the button on the
  `housing-renew` page can assert the second, and nothing in n8n can reach it.
- **The two lists have different shapes and must never be merged.**
  `unknown_interval` rows carry *no* `due_at` and *no* `days_left`, so a template
  physically cannot render one as though it were due on a date. `buildUnknownIntervalEmail`
  never reads either field even if handed them. A NULL interval is **not** "this
  list never expires" — it is "we have not been told", and the action is research.
- **Routing fails loud.** An item arriving with a `due_at` goes through the urgent
  template whichever array it came from. A dated row rendered as "no rush" costs
  years of seniority; an undated row rendered urgently costs one over-urgent email.
- **An unknown countdown is loud, not zero.** `renewalUrgency` returns
  `"days left unknown"` with the *most* alarming tone — the opposite polarity to
  `listingAge`, which renders an unknown listing age quietly. That asymmetry is
  deliberate: a wasted click versus a row the guard cannot reason about on a list
  whose deletion is irreversible.

**Both links in the email are safe to click, and only one can ever write.**
`renewal_url` is a third-party page. `ack_url` points at `housing-renew?token=…`,
which **renders on GET and mutates only on POST** with a `confirm=renewed` field —
so a mail scanner, a link-preview bot or Gmail's own image proxy fetching it
changes nothing. This is the job pipeline's "no one-click approve link" rule, and
it matters more here: an acknowledgement fired by an antivirus appliance at 03:00
would silence the guard for a month. **Do not turn `ack_url` into anything that
acts on GET.**

A failed send posts *nothing at all*, so the row keeps its old `last_reminded_at`
and tomorrow's pass reminds again. That is the whole retry, and it is why
`Log Failed Send` writes to `console.error` rather than reporting `ok: false`.

The workflow sends **no `limit`** on `renewal_pending`. That action's default is
the maximum rather than a page, deliberately: a digest that truncated would drop
exactly the rows furthest from their deadline, which are the ones you are least
likely to notice are missing.

## Politeness, and why the numbers are what they are

The pipeline must not cost him an account or an IP. Three rules, none negotiable:

**Identify honestly.** Every outbound fetch sends
`User-Agent: NexusHousing/0.1 (+personal housing search for one user;
bastianrthomsen@gmail.com)`. A UA naming the project and a contact address turns a
polite scraper into a known one; anonymous browser-spoofing at 30-minute intervals
is what gets IP-blocked.

**Never authenticate a scraper.** Every prohibition gets materially worse the
moment a request carries his session. Logged-in automation is the specific thing
that gets accounts terminated rather than IPs rate-limited.

**Read only.** The pipeline may read anywhere it is permitted and may compose
anything, but it **submits nothing to a third-party portal**. Every email it sends
goes to his own inbox.

| Setting | Value | Why |
|---|---|---|
| harvest tick | **30 min** | A listing's useful life is hours, so latency is the product — but `HOUSING_PLAN.md` §3's own 15-minute figure buys nothing the BoligAgent email does not deliver faster, and doubles the traffic. Do not shorten it. |
| lejebolig steady-state cost | **1 request** | Ids are sequential, so the high-water mark means a poll with nothing new fetches only the search page. |
| detail fetches | **≤20 per source per run**, `batchSize: 2` | ~1.3 req/s for lejebolig, 1.3 req/s for boligzonen. The cap only binds on a first run or after an outage. |
| boligzonen sitemap | **133 kB gzip per tick** | ~6 MB/day worst case. Diffed against a 45-minute `lastmod` window before anything is fetched. |
| mit.s.dk | **daily, ~5 calls** | A building catalogue does not change hourly, and the site has no `robots.txt` at all — daily and identified is what "indistinguishable from a person browsing" looks like. |
| notify tick | **10 min** | Reads Supabase only. Zero third-party traffic. |

**BoligPortal is never fetched, at any rate.** Its `robots.txt` opens with prose
forbidding automated use and the footer repeats it in Danish. It is technically the
*best* source — 404 results server-rendered with minute-resolution posting ages —
and that is exactly why scraping it is a bad trade: it would risk the account, and
the account is what carries the BoligAgent alerts. Same call as "LinkedIn and
Indeed are ingest-only, forever".

## Where this diverges from `HOUSING_PLAN.md`, and why

The plan was written before the edge function existed. Where the two disagree,
**the edge function wins** — it is the thing that rejects. All four differences
were found by reading `supabase/functions/housing-ingest/logic.ts` rather than by
a failed run, which is the only reason none of them shipped.

| | Plan / pinned brief | `housing-ingest` | Consequence of getting it wrong |
|---|---|---|---|
| lejebolig source kind | `lejebolig_search` | **`lejebolig_jsonld`** | Every listing comes back in `rejected` with `invalid_source_kind` — **in the response body, not as a failure**. Green run, nothing stored. This is the job pipeline's lost lane verbatim: 28 postings became 0 rows. |
| housing type vocabulary | Danish (`kollegie`, `vaerelse`, `lejlighed`, …) | **`kollegie` \| `studio` \| `apartment` \| `room`** | `parseHousingType` returns null for anything off-list, so `housing_type` silently stores null; and this file's own gate would drop every listing on `type lejlighed not in apartment/room`, logging a tidy reason for a pure vocabulary mismatch. |
| listing fields | stops at `dedupe_key` | also stores **`deposit`, `available_from`, `housing_type`** | Three columns permanently null with nothing to say why. Now sent. |
| config response | `{criteria, sources, seen}` | also returns **`seen_urls`, `seen_buildings`** | Additive. `seen_urls` is used as a second guard on boligzonen, whose ids are slugs parsed out of a URL. |
| `renewal_pending`'s two lists | "`unknown_interval:[…same shape…]`" | **different shapes on purpose** — `unknown_interval` rows carry *no* `due_at` and *no* `days_left` | Building the gentle email against the brief would have interpolated two `undefined` fields into an urgent-looking message. The split is "absent is never a verdict" made structural rather than a flag someone has to remember to check. |
| `renewal_pending` limit | not mentioned | default is the **maximum**, not a page | Passing `limit: 5` by habit (as `notify_pending` does) would silently drop the rows *furthest* from their deadline — the ones you are least likely to notice are missing. The workflow sends no `limit`. |

Two more things the server does that this workflow deliberately does **not**
duplicate: it gates listings itself (`selectNotifyCandidates` → `gateListing`,
including `min_rooms`/`max_rooms`, which the client gate ignores), and it
recomputes `distance_km` live from `lat`/`lng` rather than reading the stored
column. So the client gate is a **cheap pre-filter only, and must never be
stricter than the server's** — anything it drops is never seen again, while
anything it passes gets judged properly a second time.

## The BoligPortal lane: notification-only, and it needs one manual step

BoligPortal, findbolig.nu and akutbolig all reach this system as **their own alert
emails**, on the mail bus that already exists (`mail-triage` → `n8n-ingest` →
`mail_messages` → the header's mail panel). Zero requests to those sites. Nothing
in this folder fetches them and nothing here needs to.

The source kind for that lane is **`mail_alert`** (`SOURCE_KIND.mailAlert` in
`extract.js`), which is what `housing-ingest`'s `LISTING_SOURCE_KINDS` allows.
`HOUSING_PLAN.md` §3 calls the same lane `gmail_alert` — the plan is wrong, the
allow-list is right, and nothing in this folder writes rows with that kind anyway.

**The manual step, which nothing can automate:** *he must create the BoligAgent
alert himself*, in his BoligPortal account, with the criteria he actually wants.
Same for findbolig.nu's søgeagent (free, needs a profile) and akutbolig's
"Vi sender nye boliger" signup. Until those exist, the best source in the country
sends this pipeline nothing, and there is no error anywhere to say so — the panel
simply shows fewer listings than it should.

## What the first live runs found — three bugs no fixture could have caught

Recorded because each one was invisible to a green test suite and to a careful
read of the workflow, and all three failed *silently* in the direction of "this
lane simply has nothing today".

- **`Route Source` sent zero items down the lejebolig branch.** `SOURCE_KIND.lejebolig`
  was corrected from `lejebolig_search` to `lejebolig_jsonld` to match the edge
  function's allow-list; every Code node followed, because they share the
  constant. The **Switch node's `rightValue` is a literal string in JSON** and
  cannot import it, so it kept the old spelling — and a Switch branch keyed to a
  spelling nothing produces receives no items and reports nothing. Third outing of
  "two vocabularies for one lane" in this repo, after the job pipeline's
  `gmail_alert`/`gmail_alerts`. **`build-housing.mjs` now checks every Switch
  literal against `SOURCE_KIND` and refuses to build otherwise** — a literal that
  cannot import the constant can still be validated against it.
- **The boligzonen sitemap is rebuilt roughly DAILY, not continuously.** Measured
  2026-09-06 21:20 UTC: its newest `<lastmod>` was `2026-09-05T15:24:27Z` and the
  file's own `Last-Modified` header agreed to the second — **30 hours stale**. The
  original 45-minute *wall-clock* window therefore matched nothing, and would have
  matched nothing on every run forever. The window is now anchored on the file's
  own newest `lastmod` (clamped to `now`), so it means "the newest listings this
  file knows about" however often the file is rebuilt. A stale file is not
  evidence of no new listings; it is evidence of a stale file. The sitemap age is
  logged every run, because it is the number that explains an empty lane.
- **The Compression node's output could not be read, and the throw took the other
  lane down with it.** `binary[key].data` is base64 only in n8n's in-memory mode;
  a 2 MB decompressed sitemap does not stay in memory, so `.data` was empty and
  the property (`file_0`) decoded to nothing. Two fixes: the read now goes through
  `this.helpers.getBinaryDataBuffer` (mode-independent, and proxied correctly even
  when Code nodes run in an external task runner) with the base64 path as a
  fallback; and the failure is **no longer fatal**, because a Code-node throw
  fails the *whole* execution and the lejebolig branch's twenty already-fetched
  listings never reached the batch POST. One broken lane must not zero a healthy
  one — the job-harvest lesson, arriving late.

Two smaller ones from the same sessions:

- **`new Function(body)` is the wrong compile check for an n8n Code node.** n8n
  wraps a body in an async function, so **top-level `await` is legal there**, and
  the sync constructor rejects it with `missing ) after argument list` — a message
  about parens that has nothing to do with parens. `build-housing.mjs` uses the
  `AsyncFunction` constructor. The two job-applier builders still use the sync one;
  that is fine only until one of their nodes awaits something.
- **A guard that cries wolf is worse than no guard.** The first end-of-run lane
  check called `getBinaryDataBuffer` on `$('Decompress Sitemap')`'s item — but that
  helper is indexed against the **current** node's input, not the named node's, so
  it read the HTTP response instead and failed a run that had just stored rows
  from a perfectly healthy boligzonen lane. The check now reads an explicit
  sentinel item off the picker's output (`Drop Lane Errors` removes it before it
  can reach an HTTP node; `$('Node').all()` is unaffected by anything downstream).

## Things that will bite

- **The boligzonen sitemap is gzip as a Content-*Type*, not a Content-Encoding.**
  Nothing in the HTTP stack unwraps it: not `curl --compressed`, not n8n's HTTP
  node. A `responseFormat: "text"` read hands the parser DEFLATE bytes, which parse
  to zero listings, and the run finishes green. The workflow therefore fetches it
  as a **file** and puts an n8n Compression node in front. There is no uncompressed
  twin — `/sitemaps/boligzonen-dk.xml` 302s to an HTML page (and, usefully, so does
  the plain `/sitemap.xml` the source row points at).
  `sitemapXmlFromCandidates` finds the decompressed property by *decoding it and
  checking it starts with `<`* rather than by name — the Compression node names its
  output after `outputPrefix` plus an index (`file_0` here), and the HTTP node's
  own still-gzipped `data` travels alongside it. Verified live; see the section
  above for the two ways the first attempt got this wrong.
- **`external_id` is the seen-set key, so it must be the string discovery can
  compute.** boligzonen pages carry `data-id="8169434"` and "Sagsnummer: 8169434",
  and the extractor uses the **slug** anyway — because the sitemap publishes URLs
  and nothing else. Keying ingest on the number and discovery on the slug means the
  two never meet, and every run re-fetches and re-notifies everything it has ever
  seen, forever, green.
- **Neither private portal publishes coordinates.** Verified: the string `latitude`
  does not occur in a lejebolig or a boligzonen detail page. So every Lane B row
  reaches the gate with `lat`/`lng` null and passes the radius check with a
  `coords_missing` flag. A radius check that dropped them would drop the *entire
  lane*, silently. The postcode list is what actually constrains geography here;
  `radius_km` is decorative until a geocoder exists.
- **Client-side gate verdicts are not persisted.** The listing shape has no room
  for them, so a drop by `Gate Listings` is logged to the n8n execution log and
  nowhere else. The server runs its own gate on the way *out* (`notify_pending`),
  and that one is authoritative — but it can only judge listings the client let
  through. `HOUSING_PLAN.md` §3 describes a `housing_matches` table with
  `gate_verdict` / `gate_reason`; until that lands, the database cannot tell you why
  a listing never appeared at all.
- **The cap drops listings; it does not queue them.** `nextIdRange` takes the
  *newest* ids, unlike the job harvester which drains oldest-first so its cursor
  advances contiguously. On a race lane a listing reached on the fourth run of a
  backlog drain has already been taken. What the cap could not reach is counted and
  printed as `deferred` — **`deferred > 0` on consecutive runs is the signal to
  raise `max_detail_fetches`**, and it is printed rather than hidden precisely
  because a cap that quietly eats listings looks exactly like a dead source.
- **Lane A rides a clock guard, not a second trigger.** `patch-deploy.mjs` requires
  exactly one schedule trigger per workflow (it mirrors that trigger's wiring onto
  the CLI trigger), so the daily branch runs only on the tick that lands in
  `[daily_hour:00, daily_hour:30)`. If the Mac is asleep across that window, Lane A
  is skipped for the day. That is the accepted cost of *"edge functions for what
  must happen, n8n for what is nice to happen"* — a missed catalogue diff costs
  nothing, which is why it is not on pg_cron.
- **`tenancies_count` is units in the building, not vacancies.** Lane A publishes no
  vacancy concept at all. It is kept only inside `raw` so no UI can render
  "42 available at Ågården", which would be a lie.
- **`short_wait` has three states.** `/short-wait-time/` is exhaustive, so absence
  from a *successful* call really is `false`. A *failed* call is evidence of
  nothing, and writing `false` for all 38 buildings because one request timed out
  would silently retract every short-wait flag in the database. It comes back
  `null` in that case, and the log says so.
- **Row count is not a freshness signal.** Zero listings means "nothing matched"
  *or* "n8n has never run", and a panel rendering both as "No new listings ✓" is
  lying half the time. Freshness comes from the newest `n8n_requests` row with
  `kind = 'housing_sync'` and `status = 'done'`; no such row means *unknown*, and
  the UI must say so. Third outing of the `blocking_state`-seeding mistake.
- **n8n 2.x rejects workflow JSON that 1.x accepted** — a missing top-level `id`,
  and `tags` given as plain strings rather than tag objects. `build-housing.mjs`
  checks both, because the importer's error says neither.

## Re-probing

Danish housing portals rewrite their frontends often; two of the twelve sources in
`HOUSING_PLAN.md` had already moved or died between the brief and the probe. When
a lane goes quiet, re-capture the fixtures the same way they were made — single
polite fetches with the honest UA, then trim scripts, styles and base64 image
payloads — and let the tests tell you what moved. Every assertion in
`extract.test.js` names the failure it exists to prevent, so a red test is a
sentence, not a diff.
