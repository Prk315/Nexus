# Housing finder — source reconnaissance and plan

Cheap apartments and kollegieværelser near **Nørre Campus, KU** (Universitetsparken,
2100 København Ø / 2200 København N), with fast notification and eventually assisted
application. Same shape as the job applier: n8n discoverers on the Mac → scoped-secret
edge function → `auth.uid()`-scoped tables → decision emails + a review panel.

**Everything below was probed on 2026-09-06**, not assumed. Single fetches per endpoint,
no accounts created, nothing logged into, nothing submitted. Re-probe before trusting any
of it in six months — Danish housing portals rewrite their frontends often, and two of the
twelve sources had already moved or died since the brief was written.

---

## 1. Verdict table

| # | Source | Verdict | Evidence |
|---|---|---|---|
| 1 | **kollegierneskontor.dk** (KKIK) | 🟡 scrapeable-with-care — *catalogue only, no vacancies* | `GET /default.aspx?func=kkikportal.kollegiumlist&mid=34&topmenuid=34&lang=DK` → **200, 357 KB, ISO-8859-1**, server-rendered catalogue of ~40 dorms: description, prose waiting time ("Ventelistetid: ca. 2½-3 år"), room types, per-dorm *"Vælg ansøgning"*. Filters exist (`…_KollegiumFilter_PriceMin/PriceMax/roomtypeFilter`) but are **ASP.NET `__doPostBack`** — no URL params; filtering needs a forged `__VIEWSTATE`. `robots.txt` → **404** (IIS error page). No feed, no vacancy list. |
| 2 | **ciu.dk** | ⚫ moved — see #3 | Port **443 refused** (`nc` to `80.92.65.188:443` → connection refused). Port 80 open, `301 → https://www.s.dk/studiebolig/`. CIU survives as an *approbation committee* inside s.dk (`info@ciu.dk`, Løvstræde 1, 33 11 64 44 — read off a live building page). |
| 3 | **mit.s.dk** (CIU successor) | 🟢 **automatable — public JSON API, no auth** | `GET https://mit.s.dk/api/v2/public/buildings/search/?min_zipcode=2100&max_zipcode=2200&max_rent=6000&min_rooms=1&max_rooms=1` → **200 `application/json`**, `{"count":38,"results":[…]}`. All 38 are CIU dorms in the Nørre Campus catchment. `robots.txt` → **404** (nothing disallowed). Endpoint list lifted from `/static/applicants_app/frontend/static/js/main.4d1b930a.js`. |
| 4 | **findbolig.nu** (KAB) | 🔴 login-walled → notification-only | Vue SPA. Search is `POST /api/search/adverts` (axios `baseURL="/api"`, verified in `main.a7c923a2.js`) → **401**, with *and* without an anonymous cookie jar (`shell#lang`, `website#lang` only). SEO landing pages (`/da-dk/lejebolig/studieboliger-til-leje-i-koebenhavn`, 96 KB) contain **zero listings**. `/sitemap.xml` returns HTML, not XML. `robots.txt` disallows only `/sitecore/`. `/search/agents` exists → søgeagent email alerts are the sanctioned channel. |
| 5 | **fsb.dk** | 🔴 notification-only | `/ledige-boliger/` → **404**. `/find-bolig/` → 200 but a 15 KB shell with no listings and no external housing host (only own domain + CDNs). Pure waiting-list org ("Skriv dig op", "Ventetider på boliger"). |
| 5 | **kab-bolig.dk** | 🔴 notification-only | `/ledige-boliger` → 200, but it is a nav/marketing page. KAB's actual vacancy surface **is findbolig.nu** (KAB operates it) — so this is #4 wearing a different hat. Note *"Køb ventelistenummer"*: KAB waiting-list numbers **cost money**. |
| 5 | **lejerbo.dk** | 🔴 notification-only | `/ledige-boliger` → **404** (a 207 KB custom 404 page — do not trust the byte count, trust the status). `/boligsoegende` exists; `robots.txt` disallows `/api`. Waiting-list model via `/beboer/ny-beboer/opskrivning-og-venteliste`. |
| 6 | **housingfoundation.ku.dk** | ⛔ **ineligible — drop entirely** | Redirects to `housingfoundation.dk`. Verbatim from `/bookings-for-exchange-and-full-degree-students/`: *"**We do not accommodate Danish citizens.** We only accommodate international students and staff."* Also invitation-only, 3 booking rounds/year. Not a source; it is a dead end. |
| 7 | **boligportal.dk** | 🔴 **automation explicitly prohibited** → notification-only | `robots.txt` opens with prose: *"Crawling BoligPortal is not permitted without written permission… The use of automated services (robots, spiders, indexing, etc.) as well as other methods for systematic or regular use is not permitted without consent from BoligPortal A/S."* The page footer repeats it in Danish. Technically it is the **best** source: `/lejeboliger/københavn/?max_monthly_rent=9000&min_rooms=1` → 200, 322 KB, **404 results fully server-rendered** with price, m², neighbourhood and **relative posting age**. Pagination `?offset=18`. No RSS; JSON-LD is `Organization` only. |
| 8 | **lejebolig.dk** | 🟢 **automatable — `RealEstateListing` JSON-LD** | `robots.txt` `User-agent: *` disallows only `/kort/`, `/Content/Docs/`, `/Handler/`, `/Hunter/*`, `/Landlord/*`, `/Payment/` — i.e. the AJAX endpoints. **`/lejeboliger/*` and `/lejebolig/*` are allowed.** `Content-Signal: search=yes, ai-input=yes, ai-train=no`. `/lejeboliger/koebenhavn` → 200, "2.419 ledige", SSRs listing links `/lejebolig/{id}/{slug}` with **sequential numeric ids** (…1897055, 1897056, 1897057, 1897058). Detail page carries a full schema.org `RealEstateListing` block. |
| 9 | **boligzonen.dk** | 🟢 automatable — sitemap diff (HTML parse, no JSON-LD) | `robots.txt` `user-agent: *` disallows only `/en/rentals/*`; blocks a named SEO-bot list. `Sitemap: /sitemaps/boligzonen-dk.xml.gz` → gzip, 133 KB → **2.0 MB, 8,736 `/lejeboliger/<slug>` listing URLs**. Detail pages fully SSR (rent `49.500,-`, m², address, *"Oprettet / Opdateret: I går"*, *"Ledig fra"*, *"Valideret annonce"*). Search `/ledige-lejeboliger/find` SSRs 10,675 boliger with a **`Nyeste`** sort. **No JSON-LD.** |
| 10 | **akutbolig.dk** | 🔴 search robots-disallowed → notification-only | `robots.txt` `User-agent: *` → **`Disallow: /soeg`, `/search`, `/api/`** — the whole search surface. `/search` renders empty (JS-only). Homepage SSRs a "Nyeste Lejemål" strip + city counts (København **812 lejemål**). Signup flow is literally *"Opret bruger → Bekræft din email → Sæt dine boligønsker → **Vi sender nye boliger**"*. |
| 10 | **boligdeal.dk** | 🟡 scrapeable-with-care — low priority | `robots.txt` permissive; `Sitemap: /sitemapindex.xml` → 200, includes `sitemapads.xml` + `sitemapsearchads.xml`. Listing URLs `/leje/huse/{city}/{id}`. JSON-LD present but **`FAQPage` only** — price hides inside answer prose (*"Lejen for boligen er Ca. 10.000 kr."*). An aggregator mixing rentals and for-sale; mostly duplicates of #7–#9. |
| 11 | **dba.dk** | ⚫ **dead for housing** | `/bolig` → **404**. `/search?category=3080` → **404**. `sitemap.xml` lists only mobility (car, mc, boat, caravan, agriculture) and `sitemap-bap.xml` (recommerce goods). No bolig paths in `robots.txt`. Homepage has zero housing links. The bolig section is gone. |
| 12 | **JSON-LD sweep** | only **one** hit | `RealEstateListing`: **lejebolig.dk only**. boligzonen → none. boligportal → `Organization`. boligdeal → `FAQPage`. mit.s.dk → n/a (real API). |

