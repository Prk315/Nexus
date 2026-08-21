/**
 * Learn & Retain observatory — data layer (P1, read-only).
 *
 * Loads the full lr_* concept DAG + learner memory state from the shared
 * NEXUS Supabase project via Vault's existing authenticated client, and
 * assembles it into one LearnGraph for the 3D map + inspector.
 *
 * This file is pure data: no imports from palette.ts or any component, no
 * writes to lr_* (Vault never writes lr_* — the learning loop stays in
 * NexusLocal), no polling, no caching.
 */

import { supabase } from "../lib/supabase";

/** Which lr_ user owns the learner state. NOT Vault's auth uid.
 *  Every lr_memory_state / lr_retained_concept row in the DB is user_id='default'
 *  (verified 2026-08-21: 341 / 156 rows, zero other user_ids). Vault's
 *  getUserId() returns the real auth uid, and a user_id mismatch under
 *  `USING (true)` RLS returns an EMPTY SET, not an error — the map would render
 *  fully gray and look like "nothing learned" rather than like a bug. */
export const LEARN_USER_ID = "default";

// ── Memory math ──────────────────────────────────────────────────────────────
// Ported verbatim from apps/NexusLocal/src/lib/learn/memory.ts, which is
// itself a line-for-line port of LearnAndRetain's pipeline/memory/memory.py.
// Constants: HALF_LIFE_HOURS memory.py:34, PREREQ_THRESHOLD selector.py:38,
// MIN_EVIDENCE selector.py:39. Read-only here — Vault never writes lr_*.
const HALF_LIFE_HOURS = 24.0;
const DECAY_K = Math.log(2) / HALF_LIFE_HOURS;
const PREREQ_THRESHOLD = 0.6;
/** Exported for Map3D's mastery-lens glow test (mean>=0.8 && conf>=MIN_EVIDENCE). */
export const MIN_EVIDENCE = 4;

function valueMean(alpha: number, beta: number): number { return alpha / (alpha + beta); }
function valueConfidence(alpha: number, beta: number): number { return alpha + beta; }

function decayHeat(heat: number, lastDecayedIso: string, now: Date): number {
  const hours = (now.getTime() - new Date(lastDecayedIso).getTime()) / 3_600_000;
  if (hours <= 0) return heat;                       // memory.py guards this too
  return heat * Math.exp(-DECAY_K * hours);
}

function isStable(alpha: number, beta: number): boolean {
  return valueMean(alpha, beta) >= PREREQ_THRESHOLD
      && valueConfidence(alpha, beta) >= MIN_EVIDENCE;
}

// ── Types (frozen contract — Map3D / LearnMode / InspectorPanel code against these) ──

export interface LearnCourse {
  cId: number;
  title: string;
  active: boolean;
  conceptCount: number;
}

export interface LearnNode {
  /** lr_concept.concept_id — react-force-graph requires the key be `id`. */
  id: string;
  title: string;
  kind: string | null;          // NULL for 1043/1067 — see role fallback
  role: string | null;          // "concept" | "intuition"
  description: string | null;
  proof: string | null;
  topicId: number | null;
  topicTitle: string | null;
  courseId: number | null;      // resolved via lr_topic.c_id
  /** PageRank on the reversed prereq graph, normalized per course (0..1).
   *  0 when the column is NULL. */
  importance: number;
  /** Percentile of `importance` within this node's own course, 0..100.
   *  Computed client-side; the raw value is meaningless without it (p50=0.033). */
  importancePct: number;
  /** Beta mean, alpha/(alpha+beta) — memory.ts `valueMean`.
   *  null when the concept has no lr_memory_state row (726 of 1067 today).
   *  null ≠ 0: "never practiced" is not "practiced and failed". */
  mastery: number | null;
  /** alpha + beta — memory.ts `valueConfidence`. null with no state row. */
  confidence: number | null;
  /** Raw alpha/beta for the inspector's readout. null with no state row. */
  alpha: number | null;
  beta: number | null;
  /** Stored heat exponentially decayed to `loadedAt` — memory.ts `decayHeat`.
   *  0 when there is no state row. */
  heatNow: number;
  /** Raw stored heat, undecayed. Inspector shows both; the map only uses heatNow. */
  heatStored: number | null;
  lastReviewed: string | null;  // ISO
  /** memory.ts `isStable`: mean >= 0.6 && confidence >= 4. false with no state. */
  stable: boolean;
  /** Membership of lr_retained_concept (concepts of mastered units). */
  retained: boolean;
  prereqIds: string[];   // incoming: what this concept stands on
  unlockIds: string[];   // outgoing: what this concept unlocks

