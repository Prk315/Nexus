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
  JOB_ATTEMPTS_TABLE,
  JOB_ATTEMPT_COLUMNS,
  JOB_MATCHES_TABLE,
  JOB_MATCH_COLUMNS,
  JOB_MATCH_SELECT,
  JOB_MODULES_TABLE,
  JOB_MODULE_COLUMNS,
  JOB_PROFILES_TABLE,
  JOB_PROFILE_FULL_COLUMNS,
  RESPONSE_STATUS,
  REVIEW_STATUS,
  SENT_STATUSES,
  type JobAppModule,
  type JobApplication,
  type JobApplicationItem,
  type JobMatch,
  type JobMatchItem,
  type JobPosting,
  type JobProfile,
  type JobProfileFull,
  type JobSubmissionAttempt,
} from "./types";
import { compareMatches, matchKey } from "./score";
import { clampThreshold } from "./format";

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
/**
 * Profiles are search *personas* — three or four of them, not a feed. The cap
 * exists so the read is bounded like every other one here, not because anyone
 * expects to hit it.
 */
export const PROFILE_LIMIT = 50;
/** One application's whole attempt history. A retry loop that got past this is itself the story. */
export const ATTEMPT_LIMIT = 20;

export type JobsSnapshot = {
  /** `needs_approval`, newest request first. The decisions waiting on a human. */
  review: JobApplicationItem[];
  /** Gate-pass matches, `score desc nulls first`. */
  matches: JobMatchItem[];
  /** Everything past the decision point, newest first — replies included. */
  sent: JobApplicationItem[];
  /** The module catalog, grouped by slot in the panel. */
  modules: JobAppModule[];
  /** The gate's inputs, editable in the Profiles tab. */
  profiles: JobProfileFull[];
  /** True when a window came back full and older rows exist outside it. */
  truncated: {
    review: boolean;
    matches: boolean;
    sent: boolean;
    modules: boolean;
    profiles: boolean;
  };
};

/**
 * The two numbers behind the header badge.
 *
 * Separate fields rather than a pre-summed integer because the Review tab's own
 * count needs the first half on its own — and because "3 waiting, 1 replied"
 * is a materially different sentence from "4".
 */
export type JobsAttention = {
  needsApproval: number;
  responses: number;
};

/**
 * The subset of `job_profiles` this panel may write, spelled out rather than
 * accepted as a partial row.
 *
 * The API builds its update object field by field from this — it never spreads
 * a caller's object into `.update()`. Spreading would let any future call site
 * write `user_id` (RLS's `with check` would reject it, but only after the panel
 * had been written as though it were possible) or `locations`, which is
 * read-only for a reason stated on the type.
 */
export type JobProfilePatch = {
  enabled?: boolean;
  approval_threshold?: number;
  keywords?: string[];
  exclude_terms?: string[];
};