### The mit.s.dk API, in full — this is the find

Discovered by reading the SPA bundle; every path below is under `https://mit.s.dk/api/v2`:

```
/public/buildings/search/          ?min_zipcode= &max_zipcode= &min_rent= &max_rent=
                                   &min_rooms= &max_rooms= &search= &committees= &page=
/public/buildings/search/map-data/
/public/buildings/short-wait-time/   -> count 244   ← the actionable waiting-list endpoint
/public/buildings/{pk}/
/public/buildings/attributes/
/public/buildings/facilities/
/public/committees/tiny/
```

Verified `buildings/search/` response (paginated 10/page, `count` = total):

```
2200 CIU  Ågården                    n=42  rooms=[1]  2474-3671 DKK  pk=5
2200 CIU  Industri Kollegiet         n=95  rooms=[1]  3665-3882 DKK  pk=39
2100 CIU  Den Grønne Trekant         n=42  rooms=[1]  2402-3412 DKK  pk=43
2100 CIU  Lægeforeningens Kollegium  n=83  rooms=[1]  3696-3696 DKK  pk=49
2200 CIU  Nørrebro Vænge             n=34  rooms=[1]  4446-5991 DKK  pk=30
…38 total
```

Verified `buildings/43/` (Den Grønne Trekant) returns: `publishtime`, `municipality`,
`desc_address`, `latitude`/`longitude`, `cats_allowed`/`dogs_allowed`, `elevator`,
`laundry`, `common_room`, `temporary_housing`, `description` (HTML), `is_ssl_enabled`
(Studiestartslisten eligibility), `app_committee {pk,name,abbreviation}`,
`administrator {name,phone,email}`, `room_counts`, `rent_range {min,max}`,
`area_range {min,max}`, plus `previous_building_pk`/`next_building_pk` — the whole
catalogue is walkable by following those two fields.

