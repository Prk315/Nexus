// Supabase Edge Function: learn-plan
//
// Composes ONE `lr_daily_plan` row per (user, day) — the study DAY, where
// `learn-daily` composes the card LESSON inside it. Four blocks:
//
//   intro    — a deterministic brief: what yesterday and this week actually
//              held, what is due soon, and a REVIEW of where you left off —
//              the previous pages' key concepts (from the book's own concept
//              graph) and the previous lesson — so today's lesson starts
//              primed on what it builds on. (This replaced the say-back
//              retrieval primes on 2026-10-08, by the learner's own call:
//              a recap that bridges into today beats titles-only prompts
//              for how these days are actually run.)
//   reading  — 90 minutes of the tracked book that needs it most, as a page
//              range computed from measured pace, starting where the last
//              progress event left off.
//   lesson   — the CURRENT authored lesson (Concept Module artifact), on a
//              WEEKLY QUOTA (lessons_per_week, default 3). The quota is a
//              floor, not a cap: a week that hits it early keeps the link
//              and may move further ahead in the curriculum.
//   review   — the spaced-repetition session learn-evaluate/learn-daily
//              already drive; this block carries the due count.
//
// It then FANS OUT: four PathFinder tasks under the Learn plan, and a Vault
// daily note (brief + empty Noter/Opgaver/Eksempler sections) in the Learn
// Journal folder. This is the coupling DESIGN.md §9 asks for — the system
// that can notice belongs inside Nexus, not in an isolated reading surface.
//
// Failure posture, same as focus-evaluate / learn-daily: every read failure
// aborts BEFORE any write; `lr_daily_plan` is never seeded, and a missing row
// means "no plan computed", never "rest day". The fan-out is IDEMPOTENT
// (existing tasks / note for today are adopted, not duplicated), so a crash
// between fan-out and the plan write is repaired by the next cron pass.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const DEFAULT_USER = "default";
const TIMEZONE = "Europe/Copenhagen";
const EVENT_WINDOW_DAYS = 28;
const STALENESS_CAP_DAYS = 14;
const GRADED_RE =
  /(quiz|afleve|assignm|hand[- ]?in|exam|eksamen|prøve|deadline|rapport|report|projekt)/i;
const ATTENDANCE_RE =
  /^(lecture|forelæsning|forelaesning|excerciseclass|exerciseclass|theory class|øvelser|lab)/i;

type Phase = "prime" | "consolidate" | "maintain";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

class QueryFailure extends Error {
  constructor(table: string, detail: string) {
    super(`${table}: ${detail}`);
    this.name = "QueryFailure";
  }
}

function unwrap<T>(
  table: string,
  res: { data: T[] | null; error: { message: string } | null },
): T[] {
  if (res.error) throw new QueryFailure(table, res.error.message);
  return res.data ?? [];
}

