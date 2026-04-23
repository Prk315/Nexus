import { useEffect, useState, useCallback } from "react";
import {
  Plus, X, Trash2, BookOpen, FileText, Layers, GraduationCap,
  HelpCircle, FlaskConical, Circle, CheckCircle2, Clock, Pencil,
  ChevronDown, ChevronRight, ChevronUp, Settings, Check, PenLine, Presentation, Users, ClipboardList,
  Workflow, BarChart3, Calendar,
} from "lucide-react";
import {
  getPlans,
  updatePlan,
  getCourseAssignments,
  createCourseAssignment,
  updateCourseAssignment,
  deleteCourseAssignment,
  getCaSubtasks,
  addCaSubtask,
  toggleCaSubtask,
  deleteCaSubtask,
  getPipelineTemplates,
  createPipelineTemplate,
  updatePipelineTemplate,
  deletePipelineTemplate,
  upsertPipelineSteps,
  getPipelineRuns,
  createPipelineRun,
  updatePipelineRun,
  deletePipelineRun,
  togglePipelineRunStep,
  updatePipelineRunStep,
  getPipelineStepSubtasks,
  addPipelineStepSubtask,
  togglePipelineStepSubtask,
  deletePipelineStepSubtask,
  getCourseBooks,
  createCourseBook,
  updateCourseBook,
  deleteCourseBook,
  addBookReadingLog,
  deleteBookReadingLog,
  upsertBookSections,
  toggleBookSection,
} from "../lib/api";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import type { Plan, CourseAssignment, CaSubtask, PipelineTemplate, PipelineRun, PipelineStepSubtask, CourseBook } from "../types";

// ── Assignment type config ─────────────────────────────────────────────────────

const TYPES: { value: string; label: string; icon: React.ElementType; color: string }[] = [
  { value: "assignment", label: "Assignment", icon: ClipboardList,  color: "text-sky-500   bg-sky-500/10   border-sky-400/30" },
  { value: "homework",  label: "Homework",   icon: FileText,       color: "text-blue-500  bg-blue-500/10  border-blue-400/30" },
  { value: "project",   label: "Project",   icon: Layers,         color: "text-violet-500 bg-violet-500/10 border-violet-400/30" },
  { value: "exam",      label: "Exam",      icon: GraduationCap,  color: "text-red-500   bg-red-500/10   border-red-400/30" },
  { value: "quiz",      label: "Quiz",      icon: HelpCircle,     color: "text-orange-500 bg-orange-500/10 border-orange-400/30" },
  { value: "reading",   label: "Reading",   icon: BookOpen,       color: "text-emerald-500 bg-emerald-500/10 border-emerald-400/30" },
  { value: "lab",       label: "Lab",             icon: FlaskConical,  color: "text-cyan-500  bg-cyan-500/10  border-cyan-400/30" },
  { value: "lecture",   label: "Lecture",         icon: Presentation,  color: "text-indigo-500 bg-indigo-500/10 border-indigo-400/30" },
  { value: "theory",    label: "Theory Class",    icon: PenLine,       color: "text-orange-500 bg-orange-500/10 border-orange-400/30" },
  { value: "projhelp",  label: "Project Help",    icon: Users,         color: "text-pink-500  bg-pink-500/10  border-pink-400/30" },
  { value: "other",     label: "Other",           icon: Circle,        color: "text-slate-500 bg-slate-500/10 border-slate-400/30" },
];

function typeConfig(t: string) {
  return TYPES.find((x) => x.value === t) ?? TYPES[TYPES.length - 1];
}

// ── Status helpers ─────────────────────────────────────────────────────────────

const NEXT_STATUS: Record<string, string> = {
  pending:     "in_progress",
  in_progress: "done",
  done:        "pending",
};

function StatusIcon({ status, onClick }: { status: string; onClick?: () => void }) {
  const cls = "h-5 w-5 shrink-0 cursor-pointer transition-colors";
  if (status === "done")        return <CheckCircle2 className={cn(cls, "text-emerald-500 hover:text-emerald-600")} onClick={onClick} />;
  if (status === "in_progress") return <Clock        className={cn(cls, "text-amber-500   hover:text-amber-600")}   onClick={onClick} />;
  return <Circle className={cn(cls, "text-muted-foreground/40 hover:text-muted-foreground")} onClick={onClick} />;
}

