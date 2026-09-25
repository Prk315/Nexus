// Supabase Edge Function: learn-plan
//
// Composes ONE `lr_daily_plan` row per (user, day) — the study DAY, where
// `learn-daily` composes the card LESSON inside it. Four blocks:
//
//   intro    — a deterministic brief: what yesterday and this week actually
//              held, what is due soon, and RETRIEVAL PRIMES for yesterday's
//              material (titles only, never definitions — re-reading is the
//              illusion of studying; the attempt is the active ingredient,
//              per course_lessons/DESIGN.md, the governing pedagogy doc).
//   reading  — 90 minutes of the tracked book that needs it most, as a page
//              range computed from measured pace, starting where the last
//              progress event left off.
//   lesson   — the CURRENT authored lesson (Dagens Lektion artifact) on
//              teaching-phase days. DESIGN.md pins lessons at 3–4×/week
//              aligned to lectures; on maintain days this block says
//              "retention day" honestly instead of flattening the structure —
//              the exact mistake the rejected v1 made.
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
  label: string;
  plan_id: number | null;
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
  cards: Array<{ kind: string; title?: string; course?: string }> | null;
}

interface TaskRow { id: number; title: string | null; due_date: string | null }

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
    }
    const score = m.priority * urgency * staleness;
    if (!best || score > best.score) best = { m, score };
  }
  if (!best) return null;
  const m = best.m;
  const pos = positionOf(m, events);
  const pace = paceOf(m, events);
  const span = Math.max(4, Math.round(pace * minutes));
  const from = Math.floor(pos) + 1;
  const to = m.total_units != null
    ? Math.min(from + span - 1, Math.floor(m.total_units))
    : from + span - 1;
  return { material: m, from, to, pace, minutes };
}

// ── Brief composition (deterministic, honest) ──────────────────────────────

interface WeekTotals { pages: number; minutes: number; days: Set<string> }

function fmtRange(m: MaterialRow, from: number, to: number): string {
  return `${m.title}, ${m.unit_label === "pages" ? "pp." : m.unit_label} ${from}–${to}`;
}

function composeBrief(args: {
  today: string;
  streak: number | null;
  yesterdayEvents: EventRow[];
  materialsById: Map<string, MaterialRow>;
  week: WeekTotals;
  yesterdayLesson: DailyLessonRow | null;
  dueSoon: Array<{ title: string; inDays: number }>;
  primes: string[];
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

  if (args.primes.length) {
    L.push("## Before you read anything — say these back");
    L.push(
      "From yesterday. Out loud or on paper, one sentence each, *then* check:",
    );
    for (const p of args.primes) L.push(`- ${p}`);
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
  L.push(`1. **Intro** (${args.minutes.intro} min) — this brief + the say-backs above.`);
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
        .select("label, plan_id, lecture_dow, exercise_dow")
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
    const reading = pickReading(materials, events, today, cfg.reading_minutes);

    // Phase: the most demanding phase across enrollments decides whether
    // today is a lesson day (prime > consolidate > maintain).
    const phases = enrollments.map((e) => phaseOf(today, e));
    const phase: Phase = phases.includes("prime")
      ? "prime" : phases.includes("consolidate") ? "consolidate" : "maintain";

    const lessonMaterial = materials
      .filter((m) => m.kind === "lesson" && m.status === "active")
      .sort((a, b) => b.priority - a.priority || a.title.localeCompare(b.title))[0] ?? null;

    const lessonDay = phase !== "maintain" && lessonMaterial != null;
    const lessonLine = lessonDay
      ? `**${lessonMaterial!.title}** — start or resume. ${lessonMaterial!.url ?? ""}`.trim()
      : lessonMaterial
        ? "retention day — no new lesson; the review session *is* the work (interleaving belongs here, acquisition stays blocked)."
        : "no active lesson material.";

    // Due count: absent is UNKNOWN, never zero.
    const dueCount = state && Array.isArray(state.due_concepts)
      ? (state.due_concepts as unknown[]).length
      : null;
    const reviewLine = tLesson
      ? `today's card session is ready (${tLesson.cards?.length ?? "?"} cards).`
      : dueCount != null
        ? `${dueCount} concept${dueCount === 1 ? "" : "s"} due — open Dagens lektion in Nexus Learn.`
        : "due count unknown (no learn state) — open Nexus Learn.";

    // Retrieval primes from yesterday: reading section + lesson card titles.
    const primes: string[] = [];
    for (const e of events) {
      if (e.event_date !== yesterday || e.kind !== "reading") continue;
      const m = materialsById.get(e.material_id);
      if (m && e.units_from != null && e.units_to != null) {
        primes.push(`the main claim of ${fmtRange(m, e.units_from, e.units_to)}`);
      }
    }
    if (yLesson?.cards) {
      const seen = new Set<string>();
      for (const c of yLesson.cards) {
        if ((c.kind === "read" || c.kind === "recall") && c.title && !seen.has(c.title)) {
          seen.add(c.title);
          if (seen.size <= 4) primes.push(`what **${c.title}** is (${c.course ?? "kursus"})`);
        }
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
    const briefMd = composeBrief({
      today,
      streak: state?.streak_days ?? null,
      yesterdayEvents,
      materialsById,
      week,
      yesterdayLesson: yLesson,
      dueSoon: graded,
      primes,
      reading,
      lessonLine,
      reviewLine,
      minutes,
    });

    const blocks = {
      intro: { minutes: minutes.intro },
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
      lesson: lessonDay && lessonMaterial
        ? {
          minutes: minutes.lesson,
          material_id: lessonMaterial.id,
          title: lessonMaterial.title,
          url: lessonMaterial.url,
        }
        : { retention: true, phase },
      review: { minutes: minutes.review, due_concepts: dueCount },
    };

    // ── Fan-out: PathFinder tasks (idempotent by title+date+plan) ────────
    const pfTaskIds: number[] = [];
    if (cfg.pf_user_id && cfg.pf_plan_id) {
      const wanted: Array<{ title: string; estimate: number }> = [
        { title: `Learn · Intro brief (${today})`, estimate: minutes.intro },
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
      lesson: lessonDay ? lessonMaterial?.title : "retention",
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
