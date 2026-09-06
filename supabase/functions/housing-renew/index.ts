import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  formatYmd,
  parseIntOrNull,
  type RenewalPositionRow,
  renewalDaysLeft,
  renewalDueDate,
  todayInTz,
} from "../housing-ingest/logic.ts";

import {
  isUuid,
  nextDueAfter,
  parseRenewBody,
  type RenewView,
  renderErrorPage,
  renderRenewedPage,
  renderRenewPage,
} from "./logic.ts";

/**
 * housing-renew — the human acknowledgement point of the waiting-list renewal
 * guard.
 *
 * A link in a reminder email opens this page. It shows which list is due, when,
 * and a prominent link to the provider's own renewal form. He renews there, comes
 * back, and presses the button. **That press is the only thing in this entire
 * system that can write `last_renewed_at`.**
 *
 * # Why this matters more than it looks
 *
 * Every other failure in the housing pipeline is recoverable. This one is not.
 * Both Copenhagen lists that matter — Kollegiernes Kontor i København and CIU /
 * s.dk — require reconfirmation **every month** (verified; the sources are quoted
 * verbatim in `supabase/migrations/20260906150000_housing_renewal_guard.sql`), and
 * a missed one does not suspend the application, it deletes it. KKIK states it
 * without hedging: "Du kan ikke få en slettet ansøgning tilbage." Years of
 * seniority, gone, with no ticket that restores it.
 *
 * So every branch in this file fails toward *reminding again tomorrow*, never
 * toward recording a renewal that may not have happened.
 *
 * # Why this is not part of housing-ingest
 *
 * `housing-ingest` is machine-to-machine: POST only, `X-Housing-Key` on every
 * request, JSON in and JSON out. This is a *browser* endpoint — it answers GET, it
 * returns HTML, and the person opening it has no session, no key and no Supabase
 * cookie, just an email on whatever device was nearest. Bolting an
 * unauthenticated HTML branch onto a function whose first invariant is "POST only,
 * 405 otherwise" would weaken the exact rule that keeps the other one safe. Same
 * split, same reasoning, as `job-approve` versus `job-ingest`.
 *
 * # Authentication: the token IS the credential
 *
 * ⚠️ **Deploy with `--no-verify-jwt`.**
 *
 *     npx supabase functions deploy housing-renew \
 *       --project-ref efxmzsdisaymtpebaxlp --no-verify-jwt
 *
 * Supabase's default gateway check rejects a request with no `Authorization`
 * header *before this code runs*, and a person clicking a link in Gmail has no
 * bearer token. With the default left on, every renewal link returns 401 and the
 * guard is silently dead — with nothing in this function's logs, because it is
 * never invoked. The failure would surface as a deleted waiting list.
 *
 * What stands in for a session is `housing_waitlist_positions.ack_token`: a v4
 * uuid from `gen_random_uuid()` (pgcrypto's CSPRNG), 122 bits, unique-indexed, not
 * guessable and not enumerable.
 *
 * ## The one real difference from job-approve: this token is REUSABLE
 *
 * `job_applications.approval_token` stops being a write credential the instant the
 * row leaves `needs_approval` — that status transition is its single-use
 * mechanism. There is no equivalent here and there must not be, because renewal
 * recurs forever: the same list needs the same acknowledgement again next month. A
 * single-use token would mean a link that silently stops working in month two, and
 * a dead renewal link fails in precisely the direction this guard exists to
 * prevent.
 *
 * Three things make a permanently-live write credential acceptable:
 *
 *   1. **GET never mutates.** Mail scanners prefetch every URL in every message;
 *      that is the realistic automated actor, and it reads a page and changes
 *      nothing. Structural, not a promise: the renderers are pure functions that
 *      hold no client.
 *   2. **The POST requires an explicit `confirm=renewed` field**, not merely the
 *      token — so a scanner replaying the bare URL as a POST gets a 400.
 *   3. **The blast radius is one date on one row.** The token cannot delete
 *      anything, cannot send anything, and cannot reach another user's data. And
 *      every reminder email echoes the stored `last_renewed_at` back to him, so a
 *      date he does not recognise is visible rather than silent.
 *
 * # Everything rendered is escaped
 *
 * The values here are his own — typed into his own panel — so the trust boundary
 * is lower than job-approve's scraped job ads. Escaped anyway, without exception:
 * a sanitizer applied only where the author currently believes it is needed fails
 * the first time a field changes source, and `notes` is one paste away from
 * carrying markup off a provider's website.
 */