function localDate(d: Date, tz: string = TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

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

/** Weekday 0=Sunday — pf_recurring_cal_blocks / lr_course_enrollment
 *  convention, ⚠️ NOT ISO (CLAUDE.md flags this as a live trap). */
function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// Ported from learn-daily: the calendar decides what today is for.
function phaseOf(
  today: string,
  e: { lecture_dow: number | null; exercise_dow: number | null },
): Phase {
  const dow = weekdayOf(today);
  const untilExercise = e.exercise_dow == null ? 99 : (e.exercise_dow - dow + 7) % 7;
  const untilLecture = e.lecture_dow == null ? 99 : (e.lecture_dow - dow + 7) % 7;
  const sinceLecture = e.lecture_dow == null ? 99 : (dow - e.lecture_dow + 7) % 7;
  if (untilExercise <= 1) return "consolidate";
  if (untilLecture <= 1) return "prime";
  if (sinceLecture <= 2) return "consolidate";
  return "maintain";
}

// ── Row shapes ─────────────────────────────────────────────────────────────

interface SettingsRow {
  user_id: string;
  reading_minutes: number;
  lesson_minutes: number;
  review_minutes: number;
  intro_minutes: number;
  lessons_per_week: number;
  pf_user_id: string | null;
  pf_plan_id: number | null;
  vault_user_id: string | null;
  vault_folder_id: string | null;
}

interface MaterialRow {
  id: string;
  kind: string;
  title: string;
  vault_node_id: string | null;
  url: string | null;
  unit_label: string;
  total_units: number | null;
  start_unit: number;
  pace_units_per_min: number;
  priority: number;
  status: string;
  due_date: string | null;
  course_id: number | null;
  chapter_prefix: string | null;
  chapter_pages: Record<string, [number, number]> | null;
}

interface EventRow {
  material_id: string;
  event_date: string;
  kind: string;
  units_from: number | null;
  units_to: number | null;
  units_delta: number | null;
  minutes: number | null;
}

interface EnrollRow {
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
}

interface LearnStateRow {
  due_concepts: unknown;
  streak_days: number | null;
  last_session_date: string | null;
}

interface DailyLessonRow {
  lesson_date: string;
  completed_at: string | null;
  cards: Array<{ kind: string; title?: string; course?: string; prompt?: string }> | null;
}

interface TaskRow { id: number; title: string | null; due_date: string | null }

/** Reading position → chapters read (mirrors learn-daily's readChapterOf).
 *  Null = this material cannot express chapters; never gate on it. */
function readChapterOf(m: MaterialRow, position: number): number | null {
  if (m.unit_label === "chapters") return Math.floor(position);
  if (m.chapter_pages) {
    let best = 0;
    for (const [ch, range] of Object.entries(m.chapter_pages)) {
      const n = Number(ch);
      if (Number.isFinite(n) && Array.isArray(range) && position >= range[1] && n > best) best = n;
    }
    return best;
  }
  return null;
}

/** Where the course's teaching is (mirrors learn-daily's chapterCeiling,
 *  without the phase lookahead — this is a lag measure, not a serving cap). */
function courseCeiling(e: EnrollRow, today: string): number {
  if (e.chapter_override != null) return e.chapter_override;
  const week = Math.floor(daysBetween(e.term_start, today) / 7) + 1;
  return e.week1_chapter + Math.floor((week - 1) * Number(e.chapters_per_week));
}

// ── Exam runway ────────────────────────────────────────────────────────────

interface Runway {
  material: MaterialRow;
  remaining: number;
  daysLeft: number;
  requiredPerDay: number;
}

/** What finishing by the due date demands, per material. Null when the
 *  material has no due date or no known length — a runway needs both ends. */
function runwayOf(m: MaterialRow, position: number, today: string): Runway | null {
  if (!m.due_date || m.total_units == null) return null;
  const remaining = Math.max(0, m.total_units - position);
  const daysLeft = Math.max(1, daysBetween(today, m.due_date));
  return { material: m, remaining, daysLeft, requiredPerDay: remaining / daysLeft };
}

// ── Reading selection ──────────────────────────────────────────────────────

interface ReadingPick {
  material: MaterialRow;
  from: number;
  to: number;
  pace: number;
  minutes: number;
}

function positionOf(m: MaterialRow, events: EventRow[]): number {
  let pos = m.start_unit;
  for (const e of events) {
    if (e.material_id !== m.id) continue;
    if (e.units_to != null && e.units_to > pos) pos = e.units_to;
  }
  return pos;
}

/** Median measured pace over reading events carrying both delta and minutes.
 *  ⚠️ Absent is not zero: events without minutes are skipped, never counted
 *  as infinite speed, and with fewer than 3 measurements the material's own
 *  configured pace stands. */
function paceOf(m: MaterialRow, events: EventRow[]): number {
  const rates: number[] = [];
  for (const e of events) {
    if (e.material_id !== m.id || e.kind !== "reading") continue;
    if (e.units_delta == null || e.minutes == null || e.minutes <= 0) continue;
    if (e.units_delta <= 0) continue;
    rates.push(e.units_delta / e.minutes);
  }
  if (rates.length < 3) return m.pace_units_per_min;
  rates.sort((a, b) => a - b);
  return rates[Math.floor(rates.length / 2)];
}

function pickReading(
  materials: MaterialRow[],
  events: EventRow[],
  today: string,
  minutes: number,
  enrollments: EnrollRow[],
): ReadingPick | null {
  const readable = materials.filter(
    (m) => m.status === "active" && ["book", "document", "paper"].includes(m.kind),
  );
  let best: { m: MaterialRow; score: number } | null = null;
  for (const m of readable) {
    const pos = positionOf(m, events);
    if (m.total_units != null && pos >= m.total_units) continue; // finished
    let lastRead: string | null = null;
    for (const e of events) {
      if (e.material_id === m.id && e.kind === "reading") {
        if (!lastRead || e.event_date > lastRead) lastRead = e.event_date;
      }
    }
    const staleness = lastRead
      ? Math.min(Math.max(daysBetween(lastRead, today), 1), STALENESS_CAP_DAYS)
      : STALENESS_CAP_DAYS;
    let urgency = 1;
    if (m.due_date) {
      const inDays = daysBetween(today, m.due_date);
      if (inDays <= 3) urgency = 2.5;
      else if (inDays <= 7) urgency = 1.8;
      else if (inDays <= 14) urgency = 1.3;
      // Schedule pressure works at exam range, where the ladder is silent:
      // how much of a daily session does the finish line demand? A book
      // needing more than one session's pages per day outranks one cruising.
      const rw = runwayOf(m, pos, today);
      if (rw) {
        const deliverable = Math.max(1, paceOf(m, events) * minutes);
        urgency = Math.max(urgency, Math.min(3, Math.max(1, rw.requiredPerDay / deliverable)));
      }
    }
    // A course book BEHIND the teaching week outranks free reading: the
    // lesson's read-gate is holding concepts back until these chapters are
    // read, so this reading is what unlocks tonight's cards.
    let behind = 0;
    if (m.course_id != null && m.chapter_prefix) {
      // `chapter_prefix` on an enrollment is a LIST ("KAL,MC,TOK"); only the
      // FIRST (primary) book tracks the lecture pacing, so only it can be
      // "behind the teaching week". Supplementary books are read-gated by
      // position alone and get no false schedule pressure.
      const e = enrollments.find((x) => {
        if (x.c_id !== m.course_id) return false;
        const primary = x.chapter_prefix.split(",")[0].trim().toUpperCase();
        return primary === m.chapter_prefix!.toUpperCase();
      });
      if (e) {
        const readCh = readChapterOf(m, pos);
        if (readCh != null) behind = Math.max(0, courseCeiling(e, today) - readCh);
      }
    }
    const score = m.priority * urgency * staleness * (1 + 0.4 * Math.min(behind, 3));
    if (!best || score > best.score) best = { m, score };
  }
  if (!best) return null;
  const m = best.m;
  const pos = positionOf(m, events);
  const pace = paceOf(m, events);
  // The floor is a PAGES number; a chapter-tracked book floors at one
  // chapter — four chapters of course notes is not a 90-minute assignment.
  const floor = m.unit_label === "chapters" ? 1 : 4;
  // Behind the exam runway, the block stretches toward what the finish line
  // demands — capped at 1.5× the measured session so the assignment stays a
  // session, not a fantasy. The brief states the required daily pace either way.
  const rw = runwayOf(m, pos, today);
  const paceSpan = Math.round(pace * minutes);
  const needSpan = rw ? Math.ceil(rw.requiredPerDay) : 0;
  const span = Math.max(floor, paceSpan, Math.min(needSpan, Math.round(paceSpan * 1.5)));
  const from = Math.floor(pos) + 1;
  const to = m.total_units != null
    ? Math.min(from + span - 1, Math.floor(m.total_units))
    : from + span - 1;
  return { material: m, from, to, pace, minutes };
}


/** Koncept-beskrivelse → recap-linje: emfase strippet, klippet på
 *  sætningsgrænse (hårdt midt-i-sætning-snit læste som fejl), og en
 *  ubalanceret $$-formel i klippet droppes helt. */
function clipSentence(raw: string, budget = 220): string {
  const clean = raw.replace(/[*_]/g, "").replace(/\s+/g, " ").trim();
  let out = clean;
  if (clean.length > budget) {
    const sentences = clean.match(/[^.!?]*[.!?]+(?:\s|$)/g) ?? [];
    out = "";
    for (const s of sentences) {
      if ((out + s).length > budget) break;
      out += s;
    }
    out = out.trim();
    if (out.length < 50) {
      const cut = clean.slice(0, budget);
      out = cut.slice(0, Math.max(cut.lastIndexOf(" "), 50)).trim() + " …";
    }
  }
  if (((out.match(/\$\$/g) ?? []).length) % 2 === 1) {
    out = out.slice(0, out.lastIndexOf("$$")).trim();
  }
  return out;
}

// ── Brief composition (deterministic, honest) ──────────────────────────────

interface WeekTotals { pages: number; minutes: number; days: Set<string> }

function fmtRange(m: MaterialRow, from: number, to: number): string {
  const label = m.unit_label === "pages" ? "pp." : m.unit_label === "chapters" ? "kap." : m.unit_label;
  return from === to ? `${m.title}, ${label} ${from}` : `${m.title}, ${label} ${from}–${to}`;
}

function composeBrief(args: {
  today: string;
  streak: number | null;
  yesterdayEvents: EventRow[];
  materialsById: Map<string, MaterialRow>;
  week: WeekTotals;
  yesterdayLesson: DailyLessonRow | null;
  dueSoon: Array<{ title: string; inDays: number }>;
  runways: Runway[];
  review: string[];
  reading: ReadingPick | null;
  lessonLine: string;
  reviewLine: string;
  minutes: { intro: number; reading: number; lesson: number; review: number };
}): string {
  const L: string[] = [];
  L.push(`# Learning day — ${args.today}`);
  L.push("");

  // Yesterday, as facts. An empty yesterday is stated, not dressed up.
  const y: string[] = [];
  for (const e of args.yesterdayEvents) {
    const m = args.materialsById.get(e.material_id);
    if (!m) continue;
    if (e.kind === "reading" && e.units_from != null && e.units_to != null) {
      y.push(`read ${fmtRange(m, e.units_from, e.units_to)}${e.minutes ? ` (${e.minutes} min)` : ""}`);
    } else if (e.kind !== "baseline") {
      y.push(`${e.kind}: ${m.title}${e.minutes ? ` (${e.minutes} min)` : ""}`);
    }
  }
  if (args.yesterdayLesson) {
    y.push(args.yesterdayLesson.completed_at
      ? `completed the card session (${args.yesterdayLesson.cards?.length ?? "?"} cards)`
      : `card session generated but not completed`);
  }
  L.push("## Yesterday");
  L.push(y.length ? y.map((s) => `- ${s}`).join("\n") : "- no study recorded");
  L.push("");

  L.push("## Review — where you left off");
  if (args.review.length) {
    for (const r of args.review) L.push(r);
  } else {
    L.push("- first study day on record — nothing to review yet.");
  }
  L.push("");

  if (args.runways.length) {
    L.push("## Exam runway");
    for (const r of args.runways) {
      L.push(`- **${r.material.title}**: ${Math.round(r.remaining)} ${r.material.unit_label} left · ${r.daysLeft} days · needs **${r.requiredPerDay.toFixed(1)}/day**`);
    }
    L.push("");
  }

  L.push("## This week");
  const wk: string[] = [];
  if (args.week.pages > 0) wk.push(`${args.week.pages} pages read`);
  if (args.week.minutes > 0) wk.push(`${args.week.minutes} study minutes logged`);
  wk.push(`${args.week.days.size} active day${args.week.days.size === 1 ? "" : "s"}`);
  if (args.streak != null) wk.push(`review streak ${args.streak}`);
  L.push(`- ${wk.join(" · ")}`);
  if (args.dueSoon.length) {
    for (const d of args.dueSoon) {
      L.push(`- ⚠️ **${d.title}** due in ${d.inDays} day${d.inDays === 1 ? "" : "s"}`);
    }
  }
  L.push("");

  L.push("## Today");
  L.push(`1. **Review** (${args.minutes.intro} min) — the recap above: re-anchor the previous pages and lesson, THEN start.`);
  L.push(args.reading
    ? `2. **Reading** (${args.minutes.reading} min) — ${fmtRange(args.reading.material, args.reading.from, args.reading.to)}.`
    : `2. **Reading** — no active reading material; add one in PathFinder → Learn.`);
  L.push(`3. **Lesson** (${args.minutes.lesson} min) — ${args.lessonLine}`);
  L.push(`4. **Repetition** (${args.minutes.review} min) — ${args.reviewLine}`);
  return L.join("\n");
}

// ── Vault note (Tiptap JSON — core node types only, schema-safe) ───────────

function tiptapDoc(today: string, briefMd: string): string {
  const para = (text: string) => (
    text.trim()
      ? { type: "paragraph", content: [{ type: "text", text }] }
      : { type: "paragraph" }
  );
  const heading = (level: number, text: string) => ({
    type: "heading", attrs: { level },
    content: [{ type: "text", text }],
  });
  const content: unknown[] = [heading(1, `Læringsdag ${today}`)];
  // The brief is markdown for the Learn panel; the note gets a flattened
  // rendering (core types only — an unknown NODE TYPE blanks a Vault note,
  // so nothing fancier than heading/paragraph/bullet goes in here).
  for (const line of briefMd.split("\n")) {
    if (line.startsWith("# ")) continue; // the note has its own H1
    if (line.startsWith("## ")) content.push(heading(2, line.slice(3)));
    else if (line.trim()) content.push(para(line.replace(/^[-\d.]+\s*/, "• ").replace(/\*\*/g, "").replace(/\*/g, "")));
  }
  for (const section of ["Noter", "Opgaver", "Eksempler"]) {
    content.push(heading(2, section));
    content.push(para(""));
  }
  return JSON.stringify({ type: "doc", content });
}

// ── Main ───────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json({ error: "missing service credentials" }, 500);

  let body: Record<string, unknown> = {};
  try {
    if (req.method === "POST") body = await req.json();
  } catch { body = {}; }

  const userId = typeof body.user_id === "string" ? body.user_id : DEFAULT_USER;
  const today = typeof body.date === "string" ? body.date : localDate(new Date());
  const force = body.force === true;

  const db: SupabaseClient = createClient(url, key, { auth: { persistSession: false } });

  try {
    if (!force) {
      const existing = unwrap<{ plan_date: string }>(
        "lr_daily_plan",
        await db.from("lr_daily_plan").select("plan_date")
          .eq("user_id", userId).eq("plan_date", today).limit(1),
      );
      if (existing.length > 0) return json({ skipped: "exists", date: today });
    }

    const settingsRows = unwrap<SettingsRow>(
      "lr_learn_settings",
      await db.from("lr_learn_settings").select("*").eq("user_id", userId).limit(1),
    );
    // No settings row = the fan-out targets are unknown. Skipping loudly beats
    // guessing a PathFinder uid.
    if (settingsRows.length === 0) {
      return json({ skipped: "no lr_learn_settings row", date: today });
    }
    const cfg = settingsRows[0];

    const materials = unwrap<MaterialRow>(
      "lr_materials",
      await db.from("lr_materials").select("*").eq("user_id", userId),
    );
    const materialsById = new Map(materials.map((m) => [m.id, m]));

    const events = unwrap<EventRow>(
      "lr_progress_events",
      await db.from("lr_progress_events")
        .select("material_id, event_date, kind, units_from, units_to, units_delta, minutes")
        .eq("user_id", userId)
        .gte("event_date", shiftDate(today, -EVENT_WINDOW_DAYS)),
    );

    const enrollments = unwrap<EnrollRow>(
      "lr_course_enrollment",
      await db.from("lr_course_enrollment")
        .select("c_id, label, plan_id, chapter_prefix, term_start, week1_chapter, chapters_per_week, chapter_override, lecture_dow, exercise_dow")
        .eq("user_id", userId).eq("active", true),
    );

    const stateRows = unwrap<LearnStateRow>(
      "lr_learn_state",
      await db.from("lr_learn_state")
        .select("due_concepts, streak_days, last_session_date")
        .eq("user_id", userId).limit(1),
    );
    const state = stateRows[0] ?? null;

    const yesterday = shiftDate(today, -1);
    const lessons = unwrap<DailyLessonRow>(
      "lr_daily_lesson",
      await db.from("lr_daily_lesson")
        .select("lesson_date, completed_at, cards")
        .eq("user_id", userId)
        .in("lesson_date", [yesterday, today]),
    );
    const yLesson = lessons.find((l) => l.lesson_date === yesterday) ?? null;
    const tLesson = lessons.find((l) => l.lesson_date === today) ?? null;

    // Graded events within a week, from the enrolled courses' plans.
    const planIds = enrollments.map((e) => e.plan_id).filter((p): p is number => p != null);
    const graded: Array<{ title: string; inDays: number }> = [];
    if (planIds.length) {
      const tasks = unwrap<TaskRow>(
        "pf_tasks",
        await db.from("pf_tasks").select("id, title, due_date")
          .in("plan_id", planIds).eq("done", false)
          .gte("due_date", today).lte("due_date", shiftDate(today, 7)),
      );
      for (const t of tasks) {
        const title = (t.title ?? "").trim();
        if (!t.due_date || ATTENDANCE_RE.test(title) || !GRADED_RE.test(title)) continue;
        graded.push({ title, inDays: daysBetween(today, t.due_date.slice(0, 10)) });
      }
      graded.sort((a, b) => a.inDays - b.inDays);
    }

    // ── Compose the four blocks ──────────────────────────────────────────
    const reading = pickReading(materials, events, today, cfg.reading_minutes, enrollments);

    const phases = enrollments.map((e) => phaseOf(today, e));
    const phase: Phase = phases.includes("prime")
      ? "prime" : phases.includes("consolidate") ? "consolidate" : "maintain";

    // The authored lesson runs on a WEEKLY QUOTA (default 3), not the phase:
    // the target is a floor — a week that hits it early may keep going, so
    // the link stays present, only the framing changes. A lesson day is
    // counted by lesson-kind progress events (one per day).
    const dowQ = weekdayOf(today);
    const mondayQ = shiftDate(today, -((dowQ + 6) % 7));
    const lessonDays = new Set(
      events.filter((e) => e.kind === "lesson" && e.event_date >= mondayQ && e.event_date <= today)
        .map((e) => e.event_date),
    ).size;

    // With several courses carrying lessons, priority alone would serve one
    // course forever. Rotation: the ACTIVE lesson material with the fewest
    // lesson events this week leads, so courses interleave inside the same
    // weekly quota; priority and title only break ties.
    const servedThisWeek = new Map<string, number>();
    for (const e of events) {
      if (e.kind !== "lesson" || e.event_date < mondayQ || e.event_date > today) continue;
      servedThisWeek.set(e.material_id, (servedThisWeek.get(e.material_id) ?? 0) + 1);
    }
    // ── The day is ONE course where possible. Reading is picked by need
    // (runway/staleness); the lesson then follows the READING's course, so
    // the review-primer, the pages and the lesson all point the same way —
    // a PGM morning feeding a MatAn lesson was the misalignment this fixes.
    // Rotation still interleaves WITHIN the course, and a reading course
    // with no active lessons falls back to the global rotation rather than
    // dropping the lesson block.
    // Tie-break by CURRICULUM order, not the alphabet: lesson materials
    // carry their course week in start_unit (inert for lessons otherwise),
    // so within a course the next lesson is the next week's — Camera &
    // Landmarks (wk 2) before Kalman (wk 7). Weekless rows sort last.
    const weekOf = (m: MaterialRow) => m.start_unit > 0 ? m.start_unit : 99;
    const rotation = (a: MaterialRow, b: MaterialRow) =>
      (servedThisWeek.get(a.id) ?? 0) - (servedThisWeek.get(b.id) ?? 0) ||
      weekOf(a) - weekOf(b) ||
      b.priority - a.priority || a.title.localeCompare(b.title);
    const lessonCandidates = materials
      .filter((m) => m.kind === "lesson" && m.status === "active");
    const sameCourse = reading?.material.course_id != null
      ? lessonCandidates.filter((m) => m.course_id === reading.material.course_id)
      : [];
    const lessonMaterial =
      (sameCourse.length ? sameCourse : lessonCandidates).sort(rotation)[0] ?? null;
    const quota = cfg.lessons_per_week ?? 3;
    const lessonDay = lessonMaterial != null && lessonDays < quota;
    const lessonLine = lessonMaterial == null
      ? "no active lesson material — the next lesson needs authoring."
      : lessonDay
        ? `**${lessonMaterial.title}** — lesson ${lessonDays + 1} of ${quota} this week. ${lessonMaterial.url ?? ""}`.trim()
        : `week's target met (${lessonDays}/${quota}) — continue ahead if you like: ${lessonMaterial.url ?? ""}`.trim();

    // Due count: absent is UNKNOWN, never zero.
    const dueCount = state && Array.isArray(state.due_concepts)
      ? (state.due_concepts as unknown[]).length
      : null;
    const reviewLine = tLesson
      ? `today's card session is ready (${tLesson.cards?.length ?? "?"} cards).`
      : dueCount != null
        ? `${dueCount} concept${dueCount === 1 ? "" : "s"} due — open Dagens lektion in Nexus Learn.`
        : "due count unknown (no learn state) — open Nexus Learn.";

    // ── Review of where you left off: previous pages' key concepts + the
    // previous lesson, as a bridge into today's lesson. Summaries are drawn
    // from the book's OWN concept graph (lr_concept via lr_topic), so the
    // recap is grounded in what the ingested chapters actually say — never
    // model-invented. One more read on the same failure posture as the rest.
    const review: string[] = [];
    // The ids behind the recap concepts — the app turns these into a drill
    // session (same activity as Repetition), so the review is DONE, not read.
    const primerIds: string[] = [];
    if (reading) {
      const m = reading.material;
      const lastRead = [...events]
        .filter((e) =>
          e.material_id === m.id && e.kind === "reading" &&
          e.event_date < today && e.units_from != null && e.units_to != null)
        .sort((a, b) => b.event_date.localeCompare(a.event_date))[0] ?? null;
      if (lastRead) {
        const ago = daysBetween(lastRead.event_date, today);
        review.push(`- **${m.title}**: last read ${fmtRange(m, lastRead.units_from!, lastRead.units_to!).slice(m.title.length + 2)} (${
          ago === 1 ? "yesterday" : `${ago} days ago`}). Today continues at ${
          m.unit_label === "chapters" ? "kap." : "p."} ${reading.from}.`);
        // Which chapters did that range touch? chapter_pages maps chapter →
        // [first, last] page; absent map = no concept lookup (absent is not
        // zero — we say less rather than guess).
        if (m.chapter_pages && m.chapter_prefix) {
          const chapters: string[] = [];
          for (const [ch, range] of Object.entries(m.chapter_pages)) {
            if (!Array.isArray(range) || range.length < 2) continue;
            if (lastRead.units_from! <= range[1] && lastRead.units_to! >= range[0]) chapters.push(ch);
          }
          if (chapters.length) {
            const prefix = m.chapter_prefix.trim();
            const topics = unwrap<{ t_id: number; title: string }>(
              "lr_topic",
              await db.from("lr_topic").select("t_id,title")
                .like("title", `${prefix} %`),
            );
            const chSet = new Set(chapters.map((c) => String(Number(c))));
            const tIds = topics.filter((t) => {
              const mch = t.title.slice(prefix.length).trim().match(/^(\d+)/);
              return mch != null && chSet.has(String(Number(mch[1])));
            }).map((t) => t.t_id);
            if (tIds.length) {
              const concepts = unwrap<{ concept_id: string; title: string; description: string | null; importance: number }>(
                "lr_concept",
                await db.from("lr_concept")
                  .select("concept_id,title,description,importance")
                  .in("t_id", tIds)
                  .order("importance", { ascending: false })
                  .limit(5),
              );
              if (concepts.length) {
                review.push(`  Key ideas from those pages — have them back in mind:`);
                for (const c of concepts) {
                  primerIds.push(c.concept_id);
                  const d = clipSentence(c.description ?? "");
                  review.push(`  - **${c.title}**${d ? ` — ${d}` : ""}`);
                }
              }
            }
          }
        }
      } else {
        review.push(`- **${m.title}**: first session — today starts at ${
          m.unit_label === "chapters" ? "kap." : "p."} ${reading.from}.`);
      }
    }
    {
      const lastLessonEv = [...events]
        .filter((e) => e.kind === "lesson" && e.event_date < today)
        .sort((a, b) => b.event_date.localeCompare(a.event_date))[0] ?? null;
      if (lastLessonEv) {
        const lm = materialsById.get(lastLessonEv.material_id);
        const ago = daysBetween(lastLessonEv.event_date, today);
        if (lm) {
          review.push(`- **Previous lesson**: ${lm.title} (${
            ago === 1 ? "yesterday" : `${ago} days ago`}).${
            lm.url ? ` Loose on any of it? Skim its “Taught so far” panel first: ${lm.url}` : ""}`);
        }
      }
      if (lessonMaterial && lessonDay) {
        // Only claim the recap primes the lesson when they share a course —
        // a PGM reading recap does not "build into" a MatAn lesson.
        const recapCourses = new Set<number>();
        if (reading?.material.course_id != null) recapCourses.add(reading.material.course_id);
        if (lastLessonEv) {
          const lmc = materialsById.get(lastLessonEv.material_id)?.course_id;
          if (lmc != null) recapCourses.add(lmc);
        }
        review.push(lessonMaterial.course_id != null && recapCourses.has(lessonMaterial.course_id)
          ? `- **Today's lesson**: ${lessonMaterial.title} — the recap above is what it builds on.`
          : `- **Today's lesson**: ${lessonMaterial.title} — different course than the recap; its own "Taught so far" panel is the primer.`);
      }
    }

    // Week totals (Monday-start, Copenhagen).
    const dow = weekdayOf(today);
    const monday = shiftDate(today, -((dow + 6) % 7));
    const week: WeekTotals = { pages: 0, minutes: 0, days: new Set() };
    for (const e of events) {
      if (e.event_date < monday || e.event_date > today || e.kind === "baseline") continue;
      week.days.add(e.event_date);
      if (e.units_delta != null && e.units_delta > 0) week.pages += Math.round(e.units_delta);
      if (e.minutes != null) week.minutes += e.minutes;
    }

    const yesterdayEvents = events.filter((e) => e.event_date === yesterday);
    const minutes = {
      intro: cfg.intro_minutes,
      reading: cfg.reading_minutes,
      lesson: cfg.lesson_minutes,
      review: cfg.review_minutes,
    };
    const runways = materials
      .filter((m) => m.status === "active" && ["book", "document", "paper"].includes(m.kind))
      .map((m) => runwayOf(m, positionOf(m, events), today))
      .filter((r): r is Runway => r != null && r.remaining > 0)
      .sort((a, b) => b.requiredPerDay - a.requiredPerDay);

    const briefMd = composeBrief({
      today,
      streak: state?.streak_days ?? null,
      yesterdayEvents,
      materialsById,
      week,
      yesterdayLesson: yLesson,
      dueSoon: graded,
      runways,
      review,
      reading,
      lessonLine,
      reviewLine,
      minutes,
    });

    const blocks = {
      intro: { minutes: minutes.intro, primer_concept_ids: primerIds },
      reading: reading
        ? {
          minutes: minutes.reading,
          material_id: reading.material.id,
          title: reading.material.title,
          vault_node_id: reading.material.vault_node_id,
          unit_label: reading.material.unit_label,
          from: reading.from,
          to: reading.to,
          pace: Number(reading.pace.toFixed(3)),
        }
        : null,
      lesson: lessonMaterial
        ? {
          minutes: minutes.lesson,
          material_id: lessonMaterial.id,
          title: lessonMaterial.title,
          url: lessonMaterial.url,
          week_done: lessonDays,
          week_target: quota,
          target_met: !lessonDay,
        }
        : { retention: true, phase },
      review: { minutes: minutes.review, due_concepts: dueCount },
    };

    // ── Fan-out: PathFinder tasks (idempotent by title+date+plan) ────────
    const pfTaskIds: number[] = [];
    if (cfg.pf_user_id && cfg.pf_plan_id) {
      const wanted: Array<{ title: string; estimate: number }> = [
        { title: `Learn · Review & prime (${today})`, estimate: minutes.intro },
        ...(reading
          ? [{
            title: `Learn · Reading: ${fmtRange(reading.material, reading.from, reading.to)} (${today})`,
            estimate: minutes.reading,
          }]
          : []),
        ...(lessonDay && lessonMaterial
          ? [{ title: `Learn · Lesson: ${lessonMaterial.title} (${today})`, estimate: minutes.lesson }]
          : []),
        { title: `Learn · Repetition (${today})`, estimate: minutes.review },
      ];
      const existing = unwrap<TaskRow>(
        "pf_tasks",
        await db.from("pf_tasks").select("id, title, due_date")
          .eq("plan_id", cfg.pf_plan_id).eq("due_date", today)
          .like("title", "Learn ·%"),
      );
      const byTitle = new Map(existing.map((t) => [t.title ?? "", t.id]));
      for (const w of wanted) {
        const have = byTitle.get(w.title);
        if (have != null) { pfTaskIds.push(have); continue; }
        const ins = await db.from("pf_tasks").insert({
          user_id: cfg.pf_user_id,
          plan_id: cfg.pf_plan_id,
          title: w.title,
          due_date: today,
          time_estimate: w.estimate,
          priority: "medium",
          done: false,
        }).select("id").single();
        if (ins.error) throw new QueryFailure("pf_tasks", ins.error.message);
        pfTaskIds.push((ins.data as { id: number }).id);
      }
    }

    // ── Fan-out: Vault daily note (idempotent by name under the folder) ──
    let vaultNoteId: string | null = null;
    if (cfg.vault_user_id && cfg.vault_folder_id) {
      const noteName = `Læringsdag ${today}`;
      const found = unwrap<{ id: string }>(
        "vault_nodes",
        await db.from("vault_nodes").select("id")
          .eq("user_id", cfg.vault_user_id).eq("name", noteName).limit(1),
      );
      if (found.length > 0) {
        vaultNoteId = found[0].id;
      } else {
        vaultNoteId = crypto.randomUUID();
        const n = await db.from("vault_nodes").insert({
          id: vaultNoteId,
          name: noteName,
          kind: { type: "Note" },
          tags: ["learn"],
          user_id: cfg.vault_user_id,
        });
        if (n.error) throw new QueryFailure("vault_nodes", n.error.message);
        const e = await db.from("vault_edges").insert({
          from_id: cfg.vault_folder_id,
          to_id: vaultNoteId,
          user_id: cfg.vault_user_id,
        });
        if (e.error) throw new QueryFailure("vault_edges", e.error.message);
        const c = await db.from("vault_content").insert({
          node_id: vaultNoteId,
          data: tiptapDoc(today, briefMd),
          user_id: cfg.vault_user_id,
        });
        if (c.error) throw new QueryFailure("vault_content", c.error.message);
      }
    }

    // ── The plan row, last: it asserts the whole day exists ──────────────
    const { error } = await db.from("lr_daily_plan").upsert({
      user_id: userId,
      plan_date: today,
      blocks,
      brief_md: briefMd,
      pf_task_ids: pfTaskIds,
      vault_note_id: vaultNoteId,
      status: "ready",
      generated_at: new Date().toISOString(),
      completed_at: null,
    }, { onConflict: "user_id,plan_date" });
    if (error) throw new QueryFailure("lr_daily_plan", error.message);

    return json({
      ok: true,
      date: today,
      phase,
      reading: reading ? `${reading.material.title} ${reading.from}–${reading.to}` : null,
      lesson: lessonMaterial ? `${lessonMaterial.title} (${lessonDays}/${quota}${lessonDay ? "" : " met"})` : "none",
      pf_tasks: pfTaskIds.length,
      vault_note: vaultNoteId,
    });
  } catch (err) {
    if (err instanceof QueryFailure) {
      return json({ error: "query_failed", detail: err.message }, 500);
    }
    return json({ error: String(err) }, 500);
  }
});