  /** ── Mutated in place by three-forcegraph. Declared so TS doesn't fight it.
   *  Never write these; never deep-clone a LearnNode (the clone loses its
   *  simulation position and its __threeObj). */
  x?: number; y?: number; z?: number;
  vx?: number; vy?: number; vz?: number;
  index?: number;
  __threeObj?: unknown;
}

export interface LearnLink {
  /** lr_concept_prereq.prereq_id — direction is prereq → dependent. */
  source: string;
  /** lr_concept_prereq.concept_id */
  target: string;
}

export interface LearnGraph {
  nodes: LearnNode[];
  links: LearnLink[];
  /** Holds the SAME object references as `nodes` — so the inspector reads live
   *  simulation state. Do not populate it with copies. */
  byId: Map<string, LearnNode>;
  courses: LearnCourse[];
  /** The instant heat was decayed to. Displayed as "as of …" in the HUD. */
  loadedAt: Date;
}

// ── Row shapes (what the six selects return) ────────────────────────────────

interface CourseRow { c_id: number; title: string; active: boolean }
interface TopicRow { t_id: number; c_id: number; title: string }
interface ConceptRow {
  concept_id: string; t_id: number | null; title: string;
  kind: string | null; role: string | null;
  description: string | null; proof: string | null; importance: number | null;
}
interface PrereqRow { prereq_id: string; concept_id: string }
interface MemoryRow {
  concept_id: string; value_alpha: number; value_beta: number;
  heat: number; last_reviewed: string | null; last_decayed: string | null;
}
interface RetainedRow { concept_id: string }

// ── Pagination ──────────────────────────────────────────────────────────────
// PostgREST caps at 1000 rows per request. `.range()` without a deterministic
// `.order()` can duplicate or skip rows across pages — Postgres gives no
// ordering guarantee otherwise. Every paginated read orders by its primary key.

const PAGE = 1000;