There is an SSR HTML twin at `mit.s.dk/studiebolig/search-result/?…` taking the same
query params, which is the fallback if the API ever closes.

⚠️ **`tenancies_count` is the number of units in the building, not vacancies.** There is
no vacancy concept here at all — see §2. `/public/tenancies/{pk}/` returned **404** for a
`tenancy_pks` value taken from a search result, so that path is not usable as probed.

---

## 2. The two-lane reality — it holds, and it is sharper than for jobs

The brief's hypothesis is correct, and the probes make the split cleaner than the job
pipeline's. These are not two speeds of the same thing; they are **two different data
models**, and collapsing them into one `housing_listings` table would be the first
mistake.

| | **Lane A — waiting list** | **Lane B — listing race** |
|---|---|---|
| Sources | mit.s.dk (CIU/RIU/Agora), KKIK, findbolig.nu, fsb, KAB, Lejerbo | lejebolig.dk, boligzonen.dk, boligportal.dk, akutbolig.dk, boligdeal.dk |
| The unit of data | a **building** you queue for | a **listing** that exists for hours |
| Does it appear and vanish? | No. `Den Grønne Trekant` will be there next year. | Yes. Median lifetime is short enough that "38 min. siden" is a *normal* top-of-list value. |
| What changes over time | your queue position; a building's *waiting time*; membership of `short-wait-time` | the set of listings itself |
| What "apply" means | one form, once, with study documentation and a fee; then wait | one contact message per listing, competing against everyone else |
| What speed buys you | **nothing.** Polling every 15 min is pure waste. | **everything.** This is the entire product. |
| Right cadence | daily (catalogue), 6-hourly (`short-wait-time`) | 15 min |
| Right notification | "a building you are queued for just entered short-wait-time" | "a listing matching your criteria appeared 4 minutes ago" |

Two consequences worth stating before anyone builds this:

- **Lane A's product is not notification, it is enrolment.** The highest-value action the
  whole system can take is a one-time report saying *"here are the 38 CIU buildings within
  your budget in 2100/2200, ranked by rent and waiting time; you are on 0 of them."*
  Everything after that is maintenance. A pipeline that notifies beautifully but never
  gets him onto a list has done nothing.
- **Lane B's product is latency, and the fastest sources are the ones that forbid
  scraping.** BoligPortal has by far the best data (404 SSR results with minute-resolution
  posting ages) and by far the clearest prohibition. This is exactly LinkedIn/Indeed from
  `JOB_APPLIER_PLAN.md` §2 — take the free path: the email alert.

---

## 3. Architecture

Mapped onto the patterns already in the repo. Nothing here is new machinery; it is the
job applier with a different noun, plus one extra table for the lane that has no listings.