export type JobsApi = {
  /** One open of the panel. Throws on failure; the panel degrades to stale. */
  load: () => Promise<JobsSnapshot>;
  /**
   * The badge numbers — two `head: true` counts, no rows. Separate from `load`
   * because it runs on a timer while the panel is *closed*, and pulling 30
   * drafts plus their bodies every minute to render one integer would be
   * absurd.
   */
  countAttention: () => Promise<JobsAttention>;
  /**
   * One application's attempt history, newest first. Fetched **lazily**, per
   * row, when a Sent row is expanded — the alternative is one query per
   * application on every panel open to render something nobody has asked to
   * see, which is an N+1 by any other name.
   */
  loadAttempts: (applicationId: string) => Promise<JobSubmissionAttempt[]>;
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
  /**
   * Write one or more of the four editable gate fields.
   *
   * Returns the stored row, which is what the panel rolls forward to — an
   * optimistic edit is a *guess* about what the server will hold, and adopting
   * the response rather than the guess is what keeps a clamped threshold or a
   * trigger-touched `updated_at` from being invisible until the next refetch.
   */
  updateProfile: (id: string, patch: JobProfilePatch) => Promise<JobProfileFull>;
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

      // Five independent reads. None is scoped by `user_id` in the query: RLS is
      // the scoping mechanism, and a hardcoded id here would be a second,
      // drifting source of truth. (Same call `createMailLoader` makes.)
      const [reviewRes, matchRes, sentRes, moduleRes, profileRes] = await Promise.all([
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
        c
          .from(JOB_PROFILES_TABLE)
          .select(JOB_PROFILE_FULL_COLUMNS)
          // Disabled profiles are fetched for the same reason disabled modules
          // are: `enabled` governs what the harvester runs, not what the
          // catalog shows, and this tab exists so a profile can be switched
          // back on without opening the Supabase dashboard.
          .order("sort", { ascending: true })
          .order("name", { ascending: true })
          .limit(PROFILE_LIMIT),
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
      // Degrades to empty like modules do, and with the same visible
      // consequence: the Profiles tab says it could not read them rather than
      // rendering "you have no search profiles", which would be a lie that
      // invites someone to create a duplicate.
      const profileRows = profileRes.error
        ? []
        : ((profileRes.data ?? []) as unknown as JobProfileFull[]);

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
        profiles: profileRows,
        truncated: {
          review: reviewRows.length >= REVIEW_LIMIT,
          matches: matchRows.length >= MATCH_LIMIT,
          sent: sentRows.length >= SENT_LIMIT,
          modules: moduleRows.length >= MODULE_LIMIT,
          profiles: profileRows.length >= PROFILE_LIMIT,
        },
      };
    },

    async countAttention() {
      const c = requireClient();
      const [reviewRes, responseRes] = await Promise.all([
        c
          .from(JOB_APPLICATIONS_TABLE)
          .select("id", { count: "exact", head: true })
          .eq("status", REVIEW_STATUS),
        // Two counts rather than one `.in()`, because the panel needs them apart:
        // the Review tab's own number is the first alone. Both are row-less, so
        // the extra request costs a round trip and no payload.
        //
        // Against a database that has never written `'response'` this returns 0
        // rather than erroring — `status` is free text, so an unmatched `.eq`
        // is simply an empty count. That is what makes this safe to ship before
        // the backend half lands.
        c
          .from(JOB_APPLICATIONS_TABLE)
          .select("id", { count: "exact", head: true })
          .eq("status", RESPONSE_STATUS),
      ]);
      // The approval queue is the badge's reason to exist; failing to read it is
      // a real failure and the panel keeps its previous number rather than
      // showing a fresh-looking zero. A reply count that fails degrades to 0 —
      // it can only ever understate, never invent urgency.
      if (reviewRes.error) throw new Error(reviewRes.error.message ?? "jobs: count failed");
      return {
        needsApproval: reviewRes.count ?? 0,
        responses: responseRes.error ? 0 : (responseRes.count ?? 0),
      };
    },

    async loadAttempts(applicationId) {
      const { data, error } = await requireClient()
        .from(JOB_ATTEMPTS_TABLE)
        .select(JOB_ATTEMPT_COLUMNS)
        .eq("application_id", applicationId)
        // "What happened to this application, most recent first" — the index
        // `job_submission_attempts_app_idx` is built for exactly this order.
        .order("started_at", { ascending: false })
        .limit(ATTEMPT_LIMIT);
      // Throws rather than degrading to []. An empty attempt log is a *claim*
      // ("nothing was ever sent") and it is the reassuring one; this is the one
      // read in the whole panel where a silent empty result would actively
      // mislead, so the caller renders "couldn't read the log" instead.
      if (error) throw new Error(error.message ?? "jobs: attempts query failed");
      return (data ?? []) as unknown as JobSubmissionAttempt[];
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

    async updateProfile(id, patch) {
      // Built field by field. Never `{ ...patch }` — see `JobProfilePatch`.
      const update: Record<string, unknown> = {};
      if (typeof patch.enabled === "boolean") update.enabled = patch.enabled;
      if (patch.approval_threshold !== undefined) {
        const t = clampThreshold(patch.approval_threshold);
        // A patch that carried a threshold and produced nothing usable is a bug
        // upstream, not something to paper over by writing 0 — which would set
        // the profile to "ask me about every posting".
        if (t === null) throw new Error("jobs: approval_threshold is not a number");
        update.approval_threshold = t;
      }
      if (Array.isArray(patch.keywords)) {
        update.keywords = patch.keywords.map((k) => String(k)).filter((k) => k.trim() !== "");
      }
      if (Array.isArray(patch.exclude_terms)) {
        update.exclude_terms = patch.exclude_terms
          .map((k) => String(k))
          .filter((k) => k.trim() !== "");
      }
      if (Object.keys(update).length === 0) {
        throw new Error("jobs: profile patch had nothing to write");
      }
      const { data, error } = await requireClient()
        .from(JOB_PROFILES_TABLE)
        .update(update)
        .eq("id", id)
        // No status guard, unlike approve/reject: nothing races a profile edit.
        // The approval email can decide an application; only this panel and the
        // Supabase dashboard touch a profile, and last-writer-wins between those
        // two is the same posture the rest of this project takes.
        .select(JOB_PROFILE_FULL_COLUMNS)
        .single();
      if (error) throw new Error(error.message ?? "jobs: profile save failed");
      return data as unknown as JobProfileFull;
    },
  };
}
