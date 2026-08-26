/**
 * Builds the `jobsApi` object `NexusHeader` takes as a prop.
 *
 * The injection is the whole design decision, and it is copied verbatim from
 * `createMailLoader`: nexus-core constructs **no** Supabase client, because the
 * correct client for these five tables is the app's **authenticated** one.
 * They carry `auth.uid()` RLS with no anon policy at all — `job_app_modules.
 * content` is a person's own writing about their career and
 * `job_applications.body` is a letter they have not sent — so a mismatched or
 * signed-out client reads back an **empty set, not an error**. An empty jobs
 * panel is supposed to mean "nothing matched"; those two states must never be
 * produced by the same code path, which is why apps pass `undefined` when there
 * is no session and the panel says "sign in" rather than "nothing to review".
 *
 * `apps/nexus`, `apps/Stonks` and `apps/TimeTrackerApp` have no session and
 * simply pass nothing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  JOB_APPLICATIONS_TABLE,
  JOB_APPLICATION_COLUMNS,
  JOB_APPLICATION_SELECT,
  JOB_MATCHES_TABLE,
  JOB_MATCH_COLUMNS,
  JOB_MATCH_SELECT,
  JOB_MODULES_TABLE,
  JOB_MODULE_COLUMNS,
  REVIEW_STATUS,
  SENT_STATUSES,
  type JobAppModule,
  type JobApplication,
  type JobApplicationItem,
  type JobMatch,
  type JobMatchItem,
  type JobPosting,
  type JobProfile,
} from "./types";
import { compareMatches, matchKey } from "./score";

/**
 * Row caps. A header is not an applicant-tracking system; these bound the read
 * and the panel says so out loud when a window comes back full, because a
 * truncated window presented as a whole list is the same lie as "inbox zero"
 * off a window that never contained the mail.
 */
export const REVIEW_LIMIT = 30;
export const MATCH_LIMIT = 30;
export const SENT_LIMIT = 30;
export const MODULE_LIMIT = 200;

export type JobsSnapshot = {
  /** `needs_approval`, newest request first. The decisions waiting on a human. */
  review: JobApplicationItem[];
  /** Gate-pass matches, `score desc nulls first`. */
  matches: JobMatchItem[];
  /** Everything past the decision point, newest first. */
  sent: JobApplicationItem[];
  /** The module catalog, grouped by slot in the panel. */
  modules: JobAppModule[];
  /** True when a window came back full and older rows exist outside it. */
  truncated: { review: boolean; matches: boolean; sent: boolean; modules: boolean };
};

export type JobsApi = {
  /** One open of the panel. Throws on failure; the panel degrades to stale. */
  load: () => Promise<JobsSnapshot>;
  /**
   * Just the badge number — a `head: true` count, no rows. Separate from
   * `load` because it runs on a timer while the panel is *closed*, and pulling
   * 30 drafts plus their bodies every minute to render one integer would be
   * absurd.
   */
  countNeedsApproval: () => Promise<number>;
  /**
   * `needs_approval → approved`.
   *
   * Resolves to `null` when the row was no longer in `needs_approval` — see the
   * guard below. That is a normal outcome, not an error.
   */
  approve: (id: string) => Promise<JobApplication | null>;
  /** `needs_approval → cancelled`. Same guard, same `null` contract. */
  reject: (id: string) => Promise<JobApplication | null>;
  setModuleEnabled: (id: string, enabled: boolean) => Promise<JobAppModule>;
  setModuleContent: (id: string, content: string) => Promise<JobAppModule>;
};

// ── Embed normalisation ───────────────────────────────────────────────────

/**
 * PostgREST returns a many-to-one embed as an object, but returns an *array*
 * when it resolves the relationship the other way round — which is what happens
 * the moment a second FK, a view, or a renamed constraint changes its inference.
 * The failure would be silent (`item.posting.title` on an array is `undefined`,
 * so every card renders blank) so both shapes are accepted here rather than
 * assumed.
 */
function one<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return (value[0] as T) ?? null;
  return value as T;
}

type EmbeddedRow = { job_postings?: unknown; job_profiles?: unknown };

function splitEmbeds(row: unknown): { posting: JobPosting | null; profile: JobProfile | null } {
  const r = (row ?? {}) as EmbeddedRow;
  return {
    posting: one<JobPosting>(r.job_postings),
    profile: one<JobProfile>(r.job_profiles),
  };
}

/** Strip the embed keys so the flat row keeps the exact `JobApplication` shape. */
function stripEmbeds<T>(row: unknown): T {
  const { job_postings: _p, job_profiles: _f, ...rest } = (row ?? {}) as Record<string, unknown>;
  return rest as T;
}

// ── The API ───────────────────────────────────────────────────────────────