```
mit.s.dk JSON API ──┐                                                    Lane A (daily)
KKIK catalogue ─────┤
                    ├──> n8n (Mac) ──> gate ──> Qwen ──> housing-ingest ──> Supabase
lejebolig JSON-LD ──┤                                                            │
boligzonen sitemap ─┤                                                    Lane B (15 min)
Gmail alerts ───────┘  (BoligAgent, findbolig søgeagent, akutbolig)              │
   NexusHeader / HousingPanel <───────────── reads ───────────────────────────────┘
```

### Tables — `housing_` prefix, `auth.uid()`-scoped, **no anon policy**

Same posture as `job_*` and `mail_messages`: these rows carry where a person is trying to
live. Read them with the authenticated `supabase` client, **never `supabasePublic`** —
getting that backwards returns an empty set rather than an error, indistinguishable from
"nothing matched".

**`housing_criteria`** — the profile, as **rows, not code**. Adding "I'd also take
Frederiksberg under 7k" is an insert.

```
id, user_id, name, enabled, sort
max_rent          integer
min_rooms / max_rooms
postal_codes      text[]    -- '2100','2200','2400','2450'
lane              text      -- 'waitlist' | 'race' | 'both'
housing_types     text[]    -- 'kollegie','ungdomsbolig','vaerelse','lejlighed','delebolig'
max_commute_min   integer   -- to Universitetsparken; scored, not gated
roommates_ok      boolean
move_in_from / move_in_to   date
exclude_terms     text[]
notes             text      -- free context handed to Qwen
```

**`housing_sources`** — one row per discoverer instance.

```
id, user_id, criteria_id -> housing_criteria, kind, lane, enabled
config      jsonb   -- {api_base,params} | {sitemap_url} | {search_url} | {gmail_query}
last_run_at, last_status, last_error, seen_cursor
```

`kind` ∈ `sdk_api` · `kkik_catalogue` · `lejebolig_search` · `boligzonen_sitemap` ·
`gmail_alert`.

**`housing_listings`** — Lane B only. The normalized ad, one row per real listing.

```
id, user_id, source_kind, url, canonical_url
external_id   text   -- lejebolig listing id; boligzonen slug
dedupe_key    text   -- normalized (postal_code, street, rent, rooms) — see trap below
title, address, postal_code, city, lat, lon
rent_dkk integer, deposit_dkk integer, area_m2 integer, rooms numeric
housing_type text, available_from date, furnished boolean, shared boolean
posted_at timestamptz, seen_at timestamptz, gone_at timestamptz
description text
ld_json     jsonb   -- the raw RealEstateListing, kept whole
apply_channel text  -- 'portal_message' | 'email' | 'phone' | 'external' | 'unknown'
apply_email, apply_url
discovered_at, status
```

**`housing_buildings`** — Lane A. A building is **not** a listing and must not be forced
into one: it has no `posted_at`, never goes away, and its interesting field is a *queue*.

```
id, user_id, source_kind, external_id   -- mit.s.dk pk, or KKIK dorm name
name, address, postal_code, municipality, lat, lon
committee text, administrator jsonb
room_counts int[], rent_min, rent_max, area_min, area_max
amenities jsonb
wait_time_note text      -- prose, as published; do not try to parse to a number
short_wait boolean       -- from /buildings/short-wait-time/
ssl_eligible boolean     -- Studiestartslisten
raw jsonb, first_seen_at, last_seen_at
```

**`housing_waitlist_positions`** — hand-maintained, one row per list he is actually on.
This is the table that makes Lane A worth anything; without it the system cannot tell
"38 candidate buildings" from "38 buildings I am already queued for".

```
id, user_id, building_id -> housing_buildings, provider text
signed_up_on date, position integer, position_checked_at timestamptz
fee_paid_dkk integer, renewal_due date, notes
```

**`housing_matches`** — target × criteria, kept separate for the same reason
`job_matches` is: one listing can be a 90 against "cheap room, walkable" and a 30 against
"proper flat, 2 rooms". Polymorphic over the two lanes via a nullable pair.

```
id, user_id, criteria_id, listing_id (nullable), building_id (nullable)
gate_verdict text, gate_reason text
score integer check (score between 0 and 100)
commute_min integer, reasoning text
model text, evaluated_at timestamptz
status text  -- 'new' | 'shortlisted' | 'contacted' | 'dismissed'
```

