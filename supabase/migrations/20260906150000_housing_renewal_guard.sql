-- 20260906150000_housing_renewal_guard.sql
--
-- The waiting-list RENEWAL GUARD: six additive columns on
-- `housing_waitlist_positions` that stop years of seniority being deleted by a
-- forgotten click.
--
-- Read `20260906120000_housing_pipeline.sql` first — this extends the table it
-- creates, and inherits its RLS, its `updated_at` trigger and its house rules.
--
-- # Why this is the highest-stakes thing in the housing pipeline
--
-- Every other failure in this system is recoverable. A missed listing is a flat
-- someone else got; a bad gate is an email that did not arrive; a stale
-- catalogue is a day of noise. **A missed renewal is different in kind**: the
-- Copenhagen kollegie lists do not suspend a lapsed application, they DELETE it,
-- and the accumulated seniority goes with it. From the KKIK FAQ, verbatim:
--
--     "Du kan ikke få en slettet ansøgning tilbage"
--
-- There is no support ticket that undoes it. Two years of waiting becomes zero,
-- and the only symptom is an email that stops arriving. So this guard fails
-- toward reminding, everywhere, without exception — the same posture as
-- `blocking_state` failing toward "still blocked".
--
-- # ⚠️ The intervals below are EVIDENCE, and the evidence contradicted the plan
--
-- This was scoped believing the lists reconfirm roughly every six months. Both
-- of the two that matter reconfirm **every month**, and a 6-month default would
-- therefore have produced a guard that reminded him five months after his
-- application had already been deleted — a guard that is worse than none,
-- because it looks like it is working.
--
-- ## Kollegiernes Kontor i København (KKIK) — 1 month, verified
--
-- <https://www.kollegierneskontor.dk/default.aspx?func=article.view&id=54&lang=DK>
-- ("Om at være på venteliste"), verbatim:
--
--     "For at beholde din ansøgning, skal du forny den mindst hver måned."
--
--     "Der vil blive sendt en erindring om fornyelse til din email adresse, og
--      hvis du har mobil nummer på din ansøgning, vil der også blive sendt en
--      sms."
--
--     "Hvis du glemmer at forny rettidigt, bliver din ansøgning slettet, og du
--      må starte forfra hvis du fortsat ønsker at ansøge om bolig hos KKIK."
--
-- <https://www.kollegierneskontor.dk/simple.aspx?func=article.view&id=61&lang=DK>
-- (FAQ), verbatim:
--
--     "Du skal stadig forny din ansøgning hver måned, selvom du er passiv."
--     "Du optjener 1 point pr. måned du er aktiv."
--     "Du kan ikke få en slettet ansøgning tilbage"
--
-- Note the second one: **passive status does not pause the clock.** Going
-- passive over an exam period is exactly when a person assumes the obligation
-- lapses, and it is exactly when it does not.
--
-- KKIK sends its own email/SMS reminder. That is not a reason to skip this
-- guard, it is the reason it exists: that reminder lands in the same inbox as
-- everything else, a week before deletion, and is the single most missable
-- message he receives.
--
-- ## CIU / s.dk (mit.s.dk studiebolig) — 1 month, verified
--
-- <https://www.s.dk/indstillingsregler/ciu/>, verbatim:
--
--     "Du skal holde dine oplysninger opdateret på din profil, så de altid er
--      retvisende. For at sikre, at dine boligønsker og profiloplysninger altid
--      er aktuelle, skal du hver måned bekræfte dem via din profil."
--
--     "Har du ikke bekræftet opskrivningerne, risikerer du, at dine
--      opskrivninger og din anciennitet bliver slettet."
--
-- <https://www.s.dk/raad-og-vejledning/>, verbatim:
--
--     "Minimum én gang hver kalendermåned skal du bekræfte dine opskrivninger og
--      dine informationer på s.dk for fortsat at stå på venteliste"
--
--     "Medansøgere skal også bekræfte en gang hver kalendermåned, også selvom de
--      ikke er berettiget til at stå på ventelisterne selv."
--
-- Two details worth carrying into the panel. It says **kalendermåned**, not
-- "within 30 days" — so a confirmation on the 2nd of March does not cover the
-- 1st of April, and the honest reading is stricter than `+ 1 month`. And a
-- **medansøger must confirm separately**: if he ever applies jointly, that is a
-- second row here, not a note on the first.
--
-- ## findbolig.nu — 12 months, and a DIFFERENT mechanism
--
-- Not a click: an annual `ajourføringsgebyr`, which is a PAYMENT. Non-payment
-- after a reminder is what deletes the registration. Per BL (Danmarks Almene
-- Boliger),
-- <https://bl.dk/viden-kartotek/nye-regler-om-ajourfoeringsgebyrer-paa-vej-krav-om-rykker-foer-sletning-mv/>:
--
--     "Betaler den boligsøgende ikke trods påmindelsen, slettes den boligsøgende
--      fra ventelisten."
--
--     "6-ugers reglen fjernes, og der vil derfor ikke være frister for, hvor
--      hurtigt påmindelse skal udsendes og hvor hurtigt sletning skal ske."
--
-- ⚠️ **The grace period is no longer defined in law.** It used to be six weeks;
-- that was removed and each boligorganisation now sets its own. So for a
-- findbolig-style row the interval is knowable (12 months) but the safety margin
-- is not, which is precisely the case for a longer `reminder_lead_days` — 30, not
-- 14 — rather than a shorter one.
--
-- ## What is NOT verified
--
-- KAB's own ventelistenummer, fsb, and any private list. Their rules were not
-- established here, and the honest encoding of that is `renewal_interval_months
-- IS NULL` plus the consumer behaviour documented on the column: **remind him to
-- go and CHECK the rule**, on a slow cadence, forever. Not silence.
--
-- # The seeded defaults are DEFAULTS, not facts about his rows
--
-- Nothing is seeded here — the same reason nothing is seeded in the pipeline
-- migration: every row is `user_id`-scoped to `auth.users` and a migration has no
-- session to attribute a row to. The intervals above belong in the panel's
-- picker and in this comment. What the migration can do is make the *column*
-- default safe, and the safe default for a column whose wrong value costs three
-- years of seniority is NULL — "we have not been told" — never a guess.

