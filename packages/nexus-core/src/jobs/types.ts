/**
 * Shared types for the job-applier surface in `NexusHeader`.
 *
 * The pipeline is the same shape as mail triage, with a different producer:
 * n8n on the Mac harvests Jobindex / TheHub, a local Qwen gates and scores each
 * posting, an application is **assembled from human-written modules** (the model
 * selects, it never writes prose), and the result lands in Supabase through the
 * `job-ingest` edge function. Every client just reads.
 *
 * ⚠️ **All five tables are `auth.uid()`-scoped with NO anon policy.** Read them
 * with the app's **authenticated** `supabase` client, never `supabasePublic`. A
 * mismatched client returns an **empty set, not an error** — and an empty jobs
 * panel is supposed to mean "nothing matched", so getting this wrong is
 * completely invisible. That is why `createJobsApi` takes an injected client
 * rather than constructing one here, exactly like `createMailLoader`.
 *
 * Schema of record:
 *   supabase/migrations/20260824120000_job_pipeline.sql   (postings, profiles, matches)
 *   supabase/migrations/20260825120000_job_evaluation.sql (modules, applications)
 *   supabase/migrations/20260826120000_job_apply.sql      (approval, submission attempts)
 */

// ── Tables ────────────────────────────────────────────────────────────────

export const JOB_POSTINGS_TABLE = "job_postings";
export const JOB_PROFILES_TABLE = "job_profiles";
export const JOB_MATCHES_TABLE = "job_matches";
export const JOB_APPLICATIONS_TABLE = "job_applications";
export const JOB_MODULES_TABLE = "job_app_modules";

// ── Status domains ────────────────────────────────────────────────────────

/**
 * Where an application is.
 *
 * `status` is **free text** in the database (deliberately — see the migration's
 * "The status domain" note), so this union is the vocabulary the pipeline uses
 * today rather than something Postgres enforces. Everything that switches on it
 * must therefore tolerate a value it has never seen: the panel renders an
 * unknown status as a neutral chip with its raw text rather than dropping the
 * row, because a row that vanished is indistinguishable from one that never
 * existed.
 */
export type JobApplicationStatus =
  | "draft"
  | "needs_approval"
  | "approved"
  | "queued"
  | "submitted"
  | "failed"
  | "cancelled"
  | "expired";

/** The one status the Review tab acts on. Also the guard on every write. */
export const REVIEW_STATUS = "needs_approval";

/**
 * Everything past the decision point — the Sent tab.
 *
 * `cancelled` is in here on purpose. A rejected draft is not deleted, and
 * hiding it would make "did I already say no to this company?" unanswerable
 * from the panel; the tab is a decision log, not an outbox.
 *
 * `draft` is deliberately **absent** from both lists: a draft that has not yet
 * asked for approval is the pipeline mid-flight, not something a human has a
 * decision to make about.
 */
export const SENT_STATUSES: readonly JobApplicationStatus[] = [
  "approved",
  "queued",
  "submitted",
  "failed",
  "expired",
  "cancelled",
];

/** `pass` survives the keyword gate; `dropped` was rejected before the model ran. */
export type JobGateVerdict = "pass" | "dropped";

// ── Rows ──────────────────────────────────────────────────────────────────

/**
 * One row of `job_postings`, minus the bulk.
 *
 * `description` and `ld_json` exist on the table and are deliberately **not**
 * here or in `JOB_POSTING_COLUMNS` — the same call `MailMessage` makes about
 * `raw`. They hold whole scraped job ads, and a header dropdown that lists 30
 * postings would pull a megabyte of prose nobody reads to render a title. The
 * model's `reasoning` is what the panel shows instead, which is the part a human
 * actually needs.
 */
export type JobPosting = {
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  /** `jobindex_rss` | `thehub_sitemap` | … — free text, like `job_sources.kind`. */
  source_kind: string;
  /** Application deadline, when the ad stated one. Null = the ad did not say. */
  valid_through: string | null;
  status: string;
  discovered_at: string;
};

/** One row of `job_profiles` — a search persona ("AI Engineer", "Game Dev"). */
export type JobProfile = {
  id: string;
  name: string;
  enabled: boolean;
  sort: number;
  keywords: string[];
  /** Score at or above which a draft asks for approval. Default 75. */
  approval_threshold: number;
};

/**
 * One row of `job_matches` — the model's verdict on (posting, profile).
 *
 * `module_plan jsonb` is on the table but not selected: it is a debugging record
 * of what the model said, and its queryable half is already normalized onto
 * `job_applications.module_ids` / `missing_slots`, which is what the panel
 * renders.
 */
