import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ComponentType,
} from "react";
import {
  Bell, FileText, Zap, Calendar, Clock, Handshake,
  Check, ChevronDown, ChevronRight, Plus, X,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  getReminders, addReminder, toggleReminder, deleteReminder,
  getQuickNotes, addQuickNote, deleteQuickNote,
  getBrainDump, addBrainEntry, deleteBrainEntry,
  getEvents, addEvent, deleteEvent,
  getDeadlines, addDeadline, toggleDeadline, deleteDeadline,
  getAgreements, addAgreement, deleteAgreement,
} from "../lib/api";
import type {
  Reminder, QuickNote, BrainEntry, CalEvent, Deadline, Agreement,
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
 * Owning their own data is what makes that possible. Nothing else on the
 * dashboard ever read these six slices, so lifting them out of that page removed
 * six state variables, six loads and eighteen handlers from a 3000-line file —
 * and, as a side effect, made every tool reachable from any page rather than
 * only the dashboard.
 */

function RemindersPanel({ reminders, onAdd, onToggle, onDelete }: {
  reminders: Reminder[];
  onAdd: (title: string) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [draft, setDraft] = useState("");

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" && draft.trim()) {
      onAdd(draft.trim());
      setDraft("");
    }
  }

  const open = reminders.filter((r) => !r.done);
  const done = reminders.filter((r) => r.done);

  return (
    <div className="flex flex-col gap-2 pt-1">
      {/* Add input */}
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-xs placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          placeholder="Add reminder… (Enter)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(""); } }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Open reminders */}
      {open.length === 0 && done.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No reminders yet.</p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {open.map((r) => (
            <div key={r.id} className="flex items-center gap-2 group py-0.5">
              <button
                onClick={() => onToggle(r.id)}
                className="h-3.5 w-3.5 shrink-0 rounded border border-border hover:border-primary transition-colors"
              />
              <span className="text-xs flex-1 truncate">{r.title}</span>
              <button onClick={() => onDelete(r.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}

          {done.length > 0 && (
            <>
              {open.length > 0 && <div className="h-px bg-border my-1" />}
              {done.map((r) => (
                <div key={r.id} className="flex items-center gap-2 group py-0.5 opacity-50">
                  <button
                    onClick={() => onToggle(r.id)}
                    className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border border-primary bg-primary transition-colors"
                  >
                    <Check className="h-2.5 w-2.5 text-primary-foreground" />
                  </button>
                  <span className="text-xs flex-1 truncate line-through">{r.title}</span>
                  <button onClick={() => onDelete(r.id)} className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Quick Notes Panel ─────────────────────────────────────────────────────────

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

export type QuickPanelId = "reminders" | "notes" | "brain" | "events" | "deadlines" | "agreements";

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
  const [reminders, setReminders]       = useState<Reminder[]>([]);
  const [notes, setNotes]               = useState<QuickNote[]>([]);
  const [brainEntries, setBrainEntries] = useState<BrainEntry[]>([]);
  const [events, setEvents]             = useState<CalEvent[]>([]);
  const [deadlines, setDeadlines]       = useState<Deadline[]>([]);
  const [agreements, setAgreements]     = useState<Agreement[]>([]);
  const [open, setOpen]                 = useState<QuickPanelId | null>(null);
  const [loaded, setLoaded]             = useState(false);

  // Loaded once on first open, not on mount: these six reads are for tools the
  // user may never touch in a session, and paying for them on every app start
  // would slow the first paint of whatever page they actually wanted.
  const load = useCallback(async () => {
    const [r, n, b, e, d, a] = await Promise.all([
      getReminders(), getQuickNotes(), getBrainDump(),
      getEvents(), getDeadlines(), getAgreements(),
    ]);
    setReminders(r); setNotes(n); setBrainEntries(b);
    setEvents(e); setDeadlines(d); setAgreements(a);
    setLoaded(true);
  }, []);

  const toggle = useCallback((id: QuickPanelId) => {
    setOpen((prev) => (prev === id ? null : id));
    if (!loaded) load().catch(() => {});
  }, [loaded, load]);

  const close = useCallback(() => setOpen(null), []);

  const today = new Date().toISOString().slice(0, 10);
  // Counts stay undefined until the first load, so a badge never claims "0"
  // about data that simply hasn't been read yet.
  const n = (v: number) => (loaded && v > 0 ? v : undefined);

  const panels: QuickPanelDef[] = [
    { id: "reminders",  label: "Reminders",  icon: Bell,     count: n(reminders.filter((r) => !r.done).length) },
    { id: "notes",      label: "Quick Notes", icon: FileText, count: n(notes.length) },
    { id: "brain",      label: "Brain Dump",  icon: Zap,      count: n(brainEntries.length) },
    { id: "events",     label: "Events",      icon: Calendar, count: n(events.filter((e) => e.date >= today).length) },
    { id: "deadlines",  label: "Deadlines",   icon: Clock,    count: n(deadlines.filter((d) => !d.done).length) },
    { id: "agreements", label: "Agreements",  icon: Handshake, count: n(agreements.length) },
  ];

  // ── Handlers (moved verbatim from Dashboard) ──
  const handleAddReminder = async (title: string) => {
    const r = await addReminder(title); setReminders((p) => [r, ...p]);
  };
  const handleToggleReminder = async (id: number) => {
    const r = await toggleReminder(id); setReminders((p) => p.map((x) => (x.id === id ? r : x)));
  };
  const handleDeleteReminder = async (id: number) => {
    await deleteReminder(id); setReminders((p) => p.filter((x) => x.id !== id));
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
      case "reminders":  return <RemindersPanel  reminders={reminders}   onAdd={handleAddReminder}  onToggle={handleToggleReminder} onDelete={handleDeleteReminder} />;
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
