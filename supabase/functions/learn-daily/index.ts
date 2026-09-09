// Supabase Edge Function: learn-daily
//
// Writes ONE `lr_daily_lesson` row per (user, day): "dagens lektion", built from
// the LearnAndRetain concept DAG and oriented toward the courses the learner is
// actually taking this term. See apps/NexusLocal/LEARN_PLAN.md, "Dagens lektion
// — daily course-oriented lessons (pinned, 2026-09-09)".
//
// Runs on pg_cron alongside `nexus-learn-evaluate` (CLAUDE.md, "Scheduled
// server-side work"). It is a no-op whenever today's row already exists, so it
// can be scheduled often — that frequency is what covers COLD START: enrolling
// a course at noon produces a lesson within the half hour instead of tomorrow.
//
// ── Why this function exists next to learn-evaluate rather than inside it ────
//
// `learn-evaluate` answers "what is due for review?" and it answers it ONLY for
// `lr_retained_concept` — concepts belonging to a MASTERED UNIT. That is correct
// for the hand-authored courses (LA, DBMS), which have units. It is also why it
// is blind to every book-ingested course: Probabilistic Robotics has 231
// concepts, 369 prereq edges and **zero units**, so no concept of it can ever
// enter `lr_retained_concept`, and no amount of studying it would put a single
// entry in `lr_learn_state.due_concepts`.
//
// That is the whole gap this function closes. A course you are taking RIGHT NOW
// has a graph long before anyone has hand-authored a 28-unit path for it, and
// waiting for the path means the tool is useless during the term it was needed.
// So `learn-daily` selects over `lr_memory_state` scoped by ENROLLMENT, not by
// unit mastery.
//
// Consequence worth stating: heat for these concepts is never decayed by
// `learn-evaluate` either (it persists decay only for retained concepts). This
// function therefore decays ON READ and does NOT write it back. Two writers on
// `lr_memory_state.heat` — one server-side sweep and one client grading path —
// is a lost-update race for no benefit, since decay is a pure function of
// elapsed time and can be recomputed by anyone who needs it.
//
// ── The three things the graph alone cannot tell you ────────────────────────
//
//   1. WHERE THE COURSE IS. A DAG frontier has no notion of "the lecture has
//      not been there yet", so a pure graph walk happily serves chapter 9 in
//      teaching week 2. `lr_course_enrollment` supplies a chapter ceiling.
//   2. WHAT TODAY IS FOR. Two days before an exercise class you need to be able
//      to SOLVE; the day after a lecture you need to consolidate what was just
//      said. The phase is derived from the course's teaching weekdays — never a
//      user preference, because the calendar already knows the answer.
//   3. WHICH COURSE MATTERS MOST TODAY. An assignment due tomorrow outranks a
//      quiz in nine days. Graded events come from the course's PathFinder plan.
//
// ── What a card is ─────────────────────────────────────────────────────────
//
// Deterministic, generated from the DAG rows themselves — `title`,
// `description`, `source_ref` and the prereq edges. No model is called. That is
// a deliberate first lane, not a placeholder: it costs nothing, it cannot
// hallucinate a definition the book never gave, it works the day a book lands,
// and it is a real study loop (read → recall → cloze → connect). LLM-drafted
// drills are strictly additive on top (they land in `lr_unit_content` as
// `draft` and get curated to `live` by a human, per the existing doctrine that
// agents only ever write drafts).
//
// The `link` card is the one only a graph can produce, and it is the reason to
// build this on a DAG at all: "X is a prerequisite of Y — why?" is the question
// that turns a pile of definitions into a structure.
//
// ── Failure posture ────────────────────────────────────────────────────────
//
// Every query failure aborts BEFORE the write, exactly like `focus-evaluate`
// and `learn-evaluate`: no row at all beats a fresh-looking row built from a
// half-failed read. `lr_daily_lesson` is deliberately never seeded — missing
// means "no lesson computed", never "nothing to do today".

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const DEFAULT_USER = "default";
const TIMEZONE = "Europe/Copenhagen";

// Heat decay — ported from memory.py:34-35, same constants learn-evaluate uses.
const HALF_LIFE_HOURS = 24.0;
const DECAY_K = Math.log(2) / HALF_LIFE_HOURS;

// Due thresholds — LEARN_PLAN.md Phase 3 contract, same numbers as
// learn-evaluate so "due" means one thing across both functions.
const DUE_HEAT_THRESHOLD = 0.5;
const DUE_COMP_THRESHOLD = 0.6;
const EVIDENCE_CAP = 8;
const LAMBDA = 0.5;

// A concept counts as INTRODUCED once it has any attempt behind it. That is a
// deliberately low bar: it gates the ORDER new material is offered in, not
// whether it is considered learned.
const INTRODUCED_MIN_EVIDENCE = 1;
// …and as KNOWN (so its dependents are properly unlocked) at the same
// competence bar the review path uses.
const KNOWN_COMP = DUE_COMP_THRESHOLD;

