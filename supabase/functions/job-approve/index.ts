import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  type ApprovalView,
  deadlinePassed,
  decideTransition,
  isUuid,
  parseDecisionBody,
  renderErrorPage,
  renderResultPage,
  renderReviewPage,
} from "./logic.ts";

/**
 * job-approve — the human decision point of the job applier.
 *
 * A link in a decision email opens this page; the person reads the letter that
 * would be sent and clicks Approve or Reject. It is the ONLY thing that can move
 * an application from `needs_approval` to `approved`, and `job-ingest`'s
 * `apply_queue` will only ever send something that is `approved`. That chain is
 * the whole of the invariant: **nothing is ever sent without an explicit human
 * approval.**
 *
 * # Why this is not part of job-ingest
 *
 * `job-ingest` is a machine-to-machine endpoint: POST only, `X-Job-Key` on every
 * request, JSON in and JSON out. This is a *browser* endpoint: it answers GET, it
 * returns HTML, and the person opening it has no session, no key and no Supabase
 * cookie — they have an email in an inbox on whatever device was nearest. Bolting
 * an unauthenticated HTML branch onto a function whose first invariant is "POST
 * only, 405 otherwise" would mean weakening the exact rule that keeps the other
 * one safe.
 *
 * # Authentication: the token IS the credential
 *
 * ⚠️ **Deploy with `--no-verify-jwt`.** Supabase's default gateway check rejects
 * a request with no `Authorization` header before this code runs, and a person
 * clicking a link in Gmail has no bearer token. With the default on, every review
 * link returns 401 and the entire approval path is dead — with no error in this
 * function's logs, because it is never invoked.
 *
 * What stands in for a session is `job_applications.approval_token`: a v4 uuid
 * from `gen_random_uuid()` (pgcrypto's CSPRNG), 122 bits, unique-indexed. It is
 * not guessable and not enumerable.
 *
 * Three deliberate non-properties, each of which looks like an oversight:
 *
 * - **No constant-time comparison.** The comparison is a Postgres index lookup;
 *   there is no way to make it constant-time, and no need — timing an index probe
 *   over the public internet does not recover 122 bits. `job-ingest`'s
 *   `secretMatches` exists because that secret is compared in JS against a short,
 *   long-lived, reused value. This one is neither.
 * - **No rate limiting here.** Supabase's platform limits are what bound request
 *   volume. Adding a counter in this function would need shared state it does not
 *   have, and would defend a search space that cannot be searched.
 * - **No expiry.** The token stops being able to WRITE the moment the status
 *   leaves `needs_approval` — that is the single-use mechanism. It keeps working
 *   as a READ credential forever on purpose: a link that 404s after you click it
 *   reads as "did that work?", and an unsure human clicks again.
 *
 * # GET never mutates
 *
 * See the block comment on `renderReviewPage`. Mail providers prefetch every link
 * in every message; a mutating GET would hand approval to a malware scanner. The
 * renderer is a pure function of a view model and holds no client, which is the
 * structural version of that rule rather than a promise about it.
 *
 * # Everything rendered is untrusted
 *
 * Job title, company, location, the ad's own text and the model's reasoning are
 * all stranger-written or model-written. Every interpolation goes through
 * `escapeHtml`, the page loads no external resource, and the CSP below forbids
 * one anyway.
 */