-- ---------------------------------------------------------------------------
-- The columns
-- ---------------------------------------------------------------------------

alter table public.housing_waitlist_positions
  -- ⚠️ NULL is NOT "this list never expires". It is **"no verdict"** — either
  -- verified as having no renewal requirement, or simply never established — and
  -- the two are not distinguished on purpose, because they call for the same
  -- action from a consumer.
  --
  -- **Consumers MUST treat NULL as "remind him to CHECK the rule", never as
  -- "never expires".** This is the house rule ("absent is never a verdict")
  -- pointed at the one column where reading absence as reassurance is
  -- unrecoverable. `blocking_state` is deliberately unseeded for the same
  -- reason, and `housing_buildings.short_wait` is three-valued for the same
  -- reason. Here the stake is higher than either.
  --
  -- `housing-ingest`'s `renewal_pending` implements this: a NULL-interval row
  -- never enters the `renewals` list (it has no due date and inventing one would
  -- be folklore) and instead surfaces in a separate `unknown_interval` list on a
  -- 90-day cadence. Separate, so a "go and find out" can never be mistaken for a
  -- "renew by Tuesday".
  add column if not exists renewal_interval_months integer,

  -- The acknowledgement: the last time he actually renewed. Written by exactly
  -- two things — the `housing-renew` confirm page's POST, and a human editing
  -- the panel. Never by an email being sent.
  --
  -- ⚠️ **Do not confuse this with `last_reminded_at`.** The names differ by four
  -- characters and the meanings are opposites: this one is a claim that HE DID
  -- THE THING, the other is a claim that WE TOLD HIM TO. Writing this one when
  -- an email goes out would push the due date forward a whole interval on the
  -- strength of a notification, silence the guard, and delete the list. That is
  -- the single worst bug this file can contain.
  add column if not exists last_renewed_at date,

  -- How early the reminder starts. Per row, because the right answer differs by
  -- an order of magnitude between the lists above:
  --
  --   * a **1-month** list (KKIK, CIU) wants something SHORT — 7 is sensible.
  --     14 on a ~30-day cycle means half of every month is inside the window.
  --     That is noisy but it is not wrong, and the noise is self-limiting: the
  --     moment he confirms, `last_renewed_at` moves the due date a month out and
  --     the window closes. Repeated reminders mean he has not acted yet, which
  --     is the one case where repeating is the entire point.
  --   * a **12-month** findbolig row wants something LONG — 30 — because the
  --     deletion grace period after the påmindelse is no longer defined in law
  --     (see above) and an invoice takes real days to pay.
  --
  -- Default 14 as a middle value that is safe in both directions rather than
  -- optimal in either. NOT NULL because a null lead has no sane reading: it
  -- would either be silently coerced to 0 (remind on the day it expires, which
  -- is too late by the width of one cron tick) or make the row un-evaluable.
  add column if not exists reminder_lead_days integer not null default 14,

  -- Where he goes to do it. `https://www.kollegierneskontor.dk/...`,
  -- `https://mit.s.dk/...`. Rendered as the prominent action on the confirm page
  -- and in the reminder email, because a reminder that does not carry the link
  -- is a reminder that gets deferred until he is at a desk.
  add column if not exists renewal_url text,

  -- Repeat control ONLY: the last time a reminder was SENT. Stamped by
  -- `housing-ingest`'s `renewal_result` on a successful send and cleared by a
  -- confirmed renewal, so each cycle starts fresh.
  --
  -- It is not a due date, not an acknowledgement and not evidence of anything
  -- except that a message left the machine. A failed send writes nothing at all,
  -- which is the whole retry mechanism — identical to `notified_at` on
  -- `housing_listings`, and identical in its reasoning: a thing nobody was told
  -- about must stay in the queue rather than become a row that looks handled.
  add column if not exists last_reminded_at timestamptz,

  -- The credential for the "I renewed" page. A v4 uuid from pgcrypto's CSPRNG:
  -- 122 bits, unique-indexed, not guessable and not enumerable — the same
  -- construction as `job_applications.approval_token`.
  --
  -- ## ⚠️ Unlike that token, this one is REUSABLE, and that is deliberate
  --
  -- `approval_token` stops being a WRITE credential the instant the row leaves
  -- `needs_approval`; that status transition is its single-use mechanism. There
  -- is no equivalent here and there must not be, because **renewal recurs
  -- forever**. Every month, the same list needs the same acknowledgement again.
  -- A single-use token would mean either a schema change per cycle or a link
  -- that silently stops working in month two — and a dead renewal link fails in
  -- the exact direction this whole file exists to prevent.
  --
  -- Why a permanently-live write credential in an email is acceptable here:
  --
  --   1. **GET never mutates.** Mail scanners prefetch every URL in every
  --      message; that is the realistic automated actor, and it reads a page and
  --      changes nothing. Same structural rule as `job-approve`, same reason.
  --   2. **The POST needs an explicit `confirm=renewed` field**, not merely the
  --      token. A scanner replaying the bare URL as a POST gets a 400. (A
  --      scanner that submits the rendered form is not stopped by this;
  --      `job-approve` carries exactly the same residual exposure for a strictly
  --      more destructive action.)
  --   3. **The failure is bounded and self-announcing.** The worst a spurious
  --      POST can do is stamp `last_renewed_at = today` when he did not renew:
  --      it delays the next reminder by one interval and nothing else. It cannot
  --      delete a row, cannot send anything, cannot reach another user's data.
  --      And because every reminder email states the stored `last_renewed_at`
  --      back to him, a date he does not recognise is visible rather than
  --      silent.
  --   4. **A re-stamp on the same day is a no-op.** Double-clicks, browser
  --      retries and a second tab all write the value that is already there.
  --
  -- The one thing that would make this unsafe is giving the token any power
  -- beyond stamping a date on its own row. Keep it at that.
  add column if not exists ack_token uuid not null default gen_random_uuid();

