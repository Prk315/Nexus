import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ComponentType,
} from "react";
import {
  Bell, FileText, Zap, Calendar, Clock, Handshake,
  Check, ChevronDown, ChevronRight, Plus, X,
  Brush, ShoppingCart, RefreshCw, Flame, Repeat, AlarmClock,
} from "lucide-react";
import { cn } from "../lib/utils";
import { isSystemDue, frequencyLabel } from "../lib/systems";
import {
  getQuickTasks, createTask, toggleTask, deleteTask,
  getTaskSubtypeRows, promoteChoreToSystem,
  getSystems, markSystemDone, unmarkSystemDone, getSystemSubtasks, toggleSystemSubtask,
  getQuickNotes, addQuickNote, deleteQuickNote,
  getBrainDump, addBrainEntry, deleteBrainEntry,
  getEvents, addEvent, deleteEvent,
  getDeadlines, addDeadline, toggleDeadline, deleteDeadline,
  getAgreements, addAgreement, deleteAgreement,
} from "../lib/api";
import type {
  QuickNote, BrainEntry, CalEvent, Deadline, Agreement,
  Task, TaskCategory, SystemEntry, SystemSubtask,
} from "../types";

/**
 * The six side-tools — reminders, quick notes, brain dump, events, deadlines,
 * agreements — extracted out of the dashboard.
 *
 * They used to be a full-width strip of six labelled buttons pinned above the
 * dashboard's content, which spent a prominent row on things that are relevant
 * a few times a day. They now live as icons in the sidebar, below a divider that
 * separates them from navigation: they are *tools*, not places.
 *
 * NEXT STEPS — reminders do not actually fire yet.
 *
 * `pf_task_reminders.remind_at` is currently *surfaced*, not delivered: due
 * reminders sort to the top of the panel, turn amber, and are what the sidebar
 * badge counts. Nothing notifies you, because nothing in this ecosystem can —
 * there is no UNUserNotificationCenter anywhere in the repo, and the free
 * sideload tier has neither silent push nor BGTaskScheduler (see CLAUDE.md).
 *
 * The intended home for real delivery is Nexus Local, which already runs a
 * daemon loop on the Mac and is the one native app on the phone:
 *   - Mac:   a grid-module tick reads due reminders and posts a notification.
 *   - Phone: schedule UNCalendarNotificationTrigger alerts on foreground, for
 *            the reminders known at that moment.
 * `lead_minutes` is stored and unused until then — it only means something once
 * something can fire early.
 *
 * Owning their own data is what makes that possible. Nothing else on the
 * dashboard ever read these six slices, so lifting them out of that page removed
 * six state variables, six loads and eighteen handlers from a 3000-line file —
 * and, as a side effect, made every tool reachable from any page rather than
 * only the dashboard.
 */


/**
 * A quick-task list: one of the reminder / chore / shopping categories.
 *
 * These are created on the phone via Nexus Local's quick-capture, so the panel
 * is deliberately thin — a title, a checkbox and a delete. They carry no plan,
 * no breakdown and no lifecycle, which is exactly what the sparse ISA subtypes
 * say about them.
 *
 * Note this REPLACED a panel backed by a separate `pf_reminders` table, which
 * held zero rows — every reminder the user actually has is a quick task. Pointing
 * the Reminders icon at that empty table while the real ones sat in the
 * dashboard's task list was the routing bug this fixed. The table has since been
 * dropped.
 */