export function createJobsApi(client: SupabaseClient | null | undefined): JobsApi {
  function requireClient(): SupabaseClient {
    if (!client) throw new Error("jobs: no Supabase client");
    return client;
  }

  /**
   * The scores for a set of applications.
   *
   * A second round trip, unavoidably: `job_applications` has no foreign key to
   * `job_matches` (both are keyed `(posting_id, profile_id)` instead), so there
   * is no embed that reaches it. Fetching a generic "recent matches" window and
   * hoping the review rows are inside it is the tempting shortcut and it is
   * wrong — a draft sitting in review for a week is precisely the one whose
   * match has fallen out of a recency window, and it would render as an
   * unscored card forever.
   */
  async function matchesForPostings(postingIds: string[]): Promise<JobMatch[]> {
    if (postingIds.length === 0) return [];
    const { data, error } = await requireClient()
      .from(JOB_MATCHES_TABLE)
      .select(JOB_MATCH_COLUMNS)
      .in("posting_id", postingIds);
    // Scores are decoration on a review card, not the decision itself — the
    // draft body and its gaps are. A failure here degrades to a pending badge
    // rather than hiding an application that needs approving.
    if (error) return [];
    return (data ?? []) as unknown as JobMatch[];
  }

  function stitch(rows: unknown[], byKey: Map<string, JobMatch>): JobApplicationItem[] {
    return rows.map((row) => {
      const flat = stripEmbeds<JobApplication>(row);
      const { posting, profile } = splitEmbeds(row);
      return {
        ...flat,
        posting,
        profile,
        match: byKey.get(matchKey(flat.posting_id, flat.profile_id)) ?? null,
      };
    });
  }

  return {
    async load() {
      const c = requireClient();

      // Four independent reads. None is scoped by `user_id` in the query: RLS is
      // the scoping mechanism, and a hardcoded id here would be a second,
      // drifting source of truth. (Same call `createMailLoader` makes.)
      const [reviewRes, matchRes, sentRes, moduleRes] = await Promise.all([
        c
          .from(JOB_APPLICATIONS_TABLE)
          .select(JOB_APPLICATION_SELECT)
          .eq("status", REVIEW_STATUS)
          // Oldest request is the most overdue, but newest-first is what a
          // review queue wants: the thing that just landed is the thing the
          // notification was about. Deadlines are surfaced per-card instead.
          .order("approval_requested_at", { ascending: false, nullsFirst: false })
          .limit(REVIEW_LIMIT),
        c
          .from(JOB_MATCHES_TABLE)
          .select(JOB_MATCH_SELECT)
          // Gate-pass only. `dropped` rows are the keyword gate's rejects and
          // exist to make the gate auditable, not to be browsed — there are
          // orders of magnitude more of them and they would bury everything.
          .eq("gate_verdict", "pass")
          // `nullsFirst` is the contract, not a default — see `compareMatches`.
          // Covered by `job_matches_user_score (user_id, score desc nulls first)`.
          .order("score", { ascending: false, nullsFirst: true })
          .order("created_at", { ascending: false })
          .limit(MATCH_LIMIT),
        c
          .from(JOB_APPLICATIONS_TABLE)
          .select(JOB_APPLICATION_SELECT)
          .in("status", SENT_STATUSES as readonly string[])
          .order("updated_at", { ascending: false })
          .limit(SENT_LIMIT),
        c
          .from(JOB_MODULES_TABLE)
          .select(JOB_MODULE_COLUMNS)
          // Disabled modules are fetched too. `enabled` governs what the
          // assembler may use, not what the catalog shows — and the whole point
          // of this tab is to let someone fix and re-enable one without opening
          // the Supabase dashboard. Filtering here would hide the rows that most
          // need attention.
          .order("slot", { ascending: true })
          .order("sort", { ascending: true })
          .order("name", { ascending: true })
          .limit(MODULE_LIMIT),
      ]);

      // The two application reads are the panel's reason to exist; a failure in
      // either is a real failure. Matches and modules degrade to empty (with a
      // visible consequence — pending badges, an empty catalog note) rather than
      // hiding drafts that need a decision behind a broken secondary read.
      if (reviewRes.error) {
        throw new Error(reviewRes.error.message ?? "jobs: review query failed");
      }
      if (sentRes.error) {
        throw new Error(sentRes.error.message ?? "jobs: sent query failed");
      }

      const reviewRows = (reviewRes.data ?? []) as unknown[];
      const sentRows = (sentRes.data ?? []) as unknown[];
      const matchRows = matchRes.error ? [] : ((matchRes.data ?? []) as unknown[]);
      const moduleRows = moduleRes.error
        ? []
        : ((moduleRes.data ?? []) as unknown as JobAppModule[]);

      const matches: JobMatchItem[] = matchRows
        .map((row) => {
          const flat = stripEmbeds<JobMatch>(row);
          const { posting, profile } = splitEmbeds(row);
          return { ...flat, posting, profile };
        })
        // Re-sorted client-side after stitching. The server already ordered
        // correctly; this pins the same rule in one testable place so the list
        // cannot visibly reshuffle between render and refetch.
        .sort(compareMatches);

      // Everything the two application windows need a score for, plus whatever
      // the matches window already brought along for free.
      const byKey = new Map<string, JobMatch>();
      for (const m of matches) byKey.set(matchKey(m.posting_id, m.profile_id), m);

      const appRows = [...reviewRows, ...sentRows];
      const wanted = new Set<string>();
      for (const row of appRows) {
        const flat = stripEmbeds<JobApplication>(row);
        if (!byKey.has(matchKey(flat.posting_id, flat.profile_id))) {
          wanted.add(flat.posting_id);
        }
      }
      for (const m of await matchesForPostings([...wanted])) {
        const key = matchKey(m.posting_id, m.profile_id);
        if (!byKey.has(key)) byKey.set(key, m);
      }

      return {
        review: stitch(reviewRows, byKey),
        matches,
        sent: stitch(sentRows, byKey),
        modules: moduleRows,
        truncated: {
          review: reviewRows.length >= REVIEW_LIMIT,
          matches: matchRows.length >= MATCH_LIMIT,
          sent: sentRows.length >= SENT_LIMIT,
          modules: moduleRows.length >= MODULE_LIMIT,
        },
      };
    },

    async countNeedsApproval() {
      const { count, error } = await requireClient()
        .from(JOB_APPLICATIONS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("status", REVIEW_STATUS);
      if (error) throw new Error(error.message ?? "jobs: count failed");
      return count ?? 0;
    },

    async approve(id) {
      const { data, error } = await requireClient()
        .from(JOB_APPLICATIONS_TABLE)
        .update({
          status: "approved",
          // ISO 8601 UTC. The column is a real `timestamptz`, so this is the one
          // safe thing to send — never a `Local::now()`-style offset-less string,
          // which is the mistake that shifts `time_entries` by a whole UTC offset.
          approved_at: new Date().toISOString(),
          // Provenance. The email link writes `email`; this is the panel. Knowing
          // which one decided is what makes "did I approve this or did I click
          // something in a mail on my phone?" answerable.
          approved_via: "panel",
        })
        .eq("id", id)
        // ⚠️ The guard, and the reason this is a plain authenticated update
        // rather than an edge function. The approval email carries a single-use
        // token that performs the *same* transition, so two things can decide
        // this row. Guarding on the status the transition starts from makes the
        // write idempotent: whoever lands second matches zero rows and gets
        // `null`, instead of stamping a second `approved_at` over a draft that
        // may already have been queued or even sent.
        //
        // RLS scopes it to the owner, and the server re-checks everything that
        // actually matters (daily cap, deadline, gaps) at send time — so the
        // panel needs no policy logic of its own. That is the house rule: no
        // client derives policy.
        .eq("status", REVIEW_STATUS)
        // The flat row only — no embeds. The panel already holds the posting
        // and profile for the card it just acted on; re-selecting them would
        // make an approve three joins wide for data it would throw away.
        .select(JOB_APPLICATION_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message ?? "jobs: approve failed");
      return (data as unknown as JobApplication) ?? null;
    },

    async reject(id) {
      const { data, error } = await requireClient()
        .from(JOB_APPLICATIONS_TABLE)
        .update({ status: "cancelled" })
        .eq("id", id)
        // Same guard, same reason. A rejection racing an email approval must
        // not un-approve something already queued to send.
        .eq("status", REVIEW_STATUS)
        // The flat row only — no embeds. The panel already holds the posting
        // and profile for the card it just acted on; re-selecting them would
        // make an approve three joins wide for data it would throw away.
        .select(JOB_APPLICATION_COLUMNS)
        .maybeSingle();
      if (error) throw new Error(error.message ?? "jobs: reject failed");
      return (data as unknown as JobApplication) ?? null;
    },

    async setModuleEnabled(id, enabled) {
      const { data, error } = await requireClient()
        .from(JOB_MODULES_TABLE)
        .update({ enabled })
        .eq("id", id)
        .select(JOB_MODULE_COLUMNS)
        .single();
      if (error) throw new Error(error.message ?? "jobs: module toggle failed");
      return data as unknown as JobAppModule;
    },

    async setModuleContent(id, content) {
      const { data, error } = await requireClient()
        .from(JOB_MODULES_TABLE)
        .update({ content })
        .eq("id", id)
        .select(JOB_MODULE_COLUMNS)
        .single();
      if (error) throw new Error(error.message ?? "jobs: module save failed");
      return data as unknown as JobAppModule;
    },
  };
}