/**
 * Response headers, and every one of them earns its place.
 *
 * `Referrer-Policy: no-referrer` is the load-bearing one. **The token is in the
 * URL**, and this page's whole purpose is to link out to the housing provider —
 * without this header, clicking "Go renew" would send the full referring URL,
 * token included, to kollegierneskontor.dk and whatever analytics it runs.
 * `rel="noreferrer"` on the anchor covers the click; this covers everything else
 * the page might ever fetch.
 *
 * `no-store` keeps a token out of shared caches and corporate proxies.
 * `noindex, nofollow` keeps it out of a search index if the URL ever leaks.
 * The CSP is defence in depth behind the escaping: `default-src 'none'` means an
 * injected `<script>` or `<img>` has nowhere to load from and nowhere to send to,
 * and `form-action 'self'` stops one posting the token elsewhere.
 */
const html = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });

/**
 * Pinned, for the reason `RENEWAL_COLUMNS` and `MAIL_COLUMNS` are pinned: a column
 * name inside a string is invisible to `tsc`, and PostgREST rejects an unknown
 * column outright (42703) rather than ignoring it — so a rename takes the page
 * down with a 500 on the one surface that must work on the last day before a
 * deletion.
 */
const SELECT =
  "id,user_id,list_name,signed_up_at,last_renewed_at,renewal_interval_months," +
  "reminder_lead_days,renewal_url,last_reminded_at,ack_token,position,notes";

interface PositionRow extends RenewalPositionRow {
  user_id: string;
}