function QuickTaskPanel({ tasks, category, remindAt, onToggle, onDelete, onAdd, onMakeRecurring }: {
  tasks: Task[];
  category: TaskCategory;
  /** task_id -> remind_at ISO, for the reminder category only. */
  remindAt?: Map<number, string>;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onAdd: (title: string, category: TaskCategory) => void;
  /** Chores only — promotes into a recurring system. */
  onMakeRecurring?: (id: number, intervalDays: number) => void;
}) {
  const [draft, setDraft] = useState("");
  const now = Date.now();

  // Reminders sort by when they are due, soonest first, with undated ones last —
  // an unsorted reminder list buries the thing that is actually due today. The
  // other categories keep their natural order.
  const byDue = (a: Task, b: Task) => {
    const ra = remindAt?.get(a.id), rb = remindAt?.get(b.id);
    if (ra && rb) return ra.localeCompare(rb);
    if (ra) return -1;
    if (rb) return 1;
    return 0;
  };
  const open = tasks.filter((t) => !t.done).sort(remindAt ? byDue : () => 0);
  const done = tasks.filter((t) => t.done);

  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onAdd(v, category);
    setDraft("");
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="Add… (Enter)"
          className="flex-1 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          className="shrink-0 rounded-md border border-border px-1.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {open.length === 0 && done.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nothing here.</p>
      )}

      <div className="flex flex-col gap-0.5">
        {open.map((t) => (
          <QuickTaskRow
            key={t.id}
            task={t}
            remindAt={remindAt?.get(t.id)}
            now={now}
            onToggle={onToggle}
            onDelete={onDelete}
            onMakeRecurring={onMakeRecurring}
          />
        ))}
      </div>

      {done.length > 0 && (
        <div className="flex flex-col gap-0.5 pt-1.5 border-t border-border/60">
          {done.map((t) => (
            <QuickTaskRow key={t.id} task={t} now={now} onToggle={onToggle} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function QuickTaskRow({ task, remindAt, now, onToggle, onDelete, onMakeRecurring }: {
  task: Task;
  remindAt?: string;
  now: number;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onMakeRecurring?: (id: number, intervalDays: number) => void;
}) {
  const [everyDraft, setEveryDraft] = useState<string | null>(null);
  const due = remindAt != null && new Date(remindAt).getTime() <= now;

  return (
    <div className="group flex flex-col gap-1 rounded-md px-1 py-1 hover:bg-secondary/50 transition-colors">
      <div className="flex items-center gap-2">
      <button
        onClick={() => onToggle(task.id)}
        className={cn(
          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
          task.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
        )}
      >
        {task.done && <Check className="h-2 w-2" />}
      </button>
      <span className={cn("flex-1 min-w-0 truncate text-xs", task.done && "line-through text-muted-foreground")}>
        {task.title}
      </span>
      {/*
        remind_at surfaces here rather than firing a notification: nothing in
        this ecosystem can deliver one yet (no UNUserNotificationCenter anywhere,
        and the sideload tier has no push or BGTaskScheduler). Due reminders sort
        to the top and turn amber; that is honest about what the field currently
        does. See NEXT STEPS at the top of this file.
      */}
      {remindAt && (
        <span
          className={cn(
            "shrink-0 inline-flex items-center gap-0.5 text-[10px] tabular-nums",
            due ? "text-amber-500 font-medium" : "text-muted-foreground/60",
          )}
          title={due ? "Due" : "Scheduled"}
        >
          <AlarmClock className="h-2.5 w-2.5" />
          {new Date(remindAt).toLocaleString(undefined, {
            day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
          })}
        </span>
      )}

      {onMakeRecurring && (
        <button
          onClick={() => setEveryDraft(everyDraft == null ? "7" : null)}
          title="Make recurring — moves it to Systems"
          className="shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground transition-all"
        >
          <Repeat className="h-3 w-3" />
        </button>
      )}

      <button
        onClick={() => onDelete(task.id)}
        className="shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive transition-all"
      >
        <X className="h-3 w-3" />
      </button>
      </div>

      {everyDraft != null && onMakeRecurring && (
        <div className="flex items-center gap-1.5 pl-5 pb-0.5">
          <span className="text-[10px] text-muted-foreground">Every</span>
          <input
            autoFocus
            type="number"
            min={1}
            value={everyDraft}
            onChange={(e) => setEveryDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setEveryDraft(null);
              if (e.key === "Enter") {
                const n = Number(everyDraft);
                if (Number.isFinite(n) && n >= 1) { onMakeRecurring(task.id, n); setEveryDraft(null); }
              }
            }}
            className="w-12 rounded border border-border bg-transparent px-1 py-px text-[10px] tabular-nums outline-none focus:ring-1 focus:ring-ring"
          />
          <span className="text-[10px] text-muted-foreground">days</span>
          <button
            onClick={() => {
              const n = Number(everyDraft);
              if (Number.isFinite(n) && n >= 1) { onMakeRecurring(task.id, n); setEveryDraft(null); }
            }}
            className="rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            Move to Systems
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Recurring systems, moved out of the dashboard.
 *
 * A system is a standing commitment rather than something due today, so it
 * belongs with the tools, not in the day's task list. Systems with subtasks
 * auto-collapse once every subtask is done — the same rule the dashboard used.
 */
function SystemsPanel({ systems, subtaskMap, onMark, onUnmark, onToggleSubtask }: {
  systems: SystemEntry[];
  subtaskMap: Record<number, SystemSubtask[]>;
  onMark: (id: number) => void;
  onUnmark: (id: number) => void;
  onToggleSubtask: (subtaskId: number, systemId: number) => void;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggleExpand = (id: number) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (systems.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No systems yet.</p>;
  }

  return (
    <div className="flex flex-col gap-1">
      {systems.map((sys) => {
        const due = isSystemDue(sys);
        const subtasks = subtaskMap[sys.id] ?? [];
        const hasSubs = subtasks.length > 0;
        const allDone = hasSubs && subtasks.every((s) => s.done);
        const subsVisible = hasSubs && (!allDone || expanded.has(sys.id));

        return (
          <div key={sys.id} className={cn("flex flex-col gap-0.5", !due && "opacity-60")}>
            <div className="flex items-center gap-1.5 py-0.5">
              {hasSubs && (
                <button
                  onClick={() => toggleExpand(sys.id)}
                  className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {subsVisible ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              )}
              <span className={cn("text-xs truncate flex-1", due ? "text-foreground" : "text-muted-foreground")}>
                {sys.title}
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground/60" title="Cadence">
                {frequencyLabel(sys)}
              </span>
              {sys.streak_count > 1 && (
                <span className="flex items-center gap-0.5 text-[10px] text-orange-500 shrink-0">
                  <Flame className="h-2.5 w-2.5" />{sys.streak_count}
                </span>
              )}
              {!hasSubs && (
                due ? (
                  <button
                    onClick={() => onMark(sys.id)}
                    className="shrink-0 rounded border border-border px-1.5 py-px text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    Done
                  </button>
                ) : (
                  <button onClick={() => onUnmark(sys.id)} title="Mark as not done" className="shrink-0">
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  </button>
                )
              )}
              {hasSubs && (
                <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                  {subtasks.filter((s) => s.done).length}/{subtasks.length}
                </span>
              )}
            </div>

            {subsVisible && (
              <div className="flex flex-col gap-0.5 pl-3 border-l border-border ml-1">
                {subtasks.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2 py-0.5">
                    <button
                      onClick={() => onToggleSubtask(sub.id, sys.id)}
                      className={cn(
                        "flex h-3 w-3 shrink-0 items-center justify-center rounded-[3px] border transition-colors",
                        sub.done ? "bg-primary border-primary" : "border-border hover:border-primary",
                      )}
                    >
                      {sub.done && <Check className="h-2 w-2 text-primary-foreground" />}
                    </button>
                    <span className={cn("text-[11px] flex-1 truncate", sub.done ? "line-through text-muted-foreground" : "text-foreground")}>
                      {sub.title}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function QuickNotesPanel({ notes, onAdd, onDelete }: {
  notes: QuickNote[];
  onAdd: (title: string, body: string | null) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function handleAdd() {
    if (!title.trim()) return;
    onAdd(title.trim(), body.trim() || null);
    setTitle(""); setBody(""); setAdding(false);
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
          <Plus className="h-3.5 w-3.5" /> New note
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <input autoFocus className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
          <textarea className="rounded border border-input bg-transparent px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Body (optional)" rows={2} value={body} onChange={(e) => setBody(e.target.value)} />
          <div className="flex gap-1.5">
            <button onClick={handleAdd} className="px-2 h-6 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90">Add</button>
            <button onClick={() => { setAdding(false); setTitle(""); setBody(""); }}
              className="px-2 h-6 text-xs rounded border border-border text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
      {notes.length === 0 && !adding && <p className="text-xs text-muted-foreground italic">No notes yet.</p>}
      <div className="flex flex-col gap-1">
        {notes.map((n) => {
          const open = expanded.has(n.id);
          return (
            <div key={n.id} className="group rounded border border-border px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                {n.body && (
                  <button onClick={() => setExpanded((prev) => { const s = new Set(prev); open ? s.delete(n.id) : s.add(n.id); return s; })}
                    className="shrink-0 text-muted-foreground hover:text-foreground">
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                )}
                <span className="text-xs flex-1 font-medium truncate">{n.title}</span>
                <button onClick={() => onDelete(n.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {open && n.body && <p className="text-xs text-muted-foreground mt-1 pl-5 whitespace-pre-wrap">{n.body}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Brain Dump Panel ──────────────────────────────────────────────────────────

function BrainDumpPanel({ entries, onAdd, onDelete }: {
  entries: BrainEntry[];
  onAdd: (content: string) => void;
  onDelete: (id: number) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <div className="flex flex-col gap-2 pt-1">
      <textarea
        autoFocus
        className="rounded border border-input bg-transparent px-2 py-1.5 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="Dump your thoughts… (Ctrl+Enter to save)"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && draft.trim()) {
            onAdd(draft.trim()); setDraft("");
          }
        }}
      />
      <button
        onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(""); } }}
        className="self-start px-2 h-6 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90"
      >Capture</button>
      {entries.length === 0
        ? <p className="text-xs text-muted-foreground italic">Nothing captured yet.</p>
        : <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
            {entries.map((e) => (
              <div key={e.id} className="flex items-start gap-2 group py-0.5">
                <span className="text-xs flex-1 text-muted-foreground whitespace-pre-wrap">{e.content}</span>
                <button onClick={() => onDelete(e.id)} className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive mt-0.5">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

// ── Events Panel ──────────────────────────────────────────────────────────────

function EventsPanel({ events, onAdd, onDelete }: {
  events: CalEvent[];
  onAdd: (title: string, date: string) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  function handleAdd() {
    if (!title.trim() || !date) return;
    onAdd(title.trim(), date);
    setTitle(""); setDate("");
  }

  function relativeDate(d: string) {
    const days = Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86_400_000);
    if (days === 0) return "Today";
    if (days === 1) return "Tomorrow";
    if (days < 0) return `${Math.abs(days)}d ago`;
    if (days < 7) return `In ${days}d`;
    return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-center gap-1.5">
        <input className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Event title" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        <input type="date" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={handleAdd}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {events.length === 0
        ? <p className="text-xs text-muted-foreground italic">No events.</p>
        : <div className="flex flex-col gap-0.5">
            {events.map((ev) => {
              const past = ev.date < today;
              return (
                <div key={ev.id} className={cn("flex items-center gap-2 group py-0.5", past && "opacity-50")}>
                  <span className={cn("text-xs w-16 shrink-0 tabular-nums", ev.date === today ? "text-primary font-medium" : past ? "text-muted-foreground" : "text-foreground")}>
                    {relativeDate(ev.date)}
                  </span>
                  <span className="text-xs flex-1 truncate">{ev.title}</span>
                  <button onClick={() => onDelete(ev.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ── Deadlines Panel ───────────────────────────────────────────────────────────

function DeadlinesPanel({ deadlines, onAdd, onToggle, onDelete }: {
  deadlines: Deadline[];
  onAdd: (title: string, due_date: string) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState("");
  const today = new Date().toISOString().slice(0, 10);

  function handleAdd() {
    if (!title.trim() || !date) return;
    onAdd(title.trim(), date);
    setTitle(""); setDate("");
  }

  const open = deadlines.filter((d) => !d.done);
  const done = deadlines.filter((d) => d.done);

  return (
    <div className="flex flex-col gap-2 pt-1">
      <div className="flex items-center gap-1.5">
        <input className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Deadline title" value={title} onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()} />
        <input type="date" className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
          value={date} onChange={(e) => setDate(e.target.value)} />
        <button onClick={handleAdd}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {deadlines.length === 0
        ? <p className="text-xs text-muted-foreground italic">No deadlines.</p>
        : <div className="flex flex-col gap-0.5">
            {open.map((d) => {
              const overdue = d.due_date < today;
              const days = Math.round((new Date(d.due_date).getTime() - new Date(today).getTime()) / 86_400_000);
              return (
                <div key={d.id} className="flex items-center gap-2 group py-0.5">
                  <button onClick={() => onToggle(d.id)}
                    className="h-3.5 w-3.5 shrink-0 rounded border border-border hover:border-primary transition-colors" />
                  <span className={cn("text-xs flex-1 truncate", overdue && "text-destructive")}>{d.title}</span>
                  <span className={cn("text-xs shrink-0 tabular-nums", overdue ? "text-destructive" : "text-muted-foreground")}>
                    {overdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Today" : `${days}d`}
                  </span>
                  <button onClick={() => onDelete(d.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              );
            })}
            {done.length > 0 && open.length > 0 && <div className="h-px bg-border my-1" />}
            {done.map((d) => (
              <div key={d.id} className="flex items-center gap-2 group py-0.5 opacity-50">
                <button onClick={() => onToggle(d.id)}
                  className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-primary bg-primary transition-colors">
                  <Check className="h-2.5 w-2.5 text-primary-foreground" />
                </button>
                <span className="text-xs flex-1 truncate line-through">{d.title}</span>
                <button onClick={() => onDelete(d.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
      }
    </div>
  );
}

// ── Agreements Panel ──────────────────────────────────────────────────────────

function AgreementsPanel({ agreements, onAdd, onDelete }: {
  agreements: Agreement[];
  onAdd: (title: string, notes: string | null) => void;
  onDelete: (id: number) => void;
}) {
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  function handleAdd() {
    if (!title.trim()) return;
    onAdd(title.trim(), notes.trim() || null);
    setTitle(""); setNotes(""); setAdding(false);
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      {!adding ? (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
          <Plus className="h-3.5 w-3.5" /> New agreement
        </button>
      ) : (
        <div className="flex flex-col gap-1.5">
          <input autoFocus className="h-7 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="What was agreed" value={title} onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setAdding(false)} />
          <textarea className="rounded border border-input bg-transparent px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Notes / context (optional)" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <div className="flex gap-1.5">
            <button onClick={handleAdd} className="px-2 h-6 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90">Add</button>
            <button onClick={() => { setAdding(false); setTitle(""); setNotes(""); }}
              className="px-2 h-6 text-xs rounded border border-border text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
        </div>
      )}
      {agreements.length === 0 && !adding && <p className="text-xs text-muted-foreground italic">No agreements recorded.</p>}
      <div className="flex flex-col gap-1">
        {agreements.map((a) => {
          const open = expanded.has(a.id);
          return (
            <div key={a.id} className="group rounded border border-border px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                {a.notes && (
                  <button onClick={() => setExpanded((prev) => { const s = new Set(prev); open ? s.delete(a.id) : s.add(a.id); return s; })}
                    className="shrink-0 text-muted-foreground hover:text-foreground">
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                )}
                <span className="text-xs flex-1 font-medium truncate">{a.title}</span>
                <button onClick={() => onDelete(a.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                  <X className="h-3 w-3" />
                </button>
              </div>
              {open && a.notes && <p className="text-xs text-muted-foreground mt-1 pl-5 whitespace-pre-wrap">{a.notes}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── The sidebar-mounted tool set ─────────────────────────────────────────────

export type QuickPanelId =
  | "reminders" | "chores" | "shopping" | "systems"
  | "notes" | "brain" | "events" | "deadlines" | "agreements";

export interface QuickPanelDef {
  id: QuickPanelId;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Badge count; undefined renders no badge. */
  count?: number;
}

interface QuickPanelsCtx {
  panels: QuickPanelDef[];
  open: QuickPanelId | null;
  toggle: (id: QuickPanelId) => void;
  close: () => void;
}

const Ctx = createContext<QuickPanelsCtx | null>(null);

/** Sidebar-side view of the tools. Throws outside the provider rather than silently rendering nothing. */
export function useQuickPanels(): QuickPanelsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQuickPanels must be used inside <QuickPanelsProvider>");
  return v;
}

export function QuickPanelsProvider({ children }: { children: React.ReactNode }) {
  // Quick tasks (reminder / chore / shopping) — created almost entirely from
  // Nexus Local on the phone. One query, grouped by category here.
  const [quickTasks, setQuickTasks]     = useState<Task[]>([]);
  const [systems, setSystems]           = useState<SystemEntry[]>([]);
  // task_id -> remind_at, from the pf_task_reminders subtype.
  const [remindAt, setRemindAt]         = useState<Map<number, string>>(new Map());
  const [subtaskMap, setSubtaskMap]     = useState<Record<number, SystemSubtask[]>>({});
  const [notes, setNotes]               = useState<QuickNote[]>([]);
  const [brainEntries, setBrainEntries] = useState<BrainEntry[]>([]);
  const [events, setEvents]             = useState<CalEvent[]>([]);
  const [deadlines, setDeadlines]       = useState<Deadline[]>([]);
  const [agreements, setAgreements]     = useState<Agreement[]>([]);
  const [open, setOpen]                 = useState<QuickPanelId | null>(null);
  const [loaded, setLoaded]             = useState(false);

  // Loaded on mount, not lazily on first open.
  //
  // Lazy was the obvious optimisation and it broke the feature: the badges are
  // meant to tell you how many unchecked items are waiting, and a badge that
  // only appears after you have already opened the panel tells you nothing. The
  // counts have to be true before the first click.
  //
  // The cost is small and not new — the dashboard used to issue six of these
  // reads on every visit, and they are tiny tables.
  const load = useCallback(async () => {
    const [qt, sys, rem, n, b, e, d, a] = await Promise.all([
      getQuickTasks(), getSystems(), getTaskSubtypeRows("reminder"), getQuickNotes(),
      getBrainDump(), getEvents(), getDeadlines(), getAgreements(),
    ]);
    setQuickTasks(qt); setSystems(sys); setNotes(n); setBrainEntries(b);
    setEvents(e); setDeadlines(d); setAgreements(a);
    setRemindAt(new Map(
      rem.filter((r) => r.remind_at).map((r) => [Number(r.task_id), String(r.remind_at)]),
    ));

    // Subtasks are per-system, so they can only be fetched once the systems are
    // known. Failing here must not blank the panel — a system with no subtasks
    // and a system whose subtasks failed to load look the same to the UI, so we
    // keep whatever we had rather than clearing.
    const today = new Date().toISOString().slice(0, 10);
    try {
      const entries = await Promise.all(
        sys.map(async (x) => [x.id, await getSystemSubtasks(x.id, today)] as [number, SystemSubtask[]]),
      );
      setSubtaskMap(Object.fromEntries(entries));
    } catch { /* keep the previous map */ }

    setLoaded(true);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  const toggle = useCallback((id: QuickPanelId) => {
    setOpen((prev) => (prev === id ? null : id));
  }, []);

  const close = useCallback(() => setOpen(null), []);

  const today = new Date().toISOString().slice(0, 10);
  // Counts stay undefined until the first load, so a badge never claims "0"
  // about data that simply hasn't been read yet.
  const n = (v: number) => (loaded && v > 0 ? v : undefined);

  const byCategory = (c: TaskCategory) => quickTasks.filter((t) => t.category === c);
  const nowMs = Date.now();
  const actionableReminders = byCategory("reminder").filter((t) => {
    if (t.done) return false;
    const at = remindAt.get(t.id);
    return !at || new Date(at).getTime() <= nowMs;
  }).length;
  const openIn = (c: TaskCategory) => byCategory(c).filter((t) => !t.done).length;

  const panels: QuickPanelDef[] = [
    // The three phone-captured kinds first — these are the ones with live counts
    // you act on, and they are why the rail exists.
    // Counts what is ACTIONABLE now: undated reminders plus those whose time has
    // passed. A reminder set for next week shouldn't sit on the badge all week —
    // that is how a badge stops meaning anything.
    { id: "reminders",  label: "Reminders",   icon: Bell,         count: n(actionableReminders) },
    { id: "chores",     label: "Chores",      icon: Brush,        count: n(openIn("chore")) },
    { id: "shopping",   label: "Shopping",    icon: ShoppingCart, count: n(openIn("shopping")) },
    { id: "systems",    label: "Systems",     icon: RefreshCw,    count: n(systems.filter((x) => isSystemDue(x)).length) },
    { id: "notes",      label: "Quick Notes", icon: FileText,     count: n(notes.length) },
    { id: "brain",      label: "Brain Dump",  icon: Zap,          count: n(brainEntries.length) },
    { id: "events",     label: "Events",      icon: Calendar,     count: n(events.filter((e) => e.date >= today).length) },
    { id: "deadlines",  label: "Deadlines",   icon: Clock,        count: n(deadlines.filter((d) => !d.done).length) },
    { id: "agreements", label: "Agreements",  icon: Handshake,    count: n(agreements.length) },
  ];

  // ── Handlers (moved verbatim from Dashboard) ──
  const handleToggleQuickTask = async (id: number) => {
    // Optimistic — a checkbox that waits on the network feels broken.
    setQuickTasks((p) => p.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    try { await toggleTask(id); } catch { load().catch(() => {}); }
  };
  const handleDeleteQuickTask = async (id: number) => {
    setQuickTasks((p) => p.filter((t) => t.id !== id));
    try { await deleteTask(id); } catch { load().catch(() => {}); }
  };
  const handleAddQuickTask = async (title: string, category: TaskCategory) => {
    const t = await createTask({ title, category, plan_id: null });
    setQuickTasks((p) => [t, ...p]);
  };

  const handleMakeRecurring = async (id: number, intervalDays: number) => {
    await promoteChoreToSystem(id, intervalDays);
    await load();      // the chore is gone and a system exists — reload both
    setOpen("systems"); // land the user where the thing now lives
  };

  const handleMarkSystem = async (id: number) => {
    const x = await markSystemDone(id); setSystems((p) => p.map((y) => (y.id === id ? x : y)));
  };
  const handleUnmarkSystem = async (id: number) => {
    const x = await unmarkSystemDone(id); setSystems((p) => p.map((y) => (y.id === id ? x : y)));
  };
  const handleToggleSubtask = async (subtaskId: number, systemId: number) => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await toggleSystemSubtask(subtaskId, today);
    setSubtaskMap((p) => ({ ...p, [systemId]: res.subtasks }));
    setSystems((p) => p.map((y) => (y.id === systemId ? res.system : y)));
  };
  const handleAddNote = async (title: string, body: string | null) => {
    const x = await addQuickNote(title, body); setNotes((p) => [x, ...p]);
  };
  const handleDeleteNote = async (id: number) => {
    await deleteQuickNote(id); setNotes((p) => p.filter((x) => x.id !== id));
  };
  const handleAddBrain = async (content: string) => {
    const x = await addBrainEntry(content); setBrainEntries((p) => [x, ...p]);
  };
  const handleDeleteBrain = async (id: number) => {
    await deleteBrainEntry(id); setBrainEntries((p) => p.filter((x) => x.id !== id));
  };
  const handleAddEvent = async (title: string, date: string) => {
    const x = await addEvent(title, date); setEvents((p) => [x, ...p]);
  };
  const handleDeleteEvent = async (id: number) => {
    await deleteEvent(id); setEvents((p) => p.filter((x) => x.id !== id));
  };
  const handleAddDeadline = async (title: string, due: string) => {
    const x = await addDeadline(title, due); setDeadlines((p) => [x, ...p]);
  };
  const handleToggleDeadline = async (id: number) => {
    const x = await toggleDeadline(id); setDeadlines((p) => p.map((y) => (y.id === id ? x : y)));
  };
  const handleDeleteDeadline = async (id: number) => {
    await deleteDeadline(id); setDeadlines((p) => p.filter((x) => x.id !== id));
  };
  const handleAddAgreement = async (title: string, note: string | null) => {
    const x = await addAgreement(title, note); setAgreements((p) => [x, ...p]);
  };
  const handleDeleteAgreement = async (id: number) => {
    await deleteAgreement(id); setAgreements((p) => p.filter((x) => x.id !== id));
  };

  const body = (() => {
    switch (open) {
      case "reminders":  return <QuickTaskPanel tasks={byCategory("reminder")} category="reminder" remindAt={remindAt} onToggle={handleToggleQuickTask} onDelete={handleDeleteQuickTask} onAdd={handleAddQuickTask} />;
      case "chores":     return <QuickTaskPanel tasks={byCategory("chore")}    category="chore"    onToggle={handleToggleQuickTask} onDelete={handleDeleteQuickTask} onAdd={handleAddQuickTask} onMakeRecurring={handleMakeRecurring} />;
      case "shopping":   return <QuickTaskPanel tasks={byCategory("shopping")} category="shopping" onToggle={handleToggleQuickTask} onDelete={handleDeleteQuickTask} onAdd={handleAddQuickTask} />;
      case "systems":    return <SystemsPanel systems={systems} subtaskMap={subtaskMap} onMark={handleMarkSystem} onUnmark={handleUnmarkSystem} onToggleSubtask={handleToggleSubtask} />;
      case "notes":      return <QuickNotesPanel notes={notes}           onAdd={handleAddNote}      onDelete={handleDeleteNote} />;
      case "brain":      return <BrainDumpPanel  entries={brainEntries}  onAdd={handleAddBrain}     onDelete={handleDeleteBrain} />;
      case "events":     return <EventsPanel     events={events}         onAdd={handleAddEvent}     onDelete={handleDeleteEvent} />;
      case "deadlines":  return <DeadlinesPanel  deadlines={deadlines}   onAdd={handleAddDeadline}  onToggle={handleToggleDeadline} onDelete={handleDeleteDeadline} />;
      case "agreements": return <AgreementsPanel agreements={agreements} onAdd={handleAddAgreement} onDelete={handleDeleteAgreement} />;
      default:           return null;
    }
  })();

  const label = panels.find((p) => p.id === open)?.label ?? "";

  return (
    <Ctx.Provider value={{ panels, open, toggle, close }}>
      {children}
      {open && <QuickPanelFlyout title={label} loaded={loaded} onClose={close}>{body}</QuickPanelFlyout>}
    </Ctx.Provider>
  );
}

/**
 * The open tool, as a panel anchored to the sidebar edge.
 *
 * A flyout rather than an inline block: the trigger now lives in global
 * navigation, so the panel has to be able to appear over any page. Click-outside
 * and Escape both dismiss it — a panel opened by a single click should not need
 * a hunt to close.
 */
function QuickPanelFlyout({ title, loaded, onClose, children }: {
  title: string;
  loaded: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      // Ignore clicks on the sidebar triggers — they toggle for themselves, and
      // closing here first would make a second click reopen instead of close.
      if ((e.target as HTMLElement).closest?.("[data-quick-panel-trigger]")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed left-2 bottom-14 z-50 w-80 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-popover shadow-2xl p-3"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      {loaded ? children : <p className="text-xs text-muted-foreground italic">Loading…</p>}
    </div>
  );
}
