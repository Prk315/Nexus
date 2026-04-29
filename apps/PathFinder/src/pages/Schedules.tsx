import { useEffect, useState, useCallback } from "react";
import {
  Plus, X, Trash2, Pencil, ChevronDown, ChevronRight, MapPin,
  CalendarRange, Clock, Repeat2, ChevronLeft, Train, Stethoscope,
  Dumbbell, Briefcase, Users, Circle, CalendarDays, Eye, EyeOff,
} from "lucide-react";
import { getScheduleEntriesByPlan } from "../lib/api";
import { Button } from "../components/ui/button";
import { cn, layoutCalItems } from "../lib/utils";
import { useSchedules, type EntryDraft, type PlanDraft, type Category } from "../contexts/SchedulesContext";
import type { Plan, ScheduleEntry } from "../types";

// ── Hour grid constants ────────────────────────────────────────────────────────

const HOUR_START = 6;
const HOUR_END   = 22;
const HOUR_PX    = 52;
const HOURS      = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const TOTAL_PX   = HOURS.length * HOUR_PX;

function timeToMin(t: string): number {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minToPx(min: number): number {
  return ((min - HOUR_START * 60) / 60) * HOUR_PX;
}
function fmtTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  return `${h}:${String(m).padStart(2, "0")}`;
}
function durationLabel(start: string, end: string): string {
  const diff = timeToMin(end) - timeToMin(start);
  if (diff <= 0) return "";
  const h = Math.floor(diff / 60);
  const m = diff % 60;
  if (h === 0) return `${m}min`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}min`;
}

// ── Categories ─────────────────────────────────────────────────────────────────

const CATEGORIES: { id: Category; label: string; icon: React.ReactNode; color: string }[] = [
  { id: "transport", label: "Transport", icon: <Train       className="h-4 w-4" />, color: "text-blue-500"    },
  { id: "medical",   label: "Medical",   icon: <Stethoscope className="h-4 w-4" />, color: "text-rose-500"   },
  { id: "fitness",   label: "Fitness",   icon: <Dumbbell    className="h-4 w-4" />, color: "text-green-500"  },
  { id: "work",      label: "Work",      icon: <Briefcase   className="h-4 w-4" />, color: "text-amber-500"  },
  { id: "social",    label: "Social",    icon: <Users       className="h-4 w-4" />, color: "text-violet-500" },
  { id: "other",     label: "Other",     icon: <Circle      className="h-4 w-4" />, color: "text-slate-400"  },
];

function catMeta(id: string) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[5];
}

// ── Colors ─────────────────────────────────────────────────────────────────────

const COLORS = [
  "teal", "cyan", "blue", "indigo", "violet", "purple",
  "pink", "rose", "red", "orange", "amber", "green", "emerald", "slate",
];

const COLOR_DOT: Record<string, string> = {
  teal: "bg-teal-500", cyan: "bg-cyan-500", blue: "bg-blue-500",
  indigo: "bg-indigo-500", violet: "bg-violet-500", purple: "bg-purple-500",
  pink: "bg-pink-500", rose: "bg-rose-500", red: "bg-red-500",
  orange: "bg-orange-500", amber: "bg-amber-500", green: "bg-green-500",
  emerald: "bg-emerald-500", slate: "bg-slate-400",
};

const BLOCK_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  teal:    { bg: "bg-teal-500/20",    border: "border-teal-400/50",    text: "text-teal-700 dark:text-teal-300",       dot: "bg-teal-500"    },
  cyan:    { bg: "bg-cyan-500/20",    border: "border-cyan-400/50",    text: "text-cyan-700 dark:text-cyan-300",       dot: "bg-cyan-500"    },
  blue:    { bg: "bg-blue-500/20",    border: "border-blue-400/50",    text: "text-blue-700 dark:text-blue-300",       dot: "bg-blue-500"    },
  indigo:  { bg: "bg-indigo-500/20",  border: "border-indigo-400/50",  text: "text-indigo-700 dark:text-indigo-300",   dot: "bg-indigo-500"  },
  violet:  { bg: "bg-violet-500/20",  border: "border-violet-400/50",  text: "text-violet-700 dark:text-violet-300",   dot: "bg-violet-500"  },
  purple:  { bg: "bg-purple-500/20",  border: "border-purple-400/50",  text: "text-purple-700 dark:text-purple-300",   dot: "bg-purple-500"  },
  pink:    { bg: "bg-pink-500/20",    border: "border-pink-400/50",    text: "text-pink-700 dark:text-pink-300",       dot: "bg-pink-500"    },
  rose:    { bg: "bg-rose-500/20",    border: "border-rose-400/50",    text: "text-rose-700 dark:text-rose-300",       dot: "bg-rose-500"    },
  red:     { bg: "bg-red-500/20",     border: "border-red-400/50",     text: "text-red-700 dark:text-red-300",         dot: "bg-red-500"     },
  orange:  { bg: "bg-orange-500/20",  border: "border-orange-400/50",  text: "text-orange-700 dark:text-orange-300",   dot: "bg-orange-500"  },
  amber:   { bg: "bg-amber-500/20",   border: "border-amber-400/50",   text: "text-amber-700 dark:text-amber-300",     dot: "bg-amber-500"   },
  green:   { bg: "bg-green-500/20",   border: "border-green-400/50",   text: "text-green-700 dark:text-green-300",     dot: "bg-green-500"   },
  emerald: { bg: "bg-emerald-500/20", border: "border-emerald-400/50", text: "text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  slate:   { bg: "bg-slate-500/20",   border: "border-slate-400/50",   text: "text-slate-600 dark:text-slate-300",     dot: "bg-slate-400"   },
};

// ── Date helpers ───────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function entriesForDate(rawEntries: ScheduleEntry[], dateStr: string): ScheduleEntry[] {
  const date      = new Date(dateStr + "T00:00:00Z");
  const dayOfWeek = date.getUTCDay();
  const result: ScheduleEntry[] = [];

  for (const e of rawEntries) {
    if (!e.is_recurring) {
      if (e.date === dateStr) result.push(e);
    } else {
      const start = e.series_start_date ? new Date(e.series_start_date + "T00:00:00Z") : null;
      const end   = e.series_end_date   ? new Date(e.series_end_date   + "T00:00:00Z") : null;
      if (start && date < start) continue;
      if (end   && date > end  ) continue;
      if (e.recurrence === "daily") {
        result.push({ ...e, date: dateStr });
      } else if (e.recurrence === "weekly") {
        const days = e.days_of_week ? e.days_of_week.split(",").map(Number) : [];
        if (days.includes(dayOfWeek)) result.push({ ...e, date: dateStr, recurring_id: e.id });
      }
    }
  }

  return result.sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
}

// ── Modal shell ────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
  title: string; onClose: () => void; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-card border border-border rounded-t-2xl sm:rounded-xl shadow-2xl w-full sm:w-[28rem] max-h-[92vh] overflow-y-auto flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-card z-10">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 flex flex-col gap-5">{children}</div>
      </div>
    </div>
  );
}

const inputCls    = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring transition-shadow";
const textareaCls = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none transition-shadow";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/60">{hint}</p>}
    </div>
  );
}

function ModalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/50">{title}</span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
      {children}
    </div>
  );
}

// ── Plan form modal ────────────────────────────────────────────────────────────

function PlanFormModal({ initial, onSave, onDelete, onClose }: {
  initial?: Plan;
  onSave: (d: PlanDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<PlanDraft>({
    title: initial?.title ?? "",
    description: initial?.description ?? "",
  });
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <Modal title={initial ? "Edit Schedule" : "New Schedule"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <ModalSection title="Details">
          <Field label="Name">
            <input className={inputCls} placeholder="e.g. Daily Commute, Medical, Gym"
              value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required autoFocus />
          </Field>
          <Field label="Description">
            <textarea className={textareaCls} rows={2} placeholder="e.g. Weekday train routes, regular appointments…"
              value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
        </ModalSection>

        <div className="flex justify-between items-center pt-1">
          {onDelete && (
            <button type="button" onClick={onDelete}
              className="text-xs text-destructive hover:opacity-80 flex items-center gap-1">
              <Trash2 className="h-3.5 w-3.5" /> Delete schedule
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" type="button" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={loading}>{initial ? "Save" : "Create"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── Entry form modal ───────────────────────────────────────────────────────────

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function defaultDraft(): EntryDraft {
  return {
    category: "other",
    title: "", location: "", description: "", color: "teal",
    start_time: "09:00", end_time: "10:00",
    is_recurring: false,
    date: todayISO(),
    recurrence: "weekly",
    days_of_week: [new Date().getDay()],
    series_start_date: todayISO(),
    series_end_date: "",
  };
}

function entryToDraft(e: ScheduleEntry): EntryDraft {
  return {
    category: (e.category as Category) ?? "other",
    title: e.title,
    location: e.location ?? "",
    description: e.description ?? "",
    color: e.color,
    start_time: e.start_time ?? "09:00",
    end_time: e.end_time ?? "10:00",
    is_recurring: e.is_recurring,
    date: e.date ?? todayISO(),
    recurrence: (e.recurrence as "weekly" | "daily") ?? "weekly",
    days_of_week: e.days_of_week ? e.days_of_week.split(",").map(Number) : [new Date().getDay()],
    series_start_date: e.series_start_date ?? todayISO(),
    series_end_date: e.series_end_date ?? "",
  };
}

function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!value)} className="flex items-center gap-2.5 w-full group">
      <div className={cn(
        "relative h-5 w-9 rounded-full border-2 transition-colors shrink-0",
        value ? "bg-primary border-primary" : "bg-secondary border-border"
      )}>
        <span className={cn(
          "absolute top-0.5 h-3 w-3 rounded-full bg-white shadow-sm transition-transform",
          value ? "translate-x-4" : "translate-x-0.5"
        )} />
      </div>
      <span className="text-sm text-foreground group-hover:text-foreground/80 transition-colors">{label}</span>
    </button>
  );
}

function EntryFormModal({ initial, onSave, onDelete, onClose }: {
  initial?: ScheduleEntry;
  onSave: (d: EntryDraft) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<EntryDraft>(initial ? entryToDraft(initial) : defaultDraft());
  const [loading, setLoading] = useState(false);

  function set<K extends keyof EntryDraft>(key: K, val: EntryDraft[K]) {
    setForm((f) => ({ ...f, [key]: val }));
  }

  function toggleDay(d: number) {
    setForm((f) => ({
      ...f,
      days_of_week: f.days_of_week.includes(d)
        ? f.days_of_week.filter((x) => x !== d)
        : [...f.days_of_week, d].sort(),
    }));
  }

  const duration = form.start_time && form.end_time && form.start_time < form.end_time
    ? durationLabel(form.start_time, form.end_time)
    : null;

  const valid = form.title.trim().length > 0
    && form.start_time < form.end_time
    && (!form.is_recurring || form.recurrence !== "weekly" || form.days_of_week.length > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setLoading(true);
    try { await onSave(form); } finally { setLoading(false); }
  }

  return (
    <Modal title={initial ? "Edit Activity" : "Add Activity"} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">

        <ModalSection title="Category">
          <div className="grid grid-cols-3 gap-2">
            {CATEGORIES.map((cat) => (
              <button key={cat.id} type="button"
                onClick={() => set("category", cat.id)}
                className={cn(
                  "flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border text-xs font-medium transition-all",
                  form.category === cat.id
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:border-border/80 hover:bg-accent"
                )}
              >
                <span className={form.category === cat.id ? "text-primary" : cat.color}>{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>
        </ModalSection>

        <ModalSection title="Activity">
          <Field label="Title">
            <input className={inputCls}
              placeholder={
                form.category === "transport" ? "e.g. Train to work, Bus home" :
                form.category === "medical"   ? "e.g. GP appointment, Dentist" :
                form.category === "fitness"   ? "e.g. Morning run, Gym session" :
                form.category === "work"      ? "e.g. Office shift, Client meeting" :
                form.category === "social"    ? "e.g. Dinner with friends, Club" :
                "e.g. Weekly review, Study session"
              }
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              required autoFocus={!initial}
            />
          </Field>
          <Field label="Colour">
            <div className="flex flex-wrap gap-1.5 mt-0.5">
              {COLORS.map((c) => (
                <button key={c} type="button"
                  onClick={() => set("color", c)}
                  className={cn(
                    "h-5 w-5 rounded-full transition-all",
                    COLOR_DOT[c],
                    form.color === c ? "ring-2 ring-offset-2 ring-ring scale-110" : "opacity-50 hover:opacity-100"
                  )}
                />
              ))}
            </div>
          </Field>
        </ModalSection>

        <ModalSection title="Time">
          <div className="grid grid-cols-2 gap-2">
            <Field label="Start">
              <input type="time" className={inputCls} value={form.start_time}
                onChange={(e) => set("start_time", e.target.value)} />
            </Field>
            <Field label="End">
              <input type="time" className={inputCls} value={form.end_time}
                onChange={(e) => set("end_time", e.target.value)} />
            </Field>
          </div>
          {duration && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3 w-3" /> Duration: <span className="font-medium text-foreground">{duration}</span>
            </p>
          )}
        </ModalSection>

        <ModalSection title="Location">
          <Field label={form.category === "transport" ? "Route" : "Location"}>
            <div className="relative">
              <MapPin className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input className={cn(inputCls, "pl-8")}
                placeholder={
                  form.category === "transport" ? "Central Station → Town Hall" :
                  form.category === "medical"   ? "Dr. Andersen's clinic, Floor 2" :
                  form.category === "fitness"   ? "City Gym, Treadmill zone" :
                  "Address or room"
                }
                value={form.location}
                onChange={(e) => set("location", e.target.value)}
              />
            </div>
          </Field>
        </ModalSection>

        <ModalSection title="Notes">
          <textarea className={textareaCls} rows={2}
            placeholder={
              form.category === "transport" ? "e.g. Platform 3, buy ticket night before" :
              form.category === "medical"   ? "e.g. Bring insurance card, fast 12h before" :
              "Additional details…"
            }
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </ModalSection>

        <ModalSection title="Scheduling">
          <Toggle value={form.is_recurring} onChange={(v) => set("is_recurring", v)} label="Recurring activity" />

          {form.is_recurring ? (
            <div className="flex flex-col gap-3 pt-1">
              <Field label="Repeat">
                <select className={inputCls} value={form.recurrence}
                  onChange={(e) => set("recurrence", e.target.value as "weekly" | "daily")}>
                  <option value="weekly">Weekly</option>
                  <option value="daily">Daily</option>
                </select>
              </Field>
              {form.recurrence === "weekly" && (
                <Field label="Days">
                  <div className="flex gap-1.5 flex-wrap mt-0.5">
                    {DAY_LABELS.map((label, i) => (
                      <button key={i} type="button"
                        onClick={() => toggleDay(i)}
                        className={cn(
                          "h-8 w-10 rounded-lg text-xs font-medium border transition-all",
                          form.days_of_week.includes(i)
                            ? "bg-primary text-primary-foreground border-primary shadow-sm"
                            : "border-border text-muted-foreground hover:border-foreground/40"
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </Field>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Series start">
                  <input type="date" className={inputCls} value={form.series_start_date}
                    onChange={(e) => set("series_start_date", e.target.value)} required />
                </Field>
                <Field label="Series end">
                  <input type="date" className={inputCls} value={form.series_end_date}
                    onChange={(e) => set("series_end_date", e.target.value)} />
                </Field>
              </div>
            </div>
          ) : (
            <Field label="Date">
              <input type="date" className={inputCls} value={form.date}
                onChange={(e) => set("date", e.target.value)} required />
            </Field>
          )}
        </ModalSection>

        <div className="flex justify-between items-center pt-1">
          {onDelete && (
            <button type="button" onClick={onDelete}
              className="text-xs text-destructive hover:opacity-80 flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> Delete activity
            </button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button variant="ghost" type="button" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={loading || !valid}>
              {initial ? "Save changes" : "Add activity"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

// ── Schedule Timetable ─────────────────────────────────────────────────────────

function ScheduleTimetable({ allEntries }: { allEntries: ScheduleEntry[] }) {
  const [date,      setDate]      = useState(todayISO());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  const toggleHidden = useCallback((id: string) => {
    setHiddenIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  }, []);

  const today    = todayISO();
  const isToday  = date === today;
  const dayEntries = entriesForDate(allEntries, date);

  const now     = new Date();
  const nowMin  = now.getHours() * 60 + now.getMinutes();
  const nowPx   = minToPx(nowMin);
  const showNow = isToday && nowMin >= HOUR_START * 60 && nowMin <= (HOUR_END + 1) * 60;

  type EvtItem = { startMin: number; endMin: number; entry: ScheduleEntry };
  const evts: EvtItem[] = dayEntries
    .filter((e) => e.start_time)
    .map((e) => ({
      startMin: timeToMin(e.start_time!),
      endMin:   e.end_time ? timeToMin(e.end_time) : timeToMin(e.start_time!) + 30,
      entry:    e,
    }));

  return (
    <div className="flex flex-col gap-3">
      {/* Date nav */}
      <div className="flex items-center gap-2">
        <button onClick={() => setDate((d) => addDays(d, -1))}
          className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="flex-1 text-center text-sm font-medium">{formatDateLabel(date)}</span>
        <button onClick={() => setDate((d) => addDays(d, 1))}
          className="p-1.5 rounded-lg border border-border hover:bg-accent transition-colors">
          <ChevronLeft className="h-4 w-4 rotate-180" />
        </button>
        {!isToday && (
          <button onClick={() => setDate(today)}
            className="px-2.5 h-7 text-xs rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors">
            Today
          </button>
        )}
      </div>

      {/* Grid */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        {dayEntries.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
            <CalendarDays className="h-7 w-7 text-muted-foreground/25" />
            <p className="text-sm text-muted-foreground">No activities on this day</p>
          </div>
        ) : (
          <div className="flex" style={{ height: TOTAL_PX }}>
            {/* Hour labels */}
            <div className="relative shrink-0" style={{ width: 40 }}>
              {HOURS.map((h) => (
                <div key={h} className="absolute text-right pr-2"
                  style={{ top: (h - HOUR_START) * HOUR_PX - 7, width: 40 }}>
                  <span className="text-[10px] font-mono text-muted-foreground/40">
                    {h === 12 ? "12pm" : h > 12 ? `${h - 12}pm` : `${h}am`}
                  </span>
                </div>
              ))}
            </div>

            {/* Event column */}
            <div className="relative flex-1 border-l border-border/30">
              {HOURS.map((h) => (
                <div key={h} className="absolute left-0 right-0 border-t border-border/30 pointer-events-none"
                  style={{ top: (h - HOUR_START) * HOUR_PX }} />
              ))}
              {HOURS.map((h) => (
                <div key={`${h}h`} className="absolute left-0 right-0 border-t border-dashed border-border/15 pointer-events-none"
                  style={{ top: (h - HOUR_START) * HOUR_PX + HOUR_PX / 2 }} />
              ))}

              {showNow && (
                <div className="absolute left-0 right-0 flex items-center gap-1 pointer-events-none z-10"
                  style={{ top: nowPx }}>
                  <div className="h-2 w-2 rounded-full bg-red-500 -ml-1" />
                  <div className="flex-1 border-t-2 border-red-500/60" />
                </div>
              )}

              {layoutCalItems(evts).map(({ item, col, totalCols }) => {
                const top    = minToPx(item.startMin);
                const height = Math.max(24, minToPx(item.endMin) - top);
                const w      = `${(1 / totalCols) * 100}%`;
                const left   = `${(col / totalCols) * 100}%`;
                const clr    = BLOCK_COLORS[item.entry.color] ?? BLOCK_COLORS.teal;
                const cat    = catMeta(item.entry.category);
                const seId   = `se-${item.entry.id}-${item.entry.date}`;
                const seHidden = hiddenIds.has(seId);

                return (
                  <div key={`${item.entry.id}-${item.entry.date}`}
                    className={cn(
                      "absolute rounded-lg border px-2 py-1 overflow-hidden cursor-default group",
                      clr.bg, clr.border, clr.text,
                      seHidden && "opacity-15"
                    )}
                    style={{ top, height, left, width: w, marginLeft: col > 0 ? 2 : 4, marginRight: 4 }}
                  >
                    <button
                      className={cn("absolute top-0.5 right-0.5 z-10 p-0.5 rounded transition-opacity", seHidden ? "opacity-100" : "opacity-0 group-hover:opacity-100")}
                      onClick={(e) => { e.stopPropagation(); toggleHidden(seId); }}
                    >
                      {seHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                    <div className="flex items-center gap-1 leading-tight">
                      <span className="shrink-0 opacity-70">{cat.icon}</span>
                      <span className="text-[11px] font-semibold truncate">{item.entry.title}</span>
                    </div>
                    {height > 36 && (
                      <div className="text-[10px] opacity-60 mt-0.5 flex items-center gap-1">
                        <Clock className="h-2.5 w-2.5" />
                        {fmtTime(item.entry.start_time!)}
                        {item.entry.end_time && ` – ${fmtTime(item.entry.end_time)}`}
                      </div>
                    )}
                    {height > 52 && item.entry.location && (
                      <div className="text-[10px] opacity-60 flex items-center gap-1 truncate">
                        <MapPin className="h-2.5 w-2.5 shrink-0" />{item.entry.location}
                      </div>
                    )}
                    {height > 68 && item.entry.plan_title && (
                      <div className="text-[10px] opacity-50 truncate mt-0.5">{item.entry.plan_title}</div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Entry row ──────────────────────────────────────────────────────────────────

function EntryRow({ entry, onEdit, onDelete }: {
  entry: ScheduleEntry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const clr = BLOCK_COLORS[entry.color] ?? BLOCK_COLORS.teal;
  const cat = catMeta(entry.category);

  const timeLabel = entry.start_time
    ? `${fmtTime(entry.start_time)}${entry.end_time ? ` – ${fmtTime(entry.end_time)}` : ""}`
    : null;

  const recurLabel = entry.is_recurring
    ? entry.recurrence === "daily"
      ? "Every day"
      : (() => {
          const days = entry.days_of_week?.split(",").map(Number) ?? [];
          return days.map((d) => DAY_LABELS[d]).join(", ");
        })()
    : entry.date ?? null;

  return (
    <div className={cn("flex items-start gap-3 px-3 py-2.5 rounded-xl border group", clr.bg, clr.border, clr.text)}>
      <span className={cn("mt-0.5 shrink-0 opacity-70", cat.color)}>{cat.icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold leading-tight">{entry.title}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
          {timeLabel && (
            <span className="flex items-center gap-0.5 text-[11px] opacity-70">
              <Clock className="h-3 w-3" /> {timeLabel}
            </span>
          )}
          {entry.location && (
            <span className="flex items-center gap-0.5 text-[11px] opacity-70">
              <MapPin className="h-3 w-3" /> {entry.location}
            </span>
          )}
          {recurLabel && (
            <span className="flex items-center gap-0.5 text-[11px] opacity-70">
              {entry.is_recurring ? <Repeat2 className="h-3 w-3" /> : null}
              {recurLabel}
            </span>
          )}
        </div>
        {entry.description && (
          <p className="text-[11px] opacity-60 mt-0.5 line-clamp-1">{entry.description}</p>
        )}
      </div>
      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button onClick={onEdit}
          className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 transition-colors">
          <Pencil className="h-3 w-3" />
        </button>
        <button onClick={onDelete}
          className="p-1.5 rounded-lg hover:bg-destructive/20 text-destructive transition-colors">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Plan card ──────────────────────────────────────────────────────────────────

type CatFilter = "all" | Category;

function PlanCard({ plan, onEdit }: { plan: Plan; onEdit: () => void }) {
  const { addEntry, editEntry: editEntryCtx, removeEntry, mergeEntries } = useSchedules();
  const [expanded,  setExpanded]  = useState(true);
  const [entries,   setEntries]   = useState<ScheduleEntry[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [catFilter, setCatFilter] = useState<CatFilter>("all");
  const [addOpen,   setAddOpen]   = useState(false);
  const [editEntry, setEditEntry] = useState<ScheduleEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getScheduleEntriesByPlan(plan.id);
      setEntries(data);
      mergeEntries(plan.id, data);
    } finally {
      setLoading(false);
    }
  }, [plan.id, mergeEntries]);

  useEffect(() => { load(); }, [load]);

  const presentCats = CATEGORIES.filter((c) => entries.some((e) => e.category === c.id));
  const showTabs    = presentCats.length > 1;
  const visible     = catFilter === "all" ? entries : entries.filter((e) => e.category === catFilter);

  return (
    <>
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border bg-card/80">
          <button onClick={() => setExpanded((v) => !v)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <CalendarRange className="h-4 w-4 text-teal-500 shrink-0" />
          <span className="flex-1 text-sm font-semibold text-foreground">{plan.title}</span>
          {plan.description && (
            <span className="text-xs text-muted-foreground truncate max-w-[140px] hidden sm:block">{plan.description}</span>
          )}
          <span className="text-xs text-muted-foreground shrink-0">
            {entries.length} {entries.length === 1 ? "activity" : "activities"}
          </span>
          <button onClick={onEdit}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors">
            <Pencil className="h-3.5 w-3.5" />
          </button>
        </div>

        {expanded && showTabs && (
          <div className="flex gap-1 px-3 pt-3 overflow-x-auto">
            <button
              onClick={() => setCatFilter("all")}
              className={cn(
                "px-3 h-7 rounded-lg text-xs font-medium whitespace-nowrap transition-all shrink-0",
                catFilter === "all"
                  ? "bg-foreground text-background"
                  : "border border-border text-muted-foreground hover:text-foreground"
              )}
            >All</button>
            {presentCats.map((cat) => (
              <button key={cat.id}
                onClick={() => setCatFilter(cat.id)}
                className={cn(
                  "flex items-center gap-1.5 px-3 h-7 rounded-lg text-xs font-medium whitespace-nowrap transition-all shrink-0",
                  catFilter === cat.id
                    ? "bg-foreground text-background"
                    : "border border-border text-muted-foreground hover:text-foreground"
                )}
              >
                <span className={catFilter === cat.id ? "text-background" : cat.color}>{cat.icon}</span>
                {cat.label}
              </button>
            ))}
          </div>
        )}

        {expanded && (
          <div className="p-3 flex flex-col gap-2">
            {loading && entries.length === 0 && (
              <p className="text-xs text-muted-foreground italic px-1">Loading…</p>
            )}
            {!loading && visible.length === 0 && entries.length === 0 && (
              <p className="text-xs text-muted-foreground italic px-1">No activities yet.</p>
            )}
            {!loading && visible.length === 0 && entries.length > 0 && (
              <p className="text-xs text-muted-foreground italic px-1">No activities in this category.</p>
            )}
            {visible.map((e) => (
              <EntryRow key={e.id} entry={e}
                onEdit={() => setEditEntry(e)}
                onDelete={async () => { await removeEntry(e.id); load(); }}
              />
            ))}
            <Button variant="ghost" size="sm" className="self-start h-7 text-xs gap-1 mt-1"
              onClick={() => setAddOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add activity
            </Button>
          </div>
        )}
      </div>

      {addOpen && (
        <EntryFormModal
          onSave={async (d) => { await addEntry(plan.id, d); setAddOpen(false); load(); }}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editEntry && (
        <EntryFormModal
          initial={editEntry}
          onSave={async (d) => { await editEntryCtx(editEntry, d); setEditEntry(null); load(); }}
          onDelete={async () => { await removeEntry(editEntry.id); setEditEntry(null); load(); }}
          onClose={() => setEditEntry(null)}
        />
      )}
    </>
  );
}

// ── SchedulesPanel ─────────────────────────────────────────────────────────────
// Drop-in module. Reads from SchedulesContext — must have <SchedulesProvider>
// somewhere above it in the tree (done at App level).

type MainTab = "timetable" | "plans";

export function SchedulesPanel() {
  const { plans, allEntries, createSchedule, updateSchedule, deleteSchedule } = useSchedules();
  const [tab,        setTab]        = useState<MainTab>("timetable");
  const [createOpen, setCreateOpen] = useState(false);
  const [editPlan,   setEditPlan]   = useState<Plan | null>(null);

  return (
    <div className="flex flex-col gap-5 p-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-teal-500" />
          <h2 className="text-xl font-semibold text-foreground">Schedules</h2>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5" /> New schedule
        </Button>
      </div>

      {/* Tab bar */}
      {plans.length > 0 && (
        <div className="flex gap-1 p-1 bg-muted rounded-xl w-fit">
          {(["timetable", "plans"] as MainTab[]).map((t) => (
            <button key={t}
              onClick={() => setTab(t)}
              className={cn(
                "px-4 h-7 rounded-lg text-xs font-medium capitalize transition-all",
                tab === t
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t === "timetable" ? "Timetable" : "Plans"}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <CalendarRange className="h-10 w-10 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No schedules yet.</p>
          <p className="text-xs text-muted-foreground/60 max-w-xs">
            Create a schedule to organise recurring or one-off activities — commutes, doctor appointments,
            gym sessions, shifts — and see them on the weekly overview.
          </p>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Create first schedule
          </Button>
        </div>
      ) : tab === "timetable" ? (
        <ScheduleTimetable allEntries={allEntries} />
      ) : (
        <div className="flex flex-col gap-4">
          {plans.map((plan) => (
            <PlanCard key={plan.id} plan={plan} onEdit={() => setEditPlan(plan)} />
          ))}
        </div>
      )}

      {createOpen && (
        <PlanFormModal
          onSave={async (d) => { await createSchedule(d); setCreateOpen(false); }}
          onClose={() => setCreateOpen(false)}
        />
      )}
      {editPlan && (
        <PlanFormModal
          initial={editPlan}
          onSave={async (d) => { await updateSchedule(editPlan, d); setEditPlan(null); }}
          onDelete={async () => { await deleteSchedule(editPlan); setEditPlan(null); }}
          onClose={() => setEditPlan(null)}
        />
      )}
    </div>
  );
}

// ── Schedules page (standalone) ────────────────────────────────────────────────
// When navigated to directly, wraps the panel in its own provider.
// When embedded elsewhere, the app-level SchedulesProvider takes precedence.

export function Schedules() {
  return <SchedulesPanel />;
}