/** Build the view model. Pure apart from the clock, which is passed in. */
function buildView(row: PositionRow, nowMs: number): RenewView {
  const today = todayInTz(nowMs);
  const due = renewalDueDate(row);
  return {
    listName: row.list_name ?? null,
    dueAt: due === null ? null : formatYmd(due),
    daysLeft: renewalDaysLeft(row, today),
    intervalMonths: parseIntOrNull(row.renewal_interval_months, { min: 1 }),
    renewalUrl: row.renewal_url ?? null,
    lastRenewedAt: row.last_renewed_at ?? null,
    signedUpAt: row.signed_up_at ?? null,
    position: parseIntOrNull(row.position),
    notes: row.notes ?? null,
    token: String(row.ack_token ?? ""),
    today: formatYmd(today),
  };
}

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // Fails closed, same posture as `housing-ingest`. There is no
  // `HOUSING_INGEST_KEY` here on purpose: this endpoint is for a human's browser,
  // and the per-row token is what scopes it — to exactly one waiting-list row, not
  // to the whole pipeline. Handing the browser the ingest secret would hand every
  // reader of that email the ability to write anything `housing-ingest` can.
  if (!url || !serviceKey) {
    console.error("housing-renew: missing configuration");
    return html(renderErrorPage("Unavailable", "This service is not configured."), 500);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const lookup = async (token: string) => {
    const { data, error } = await supabase
      .from("housing_waitlist_positions")
      .select(SELECT)
      // Unique-indexed (`housing_waitlist_ack_token_idx`), which is what makes
      // `maybeSingle()` safe here — without the uniqueness a duplicate would
      // surface as a runtime error on the one page that must not fail.
      .eq("ack_token", token)
      .maybeSingle();
    if (error) {
      console.error("housing-renew: lookup failed —", error.message);
      return { row: null as PositionRow | null, failed: true };
    }
    return { row: (data ?? null) as unknown as PositionRow | null, failed: false };
  };

  // Deliberately identical for "not a uuid" and "no such row": a different message
  // for a well-formed-but-unknown token would confirm the format to someone
  // probing, and there is nothing a legitimate reader can do with the distinction.
  const notFound = () =>
    html(
      renderErrorPage(
        "Link not recognised",
        "This renewal link is not valid. It may have been mistyped, or the waiting-list entry it pointed at has been deleted from the panel.",
      ),
      404,
    );

  // MARK: - GET — render, and mutate NOTHING
  //
  // See the block comment on `renderRenewPage`. Mail scanners prefetch every URL
  // in every message; a mutating GET here would let a robot record a renewal that
  // never happened — pushing the due date a month out, silencing the guard, and
  // letting the list delete him while the panel showed a green row. The entire
  // mutation surface of this function is the POST branch below, and that is a
  // structural property (the renderers hold no client), not a convention.
  if (req.method === "GET" || req.method === "HEAD") {
    const token = new URL(req.url).searchParams.get("token");
    if (!isUuid(token)) return notFound();

    const { row, failed } = await lookup(token);
    if (failed) {
      return html(renderErrorPage("Temporarily unavailable", "Please try again in a moment."), 500);
    }
    if (!row) return notFound();

    return html(renderRenewPage(buildView(row, Date.now())));
  }

  // MARK: - POST — the one place a renewal is recorded
  if (req.method === "POST") {
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return html(renderErrorPage("Could not read that", "The request body was unreadable."), 400);
    }

    const parsed = parseRenewBody(req.headers.get("content-type"), raw);
    if (!parsed.ok) {
      // Includes the `confirm=renewed` check — a bare-URL POST from a link
      // scanner lands here and writes nothing.
      return html(
        renderErrorPage(
          "Could not read that",
          "The confirmation could not be read from the request. Open the link again and press the button on the page.",
        ),
        400,
      );
    }

    const { row, failed } = await lookup(parsed.request.token);
    if (failed) {
      return html(renderErrorPage("Temporarily unavailable", "Please try again in a moment."), 500);
    }
    if (!row) return notFound();

    const nowMs = Date.now();
    const view = buildView(row, nowMs);

    // ## The write, and everything it deliberately is not
    //
    // No status guard in the WHERE, unlike `job-approve`'s
    // `.eq("status", "needs_approval")`. There is no terminal state to guard
    // against: the token is reusable by design, and a second press is a legitimate
    // re-assertion rather than a race to be arbitrated.
    //
    // **Idempotent on the same day.** Two clicks, a browser retry, a second tab —
    // all write the value that is already there. `last_renewed_at` is a `date`, so
    // "renewed twice today" and "renewed once today" are the same row.
    //
    // `last_reminded_at` is cleared, and that is not housekeeping: it starts a
    // fresh reminder cycle. Leaving it would let the three-day throttle suppress
    // the *next* cycle's first reminder, which on a monthly list is a third of the
    // remaining margin.
    const { data: updated, error: updateError } = await supabase
      .from("housing_waitlist_positions")
      .update({ last_renewed_at: view.today, last_reminded_at: null })
      .eq("id", row.id)
      .select("id")
      .maybeSingle();

    if (updateError) {
      console.error("housing-renew: renewal update failed —", updateError.message);
      return html(
        renderErrorPage(
          "Not recorded",
          "Your renewal could not be saved. If you did renew on the provider's site, that still counts — this only failed to record it here, and you will be reminded again.",
        ),
        500,
      );
    }

    if (!updated) {
      // The row vanished between the lookup and the update. Nothing was written,
      // and saying so is better than a confirmation that would suppress reminders
      // for a row that no longer exists to remind about.
      return notFound();
    }

    return html(renderRenewedPage(view, nextDueAfter(view.today, view.intervalMonths)));
  }

  return html(
    renderErrorPage(
      "Not allowed",
      "This link only supports viewing and confirming a renewal.",
    ),
    405,
  );
});
