import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, CheckCircle, Flame, X, Check } from "lucide-react";
import {
  getSystems, createSystem, updateSystem, deleteSystem, markSystemDone,
  getSystemSubtasks, addSystemSubtask, deleteSystemSubtask, toggleSystemSubtask,
} from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Dialog, DialogTrigger, DialogContent, DialogClose } from "../components/ui/dialog";
import { cn } from "../lib/utils";
import type { SystemEntry, SystemSubtask, Frequency } from "../types";

const todayDate = () => new Date().toISOString().slice(0, 10);

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isDue(sys: SystemEntry): boolean {
  if (sys.days_of_week) {
    const todayDay = new Date().getDay();
    const days = sys.days_of_week.split(",").map(Number);
    if (!days.includes(todayDay)) return false;
    if (!sys.last_done) return true;
    return sys.last_done.slice(0, 10) !== todayDate();
  }
  if (!sys.last_done) return true;
  const diff = (Date.now() - new Date(sys.last_done).getTime()) / 86_400_000;
  if (sys.frequency === "daily")   return diff >= 1;
  if (sys.frequency === "weekly")  return diff >= 7;
  return diff >= 30;
}

function frequencyBadge(sys: SystemEntry) {
  const map: Record<Frequency, "default" | "secondary" | "outline"> = {
    daily: "default", weekly: "secondary", monthly: "outline",
  };
  if (sys.days_of_week) {
    const days = sys.days_of_week.split(",").map(Number).map((d) => DAY_LABELS[d]);
    return <Badge variant="secondary">{days.join(", ")}</Badge>;
  }
  const f = sys.frequency as Frequency;
  return <Badge variant={map[f]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Badge>;
}

function lastDoneLabel(lastDone: string | null): string {
  if (!lastDone) return "Never done";
  const days = Math.floor((Date.now() - new Date(lastDone).getTime()) / 86400000);
  if (days === 0) return "Done today";
  if (days === 1) return "Done yesterday";
  return `Done ${days}d ago`;
}

// ── Day-of-week picker ─────────────────────────────────────────────────────────

function DayPicker({ value, onChange }: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const toggle = (day: number) => {
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  };
  return (
    <div className="flex gap-1 flex-wrap">
      {DAY_LABELS.map((label, i) => (
        <button
          key={i}
          type="button"
          onClick={() => toggle(i)}
          className={cn(
            "h-7 w-9 rounded-md text-xs font-medium border transition-colors",
            value.includes(i)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-input hover:border-ring"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── System form ────────────────────────────────────────────────────────────────

interface SystemFormState {
  title: string;
  description: string;
  frequency: Frequency;
  days: number[];  // selected days (used when frequency = "weekly")
  start_time: string;
  end_time: string;
}

const emptyForm: SystemFormState = { title: "", description: "", frequency: "daily", days: [], start_time: "", end_time: "" };

function systemToForm(sys: SystemEntry): SystemFormState {
  return {
    title:       sys.title,
    description: sys.description ?? "",
    frequency:   sys.frequency as Frequency,
    days:        sys.days_of_week ? sys.days_of_week.split(",").map(Number) : [],
    start_time:  sys.start_time ?? "",
    end_time:    sys.end_time ?? "",
  };
}

function formToDaysOfWeek(form: SystemFormState): string | null {
  if (form.frequency === "weekly" && form.days.length > 0) {
    return form.days.join(",");
  }
  return null;
}

function SystemForm({ initial = emptyForm, onSubmit, submitLabel }: {
  initial?: SystemFormState;
  onSubmit: (data: SystemFormState) => Promise<void>;
  submitLabel: string;
}) {
  const [form, setForm] = useState<SystemFormState>(initial);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSubmit(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input placeholder="System title" value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
      <Textarea placeholder="Description (optional)" value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Frequency</label>
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={form.frequency}
          onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value as Frequency, days: [] }))}
        >
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </select>
      </div>

      {form.frequency === "weekly" && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">
            Days of the week <span className="text-muted-foreground/60">(leave empty for "any 7 days")</span>
          </label>
          <DayPicker value={form.days} onChange={(days) => setForm((f) => ({ ...f, days }))} />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Scheduled time (optional)</label>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground/70">Start</span>
            <input type="time"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.start_time}
              onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-muted-foreground/70">End</span>
            <input type="time"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={form.end_time}
              onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-2 mt-1">
        <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// ── Subtask manager ────────────────────────────────────────────────────────────

function SubtaskManager({ systemId, onClose }: { systemId: number; onClose: () => void }) {
  const date = todayDate();
  const [subtasks, setSubtasks] = useState<SystemSubtask[]>([]);
  const [newTitle, setNewTitle] = useState("");

  const load = useCallback(async () => {
    setSubtasks(await getSystemSubtasks(systemId, date));
  }, [systemId, date]);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    const t = newTitle.trim();
    if (!t) return;
    setSubtasks(await addSystemSubtask(systemId, t));
    setNewTitle("");
  };

  return (
    <div className="flex flex-col gap-2 mt-2 border-t border-border pt-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subtasks</p>
      {subtasks.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No subtasks yet.</p>
      )}
      <div className="flex flex-col gap-1">
        {subtasks.map((sub) => (
          <div key={sub.id} className="flex items-center gap-2 group py-0.5">
            <span className="text-sm text-foreground flex-1 truncate">{sub.title}</span>
            <button onClick={async () => { await deleteSystemSubtask(sub.id); load(); }}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <input
          className="flex-1 h-7 rounded border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring min-w-0"
          placeholder="Add subtask..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <button onClick={handleAdd} className="text-primary hover:text-primary/80 shrink-0">
          <Plus className="h-4 w-4" />
        </button>
      </div>
      <div className="flex justify-end mt-1">
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

// ── Systems page ───────────────────────────────────────────────────────────────

export function Systems() {
  const date = todayDate();
  const [systems,    setSystems]    = useState<SystemEntry[]>([]);
  const [subtaskMap, setSubtaskMap] = useState<Record<number, SystemSubtask[]>>({});
  const [editing,    setEditing]    = useState<SystemEntry | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen,   setEditOpen]   = useState(false);

  const loadSubtasks = useCallback(async (sysList: SystemEntry[]) => {
    const entries = await Promise.all(
      sysList.map(async (s) => [s.id, await getSystemSubtasks(s.id, date)] as [number, SystemSubtask[]])
    );
    setSubtaskMap(Object.fromEntries(entries));
  }, [date]);

  const load = useCallback(async () => {
    const s = await getSystems();
    setSystems(s);
    loadSubtasks(s);
  }, [loadSubtasks]);

  useEffect(() => { load(); }, [load]);

  const handleToggleSubtask = async (subtaskId: number, systemId: number) => {
    const result = await toggleSystemSubtask(subtaskId, date);
    setSubtaskMap((prev) => ({ ...prev, [systemId]: result.subtasks }));
    setSystems((prev) => prev.map((s) => s.id === result.system.id ? result.system : s));
  };

  const due      = systems.filter(isDue);
  const upToDate = systems.filter((s) => !isDue(s));

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Systems</h1>
          {due.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5">{due.length} need attention</p>
          )}
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5" /> New System</Button>
          </DialogTrigger>
          <DialogContent title="New System" description="A recurring process that keeps you on track.">
            <SystemForm
              onSubmit={async (f) => {
                await createSystem({
                  title: f.title,
                  description: f.description || null,
                  frequency: f.frequency,
                  days_of_week: formToDaysOfWeek(f),
                  start_time: f.start_time || null,
                  end_time: f.end_time || null,
                });
                setCreateOpen(false);
                load();
              }}
              submitLabel="Create"
            />
          </DialogContent>
        </Dialog>
      </div>

      {systems.length === 0 ? (
        <p className="text-sm text-muted-foreground">No systems yet. Add routines or recurring processes here.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {due.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Due</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {due.map((sys) => (
                  <SystemCard key={sys.id} sys={sys} due
                    subtasks={subtaskMap[sys.id] ?? []}
                    onMarkDone={async () => { await markSystemDone(sys.id); load(); }}
                    onToggleSubtask={(sid) => handleToggleSubtask(sid, sys.id)}
                    onEdit={() => { setEditing(sys); setEditOpen(true); }}
                    onDelete={async () => { await deleteSystem(sys.id); load(); }}
                  />
                ))}
              </div>
            </div>
          )}
          {upToDate.length > 0 && (
            <div>
              <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Up to date</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {upToDate.map((sys) => (
                  <SystemCard key={sys.id} sys={sys} due={false}
                    subtasks={subtaskMap[sys.id] ?? []}
                    onMarkDone={async () => { await markSystemDone(sys.id); load(); }}
                    onToggleSubtask={(sid) => handleToggleSubtask(sid, sys.id)}
                    onEdit={() => { setEditing(sys); setEditOpen(true); }}
                    onDelete={async () => { await deleteSystem(sys.id); load(); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={editOpen} onOpenChange={(o) => { setEditOpen(o); if (!o) { setEditing(null); load(); } }}>
        <DialogContent title="Edit System">
          {editing && (
            <>
              <SystemForm
                initial={systemToForm(editing)}
                onSubmit={async (f) => {
                  await updateSystem(editing.id, {
                    title: f.title,
                    description: f.description || null,
                    frequency: f.frequency,
                    days_of_week: formToDaysOfWeek(f),
                    start_time: f.start_time || null,
                    end_time: f.end_time || null,
                  });
                  setEditOpen(false);
                  setEditing(null);
                  load();
                }}
                submitLabel="Save"
              />
              <SubtaskManager
                systemId={editing.id}
                onClose={() => { setEditOpen(false); setEditing(null); load(); }}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── System card ────────────────────────────────────────────────────────────────

function SystemCard({ sys, due, subtasks, onMarkDone, onToggleSubtask, onEdit, onDelete }: {
  sys: SystemEntry;
  due: boolean;
  subtasks: SystemSubtask[];
  onMarkDone: () => void;
  onToggleSubtask: (subtaskId: number) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const hasSubtasks = subtasks.length > 0;
  const doneSubs    = subtasks.filter((s) => s.done).length;
  const allSubsDone = hasSubtasks && doneSubs === subtasks.length;

  return (
    <div className={cn("rounded-xl border bg-card p-4 flex flex-col gap-3", due ? "border-primary/30" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-2">
            {due && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
            <span className="text-sm font-medium text-foreground">{sys.title}</span>
          </div>
          {sys.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{sys.description}</p>
          )}
        </div>
        {frequencyBadge(sys)}
      </div>

      {hasSubtasks && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Subtasks</p>
            <span className="text-xs text-muted-foreground tabular-nums">{doneSubs}/{subtasks.length}</span>
          </div>
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <button
                onClick={() => onToggleSubtask(sub.id)}
                className={cn(
                  "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                  sub.done ? "bg-primary border-primary" : "border-border hover:border-primary"
                )}
              >
                {sub.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
              </button>
              <span className={cn("text-sm flex-1 truncate", sub.done ? "line-through text-muted-foreground" : "text-foreground")}>
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}

      {sys.streak_count > 0 && (
        <div className="flex items-center gap-1.5">
          <Flame className={cn("h-3.5 w-3.5", sys.streak_count >= 7 ? "text-orange-500" : sys.streak_count >= 3 ? "text-yellow-500" : "text-muted-foreground")} />
          <span className="text-xs text-muted-foreground">
            {sys.streak_count} {sys.frequency === "daily" ? "day" : sys.frequency === "weekly" ? "week" : "month"} streak
          </span>
        </div>
      )}

      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className={cn("text-xs", due ? "text-primary font-medium" : "text-muted-foreground")}>
          {lastDoneLabel(sys.last_done)}
        </span>
        <div className="flex items-center gap-1">
          {!hasSubtasks && (
            <Button variant={due ? "default" : "outline"} size="sm" onClick={onMarkDone}>
              <CheckCircle className="h-3.5 w-3.5" />
              {due ? "Mark done" : "Done again"}
            </Button>
          )}
          {hasSubtasks && allSubsDone && (
            <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
              <CheckCircle className="h-3.5 w-3.5" /> Complete
            </span>
          )}
          <Button variant="ghost" size="icon" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
