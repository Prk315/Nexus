import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

import {
  dedupeWithinBatch,
  MAX_POSTINGS,
  type MatchInput,
  parseBody,
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
