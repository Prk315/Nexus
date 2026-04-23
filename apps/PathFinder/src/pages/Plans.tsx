import { useEffect, useState } from "react";
import { Plus, ChevronDown, ChevronRight, Trash2, Pencil, Check, CheckCircle, X, Tag } from "lucide-react";
import {
  getGoals, getPlans, createPlan, updatePlan, deletePlan,
  getTasks, createTask, toggleTask, deleteTask,
} from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Progress } from "../components/ui/progress";
import { Dialog, DialogTrigger, DialogContent, DialogClose } from "../components/ui/dialog";
import { PriorityDot } from "../components/PriorityDot";
import { daysUntil, deadlineLabel, deadlineVariant } from "../lib/utils";
import type { Goal, Plan, Task, Priority } from "../types";
import { cn } from "../lib/utils";

// ── Tag helpers ───────────────────────────────────────────────────────────────

export function parseTags(s: string | null | undefined): string[] {
  if (!s) return [];
  return s.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
}

export function serializeTags(tags: string[]): string | null {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  return clean.length > 0 ? clean.join(",") : null;
}

// Tag colors cycle through a palette
const TAG_COLORS = [
  "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-400/30",
  "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-400/30",
  "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-400/30",
  "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-400/30",
  "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-400/30",
  "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-400/30",
];

const FIXED_TAG_COLOR: Record<string, string> = {
  course: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-400/40",
};

export function tagColor(tag: string, index = 0): string {
  return FIXED_TAG_COLOR[tag] ?? TAG_COLORS[index % TAG_COLORS.length];
}