// Card time model (seconds). `minutes_target` is spent against this, so the
// number on the panel means something rather than being decoration.
const CARD_SECONDS: Record<CardKind, number> = {
  read: 45,
  recall: 60,
  cloze: 50,
  link: 90,
};

// Phase → how the day's cards split. Read as: before you must PERFORM
// (exercise class), practise; right after input (lecture), consolidate;
// otherwise keep the older material alive.
const PHASE_MIX: Record<Phase, { fresh: number; review: number; link: number }> = {
  prime: { fresh: 0.60, review: 0.25, link: 0.15 },
  consolidate: { fresh: 0.35, review: 0.50, link: 0.15 },
  maintain: { fresh: 0.20, review: 0.65, link: 0.15 },
};

// Graded-event urgency. A course with something due soon takes a bigger share.
const URGENCY_STEPS: Array<{ withinDays: number; factor: number }> = [
  { withinDays: 1, factor: 2.5 },
  { withinDays: 3, factor: 1.8 },
  { withinDays: 7, factor: 1.3 },
];

// ⚠️ PathFinder plans hold attendance tasks ("Lecture: MatAn3") next to real
// graded events. Boosting on every dated task would make every course urgent
// every day, i.e. no urgency at all. Only these count, and the matching task is
// recorded in the verdict so the boost is auditable rather than mysterious.
// `assignm` and not `assignment` on purpose: the live plan holds "Home
// Assignmetn 1". A hand-typed task title is the input here, so the tokens are
// deliberately short enough to survive a typo — an urgency signal that misses
// because of one transposed letter is worse than one that occasionally fires.
const GRADED_RE =
  /(quiz|afleve|assignm|hand[- ]?in|exam|eksamen|prøve|deadline|rapport|report|projekt)/i;
const ATTENDANCE_RE = /^(lecture|forelæsning|forelaesning|excerciseclass|exerciseclass|theory class|øvelser|lab)/i;

// A concept served in the last N days is not served again as NEW material.
// Review is exempt — repetition is the point there.
const REPEAT_WINDOW_DAYS = 3;

// Book prose runs long; a card must fit a phone screen.
const MAX_ANSWER_CHARS = 420;

// ⚠️ The book ingest keeps STRUCTURAL sections as concepts — "ACKNOWLEDGMENTS",
// "INTRODUCTION", "Example". They are legitimate rows (they have prose, and
// PageRank even ranks "PR 2.1 INTRODUCTION" at 0.95 because everything cites
// it), but as a CARD PROMPT they carry no information: "INTRODUCTION → recall
// what it said" is not a question about anything.
//
// Filtering here rather than at ingest is deliberate: the graphs are already
// built and committed, several took a full night of judging, and this is a
// presentation concern rather than a claim that the row is wrong.
const STRUCTURAL_TITLES = new Set([
  "introduction", "introduktion", "acknowledgments", "acknowledgements",
  "preface", "forord", "foreword", "contents", "table of contents", "index",
  "bibliography", "references", "further reading", "summary", "sammenfatning",
  "conclusion", "conclusions", "overview", "notation", "appendix",
  "exercises", "problems", "example", "examples", "eksempel", "remark",
  "remarks", "notes", "discussion", "about the author", "about the authors",
  "organization of this book", "who should read this book", "chapter summary",
  "historical remarks", "bibliographical remarks", "outline",
]);

// A description this short has nothing to retrieve from.
const MIN_DESCRIPTION_CHARS = 80;

// Bounds on what counts as a single blankable statement rather than a passage.
const STATEMENT_MAX_CHARS = 240;
const STATEMENT_MAX_BLANK = 90;

const DEFAULT_MINUTES = 12;

type CardKind = "read" | "recall" | "cloze" | "link";
type Phase = "prime" | "consolidate" | "maintain";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

class QueryFailure extends Error {
  readonly table: string;
  constructor(table: string, detail: string) {
    super(`${table}: ${detail}`);
    this.name = "QueryFailure";
    this.table = table;
  }
}

function unwrap<T>(
  table: string,
  res: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (res.error) throw new QueryFailure(table, res.error.message);
  return res.data ?? [];
}

/** Local "YYYY-MM-DD" in `tz`. */
function localDate(d: Date, tz: string = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Whole-day arithmetic on a "YYYY-MM-DD", via UTC noon to dodge DST. */
function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const [y1, m1, d1] = fromYmd.split("-").map(Number);
  const [y2, m2, d2] = toYmd.split("-").map(Number);
  return Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
  );
}