`score`/`evaluated_at` stay **nullable**. Nothing is scored while the Mac sleeps, and
unscored rows must sort to the **top** of the review list, not to the bottom where a
`default 0` would bury them. Same rule as `mail_messages.score`.

### Plumbing

- **`housing-ingest` edge function** — the only write path into `housing_listings` /
  `housing_buildings`. Clone `n8n-ingest`'s five invariants verbatim: POST-only,
  fail-closed under 32 chars, constant-time compare, service-role client, server-side
  owner re-check. Secret `HOUSING_INGEST_KEY`, header `X-Housing-Key`.
- **`n8n_requests.ALLOWED_KINDS`** gains `housing_sync` and `housing_evaluate`.
- **Freshness comes from the newest `housing_sync` row with `status='done'`**, never from
  `count(housing_listings)`. Zero rows means "nothing matched" *or* "n8n never ran", and a
  panel rendering both as "No new listings ✓" is lying half the time. This is the
  `blocking_state`-seeding mistake and the mail-panel row-count mistake, third outing.

### Harvest cadence, per lane

| Source | Cadence | Cost per poll | Politeness note |
|---|---|---|---|
| `lejebolig_search` | **15 min** | 1 search page (~200 KB) + N detail fetches | 96 search req/day. Detail fetches only for **unseen ids** — ids are sequential, so `max(external_id)` is a cheap high-water mark and a normal poll costs *one* request. Rate-limit detail fetches to 1/sec, cap per run. |
| `boligzonen_sitemap` | **30 min** | 133 KB gzip | Send `If-Modified-Since`; the sitemap carries `lastmod`. 48 polls/day worst case ≈ 6 MB. Diff against seen URLs, fetch only new slugs. |
| `gmail_alert` | continuous (existing mail bus) | 0 | BoligPortal BoligAgent + findbolig søgeagent + akutbolig. **Zero requests to those sites.** |
| `sdk_api` | **daily** at 07:00 | ~4 paginated calls | A building catalogue does not change hourly. |
| `sdk_api` (`short-wait-time`) | **6 h** | 1 call | The only Lane-A field that moves. |
| `kkik_catalogue` | **weekly** | 1 × 357 KB | Near-static. ISO-8859-1 — see trap. |

Jobs poll at 4 h; Lane B at 15 min is 16× that, and is justified only because a listing's
useful life is measured in hours. It is still one request per source per poll in the
steady state. **Do not** shorten it further "to be safe" — the marginal minute buys
nothing that the BoligAgent email does not already deliver faster.

### Extraction: two extractors, not one — same correction as the job pipeline

`JOB_APPLIER_PLAN.md` §2 was written believing one JSON-LD extractor would cover every
board, and had to be corrected after building it. The same belief would be wrong here for
the same reason, and the probe already proves it: **exactly one of five private portals
emits `RealEstateListing`.**

- **JSON-LD extractor** — lejebolig.dk. Verified field set: `datePosted`,
  `identifier.value`, `itemOffered.numberOfRooms`, `itemOffered.floorSize.value` (unit
  `MTK` = m²), `itemOffered.address.{streetAddress,addressLocality,postalCode}`,
  `offers.{price,priceCurrency,availability}`. This maps onto `housing_listings` almost
  one-to-one and needs no model call.
- **HTML extractor** — boligzonen.dk. Rent, m², address, "Oprettet / Opdateret", "Ledig
  fra" are all in SSR text. Falls back to a text dump handed to Qwen when the layout
  moves, flagged `needs_llm_extract`.
- **JSON mapper** — mit.s.dk. Not an extractor at all; it is a field rename.

### Reusing the decision-email loop

`JOB_APPLIER_PLAN.md` §7's machinery ports unchanged: a scored match produces a decision
email with the listing summary and an approve link; approval enqueues an
`n8n_requests` row; n8n performs the action; nothing is ever sent without a human
approval and there is **no auto-approve threshold at any score**. Housing needs that
discipline *more* than jobs did — a mistaken job application is embarrassing, a mistaken
housing enquiry can commit money.

### What "auto-apply" can actually mean, per source

The honest answer is *almost nothing*, and the reasons differ per lane.

