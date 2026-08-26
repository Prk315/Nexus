import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  assembleApplication,
  dedupeWithinBatch,
  MAX_POSTINGS,
  type MatchInput,
  type ModuleRow,
  normalizeModulePlan,
  parseBody,
  parseEvaluateResult,
  parsePendingLimit,
  type PostingRow,
  secretIsUsable,
  secretMatches,
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
 *
 * `pending` and `evaluate_result` are phase 2 (`n8n/job-applier/EVALUATION.md`).
 * The application body is assembled HERE and nowhere else — the module prose
 * never leaves this database, so n8n could not assemble it even if it tried.
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

    const { data: application, error: appError } = await supabaseEarly
      .from("job_applications")
      .upsert(
        {
          user_id: v.userId,
          posting_id: match.posting_id,
          profile_id: match.profile_id,
          body: assembled.body,
          module_ids: assembled.module_ids,
          missing_slots: assembled.missing_slots,
          status: "draft",
        },
        { onConflict: "posting_id,profile_id", ignoreDuplicates: false },
      )
      .select("id")
      .maybeSingle();

    if (appError) {
      // The score landed. Say so rather than 500-ing, which would make n8n resend
      // a verdict that is already stored — and the match is no longer `pending`,
      // so the resend would be the last chance to notice this at all.
      console.error("job-ingest: application upsert failed —", appError.message);
      return json(
        { ok: false, error: "application_failed", detail: appError.message, match_id: v.matchId },
        207,
      );
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

    return json({
      ok: true,
      match_id: v.matchId,
      score: v.score,
      application_id: application?.id ?? null,
      module_ids: assembled.module_ids,
      missing_slots: assembled.missing_slots,
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

  let matchesWritten = 0;
  if (matchRows.length > 0) {
    const { error: matchError } = await supabase
      .from("job_matches")
      .upsert(matchRows, { onConflict: "posting_id,profile_id", ignoreDuplicates: false });

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
          rejected,
        },
        207,
      );
    }
    matchesWritten = matchRows.length;
  }

  return json({
    ok: true,
    postings: upserted?.length ?? 0,
    matches: matchesWritten,
    rejected,
  });
});
