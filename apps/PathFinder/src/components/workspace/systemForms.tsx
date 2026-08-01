import { useEffect, useState, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { getSystemSubtasks, addSystemSubtask, deleteSystemSubtask } from "../../lib/api";
import { Button } from "../ui/button";
import { Badge } from "../ui/badge";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import type { SystemEntry, SystemSubtask, Frequency } from "../../types";

const todayDate = () => new Date().toISOString().slice(0, 10);
export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Recurrence "due today?" logic — the single source of truth for the workspace.
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
  if (sys.frequency === "daily") return diff >= 1;
  if (sys.frequency === "weekly") return diff >= 7;
  return diff >= 30;
}

export function frequencyBadge(sys: SystemEntry) {
  const map: Record<Frequency, "default" | "secondary" | "outline"> = { daily: "default", weekly: "secondary", monthly: "outline" };
  if (sys.days_of_week) {
    const days = sys.days_of_week.split(",").map(Number).map((d) => DAY_LABELS[d]);
    return <Badge variant="secondary">{days.join(", ")}</Badge>;
  }
  const f = sys.frequency as Frequency;
  return <Badge variant={map[f]}>{f.charAt(0).toUpperCase() + f.slice(1)}</Badge>;
}

export function lastDoneLabel(lastDone: string | null): string {
  if (!lastDone) return "Never done";
  const days = Math.floor((Date.now() - new Date(lastDone).getTime()) / 86400000);
  if (days === 0) return "Done today";
  if (days === 1) return "Done yesterday";
  return `Done ${days}d ago`;
}

function DayPicker({ value, onChange }: { value: number[]; onChange: (days: number[]) => void }) {
  const toggle = (day: number) =>
    onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day].sort((a, b) => a - b));
  return (
    <div className="flex gap-1 flex-wrap">
      {DAY_LABELS.map((label, i) => (
        <button key={i} type="button" onClick={() => toggle(i)}
          className={cn(
            "h-7 w-9 rounded-md text-xs font-medium border transition-colors",
            value.includes(i) ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-input hover:border-ring",
          )}>
          {label}
        </button>
      ))}
    </div>
  );
}

export interface SystemFormState {
  title: string; description: string; frequency: Frequency; days: number[]; start_time: string; end_time: string;
}
export const emptySystemForm: SystemFormState = { title: "", description: "", frequency: "daily", days: [], start_time: "", end_time: "" };

export function systemToForm(sys: SystemEntry): SystemFormState {
  return {
    title: sys.title, description: sys.description ?? "", frequency: sys.frequency as Frequency,
    days: sys.days_of_week ? sys.days_of_week.split(",").map(Number) : [],
    start_time: sys.start_time ?? "", end_time: sys.end_time ?? "",
  };
}
export function formToDaysOfWeek(form: SystemFormState): string | null {
  return form.frequency === "weekly" && form.days.length > 0 ? form.days.join(",") : null;
}

export function SystemForm({ initial = emptySystemForm, submitLabel, onSubmit, onClose }: {
  initial?: SystemFormState;
  submitLabel: string;
  onSubmit: (data: SystemFormState) => Promise<void>;
  onClose: () => void;
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
      <Input autoFocus placeholder="System title" value={form.title}
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
          <input type="time"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
          <input type="time"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

export function SubtaskManager({ systemId, onClose }: { systemId: number; onClose: () => void }) {
  const date = todayDate();
  const [subtasks, setSubtasks] = useState<SystemSubtask[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const load = useCallback(async () => { setSubtasks(await getSystemSubtasks(systemId, date)); }, [systemId, date]);
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
      {subtasks.length === 0 && <p className="text-xs text-muted-foreground italic">No subtasks yet.</p>}
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
        <button onClick={handleAdd} className="text-primary hover:text-primary/80 shrink-0"><Plus className="h-4 w-4" /></button>
      </div>
      <div className="flex justify-end mt-1"><Button size="sm" onClick={onClose}>Done</Button></div>
    </div>
  );
}