/**
 * Response headers, and every one of them earns its place.
 *
 * `Referrer-Policy: no-referrer` is the load-bearing one. **The token is in the
 * URL**, and the review page links out to the original job posting — without this
 * header, clicking that link sends the full referring URL, token included, to the
 * employer's web server and whatever analytics it runs. `rel="noreferrer"` on the
 * anchor covers the click; this covers everything else the page might ever fetch.
 *
 * `no-store` keeps a token out of shared caches and corporate proxies.
 * `noindex, nofollow` keeps it out of a search index if the URL ever leaks.
 * The CSP is defence in depth behind the escaping: `default-src 'none'` means an
 * injected `<script>` or `<img>` has nowhere to load from and nowhere to send
 * to, and `form-action 'self'` stops one posting the token elsewhere.
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

const SELECT =
  "id,user_id,posting_id,profile_id,status,body,missing_slots,approval_token," +
  "job_postings(id,title,company,location,url,apply_channel,apply_email,valid_through)," +
  "job_profiles(id,name)";

interface AppRow {
  id: string;
  user_id: string;
  posting_id: string;
  profile_id: string;
  status: string;
  body: string | null;
  missing_slots: string[] | null;
  approval_token: string;
  job_postings: {
    id?: string | null;
    title?: string | null;
    company?: string | null;
    location?: string | null;
    url?: string | null;
    apply_channel?: string | null;
    apply_email?: string | null;
    valid_through?: string | null;
  } | null;
  job_profiles: { id?: string | null; name?: string | null } | null;
}

type Client = ReturnType<typeof createClient>;

/**
 * Build the view model for one application.
 *
 * The verdict lives on `job_matches`, which `job_applications` has no FK to —
 * both hang off `(posting_id, profile_id)` independently — so it is a second
 * query rather than an embed, the same as `job-ingest`'s `notify_queue`.
 *
 * The CV check is the same one `apply_queue` runs, deliberately duplicated in
 * *reading* only: this page predicts, `apply_queue` decides. A prediction that
 * disagrees with the decision is a cosmetic bug; a page that made the decision
 * would be a second sender.
 */