export function TagChip({ tag, onRemove, index = 0 }: { tag: string; onRemove?: () => void; index?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-medium", tagColor(tag, index))}>
      {tag}
      {onRemove && (
        <button onClick={onRemove} className="hover:opacity-70 transition-opacity">
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

function TagInput({ value, onChange }: { value: string[]; onChange: (tags: string[]) => void }) {
  const [input, setInput] = useState("");

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!tag || value.includes(tag)) { setInput(""); return; }
    onChange([...value, tag]);
    setInput("");
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(input); }
    if (e.key === "Backspace" && input === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex flex-wrap gap-1 rounded-md border border-input bg-background px-2 py-1.5 min-h-[2.25rem] focus-within:ring-1 focus-within:ring-ring">
      {value.map((t, i) => (
        <TagChip key={t} tag={t} index={i} onRemove={() => onChange(value.filter((x) => x !== t))} />
      ))}
      <input
        className="flex-1 min-w-[80px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
        placeholder={value.length === 0 ? "Add tags…" : ""}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={() => { if (input.trim()) addTag(input); }}
      />
    </div>
  );
}

interface PlanFormState { title: string; description: string; deadline: string; goal_id: string; tags: string[]; }
const emptyPlanForm: PlanFormState = { title: "", description: "", deadline: "", goal_id: "", tags: [] };

function PlanForm({ goals, initial = emptyPlanForm, onSubmit, submitLabel }: {
  goals: Goal[];
  initial?: PlanFormState;
  onSubmit: (data: PlanFormState) => Promise<void>;
  submitLabel: string;
}) {
  const [form, setForm] = useState<PlanFormState>(initial);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSubmit(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input placeholder="Plan title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
      <Textarea placeholder="Description (optional)" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Linked goal</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.goal_id}
            onChange={(e) => setForm((f) => ({ ...f, goal_id: e.target.value }))}
          >
            <option value="">No goal</option>
            {goals.filter((g) => g.status === "active").map((g) => (
              <option key={g.id} value={String(g.id)}>{g.title}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Deadline</label>
          <Input type="date" value={form.deadline} onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground flex items-center gap-1"><Tag className="h-3 w-3" /> Tags <span className="text-muted-foreground/50">(Enter or comma to add)</span></label>
        <TagInput value={form.tags} onChange={(tags) => setForm((f) => ({ ...f, tags }))} />
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

function TaskList({ planId }: { planId: number }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<Priority>("medium");
  const [newDue, setNewDue] = useState(() => new Date().toISOString().slice(0, 10));
  const [newEstimate, setNewEstimate] = useState("");

  const load = () => getTasks(planId).then(setTasks);
  useEffect(() => { load(); }, [planId]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim()) return;
    await createTask({
      plan_id: planId, title: newTitle.trim(), priority: newPriority,
      due_date: newDue || null,
      time_estimate: newEstimate ? Number(newEstimate) : null,
    });
    setNewTitle("");
    setNewDue(new Date().toISOString().slice(0, 10));
    setNewEstimate("");
    load();
  }

  return (
    <div className="flex flex-col gap-1 pt-3 border-t border-border mt-3">
      {tasks.map((task) => {
        const days = task.due_date ? daysUntil(task.due_date) : null;
        return (
          <div key={task.id} className="flex items-center gap-2 group py-0.5 px-1 rounded hover:bg-secondary/40">
            <button
              onClick={async () => { await toggleTask(task.id); load(); }}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                task.done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary"
              }`}
            >
              {task.done && <Check className="h-3 w-3" />}
            </button>
            <PriorityDot priority={task.priority} />
            <span className={`text-sm flex-1 ${task.done ? "line-through text-muted-foreground" : "text-foreground"}`}>
              {task.title}
            </span>
            {task.time_estimate != null && (
              <span className="text-[10px] text-muted-foreground/60 shrink-0 tabular-nums">
                {task.time_estimate < 60 ? `${task.time_estimate}m` : `${Math.floor(task.time_estimate/60)}h${task.time_estimate%60>0?` ${task.time_estimate%60}m`:""}`}
              </span>
            )}
            {days !== null && !task.done && (
              <Badge variant={deadlineVariant(days)} className="text-xs shrink-0">
                {deadlineLabel(days)}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="opacity-0 group-hover:opacity-100 h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={async () => { await deleteTask(task.id); load(); }}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        );
      })}

      <form onSubmit={handleAdd} className="flex items-center gap-2 mt-1">
        <Input
          placeholder="Add task..."
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          className="h-7 text-xs flex-1"
        />
        <select
          className="h-7 rounded border border-input bg-transparent px-1.5 text-xs focus-visible:outline-none"
          value={newPriority}
          onChange={(e) => setNewPriority(e.target.value as Priority)}
        >
          <option value="high">High</option>
          <option value="medium">Med</option>
          <option value="low">Low</option>
        </select>
        <Input
          type="date"
          value={newDue}
          onChange={(e) => setNewDue(e.target.value)}
          className="h-7 text-xs w-32"
        />
        <Input
          type="number" min={1} placeholder="min"
          value={newEstimate}
          onChange={(e) => setNewEstimate(e.target.value)}
          title="Time estimate in minutes"
          className="h-7 text-xs w-16"
        />
        <Button size="sm" type="submit" className="h-7 px-2 text-xs shrink-0">Add</Button>
      </form>
    </div>
  );
}

export function Plans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<Plan | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [filterGoalId, setFilterGoalId] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("active");

  const load = () => getPlans().then(setPlans);
  useEffect(() => { load(); getGoals().then(setGoals); }, []);

  function goalName(id: number | null) {
    if (!id) return null;
    return goals.find((g) => g.id === id)?.title ?? null;
  }

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const filtered = plans
    .filter((p) => filterGoalId === "all" ? true : filterGoalId === "none" ? !p.goal_id : String(p.goal_id) === filterGoalId)
    .filter((p) => filterStatus === "all" ? true : p.status === filterStatus);

  async function handleMarkComplete(plan: Plan) {
    await updatePlan(plan.id, { goal_id: plan.goal_id, title: plan.title, description: plan.description, deadline: plan.deadline, status: "completed", tags: plan.tags, is_course: plan.is_course, is_lifestyle: plan.is_lifestyle, lifestyle_area_id: plan.lifestyle_area_id });
    load();
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Plans</h1>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-3.5 w-3.5" /> New Plan</Button>
          </DialogTrigger>
          <DialogContent title="New Plan" description="Break down how you'll reach a goal.">
            <PlanForm
              goals={goals}
              onSubmit={async (f) => {
                await createPlan({ title: f.title, description: f.description || null, deadline: f.deadline || null, goal_id: f.goal_id ? Number(f.goal_id) : null, tags: serializeTags(f.tags) });
                setCreateOpen(false);
                load();
              }}
              submitLabel="Create"
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1 border-b border-border pb-2 flex-1">
          {["active", "completed", "all"].map((s) => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 text-xs rounded-md font-medium transition-colors capitalize ${
                filterStatus === s ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none mb-2"
          value={filterGoalId}
          onChange={(e) => setFilterGoalId(e.target.value)}
        >
          <option value="all">All goals</option>
          <option value="none">No goal</option>
          {goals.map((g) => <option key={g.id} value={String(g.id)}>{g.title}</option>)}
        </select>
      </div>

      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plans here.</p>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((plan) => {
            const open = expanded.has(plan.id);
            const gName = goalName(plan.goal_id);
            const pct = plan.task_count === 0 ? 0 : Math.round((plan.done_count / plan.task_count) * 100);
            const days = plan.deadline ? daysUntil(plan.deadline) : null;

            return (
              <div key={plan.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start gap-2">
                  <button
                    onClick={() => toggleExpand(plan.id)}
                    className="mt-0.5 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-foreground">{plan.title}</span>
                      {gName && <Badge variant="secondary">{gName}</Badge>}
                      {plan.status === "completed" && <Badge variant="success">Completed</Badge>}
                      {days !== null && <Badge variant={deadlineVariant(days)}>{deadlineLabel(days)}</Badge>}
                      {parseTags(plan.tags).map((t, i) => <TagChip key={t} tag={t} index={i} />)}
                    </div>
                    {plan.description && <p className="text-xs text-muted-foreground mt-0.5">{plan.description}</p>}
                    {plan.task_count > 0 && (
                      <div className="flex items-center gap-3 mt-2">
                        <Progress value={plan.done_count} max={plan.task_count} className="flex-1" />
                        <span className="text-xs text-muted-foreground shrink-0">
                          {pct}% · {plan.done_count}/{plan.task_count}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {plan.status === "active" && (
                      <Button variant="ghost" size="icon" title="Mark complete" onClick={() => handleMarkComplete(plan)}>
                        <CheckCircle className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Dialog open={editOpen && editing?.id === plan.id} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditing(null); }}>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" onClick={() => { setEditing(plan); setEditOpen(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </DialogTrigger>
                      <DialogContent title="Edit Plan">
                        <PlanForm
                          goals={goals}
                          initial={{ title: plan.title, description: plan.description ?? "", deadline: plan.deadline ?? "", goal_id: plan.goal_id ? String(plan.goal_id) : "", tags: parseTags(plan.tags) }}
                          onSubmit={async (f) => {
                            await updatePlan(plan.id, { title: f.title, description: f.description || null, deadline: f.deadline || null, goal_id: f.goal_id ? Number(f.goal_id) : null, status: plan.status, tags: serializeTags(f.tags), is_course: plan.is_course, is_lifestyle: plan.is_lifestyle, lifestyle_area_id: plan.lifestyle_area_id });
                            setEditOpen(false);
                            setEditing(null);
                            load();
                          }}
                          submitLabel="Save"
                        />
                      </DialogContent>
                    </Dialog>
                    <Button
                      variant="ghost" size="icon"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={async () => { await deletePlan(plan.id); load(); }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {open && <TaskList planId={plan.id} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
