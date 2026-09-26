import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Brain, BookOpen, FileText, GraduationCap, ClipboardList, Link2,
  CheckCircle2, Circle, Plus, ExternalLink, RefreshCw, Flame, Pencil, Trash2,
} from "lucide-react";
import {
  getLearnDay, getLearnMaterials, getLearnCourses, logLearnProgress,
  createLearnMaterial, updateLearnMaterial, deleteLearnMaterial,
  createLearnCourse, enrollLearnCourse, setLearnCourseActive, markLearnDayDone,
} from "../lib/api";
import type {
  LearnMaterial, LearnPlan, LearnCourse, MaterialKind, MaterialStatus,
} from "../lib/api";
import { deltaForLogTo } from "../lib/learnProgress";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { cn } from "../lib/utils";

// The Learn tab: the composed learning day (written by the learn-plan edge
// function on pg_cron) + full CRUD over the materials and courses whose
// progress DRIVES the generation. Logging here is not bookkeeping — reading
// progress is the read-gate's input: a concept is served as new material only
// once its chapter is read, practiced concepts enter spaced repetition, and
// the daily reading block is picked to unlock what the lesson is waiting on.

const KIND_META: Record<MaterialKind, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  book: { label: "Books", icon: BookOpen },
  document: { label: "Documents", icon: FileText },
  paper: { label: "Papers", icon: FileText },
  lesson: { label: "Lessons", icon: GraduationCap },
  assignment: { label: "Assignments", icon: ClipboardList },
  course: { label: "Courses", icon: GraduationCap },
};
const KIND_ORDER: MaterialKind[] = ["book", "lesson", "assignment", "document", "paper", "course"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // 0=Sunday — NOT ISO

function todayYmd(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

const num = (s: string): number | null => {
  // ⚠️ Number("") is 0 and 0 is finite — an empty field must stay null.
  if (!s.trim()) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

// ── Today card ──────────────────────────────────────────────────────────────

function BriefText({ md }: { md: string }) {
  return (
    <div className="space-y-1 text-sm leading-relaxed">
      {md.split("\n").map((line, i) => {
        if (line.startsWith("# ")) return null;
        if (line.startsWith("## ")) {
          return <div key={i} className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{line.slice(3)}</div>;
        }
        if (!line.trim()) return null;
        const text = line.replace(/\*\*/g, "").replace(/^\s*[-]\s*/, "· ");
        return <div key={i}>{text}</div>;
      })}
    </div>
  );
}

function TodayCard({ plan, onDone, onRefresh }: {
  plan: LearnPlan | null;
  onDone: () => void;
  onRefresh: () => void;
}) {
  const [showBrief, setShowBrief] = useState(true);
  if (!plan) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        Today's plan hasn't been generated yet — the generator runs every 30 minutes.
        <Button variant="ghost" size="sm" className="ml-2" onClick={onRefresh}>
          <RefreshCw className="mr-1 h-3.5 w-3.5" /> Check again
        </Button>
      </div>
    );
  }
  const b = plan.blocks;
  const rows: Array<{ label: string; minutes: number | undefined; body: React.ReactNode }> = [
    { label: "Intro", minutes: b.intro?.minutes, body: <span>Read the brief below — say the say-backs out loud first.</span> },
    {
      label: "Reading",
      minutes: b.reading?.minutes,
      body: b.reading
        ? <span>{b.reading.title}, {b.reading.unit_label === "pages" ? "pp." : "kap."} <b>{b.reading.from}{b.reading.to !== b.reading.from ? `–${b.reading.to}` : ""}</b></span>
        : <span className="text-muted-foreground">no active reading material</span>,
    },
    {
      label: "Lesson",
      minutes: b.lesson?.minutes,
      body: b.lesson?.retention
        ? <span className="text-muted-foreground">retention day — the review session <i>is</i> the work</span>
        : (
          <span className="inline-flex items-center gap-1.5">
            {b.lesson?.title}
            {b.lesson?.url && (
              <a href={b.lesson.url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                open <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </span>
        ),
    },
    {
      label: "Repetition",
      minutes: b.review?.minutes,
      body: <span>
        {b.review?.due_concepts != null
          ? `${b.review.due_concepts} concepts due — Dagens lektion in Nexus Learn`
          : "open Dagens lektion in Nexus Learn"}
      </span>,
    },
  ];
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Brain className="h-4 w-4" /> Today — {plan.planDate}
        </h2>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowBrief((v) => !v)}
          >
            {showBrief ? "hide brief" : "show brief"}
          </button>
          {plan.status === "done" ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> done
            </span>
          ) : (
            <Button size="sm" variant="outline" onClick={onDone}>
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Mark day done
            </Button>
          )}
        </div>
      </div>
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.label} className="flex items-start gap-3 text-sm">
            <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-muted text-[11px] font-semibold">{i + 1}</span>
            <div className="min-w-0">
              <span className="font-medium">{r.label}</span>
              {r.minutes ? <span className="ml-1.5 text-xs text-muted-foreground">{r.minutes} min</span> : null}
              <div className="text-muted-foreground">{r.body}</div>
            </div>
          </li>
        ))}
      </ol>
      {showBrief && (
        <div className="rounded-lg bg-muted/40 p-3">
          <BriefText md={plan.briefMd} />
        </div>
      )}
    </div>
  );
}