-- ---------------------------------------------------------------------------
-- Constraints
-- ---------------------------------------------------------------------------
--
-- Dropped-then-added rather than `if not exists` (which Postgres does not offer
-- for constraints), so the file is re-runnable — forward-only migrations still
-- get applied twice by accident.
--
-- A zero or negative interval would make `due_at <= signed_up_at`, i.e. **due
-- forever**, which is the same trap `pf_systems`' CHECK on `interval_days`
-- exists to prevent. Here it would be worse than a permanently-red row: at a
-- 3-day repeat it is a reminder twice a week for a list that is fine, and a
-- guard that cries wolf is a guard that gets filtered into a folder.
--
-- NULL stays legal — that is the "unknown" state the whole design turns on.

alter table public.housing_waitlist_positions
  drop constraint if exists housing_waitlist_renewal_interval_positive;
alter table public.housing_waitlist_positions
  add constraint housing_waitlist_renewal_interval_positive
  check (renewal_interval_months is null or renewal_interval_months > 0);

-- A negative lead would place the window AFTER the due date — reminding him
-- only once it is already too late, while the row still looks configured.
-- Zero is legal and means "remind me on the day", which is a defensible choice
-- for a list whose deadline is a wall clock rather than a date.
alter table public.housing_waitlist_positions
  drop constraint if exists housing_waitlist_reminder_lead_nonneg;
alter table public.housing_waitlist_positions
  add constraint housing_waitlist_reminder_lead_nonneg
  check (reminder_lead_days >= 0);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------

-- The `housing-renew` lookup. UNIQUE both because the token must identify
-- exactly one row and because uniqueness is what lets the confirm page use
-- `maybeSingle()` — a duplicate would otherwise surface as a runtime error on
-- the one page that must not fail.
--
-- Not partial: `ack_token` is NOT NULL so there is nothing to filter, and the
-- partial-index trap that broke `garmin-import`'s `(user_id, external_id)` and
-- `pf_task_sessions`' `(task_id, cal_block_id)` is not worth re-learning.
create unique index if not exists housing_waitlist_ack_token_idx
  on public.housing_waitlist_positions (ack_token);