async function fetchAll<T>(
  build: () => any,          // () => supabase.from(t).select(cols).order(...)
  signal?: AbortSignal,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build()
      .range(from, from + PAGE - 1)
      .abortSignal(signal as AbortSignal);
    if (error) throw new Error(`[learn] ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

// ── Load + assemble ─────────────────────────────────────────────────────────

export async function loadLearnGraph(signal?: AbortSignal): Promise<LearnGraph> {
  const [courseRows, topicRows, conceptRows, prereqRows, memoryRows, retainedRows] =
    await Promise.all([
      fetchAll<CourseRow>(
        () => supabase.from("lr_course").select("c_id,title,active").order("c_id"),
        signal),
      fetchAll<TopicRow>(
        () => supabase.from("lr_topic").select("t_id,c_id,title").order("t_id"),
        signal),
      fetchAll<ConceptRow>(
        () => supabase.from("lr_concept")
          .select("concept_id,t_id,title,kind,role,description,proof,importance")
          .order("concept_id"),
        signal),
      fetchAll<PrereqRow>(
        () => supabase.from("lr_concept_prereq")
          .select("prereq_id,concept_id")
          .order("prereq_id").order("concept_id"),
        signal),
      fetchAll<MemoryRow>(
        () => supabase.from("lr_memory_state")
          .select("concept_id,value_alpha,value_beta,heat,last_reviewed,last_decayed")
          .eq("user_id", LEARN_USER_ID)
          .order("concept_id"),
        signal),
      fetchAll<RetainedRow>(
        () => supabase.from("lr_retained_concept")
          .select("concept_id")
          .eq("user_id", LEARN_USER_ID)
          .order("concept_id"),
        signal),
    ]);

  // 1. topic lookup
  const topicById = new Map<number, { cId: number; title: string }>();
  for (const t of topicRows) topicById.set(t.t_id, { cId: t.c_id, title: t.title });

  // 2. learner state lookups
  const memByConcept = new Map<string, MemoryRow>();
  for (const m of memoryRows) memByConcept.set(m.concept_id, m);
  const retainedSet = new Set<string>(retainedRows.map((r) => r.concept_id));

  // 3. One reference instant for the whole load — every heatNow decays to the
  //    same moment. Calling new Date() per node makes heat non-reproducible
  //    across a single load.
  const loadedAt = new Date();

  // 4. nodes
  const nodes: LearnNode[] = [];
  const byId = new Map<string, LearnNode>();
  for (const c of conceptRows) {
    const topic = c.t_id != null ? topicById.get(c.t_id) : undefined;
    const mem = memByConcept.get(c.concept_id);

    let mastery: number | null = null;
    let confidence: number | null = null;
    let stable = false;
    let heatNow = 0;
    let heatStored: number | null = null;
    let lastReviewed: string | null = null;
    if (mem) {
      mastery = valueMean(mem.value_alpha, mem.value_beta);
      confidence = valueConfidence(mem.value_alpha, mem.value_beta);
      stable = isStable(mem.value_alpha, mem.value_beta);
      heatStored = mem.heat;
      // last_decayed is never null today; defensively fall back to undecayed.
      heatNow = mem.last_decayed ? decayHeat(mem.heat, mem.last_decayed, loadedAt) : mem.heat;
      lastReviewed = mem.last_reviewed;
    }

    const node: LearnNode = {
      id: c.concept_id,
      title: c.title,
      kind: c.kind,
      role: c.role,
      description: c.description,
      proof: c.proof,
      topicId: c.t_id,
      topicTitle: topic?.title ?? null,
      courseId: topic?.cId ?? null,
      importance: c.importance ?? 0,
      importancePct: 0, // filled in pass 5
      mastery,
      confidence,
      alpha: mem ? mem.value_alpha : null,
      beta: mem ? mem.value_beta : null,
      heatNow,
      heatStored,
      lastReviewed,
      stable,
      retained: retainedSet.has(c.concept_id),
      prereqIds: [],
      unlockIds: [],
    };
    nodes.push(node);
    byId.set(node.id, node);
  }

  // 5. per-course importance percentile. Ties resolve to the highest index
  //    (last matching position in the ascending sort).
  const importancesByCourse = new Map<number, number[]>();
  for (const n of nodes) {
    if (n.courseId == null) continue;
    let arr = importancesByCourse.get(n.courseId);
    if (!arr) importancesByCourse.set(n.courseId, (arr = []));
    arr.push(n.importance);
  }
  const lastIndexByCourse = new Map<number, Map<number, number>>();
  for (const [cId, arr] of importancesByCourse) {
    arr.sort((a, b) => a - b);
    const lastIndex = new Map<number, number>();
    arr.forEach((v, i) => lastIndex.set(v, i)); // later writes win → last index
    lastIndexByCourse.set(cId, lastIndex);
  }
  for (const n of nodes) {
    if (n.courseId == null) { n.importancePct = 0; continue; }
    const arr = importancesByCourse.get(n.courseId)!;
    if (arr.length <= 1) { n.importancePct = 100; continue; }
    const idx = lastIndexByCourse.get(n.courseId)!.get(n.importance) ?? 0;
    n.importancePct = (100 * idx) / (arr.length - 1);
  }

  // 6+7. links + prereq/unlock adjacency in one pass. Skip rows with an
  //      unknown endpoint — the FKs make this impossible today, but an unknown
  //      endpoint makes three-forcegraph drop the link with a console warning
  //      and no visible cause.
  const links: LearnLink[] = [];
  for (const e of prereqRows) {
    const prereq = byId.get(e.prereq_id);
    const dependent = byId.get(e.concept_id);
    if (!prereq || !dependent) continue;
    links.push({ source: e.prereq_id, target: e.concept_id });
    dependent.prereqIds.push(e.prereq_id);
    prereq.unlockIds.push(e.concept_id);
  }

  // 8. courses: count concepts; drop a course only when it is BOTH inactive
  //    and empty (never silently hide 690 concepts because a flag drifted).
  const countByCourse = new Map<number, number>();
  for (const n of nodes) {
    if (n.courseId == null) continue;
    countByCourse.set(n.courseId, (countByCourse.get(n.courseId) ?? 0) + 1);
  }
  const courses: LearnCourse[] = courseRows
    .map((c) => ({
      cId: c.c_id,
      title: c.title,
      active: c.active,
      conceptCount: countByCourse.get(c.c_id) ?? 0,
    }))
    .filter((c) => c.conceptCount > 0 || c.active)
    .sort((a, b) => a.cId - b.cId);

  return { nodes, links, byId, courses, loadedAt };
}