| Source | Could it be automated? | What to build instead |
|---|---|---|
| mit.s.dk / CIU | **No, and it shouldn't be.** Signing up for a waiting list is one form, once, requiring study documentation and a fee. There is nothing recurring to automate. | A **one-time enrolment report**: the ranked 38 buildings, which ones are `short_wait`, which are `ssl_eligible`, what each costs. He does the signups in one sitting; the system tracks them in `housing_waitlist_positions`. |
| KKIK | Same. Per-dorm "Vælg ansøgning" behind an ASP.NET `__VIEWSTATE` postback — forging that is both brittle and pointless for a once-ever action. | Same report, plus a weekly diff of the catalogue. |
| findbolig.nu | No — 401. | Free waiting-list signup by hand; then the søgeagent email is the whole integration. |
| **boligportal.dk** | **Prohibited.** Contact messages require login, and both `robots.txt` and the ToS forbid systematic automated use. Automating this risks the account, which would cost him the BoligAgent alerts too — a strictly negative trade. | **Notification-only.** BoligAgent → Gmail → ingest → Qwen score → decision email with a *link*. He clicks and writes the message himself. |
| lejebolig.dk | Technically reachable, but `/Hunter/*` (their form endpoints) is robots-disallowed. | **Draft, don't send.** Qwen assembles the enquiry from pre-written modules; the decision email carries the draft and a deep link; he pastes and sends. |
| boligzonen.dk | Same. | Same. |
| akutbolig.dk | `/api/` and `/search` robots-disallowed. | Email alerts only. |

**The rule, stated once:** the pipeline may *read* anywhere it is permitted and may
*compose* anything, but it **submits nothing to a third-party portal**. Everything the
system sends goes out over his own email, from his own client, after he has approved it.
That is the same call as "LinkedIn and Indeed are ingest-only, forever", and it is the
only version that cannot get his accounts banned.

---

## 4. Open questions for the user

1. **Budget cap?** The Nørre Campus CIU stock at 1 room is **2,402–5,991 DKK/month**
   (Den Grønne Trekant cheapest, Nørrebro Vænge dearest). Private 1-room listings in the
   same area were clustering around **4,000–8,000 DKK**. A cap of 6,000 catches all 38
   CIU buildings; 5,000 catches maybe half. Where's the line, and is it rent-only or
   rent + a/c heat/water/internet?
2. **Roommates / shared kitchen — acceptable?** This is the single biggest lever. Most of
   the cheap Nørrebro/Østerbro CIU stock is *"værelse med eget bad/toilet og
   fælleskøkken"*. Ruling out shared kitchens removes most of the sub-4,000 inventory.
3. **Move-in timing?** Decides everything about lane weighting. Waiting times on the
   Nørre Campus dorms run **6 months to 3 years** (Vesterport ~2½–3 yr; Lautrupgård
   "typisk op til 6 måneder"). If he needs somewhere by, say, February, Lane A is a
   *background bet* and Lane B is the actual search. If the horizon is 12+ months, the
   priority inverts.
4. **Which waiting lists is he already on?** Critical and currently unknown — I did not
   log into anything. Specifically: does he have a **KKIK applicant profile**? An
   **s.dk / CIU** account? A **findbolig.nu** profile (free) or a **KAB ventelistenummer**
   (paid)? Seniority on these is the whole asset, and the system must not advise him to
   re-register somewhere he has three years banked.
5. **Is he eligible for Studiestartslisten?** `is_ssl_enabled` is a real field on the
   s.dk API and it is the fast lane for students starting a programme. Worth knowing
   before ranking anything.
6. **Study documentation ready?** Every kollegie application needs proof of enrolment
   with a minimum remaining study duration (several dorms require **≥1 study year left
   from the desired move-in date**; Hvidovre needs ≥6 months). Worth having as a file the
   pipeline can attach.
7. **How wide geographically?** 2100/2200 is the tight ring. Widening to 2400 (NV),
   2450/2500 (SV/Valby) and 2300 (S) roughly triples the CIU inventory at ~10–20 min more
   cycling. Should commute time be a **gate** or just a **score**?
8. **Danish or English listings?** Some private portals flag *"Kun til expats"* — worth
   knowing whether to exclude those.

---

## 5. ToS and ban-risk, per source

The pipeline must not cost him an account. Where automation is prohibited the fallback is
always the same and always sufficient: **the site's own email alert, read through the
existing Gmail bus.**

