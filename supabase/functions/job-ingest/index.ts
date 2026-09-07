import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  type ApplyCandidate,
  assembleApplication,
  cvGateReady,
  cvUrlFromModules,
  DAILY_SUBMIT_CAP,
  dedupeWithinBatch,
  MAX_POSTINGS,
  type MatchInput,
  type ModuleRow,
  normalizeModulePlan,
  type NotifyDraftRow,
  type NotifyMatchRow,
  APPLY_SCAN,
  NOTIFY_SCAN,
  parseApplyLimit,
  parseApplyResult,
  parseBody,
  parseEvaluateResult,
  parseNotifyLimit,
  parseNotifyResult,
  parsePendingLimit,
  planApplyQueue,
  type PostingRow,
  secretIsUsable,
  secretMatches,
  selectNotifyCandidates,
  utcDayStart,
} from "./logic.ts";

/**
 * job-ingest — the only write path into `job_postings` and `job_matches`.
 *
 * # Why this exists
 *
 * Discovery runs entirely on the Mac: n8n reads a Jobindex RSS feed and TheHub's
 * sitemap, fetches each ad, extracts it, screens it against a rule-only gate and
 * (later) scores it with a local Qwen. The result has to reach a header panel
 * served from Vercel and read on a phone, neither of which can address
 * `http://localhost:5678`. So n8n pushes here and every client reads a table.
 *
 * # Security — the same five invariants as `n8n-ingest` and `habit-toggle`
 *
 * 1. POST only; anything else is 405.
 * 2. Fails closed. A missing or under-32-character `JOB_INGEST_KEY` is
 *    `500 server_misconfigured`, never "allow everyone" — an empty env var
 *    deploys perfectly cleanly and would make `X-Job-Key: ""` a valid credential.
 * 3. Constant-time comparison of the presented key.
 * 4. Service-role client, so the write does not depend on any RLS policy.
 * 5. Server-side owner check. The service role BYPASSES RLS, so `user_id` is
 *    enforced here or it is not enforced at all — every row is stamped with the
 *    verified id from the body, and the id is confirmed to be a real user first.
 *
 * The header is `X-Job-Key`; the secret is `JOB_INGEST_KEY`. `Headers.get()` is
 * case-insensitive per spec, so the lowercase lookup accepts any casing n8n's
 * credential happens to be saved with.
 *
 * # Actions
 *
 * One endpoint, dispatched on `action`, because every one of them needs the same
 * secret and the same owner check and n8n gets exactly one credential.
 *
 * | action | direction | does |
 * |---|---|---|
 * | *(none)* | n8n -> here | the harvest batch: upsert postings + gate verdicts |
 * | `config` | here -> n8n | enabled profiles, sources and the seen-set |
 * | `pending` | here -> n8n | gated-but-unscored matches + the module catalog |
 * | `evaluate_result` | n8n -> here | one Qwen verdict; assembles the draft |
 * | `notify_queue` | here -> n8n | drafts scoring above the profile threshold |
 * | `notify_result` | n8n -> here | the decision email went out (or did not) |
 * | `apply_queue` | here -> n8n | APPROVED applications that re-passed every guard |
 * | `apply_result` | n8n -> here | Gmail's verdict + the proof of what was sent |
 *
 * `pending` and `evaluate_result` are phase 2 (`n8n/job-applier/EVALUATION.md`).
 * The application body is assembled HERE and nowhere else — the module prose
 * never leaves this database, so n8n could not assemble it even if it tried.
 *
 * The last four are phase 3, and they implement one invariant: **nothing is ever
 * sent without an explicit human approval.** `notify_queue` asks, `job-approve`
 * records the answer, and `apply_queue` is the ONLY producer of sendable work —
 * it reads `status = 'approved'` and nothing else, so there is no path from a
 * high score to an outbound email that does not pass through a click. The guards
 * it re-runs at send time are in `logic.ts`; the reasoning for each is there.
 *
 * There is no `reply` action, and there deliberately never will be. The last
 * transition — `submitted` -> `response`, when an employer answers — happens in
 * the DATABASE, on a trigger over `mail_messages`, because the mail pipeline
 * already reads the inbox on its own schedule and a second poller asking Gmail
 * the same question would be a second Gmail credential to keep alive. See
 * `supabase/migrations/20260826150000_job_reply_loop.sql`.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const expected = Deno.env.get("JOB_INGEST_KEY") ?? "";

  if (!url || !serviceKey || !secretIsUsable(expected)) {
    console.error("job-ingest: missing or unusable configuration");
    return json({ error: "server_misconfigured" }, 500);
  }
  if (!secretMatches(req.headers.get("x-job-key") ?? "", expected)) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const supabaseEarly = createClient(url, serviceKey, { auth: { persistSession: false } });

  // MARK: - action: config
  //
  // n8n needs the enabled profiles and sources in order to run the gate, but it
  // has no session and therefore cannot satisfy `auth.uid()` against these
  // RLS-scoped tables. The alternative — handing n8n a service-role key — would
  // put a key that bypasses RLS on every table in this project inside a Docker
  // container, to read four columns. Serving config through the same scoped
  // secret keeps the blast radius at "this user's job search".
  //
  // It also keeps `job_profiles` honest as the modularity surface: the workflow
  // stays a dumb pipe and adding a fourth profile remains an insert, not a
  // workflow edit.
  const asRecord = (body ?? {}) as Record<string, unknown>;
  if (asRecord.action === "config") {
    const uid = asRecord.user_id;
    if (typeof uid !== "string") return json({ error: "invalid_user_id" }, 400);

    const [profiles, sources, recent] = await Promise.all([
      supabaseEarly.from("job_profiles").select("*").eq("user_id", uid).eq("enabled", true),
      supabaseEarly.from("job_sources").select("*").eq("user_id", uid).eq("enabled", true),
      // The seen-set for cheap dedup before any page is fetched. Bounded: this is
      // an optimisation, and the unique index is what actually guarantees
      // correctness. A short list simply means a few wasted fetches, never a
      // duplicate row.
      supabaseEarly
        .from("job_postings")
        .select("source_kind,external_id,url")
        .eq("user_id", uid)
        .order("discovered_at", { ascending: false })
        .limit(2000),
    ]);

    const failed = profiles.error ?? sources.error ?? recent.error;
    if (failed) {
      console.error("job-ingest: config read failed —", failed.message);
      return json({ error: "config_failed", detail: failed.message }, 500);
    }
    type SeenRow = { source_kind: string; external_id: string; url: string };
    const seenRows = (recent.data ?? []) as SeenRow[];
    return json({
      ok: true,
      profiles: profiles.data ?? [],
      sources: sources.data ?? [],
      seen: seenRows.map((r) => `${r.source_kind} ${r.external_id}`),
      seen_urls: seenRows.map((r) => r.url),
    });
  }

  // MARK: - action: pending
  //
  // The evaluation queue. Everything that passed the rule-only gate and has
  // never been scored, oldest first, with everything one inference needs
  // attached: the ad, the profile it is being judged against, and the module
  // catalog to choose from.
  //
  // ## Three things this returns deliberately
  //
  // **Modules WITHOUT `content`.** The prompt matches on `tags`, not prose, so
  // the prose has no reason to travel. It keeps the context small — a dozen
  // modules is easily more text than the ad — and keeps a person's writing about
  // their own career inside Postgres, which is the same instinct that gives
  // `usage_intervals` no anon policy.
  //
  // **`score IS NULL` AND `evaluated_at IS NULL` both.** Either alone is a
  // different question. A row with a timestamp and no score is one the model
  // failed on; re-queuing it forever would make one unparseable response into an
  // infinite loop against a 7B model that will fail it again.
  //
  // **An empty list is `{ok: true, pending: []}`, not an error.** "Nothing to
  // evaluate" is the normal steady state, and a workflow that treats it as a
  // failure would report a red run every 30 minutes.
  if (asRecord.action === "pending") {
    const uid = asRecord.user_id;
    if (typeof uid !== "string") return json({ error: "invalid_user_id" }, 400);
    const limit = parsePendingLimit(asRecord.limit);

    const [matches, modules] = await Promise.all([
      supabaseEarly
        .from("job_matches")
        .select(
          "id,posting_id,profile_id,gate_verdict," +
            "job_postings(id,title,company,location,description,url,lang)," +
            "job_profiles(id,name,keywords,notes)",
        )
        .eq("user_id", uid)
        .eq("gate_verdict", "pass")
        .is("score", null)
        .is("evaluated_at", null)
        .order("created_at", { ascending: true })
        .limit(limit),
      supabaseEarly
        // `tags` and `lang` are not decoration: they are what picks the intro and
        // the closing (see FRAMING in logic.ts). Without `lang` the two closings
        // are indistinguishable; without `tags` all five intros tie on sort = 0
        // and the choice collapses to alphabetical. Still no `content`.
        .from("job_app_modules")
        .select("id,name,slot,tags,lang,sort")
        .eq("user_id", uid)
        .eq("enabled", true)
        .order("sort", { ascending: true })
        .order("name", { ascending: true }),
    ]);

    const failed = matches.error ?? modules.error;
    if (failed) {
      console.error("job-ingest: pending read failed —", failed.message);
      return json({ error: "pending_failed", detail: failed.message }, 500);
    }

    type PendingRow = {
      id: string;
      posting_id: string;
      profile_id: string;
      job_postings: unknown;
      job_profiles: unknown;
    };
    const catalog = modules.data ?? [];
    const pending = ((matches.data ?? []) as unknown as PendingRow[]).map((m) => ({
      match_id: m.id,
      posting_id: m.posting_id,
      profile_id: m.profile_id,
      posting: m.job_postings ?? null,
      profile: m.job_profiles ?? null,
      // Repeated per item on purpose: n8n splits `pending` into one item per
      // posting, and an item that cannot see the catalog cannot build a prompt.
      modules: catalog,
    }));

    return json({ ok: true, pending, modules: catalog });
  }

  // MARK: - action: evaluate_result
  //
  // One posting's verdict, coming back from the local Qwen via n8n. Writes the
  // score onto `job_matches` and ASSEMBLES the application here, server-side —
  // see the block comment in `logic.ts` for why this is the canonical assembler
  // and `evaluate.js`'s is a dry-run preview.
  if (asRecord.action === "evaluate_result") {
    const parsedResult = parseEvaluateResult(body);
    if (!parsedResult.ok) return json({ error: parsedResult.error }, 400);
    const v = parsedResult.result;

    // Invariant 5, and the only place it can be enforced: the service-role client
    // bypasses RLS, so a caller holding `JOB_INGEST_KEY` could otherwise stamp a
    // score onto any match in the database. Match id AND user id together.
    const { data: match, error: matchError } = await supabaseEarly
      .from("job_matches")
      .select("id,posting_id,profile_id")
      .eq("id", v.matchId)
      .eq("user_id", v.userId)
      .maybeSingle();

    if (matchError) {
      console.error("job-ingest: match lookup failed —", matchError.message);
      return json({ error: "match_lookup_failed", detail: matchError.message }, 500);
    }
    if (!match) return json({ error: "unknown_match" }, 404);

    // The user's own enabled modules, with content — the only place `content` is
    // ever read. Chosen ids are validated against THIS list, never against the
    // list n8n claims to have filtered.
    const { data: moduleRows, error: moduleError } = await supabaseEarly
      .from("job_app_modules")
      .select("id,name,slot,tags,lang,sort,content")
      .eq("user_id", v.userId)
      .eq("enabled", true);

    if (moduleError) {
      console.error("job-ingest: module read failed —", moduleError.message);
      return json({ error: "modules_failed", detail: moduleError.message }, 500);
    }

    const catalog = (moduleRows ?? []) as ModuleRow[];
    // Score, language and skills are what decide the intro and the closing. n8n
    // already framed the plan it posted; re-deriving here is idempotent and means
    // a plan from an older workflow — or from `curl` — comes out framed too.
    const plan = normalizeModulePlan(v.rawModulePlan, catalog, {
      score: v.score,
      lang: v.lang,
      skills: [...v.matchedSkills, ...v.requiredSkills],
    });

    const { error: updateError } = await supabaseEarly
      .from("job_matches")
      .update({
        score: v.score,
        required_skills: v.requiredSkills,
        matched_skills: v.matchedSkills,
        missing_skills: v.missingSkills,
        reasoning: v.reasoning,
        model: v.model,
        module_plan: plan,
        // A timestamp beside a null score would read as "we looked and had
        // nothing to say", which is exactly the state the nullable column exists
        // to keep distinct. Same rule as `normalizeMatch`.
        evaluated_at: v.score === null ? null : new Date().toISOString(),
      })
      .eq("id", v.matchId)
      .eq("user_id", v.userId);

    if (updateError) {
      console.error("job-ingest: match update failed —", updateError.message);
      return json({ error: "match_update_failed", detail: updateError.message }, 500);
    }

    // No score means the model failed on this one. Storing a draft assembled from
    // a plan nobody scored would put a document in the queue that looks reviewed.
    if (v.score === null) {
      return json({ ok: true, match_id: v.matchId, score: null, application: null });
    }

    const { data: posting, error: postingError } = await supabaseEarly
      .from("job_postings")
      .select("id,title,company,status")
      .eq("id", match.posting_id)
      .eq("user_id", v.userId)
      .maybeSingle();

    if (postingError || !posting) {
      console.error("job-ingest: posting read failed —", postingError?.message ?? "not found");
      return json({ error: "posting_read_failed" }, 500);
    }

    const assembled = assembleApplication(plan, catalog, posting);

    // ## The application write NEVER regresses a status
    //
    // This was one unconditional upsert carrying `status: "draft"`, which meant a
    // re-evaluation of a posting whose letter was already in `needs_approval`,
    // `approved` or `submitted` walked it back to `draft`. The row then left every
    // queue view — `notify_queue` filters on `approval_requested_at is null` and
    // so did not re-ask, `apply_queue` reads `status = 'approved'` and so no longer
    // saw it — and the state machine had run backwards with nothing to show for it.
    // Combined with the harvest clobber above (which is what caused the
    // re-evaluations in the first place), every application in the queue walked
    // back to draft over the Aug 26 → Sep 3 run.
    //
    // The rule: **a letter that has left `draft` is immutable from the evaluation
    // side.** Once a human has been asked about a body, or has approved one, that
    // exact text is what the decision was about; silently re-assembling it from a
    // catalog that has since changed would make the approval a lie. Refreshing the
    // content of a row that is *still* a draft is fine — nobody has seen it yet.
    //
    //   no row            -> insert as draft
    //   status = 'draft'  -> refresh body / module_ids / missing_slots, stay draft
    //   any other status  -> touch nothing, report `application_frozen: true`
    //
    // Both writes are guarded so a race cannot regress either: the insert is
    // DO NOTHING on conflict, and the update carries `.eq("status", "draft")` so a
    // row that moved on between the read and the write is left alone.
    const { data: existingApp, error: existingAppError } = await supabaseEarly
      .from("job_applications")
      .select("id,status")
      .eq("user_id", v.userId)
      .eq("posting_id", match.posting_id)
      .eq("profile_id", match.profile_id)
      .maybeSingle();

    if (existingAppError) {
      // Same reasoning as the write failures below: the score is stored, so 207
      // rather than 500. Writing blind after a failed read is the one thing not
      // allowed here — it is exactly how the status regression happened.
      console.error("job-ingest: application read failed —", existingAppError.message);
      return json(
        {
          ok: false,
          error: "application_failed",
          detail: existingAppError.message,
          match_id: v.matchId,
        },
        207,
      );
    }

    const draftFields = {
      body: assembled.body,
      module_ids: assembled.module_ids,
      missing_slots: assembled.missing_slots,
    };

    let applicationId: string | null = existingApp?.id ?? null;
    let applicationFrozen = false;

    if (!existingApp) {
      const { data: inserted, error: insertError } = await supabaseEarly
        .from("job_applications")
        .upsert(
          {
            user_id: v.userId,
            posting_id: match.posting_id,
            profile_id: match.profile_id,
            ...draftFields,
            status: "draft",
          },
          // DO NOTHING, not DO UPDATE: if a concurrent verdict for the sibling
          // profile inserted this row between the read above and here, losing the
          // race must cost nothing rather than overwrite a status.
          { onConflict: "posting_id,profile_id", ignoreDuplicates: true },
        )
        .select("id")
        .maybeSingle();

      if (insertError) {
        // The score landed. Say so rather than 500-ing, which would make n8n resend
        // a verdict that is already stored — and the match is no longer `pending`,
        // so the resend would be the last chance to notice this at all.
        console.error("job-ingest: application insert failed —", insertError.message);
        return json(
          {
            ok: false,
            error: "application_failed",
            detail: insertError.message,
            match_id: v.matchId,
          },
          207,
        );
      }

      if (inserted) {
        applicationId = inserted.id;
      } else {
        // Nothing came back, so the conflict fired: the row exists and we did not
        // write it. Re-read to answer honestly with its id and whether it is
        // frozen. A row this fresh is whatever the winner made it — if it is a
        // draft it already holds this same assembly, so there is nothing to
        // refresh.
        const { data: raced } = await supabaseEarly
          .from("job_applications")
          .select("id,status")
          .eq("user_id", v.userId)
          .eq("posting_id", match.posting_id)
          .eq("profile_id", match.profile_id)
          .maybeSingle();
        applicationId = raced?.id ?? null;
        applicationFrozen = Boolean(raced && raced.status !== "draft");
      }
    } else if (existingApp.status === "draft") {
      const { data: updated, error: updateAppError } = await supabaseEarly
        .from("job_applications")
        .update(draftFields)
        .eq("id", existingApp.id)
        .eq("user_id", v.userId)
        // The race guard. Without it, a row approved between the read and this
        // write would have its reviewed body replaced underneath the approval.
        .eq("status", "draft")
        .select("id")
        .maybeSingle();

      if (updateAppError) {
        console.error("job-ingest: application update failed —", updateAppError.message);
        return json(
          {
            ok: false,
            error: "application_failed",
            detail: updateAppError.message,
            match_id: v.matchId,
          },
          207,
        );
      }
      // No row updated means the guard bit — it left `draft` mid-flight. That is
      // the correct outcome, and it is a freeze, not a failure.
      if (!updated) applicationFrozen = true;
    } else {
      // needs_approval / approved / queued / submitted / dismissed — under review,
      // decided, or already sent. Not ours to rewrite.
      applicationFrozen = true;
    }

    // First score for this posting flips it out of 'discovered'. Guarded on the
    // old value so a second profile's verdict cannot walk back a status a human
    // has since moved on ('applied', 'dismissed').
    if (posting.status === "discovered") {
      const { error: statusError } = await supabaseEarly
        .from("job_postings")
        .update({ status: "evaluated" })
        .eq("id", match.posting_id)
        .eq("user_id", v.userId)
        .eq("status", "discovered");
      if (statusError) {
        // Cosmetic. The score and the draft are both stored; do not fail the run.
        console.error("job-ingest: posting status update failed —", statusError.message);
      }
    }

    // `module_ids` / `missing_slots` describe THIS assembly, which is what was
    // stored only when the draft was actually written. `application_frozen` is
    // what says whether it was — without it a caller would read the two arrays as
    // the state of the stored letter, and for a row under review they are not.
    return json({
      ok: true,
      match_id: v.matchId,
      score: v.score,
      application_id: applicationId,
      application_frozen: applicationFrozen,
      module_ids: assembled.module_ids,
      missing_slots: assembled.missing_slots,
    });
  }

  // MARK: - action: notify_queue
  //
  // Drafts good enough to be worth a human's attention. n8n turns each item into
  // ONE decision email carrying the full letter and a review link.
  //
  // ## The queue predicate is `approval_requested_at IS NULL`, not the status
  //
  // Both are checked, but the timestamp is the one that matters. A status can be
  // written by anything; a null timestamp is a claim about the world — no email
  // has ever gone out for this application. If a bug or a hand-edit walked a row
  // back to `draft` after its email had been sent, the status test alone would
  // send a second one, and two review links for one application means two tokens
  // that both still work. `notify_result` stamps the timestamp, and nothing
  // clears it.
  //
  // Empty is `{ok: true, notify: []}`, never an error. Most polls find nothing:
  // the threshold is set so a *rare* email is the healthy steady state, and a
  // workflow that reported red on "nothing to ask about" would be red all week.
  //
  // ## One posting, one decision email
  //
  // Applications are keyed `(posting_id, profile_id)`, so one ad matching two
  // profiles is two drafts — correctly, they are two different letters. They are
  // still ONE JOB, and two decision emails for one job means two live review
  // tokens and, if the human says yes twice, two applications to the same company.
  //
  // So: `collapseByPosting` keeps the single best draft per posting within a
  // response, and the `askedPostingIds` read below keeps the losers out of every
  // LATER response — a posting with any sibling already carrying
  // `approval_requested_at` is done being asked about. The losing drafts stay
  // `draft` with a null timestamp: inert, intact, still visible in the panel.
  // Approving the emailed one is approving the job.
  if (asRecord.action === "notify_queue") {
    const uid = asRecord.user_id;
    if (typeof uid !== "string") return json({ error: "invalid_user_id" }, 400);
    const limit = parseNotifyLimit(asRecord.limit);

    const { data: draftRows, error: draftError } = await supabaseEarly
      .from("job_applications")
      .select(
        "id,posting_id,profile_id,body,missing_slots,approval_token," +
          "job_postings(id,title,company,location,url,apply_channel,apply_email,valid_through)," +
          // `sort` is the collapse's first tie-break. Without it in the embed the
          // pure function defaults every profile to 0 and the tie falls through to
          // the name, which is a different (still deterministic) winner.
          //
          // The four expected_* columns are pure passthrough onto
          // `NotifyItem.expected_pay` (see `selectNotifyCandidates`) — nothing here
          // branches on them, they just need to be in the embed to reach it.
          "job_profiles(id,name,approval_threshold,sort," +
          "expected_monthly_min,expected_monthly_max,expected_hourly_min,expected_hourly_max)",
      )
      .eq("user_id", uid)
      .eq("status", "draft")
      .is("approval_requested_at", null)
      // Oldest first so a backlog drains in order rather than starving on the
      // score sort, which is applied AFTER the join (see selectNotifyCandidates).
      .order("created_at", { ascending: true })
      .limit(NOTIFY_SCAN);

    if (draftError) {
      console.error("job-ingest: notify draft read failed —", draftError.message);
      return json({ error: "notify_queue_failed", detail: draftError.message }, 500);
    }

    const drafts = (draftRows ?? []) as unknown as NotifyDraftRow[];
    // Nothing to ask about: return before the three reads below, `cv_url`
    // included. It is a field ON a notification, and with no notifications there
    // is nothing for it to be on — so it is *not computed*, not reported null. A
    // null here would be the only case where the field means "we did not look".
    if (drafts.length === 0) return json({ ok: true, notify: [] });

    const postingIds = [...new Set(drafts.map((d) => d.posting_id))];

    const [matchRows, askedRows, cvRows] = await Promise.all([
      // The verdicts. Separate query because `job_applications` has no FK to
      // `job_matches` — they hang off `(posting_id, profile_id)` independently, and
      // PostgREST has no relationship to embed through.
      supabaseEarly
        .from("job_matches")
        .select("posting_id,profile_id,score,reasoning,matched_skills,missing_skills")
        .eq("user_id", uid)
        .in("posting_id", postingIds),
      // The suppression set: postings some profile's application has ALREADY been
      // emailed about. Note this deliberately does not filter on status — the
      // question is "has an email gone out about this job", and the answer stays
      // yes whether that application is now approved, submitted or cancelled.
      // `approval_requested_at` is the one column nothing clears.
      supabaseEarly
        .from("job_applications")
        .select("posting_id")
        .eq("user_id", uid)
        .in("posting_id", postingIds)
        .not("approval_requested_at", "is", null),
      // The CV link, for the ATS forms most of these applications actually end in
      // (see "The CV link as a FIELD" in logic.ts). `content` is read HERE and
      // nowhere near the prompt path: `action: "pending"` stays content-free by
      // design, because that catalog is what gets pasted into a model's context.
      // This one is read to pull a URL out of a paragraph the user wrote, and the
      // paragraph never leaves the function.
      supabaseEarly
        .from("job_app_modules")
        .select("id,name,slot,sort,content")
        .eq("user_id", uid)
        .eq("enabled", true)
        // `ilike`, not `eq`: a slot typed 'CV_Link' is the same slot. Mirrors the
        // read `apply_queue` does for the send gate.
        .ilike("slot", "cv_link"),
    ]);

    const notifyReadFailed = matchRows.error ?? askedRows.error;
    if (notifyReadFailed) {
      console.error("job-ingest: notify match read failed —", notifyReadFailed.message);
      return json({ error: "notify_queue_failed", detail: notifyReadFailed.message }, 500);
    }

    // A failed CV read is NOT a failed queue. The link is an extra affordance on
    // an email that is perfectly useful without it, and 500-ing the whole poll
    // over it would stop a human being asked about work that is ready to send.
    // Absent is absent, exactly as when no module exists.
    if (cvRows.error) {
      console.error("job-ingest: cv_link read failed —", cvRows.error.message);
    }
    const cvUrl = cvUrlFromModules((cvRows.data ?? []) as ModuleRow[]);

    const askedPostingIds = new Set(
      ((askedRows.data ?? []) as { posting_id: string }[]).map((r) => r.posting_id),
    );

    return json({
      ok: true,
      // Also top-level, so a workflow that needs the link outside the per-item
      // loop can see it — including when the threshold and the per-posting
      // collapse leave `notify` empty. (The no-drafts-at-all path returns above
      // and carries no `cv_url` at all: there, we never looked.)
      cv_url: cvUrl,
      notify: selectNotifyCandidates(drafts, (matchRows.data ?? []) as NotifyMatchRow[], {
        limit,
        cvUrl,
        // Built server-side. n8n never composes this URL: the token is the only
        // credential the review page has, and a workflow assembling the link is a
        // workflow that can get the origin wrong and mail a dead one.
        supabaseUrl: url,
        notifiedPostingIds: askedPostingIds,
      }),
    });
  }

  // MARK: - action: notify_result
  //
  // The email went out (or did not). `ok: true` is the transition that makes an
  // application eligible for a human decision at all.
  //
  // A FAILED send leaves the row completely untouched — same status, still a null
  // `approval_requested_at` — so the next poll picks it up again. That is the
  // whole retry mechanism, and it is why this reports rather than throws: an
  // application nobody was asked about must stay in the queue, not become a
  // silently stalled row that looks decided.
  //
  // The transition is guarded on `status = 'draft'` in the UPDATE itself. Without
  // that, a slow notify workflow finishing after a human has already approved
  // through an earlier email would drag `approved` back to `needs_approval` — a
  // state machine that can run backwards is not one.
  if (asRecord.action === "notify_result") {
    const parsedNotify = parseNotifyResult(body);
    if (!parsedNotify.ok) return json({ error: parsedNotify.error }, 400);
    const n = parsedNotify.result;

    if (!n.ok) {
      // Nothing is written. Deliberately: see above.
      console.error("job-ingest: notify send failed for", n.applicationId);
      return json({ ok: true, application_id: n.applicationId, status: "draft", updated: false });
    }

    const { data: updated, error: notifyError } = await supabaseEarly
      .from("job_applications")
      .update({ status: "needs_approval", approval_requested_at: new Date().toISOString() })
      .eq("id", n.applicationId)
      // Invariant 5: service role bypasses RLS, so the owner check is this line.
      .eq("user_id", n.userId)
      .eq("status", "draft")
      .select("id,status")
      .maybeSingle();

    if (notifyError) {
      console.error("job-ingest: notify_result update failed —", notifyError.message);
      return json({ error: "notify_result_failed", detail: notifyError.message }, 500);
    }

    // No row matched: either the id is not this user's, or the application has
    // already moved on. Both are `updated: false` rather than an error — the
    // email really was sent, and n8n has nothing useful to do with a 404.
    return json({
      ok: true,
      application_id: n.applicationId,
      status: updated?.status ?? null,
      updated: Boolean(updated),
    });
  }

  // MARK: - action: apply_queue
  //
  // The ONLY producer of sendable work in this system. It reads
  // `status = 'approved'` and nothing else, which is what makes "nothing is sent
  // without a human approval" a structural property rather than a promise.
  //
  // Every guard is re-run here, at send time, against the world as it is now —
  // see `planApplyQueue` in `logic.ts` for what each one is and why a given
  // failure is a skip rather than a terminal state. Approval buys permission, not
  // a verdict: modules get edited, ads expire, and a second profile's application
  // to the same company can go out in between.
  if (asRecord.action === "apply_queue") {
    const uid = asRecord.user_id;
    if (typeof uid !== "string") return json({ error: "invalid_user_id" }, 400);
    const limit = parseApplyLimit(asRecord.limit);
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const dayStart = utcDayStart(nowMs);

    const [approved, cvModules, submittedToday, queuedToday, submittedEver] = await Promise.all([
      supabaseEarly
        .from("job_applications")
        .select(
          "id,body,posting_id," +
            "job_postings(id,title,company,url,apply_channel,apply_email,valid_through,dedupe_key)," +
            "job_profiles(id,name)",
        )
        .eq("user_id", uid)
        .eq("status", "approved")
        // Approved longest ago goes first: a decision a human made on Monday
        // should not sit behind one they made this morning.
        .order("approved_at", { ascending: true, nullsFirst: true })
        .limit(APPLY_SCAN),
      // `ilike` rather than `eq` — `slot` is free text and 'CV_link' is a typo,
      // not a different slot. `cvGateReady` lowercases for the same reason.
      supabaseEarly
        .from("job_app_modules")
        .select("id,slot,content")
        .eq("user_id", uid)
        .eq("enabled", true)
        .ilike("slot", "cv_link"),
      supabaseEarly
        .from("job_applications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("status", "submitted")
        .gte("submitted_at", dayStart),
      // In-flight work counts against the cap too. A row handed to n8n but not yet
      // reported WILL be sent, and a cap that two polls can walk past is not a
      // cap. Bounded to today so a permanently stranded `queued` row — an n8n run
      // the Mac slept through — cannot consume budget forever.
      supabaseEarly
        .from("job_applications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", uid)
        .eq("status", "queued")
        .gte("queued_at", dayStart),
      // Guard 5's input. Statuses are disjoint (`submitted` vs `approved`), so no
      // candidate can appear in its own dedup set.
      supabaseEarly
        .from("job_applications")
        .select("id,job_postings(dedupe_key)")
        .eq("user_id", uid)
        .eq("status", "submitted")
        .limit(2000),
    ]);

    const readFailed =
      approved.error ?? cvModules.error ?? submittedToday.error ?? queuedToday.error ??
        submittedEver.error;
    if (readFailed) {
      console.error("job-ingest: apply_queue read failed —", readFailed.message);
      return json({ error: "apply_queue_failed", detail: readFailed.message }, 500);
    }

    type ApprovedRow = {
      id: string;
      body: string | null;
      job_postings: ApplyCandidate["posting"];
      job_profiles: { name?: string | null } | null;
    };
    const candidates: ApplyCandidate[] = ((approved.data ?? []) as unknown as ApprovedRow[]).map(
      (r) => ({
        id: r.id,
        body: r.body ?? null,
        posting: r.job_postings ?? null,
        profile_name: r.job_profiles?.name ?? null,
      }),
    );

    type SubmittedRow = { id: string; job_postings: { dedupe_key?: string | null } | null };
    const submittedKeys = new Set<string>();
    for (const s of (submittedEver.data ?? []) as unknown as SubmittedRow[]) {
      const k = s.job_postings?.dedupe_key;
      if (typeof k === "string" && k) submittedKeys.add(k);
    }

    const spentToday = (submittedToday.count ?? 0) + (queuedToday.count ?? 0);
    const plan = planApplyQueue(candidates, {
      cvReady: cvGateReady((cvModules.data ?? []) as ModuleRow[]),
      submittedDedupeKeys: submittedKeys,
      budget: DAILY_SUBMIT_CAP - spentToday,
      limit,
      nowMs,
    });

    // Terminal transitions first, and both guarded on `status = 'approved'` so a
    // concurrent poll cannot expire something the other one already queued.
    for (const [rows, next, reason] of [
      [plan.expire, "expired", "valid_through_passed"],
      [plan.cancel, "cancelled", "duplicate_company_application"],
    ] as const) {
      if (rows.length === 0) continue;
      const { error } = await supabaseEarly
        .from("job_applications")
        .update({ status: next, fail_reason: reason })
        .eq("user_id", uid)
        .eq("status", "approved")
        .in("id", rows.map((r) => r.application_id));
      if (error) {
        // Cosmetic relative to the queue: nothing was sent, and the next poll
        // re-derives the same verdict. Do not fail the run over it.
        console.error(`job-ingest: apply_queue ${next} update failed —`, error.message);
      }
    }

    if (plan.queue.length === 0) {
      return json({ ok: true, queue: [], skipped: plan.skipped });
    }

    // Claim the rows. `.select()` returns only what actually flipped, and only
    // those are handed to n8n — if a second poller got there first, its rows are
    // missing from this result and are therefore not sent twice.
    const { data: claimed, error: claimError } = await supabaseEarly
      .from("job_applications")
      .update({ status: "queued", queued_at: nowIso })
      .eq("user_id", uid)
      .eq("status", "approved")
      .in("id", plan.queue.map((q) => q.application_id))
      .select("id");

    if (claimError) {
      console.error("job-ingest: apply_queue claim failed —", claimError.message);
      return json({ error: "apply_queue_claim_failed", detail: claimError.message }, 500);
    }

    const claimedIds = new Set((claimed ?? []).map((r: { id: string }) => r.id));
    return json({
      ok: true,
      queue: plan.queue.filter((q) => claimedIds.has(q.application_id)),
      skipped: plan.skipped,
    });
  }

  // MARK: - action: apply_result
  //
  // What Gmail said, and the proof of what left the machine.
  //
  // The attempt row is written FIRST and unconditionally. It is the audit trail,
  // and an audit trail that only records outcomes the status column agrees with
  // is not one — the question this table answers ("what exactly did we send this
  // company, and when") is asked precisely when the status is in doubt.
  //
  // A partial write reports 207 rather than 500, the same pattern as
  // `evaluate_result`: an attempt landed, and a 500 would make n8n resend an
  // application that has already been emailed. Duplicating an outbound letter is
  // worse than any error message.
  if (asRecord.action === "apply_result") {
    const parsedApply = parseApplyResult(body);
    if (!parsedApply.ok) return json({ error: parsedApply.error }, 400);
    const a = parsedApply.result;
    const nowIso = new Date().toISOString();

    // Invariant 5. Id AND user id, or anything holding the ingest secret could
    // stamp 'submitted' onto another user's application.
    const { data: application, error: lookupError } = await supabaseEarly
      .from("job_applications")
      .select("id,posting_id,status")
      .eq("id", a.applicationId)
      .eq("user_id", a.userId)
      .maybeSingle();

    if (lookupError) {
      console.error("job-ingest: apply_result lookup failed —", lookupError.message);
      return json({ error: "application_lookup_failed", detail: lookupError.message }, 500);
    }
    if (!application) return json({ error: "unknown_application" }, 404);

    const { error: attemptError } = await supabaseEarly.from("job_submission_attempts").insert({
      user_id: a.userId,
      application_id: a.applicationId,
      // One timestamp for both ends. n8n reports after the fact and does not tell
      // us when it started; inventing a duration would be fiction in an audit log.
      started_at: nowIso,
      finished_at: nowIso,
      ok: a.ok,
      proof: a.proof,
      // Promoted out of `proof` into a real column, because it is the join key of
      // the reply loop (20260826150000): an employer's answer lands in the SAME
      // Gmail thread, and a trigger on `mail_messages` matches on this to move the
      // application 'submitted' -> 'response'. A `proof->>'thread_id'` lookup on
      // every ingested mail row would be a sequential scan of the audit log.
      //
      // The database derives the same value in a BEFORE INSERT trigger, so this
      // line is belt-and-braces rather than load-bearing — the migration is
      // applied before this function is deployed, and attempts written in that
      // window must still be matchable.
      thread_id: a.proof?.thread_id ?? null,
      error: a.error,
    });

    if (attemptError) {
      // The status update is NOT attempted. An application marked 'submitted' with
      // no attempt row behind it is exactly the unprovable claim this table exists
      // to prevent, and n8n retrying is the better failure.
      console.error("job-ingest: attempt insert failed —", attemptError.message);
      return json({ error: "attempt_insert_failed", detail: attemptError.message }, 500);
    }

    const nextStatus = a.ok ? "submitted" : "failed";
    const patch: Record<string, unknown> = a.ok
      // `fail_reason` is cleared on success so a row that failed, was re-approved
      // and then went out does not keep advertising a reason it no longer has.
      ? { status: nextStatus, submitted_at: nowIso, submit_channel: "email", fail_reason: null }
      : { status: nextStatus, fail_reason: a.error ?? "send_failed" };

    const { data: moved, error: statusError } = await supabaseEarly
      .from("job_applications")
      .update(patch)
      .eq("id", a.applicationId)
      .eq("user_id", a.userId)
      // Only from `queued`. A 'failed' row cannot be revived by a stray success
      // report — it goes back through a human, which is the point.
      .eq("status", "queued")
      .select("id")
      .maybeSingle();

    if (statusError) {
      console.error("job-ingest: apply_result status update failed —", statusError.message);
      return json(
        {
          ok: false,
          error: "application_status_failed",
          detail: statusError.message,
          application_id: a.applicationId,
          attempt_recorded: true,
        },
        207,
      );
    }

    // The posting follows the application. Guarded on the old value so a second
    // profile's send cannot walk back a status a human has since moved on, the
    // same rule as `evaluate_result`'s 'discovered' -> 'evaluated' flip.
    if (a.ok && moved) {
      const { error: postingError } = await supabaseEarly
        .from("job_postings")
        .update({ status: "applied" })
        .eq("id", application.posting_id)
        .eq("user_id", a.userId)
        .in("status", ["evaluated", "discovered"]);
      if (postingError) {
        // Cosmetic. The application and its proof are both stored.
        console.error("job-ingest: posting status update failed —", postingError.message);
      }
    }

    return json({
      ok: true,
      application_id: a.applicationId,
      status: moved ? nextStatus : application.status,
      updated: Boolean(moved),
      attempt_recorded: true,
    });
  }

  const parsed = parseBody(body);
  if (!parsed.ok || !parsed.userId || !parsed.postings) {
    return json({ error: parsed.error ?? "invalid_body", max_postings: MAX_POSTINGS }, 400);
  }

  const supabase = supabaseEarly;

  // Invariant 5. Without this a caller holding the ingest secret could write rows
  // under any uuid it liked, including one that does not exist — orphaned rows no
  // client can ever see or delete.
  const { data: owner, error: ownerError } = await supabase
    .from("job_profiles")
    .select("user_id")
    .eq("user_id", parsed.userId)
    .limit(1)
    .maybeSingle();

  if (ownerError) {
    console.error("job-ingest: owner check failed —", ownerError.message);
    return json({ error: "owner_check_failed" }, 500);
  }
  if (!owner) {
    // No profile means nothing to match against anyway, so this doubles as a
    // useful signal: the panel has not been set up yet.
    return json({ error: "unknown_user_or_no_profiles" }, 403);
  }

  const accepted: PostingRow[] = [];
  const rejected: { url?: string; error: string }[] = [];
  const matchesByKey = new Map<string, MatchInput[]>();

  for (const r of parsed.postings) {
    if (!r.ok) {
      rejected.push({ url: r.url, error: r.error });
      continue;
    }
    accepted.push(r.posting);
    matchesByKey.set(`${r.posting.source_kind} ${r.posting.external_id}`, r.matches);
  }

  if (accepted.length === 0) {
    return json({ ok: true, inserted: 0, rejected });
  }

  const rows = dedupeWithinBatch(accepted);

  // `ignoreDuplicates: false` = update on conflict. Re-running a harvest must
  // refresh an ad in place (its `valid_through` may have moved) rather than fail.
  const { data: upserted, error: upsertError } = await supabase
    .from("job_postings")
    .upsert(rows, { onConflict: "user_id,source_kind,external_id", ignoreDuplicates: false })
    .select("id,source_kind,external_id");

  if (upsertError) {
    console.error("job-ingest: posting upsert failed —", upsertError.message);
    return json({ error: "upsert_failed", detail: upsertError.message }, 500);
  }

  // Match rows need the posting id, which only exists after the upsert above.
  const matchRows = [];
  for (const p of upserted ?? []) {
    for (const m of matchesByKey.get(`${p.source_kind} ${p.external_id}`) ?? []) {
      matchRows.push({ user_id: parsed.userId, posting_id: p.id, ...m });
    }
  }

  // ⚠️ `ignoreDuplicates: true` = DO NOTHING on conflict, and the asymmetry with
  // the posting upsert three lines above is deliberate.
  //
  // A harvest match row comes out of `normalizeMatch` against the n8n gate
  // payload, which carries no score: `score`, `evaluated_at`, `reasoning`,
  // `model` and `module_plan` are all null in it by construction. With DO UPDATE
  // every re-harvest of an ad the 4h cron re-sees — which is most of them —
  // overwrote the stored Qwen verdict with those nulls. The match then re-entered
  // the `pending` queue, was re-scored at real inference cost, and its
  // application was dragged back to `draft` by `evaluate_result`. That is what
  // took the scored set from 30+ matches down to 15 over the Aug 26 → Sep 3 run.
  //
  // **An evaluation is strictly more information than a gate verdict**, so a gate
  // verdict must never be allowed to write over one. The first verdict for a
  // `(posting, profile)` stands.
  //
  // The trade-off, stated so nobody discovers it as a bug: a later change to a
  // profile's gate rules will NOT retro-update `gate_verdict` / `gate_reason` on
  // matches that already exist — they keep the verdict they were first stored
  // with. That is accepted. Re-gating is a cosmetic refresh of two columns;
  // destroying an evaluation to get it is not a trade worth making, and a
  // deliberate re-gate is available by deleting the affected rows by hand (they
  // are then re-created, gate-fresh, on the next harvest).
  //
  // Because DO NOTHING writes nothing on conflict, `.select()` returns ONLY the
  // rows actually inserted — so the count below is new matches, not rows offered.
  let matchesNew = 0;
  if (matchRows.length > 0) {
    const { data: insertedMatches, error: matchError } = await supabase
      .from("job_matches")
      .upsert(matchRows, { onConflict: "posting_id,profile_id", ignoreDuplicates: true })
      .select("id");

    if (matchError) {
      // Postings are already stored. Report the partial success honestly rather
      // than 500-ing, which would make n8n retry the whole batch and re-upsert
      // rows that landed perfectly well.
      console.error("job-ingest: match upsert failed —", matchError.message);
      return json(
        {
          ok: false,
          error: "matches_failed",
          detail: matchError.message,
          postings: upserted?.length ?? 0,
          matches: 0,
          matches_new: 0,
          matches_offered: matchRows.length,
          rejected,
        },
        207,
      );
    }
    matchesNew = insertedMatches?.length ?? 0;
  }

  // `postings` and `matches` stay in the response because they are what a human
  // reads off the `Send` node when a run stores fewer rows than expected — the
  // funnel-reading recipe in `n8n/job-applier/README.md` names both by name, and
  // `exec-forensics.mjs` prints this body verbatim. Nothing in the workflow
  // BRANCHES on them (`Send` is the terminal node), so the meaning of `matches`
  // could be tightened without breaking a run — but it is now "matches newly
  // created", not "match rows submitted", and a steady state of `matches: 0` on a
  // run that found postings is HEALTHY: it means every ad was already known and
  // no evaluation was clobbered. `matches_offered` keeps the old number visible
  // so the two can never be confused for each other.
  return json({
    ok: true,
    postings: upserted?.length ?? 0,
    matches: matchesNew,
    matches_new: matchesNew,
    matches_offered: matchRows.length,
    rejected,
  });
});