// ── Material edit form ──────────────────────────────────────────────────────

function MaterialForm({ initial, courses, onSave, onCancel }: {
  initial: Partial<LearnMaterial> & { title?: string };
  courses: LearnCourse[];
  onSave: (fields: {
    kind: MaterialKind; title: string; totalUnits: number | null;
    startUnit: number; unitLabel: string; url: string | null;
    courseId: number | null; chapterPrefix: string | null; priority: number;
    dueDate: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [kind, setKind] = useState<MaterialKind>(initial.kind ?? "book");
  const [title, setTitle] = useState(initial.title ?? "");
  const [total, setTotal] = useState(initial.total_units != null ? String(initial.total_units) : "");
  const [start, setStart] = useState(initial.start_unit != null && initial.start_unit !== 0 ? String(initial.start_unit) : "");
  const [unitLabel, setUnitLabel] = useState(initial.unitLabel ?? "pages");
  const [url, setUrl] = useState(initial.url ?? "");
  const [courseId, setCourseId] = useState<string>(initial.courseId != null ? String(initial.courseId) : "");
  const [prefix, setPrefix] = useState(initial.chapterPrefix ?? "");
  const [priority, setPriority] = useState(initial.priority != null ? String(initial.priority) : "1");
  const [due, setDue] = useState(initial.dueDate ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await onSave({
        kind,
        title: title.trim(),
        totalUnits: num(total),
        startUnit: num(start) ?? 0,
        unitLabel,
        url: url.trim() || null,
        courseId: courseId ? Number(courseId) : null,
        chapterPrefix: prefix.trim().toUpperCase() || null,
        priority: num(priority) ?? 1,
        dueDate: due.trim() || null,
      });
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 space-y-1.5 rounded-lg border bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={kind} onChange={(e) => setKind(e.target.value as MaterialKind)}
          className="h-8 rounded-md border bg-background px-2 text-xs">
          {KIND_ORDER.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="h-8 w-56 text-xs" />
        <select value={unitLabel} onChange={(e) => setUnitLabel(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs">
          <option value="pages">pages</option>
          <option value="chapters">chapters</option>
          <option value="units">units</option>
        </select>
        <Input value={total} onChange={(e) => setTotal(e.target.value)} placeholder="total" inputMode="numeric" className="h-8 w-16 text-xs" />
        <Input value={start} onChange={(e) => setStart(e.target.value)} placeholder="start at" inputMode="numeric" className="h-8 w-16 text-xs"
          title="Front-matter offset — reading starts after this unit" />
        <Input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="prio" inputMode="numeric" className="h-8 w-14 text-xs" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <select value={courseId} onChange={(e) => setCourseId(e.target.value)}
          className="h-8 rounded-md border bg-background px-2 text-xs"
          title="Linking a course + prefix makes reading here unlock that course's lesson concepts">
          <option value="">no course</option>
          {courses.map((c) => <option key={c.cId} value={c.cId}>{c.label ?? c.title}</option>)}
        </select>
        <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix (DM)" className="h-8 w-24 text-xs"
          title="Topic prefix inside the course graph (DM, MLSU, PGM …)" />
        <Input value={due} onChange={(e) => setDue(e.target.value)} placeholder="due YYYY-MM-DD" className="h-8 w-32 text-xs" />
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="url (optional)" className="h-8 w-44 text-xs" />
        <Button size="sm" className="h-8" disabled={busy || !title.trim()} onClick={save}>Save</Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

// ── Material row ────────────────────────────────────────────────────────────

function MaterialRow({ m, courses, courseLabel, onChanged }: {
  m: LearnMaterial;
  courses: LearnCourse[];
  courseLabel: string | null;
  onChanged: () => void;
}) {
  const [toPage, setToPage] = useState("");
  const [minutes, setMinutes] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const pct = m.fraction != null ? Math.round(m.fraction * 100) : null;

  const log = async () => {
    const to = num(toPage);
    if (to == null || busy) return;
    setBusy(true);
    try {
      const delta = deltaForLogTo(m.position, to);
      await logLearnProgress({
        materialId: m.id,
        kind: m.kind === "lesson" ? "lesson" : "reading",
        unitsFrom: delta != null ? m.position : null,
        unitsTo: to,
        unitsDelta: delta,
        minutes: num(minutes),
      });
      setToPage(""); setMinutes("");
      onChanged();
    } finally { setBusy(false); }
  };

  const logMinutesOnly = async () => {
    const mins = num(minutes);
    if (mins == null || busy) return;
    setBusy(true);
    try {
      await logLearnProgress({
        materialId: m.id,
        kind: m.kind === "lesson" ? "lesson" : m.kind === "assignment" ? "exercise" : "reading",
        minutes: mins,
      });
      setMinutes("");
      onChanged();
    } finally { setBusy(false); }
  };

  const cycleStatus = async () => {
    const next: MaterialStatus = m.status === "active" ? "done" : m.status === "done" ? "paused" : "active";
    await updateLearnMaterial(m.id, { status: next });
    onChanged();
  };

  const remove = async () => {
    // Two-click confirm — window.confirm is a silent no-op in iOS WKWebView.
    if (!confirmingDelete) { setConfirmingDelete(true); setTimeout(() => setConfirmingDelete(false), 3000); return; }
    await deleteLearnMaterial(m.id);
    onChanged();
  };

  const positioned = m.unitLabel === "pages" || m.unitLabel === "chapters";

  return (
    <div className={cn("rounded-lg border p-3", m.status !== "active" && "opacity-60")}>
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{m.title}</span>
            {courseLabel && (
              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                {courseLabel}{m.chapterPrefix ? ` · ${m.chapterPrefix}` : ""}
              </span>
            )}
            {m.url && (
              <a href={m.url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground">
                <Link2 className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {positioned && (
              <>at {m.unitLabel === "chapters" ? "kap." : "p."} {Math.floor(m.position)}
                {m.total_units != null && <> / {Math.floor(m.total_units)}</>}
                {" · "}
              </>
            )}
            {m.lastActivity ? `last ${m.lastActivity}` : "no activity yet"}
            {m.dueDate && <> · due {m.dueDate}</>}
          </div>
        </div>
        <div className="flex flex-none items-center gap-1">
          <button onClick={() => setEditing((v) => !v)} title="Edit" className="p-1 text-muted-foreground hover:text-foreground">
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button onClick={remove} title={confirmingDelete ? "Click again to delete (removes its progress history)" : "Delete"}
            className={cn("p-1", confirmingDelete ? "text-destructive" : "text-muted-foreground hover:text-destructive")}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
          <button onClick={cycleStatus} title={`status: ${m.status} (click to cycle)`}>
            {m.status === "done"
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : m.status === "paused"
                ? <Circle className="h-5 w-5 text-muted-foreground/40" />
                : <Circle className="h-5 w-5 text-primary/70" />}
          </button>
        </div>
      </div>

      {pct != null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}

      {m.status === "active" && !editing && (
        <div className="mt-2 flex items-center gap-1.5">
          {positioned && (
            <Input value={toPage} onChange={(e) => setToPage(e.target.value)}
              placeholder={m.unitLabel === "chapters" ? "to kap." : "to page"}
              inputMode="numeric" className="h-7 w-20 text-xs"
              onKeyDown={(e) => { if (e.key === "Enter") log(); }} />
          )}
          <Input value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="min"
            inputMode="numeric" className="h-7 w-14 text-xs"
            onKeyDown={(e) => { if (e.key === "Enter") (positioned && toPage.trim() ? log() : logMinutesOnly()); }} />
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={busy}
            onClick={() => (positioned && toPage.trim() ? log() : logMinutesOnly())}>
            Log
          </Button>
        </div>
      )}

      {editing && (
        <MaterialForm
          initial={m}
          courses={courses}
          onSave={async (f) => {
            await updateLearnMaterial(m.id, {
              title: f.title, totalUnits: f.totalUnits, startUnit: f.startUnit,
              unitLabel: f.unitLabel, url: f.url, courseId: f.courseId,
              chapterPrefix: f.chapterPrefix, priority: f.priority, dueDate: f.dueDate,
            });
            setEditing(false);
            onChanged();
          }}
          onCancel={() => setEditing(false)}
        />
      )}
    </div>
  );
}

// ── Courses section ─────────────────────────────────────────────────────────

function CourseForm({ initial, onSave, onCancel, needsTitle }: {
  initial: Partial<LearnCourse>;
  needsTitle: boolean;
  onSave: (title: string, e: { label: string; chapterPrefix: string; termStart: string; week1Chapter: number; chaptersPerWeek: number; lectureDow: number | null; exerciseDow: number | null }) => Promise<void>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(initial.title ?? "");
  const [label, setLabel] = useState(initial.label ?? "");
  const [prefix, setPrefix] = useState(initial.chapterPrefix ?? "");
  const [termStart, setTermStart] = useState(initial.termStart ?? "");
  const [week1, setWeek1] = useState(initial.week1Chapter != null ? String(initial.week1Chapter) : "1");
  const [perWeek, setPerWeek] = useState(initial.chaptersPerWeek != null ? String(initial.chaptersPerWeek) : "1");
  const [lecture, setLecture] = useState(initial.lectureDow != null ? String(initial.lectureDow) : "");
  const [exercise, setExercise] = useState(initial.exerciseDow != null ? String(initial.exerciseDow) : "");
  const [busy, setBusy] = useState(false);

  const ok = (!needsTitle || title.trim()) && label.trim() && prefix.trim() && /^\d{4}-\d{2}-\d{2}$/.test(termStart);
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await onSave(title.trim(), {
        label: label.trim(),
        chapterPrefix: prefix.trim().toUpperCase(),
        termStart,
        week1Chapter: num(week1) ?? 1,
        chaptersPerWeek: num(perWeek) ?? 1,
        lectureDow: lecture === "" ? null : Number(lecture),
        exerciseDow: exercise === "" ? null : Number(exercise),
      });
    } finally { setBusy(false); }
  };

  const dowSelect = (v: string, set: (s: string) => void, ph: string) => (
    <select value={v} onChange={(e) => set(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-xs" title={ph}>
      <option value="">{ph}</option>
      {DOW.map((d, i) => <option key={d} value={i}>{d}</option>)}
    </select>
  );

  return (
    <div className="space-y-1.5 rounded-lg border bg-muted/20 p-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {needsTitle && <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Course title" className="h-8 w-52 text-xs" />}
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (MLA)" className="h-8 w-24 text-xs" />
        <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="prefix (DM)" className="h-8 w-24 text-xs"
          title="Topic prefix in the concept graph — which book's chapters pace this course" />
        <Input value={termStart} onChange={(e) => setTermStart(e.target.value)} placeholder="term start YYYY-MM-DD" className="h-8 w-40 text-xs" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Input value={week1} onChange={(e) => setWeek1(e.target.value)} placeholder="wk1 ch" inputMode="numeric" className="h-8 w-16 text-xs" title="Chapter in teaching week 1" />
        <Input value={perWeek} onChange={(e) => setPerWeek(e.target.value)} placeholder="ch/wk" inputMode="numeric" className="h-8 w-16 text-xs" title="Chapters per week" />
        {dowSelect(lecture, setLecture, "lecture day")}
        {dowSelect(exercise, setExercise, "exercise day")}
        <Button size="sm" className="h-8" disabled={!ok || busy} onClick={save}>Save</Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function CoursesSection({ courses, onChanged }: { courses: LearnCourse[]; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const enrolled = courses.filter((c) => c.enrolled);
  const rest = courses.filter((c) => !c.enrolled);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
          <GraduationCap className="h-4 w-4" /> Courses
        </h2>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" /> New course
        </Button>
      </div>

      {adding && (
        <CourseForm
          initial={{}}
          needsTitle
          onSave={async (title, e) => { await createLearnCourse(title, e); setAdding(false); onChanged(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="space-y-2">
        {enrolled.map((c) => (
          <div key={c.cId} className={cn("rounded-lg border p-3", !c.active && "opacity-60")}>
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{c.label} <span className="font-normal text-muted-foreground">— {c.title}</span></div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {c.chapterPrefix} · from {c.termStart} · {c.chaptersPerWeek} ch/wk
                  {c.lectureDow != null && <> · lecture {DOW[c.lectureDow]}</>}
                  {c.exerciseDow != null && <> · exercises {DOW[c.exerciseDow]}</>}
                </div>
              </div>
              <div className="flex flex-none items-center gap-1">
                <button onClick={() => setEditingId(editingId === c.cId ? null : c.cId)} title="Edit pacing" className="p-1 text-muted-foreground hover:text-foreground">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={async () => { await setLearnCourseActive(c.cId, !c.active); onChanged(); }}
                  title={c.active ? "Active — click to pause" : "Paused — click to activate"}
                >
                  {c.active
                    ? <CheckCircle2 className="h-5 w-5 text-primary/80" />
                    : <Circle className="h-5 w-5 text-muted-foreground/40" />}
                </button>
              </div>
            </div>
            {editingId === c.cId && (
              <div className="mt-2">
                <CourseForm
                  initial={c}
                  needsTitle={false}
                  onSave={async (_t, e) => { await enrollLearnCourse(c.cId, e); setEditingId(null); onChanged(); }}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {rest.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Not enrolled ({rest.length}) — course graphs that exist but aren't active</summary>
          <div className="mt-2 space-y-1">
            {rest.map((c) => (
              <div key={c.cId} className="flex items-center justify-between rounded border px-2 py-1.5">
                <span>{c.title}</span>
                <button className="text-primary hover:underline" onClick={() => setEditingId(editingId === c.cId ? null : c.cId)}>enroll</button>
              </div>
            ))}
            {rest.map((c) => editingId === c.cId && (
              <CourseForm key={`f-${c.cId}`} initial={c} needsTitle={false}
                onSave={async (_t, e) => { await enrollLearnCourse(c.cId, e); setEditingId(null); onChanged(); }}
                onCancel={() => setEditingId(null)} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function Learn() {
  const [plan, setPlan] = useState<LearnPlan | null>(null);
  const [materials, setMaterials] = useState<LearnMaterial[] | null>(null);
  const [courses, setCourses] = useState<LearnCourse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const date = todayYmd();

  const load = useCallback(async () => {
    try {
      setError(null);
      const [p, m, c] = await Promise.all([
        getLearnDay(date), getLearnMaterials(), getLearnCourses(),
      ]);
      setPlan(p);
      setMaterials(m);
      setCourses(c);
    } catch (e) {
      // signedOut/loading/error are distinct from "zero rows" — never render
      // a failure as an empty tracker.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [date]);

  useEffect(() => { load(); }, [load]);

  const courseLabelOf = useMemo(() => {
    const byId = new Map(courses.map((c) => [c.cId, c.label ?? c.title]));
    return (id: number | null) => (id != null ? byId.get(id) ?? null : null);
  }, [courses]);

  const grouped = useMemo(() => {
    const g = new Map<MaterialKind, LearnMaterial[]>();
    for (const m of materials ?? []) {
      const list = g.get(m.kind) ?? [];
      list.push(m);
      g.set(m.kind, list);
    }
    return g;
  }, [materials]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <Flame className="h-5 w-5 text-primary" /> Learn
        </h1>
        <Button variant="ghost" size="sm" onClick={() => setAdding((v) => !v)}>
          <Plus className="mr-1 h-4 w-4" /> Add material
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          Couldn't load the Learn data: {error}
        </div>
      )}

      {adding && (
        <MaterialForm
          initial={{}}
          courses={courses}
          onSave={async (f) => {
            await createLearnMaterial({
              kind: f.kind, title: f.title, totalUnits: f.totalUnits,
              startUnit: f.startUnit, unitLabel: f.unitLabel, url: f.url,
              courseId: f.courseId, chapterPrefix: f.chapterPrefix, priority: f.priority,
              dueDate: f.dueDate,
            });
            setAdding(false);
            load();
          }}
          onCancel={() => setAdding(false)}
        />
      )}

      <TodayCard plan={plan} onDone={async () => { await markLearnDayDone(date); load(); }} onRefresh={load} />

      {materials === null && !error && (
        <div className="text-sm text-muted-foreground">Loading materials…</div>
      )}

      {KIND_ORDER.map((kind) => {
        const list = grouped.get(kind);
        if (!list?.length) return null;
        const Meta = KIND_META[kind];
        return (
          <section key={kind} className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
              <Meta.icon className="h-4 w-4" /> {Meta.label}
            </h2>
            <div className="space-y-2">
              {list.map((m) => (
                <MaterialRow key={m.id} m={m} courses={courses}
                  courseLabel={courseLabelOf(m.courseId)} onChanged={load} />
              ))}
            </div>
          </section>
        );
      })}

      <CoursesSection courses={courses} onChanged={load} />
    </div>
  );
}