| Source | Risk | Posture |
|---|---|---|
| **boligportal.dk** | 🔴 **High — explicit prohibition in two places.** `robots.txt` prose plus the site footer: *"Regelmæssig, systematisk eller kontinuerlig indsamling… er ikke tilladt uden udtrykkelig skriftlig tilladelse fra BoligPortal."* Scraping risks the account; the account is what carries BoligAgent. | **Never fetch programmatically.** BoligAgent email → Gmail → ingest. Zero requests to the site. |
| **akutbolig.dk** | 🟠 Medium — `/search`, `/soeg`, `/api/` all `Disallow` for `*`. Homepage is not disallowed but harvesting it is against the evident intent. | Email alerts only. Do not poll the homepage strip. |
| **lejebolig.dk** | 🟢 Low — search and detail paths explicitly allowed; `Content-Signal: search=yes, ai-input=yes`. | Automate, politely: identify the UA honestly, ≤1 req/sec, high-water-mark on the sequential id so a normal poll is one request. Respect `ai-train=no` — **do not** put listing text into any training corpus. |
| **boligzonen.dk** | 🟢 Low — only `/en/rentals/*` disallowed; sitemap published for crawling. | Automate. Conditional GET on the sitemap; diff before fetching. |
| **boligdeal.dk** | 🟢 Low — permissive robots, sitemap advertised. | Automate if it ever proves to carry non-duplicate stock. Low priority. |
| **mit.s.dk** | 🟡 Ambiguous — **no `robots.txt` at all** (404), and the endpoints are literally namespaced `/public/`. Nothing is forbidden, but nothing is granted either. | Automate at **daily** cadence and no faster. A daily read of a public catalogue is indistinguishable from a user browsing. Identify the UA. If they ever add a `robots.txt`, re-probe before the next run. |
| **kollegierneskontor.dk** | 🟡 Ambiguous — no `robots.txt` (404), fragile IIS/WebForms app. | **Weekly, single GET**, and never touch `__doPostBack`. Forging `__VIEWSTATE` on a creaking ASP.NET app is both the most likely thing to break and the most likely thing to look like an attack. |
| **findbolig.nu** | 🟢 Low risk *because there is nothing to take* — the API is 401. | Do not attempt to authenticate the API from n8n. Søgeagent email only. |
| **fsb / KAB / Lejerbo** | 🟢 Low | Manual signup; newsletter/alert email if offered. |
| **housingfoundation** | n/a | Ineligible. Remove from consideration. |

Two cross-cutting rules:

- **Identify honestly.** A UA string naming the project and a contact address turns a
  polite scraper into a known one. Anonymous browser-spoofing at 15-minute intervals is
  what gets IP-blocked.
- **Never authenticate a scraper.** Every prohibition above becomes materially worse the
  moment a request carries his session. Logged-in automation is the specific thing that
  gets accounts terminated rather than IPs rate-limited.

---

## 6. Traps, recorded now so they aren't rediscovered

- **KKIK is ISO-8859-1.** `Content-Type: text/html; charset=iso-8859-1`, and unlike the
  Jobindex RSS the bytes are **genuinely latin-1** (`Gr&#248;njordskollegiet` alongside raw
  high bytes). A naive UTF-8 read turns every `ø`, `æ`, `å` in a dorm name into permanent
  mojibake in Postgres. Honour the declared charset.
- **A 404 can be 207 KB.** `lejerbo.dk/ledige-boliger` returns a full-chrome custom 404.
  Gate on `http_code`, never on `size_download`.
- **`tenancies_count` is inventory, not vacancy.** Nothing in Lane A publishes vacancies;
  a UI that renders "95 available at Industri Kollegiet" is lying. Render it as
  *"95 units, waiting list"*.
- **Cross-source duplicates are the norm.** boligdeal aggregates; the same flat appears on
  lejebolig and boligzonen with different ids. `dedupe_key` must be content-derived
  (normalized postcode + street + rent + rooms), not URL-derived — the job pipeline hit
  this same wall.
- **`gone_at` matters more than it did for jobs.** A listing that has been taken should
  disappear from the review surface fast, or the panel fills with dead links and stops
  being read. Mark `gone_at` when a detail fetch 404s or the search page stops carrying
  the id.
- **Absent is never zero** — the house rule, third application. A missing harvest is
  *unknown*, not "nothing available"; freshness comes from `n8n_requests`, never from a
  row count.