// ── Date bucket helpers ────────────────────────────────────────────────────────

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Monday of the ISO week containing `iso`
function weekMonday(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const day = d.getDay(); // 0=Sun
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

// Fixed bucket keys
type FixedBucket = "overdue" | "today" | "tomorrow" | "this_week" | "no_date" | "done";
// Dynamic week bucket key: "week_YYYY-MM-DD" (the Monday of that week)
type BucketKey = FixedBucket | string;

function bucketKey(a: CourseAssignment): BucketKey {
  if (a.status === "done") return "done";
  if (!a.due_date)          return "no_date";
  const today      = todayStr();
  const tomorrow   = addDays(today, 1);
  const thisMonday = weekMonday(today);
  const thisSunday = addDays(thisMonday, 6);
  if (a.due_date < today)       return "overdue";
  if (a.due_date === today)     return "today";
  if (a.due_date === tomorrow)  return "tomorrow";
  if (a.due_date <= thisSunday) return "this_week";
  return `week_${weekMonday(a.due_date)}`;
}

const FIXED_STYLE: Record<FixedBucket, string> = {
  overdue:   "text-red-500",
  today:     "text-amber-500",
  tomorrow:  "text-orange-500",
  this_week: "text-blue-500",
  no_date:   "text-muted-foreground",
  done:      "text-muted-foreground",
};
const FIXED_LABELS: Record<FixedBucket, string> = {
  overdue:   "Overdue",
  today:     "Due Today",
  tomorrow:  "Due Tomorrow",
  this_week: "This Week",
  no_date:   "No Due Date",
  done:      "Done",
};

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function weekLabel(mondayIso: string): string {
  const mon = new Date(mondayIso + "T12:00:00");
  const sun = new Date(mondayIso + "T12:00:00");
  sun.setDate(sun.getDate() + 6);
  const fmt = (d: Date) => `${MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
  return `${fmt(mon)} – ${fmt(sun)}`;
}

// ── Modal form ────────────────────────────────────────────────────────────────

type Draft = {
  plan_id: string; title: string; assignment_type: string;
  due_date: string; status: string; priority: string;
  book_title: string; chapter_start: string; chapter_end: string;
  page_start: string; page_end: string; page_current: string; notes: string;
  start_time: string; end_time: string; time_estimate: string;
};

function emptyDraft(planId?: number): Draft {
  return {
    plan_id: planId ? String(planId) : "",
    title: "", assignment_type: "homework",
    due_date: "", status: "pending", priority: "medium",
    book_title: "", chapter_start: "", chapter_end: "",
    page_start: "", page_end: "", page_current: "", notes: "",
    start_time: "", end_time: "", time_estimate: "",
  };
}

function draftFromAssignment(a: CourseAssignment): Draft {
  return {
    plan_id:        String(a.plan_id),
    title:          a.title,
    assignment_type: a.assignment_type,
    due_date:       a.due_date        ?? "",
    status:         a.status,
    priority:       a.priority,
    book_title:     a.book_title      ?? "",
    chapter_start:  a.chapter_start   ?? "",
    chapter_end:    a.chapter_end     ?? "",
    page_start:     a.page_start != null ? String(a.page_start) : "",
    page_end:       a.page_end   != null ? String(a.page_end)   : "",
    page_current:   a.page_current != null ? String(a.page_current) : "",
    notes:          a.notes           ?? "",
    start_time:     a.start_time      ?? "",
    end_time:       a.end_time        ?? "",
    time_estimate:  a.time_estimate != null ? String(a.time_estimate) : "",
  };
}

function toPayload(d: Draft) {
  return {
    plan_id:         Number(d.plan_id),
    title:           d.title.trim(),
    assignment_type: d.assignment_type,
    due_date:        d.due_date        || null,
    status:          d.status,
    priority:        d.priority,
    book_title:      d.book_title.trim()      || null,
    chapter_start:   d.chapter_start.trim()   || null,
    chapter_end:     d.chapter_end.trim()     || null,
    page_start:      d.page_start   ? Number(d.page_start)   : null,
    page_end:        d.page_end     ? Number(d.page_end)     : null,
    page_current:    d.page_current ? Number(d.page_current) : null,
    notes:           d.notes.trim()           || null,
    start_time:      d.start_time || null,
    end_time:        d.end_time   || null,
    time_estimate:   d.time_estimate ? Number(d.time_estimate) : null,
  };
}

const inputCls = "h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:ring-1 focus:ring-ring w-full";
const textareaCls = "rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:ring-1 focus:ring-ring w-full resize-none";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function AssignmentModal({ initial, plans, defaultPlanId, onSave, onDelete, onClose }: {
  initial?: CourseAssignment;
  plans: Plan[];
  defaultPlanId?: number;
  onSave: (d: Draft) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Draft>(initial ? draftFromAssignment(initial) : emptyDraft(defaultPlanId));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const ok = form.title.trim() && form.plan_id;
  const isReading = form.assignment_type === "reading";

  function set(patch: Partial<Draft>) { setForm((p) => ({ ...p, ...patch })); }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl p-5 w-96 max-h-[90vh] overflow-y-auto flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">
            {initial ? "Edit Assignment" : "New Assignment"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Type picker */}
        <Field label="Type">
          <div className="flex flex-wrap gap-1.5">
            {TYPES.map((t) => {
              const Icon = t.icon;
              const active = form.assignment_type === t.value;
              return (
                <button key={t.value} onClick={() => set({ assignment_type: t.value })}
                  className={cn(
                    "flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-medium transition-colors",
                    active ? t.color : "border-border text-muted-foreground hover:text-foreground"
                  )}>
                  <Icon className="h-3 w-3" />{t.label}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label="Title">
          <input autoFocus className={inputCls} placeholder="Assignment title"
            value={form.title} onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && ok && onSave(form)} />
        </Field>

        <Field label="Course">
          <select className={inputCls} value={form.plan_id} onChange={(e) => set({ plan_id: e.target.value })}>
            <option value="">— select course —</option>
            {plans.map((p) => (
              <option key={p.id} value={p.id}>{p.title}</option>
            ))}
          </select>
        </Field>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Due date">
            <input type="date" className={inputCls} value={form.due_date}
              onChange={(e) => set({ due_date: e.target.value })} />
          </Field>
          <Field label="Priority">
            <select className={inputCls} value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Field label="Start time (optional)">
            <input type="time" className={inputCls} value={form.start_time}
              onChange={(e) => set({ start_time: e.target.value })} />
          </Field>
          <Field label="End time (optional)">
            <input type="time" className={inputCls} value={form.end_time}
              onChange={(e) => set({ end_time: e.target.value })} />
          </Field>
        </div>

        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={(e) => set({ status: e.target.value })}>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </Field>

        {/* Reading fields */}
        {isReading && (
          <div className="flex flex-col gap-3 rounded-md border border-border/60 bg-secondary/20 p-3">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <BookOpen className="h-3.5 w-3.5" /> Reading details
            </p>
            <Field label="Book / source title">
              <input className={inputCls} placeholder="Fundamentals of Physics"
                value={form.book_title} onChange={(e) => set({ book_title: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="From chapter">
                <input className={inputCls} placeholder="e.g. 4"
                  value={form.chapter_start} onChange={(e) => set({ chapter_start: e.target.value })} />
              </Field>
              <Field label="To chapter">
                <input className={inputCls} placeholder="e.g. 6"
                  value={form.chapter_end} onChange={(e) => set({ chapter_end: e.target.value })} />
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Start page">
                <input type="number" min={1} className={inputCls}
                  value={form.page_start} onChange={(e) => set({ page_start: e.target.value })} />
              </Field>
              <Field label="End page">
                <input type="number" min={1} className={inputCls}
                  value={form.page_end} onChange={(e) => set({ page_end: e.target.value })} />
              </Field>
              <Field label="Current page">
                <input type="number" min={0} className={inputCls}
                  value={form.page_current} onChange={(e) => set({ page_current: e.target.value })} />
              </Field>
            </div>
          </div>
        )}

        <Field label="Time estimate (min) — default: actual duration for timed, 10 min otherwise">
          <input type="number" min={1} placeholder="auto" className={inputCls}
            value={form.time_estimate} onChange={(e) => set({ time_estimate: e.target.value })} />
        </Field>

        <Field label="Notes (optional)">
          <textarea className={textareaCls} rows={3} placeholder="Additional details…"
            value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
        </Field>

        <div className="flex gap-2 pt-1">
          <Button className="flex-1" disabled={!ok} onClick={() => onSave(form)}>
            {initial ? "Save" : "Add Assignment"}
          </Button>
          {onDelete && !confirmDelete && (
            <Button variant="outline" size="sm" className="px-2 text-destructive border-destructive/40 hover:bg-destructive/10"
              onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && confirmDelete && (
            <Button variant="destructive" size="sm" className="px-2" onClick={onDelete}>
              Confirm delete
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reading progress bar ───────────────────────────────────────────────────────

function ReadingProgress({ assignment, onUpdate }: {
  assignment: CourseAssignment;
  onUpdate: (pageCurrentStr: string) => void;
}) {
  const { page_start, page_end, page_current, chapter_start, chapter_end, book_title } = assignment;
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(page_current ?? page_start ?? ""));

  const total   = page_end   != null && page_start != null ? page_end - page_start : null;
  const current = page_current != null && page_start != null ? page_current - page_start : null;
  const pct     = total && current != null && total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;

  function commit() {
    setEditing(false);
    if (val !== String(page_current ?? "")) onUpdate(val);
  }

  return (
    <div className="mt-1.5 flex flex-col gap-1">
      {/* Book + chapter info */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <BookOpen className="h-3 w-3 shrink-0" />
        {book_title && <span className="font-medium text-foreground/80">{book_title}</span>}
        {(chapter_start || chapter_end) && (
          <span>• Ch.{chapter_start}{chapter_end && chapter_end !== chapter_start ? `–${chapter_end}` : ""}</span>
        )}
        {(page_start || page_end) && (
          <span>• p.{page_start}{page_end && page_end !== page_start ? `–${page_end}` : ""}</span>
        )}
      </div>

      {/* Progress bar + current page edit */}
      {page_end != null && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500 transition-all"
              style={{ width: `${pct ?? 0}%` }} />
          </div>
          <span className="text-[10px] text-muted-foreground w-8 text-right">{pct ?? 0}%</span>
          {editing ? (
            <input autoFocus type="number" min={page_start ?? 1} max={page_end}
              className="h-6 w-14 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") { setEditing(false); setVal(String(page_current ?? "")); }}}
            />
          ) : (
            <button onClick={() => setEditing(true)}
              className="text-[10px] text-muted-foreground hover:text-foreground px-1 rounded hover:bg-secondary transition-colors">
              p.{page_current ?? page_start}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Subtask list ───────────────────────────────────────────────────────────────

function SubtaskList({ subtasks, onToggle, onDelete, onAdd }: {
  subtasks: CaSubtask[];
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onAdd: (title: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const t = draft.trim();
    if (t) { onAdd(t); setDraft(""); }
  }

  const done  = subtasks.filter((s) => s.done).length;
  const total = subtasks.length;

  return (
    <div className="mt-2 flex flex-col gap-0.5">
      {total > 0 && (
        <div className="flex items-center gap-1.5 mb-1">
          <div className="flex-1 h-1 rounded-full bg-secondary overflow-hidden">
            <div className="h-full rounded-full bg-primary/60 transition-all"
              style={{ width: total > 0 ? `${Math.round((done / total) * 100)}%` : "0%" }} />
          </div>
          <span className="text-[10px] text-muted-foreground shrink-0">{done}/{total}</span>
        </div>
      )}
      {subtasks.map((s) => (
        <div key={s.id} className="flex items-center gap-1.5 group/sub pl-1">
          <button
            onClick={() => onToggle(s.id)}
            className={cn(
              "h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center transition-colors",
              s.done ? "bg-primary border-primary" : "border-border hover:border-primary"
            )}
          >
            {s.done && <Check className="h-2 w-2 text-primary-foreground" />}
          </button>
          <span className={cn("text-[11px] flex-1", s.done ? "line-through text-muted-foreground" : "text-foreground")}>
            {s.title}
          </span>
          <button
            onClick={() => onDelete(s.id)}
            className="opacity-0 group-hover/sub:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <div className="flex items-center gap-1.5 mt-0.5 pl-1">
        <Plus className="h-3 w-3 text-muted-foreground/50 shrink-0" />
        <input
          className="flex-1 bg-transparent text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none"
          placeholder="Add subtask…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); }
            if (e.key === "Escape") setDraft("");
          }}
          onBlur={commit}
        />
      </div>
    </div>
  );
}

// ── Assignment card ────────────────────────────────────────────────────────────

function AssignmentCard({ assignment, subtasks, onCycleStatus, onEdit, onPageUpdate, onLoadSubtasks, onToggleSubtask, onDeleteSubtask, onAddSubtask }: {
  assignment: CourseAssignment;
  subtasks: CaSubtask[];
  onCycleStatus: () => void;
  onEdit: () => void;
  onPageUpdate: (pageCurrentStr: string) => void;
  onLoadSubtasks: () => void;
  onToggleSubtask: (id: number) => void;
  onDeleteSubtask: (id: number) => void;
  onAddSubtask: (title: string) => void;
}) {
  const [showSubtasks, setShowSubtasks] = useState(false);
  const { title, assignment_type, due_date, status, priority, plan_title, notes } = assignment;
  const tc = typeConfig(assignment_type);
  const TypeIcon = tc.icon;
  const today = todayStr();
  const overdue = due_date && due_date < today && status !== "done";

  const priorityDot: Record<string, string> = {
    high: "bg-red-500", medium: "bg-amber-500", low: "bg-blue-400",
  };

  function formatDate(iso: string) {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <div className={cn(
      "flex items-start gap-3 px-4 py-3 border-b border-border/50 hover:bg-secondary/20 transition-colors group",
      status === "done" && "opacity-60"
    )}>
      {/* Status toggle */}
      <div className="pt-0.5">
        <StatusIcon status={status} onClick={onCycleStatus} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Type badge */}
          <span className={cn("flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded border", tc.color)}>
            <TypeIcon className="h-2.5 w-2.5" />{tc.label}
          </span>
          {/* Priority dot */}
          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", priorityDot[priority] ?? "bg-slate-400")} />
          {/* Title */}
          <span className={cn("text-sm font-medium text-foreground", status === "done" && "line-through")}>
            {title}
          </span>
        </div>

        {/* Course + due date row */}
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[11px] text-muted-foreground truncate">{plan_title}</span>
          {due_date && (
            <span className={cn("text-[11px] font-medium ml-auto shrink-0", overdue ? "text-red-500" : "text-muted-foreground")}>
              {overdue ? "Overdue · " : ""}{formatDate(due_date)}
            </span>
          )}
        </div>

        {/* Reading progress */}
        {assignment_type === "reading" && (
          <ReadingProgress assignment={assignment} onUpdate={onPageUpdate} />
        )}

        {/* Notes preview */}
        {notes && (
          <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{notes}</p>
        )}

        {/* Subtask toggle */}
        <button
          onClick={() => { if (!showSubtasks) onLoadSubtasks(); setShowSubtasks((v) => !v); }}
          className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showSubtasks
            ? <ChevronDown className="h-3 w-3" />
            : <ChevronRight className="h-3 w-3" />}
          {subtasks.length > 0
            ? `${subtasks.filter((s) => s.done).length}/${subtasks.length} subtasks`
            : "Add subtasks"}
        </button>

        {/* Subtask list */}
        {showSubtasks && (
          <SubtaskList
            subtasks={subtasks}
            onToggle={onToggleSubtask}
            onDelete={onDeleteSubtask}
            onAdd={onAddSubtask}
          />
        )}
      </div>

      {/* Edit button */}
      <button
        onClick={onEdit}
        className="shrink-0 p-1 rounded text-muted-foreground/0 group-hover:text-muted-foreground hover:bg-secondary transition-colors"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ── Collapsible bucket section ─────────────────────────────────────────────────

function BucketSection({ label, assignments, style, children }: {
  label: string; assignments: CourseAssignment[]; style: string; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(label !== "Done");
  if (assignments.length === 0) return null;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full px-4 py-2 sticky top-0 bg-background/95 backdrop-blur border-b border-border/40 z-10"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className={cn("text-xs font-semibold uppercase tracking-wide", style)}>{label}</span>
        <span className="ml-auto text-xs text-muted-foreground">{assignments.length}</span>
      </button>
      {open && children}
    </div>
  );
}

// ── Pipeline colors ────────────────────────────────────────────────────────────

const PIPELINE_COLORS: Record<string, { dot: string; border: string; accent: string }> = {
  violet:  { dot: "bg-violet-500",  border: "border-violet-400/40", accent: "border-l-violet-400" },
  indigo:  { dot: "bg-indigo-500",  border: "border-indigo-400/40", accent: "border-l-indigo-400" },
  blue:    { dot: "bg-blue-500",    border: "border-blue-400/40",   accent: "border-l-blue-400"   },
  emerald: { dot: "bg-emerald-500", border: "border-emerald-400/40",accent: "border-l-emerald-400"},
  rose:    { dot: "bg-rose-500",    border: "border-rose-400/40",   accent: "border-l-rose-400"   },
  amber:   { dot: "bg-amber-500",   border: "border-amber-400/40",  accent: "border-l-amber-400"  },
  teal:    { dot: "bg-teal-500",    border: "border-teal-400/40",   accent: "border-l-teal-400"   },
  slate:   { dot: "bg-slate-400",   border: "border-slate-400/40",  accent: "border-l-slate-400"  },
};

// ── Pipeline presets ───────────────────────────────────────────────────────────

type PipelinePreset = {
  label: string;
  icon: string;
  color: string;
  title: string;
  steps: { title: string; time_estimate: string; step_type: string; attend_type?: string }[];
};

const PIPELINE_PRESETS: PipelinePreset[] = [
  {
    label: "Lecture",
    icon: "🎓",
    color: "indigo",
    title: "Lecture Workflow",
    steps: [
      { title: "Read",            time_estimate: "30",  step_type: "read"    },
      { title: "Review",          time_estimate: "30",  step_type: "generic" },
      { title: "Attend",          time_estimate: "90",  step_type: "attend"  },
      { title: "Finish Notes",    time_estimate: "20",  step_type: "generic" },
      { title: "Update Notebook", time_estimate: "15",  step_type: "generic" },
    ],
  },
  {
    label: "Exercise Class",
    icon: "✏️",
    color: "emerald",
    title: "Exercise Class",
    steps: [
      { title: "Prepare",            time_estimate: "30",  step_type: "read"    },
      { title: "Attend",             time_estimate: "90",  step_type: "attend", attend_type: "theory" },
      { title: "Complete Exercises", time_estimate: "60",  step_type: "generic" },
      { title: "Review Solutions",   time_estimate: "30",  step_type: "generic" },
    ],
  },
  {
    label: "Seminar",
    icon: "💬",
    color: "violet",
    title: "Seminar",
    steps: [
      { title: "Read Materials", time_estimate: "60", step_type: "read"    },
      { title: "Prepare Notes",  time_estimate: "20", step_type: "generic" },
      { title: "Attend",         time_estimate: "60", step_type: "attend"  },
      { title: "Follow-up",      time_estimate: "20", step_type: "generic" },
    ],
  },
  {
    label: "Lab",
    icon: "🧪",
    color: "teal",
    title: "Lab Session",
    steps: [
      { title: "Pre-lab Reading", time_estimate: "30",  step_type: "read"    },
      { title: "Attend Lab",      time_estimate: "120", step_type: "attend"  },
      { title: "Write Report",    time_estimate: "90",  step_type: "generic" },
    ],
  },
];

// ── Pipeline template modal ────────────────────────────────────────────────────

type PipelineStepDraft = { id?: number; title: string; time_estimate: string; step_type: string; attend_type: string | null };

const STEP_TYPES: { value: string; label: string; icon: string }[] = [
  { value: "generic", label: "Generic", icon: "📝" },
  { value: "read",    label: "Read",    icon: "📖" },
  { value: "attend",  label: "Attend",  icon: "🎓" },
];

function PipelineTemplateModal({ initial, planId, onSave, onClose }: {
  initial?: PipelineTemplate;
  planId: number;
  onSave: (t: PipelineTemplate) => void;
  onClose: () => void;
}) {
  const [title, setTitle]       = useState(initial?.title ?? "");
  const [description, setDesc]  = useState(initial?.description ?? "");
  const [color, setColor]        = useState(initial?.color ?? "violet");
  const [steps, setSteps]        = useState<PipelineStepDraft[]>(() =>
    initial?.steps.map(s => ({ id: s.id, title: s.title, time_estimate: s.time_estimate != null ? String(s.time_estimate) : "", step_type: s.step_type ?? "generic", attend_type: s.attend_type ?? null })) ?? []
  );
  const [newStep, setNewStep]    = useState("");
  const [loading, setLoading]    = useState(false);

  function addStep() {
    const t = newStep.trim();
    if (!t) return;
    setSteps(s => [...s, { title: t, time_estimate: "", step_type: "generic", attend_type: null }]);
    setNewStep("");
  }

  function removeStep(i: number) { setSteps(s => s.filter((_, idx) => idx !== i)); }

  function moveStep(i: number, dir: -1 | 1) {
    const j = i + dir;
    setSteps(s => { const a = [...s]; [a[i], a[j]] = [a[j], a[i]]; return a; });
  }

  async function handleSave() {
    if (!title.trim() || loading) return;
    setLoading(true);
    try {
      let tmpl: PipelineTemplate;
      if (initial) {
        tmpl = await updatePipelineTemplate(initial.id, { title: title.trim(), description: description.trim() || null, color });
      } else {
        tmpl = await createPipelineTemplate({ plan_id: planId, title: title.trim(), description: description.trim() || null, color });
      }
      const stepInputs = steps.map((s, i) => ({
        id: s.id ?? null,
        title: s.title,
        description: null,
        sort_order: i,
        time_estimate: s.time_estimate ? Number(s.time_estimate) : null,
        step_type: s.step_type,
        attend_type: s.attend_type ?? null,
      }));
      const updatedSteps = await upsertPipelineSteps(tmpl.id, stepInputs);
      onSave({ ...tmpl, steps: updatedSteps });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-xl shadow-2xl p-5 w-[480px] max-h-[90vh] overflow-y-auto flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Workflow className="h-4 w-4 text-violet-500" />
            {initial ? "Edit Pipeline" : "New Pipeline"}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <Field label="Title">
          <input autoFocus className={inputCls} placeholder="e.g. Lecture Workflow"
            value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && steps.length > 0 && handleSave()} />
        </Field>

        <Field label="Description (optional)">
          <textarea className={textareaCls} rows={2} placeholder="What this pipeline covers…"
            value={description} onChange={(e) => setDesc(e.target.value)} />
        </Field>

        <Field label="Color">
          <div className="flex gap-2 flex-wrap">
            {Object.entries(PIPELINE_COLORS).map(([name, c]) => (
              <button key={name} type="button"
                onClick={() => setColor(name)}
                className={cn("h-5 w-5 rounded-full transition-all", c.dot,
                  color === name ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-50 hover:opacity-100"
                )} />
            ))}
          </div>
        </Field>

        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Steps <span className="text-muted-foreground/50">— the repeating formula ({steps.length})</span>
          </p>
          {steps.length === 0 && (
            <p className="text-xs text-muted-foreground/60 italic">No steps yet. Add the actions that repeat each run.</p>
          )}
          {steps.map((s, i) => {
            const typeInfo = STEP_TYPES.find(t => t.value === s.step_type) ?? STEP_TYPES[0];
            const nextType = STEP_TYPES[(STEP_TYPES.indexOf(typeInfo) + 1) % STEP_TYPES.length];
            return (
            <div key={i} className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/30 px-2.5 py-1.5">
              <div className="flex flex-col mr-0.5">
                <button type="button" disabled={i === 0} onClick={() => moveStep(i, -1)}
                  className="text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 transition-colors">
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button type="button" disabled={i === steps.length - 1} onClick={() => moveStep(i, 1)}
                  className="text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 transition-colors">
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>
              <span className="text-[10px] text-muted-foreground/40 font-mono w-4 shrink-0 text-right">{i + 1}</span>
              <button
                type="button"
                title={`Type: ${typeInfo.label} — click to change to ${nextType.label}`}
                onClick={() => setSteps(prev => prev.map((x, idx) => idx === i ? { ...x, step_type: nextType.value } : x))}
                className="text-base leading-none shrink-0 opacity-70 hover:opacity-100 transition-opacity"
              >
                {typeInfo.icon}
              </button>
              <input
                className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40"
                value={s.title}
                onChange={(e) => setSteps(prev => prev.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} />
              {s.step_type === "attend" && (
                <select
                  title="Assignment type created when this step is filled"
                  className="h-6 rounded border border-input bg-background px-1 text-[10px] outline-none focus:ring-1 focus:ring-ring text-muted-foreground shrink-0"
                  value={s.attend_type ?? "lecture"}
                  onChange={(e) => setSteps(prev => prev.map((x, idx) => idx === i ? { ...x, attend_type: e.target.value } : x))}
                >
                  {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              )}
              <input type="number" min={1} placeholder="min" title="Time estimate in minutes"
                className="w-14 h-6 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring text-muted-foreground"
                value={s.time_estimate}
                onChange={(e) => setSteps(prev => prev.map((x, idx) => idx === i ? { ...x, time_estimate: e.target.value } : x))} />
              <button type="button" onClick={() => removeStep(i)}
                className="text-muted-foreground/30 hover:text-destructive transition-colors shrink-0">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            );
          })}
          <div className="flex items-center gap-2">
            <input className={cn(inputCls, "flex-1")} placeholder="Add step…"
              value={newStep} onChange={(e) => setNewStep(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addStep(); } }} />
            <Button type="button" size="sm" variant="outline" onClick={addStep} className="shrink-0 h-8">
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Button className="flex-1" disabled={!title.trim() || loading} onClick={handleSave}>
            {initial ? "Save" : "Create Pipeline"}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

// ── Mini pie chart ─────────────────────────────────────────────────────────────

const PIE_COLORS = ["#818cf8","#34d399","#fbbf24","#a78bfa","#38bdf8","#fb7185"];

function getEffectiveTime(step: import("../types").PipelineStep, rs: import("../types").PipelineRunStep | undefined): number {
  if (step.step_type === "attend" && rs?.start_time && rs?.end_time) {
    const [sh, sm] = rs.start_time.split(":").map(Number);
    const [eh, em] = rs.end_time.split(":").map(Number);
    const diff = (eh * 60 + em) - (sh * 60 + sm);
    if (diff > 0) return diff;
  }
  if (step.step_type === "read" && rs?.time_estimate) return rs.time_estimate;
  return step.time_estimate ?? 1;
}

function MiniPie({ steps, runSteps, size = 30 }: {
  steps: import("../types").PipelineStep[];
  runSteps: import("../types").PipelineRunStep[];
  size?: number;
}) {
  if (steps.length === 0) return null;

  const times = steps.map(s => getEffectiveTime(s, runSteps.find(r => r.step_id === s.id)));
  const total = times.reduce((a, b) => a + b, 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 1;
  let angle = -Math.PI / 2;

  const tooltip = steps.map((s, i) => {
    const rs = runSteps.find(r => r.step_id === s.id);
    const t = times[i];
    const mark = rs?.done ? "✓" : "○";
    const time = t < 60 ? `${t}m` : `${Math.floor(t/60)}h${t % 60 > 0 ? `${t%60}m` : ""}`;
    return `${mark} ${s.title} · ${time}`;
  }).join("\n");

  const segs = steps.map((step, i) => {
    const frac = times[i] / total;
    const start = angle;
    const end   = angle + frac * 2 * Math.PI;
    angle = end;
    const done = runSteps.find(r => r.step_id === step.id)?.done ?? false;
    const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end - 0.0001), y2 = cy + r * Math.sin(end - 0.0001);
    const large = frac > 0.5 ? 1 : 0;
    const d = steps.length === 1
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`
      : `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    return <path key={step.id} d={d} fill={PIE_COLORS[i % PIE_COLORS.length]} opacity={done ? 1 : 0.18} />;
  });

  return (
    <svg width={size} height={size} className="shrink-0 rounded-full" style={{ overflow: "hidden" }}>
      <title>{tooltip}</title>
      {segs}
    </svg>
  );
}

// ── Pipeline matrix ────────────────────────────────────────────────────────────

function PipelineMatrix({ template, runs, onToggleStep, onUpdateRunStep, onUpdateRunTitle, onAddRun, onDeleteRun, onEditTemplate, onDeleteTemplate }: {
  template: PipelineTemplate;
  runs: PipelineRun[];
  onToggleStep: (runId: number, stepId: number) => void;
  onUpdateRunStep: (runId: number, stepId: number, patch: Partial<{ notes: string | null; due_date: string | null; due_date_2: string | null; chapter_ref: string | null; page_start: number | null; page_end: number | null; start_time: string | null; end_time: string | null; location: string | null; time_estimate: number | null }>, current: import("../types").PipelineRunStep | undefined) => void;
  onUpdateRunTitle: (runId: number, newTitle: string) => void;
  onAddRun: (title: string, date: string) => void;
  onDeleteRun: (runId: number) => void;
  onEditTemplate: () => void;
  onDeleteTemplate: () => void;
}) {
  const [addTitle,     setAddTitle]     = useState("");
  const [addDate,      setAddDate]      = useState("");
  const [collapsed,    setCollapsed]    = useState(false);
  const [editingRunId, setEditingRunId] = useState<number | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());
  const [subtasks,     setSubtasks]     = useState<Map<string, PipelineStepSubtask[]>>(new Map());
  const [subtaskInput, setSubtaskInput] = useState<Map<string, string>>(new Map());

  function subKey(runId: number, stepId: number) { return `${runId}-${stepId}`; }

  async function loadSubtasksForRun(runId: number) {
    for (const step of template.steps) {
      const key = subKey(runId, step.id);
      const list = await getPipelineStepSubtasks(runId, step.id);
      setSubtasks(prev => new Map(prev).set(key, list));
    }
  }

  function toggleExpand(runId: number) {
    setExpandedRuns(prev => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
        loadSubtasksForRun(runId);
      }
      return next;
    });
  }

  async function handleAddSubtask(runId: number, stepId: number) {
    const key = subKey(runId, stepId);
    const title = (subtaskInput.get(key) ?? "").trim();
    if (!title) return;
    const sub = await addPipelineStepSubtask(runId, stepId, title);
    setSubtasks(prev => new Map(prev).set(key, [...(prev.get(key) ?? []), sub]));
    setSubtaskInput(prev => new Map(prev).set(key, ""));
  }

  async function handleToggleSubtask(runId: number, stepId: number, id: number) {
    const key = subKey(runId, stepId);
    const updated = await togglePipelineStepSubtask(id);
    setSubtasks(prev => new Map(prev).set(key, (prev.get(key) ?? []).map(s => s.id === id ? updated : s)));
  }

  async function handleDeleteSubtask(runId: number, stepId: number, id: number) {
    const key = subKey(runId, stepId);
    await deletePipelineStepSubtask(id);
    setSubtasks(prev => new Map(prev).set(key, (prev.get(key) ?? []).filter(s => s.id !== id)));
  }
  const col   = PIPELINE_COLORS[template.color] ?? PIPELINE_COLORS.violet;
  const steps = template.steps;

  const totalRuns    = runs.length;
  const completeRuns = runs.filter(r => steps.length > 0 && r.steps.every(s => s.done)).length;
  const totalCells   = totalRuns * steps.length;
  const doneCells    = runs.reduce((acc, r) => acc + r.steps.filter(s => s.done).length, 0);
  const overallPct   = totalCells > 0 ? Math.round((doneCells / totalCells) * 100) : 0;

  function handleAddRun() {
    const t = addTitle.trim();
    if (!t) return;
    onAddRun(t, addDate);
    setAddTitle(""); setAddDate("");
  }

  return (
    <div className={cn("rounded-xl border bg-card overflow-hidden", col.border)}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b border-border cursor-pointer select-none"
        onClick={() => setCollapsed(c => !c)}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn("transition-transform duration-200 text-muted-foreground/60 shrink-0", collapsed ? "-rotate-90" : "")}>
            <ChevronDown className="h-3.5 w-3.5" />
          </span>
          <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", col.dot)} />
          <span className="text-sm font-semibold text-foreground truncate">{template.title}</span>
          {template.description && (
            <span className="text-xs text-muted-foreground truncate">{template.description}</span>
          )}
          {collapsed && totalRuns > 0 && (
            <span className="text-[10px] text-muted-foreground/50 tabular-nums shrink-0">
              {completeRuns}/{totalRuns} done · {overallPct}%
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEditTemplate}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDeleteTemplate}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Stats — only when there are runs */}
      {!collapsed && totalRuns > 0 && steps.length > 0 && (
        <div className="px-4 py-2.5 border-b border-border/50 bg-secondary/20 flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <BarChart3 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{completeRuns}/{totalRuns}</span> runs fully complete
            </span>
            <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className={cn("h-full rounded-full transition-all duration-500", col.dot)}
                style={{ width: `${overallPct}%` }} />
            </div>
            <span className="text-xs font-semibold text-foreground tabular-nums w-8 text-right">{overallPct}%</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            {steps.map(step => {
              const doneCount = runs.filter(r => r.steps.find(s => s.step_id === step.id)?.done).length;
              const pct = totalRuns > 0 ? Math.round((doneCount / totalRuns) * 100) : 0;
              return (
                <div key={step.id} className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground truncate max-w-[72px]">{step.title}</span>
                  <div className="w-12 h-1 rounded-full bg-secondary overflow-hidden">
                    <div className={cn("h-full rounded-full transition-all", col.dot)} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{doneCount}/{totalRuns}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* No steps state */}
      {!collapsed && steps.length === 0 && (
        <div className="px-4 py-6 text-center">
          <p className="text-xs text-muted-foreground">No steps defined. <button className="text-primary hover:underline" onClick={onEditTemplate}>Edit pipeline</button> to add the formula steps.</p>
        </div>
      )}

      {/* Matrix */}
      {!collapsed && steps.length > 0 && (
        <div className="overflow-x-auto overflow-y-auto max-h-[480px]">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border/50 bg-secondary/30">
                <th className="text-left px-4 py-2 text-muted-foreground font-medium min-w-[160px]">Run</th>
                {steps.map(step => (
                  <th key={step.id} className="px-3 py-2 text-center text-muted-foreground font-medium min-w-[80px]">
                    <div className="flex flex-col items-center gap-0.5">
                      <span className="truncate max-w-[80px]" title={step.title}>{step.title}</span>
                      {step.time_estimate != null && (
                        <span className="text-[9px] font-normal text-muted-foreground/50">
                          {step.time_estimate < 60 ? `${step.time_estimate}m` : `${Math.floor(step.time_estimate / 60)}h${step.time_estimate % 60 > 0 ? `${step.time_estimate % 60}m` : ""}`}
                        </span>
                      )}
                    </div>
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-muted-foreground font-medium w-14">Done</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => {
                const doneCount  = run.steps.filter(s => s.done).length;
                const allDone    = steps.length > 0 && doneCount === steps.length;
                const isExpanded = expandedRuns.has(run.id);
                return (
                  <>
                    <tr key={run.id} className={cn(
                      "transition-colors group/row",
                      isExpanded ? "bg-secondary/10" : "border-b border-border/30 hover:bg-secondary/20",
                      allDone && "opacity-55",
                    )}>
                      <td className={cn("px-2 py-2 border-l-2", isExpanded ? col.accent : "border-l-transparent")}>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <button
                            onClick={() => toggleExpand(run.id)}
                            className="shrink-0 text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                            title="Expand step details"
                          >
                            {isExpanded
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />}
                          </button>
                          <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                            {editingRunId === run.id ? (
                              <input
                                autoFocus
                                className="h-6 w-full rounded border border-primary bg-background px-1.5 text-xs font-medium text-foreground outline-none focus:ring-1 focus:ring-ring"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onBlur={() => {
                                  const t = editingTitle.trim();
                                  if (t && t !== run.title) onUpdateRunTitle(run.id, t);
                                  setEditingRunId(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") { e.currentTarget.blur(); }
                                  if (e.key === "Escape") { setEditingRunId(null); }
                                }}
                              />
                            ) : (
                              <span
                                className={cn("font-medium text-foreground truncate cursor-text hover:text-primary transition-colors", allDone && "line-through text-muted-foreground")}
                                title="Click to rename"
                                onClick={(e) => { e.stopPropagation(); setEditingRunId(run.id); setEditingTitle(run.title); }}
                              >
                                {run.title}
                              </span>
                            )}
                            {run.scheduled_date && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <Calendar className="h-2.5 w-2.5" />{run.scheduled_date}
                              </span>
                            )}
                          </div>
                          <MiniPie steps={steps} runSteps={run.steps} size={28} />
                        </div>
                      </td>
                      {steps.map(step => {
                        const rs   = run.steps.find(s => s.step_id === step.id);
                        const done = rs?.done ?? false;
                        const linked = !!rs?.assignment_id;
                        const stype = step.step_type ?? "generic";
                        const effectiveMin = stype !== "generic" ? getEffectiveTime(step, rs) : null;
                        const showTime = effectiveMin !== null && effectiveMin !== step.time_estimate;
                        const timeLabel = effectiveMin !== null
                          ? (effectiveMin < 60 ? `${effectiveMin}m` : `${Math.floor(effectiveMin / 60)}h${effectiveMin % 60 > 0 ? `${effectiveMin % 60}m` : ""}`)
                          : null;
                        return (
                          <td key={step.id} className="px-3 py-2 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <button
                                onClick={() => onToggleStep(run.id, step.id)}
                                title={done ? `Done${rs?.done_at ? ` · ${rs.done_at.slice(0, 10)}` : ""}` : "Mark done"}
                                className={cn(
                                  "inline-flex items-center justify-center h-6 w-6 rounded-full border transition-all mx-auto",
                                  done
                                    ? cn("border-transparent text-white", col.dot)
                                    : "border-border text-transparent hover:border-primary/60 hover:text-primary/40"
                                )}
                              >
                                {done ? <Check className="h-3 w-3" /> : <Circle className="h-2.5 w-2.5" />}
                              </button>
                              {showTime && timeLabel && (
                                <span className="text-[8px] text-muted-foreground/60 leading-none tabular-nums">{timeLabel}</span>
                              )}
                              {linked && (
                                <span className="text-[8px] text-muted-foreground/40 leading-none" title="Linked to assignment">⇌</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                      <td className="px-3 py-2 text-center">
                        <span className={cn("text-xs tabular-nums font-medium", allDone ? "text-emerald-500" : "text-muted-foreground")}>
                          {doneCount}/{steps.length}
                        </span>
                      </td>
                      <td className="px-1 py-2 text-center">
                        <button
                          onClick={() => onDeleteRun(run.id)}
                          className="opacity-0 group-hover/row:opacity-100 p-1 rounded text-muted-foreground/40 hover:text-destructive transition-all"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr key={`${run.id}-detail`} className="border-b border-border/30 bg-secondary/10">
                        <td colSpan={steps.length + 3} className={cn("px-4 pb-3 pt-1 border-l-2", col.accent)}>
                          <div className="flex flex-wrap gap-2">
                            {steps.map(step => {
                              const rs = run.steps.find(s => s.step_id === step.id);
                              const stype = rs?.step_type ?? step.step_type ?? "generic";
                              const typeInfo = STEP_TYPES.find(t => t.value === stype);
                              const key = subKey(run.id, step.id);
                              const stepSubs = subtasks.get(key) ?? [];
                              const inputCls2 = "h-6 w-full rounded border border-input bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground/30";
                              const field = (label: string, children: React.ReactNode) => (
                                <div className="flex flex-col gap-0.5">
                                  <span className="text-[9px] text-muted-foreground/50 font-medium uppercase tracking-wide">{label}</span>
                                  {children}
                                </div>
                              );
                              return (
                                <div key={step.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5 min-w-[160px] max-w-[220px]">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-sm leading-none">{typeInfo?.icon ?? "📝"}</span>
                                    <span className="text-xs font-medium text-foreground">{step.title}</span>
                                  </div>
                                  {stype !== "generic" && (
                                    <div className="flex flex-col gap-1.5">
                                      {stype === "read" && <>
                                        {field("Pre-read by",
                                          <input type="date" key={rs?.due_date ?? ""} defaultValue={rs?.due_date ?? ""} className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { due_date: e.target.value || null }, rs)} />
                                        )}
                                        {field("Day of lecture",
                                          <input type="date" key={rs?.due_date_2 ?? ""} defaultValue={rs?.due_date_2 ?? ""} className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { due_date_2: e.target.value || null }, rs)} />
                                        )}
                                      </>}
                                      {stype === "attend" && <>
                                        {field("Date",
                                          <input type="date" defaultValue={rs?.due_date ?? ""} className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { due_date: e.target.value || null }, rs)} />
                                        )}
                                      </>}
                                      {stype === "read" && <>
                                        {field("Chapter",
                                          <input type="text" defaultValue={rs?.chapter_ref ?? ""} placeholder="e.g. Ch 4–5" className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { chapter_ref: e.target.value.trim() || null }, rs)} />
                                        )}
                                        {field("Pages",
                                          <div className="flex items-center gap-1">
                                            <input type="number" defaultValue={rs?.page_start ?? ""} placeholder="from" className="h-6 w-16 rounded border border-input bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground/30"
                                              onBlur={(e) => onUpdateRunStep(run.id, step.id, { page_start: e.target.value ? Number(e.target.value) : null }, rs)} />
                                            <span className="text-[9px] text-muted-foreground/40">–</span>
                                            <input type="number" defaultValue={rs?.page_end ?? ""} placeholder="to" className="h-6 w-16 rounded border border-input bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring text-foreground placeholder:text-muted-foreground/30"
                                              onBlur={(e) => onUpdateRunStep(run.id, step.id, { page_end: e.target.value ? Number(e.target.value) : null }, rs)} />
                                          </div>
                                        )}
                                        {field("Est. (min)",
                                          <input type="number" min={1} defaultValue={rs?.time_estimate ?? ""} placeholder={step.time_estimate ? String(step.time_estimate) : "min"} className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { time_estimate: e.target.value ? Number(e.target.value) : null }, rs)} />
                                        )}
                                      </>}
                                      {stype === "attend" && <>
                                        {field("Start",
                                          <input type="time" defaultValue={rs?.start_time ?? ""} className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { start_time: e.target.value || null }, rs)} />
                                        )}
                                        {field("End",
                                          <input type="time" defaultValue={rs?.end_time ?? ""} className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { end_time: e.target.value || null }, rs)} />
                                        )}
                                        {field("Location",
                                          <input type="text" defaultValue={rs?.location ?? ""} placeholder="e.g. Room 204" className={inputCls2}
                                            onBlur={(e) => onUpdateRunStep(run.id, step.id, { location: e.target.value.trim() || null }, rs)} />
                                        )}
                                      </>}
                                    </div>
                                  )}
                                  {/* Subtasks */}
                                  <div className="flex flex-col gap-1 border-t border-border/40 pt-1.5 mt-0.5">
                                    {stepSubs.map(sub => (
                                      <div key={sub.id} className="flex items-center gap-1 group/sub">
                                        <button
                                          onClick={() => handleToggleSubtask(run.id, step.id, sub.id)}
                                          className={cn(
                                            "shrink-0 h-3.5 w-3.5 rounded-sm border flex items-center justify-center transition-colors",
                                            sub.done
                                              ? "border-transparent bg-emerald-500 text-white"
                                              : "border-border hover:border-primary/60"
                                          )}
                                        >
                                          {sub.done && <Check className="h-2 w-2" />}
                                        </button>
                                        <span className={cn("flex-1 text-[10px] leading-tight min-w-0 truncate", sub.done && "line-through text-muted-foreground/50")}>
                                          {sub.title}
                                        </span>
                                        <button
                                          onClick={() => handleDeleteSubtask(run.id, step.id, sub.id)}
                                          className="opacity-0 group-hover/sub:opacity-100 text-muted-foreground/40 hover:text-destructive transition-all shrink-0"
                                        >
                                          <X className="h-2.5 w-2.5" />
                                        </button>
                                      </div>
                                    ))}
                                    <div className="flex items-center gap-1 mt-0.5">
                                      <input
                                        className="flex-1 h-5 rounded border border-input bg-background px-1.5 text-[10px] outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/30 min-w-0"
                                        placeholder="Add subtask…"
                                        value={subtaskInput.get(key) ?? ""}
                                        onChange={(e) => setSubtaskInput(prev => new Map(prev).set(key, e.target.value))}
                                        onKeyDown={(e) => { if (e.key === "Enter") handleAddSubtask(run.id, step.id); }}
                                      />
                                      <button
                                        onClick={() => handleAddSubtask(run.id, step.id)}
                                        className="shrink-0 h-5 w-5 flex items-center justify-center rounded border border-input bg-background text-muted-foreground hover:text-foreground hover:border-primary/60 transition-colors"
                                      >
                                        <Plus className="h-2.5 w-2.5" />
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border/50 bg-secondary/10">
                <td colSpan={steps.length + 3} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <input
                      className="flex-1 h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/40 min-w-0"
                      placeholder="Add run… (e.g. Lecture 4: Sorting)"
                      value={addTitle}
                      onChange={(e) => setAddTitle(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddRun(); }}
                    />
                    <input type="date"
                      className="h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring w-32 shrink-0"
                      value={addDate} onChange={(e) => setAddDate(e.target.value)} />
                    <Button size="sm" variant="outline" className="h-7 px-2 shrink-0" onClick={handleAddRun}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Books tab ──────────────────────────────────────────────────────────────────

function todayStrBooks() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function weekMondayBooks(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

function GoalBar({ label, value, goal, unit }: { label: string; value: number; goal: number; unit: string }) {
  if (goal <= 0) return null;
  const pct = Math.min(100, Math.round((value / goal) * 100));
  const met = value >= goal;
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-muted-foreground w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: met ? "#10b981" : "#6366f1" }} />
      </div>
      <span className={cn("text-[11px] tabular-nums w-20 text-right shrink-0", met ? "text-emerald-500 font-medium" : "text-muted-foreground")}>
        {value} / {goal} {unit}
      </span>
    </div>
  );
}

// ── Book section kind config ───────────────────────────────────────────────────

const SECTION_KINDS: { value: string; label: string; color: string }[] = [
  { value: "chapter",  label: "Chapter",  color: "text-emerald-500 bg-emerald-500/10 border-emerald-400/30" },
  { value: "section",  label: "Section",  color: "text-blue-500    bg-blue-500/10    border-blue-400/30"    },
  { value: "page",     label: "Pages",    color: "text-orange-500  bg-orange-500/10  border-orange-400/30"  },
];

function kindColor(kind: string) {
  return SECTION_KINDS.find(k => k.value === kind)?.color ?? SECTION_KINDS[0].color;
}

type SectionDraft = { id?: number; title: string; kind: string; page_start: string; page_end: string; time_estimate: string };

function BookCard({ book, onUpdate, onDelete, onAddLog, onDeleteLog, onToggleSection, onUpsertSections }: {
  book: CourseBook;
  onUpdate: (patch: Partial<{ title: string; author: string | null; total_pages: number | null; total_chapters: number | null; daily_pages_goal: number; weekly_chapters_goal: number }>) => void;
  onDelete: () => void;
  onAddLog: (pages: number, chapters: number, note: string) => void;
  onDeleteLog: (logId: number) => void;
  onToggleSection: (sectionId: number) => void;
  onUpsertSections: (drafts: SectionDraft[]) => void;
}) {
  const [collapsed,  setCollapsed]  = useState(false);
  const [editSecs,   setEditSecs]   = useState(false);
  const [drafts,     setDrafts]     = useState<SectionDraft[]>([]);
  const [newTitle,   setNewTitle]   = useState("");
  const [newKind,    setNewKind]    = useState("chapter");
  const [logOpen,    setLogOpen]    = useState(false);
  const [logPages,   setLogPages]   = useState("");
  const [logChap,    setLogChap]    = useState("");
  const [logNote,    setLogNote]    = useState("");

  const today     = todayStrBooks();
  const weekStart = weekMondayBooks(today);

  const doneSections = book.sections.filter(s => s.done).length;
  const totalSections = book.sections.length;
  const secPct = totalSections > 0 ? Math.round((doneSections / totalSections) * 100) : null;
  const todayPages   = book.log.filter(e => e.date === today).reduce((s, e) => s + e.pages_read, 0);
  const weekChapters = book.log.filter(e => e.date >= weekStart).reduce((s, e) => s + e.chapters_read, 0);
  const pagesPct     = book.total_pages    ? Math.min(100, Math.round((book.current_page    / book.total_pages)    * 100)) : null;
  const chapPct      = book.total_chapters ? Math.min(100, Math.round((book.current_chapter / book.total_chapters) * 100)) : null;

  function openEdit() {
    setDrafts(book.sections.map(s => ({
      id:            s.id,
      title:         s.title,
      kind:          s.kind,
      page_start:    s.page_start != null ? String(s.page_start) : "",
      page_end:      s.page_end   != null ? String(s.page_end)   : "",
      time_estimate: s.time_estimate != null ? String(s.time_estimate) : "",
    })));
    setEditSecs(true);
  }

  function addDraft() {
    const t = newTitle.trim();
    if (!t) return;
    setDrafts(d => [...d, { title: t, kind: newKind, page_start: "", page_end: "", time_estimate: "" }]);
    setNewTitle("");
  }

  function moveDraft(i: number, dir: -1 | 1) {
    const j = i + dir;
    setDrafts(d => { const a = [...d]; [a[i], a[j]] = [a[j], a[i]]; return a; });
  }

  function saveSections() {
    onUpsertSections(drafts);
    setEditSecs(false);
  }

  function commitLog() {
    const p = Math.max(0, parseInt(logPages) || 0);
    const c = Math.max(0, parseFloat(logChap) || 0);
    if (p === 0 && c === 0) return;
    onAddLog(p, c, logNote.trim());
    setLogPages(""); setLogChap(""); setLogNote(""); setLogOpen(false);
  }

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="relative flex items-center gap-2 px-4 py-3 border-b border-border bg-secondary/20 cursor-pointer select-none" onClick={() => setCollapsed(v => !v)}>
        <span className="text-muted-foreground/60 shrink-0 transition-transform" style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}>
          <ChevronDown className="h-3.5 w-3.5" />
        </span>
        <BookOpen className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground truncate">{book.title || "Untitled"}</span>
            {book.author && <span className="text-xs text-muted-foreground/60 truncate">{book.author}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            {secPct !== null && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                {doneSections}/{totalSections} read
              </span>
            )}
            {pagesPct !== null && <span className="text-[10px] text-muted-foreground">{pagesPct}% pages</span>}
            {chapPct  !== null && <span className="text-[10px] text-muted-foreground">{chapPct}% ch.</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
        {/* Progress strip */}
        {(pagesPct !== null || secPct !== null) && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-border/30">
            <div
              className="h-full bg-emerald-500/50 transition-all duration-500"
              style={{ width: `${pagesPct ?? secPct ?? 0}%` }}
            />
          </div>
        )}
      </div>

      {!collapsed && (
        <div className="p-4 flex flex-col gap-4">

          {/* ── Sections (read assignments) ── */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                Sections <span className="text-muted-foreground/50">— each is a read assignment</span>
              </p>
              {!editSecs && (
                <button className="text-[10px] text-muted-foreground hover:text-foreground transition-colors" onClick={openEdit}>
                  Edit sections
                </button>
              )}
            </div>

            {/* View mode */}
            {!editSecs && (
              <>
                {book.sections.length === 0 && (
                  <p className="text-xs text-muted-foreground/50 italic">No sections yet. Click "Edit sections" to add chapters, sections or page ranges.</p>
                )}
                {book.sections.map(sec => (
                  <div key={sec.id} className={cn(
                    "flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors",
                    sec.done
                      ? "border-border/30 bg-secondary/10 opacity-60"
                      : "border-border bg-secondary/30"
                  )}>
                    <button
                      className="shrink-0 text-muted-foreground hover:text-emerald-500 transition-colors"
                      onClick={() => onToggleSection(sec.id)}
                    >
                      {sec.done
                        ? <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                        : <Circle className="h-4 w-4" />
                      }
                    </button>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium shrink-0", kindColor(sec.kind))}>
                      {SECTION_KINDS.find(k => k.value === sec.kind)?.label ?? sec.kind}
                    </span>
                    <span className={cn("flex-1 text-sm min-w-0 truncate", sec.done && "line-through text-muted-foreground")}>
                      {sec.title}
                    </span>
                    {(sec.page_start != null || sec.page_end != null) && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        pp. {sec.page_start ?? "?"}–{sec.page_end ?? "?"}
                      </span>
                    )}
                    {sec.due_date && (
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">{sec.due_date}</span>
                    )}
                  </div>
                ))}
                <button
                  className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-muted-foreground transition-colors mt-1"
                  onClick={openEdit}
                >
                  <Plus className="h-3 w-3" /> Add section
                </button>
              </>
            )}

            {/* Edit mode */}
            {editSecs && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-secondary/10 p-3">
                {drafts.length === 0 && (
                  <p className="text-xs text-muted-foreground/50 italic">No sections. Add chapters, sections, or page ranges below.</p>
                )}
                {drafts.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5">
                    <div className="flex flex-col mr-0.5">
                      <button type="button" disabled={i === 0} onClick={() => moveDraft(i, -1)}
                        className="text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 transition-colors">
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button type="button" disabled={i === drafts.length - 1} onClick={() => moveDraft(i, 1)}
                        className="text-muted-foreground/40 hover:text-muted-foreground disabled:opacity-20 transition-colors">
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                    <span className="text-[10px] text-muted-foreground/40 font-mono w-4 shrink-0 text-right">{i + 1}</span>
                    <select
                      className="h-6 rounded border border-input bg-background px-1 text-[10px] outline-none focus:ring-1 focus:ring-ring text-muted-foreground shrink-0"
                      value={d.kind}
                      onChange={e => setDrafts(prev => prev.map((x, idx) => idx === i ? { ...x, kind: e.target.value } : x))}
                    >
                      {SECTION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                    </select>
                    <input
                      className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground/40 min-w-0"
                      value={d.title}
                      placeholder="Title"
                      onChange={e => setDrafts(prev => prev.map((x, idx) => idx === i ? { ...x, title: e.target.value } : x))} />
                    <input type="number" min={0} placeholder="p. start"
                      className="w-16 h-6 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring text-muted-foreground"
                      value={d.page_start}
                      onChange={e => setDrafts(prev => prev.map((x, idx) => idx === i ? { ...x, page_start: e.target.value } : x))} />
                    <input type="number" min={0} placeholder="p. end"
                      className="w-16 h-6 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring text-muted-foreground"
                      value={d.page_end}
                      onChange={e => setDrafts(prev => prev.map((x, idx) => idx === i ? { ...x, page_end: e.target.value } : x))} />
                    <button type="button" onClick={() => setDrafts(d => d.filter((_, idx) => idx !== i))}
                      className="text-muted-foreground/30 hover:text-destructive transition-colors shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                {/* Add row */}
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded border border-input bg-background px-1.5 text-xs outline-none focus:ring-1 focus:ring-ring text-muted-foreground shrink-0"
                    value={newKind}
                    onChange={e => setNewKind(e.target.value)}
                  >
                    {SECTION_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                  <input className={cn(inputCls, "flex-1")} placeholder="Add chapter / section…"
                    value={newTitle} onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addDraft(); } }} />
                  <Button type="button" size="sm" variant="outline" onClick={addDraft} className="shrink-0 h-8">
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button size="sm" className="flex-1" onClick={saveSections}>Save sections</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditSecs(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Meta fields ── */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Title</label>
              <input className={inputCls} value={book.title} onChange={e => onUpdate({ title: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Author</label>
              <input className={inputCls} value={book.author ?? ""} onChange={e => onUpdate({ author: e.target.value || null })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Total pages</label>
              <input type="number" min={0} className={inputCls} value={book.total_pages ?? ""} placeholder="—"
                onChange={e => onUpdate({ total_pages: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Total chapters</label>
              <input type="number" min={0} className={inputCls} value={book.total_chapters ?? ""} placeholder="—"
                onChange={e => onUpdate({ total_chapters: e.target.value ? Number(e.target.value) : null })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Daily pages goal</label>
              <input type="number" min={0} className={inputCls} value={book.daily_pages_goal || ""}
                onChange={e => onUpdate({ daily_pages_goal: Number(e.target.value) || 0 })} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground">Weekly chapters goal</label>
              <input type="number" min={0} step={0.5} className={inputCls} value={book.weekly_chapters_goal || ""}
                onChange={e => onUpdate({ weekly_chapters_goal: Number(e.target.value) || 0 })} />
            </div>
          </div>

          {/* ── Overall progress ── */}
          {(book.total_pages || book.total_chapters) && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Overall progress</p>
              {book.total_pages    ? <GoalBar label="Pages"    value={book.current_page}    goal={book.total_pages}    unit="pages" /> : null}
              {book.total_chapters ? <GoalBar label="Chapters" value={book.current_chapter} goal={book.total_chapters} unit="ch."   /> : null}
            </div>
          )}

          {/* ── Today / this week ── */}
          {(book.daily_pages_goal > 0 || book.weekly_chapters_goal > 0) && (
            <div className="flex flex-col gap-1.5">
              <p className="text-xs font-medium text-muted-foreground">Today / this week</p>
              {book.daily_pages_goal     > 0 ? <GoalBar label="Today (pages)"   value={todayPages}   goal={book.daily_pages_goal}    unit="pages" /> : null}
              {book.weekly_chapters_goal > 0 ? <GoalBar label="This week (ch.)" value={weekChapters} goal={book.weekly_chapters_goal} unit="ch."   /> : null}
            </div>
          )}

          {/* ── Log session ── */}
          <div className="flex flex-col gap-2">
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setLogOpen(v => !v)}
            >
              {logOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Log reading session
            </button>
            {logOpen && (
              <div className="flex flex-wrap items-end gap-3 p-3 rounded-lg bg-secondary/30 border border-border">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Pages read</label>
                  <input type="number" min={0} className={cn(inputCls, "w-24")} value={logPages} placeholder="0"
                    onChange={e => setLogPages(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">Chapters read</label>
                  <input type="number" min={0} step={0.5} className={cn(inputCls, "w-24")} value={logChap} placeholder="0"
                    onChange={e => setLogChap(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1 flex-1 min-w-32">
                  <label className="text-xs text-muted-foreground">Note (optional)</label>
                  <input className={inputCls} value={logNote} placeholder="What did you read?"
                    onChange={e => setLogNote(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") commitLog(); }} />
                </div>
                <Button size="sm" className="h-8 shrink-0" onClick={commitLog}>Save</Button>
              </div>
            )}
          </div>

          {/* ── History ── */}
          {book.log.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <p className="text-xs font-medium text-muted-foreground mb-1">History</p>
              {[...book.log].reverse().map(entry => (
                <div key={entry.id} className="flex items-center gap-2 py-1 border-b border-border/40 group text-xs">
                  <span className="text-muted-foreground w-24 shrink-0">{entry.date}</span>
                  <span className="text-foreground/80 w-12 shrink-0">{entry.pages_read}p</span>
                  <span className="text-foreground/80 w-12 shrink-0">{entry.chapters_read}ch</span>
                  {entry.note && <span className="flex-1 text-muted-foreground truncate">{entry.note}</span>}
                  <button
                    className="ml-auto opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-destructive transition-all shrink-0"
                    onClick={() => onDeleteLog(entry.id)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Courses page ───────────────────────────────────────────────────────────────

export function Courses() {
  const [plans,       setPlans]       = useState<Plan[]>([]);
  const [assignments, setAssignments] = useState<CourseAssignment[]>([]);
  const [subtasks,    setSubtasks]    = useState<Map<number, CaSubtask[]>>(new Map());
  const [selectedPlan, setSelectedPlan] = useState<number | null>(null);
  const [typeFilter,   setTypeFilter]   = useState<string>("all");
  const [showManage,   setShowManage]   = useState(false);
  const [activeTab, setActiveTab] = useState<"assignments" | "pipelines" | "books">("assignments");
  const [books,         setBooks]         = useState<CourseBook[]>([]);
  const [pipelines,     setPipelines]     = useState<PipelineTemplate[]>([]);
  const [pipelineRuns,  setPipelineRuns]  = useState<Map<number, PipelineRun[]>>(new Map());
  const [pipelineModal, setPipelineModal] = useState<
    | { kind: "create" }
    | { kind: "edit"; template: PipelineTemplate }
    | null
  >(null);
  const [modal, setModal] = useState<
    | { kind: "create" }
    | { kind: "edit"; assignment: CourseAssignment }
    | null
  >(null);

  const load = useCallback(async () => {
    const [p, a] = await Promise.all([getPlans(), getCourseAssignments()]);
    setPlans(p);
    setAssignments(a);
  }, []);

  const loadPipelines = useCallback(async (planId: number) => {
    const templates = await getPipelineTemplates(planId);
    setPipelines(templates);
    const entries = await Promise.all(
      templates.map(async (t) => [t.id, await getPipelineRuns(t.id)] as [number, PipelineRun[]])
    );
    setPipelineRuns(new Map(entries));
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selectedPlan !== null && activeTab === "pipelines") {
      loadPipelines(selectedPlan);
    }
    if (selectedPlan !== null && activeTab === "books") {
      getCourseBooks(selectedPlan).then(setBooks);
    }
  }, [selectedPlan, activeTab, loadPipelines]);

  // ── Derived data ─────────────────────────────────────────────────────────────

  const activePlans  = plans.filter((p) => p.status === "active");
  const coursePlans  = activePlans.filter((p) => p.is_course);

  // Progress stats per plan — overall + per-type
  function planProgress(planId: number) {
    const all = assignments.filter((a) => a.plan_id === planId);
    const total = all.length;
    const done  = all.filter((a) => a.status === "done").length;
    const overallPct = total === 0 ? 0 : Math.round((done / total) * 100);
    // group by type — only types that have at least one assignment
    const byType = new Map<string, { done: number; total: number }>();
    for (const a of all) {
      const e = byType.get(a.assignment_type) ?? { done: 0, total: 0 };
      e.total++;
      if (a.status === "done") e.done++;
      byType.set(a.assignment_type, e);
    }
    return { total, done, overallPct, byType };
  }

  const coursePlanIds = new Set(coursePlans.map((p) => p.id));
  const courseAssignments = assignments.filter((a) => coursePlanIds.has(a.plan_id));
  const totalPending = courseAssignments.filter((a) => a.status !== "done").length;

  // Filter
  const visible = courseAssignments.filter((a) => {
    if (selectedPlan !== null && a.plan_id !== selectedPlan) return false;
    if (typeFilter !== "all" && a.assignment_type !== typeFilter) return false;
    return true;
  });

  // Group by bucket (dynamic week keys)
  const grouped = new Map<BucketKey, CourseAssignment[]>();
  for (const a of visible) {
    const k = bucketKey(a);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k)!.push(a);
  }

  // Build ordered list of bucket keys: fixed order, then sorted week_ keys, then no_date + done
  const weekKeys = [...grouped.keys()]
    .filter((k) => k.startsWith("week_"))
    .sort();
  const orderedKeys: BucketKey[] = [
    "overdue", "today", "tomorrow", "this_week",
    ...weekKeys,
    "no_date", "done",
  ].filter((k) => grouped.has(k));

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function handleCreate(d: Draft) {
    const created = await createCourseAssignment(toPayload(d));
    setAssignments((prev) => [...prev, created].sort((a, b) => {
      if (!a.due_date && b.due_date) return 1;
      if (a.due_date && !b.due_date) return -1;
      return (a.due_date ?? "") < (b.due_date ?? "") ? -1 : 1;
    }));
    setModal(null);
  }

  async function handleEdit(a: CourseAssignment, d: Draft) {
    const updated = await updateCourseAssignment(a.id, toPayload(d));
    setAssignments((prev) => prev.map((x) => x.id === a.id ? updated : x));
    setModal(null);
  }

  async function handleDelete(id: number) {
    await deleteCourseAssignment(id);
    setAssignments((prev) => prev.filter((a) => a.id !== id));
    setModal(null);
    // Reload pipeline runs so any linked ⇌ indicators clear (ON DELETE SET NULL cleared the FK)
    if (selectedPlan !== null) {
      const templates = await getPipelineTemplates(selectedPlan);
      const runsEntries = await Promise.all(
        templates.map(t => getPipelineRuns(t.id).then(runs => [t.id, runs] as const))
      );
      setPipelineRuns(new Map(runsEntries));
    }
  }

  async function handleCycleStatus(a: CourseAssignment) {
    const next = NEXT_STATUS[a.status] ?? "pending";
    const updated = await updateCourseAssignment(a.id, toPayload({ ...draftFromAssignment(a), status: next }));
    setAssignments((prev) => prev.map((x) => x.id === a.id ? updated : x));
  }

  async function handlePageUpdate(a: CourseAssignment, pageCurrentStr: string) {
    const pc = pageCurrentStr ? Number(pageCurrentStr) : null;
    const draft = draftFromAssignment(a);
    const updated = await updateCourseAssignment(a.id, toPayload({ ...draft, page_current: String(pc ?? "") }));
    setAssignments((prev) => prev.map((x) => x.id === a.id ? updated : x));
  }

  async function handleToggleCourseTag(plan: Plan) {
    const updated = await updatePlan(plan.id, {
      title: plan.title,
      description: plan.description ?? null,
      deadline: plan.deadline ?? null,
      goal_id: plan.goal_id ?? null,
      status: plan.status,
      tags: plan.tags ?? null,
      is_course: !plan.is_course,
    });
    setPlans((prev) => prev.map((p) => p.id === plan.id ? updated : p));
    // If we removed the course flag from the currently selected plan, deselect it
    if (plan.is_course && selectedPlan === plan.id) setSelectedPlan(null);
  }

  function getSubtasks(assignmentId: number): CaSubtask[] {
    return subtasks.get(assignmentId) ?? [];
  }

  function setAssignmentSubtasks(assignmentId: number, subs: CaSubtask[]) {
    setSubtasks((prev) => new Map(prev).set(assignmentId, subs));
  }

  async function handleAddSubtask(assignmentId: number, title: string) {
    const sub = await addCaSubtask(assignmentId, title);
    setAssignmentSubtasks(assignmentId, [...getSubtasks(assignmentId), sub]);
  }

  async function handleToggleSubtask(assignmentId: number, id: number) {
    const updated = await toggleCaSubtask(id);
    setAssignmentSubtasks(assignmentId, getSubtasks(assignmentId).map((s) => s.id === id ? updated : s));
  }

  async function handleDeleteSubtask(assignmentId: number, id: number) {
    await deleteCaSubtask(id);
    setAssignmentSubtasks(assignmentId, getSubtasks(assignmentId).filter((s) => s.id !== id));
  }

  async function handleLoadSubtasks(assignmentId: number) {
    if (subtasks.has(assignmentId)) return;
    const subs = await getCaSubtasks(assignmentId);
    setAssignmentSubtasks(assignmentId, subs);
  }

  // ── Book handlers ─────────────────────────────────────────────────────────────

  async function handleCreateBook() {
    if (selectedPlan === null) return;
    const book = await createCourseBook({ plan_id: selectedPlan, title: "New Book" });
    setBooks(prev => [...prev, book]);
  }

  async function handleUpdateBook(id: number, patch: Partial<{ title: string; author: string | null; total_pages: number | null; total_chapters: number | null; daily_pages_goal: number; weekly_chapters_goal: number }>) {
    const book = books.find(b => b.id === id);
    if (!book) return;
    const updated = await updateCourseBook(id, {
      title:                patch.title                ?? book.title,
      author:               "author" in patch          ? patch.author!    : book.author,
      total_pages:          "total_pages" in patch     ? patch.total_pages! : book.total_pages,
      total_chapters:       "total_chapters" in patch  ? patch.total_chapters! : book.total_chapters,
      current_page:         book.current_page,
      current_chapter:      book.current_chapter,
      daily_pages_goal:     patch.daily_pages_goal     ?? book.daily_pages_goal,
      weekly_chapters_goal: patch.weekly_chapters_goal ?? book.weekly_chapters_goal,
    });
    setBooks(prev => prev.map(b => b.id === id ? updated : b));
  }

  async function handleDeleteBook(id: number) {
    await deleteCourseBook(id);
    setBooks(prev => prev.filter(b => b.id !== id));
  }

  async function handleAddBookLog(bookId: number, pages: number, chapters: number, note: string) {
    const updated = await addBookReadingLog({ book_id: bookId, date: todayStrBooks(), pages_read: pages, chapters_read: chapters, note: note || null });
    setBooks(prev => prev.map(b => b.id === bookId ? updated : b));
  }

  async function handleDeleteBookLog(logId: number, bookId: number) {
    const updated = await deleteBookReadingLog(logId, bookId);
    setBooks(prev => prev.map(b => b.id === bookId ? updated : b));
  }

  async function handleToggleBookSection(bookId: number, sectionId: number) {
    const updated = await toggleBookSection(bookId, sectionId);
    setBooks(prev => prev.map(b => b.id === bookId ? updated : b));
  }

  async function handleUpsertBookSections(bookId: number, drafts: { id?: number; title: string; kind: string; page_start: string; page_end: string; time_estimate: string }[]) {
    const payload = drafts.map((d, i) => ({
      id:            d.id ?? null,
      title:         d.title,
      kind:          d.kind,
      sort_order:    i,
      page_start:    d.page_start  ? Number(d.page_start)  : null,
      page_end:      d.page_end    ? Number(d.page_end)    : null,
      due_date:      null,
      time_estimate: d.time_estimate ? Number(d.time_estimate) : null,
    }));
    const updated = await upsertBookSections(bookId, payload);
    setBooks(prev => prev.map(b => b.id === bookId ? updated : b));
  }

  // ── Pipeline handlers ─────────────────────────────────────────────────────────

  async function handleSavePipelineTemplate(_t: PipelineTemplate) {
    if (selectedPlan !== null) await loadPipelines(selectedPlan);
    setPipelineModal(null);
  }

  async function handleDeletePipelineTemplate(id: number) {
    await deletePipelineTemplate(id);
    setPipelines(prev => prev.filter(t => t.id !== id));
    setPipelineRuns(prev => { const m = new Map(prev); m.delete(id); return m; });
  }

  async function handleTogglePipelineStep(runId: number, stepId: number, templateId: number) {
    const updatedRun = await togglePipelineRunStep(runId, stepId);
    setPipelineRuns(prev => {
      const m = new Map(prev);
      m.set(templateId, (prev.get(templateId) ?? []).map(r => r.id === runId ? updatedRun : r));
      return m;
    });
    // Refresh template stats + assignments (status may have changed)
    if (selectedPlan !== null) {
      const [templates] = await Promise.all([
        getPipelineTemplates(selectedPlan),
        getCourseAssignments().then(setAssignments),
      ]);
      setPipelines(templates);
    }
  }

  async function handleCreateFromPreset(preset: typeof PIPELINE_PRESETS[number]) {
    if (selectedPlan === null) return;
    const tmpl = await createPipelineTemplate({ plan_id: selectedPlan, title: preset.title, description: null, color: preset.color });
    const stepInputs = preset.steps.map((s, i) => ({
      id: null,
      title: s.title,
      description: null,
      sort_order: i,
      time_estimate: s.time_estimate ? Number(s.time_estimate) : null,
      step_type: s.step_type,
      attend_type: s.attend_type ?? null,
    }));
    const updatedSteps = await upsertPipelineSteps(tmpl.id, stepInputs);
    const full = { ...tmpl, steps: updatedSteps };
    setPipelines(prev => [...prev, full]);
    setPipelineRuns(prev => new Map(prev).set(full.id, []));
  }

  async function handleUpdatePipelineRunStep(
    runId: number, stepId: number, templateId: number,
    patch: Partial<{ notes: string | null; due_date: string | null; due_date_2: string | null; chapter_ref: string | null; page_start: number | null; page_end: number | null; start_time: string | null; end_time: string | null; location: string | null; time_estimate: number | null }>,
    current: import("../types").PipelineRunStep | undefined,
  ) {
    const merged = { ...current };
    Object.assign(merged, patch);
    // Auto-derive attend time estimate from start/end times
    const st = merged.start_time, et = merged.end_time;
    let attendDerived: number | null = null;
    if (st && et) {
      const [sh, sm] = st.split(":").map(Number);
      const [eh, em] = et.split(":").map(Number);
      const diff = (eh * 60 + em) - (sh * 60 + sm);
      if (diff > 0) attendDerived = diff;
    }
    const payload = {
      notes:         merged.notes         ?? null,
      due_date:      merged.due_date      ?? null,
      due_date_2:    merged.due_date_2    ?? null,
      chapter_ref:   merged.chapter_ref   ?? null,
      page_start:    merged.page_start    ?? null,
      page_end:      merged.page_end      ?? null,
      start_time:    merged.start_time    ?? null,
      end_time:      merged.end_time      ?? null,
      location:      merged.location      ?? null,
      time_estimate: attendDerived !== null
        ? attendDerived
        : (merged.time_estimate ?? null),
    };
    const updatedRun = await updatePipelineRunStep(runId, stepId, payload);
    setPipelineRuns(prev => {
      const m = new Map(prev);
      m.set(templateId, (prev.get(templateId) ?? []).map(r => r.id === runId ? updatedRun : r));
      return m;
    });
    getCourseAssignments().then(setAssignments);
  }

  async function handleAddPipelineRun(templateId: number, title: string, date: string) {
    const newRun = await createPipelineRun({ template_id: templateId, title, scheduled_date: date || null });
    setPipelineRuns(prev => {
      const m = new Map(prev);
      m.set(templateId, [...(prev.get(templateId) ?? []), newRun]);
      return m;
    });
    if (selectedPlan !== null) {
      const [templates] = await Promise.all([
        getPipelineTemplates(selectedPlan),
        getCourseAssignments().then(setAssignments),
      ]);
      setPipelines(templates);
    }
  }

  async function handleUpdatePipelineRunTitle(runId: number, templateId: number, newTitle: string) {
    const run = (pipelineRuns.get(templateId) ?? []).find(r => r.id === runId);
    if (!run) return;
    const updatedRun = await updatePipelineRun(runId, { title: newTitle, notes: run.notes ?? null, scheduled_date: run.scheduled_date ?? null });
    setPipelineRuns(prev => {
      const m = new Map(prev);
      m.set(templateId, (prev.get(templateId) ?? []).map(r => r.id === runId ? updatedRun : r));
      return m;
    });
    getCourseAssignments().then(setAssignments);
  }

  async function handleDeletePipelineRun(runId: number, templateId: number) {
    await deletePipelineRun(runId);
    setPipelineRuns(prev => {
      const m = new Map(prev);
      m.set(templateId, (prev.get(templateId) ?? []).filter(r => r.id !== runId));
      return m;
    });
    if (selectedPlan !== null) {
      const [templates] = await Promise.all([
        getPipelineTemplates(selectedPlan),
        getCourseAssignments().then(setAssignments),
      ]);
      setPipelines(templates);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-[calc(100vh-2.5rem)] overflow-hidden">

      {/* ── Course sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border bg-card flex flex-col overflow-hidden">
        <div className="px-3 py-3 border-b border-border flex items-center justify-between">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Courses</p>
          <button
            onClick={() => setShowManage((v) => !v)}
            title="Manage courses"
            className={cn(
              "p-1 rounded transition-colors",
              showManage
                ? "text-foreground bg-secondary"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
            )}
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>

        {showManage ? (
          /* ── Manage panel ─────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto">
            <p className="px-3 pt-3 pb-1 text-[11px] text-muted-foreground">
              Toggle which plans are courses.
            </p>
            {activePlans.map((p) => {
              const isCourse = p.is_course;
              return (
                <button
                  key={p.id}
                  onClick={() => handleToggleCourseTag(p)}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-left hover:bg-secondary/60 transition-colors"
                >
                  <span className={cn(
                    "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                    isCourse ? "bg-indigo-500 border-indigo-500 text-white" : "border-border"
                  )}>
                    {isCourse && <Check className="h-3 w-3" />}
                  </span>
                  <span className={cn("truncate", isCourse ? "text-foreground" : "text-muted-foreground")}>
                    {p.title}
                  </span>
                </button>
              );
            })}
            {activePlans.length === 0 && (
              <p className="px-3 py-4 text-xs text-muted-foreground">No active plans.</p>
            )}
          </div>
        ) : (
          /* ── Course list ──────────────────────────────────────────── */
          <div className="flex-1 overflow-y-auto">
            {/* All */}
            <button
              onClick={() => setSelectedPlan(null)}
              className={cn(
                "flex items-center justify-between px-3 py-2 text-sm transition-colors text-left w-full",
                selectedPlan === null
                  ? "bg-secondary text-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
              )}
            >
              <span>All Courses</span>
              {totalPending > 0 && (
                <span className="text-[10px] font-semibold bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
                  {totalPending}
                </span>
              )}
            </button>

            {/* Per course */}
            {coursePlans.map((p) => {
              const { total, overallPct, byType } = planProgress(p.id);
              const isSelected = selectedPlan === p.id;
              const typeRows = [...byType.entries()].map(([type, s]) => {
                const tc = typeConfig(type);
                // derive solid bg color from the text- class e.g. "text-sky-500" → "bg-sky-500"
                const barColor = tc.color.trim().split(/\s+/)[0].replace("text-", "bg-");
                const textColor = tc.color.trim().split(/\s+/)[0];
                const pct = s.total === 0 ? 0 : Math.round((s.done / s.total) * 100);
                return { type, tc, barColor, textColor, pct, ...s };
              });
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedPlan(p.id)}
                  className={cn(
                    "flex flex-col gap-1.5 px-3 py-2.5 text-left w-full transition-colors",
                    isSelected
                      ? "bg-secondary text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                  )}
                >
                  {/* Title row */}
                  <div className="flex items-center justify-between gap-1 min-w-0">
                    <span className={cn("text-sm truncate", isSelected ? "font-medium text-foreground" : "text-foreground/80")}>{p.title}</span>
                    {total > 0 && (
                      <span className={cn("text-[10px] tabular-nums shrink-0 font-medium", overallPct === 100 ? "text-emerald-500" : "text-muted-foreground")}>
                        {overallPct}%
                      </span>
                    )}
                  </div>
                  {/* Overall bar */}
                  {total > 0 && (
                    <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className={cn("h-full rounded-full transition-all duration-500", overallPct === 100 ? "bg-emerald-500" : "bg-primary")}
                        style={{ width: `${overallPct}%` }}
                      />
                    </div>
                  )}
                  {/* Per-type rows */}
                  {typeRows.length > 0 && (
                    <div className="flex flex-col gap-0.5">
                      {typeRows.map(({ type, tc, barColor, textColor, pct, done: d, total: t }) => (
                        <div key={type} className="flex items-center gap-1.5">
                          <tc.icon className={cn("h-2.5 w-2.5 shrink-0", textColor)} />
                          <div className="flex-1 h-0.5 rounded-full bg-secondary/80 overflow-hidden">
                            <div className={cn("h-full rounded-full transition-all duration-500", barColor)} style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[9px] text-muted-foreground/60 tabular-nums shrink-0 w-7 text-right">{d}/{t}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}

            {coursePlans.length === 0 && (
              <p className="px-3 py-4 text-xs text-muted-foreground">
                No courses yet. Click <Settings className="h-3 w-3 inline" /> to tag a plan as a course.
              </p>
            )}
          </div>
        )}
      </aside>

      {/* ── Main panel ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Tab bar — only when a specific course is selected */}
        {selectedPlan !== null && (
          <div className="shrink-0 border-b border-border bg-card flex items-center px-4">
            {(["assignments", "pipelines", "books"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 -mb-px transition-colors",
                  activeTab === tab
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "pipelines" && <Workflow className="h-3 w-3" />}
                {tab === "books" && <BookOpen className="h-3 w-3" />}
                {tab === "assignments" ? "Assignments" : tab === "pipelines" ? "Pipelines" : "Books"}
              </button>
            ))}
          </div>
        )}

        {/* ── Assignments tab ─────────────────────────────────────────────── */}
        {activeTab === "assignments" && (
          <>
            <div className="shrink-0 border-b border-border bg-card px-4 py-2 flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap flex-1">
                <button
                  onClick={() => setTypeFilter("all")}
                  className={cn(
                    "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                    typeFilter === "all"
                      ? "bg-secondary text-foreground border-border"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  All
                </button>
                {TYPES.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button key={t.value}
                      onClick={() => setTypeFilter(t.value)}
                      className={cn(
                        "flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                        typeFilter === t.value ? t.color : "border-transparent text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Icon className="h-3 w-3" />{t.label}
                    </button>
                  );
                })}
              </div>
              <Button size="sm" className="h-8 shrink-0" onClick={() => setModal({ kind: "create" })}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Assignment
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto">
              {visible.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                  <BookOpen className="h-8 w-8 opacity-30" />
                  <p className="text-sm">No assignments yet.</p>
                  <Button size="sm" variant="outline" onClick={() => setModal({ kind: "create" })}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add one
                  </Button>
                </div>
              ) : (
                orderedKeys.map((k) => {
                  const items = grouped.get(k)!;
                  const isWeek = k.startsWith("week_");
                  const label  = isWeek ? weekLabel(k.slice(5)) : FIXED_LABELS[k as FixedBucket];
                  const style  = isWeek ? "text-foreground" : FIXED_STYLE[k as FixedBucket];
                  return (
                    <BucketSection key={k} label={label} assignments={items} style={style}>
                      {items.map((a) => (
                        <AssignmentCard
                          key={a.id}
                          assignment={a}
                          subtasks={getSubtasks(a.id)}
                          onCycleStatus={() => handleCycleStatus(a)}
                          onEdit={() => setModal({ kind: "edit", assignment: a })}
                          onPageUpdate={(s) => handlePageUpdate(a, s)}
                          onLoadSubtasks={() => handleLoadSubtasks(a.id)}
                          onToggleSubtask={(id) => handleToggleSubtask(a.id, id)}
                          onDeleteSubtask={(id) => handleDeleteSubtask(a.id, id)}
                          onAddSubtask={(title) => handleAddSubtask(a.id, title)}
                        />
                      ))}
                    </BucketSection>
                  );
                })
              )}
            </div>
          </>
        )}

        {/* ── Pipelines tab ───────────────────────────────────────────────── */}
        {activeTab === "pipelines" && selectedPlan !== null && (
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

            {/* Preset quick-create bar */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Add pipeline</p>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setPipelineModal({ kind: "create" })}>
                  <Plus className="h-3 w-3 mr-1" /> Custom
                </Button>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {PIPELINE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handleCreateFromPreset(preset)}
                    className="flex flex-col items-center gap-1 rounded-lg border border-border bg-secondary/30 px-2 py-2.5 text-center hover:bg-secondary hover:border-primary/30 transition-colors"
                  >
                    <span className="text-lg leading-none">{preset.icon}</span>
                    <span className="text-[10px] font-medium text-foreground leading-tight">{preset.label}</span>
                    <span className="text-[9px] text-muted-foreground/60">{preset.steps.length} steps</span>
                  </button>
                ))}
              </div>
            </div>

            {pipelines.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                <Workflow className="h-8 w-8 opacity-20" />
                <p className="text-xs text-muted-foreground/60 text-center">Click a preset above to create your first pipeline.</p>
              </div>
            ) : (
              pipelines.map((t) => (
                <PipelineMatrix
                  key={t.id}
                  template={t}
                  runs={pipelineRuns.get(t.id) ?? []}
                  onToggleStep={(runId, stepId) => handleTogglePipelineStep(runId, stepId, t.id)}
                  onUpdateRunStep={(runId, stepId, patch, current) => handleUpdatePipelineRunStep(runId, stepId, t.id, patch, current)}
                  onUpdateRunTitle={(runId, newTitle) => handleUpdatePipelineRunTitle(runId, t.id, newTitle)}
                  onAddRun={(title, date) => handleAddPipelineRun(t.id, title, date)}
                  onDeleteRun={(runId) => handleDeletePipelineRun(runId, t.id)}
                  onEditTemplate={() => setPipelineModal({ kind: "edit", template: t })}
                  onDeleteTemplate={() => handleDeletePipelineTemplate(t.id)}
                />
              ))
            )}
          </div>
        )}
      </div>

        {/* ── Books tab ───────────────────────────────────────────────────── */}
        {activeTab === "books" && selectedPlan !== null && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="mx-auto max-w-2xl flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground">Course books — span the full course with daily &amp; weekly reading goals</p>
                <Button size="sm" variant="outline" className="h-8" onClick={handleCreateBook}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Add Book
                </Button>
              </div>
              {books.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 text-muted-foreground">
                  <BookOpen className="h-8 w-8 opacity-20" />
                  <p className="text-xs text-muted-foreground/60">No books yet. Add a course book and set your reading goals.</p>
                  <Button size="sm" variant="outline" onClick={handleCreateBook}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Book
                  </Button>
                </div>
              ) : (
                books.map(book => (
                  <BookCard
                    key={book.id}
                    book={book}
                    onUpdate={patch => handleUpdateBook(book.id, patch)}
                    onDelete={() => handleDeleteBook(book.id)}
                    onAddLog={(pages, chapters, note) => handleAddBookLog(book.id, pages, chapters, note)}
                    onDeleteLog={logId => handleDeleteBookLog(logId, book.id)}
                    onToggleSection={sectionId => handleToggleBookSection(book.id, sectionId)}
                    onUpsertSections={drafts => handleUpsertBookSections(book.id, drafts)}
                  />
                ))
              )}
            </div>
          </div>
        )}

      {/* ── Modals ─────────────────────────────────────────────────────────── */}
      {modal?.kind === "create" && (
        <AssignmentModal
          plans={coursePlans}
          defaultPlanId={selectedPlan ?? undefined}
          onSave={handleCreate}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "edit" && (
        <AssignmentModal
          initial={modal.assignment}
          plans={coursePlans}
          onSave={(d) => handleEdit(modal.assignment, d)}
          onDelete={() => handleDelete(modal.assignment.id)}
          onClose={() => setModal(null)}
        />
      )}
      {pipelineModal?.kind === "create" && selectedPlan !== null && (
        <PipelineTemplateModal
          planId={selectedPlan}
          onSave={handleSavePipelineTemplate}
          onClose={() => setPipelineModal(null)}
        />
      )}
      {pipelineModal?.kind === "edit" && selectedPlan !== null && (
        <PipelineTemplateModal
          initial={pipelineModal.template}
          planId={selectedPlan}
          onSave={handleSavePipelineTemplate}
          onClose={() => setPipelineModal(null)}
        />
      )}
    </div>
  );
}