/**
 * Weekday as **0 = Sunday**, matching `pf_recurring_cal_blocks` and
 * `lr_course_enrollment.lecture_dow`. ⚠️ NOT ISO 1–7: CLAUDE.md flags this as a
 * live trap in this database, and reading it as ISO shifts every lesson a day.
 */
function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// ── Row shapes (only the columns read here) ─────────────────────────────────

interface EnrollmentRow {
  user_id: string;
  c_id: number;
  label: string;
  plan_id: number | null;
  chapter_prefix: string;
  term_start: string;
  week1_chapter: number;
  chapters_per_week: number;
  chapter_override: number | null;
  lecture_dow: number | null;
  exercise_dow: number | null;
  weight: number;
  active: boolean;
}

interface TopicRow {
  t_id: number;
  c_id: number | null;
  title: string | null;
}

interface ConceptRow {
  concept_id: string;
  t_id: number | null;
  title: string | null;
  description: string | null;
  source_ref: string | null;
  role: string | null;
  importance: number | null;
}

interface PrereqRow {
  prereq_id: string;
  concept_id: string;
}

interface MemoryRow {
  concept_id: string;
  value_alpha: number;
  value_beta: number;
  heat: number;
  last_decayed: string | null;
}

interface TaskRow {
  id: number;
  plan_id: number | null;
  title: string | null;
  due_date: string | null;
  done: boolean | null;
}

// ── Derived per-concept view ───────────────────────────────────────────────

interface Concept {
  id: string;
  cId: number;
  title: string;
  description: string;
  sourceRef: string;
  chapter: number;
  topic: string;
  importance: number;
  prereqs: string[];
}

interface Mem {
  mean: number;
  confidence: number;
  heat: number;
  decayedHeat: number;
}

interface Card {
  id: string;
  kind: CardKind;
  c_id: number;
  course: string;
  concept_id: string;
  title: string;
  topic: string;
  chapter: number;
  source_ref: string;
  prompt: string;
  answer: string;
  seconds: number;
  why: string;
  blank?: string;
  prereq_id?: string;
  prereq_title?: string;
}

interface CourseVerdict {
  c_id: number;
  label: string;
  phase: Phase;
  chapter_ceiling: number;
  teaching_week: number;
  quota: number;
  cards: number;
  gate: "strict" | "relaxed";
  urgency: number;
  urgency_reason: string | null;
  pool: { fresh: number; due: number; edges: number };
  note?: string;
}

// ── Memory helpers ─────────────────────────────────────────────────────────

/** Verbatim port of memory.py's `_decay_heat` (lines 99-104). */
function decayHeat(heat: number, lastDecayedIso: string | null, now: Date): number {
  if (!lastDecayedIso) return heat;
  const hours = (now.getTime() - new Date(lastDecayedIso).getTime()) / 3_600_000;
  if (hours <= 0) return heat;
  return heat * Math.exp(-DECAY_K * hours);
}

function toMem(row: MemoryRow, now: Date): Mem {
  const a = row.value_alpha ?? 1;
  const b = row.value_beta ?? 1;
  return {
    mean: a / (a + b),
    confidence: a + b - 2, // evidence beyond the Beta(1,1) prior
    heat: row.heat ?? 0,
    decayedHeat: decayHeat(row.heat ?? 0, row.last_decayed, now),
  };
}

/** selector.py:111-134 — retention/competence blend, then importance-weighted. */
function reviewPriority(mem: Mem, importance: number): number {
  const evidence = Math.min(Math.max((mem.confidence - 2) / EVIDENCE_CAP, 0), 1);
  const retention = (1 - mem.decayedHeat) * mem.mean * evidence;
  const competence = 1 - mem.mean;
  return (LAMBDA * retention + (1 - LAMBDA) * competence) * importance;
}

function isDue(mem: Mem): boolean {
  return mem.decayedHeat < DUE_HEAT_THRESHOLD || mem.mean < DUE_COMP_THRESHOLD;
}

// ── Text shaping ───────────────────────────────────────────────────────────

/** Trim book prose to a sentence boundary under the card budget. */
function shorten(text: string, max = MAX_ANSWER_CHARS): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  return (stop > max * 0.5 ? cut.slice(0, stop + 1) : cut.trimEnd() + "…").trim();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Blank every occurrence of the concept's own name in its description.
 *
 * Returns null rather than a bad card whenever the result would not be a fair
 * question: the term never occurs, the term is too short to be a real term, or
 * blanking would erase so much of the passage that nothing is left to reason
 * from. A cloze with no recoverable context is not a hard card, it is an
 * unanswerable one — and unanswerable cards teach the learner to press "husker
 * ikke", which poisons the memory signal for every card after it.
 */