export type JobMatch = {
  id: string;
  posting_id: string;
  profile_id: string;
  gate_verdict: string;
  gate_reason: string | null;

  /**
   * **0–100, and nullable — `null` is a state, not a score.**
   *
   * Null means the model has not evaluated this match yet, which is a different
   * fact from "evaluated, scored zero". n8n runs on the Mac and stops when the
   * Mac sleeps, so an unscored match is a normal thing to read at 8am. Never
   * coerce it to 0: sort `score desc nulls first` so an unevaluated match
   * surfaces at the top instead of being buried where a `default 0` would put
   * it, and render it as a pending badge, never as the number 0.
   */
  score: number | null;
  reasoning: string | null;
  matched_skills: string[];
  missing_skills: string[];
  /** When the model scored it. Null exactly when `score` is null. */
  evaluated_at: string | null;
  created_at: string;
};

/**
 * One row of `job_applications` — an assembled draft.
 *
 * `approval_token` is on the table and is deliberately **not** selected. It is
 * a single-use capability that authorises the `needs_approval → approved`
 * transition from an email link; the panel does not need it (it updates the row
 * directly, under RLS) and putting a live capability into a header dropdown's
 * memory buys nothing.
 */
export type JobApplication = {
  id: string;
  posting_id: string;
  profile_id: string;
  /** The assembled letter. May contain `[GAP: …]` markers — see `applicationGaps`. */
  body: string | null;
  /** Exactly which modules produced `body`, in assembly order. */
  module_ids: string[];
  /** Slots the plan wanted and no module covered. Non-empty = do not send. */
  missing_slots: string[];
  status: string;

  approval_requested_at: string | null;
  approved_at: string | null;
  /** `panel` when this panel approved it, `email` when the link did. */
  approved_via: string | null;
  queued_at: string | null;
  submitted_at: string | null;
  fail_reason: string | null;

  created_at: string;
  updated_at: string;
};

/** One row of `job_app_modules` — a paragraph a human wrote, reused verbatim. */
export type JobAppModule = {
  id: string;
  name: string;
  /** `intro` | `skill` | `project` | `education` | `closing` | … — free text. */
  slot: string;
  /** What the module *evidences* (lowercase). The only thing the model matches on. */
  tags: string[];
  lang: string;
  /** The prose. Written by a person, stored verbatim, concatenated verbatim. */
  content: string;
  enabled: boolean;
  sort: number;
  updated_at: string;
};

// ── Joined shapes ─────────────────────────────────────────────────────────

/** An application with its posting and profile resolved. */
export type JobApplicationItem = JobApplication & {
  posting: JobPosting | null;
  profile: JobProfile | null;
  /**
   * The match this draft came from, when one is in the window.
   *
   * `job_applications` has no foreign key to `job_matches` — both are keyed
   * `(posting_id, profile_id)` instead — so this cannot be a PostgREST embed
   * and is stitched client-side. `null` means "not fetched", which the panel
   * renders as a pending badge rather than as a zero score.
   */
  match: JobMatch | null;
};

/** A match with its posting and profile resolved. */
export type JobMatchItem = JobMatch & {
  posting: JobPosting | null;
  profile: JobProfile | null;
};

// ── Pinned column lists ───────────────────────────────────────────────────
//
// Constants rather than inline strings, for the reason `MAIL_COLUMNS` is one:
// nothing in `tsc` can catch a column name inside a string, and PostgREST
// rejects the *whole* query on an unknown column — so one stale name here does
// not degrade the panel, it empties it while the data sits fine in the table.

export const JOB_POSTING_COLUMNS =
  "id,title,company,location,url,source_kind,valid_through,status,discovered_at";

export const JOB_PROFILE_COLUMNS = "id,name,enabled,sort,keywords,approval_threshold";

export const JOB_MATCH_COLUMNS =
  "id,posting_id,profile_id,gate_verdict,gate_reason,score,reasoning," +
  "matched_skills,missing_skills,evaluated_at,created_at";

export const JOB_APPLICATION_COLUMNS =
  "id,posting_id,profile_id,body,module_ids,missing_slots,status," +
  "approval_requested_at,approved_at,approved_via,queued_at,submitted_at,fail_reason," +
  "created_at,updated_at";

export const JOB_MODULE_COLUMNS =
  "id,name,slot,tags,lang,content,enabled,sort,updated_at";

/**
 * The embedded selects.
 *
 * Both child tables carry exactly one FK to each parent, so the embed is
 * unambiguous and needs no `!fkey` hint — unlike PathFinder's `TASK_SELECT_CTX`,
 * where `pf_tasks` reaches `pf_goals` two ways. If a second FK is ever added,
 * PostgREST starts rejecting these outright (300 Multiple Choices) rather than
 * guessing, and the fix is to name the constraint here.
 */
export const JOB_APPLICATION_SELECT =
  `${JOB_APPLICATION_COLUMNS},` +
  `${JOB_POSTINGS_TABLE}(${JOB_POSTING_COLUMNS}),` +
  `${JOB_PROFILES_TABLE}(${JOB_PROFILE_COLUMNS})`;

export const JOB_MATCH_SELECT =
  `${JOB_MATCH_COLUMNS},` +
  `${JOB_POSTINGS_TABLE}(${JOB_POSTING_COLUMNS}),` +
  `${JOB_PROFILES_TABLE}(${JOB_PROFILE_COLUMNS})`;