async function buildView(supabase: Client, row: AppRow): Promise<ApprovalView> {
  const [match, cvModules] = await Promise.all([
    supabase
      .from("job_matches")
      .select("score,reasoning,matched_skills,missing_skills")
      .eq("user_id", row.user_id)
      .eq("posting_id", row.posting_id)
      .eq("profile_id", row.profile_id)
      .maybeSingle(),
    supabase
      .from("job_app_modules")
      .select("content")
      .eq("user_id", row.user_id)
      .eq("enabled", true)
      .ilike("slot", "cv_link"),
  ]);

  const m = (match.data ?? {}) as {
    score?: number | null;
    reasoning?: string | null;
    matched_skills?: string[] | null;
    missing_skills?: string[] | null;
  };
  const cvReady = ((cvModules.data ?? []) as { content?: string | null }[]).some((r) => {
    const c = typeof r?.content === "string" ? r.content : "";
    return c.trim().length > 0 && !c.includes("[TODO");
  });

  const p = row.job_postings;
  return {
    status: row.status,
    title: p?.title ?? null,
    company: p?.company ?? null,
    location: p?.location ?? null,
    postingUrl: p?.url ?? null,
    applyChannel: p?.apply_channel ?? null,
    applyEmail: p?.apply_email ?? null,
    validThrough: p?.valid_through ?? null,
    profileName: row.job_profiles?.name ?? null,
    score: typeof m.score === "number" ? m.score : null,
    reasoning: m.reasoning ?? null,
    matchedSkills: Array.isArray(m.matched_skills) ? m.matched_skills : [],
    missingSkills: Array.isArray(m.missing_skills) ? m.missing_skills : [],
    missingSlots: Array.isArray(row.missing_slots) ? row.missing_slots : [],
    body: row.body ?? null,
    token: row.approval_token,
    cvReady,
    nowMs: Date.now(),
  };
}

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  // Fails closed, same posture as `job-ingest`. There is no `JOB_INGEST_KEY`
  // here on purpose: this endpoint is for a human's browser, and the per-row
  // token is what scopes it — to exactly one application, not to the whole
  // pipeline. Handing the browser the ingest secret would hand every reader of
  // that email the ability to write anything `job-ingest` can.
  if (!url || !serviceKey) {
    console.error("job-approve: missing configuration");
    return html(renderErrorPage("Unavailable", "This service is not configured."), 500);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const lookup = async (token: string) => {
    const { data, error } = await supabase
      .from("job_applications")
      .select(SELECT)
      .eq("approval_token", token)
      .maybeSingle();
    if (error) {
      console.error("job-approve: lookup failed —", error.message);
      return { row: null as AppRow | null, failed: true };
    }
    return { row: (data ?? null) as unknown as AppRow | null, failed: false };
  };

  // Deliberately identical for "not a uuid" and "no such application": a
  // different message for a well-formed-but-unknown token would confirm the
  // format to someone probing, and there is nothing a legitimate reader can do
  // with the distinction anyway.
  const notFound = () =>
    html(
      renderErrorPage(
        "Link not recognised",
        "This review link is not valid. It may have been mistyped, or the application it pointed at has been deleted.",
      ),
      404,
    );

  // MARK: - GET — render, and mutate NOTHING
  //
  // Mail scanners prefetch every URL in every message. See the block comment on
  // `renderReviewPage`: the entire mutation surface of this function is the POST
  // branch below, and that is a structural property, not a convention.
  if (req.method === "GET" || req.method === "HEAD") {
    const token = new URL(req.url).searchParams.get("token");
    if (!isUuid(token)) return notFound();

    const { row, failed } = await lookup(token);
    if (failed) {
      return html(renderErrorPage("Temporarily unavailable", "Please try again in a moment."), 500);
    }
    if (!row) return notFound();

    return html(renderReviewPage(await buildView(supabase, row)));
  }

  // MARK: - POST — the one place a decision is recorded
  if (req.method === "POST") {
    let raw: string;
    try {
      raw = await req.text();
    } catch {
      return html(renderErrorPage("Could not read that", "The request body was unreadable."), 400);
    }

    const parsed = parseDecisionBody(req.headers.get("content-type"), raw);
    if (!parsed.ok) {
      return html(
        renderErrorPage("Could not read that", "The decision could not be read from the request."),
        400,
      );
    }

    const { row, failed } = await lookup(parsed.request.token);
    if (failed) {
      return html(renderErrorPage("Temporarily unavailable", "Please try again in a moment."), 500);
    }
    if (!row) return notFound();

    const view = await buildView(supabase, row);
    const transition = decideTransition(
      row.status,
      parsed.request.decision,
      deadlinePassed(view.validThrough, view.nowMs),
    );

    // Already decided — by an earlier click, another tab, or a link scanner
    // following the form action. Show the state; write nothing.
    if (!transition.next) return html(renderResultPage("not_pending", view));

    const nowIso = new Date().toISOString();
    const patch: Record<string, unknown> =
      transition.outcome === "approved"
        ? { status: "approved", approved_at: nowIso, approved_via: "email_link" }
        : transition.outcome === "expired"
        ? { status: "expired", fail_reason: "valid_through_passed" }
        : { status: "cancelled" };

    // The guard that makes this token single-use. `status = 'needs_approval'` in
    // the WHERE, not in an `if` above it: two clicks a second apart both pass the
    // read, and only the UPDATE can decide which one wins.
    const { data: moved, error: updateError } = await supabase
      .from("job_applications")
      .update(patch)
      .eq("id", row.id)
      .eq("status", "needs_approval")
      .select("id,status")
      .maybeSingle();

    if (updateError) {
      console.error("job-approve: decision update failed —", updateError.message);
      return html(
        renderErrorPage(
          "Not recorded",
          "Your decision could not be saved. Nothing has been sent; please try again.",
        ),
        500,
      );
    }

    if (!moved) {
      // Lost the race. The other click's outcome is authoritative; re-read it
      // rather than reporting ours, so two tabs never disagree about what happened.
      const { row: fresh } = await lookup(parsed.request.token);
      return html(
        renderResultPage("not_pending", { ...view, status: fresh?.status ?? row.status }),
      );
    }

    return html(renderResultPage(transition.outcome, { ...view, status: String(moved.status) }));
  }

  return html(
    renderErrorPage("Not allowed", "This link only supports viewing and submitting a decision."),
    405,
  );
});