function makeCloze(title: string, description: string): { prompt: string; blank: string } | null {
  const term = title.trim();
  if (term.length < 4) return null;
  const body = shorten(description);
  const re = new RegExp(`\\b${escapeRe(term)}\\b`, "gi");
  const hits = body.match(re);
  if (!hits) return null;
  const blanked = body.replace(re, "____");
  const removed = hits.join("").length;
  if (removed > body.length * 0.3) return null;
  // A blank in the first few characters gives nothing to read up to.
  if (blanked.indexOf("____") < 12 && blanked.length < 120) return null;
  return { prompt: blanked, blank: term };
}

const norm = (s: string) => s.replace(/[*_`]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Is this concept a NAMED thing ("State", "Bayes filter") or a STATEMENT that
 * the ingest stored with its own first words as the title?
 *
 * ⚠️ This distinction is not cosmetic, and the live data forced it. Kalkulus is
 * a Norwegian textbook of theorems, and its concepts came out as
 * `title = "n forskjellige gjenstander kan arrangeres etter"` with
 * `description = "n forskjellige gjenstander kan arrangeres etter hverandre på
 * n! ulike måter."` — the title is a PREFIX of the description. Served as a
 * "recall" card that reads: prompt "n forskjellige gjenstander kan arrangeres
 * etter", answer the same sentence plus four words. The answer is visible in
 * the question; there is nothing to retrieve.
 *
 * A named concept gets read → retrieve. A statement gets its ENDING blanked
 * instead, which turns the same row into a genuine question ("…kan arrangeres
 * etter hverandre på ____"). Same data, opposite card.
 */
function isStatement(title: string, description: string): boolean {
  const t = norm(title);
  const d = norm(description);
  return t.length > 20 && d.startsWith(t.slice(0, Math.min(t.length, 40)));
}

/**
 * Blank the TAIL of a statement — the payload of the sentence, which is exactly
 * the part a title-prefix leaves visible.
 */
function makeTailCloze(description: string): { prompt: string; blank: string } | null {
  const body = shorten(description);
  if (body.length < MIN_DESCRIPTION_CHARS) return null;

  // ⚠️ Only a SINGLE STATEMENT may have its ending blanked. Applied to a
  // paragraph this produces "…Examples of successful robot ____" with two
  // hundred characters of prose as the answer — a question with no answerable
  // shape, which is worse than no card, because the learner grades it "husker
  // ikke" and the memory model records a failure that was the card's fault.
  //
  // A named concept whose paragraph cannot be clozed falls back to a plain
  // title → definition recall instead, which is always fair.
  if (body.length > STATEMENT_MAX_CHARS) return null;
  const sentences = (body.match(/[.!?](\s|$)/g) ?? []).length;
  if (sentences > 2) return null;

  const words = body.split(" ");
  if (words.length < 10) return null;
  const cut = Math.max(6, Math.round(words.length * 0.6));
  const head = words.slice(0, cut).join(" ");
  const tail = words.slice(cut).join(" ").replace(/\s*[:;,]\s*$/, "");
  if (tail.length < 8 || tail.length > STATEMENT_MAX_BLANK) return null;
  return { prompt: `${head} ____`, blank: tail };
}

/**
 * Would this concept make a card at all?
 *
 * Rejecting here keeps the junk out of the POOL COUNTS too, so the verdict's
 * `pool.fresh` is the number of concepts that can actually be taught rather
 * than the number of rows in the chapter — which is the figure anyone would use
 * to judge whether a course is ready.
 */
function isTeachable(title: string, description: string): boolean {
  if (STRUCTURAL_TITLES.has(norm(title))) return false;
  if (/^(chapter|kapitel|kapittel|section|afsnit)\s+[\divx.]+$/i.test(title.trim())) return false;
  const d = norm(description);
  if (d.length < MIN_DESCRIPTION_CHARS) return false;
  // Description that adds nothing to the title: no question can be asked.
  if (d === norm(title)) return false;
  return true;
}

// ── Chapter / phase ────────────────────────────────────────────────────────

/**
 * Chapter number out of a topic title like "PR 2.4" / "KAL 1.3".
 *
 * The prefix must match the enrollment's `chapter_prefix`, which is what lets a
 * single `lr_course` hold two books — course 7 mixes "DM …" and "OPT …" topics
 * — without the pacing model averaging two unrelated chapter numberings.
 */
function chapterOf(topicTitle: string | null, prefix: string): number | null {
  if (!topicTitle) return null;
  const m = topicTitle.trim().match(new RegExp(`^${escapeRe(prefix)}\\s+(\\d+)`, "i"));
  return m ? Number(m[1]) : null;
}

function teachingWeek(termStart: string, today: string): number {
  return Math.floor(daysBetween(termStart, today) / 7) + 1; // 1-based
}

function phaseOf(today: string, e: EnrollmentRow): Phase {
  const dow = weekdayOf(today);
  const untilExercise = e.exercise_dow == null ? 99 : (e.exercise_dow - dow + 7) % 7;
  const untilLecture = e.lecture_dow == null ? 99 : (e.lecture_dow - dow + 7) % 7;
  const sinceLecture = e.lecture_dow == null ? 99 : (dow - e.lecture_dow + 7) % 7;

  // Order matters: an exercise class is where you must PERFORM, so readiness for
  // it outranks priming for a lecture you will merely sit through.
  if (untilExercise <= 1) return "consolidate";
  if (untilLecture <= 1) return "prime";
  if (sinceLecture <= 2) return "consolidate";
  return "maintain";
}

function chapterCeiling(e: EnrollmentRow, today: string, phase: Phase): number {
  if (e.chapter_override != null) return e.chapter_override;
  const week = teachingWeek(e.term_start, today);
  const base = e.week1_chapter + Math.floor((week - 1) * Number(e.chapters_per_week));
  // Priming is allowed to reach one chapter past what has been taught — that is
  // what "read before the lecture" means. Nothing else may.
  return phase === "prime" ? base + 1 : base;
}

// ── Selection ──────────────────────────────────────────────────────────────

interface CoursePool {
  fresh: Concept[];
  due: Array<{ concept: Concept; priority: number }>;
  edges: Array<{ from: Concept; to: Concept }>;
  gate: "strict" | "relaxed";
}

/**
 * Rank in-window, not-yet-known concepts by how ready the learner is for them.
 *
 * ⚠️ A STRICT prereq gate starves on day one. Enrolling a course means zero
 * memory rows for all of it, so "every prerequisite already known" admits only
 * the graph's roots — four or five concepts — and the course then serves
 * nothing until those are mastered. That reads as a broken feature, not as
 * pedagogy.
 *
 * So readiness is a FRACTION, not a gate: concepts whose in-window prerequisites
 * are all introduced come first, partially-ready ones fill the remainder, and
 * chapter order breaks the rest. The DAG still decides the ORDER — it just
 * cannot decide to hand back an empty day. Which of the two happened is
 * reported as `gate` rather than hidden.
 */
function rankFresh(
  concepts: Concept[],
  ceiling: number,
  mem: Map<string, Mem>,
  excluded: Set<string>,
): { list: Concept[]; gate: "strict" | "relaxed" } {
  const known = (id: string) => {
    const m = mem.get(id);
    return !!m && m.mean >= KNOWN_COMP && m.confidence >= INTRODUCED_MIN_EVIDENCE;
  };
  const introduced = (id: string) => {
    const m = mem.get(id);
    return !!m && m.confidence >= INTRODUCED_MIN_EVIDENCE;
  };

  const inWindow = new Set(
    concepts.filter((c) => c.chapter <= ceiling).map((c) => c.id),
  );

  const candidates = concepts.filter(
    (c) => c.chapter <= ceiling && !known(c.id) && !excluded.has(c.id),
  );

  const scored = candidates.map((c) => {
    const gating = c.prereqs.filter((p) => inWindow.has(p));
    const met = gating.filter((p) => introduced(p)).length;
    const readiness = gating.length === 0 ? 1 : met / gating.length;
    return { c, readiness };
  });

  scored.sort((a, b) =>
    b.readiness - a.readiness ||
    a.c.chapter - b.c.chapter ||
    b.c.importance - a.c.importance ||
    a.c.id.localeCompare(b.c.id)
  );

  const ready = scored.filter((s) => s.readiness >= 1).length;
  return {
    list: scored.map((s) => s.c),
    gate: ready > 0 ? "strict" : "relaxed",
  };
}

/** Build the day's cards for one course, spending its quota against the clock. */
function buildCards(
  pool: CoursePool,
  quota: number,
  phase: Phase,
  label: string,
  cIdx: number,
): Card[] {
  const mix = PHASE_MIX[phase];
  const nLink = Math.min(pool.edges.length, Math.round(quota * mix.link));
  const nReview = Math.min(pool.due.length, Math.round(quota * mix.review));

  // ⚠️ A new concept costs TWO slots, not one: it is always served as a PAIR
  // (read the statement, then immediately retrieve it). The quota counts CARDS,
  // so dividing here is what keeps `minutes_target` honest — without it every
  // day came out at double its stated length, and the number on the panel would
  // be decoration rather than a promise.
  const freshSlots = Math.max(0, quota - nLink - nReview);
  const nFresh = Math.floor(freshSlots / 2);
  // An odd leftover slot becomes one extra retrieval rather than half a pair.
  const spare = freshSlots - nFresh * 2;

  const out: Card[] = [];
  let seq = 0;
  const mk = (c: Omit<Card, "id" | "seconds">): Card => ({
    ...c,
    id: `${cIdx}-${seq++}`,
    seconds: CARD_SECONDS[c.kind],
  });

  // NEW material: read the statement, then immediately try to recall it. The
  // pair is the point — a read alone leaves no trace, and a recall on something
  // never seen is a guess.
  for (const c of pool.fresh.slice(0, nFresh)) {
    const base = {
      c_id: c.cId,
      course: label,
      concept_id: c.id,
      title: c.title,
      topic: c.topic,
      chapter: c.chapter,
      source_ref: c.sourceRef,
    };
    const statement = isStatement(c.title, c.description);
    const why = `ny · kap. ${c.chapter}`;

    out.push(mk({
      ...base,
      kind: "read",
      // A statement's title is its own opening words, so showing both is
      // showing the sentence twice. The topic code is the honest heading.
      prompt: statement ? c.topic : c.title,
      answer: shorten(c.description),
      why,
    }));

    // Retrieval half: blank the term for a named concept, blank the payload for
    // a statement, and only fall back to a bare title→definition recall when
    // neither is possible.
    const cloze = statement
      ? makeTailCloze(c.description)
      : (makeCloze(c.title, c.description) ?? makeTailCloze(c.description));
    out.push(cloze
      ? mk({
        ...base,
        kind: "cloze",
        prompt: cloze.prompt,
        answer: cloze.blank,
        blank: cloze.blank,
        why,
      })
      : mk({
        ...base,
        kind: "recall",
        prompt: c.title,
        answer: shorten(c.description),
        why,
      }));
  }

  // REVIEW: recall only. Re-reading something you already met is the illusion
  // of studying; retrieval is the thing that moves the memory model.
  // The spare slot (from an odd fresh budget) goes here — one more retrieval,
  // falling back to the next fresh concept when nothing is due yet.
  const reviewTake = pool.due.slice(0, nReview + spare);
  for (const { concept: c } of reviewTake) {
    const base = {
      c_id: c.cId,
      course: label,
      concept_id: c.id,
      title: c.title,
      topic: c.topic,
      chapter: c.chapter,
      source_ref: c.sourceRef,
    };
    // Same statement-vs-named split as the fresh path: a review card built as
    // "prompt = title" on a statement concept shows its own answer.
    const cloze = isStatement(c.title, c.description)
      ? makeTailCloze(c.description)
      : null;
    out.push(cloze
      ? mk({ ...base, kind: "cloze", prompt: cloze.prompt, answer: cloze.blank, blank: cloze.blank, why: "genopfriskning" })
      : mk({ ...base, kind: "recall", prompt: c.title, answer: shorten(c.description), why: "genopfriskning" }));
  }

  // LINK: the card only the DAG can produce.
  for (const e of pool.edges.slice(0, nLink)) {
    out.push(mk({
      c_id: e.to.cId,
      course: label,
      concept_id: e.to.id,
      title: e.to.title,
      topic: e.to.topic,
      chapter: e.to.chapter,
      source_ref: e.to.sourceRef,
      kind: "link",
      prompt: `Hvorfor er **${e.from.title}** en forudsætning for **${e.to.title}**?`,
      answer: `${e.from.title}: ${shorten(e.from.description, 220)}\n\n${e.to.title}: ${shorten(e.to.description, 220)}`,
      prereq_id: e.from.id,
      prereq_title: e.from.title,
      why: "sammenhæng",
    }));
  }

  return out;
}

/** Interleave courses so the day never runs as three separate blocks. */
function interleave(groups: Card[][]): Card[] {
  const out: Card[] = [];
  const max = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < max; i++) {
    for (const g of groups) if (i < g.length) out.push(g[i]);
  }
  return out;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function generate(
  db: SupabaseClient,
  userId: string,
  today: string,
  minutesTarget: number,
): Promise<{ cards: Card[]; courses: CourseVerdict[] }> {
  const now = new Date();

  const enrollments = unwrap<EnrollmentRow>(
    "lr_course_enrollment",
    await db.from("lr_course_enrollment").select("*")
      .eq("user_id", userId).eq("active", true),
  );
  if (enrollments.length === 0) return { cards: [], courses: [] };

  const cIds = enrollments.map((e) => e.c_id);

  const topics = unwrap<TopicRow>(
    "lr_topic",
    await db.from("lr_topic").select("t_id, c_id, title").in("c_id", cIds),
  );
  const topicById = new Map(topics.map((t) => [t.t_id, t]));
  const tIds = topics.map((t) => t.t_id);

  const conceptRows: ConceptRow[] = [];
  // PostgREST caps a URL; chunk the .in() rather than risk a truncated read
  // silently becoming "this course has no concepts".
  for (let i = 0; i < tIds.length; i += 200) {
    conceptRows.push(...unwrap<ConceptRow>(
      "lr_concept",
      await db.from("lr_concept")
        .select("concept_id, t_id, title, description, source_ref, role, importance")
        .in("t_id", tIds.slice(i, i + 200)),
    ));
  }

  const conceptIds = conceptRows.map((c) => c.concept_id);
  const prereqRows: PrereqRow[] = [];
  for (let i = 0; i < conceptIds.length; i += 200) {
    prereqRows.push(...unwrap<PrereqRow>(
      "lr_concept_prereq",
      await db.from("lr_concept_prereq").select("prereq_id, concept_id")
        .in("concept_id", conceptIds.slice(i, i + 200)),
    ));
  }

  const memRows = unwrap<MemoryRow>(
    "lr_memory_state",
    await db.from("lr_memory_state")
      .select("concept_id, value_alpha, value_beta, heat, last_decayed")
      .eq("user_id", userId),
  );
  const mem = new Map<string, Mem>(
    memRows.map((r) => [r.concept_id, toMem(r, now)]),
  );

  // Graded events, per enrolled course's PathFinder plan.
  const planIds = enrollments.map((e) => e.plan_id).filter((p): p is number => p != null);
  const tasks = planIds.length === 0 ? [] : unwrap<TaskRow>(
    "pf_tasks",
    await db.from("pf_tasks").select("id, plan_id, title, due_date, done")
      .in("plan_id", planIds).eq("done", false)
      .gte("due_date", today).lte("due_date", shiftDate(today, 14)),
  );

  // Concepts already served as NEW material in the last few days.
  const recent = unwrap<{ cards: Card[] }>(
    "lr_daily_lesson",
    await db.from("lr_daily_lesson").select("cards")
      .eq("user_id", userId)
      .gte("lesson_date", shiftDate(today, -REPEAT_WINDOW_DAYS))
      .lt("lesson_date", today),
  );
  const recentlyServed = new Set<string>();
  for (const row of recent) {
    for (const card of row.cards ?? []) {
      if (card.kind === "read" || card.kind === "cloze") recentlyServed.add(card.concept_id);
    }
  }

  const prereqsOf = new Map<string, string[]>();
  for (const p of prereqRows) {
    const list = prereqsOf.get(p.concept_id) ?? [];
    list.push(p.prereq_id);
    prereqsOf.set(p.concept_id, list);
  }

  // ── Per-course pools + weights ───────────────────────────────────────────
  const perCourse = enrollments.map((e) => {
    const phase = phaseOf(today, e);
    const ceiling = chapterCeiling(e, today, phase);
    const week = teachingWeek(e.term_start, today);

    const concepts: Concept[] = [];
    for (const row of conceptRows) {
      const topic = row.t_id == null ? null : topicById.get(row.t_id);
      if (!topic || topic.c_id !== e.c_id) continue;
      const chapter = chapterOf(topic.title, e.chapter_prefix);
      if (chapter == null) continue; // another book inside the same lr_course
      if (!row.title || !row.description) continue; // nothing to build a card from
      if (!isTeachable(row.title, row.description)) continue;
      concepts.push({
        id: row.concept_id,
        cId: e.c_id,
        title: row.title.trim(),
        description: row.description,
        sourceRef: row.source_ref ?? "",
        chapter,
        topic: (topic.title ?? "").trim(),
        importance: row.importance ?? 0.5,
        prereqs: prereqsOf.get(row.concept_id) ?? [],
      });
    }
    const byId = new Map(concepts.map((c) => [c.id, c]));

    const { list: fresh, gate } = rankFresh(concepts, ceiling, mem, recentlyServed);

    const due = concepts
      .filter((c) => {
        const m = mem.get(c.id);
        return !!m && m.confidence >= INTRODUCED_MIN_EVIDENCE && isDue(m);
      })
      .map((c) => ({ concept: c, priority: reviewPriority(mem.get(c.id)!, c.importance) }))
      .sort((a, b) => b.priority - a.priority || a.concept.id.localeCompare(b.concept.id));

    // An edge is worth asking about only once at least one END is familiar —
    // otherwise "why does X need Y?" is two unknowns and a guess.
    const edges = prereqRows
      .filter((p) => {
        const from = byId.get(p.prereq_id);
        const to = byId.get(p.concept_id);
        if (!from || !to) return false;
        if (from.chapter > ceiling || to.chapter > ceiling) return false;
        const mf = mem.get(from.id), mt = mem.get(to.id);
        return (mf?.confidence ?? 0) >= INTRODUCED_MIN_EVIDENCE ||
               (mt?.confidence ?? 0) >= INTRODUCED_MIN_EVIDENCE;
      })
      .map((p) => ({ from: byId.get(p.prereq_id)!, to: byId.get(p.concept_id)! }))
      .sort((a, b) => b.to.importance - a.to.importance || a.to.id.localeCompare(b.to.id));

    // Urgency from the course's next graded event.
    let urgency = 1;
    let urgencyReason: string | null = null;
    for (const t of tasks) {
      if (t.plan_id !== e.plan_id || !t.due_date) continue;
      const title = (t.title ?? "").trim();
      if (ATTENDANCE_RE.test(title) || !GRADED_RE.test(title)) continue;
      const inDays = daysBetween(today, t.due_date.slice(0, 10));
      if (inDays < 0) continue;
      for (const step of URGENCY_STEPS) {
        if (inDays <= step.withinDays && step.factor > urgency) {
          urgency = step.factor;
          urgencyReason = `${title} om ${inDays} dag${inDays === 1 ? "" : "e"}`;
        }
      }
    }

    return {
      e, phase, ceiling, week, gate, urgency, urgencyReason,
      pool: { fresh, due, edges, gate } as CoursePool,
    };
  });

  // ── Quotas: split the clock, not the card count ──────────────────────────
  // Cards cost different amounts of time, so a course's share is spent against
  // CARD_SECONDS. `minutes_target` therefore means what it says.
  const totalSeconds = minutesTarget * 60;
  const avgSeconds = (CARD_SECONDS.read + CARD_SECONDS.recall + CARD_SECONDS.cloze) / 3;
  const totalCards = Math.max(1, Math.round(totalSeconds / avgSeconds));

  const weights = perCourse.map((p) =>
    p.pool.fresh.length + p.pool.due.length + p.pool.edges.length === 0
      ? 0
      : Number(p.e.weight) * p.urgency
  );
  const weightSum = weights.reduce((a, b) => a + b, 0);

  const groups: Card[][] = [];
  const verdicts: CourseVerdict[] = [];

  perCourse.forEach((p, i) => {
    const quota = weightSum === 0 ? 0 : Math.round(totalCards * (weights[i] / weightSum));
    const cards = quota === 0 ? [] : buildCards(p.pool, quota, p.phase, p.e.label, p.e.c_id);
    groups.push(cards);
    verdicts.push({
      c_id: p.e.c_id,
      label: p.e.label,
      phase: p.phase,
      chapter_ceiling: p.ceiling,
      teaching_week: p.week,
      quota,
      cards: cards.length,
      gate: p.gate,
      urgency: p.urgency,
      urgency_reason: p.urgencyReason,
      pool: {
        fresh: p.pool.fresh.length,
        due: p.pool.due.length,
        edges: p.pool.edges.length,
      },
      ...(weights[i] === 0
        ? { note: "ingen brugbare koncepter i vinduet — mangler grafen kanter?" }
        : {}),
    });
  });

  return { cards: interleave(groups), courses: verdicts };
}

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "missing service credentials" }, 500);

  let body: Record<string, unknown> = {};
  try {
    if (req.method === "POST") body = await req.json();
  } catch {
    body = {};
  }

  const userId = typeof body.user_id === "string" ? body.user_id : DEFAULT_USER;
  const today = typeof body.date === "string" ? body.date : localDate(new Date());
  const force = body.force === true;
  const minutes = typeof body.minutes === "number" && body.minutes > 0
    ? Math.min(60, Math.round(body.minutes))
    : DEFAULT_MINUTES;

  const db = createClient(url, key, { auth: { persistSession: false } });

  try {
    if (!force) {
      const existing = unwrap<{ lesson_date: string }>(
        "lr_daily_lesson",
        await db.from("lr_daily_lesson").select("lesson_date")
          .eq("user_id", userId).eq("lesson_date", today).limit(1),
      );
      // Stability is the product: today's lesson is decided once. A course
      // enrolled at noon lands tomorrow unless someone asks for `force`.
      if (existing.length > 0) return json({ skipped: "exists", date: today });
    }

    const { cards, courses } = await generate(db, userId, today, minutes);

    // ⚠️ Never write an empty lesson. A row with zero cards is indistinguishable
    // from "done ✓" to every consumer, and it would stamp a fresh `generated_at`
    // over a day the selector actually had nothing for. Absent says "unknown",
    // which is the truth. Same rule as blocking_state's missing verdict.
    if (cards.length === 0) {
      return json({
        skipped: "empty",
        date: today,
        courses,
        reason: courses.length === 0
          ? "no active enrollments"
          : "enrolled courses produced no cards",
      });
    }

    const { error } = await db.from("lr_daily_lesson").upsert({
      user_id: userId,
      lesson_date: today,
      status: "ready",
      minutes_target: minutes,
      cards,
      courses,
      generated_at: new Date().toISOString(),
      completed_at: null,
    }, { onConflict: "user_id,lesson_date" });
    if (error) throw new QueryFailure("lr_daily_lesson", error.message);

    return json({
      ok: true,
      date: today,
      cards: cards.length,
      minutes,
      courses,
    });
  } catch (err) {
    if (err instanceof QueryFailure) {
      // Aborted before any write — the previous state stands.
      return json({ error: "query_failed", detail: err.message }, 500);
    }
    return json({ error: String(err) }, 500);
  }
});