-- The `renewal_pending` scan. The due-date predicate spans three columns and a
-- calendar-month addition, so it is not sargable and this index only narrows to
-- the user — which is enough: this table is tens of rows, not thousands, and it
-- is hand-maintained by construction (nothing writes to it automatically, see
-- the pipeline migration).
create index if not exists housing_waitlist_renewal_idx
  on public.housing_waitlist_positions (user_id, last_reminded_at);

-- ---------------------------------------------------------------------------
-- ⚠️ THE DERIVATION RULE — written ONCE, here
-- ---------------------------------------------------------------------------
--
-- Stated in SQL because SQL is the notation the table is in; implemented in
-- TypeScript in `supabase/functions/housing-ingest/logic.ts` (`renewalDueDate`,
-- `renewalDaysLeft`, `selectRenewals`) because the gate needs a calendar-month
-- addition and a per-row lead, neither of which PostgREST can express.
--
-- There is deliberately NO Postgres function, NO generated column and NO view
-- computing this. One rule, one implementation. Two copies of a matching rule is
-- the mistake CLAUDE.md records the cost of three times over (garmin's mapping,
-- the BIA calibration constants, the systems due-rule that was written out
-- thrice and whose copies already disagreed) — and the failure mode here does
-- not error, it just quietly stops reminding.
--
--     due_at    = (coalesce(last_renewed_at, signed_up_at)
--                    + renewal_interval_months * interval '1 month')::date
--
--     days_left = due_at - current_date          -- NEGATIVE means OVERDUE
--
--     in_window = due_at - reminder_lead_days <= current_date
--               = days_left <= reminder_lead_days
--
-- Four properties of that rule, each of which is load-bearing:
--
-- 1. **`coalesce(last_renewed_at, signed_up_at)`** — the clock restarts from the
--    last acknowledgement, and falls back to sign-up before the first one. It is
--    never `now()`: a due date derived from the current time is a due date that
--    can never arrive.
--
-- 2. **A row with `signed_up_at IS NULL` AND `last_renewed_at IS NULL` is NEVER
--    DUE.** He is not on that list yet — it is a row he created while planning
--    to sign up. There is no seniority to protect, and a reminder to renew
--    something he never joined is the noise that trains a person to ignore this
--    channel. It is not the "absent" trap: absence of a start date is a
--    positive, checkable fact about not having started.
--
-- 3. **`interval '1 month'` clamps at month end** — `date '2026-01-31' +
--    interval '1 month'` is `2026-02-28`, not March 3rd. The TypeScript
--    `addMonthsUtc` reproduces exactly this clamping, and `logic.test.ts` pins
--    it. Naive date arithmetic that rolls over would push a January-31 sign-up's
--    due date past the end of February and hand him a reminder three days after
--    a monthly list had already deleted him.
--
-- 4. **`renewal_interval_months IS NULL` yields NO due date at all** — not a far
--    future one. See the column comment: those rows leave through a separate
--    `unknown_interval` channel, and must never be merged into a due list.
--
-- The panel and any future widget read the SAME numbers by calling
-- `renewal_pending`, rather than re-deriving them. If a second consumer ever
-- needs them without going through the edge function, import the functions from
-- `logic.ts` — do not rewrite the rule here as a view.

comment on column public.housing_waitlist_positions.renewal_interval_months is
  'Months between required reconfirmations. NULL = no verdict (unknown OR verified as never expiring) — consumers must treat it as "remind him to CHECK the rule", never as "never expires". KKIK and CIU are both 1 (verified); findbolig-style almene lists are 12 (annual ajourføringsgebyr).';

comment on column public.housing_waitlist_positions.last_renewed_at is
  'The acknowledgement: he actually renewed on this date. Written only by the housing-renew confirm page POST or a human. NEVER by an email being sent — that is last_reminded_at.';

comment on column public.housing_waitlist_positions.last_reminded_at is
  'Repeat control only: a reminder was SENT at this time. Stamped by housing-ingest renewal_result on success, cleared by a confirmed renewal. Not evidence that anything was renewed.';

comment on column public.housing_waitlist_positions.reminder_lead_days is
  'How many days before due_at the reminder window opens. Use ~7 for monthly lists (KKIK, CIU) and ~30 for annual ones (findbolig), whose post-reminder grace period is no longer defined in law.';

comment on column public.housing_waitlist_positions.ack_token is
  'Credential for the housing-renew "I renewed" page. REUSABLE by design, unlike job_applications.approval_token — renewal recurs forever, so a single-use token would silently stop working in month two. Safe because GET never mutates and the worst a spurious POST can do is re-stamp last_renewed_at on its own row.';
