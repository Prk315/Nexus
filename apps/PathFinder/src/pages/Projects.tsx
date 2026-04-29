import { useEffect, useState, useCallback } from "react";
import {
  Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight,
  ChevronLeft, Calendar, MoreHorizontal, FolderOpen, Target, ListTodo,
  Columns3, GitBranch, Map, Maximize2, Minimize2, PanelLeftClose, PanelLeftOpen,
} from "lucide-react";
import {
  getGoals, getPlans, createPlan, updatePlan, deletePlan,
  getTasks, createTask, updateTask, toggleTask, deleteTask,
  setTaskKanbanStatus,
  getProjectGoals, addProjectGoal, toggleProjectGoal, deleteProjectGoal,
  getPipelineTemplates, createPipelineTemplate, deletePipelineTemplate,
  getPipelineRuns, createPipelineRun, togglePipelineRunStep,
  getRoadmapItems, createRoadmapItem, updateRoadmapItem, deleteRoadmapItem, setRoadmapItemStatus,
} from "../lib/api";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { PriorityDot } from "../components/PriorityDot";
import { daysUntil, deadlineLabel, deadlineVariant, cn } from "../lib/utils";
import type { Goal, Plan, Task, Priority, ProjectGoal, PipelineTemplate, PipelineRun, RoadmapItem } from "../types";
import { parseTags, TagChip, serializeTags } from "./Plans";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_OPTS = ["active", "completed", "archived"] as const;
type ProjStatus = (typeof STATUS_OPTS)[number];

const STATUS_STYLE: Record<ProjStatus, string> = {
  active:    "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-400/30",
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-400/30",
  archived:  "bg-muted text-muted-foreground border-border",
};

const PRIORITY_OPTS: Priority[] = ["high", "medium", "low"];

const KANBAN_COLS: { id: string; label: string }[] = [
  { id: "backlog",     label: "Backlog" },
  { id: "in_progress", label: "In Progress" },
  { id: "done",        label: "Done" },
];

// ── Field / input helpers ──────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}

const inputCls = "h-8 rounded-md border border-input bg-transparent px-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-full";
const textareaCls = "rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring resize-none w-full";

// ── Project Form ──────────────────────────────────────────────────────────────

interface ProjectForm {
  title: string; description: string; deadline: string;
  status: ProjStatus; tags: string;
}

function ProjectFormPanel({
  initial, goals, onSave, onCancel,
}: {
  initial?: Plan; goals: Goal[];
  onSave: (f: ProjectForm, goalId: number | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProjectForm>({
    title:       initial?.title       ?? "",
    description: initial?.description ?? "",
    deadline:    initial?.deadline    ?? "",
    status:      (initial?.status as ProjStatus) ?? "active",
    tags:        initial?.tags        ?? "",
  });
  const [goalId, setGoalId] = useState<number | null>(initial?.goal_id ?? null);
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<ProjectForm>) => setForm((f) => ({ ...f, ...p }));

  async function handleSave() {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    try { await onSave(form, goalId); } finally { setSaving(false); }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-semibold">{initial ? "Edit project" : "New project"}</h3>

      <Field label="Title">
        <input autoFocus className={inputCls} placeholder="Project name"
          value={form.title} onChange={(e) => set({ title: e.target.value })}
          onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") onCancel(); }}
        />
      </Field>

      <Field label="Description">
        <textarea className={textareaCls} rows={2} placeholder="What is this project about?"
          value={form.description} onChange={(e) => set({ description: e.target.value })} />
      </Field>

      <div className="flex gap-2">
        <Field label="Deadline">
          <input type="date" className={inputCls} value={form.deadline} onChange={(e) => set({ deadline: e.target.value })} />
        </Field>
        <Field label="Status">
          <select className={inputCls} value={form.status} onChange={(e) => set({ status: e.target.value as ProjStatus })}>
            {STATUS_OPTS.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
          </select>
        </Field>
      </div>

      <Field label="Tags (comma-separated)">
        <input className={inputCls} placeholder="design, backend, v2…" value={form.tags} onChange={(e) => set({ tags: e.target.value })} />
      </Field>

      {goals.length > 0 && (
        <Field label="Linked goal (optional)">
          <select className={inputCls} value={goalId ?? ""} onChange={(e) => setGoalId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">— none —</option>
            {goals.filter((g) => g.status === "active").map((g) => (
              <option key={g.id} value={g.id}>{g.title}</option>
            ))}
          </select>
        </Field>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button disabled={!form.title.trim() || saving} onClick={handleSave}
          className="flex-1 h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
          {initial ? "Save changes" : "Create project"}
        </button>
        <button onClick={onCancel} className="h-8 px-3 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground transition-colors">
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Tab: Overview (purpose / problem / solution) ───────────────────────────────

// ── Roadmap Section ───────────────────────────────────────────────────────────

type RoadmapStatus = "planned" | "in_progress" | "done";

const STATUS_CYCLE: Record<RoadmapStatus, RoadmapStatus> = {
  planned: "in_progress", in_progress: "done", done: "planned",
};
const STATUS_DOT: Record<RoadmapStatus, string> = {
  planned:     "border-2 border-muted-foreground/40 bg-card hover:border-muted-foreground",
  in_progress: "bg-blue-500 border-blue-500",
  done:        "bg-emerald-500 border-emerald-500",
};
const STATUS_LABEL: Record<RoadmapStatus, string> = {
  planned: "Planned", in_progress: "In Progress", done: "Done",
};
const STATUS_BADGE: Record<RoadmapStatus, string> = {
  planned:     "bg-muted text-muted-foreground border-border",
  in_progress: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-400/30",
  done:        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-400/30",
};

function RoadmapSection({ planId }: { planId: number }) {
  const [items,     setItems]     = useState<RoadmapItem[]>([]);
  const [adding,    setAdding]    = useState(false);
  const [newTitle,  setNewTitle]  = useState("");
  const [newDate,   setNewDate]   = useState("");
  const [newDesc,   setNewDesc]   = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDate,  setEditDate]  = useState("");
  const [editDesc,  setEditDesc]  = useState("");
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setItems(await getRoadmapItems(planId));
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  const cycleStatus = async (item: RoadmapItem) => {
    const next = STATUS_CYCLE[item.status as RoadmapStatus] ?? "planned";
    const updated = await setRoadmapItemStatus(item.id, next);
    setItems((prev) => prev.map((x) => x.id === item.id ? updated : x));
  };

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    const item = await createRoadmapItem({
      plan_id: planId, title: newTitle.trim(),
      description: newDesc.trim() || null, due_date: newDate || null,
    });
    setItems((prev) => [...prev, item]);
    setNewTitle(""); setNewDate(""); setNewDesc(""); setAdding(false);
  };

  const startEdit = (item: RoadmapItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditDate(item.due_date ?? "");
    setEditDesc(item.description ?? "");
  };

  const submitEdit = async (item: RoadmapItem) => {
    const title = editTitle.trim();
    if (!title) { setEditingId(null); return; }
    const updated = await updateRoadmapItem(item.id, {
      title, description: editDesc.trim() || null, due_date: editDate || null, status: item.status,
    });
    setItems((prev) => prev.map((x) => x.id === item.id ? updated : x));
    setEditingId(null);
  };

  const handleDelete = async (id: number) => {
    await deleteRoadmapItem(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <div className="flex flex-col">
      {items.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground italic mb-3">No milestones yet.</p>
      )}

      {items.map((item, i) => {
        const status = (item.status as RoadmapStatus) ?? "planned";
        const isLast = i === items.length - 1 && !adding;
        const isEditing = editingId === item.id;
        return (
          <div key={item.id} className="flex gap-3 relative">
            {!isLast && (
              <div className="absolute left-[8px] top-5 bottom-0 w-px bg-border" />
            )}
            {/* Status dot — click to advance */}
            <button
              onClick={() => cycleStatus(item)}
              title={`${STATUS_LABEL[status]} — click to advance`}
              className={cn(
                "mt-0.5 w-[17px] h-[17px] rounded-full shrink-0 z-10 flex items-center justify-center transition-all",
                STATUS_DOT[status]
              )}
            >
              {status === "done" && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
            </button>

            <div
              className="flex-1 pb-4 min-w-0"
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              {isEditing ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") submitEdit(item); if (e.key === "Escape") setEditingId(null); }}
                    onBlur={() => submitEdit(item)}
                    className="text-sm bg-input border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-ring w-full"
                  />
                  <div className="flex gap-2">
                    <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)}
                      className="text-xs bg-input border border-border rounded px-2 py-0.5 outline-none" />
                    <input value={editDesc} onChange={(e) => setEditDesc(e.target.value)}
                      placeholder="Description (optional)"
                      className="flex-1 text-xs bg-input border border-border rounded px-2 py-0.5 outline-none" />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      onClick={() => startEdit(item)}
                      className="text-sm font-medium cursor-pointer hover:text-primary transition-colors"
                    >
                      {item.title}
                    </span>
                    {item.due_date && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                        {item.due_date}
                      </span>
                    )}
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded border font-medium", STATUS_BADGE[status])}>
                      {STATUS_LABEL[status]}
                    </span>
                    {hoveredId === item.id && (
                      <button onClick={() => handleDelete(item.id)}
                        className="ml-auto text-muted-foreground hover:text-destructive transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  {item.description && (
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* Add form */}
      {adding ? (
        <div className="flex gap-3">
          <div className="mt-0.5 w-[17px] h-[17px] rounded-full border-2 border-muted-foreground/30 shrink-0" />
          <div className="flex-1 flex flex-col gap-1.5 pb-2">
            <input
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }}
              placeholder="Milestone title…"
              className="text-sm bg-input border border-border rounded px-2 py-0.5 outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="flex gap-2 flex-wrap">
              <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)}
                className="text-xs bg-input border border-border rounded px-2 py-0.5 outline-none" />
              <input value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Description (optional)"
                className="flex-1 min-w-32 text-xs bg-input border border-border rounded px-2 py-0.5 outline-none" />
              <button onClick={handleAdd} disabled={!newTitle.trim()}
                className="text-xs px-2 py-0.5 bg-primary text-primary-foreground rounded disabled:opacity-40 hover:bg-primary/90 transition-colors">
                Add
              </button>
              <button onClick={() => { setAdding(false); setNewTitle(""); setNewDate(""); setNewDesc(""); }}
                className="text-xs text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit mt-1">
          <Plus className="h-3 w-3" /> Add milestone
        </button>
      )}
    </div>
  );
}

// ── Goals Section ─────────────────────────────────────────────────────────────

function GoalsTab({ planId }: { planId: number }) {
  const [goals,   setGoals]   = useState<ProjectGoal[]>([]);
  const [draft,   setDraft]   = useState("");
  const [adding,  setAdding]  = useState(false);

  const load = useCallback(async () => {
    setGoals(await getProjectGoals(planId));
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd() {
    if (!draft.trim()) return;
    const g = await addProjectGoal({ plan_id: planId, title: draft.trim() });
    setGoals((prev) => [...prev, g]);
    setDraft(""); setAdding(false);
  }

  async function handleToggle(id: number) {
    const g = await toggleProjectGoal(id);
    setGoals((prev) => prev.map((x) => x.id === id ? g : x));
  }

  async function handleDelete(id: number) {
    await deleteProjectGoal(id);
    setGoals((prev) => prev.filter((x) => x.id !== id));
  }

  const open = goals.filter((g) => !g.done);
  const done = goals.filter((g) => g.done);

  return (
    <div className="p-6 max-w-xl flex flex-col gap-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        Project Goals
      </p>
      {open.length === 0 && done.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground italic">No goals yet.</p>
      )}
      {[...open, ...done].map((g) => (
        <div key={g.id} className="flex items-center gap-2 group">
          <button
            onClick={() => handleToggle(g.id)}
            className={cn(
              "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors",
              g.done ? "bg-primary border-primary" : "border-border hover:border-primary"
            )}
          >
            {g.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
          </button>
          <span className={cn("flex-1 text-sm", g.done ? "line-through text-muted-foreground" : "text-foreground")}>
            {g.title}
          </span>
          <button onClick={() => handleDelete(g.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}

      {adding ? (
        <div className="flex items-center gap-2">
          <input autoFocus className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Goal title…" value={draft} onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); if (e.key === "Escape") setAdding(false); }} />
          <button onClick={handleAdd} className="h-7 w-7 shrink-0 flex items-center justify-center rounded border border-input text-muted-foreground hover:text-foreground transition-colors">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setAdding(false)} className="h-7 w-7 shrink-0 flex items-center justify-center rounded border border-input text-muted-foreground hover:text-destructive transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
          <Plus className="h-3.5 w-3.5" /> Add goal
        </button>
      )}
    </div>
  );
}

// ── Tab: Kanban ───────────────────────────────────────────────────────────────

function KanbanCard({ task, today, cols, onMove, onToggle, onDelete }: {
  task: Task; today: string; cols: typeof KANBAN_COLS;
  onMove: (status: string) => void; onToggle: () => void; onDelete: () => void;
}) {
  const overdue = task.due_date && task.due_date < today && !task.done;
  const currentIdx = cols.findIndex((c) => c.id === task.kanban_status);
  return (
    <div className="rounded-md border border-border bg-card p-2.5 flex flex-col gap-1.5 group">
      <div className="flex items-start gap-1.5">
        <button onClick={onToggle}
          className={cn(
            "flex h-4 w-4 shrink-0 mt-0.5 items-center justify-center rounded border transition-colors",
            task.done ? "bg-primary border-primary" : "border-border hover:border-primary"
          )}>
          {task.done && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
        </button>
        <span className={cn("flex-1 text-sm leading-snug",
          task.done ? "line-through text-muted-foreground" : overdue ? "text-destructive" : "text-foreground")}>
          {task.title}
        </span>
        <button onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive shrink-0 mt-0.5">
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-center gap-1.5">
        <PriorityDot priority={task.priority} />
        {task.due_date && (
          <span className={cn("text-[10px] tabular-nums", overdue ? "text-destructive" : "text-muted-foreground")}>
            {task.due_date}
          </span>
        )}
        <div className="flex items-center gap-0.5 ml-auto">
          {currentIdx > 0 && (
            <button onClick={() => onMove(cols[currentIdx - 1].id)}
              className="text-[9px] px-1 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors">
              ←
            </button>
          )}
          {currentIdx < cols.length - 1 && (
            <button onClick={() => onMove(cols[currentIdx + 1].id)}
              className="text-[9px] px-1 py-0.5 rounded border border-border text-muted-foreground hover:text-foreground transition-colors">
              →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Kanban Section (stateless — state lives in ProjectDetail) ─────────────────

function KanbanSection({ tasks, today, onMove, onToggle, onDelete, onAdd }: {
  tasks: Task[]; today: string;
  onMove: (id: number, status: string) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onAdd: (title: string, priority: Priority, status: string) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-1">
      {KANBAN_COLS.map((col) => {
        const colTasks = tasks.filter((t) => (t.kanban_status || "backlog") === col.id);
        return (
          <div key={col.id} className="flex flex-col gap-2 w-60 shrink-0">
            <div className="flex items-center justify-between px-0.5">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{col.label}</span>
              <span className="text-[10px] text-muted-foreground">{colTasks.length}</span>
            </div>
            <div className="flex flex-col gap-2">
              {colTasks.map((t) => (
                <KanbanCard key={t.id} task={t} today={today} cols={KANBAN_COLS}
                  onMove={(status) => onMove(t.id, status)}
                  onToggle={() => onToggle(t.id)}
                  onDelete={() => onDelete(t.id)} />
              ))}
              <AddTaskInColumn colId={col.id} onAdd={onAdd} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AddTaskInColumn({ colId, onAdd }: {
  colId: string; onAdd: (title: string, priority: Priority, status: string) => void;
}) {
  const [open,     setOpen]     = useState(false);
  const [draft,    setDraft]    = useState("");
  const [priority, setPriority] = useState<Priority>("medium");

  function commit() {
    if (!draft.trim()) return;
    onAdd(draft.trim(), priority, colId);
    setDraft(""); setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors w-fit">
        <Plus className="h-3 w-3" /> Add task
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border bg-card p-2">
      <input autoFocus
        className="h-7 rounded border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring w-full"
        placeholder="Task title…" value={draft} onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") commit(); if (e.key === "Escape") setOpen(false); }} />
      <div className="flex items-center gap-1">
        <select className="h-6 flex-1 rounded border border-input bg-transparent px-1 text-xs focus:outline-none"
          value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <button onClick={commit} className="h-6 px-2 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
          Add
        </button>
        <button onClick={() => setOpen(false)} className="h-6 w-6 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive transition-colors">
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

// ── Tab: Pipeline ─────────────────────────────────────────────────────────────

function PipelineTab({ planId }: { planId: number }) {
  const [templates, setTemplates] = useState<PipelineTemplate[]>([]);
  const [runs,      setRuns]      = useState<Record<number, PipelineRun[]>>({});
  const [newTitle,  setNewTitle]  = useState("");
  const [adding,    setAdding]    = useState(false);
  const [newRunFor, setNewRunFor] = useState<number | null>(null);
  const [newRunTitle, setNewRunTitle] = useState("");

  const load = useCallback(async () => {
    const t = await getPipelineTemplates(planId);
    setTemplates(t);
  }, [planId]);

  useEffect(() => { load(); }, [load]);

  async function loadRuns(templateId: number) {
    const r = await getPipelineRuns(templateId);
    setRuns((prev) => ({ ...prev, [templateId]: r }));
  }

  async function handleAddTemplate() {
    if (!newTitle.trim()) return;
    const t = await createPipelineTemplate({ plan_id: planId, title: newTitle.trim() });
    setTemplates((prev) => [...prev, t]);
    setNewTitle(""); setAdding(false);
  }

  async function handleDeleteTemplate(id: number) {
    await deletePipelineTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  }

  async function handleAddRun(templateId: number) {
    if (!newRunTitle.trim()) return;
    await createPipelineRun({ template_id: templateId, title: newRunTitle.trim() });
    await loadRuns(templateId);
    setNewRunTitle(""); setNewRunFor(null);
    // refresh template run count
    const t = await getPipelineTemplates(planId);
    setTemplates(t);
  }

  async function handleToggleStep(runId: number, stepId: number, templateId: number) {
    await togglePipelineRunStep(runId, stepId);
    await loadRuns(templateId);
  }

  return (
    <div className="p-6 flex flex-col gap-4 max-w-3xl">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Pipelines</p>
        {!adding && (
          <button onClick={() => setAdding(true)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <Plus className="h-3.5 w-3.5" /> New pipeline
          </button>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
          <input autoFocus
            className="flex-1 h-7 rounded border border-input bg-transparent px-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            placeholder="Pipeline name…" value={newTitle} onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddTemplate(); if (e.key === "Escape") setAdding(false); }} />
          <button onClick={handleAddTemplate}
            className="h-7 px-2 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
            Create
          </button>
          <button onClick={() => setAdding(false)}
            className="h-7 w-7 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {templates.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground italic">No pipelines yet.</p>
      )}

      {templates.map((tmpl) => {
        const tmplRuns = runs[tmpl.id];
        const isExpanded = tmplRuns !== undefined;
        return (
          <div key={tmpl.id} className="rounded-lg border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border">
              <button onClick={() => isExpanded ? setRuns((p) => { const n = { ...p }; delete n[tmpl.id]; return n; }) : loadRuns(tmpl.id)}
                className="flex items-center gap-2 flex-1 min-w-0 text-left">
                {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                <span className="text-sm font-medium truncate">{tmpl.title}</span>
                <span className="text-xs text-muted-foreground shrink-0">{tmpl.steps.length} steps · {tmpl.run_count} runs</span>
              </button>
              <button onClick={() => handleDeleteTemplate(tmpl.id)}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {isExpanded && (
              <div className="overflow-x-auto">
                {tmpl.steps.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-muted-foreground italic">No steps defined. Edit this pipeline in the Study/Courses section to add steps.</p>
                ) : (
                  <table className="w-full text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-3 py-2 text-muted-foreground font-medium w-36 shrink-0">Run</th>
                        {tmpl.steps.map((s) => (
                          <th key={s.id} className="text-center px-2 py-2 text-muted-foreground font-medium max-w-24 truncate" title={s.title}>
                            {s.title}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tmplRuns.map((run) => (
                        <tr key={run.id} className="border-b border-border/50 last:border-0 hover:bg-secondary/30 transition-colors">
                          <td className="px-3 py-1.5 font-medium truncate max-w-36" title={run.title}>{run.title}</td>
                          {tmpl.steps.map((s) => {
                            const rs = run.steps.find((x) => x.step_id === s.id);
                            return (
                              <td key={s.id} className="text-center px-2 py-1.5">
                                <button onClick={() => handleToggleStep(run.id, s.id, tmpl.id)}
                                  className={cn(
                                    "w-5 h-5 rounded-full border flex items-center justify-center mx-auto transition-colors",
                                    rs?.done ? "bg-emerald-500 border-emerald-500 text-white" : "border-border hover:border-primary"
                                  )}>
                                  {rs?.done && <Check className="h-3 w-3" />}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Add run row */}
                <div className="px-3 py-2 border-t border-border/50">
                  {newRunFor === tmpl.id ? (
                    <div className="flex items-center gap-2">
                      <input autoFocus
                        className="flex-1 h-6 rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="Run title…" value={newRunTitle} onChange={(e) => setNewRunTitle(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") handleAddRun(tmpl.id); if (e.key === "Escape") { setNewRunFor(null); setNewRunTitle(""); } }} />
                      <button onClick={() => handleAddRun(tmpl.id)}
                        className="h-6 px-2 rounded bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors">
                        Add
                      </button>
                      <button onClick={() => { setNewRunFor(null); setNewRunTitle(""); }}
                        className="h-6 w-6 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-destructive transition-colors">
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => { setNewRunFor(tmpl.id); setNewRunTitle(""); }}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                      <Plus className="h-3 w-3" /> Add run
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Task Sidebar ──────────────────────────────────────────────────────────────

function TaskSidebar({ tasks, today, onAdd, onToggle, onUpdate, onDelete, collapsed, onToggleCollapse }: {
  tasks: Task[]; today: string;
  onAdd: (title: string, priority: Priority) => void;
  onToggle: (id: number) => void;
  onUpdate: (id: number, title: string, priority: Priority, due_date: string | null) => void;
  onDelete: (id: number) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [showAdd,    setShowAdd]    = useState(false);
  const [newTitle,   setNewTitle]   = useState("");
  const [newPri,     setNewPri]     = useState<Priority>("medium");
  const [newDue,     setNewDue]     = useState("");
  const [editingId,  setEditingId]  = useState<number | null>(null);
  const [editTitle,  setEditTitle]  = useState("");
  const [editPri,    setEditPri]    = useState<Priority>("medium");
  const [editDue,    setEditDue]    = useState("");
  const [showDone,   setShowDone]   = useState(false);
  const [hoveredId,  setHoveredId]  = useState<number | null>(null);

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  function startAdd() { setShowAdd(true); setNewTitle(""); setNewPri("medium"); setNewDue(""); }
  function commitAdd() {
    if (!newTitle.trim()) { setShowAdd(false); return; }
    onAdd(newTitle.trim(), newPri);
    setShowAdd(false);
  }

  function startEdit(t: Task) {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditPri(t.priority);
    setEditDue(t.due_date ?? "");
  }
  function commitEdit() {
    if (editingId === null) return;
    onUpdate(editingId, editTitle.trim() || "Untitled", editPri, editDue || null);
    setEditingId(null);
  }

  const priDot: Record<Priority, string> = {
    high: "bg-red-500", medium: "bg-yellow-500", low: "bg-blue-400",
  };

  function TaskItem({ t }: { t: Task }) {
    const isEditing = editingId === t.id;
    const overdue = t.due_date && t.due_date < today && !t.done;
    if (isEditing) {
      return (
        <div className="flex flex-col gap-1.5 rounded-md border border-ring bg-card/70 p-2">
          <input
            autoFocus
            className="h-7 w-full rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditingId(null); }}
          />
          <div className="flex items-center gap-1.5">
            <select
              className="h-6 rounded border border-input bg-transparent px-1 text-[10px] focus:outline-none"
              value={editPri}
              onChange={(e) => setEditPri(e.target.value as Priority)}>
              {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date"
              className="h-6 flex-1 rounded border border-input bg-transparent px-1 text-[10px] focus:outline-none"
              value={editDue} onChange={(e) => setEditDue(e.target.value)} />
            <button onClick={commitEdit} className="text-primary hover:text-primary/80 transition-colors">
              <Check className="h-3 w-3" />
            </button>
            <button onClick={() => setEditingId(null)} className="text-muted-foreground hover:text-foreground transition-colors">
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      );
    }
    return (
      <div
        className="group flex items-start gap-2 rounded-md px-1.5 py-1 hover:bg-secondary/50 transition-colors cursor-default"
        onMouseEnter={() => setHoveredId(t.id)}
        onMouseLeave={() => setHoveredId(null)}
      >
        <button
          onClick={() => onToggle(t.id)}
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 mt-0.5 items-center justify-center rounded border transition-colors",
            t.done ? "bg-primary border-primary" : "border-border hover:border-primary"
          )}>
          {t.done && <Check className="h-2 w-2 text-primary-foreground" />}
        </button>
        <div className="flex flex-col flex-1 min-w-0 gap-0.5" onClick={() => !t.done && startEdit(t)}>
          <span className={cn(
            "text-xs leading-snug truncate",
            t.done ? "line-through text-muted-foreground" : overdue ? "text-destructive" : "text-foreground"
          )}>
            {t.title}
          </span>
          <div className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", priDot[t.priority])} />
            {t.due_date && (
              <span className={cn("text-[10px] tabular-nums", overdue ? "text-destructive" : "text-muted-foreground")}>
                {t.due_date}
              </span>
            )}
          </div>
        </div>
        {hoveredId === t.id && (
          <button
            onClick={() => onDelete(t.id)}
            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors mt-0.5">
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  if (collapsed) {
    return (
      <div
        className="w-8 shrink-0 border-r border-border flex flex-col items-center overflow-hidden cursor-pointer hover:bg-secondary/30"
        onClick={onToggleCollapse}
        title="Expand task sidebar"
      >
        <PanelLeftOpen className="h-3.5 w-3.5 text-muted-foreground mt-3" />
        <div className="flex-1 flex items-center justify-center">
          <span
            className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
            style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
          >
            Tasks ({open.length})
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col overflow-hidden">
      {/* Sidebar header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <ListTodo className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Tasks</span>
          {open.length > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground">({open.length})</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={startAdd}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Add task">
            <Plus className="h-3 w-3" />
          </button>
          <button
            onClick={onToggleCollapse}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            title="Collapse task sidebar">
            <PanelLeftClose className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="flex flex-col gap-1.5 px-2 py-2 border-b border-border bg-secondary/30 shrink-0">
          <input
            autoFocus
            placeholder="Task title…"
            className="h-7 w-full rounded border border-input bg-transparent px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commitAdd(); if (e.key === "Escape") setShowAdd(false); }}
          />
          <div className="flex items-center gap-1.5">
            <select
              className="h-6 flex-1 rounded border border-input bg-transparent px-1 text-[10px] focus:outline-none"
              value={newPri}
              onChange={(e) => setNewPri(e.target.value as Priority)}>
              {PRIORITY_OPTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <input type="date"
              className="h-6 flex-1 rounded border border-input bg-transparent px-1 text-[10px] focus:outline-none"
              value={newDue} onChange={(e) => setNewDue(e.target.value)} />
          </div>
          <div className="flex gap-1.5">
            <button onClick={commitAdd}
              className="flex-1 h-6 rounded bg-primary text-primary-foreground text-[10px] font-medium hover:bg-primary/90 transition-colors">
              Add
            </button>
            <button onClick={() => setShowAdd(false)}
              className="flex-1 h-6 rounded border border-border text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-1.5 py-2 flex flex-col gap-0.5">
        {open.length === 0 && !showAdd && (
          <p className="text-[11px] text-muted-foreground italic px-1.5">No open tasks.</p>
        )}
        {open.map((t) => <TaskItem key={t.id} t={t} />)}

        {done.length > 0 && (
          <div className="mt-2 flex flex-col gap-0.5">
            <button
              onClick={() => setShowDone((v) => !v)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors px-1 w-fit mb-0.5">
              {showDone ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Done ({done.length})
            </button>
            {showDone && done.map((t) => <TaskItem key={t.id} t={t} />)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Section Block (collapsible) ───────────────────────────────────────────────

function SectionBlock({ title, icon: Icon, open, onToggle, onToggleWidth, fullWidth, children }: {
  title: string; icon: React.ComponentType<{ className?: string }>; open: boolean;
  onToggle: () => void; children: React.ReactNode;
  onToggleWidth?: () => void; fullWidth?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card/50 p-4 h-full">
      <div className="flex items-center gap-2">
        <button
          onClick={onToggle}
          className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors flex-1 min-w-0 text-left"
        >
          <Icon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{title}</span>
          {open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
        </button>
        {onToggleWidth && (
          <button
            onClick={onToggleWidth}
            title={fullWidth ? "Make half-width" : "Make full-width"}
            className="text-muted-foreground/40 hover:text-muted-foreground transition-colors shrink-0"
          >
            {fullWidth ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          </button>
        )}
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Project Detail (single-page sections) ─────────────────────────────────────

function ProjectDetail({
  project, goals, today, onUpdate, onDelete,
}: {
  project: Plan; goals: Goal[]; today: string;
  onUpdate: (p: Plan) => void; onDelete: () => void;
}) {
  const [editing,              setEditing]              = useState(false);
  const [menuOpen,             setMenuOpen]             = useState(false);
  const [tasks,                setTasks]                = useState<Task[]>([]);
  const [taskSidebarCollapsed, setTaskSidebarCollapsed] = useState(false);

  // Section open/closed state
  const [open, setOpen] = useState({
    overview: true, goals: true, kanban: false, pipeline: true,
  });
  const toggle = (k: keyof typeof open) => setOpen((prev) => ({ ...prev, [k]: !prev[k] }));

  // Section width: 2 = full width (col-span-2), 1 = half width (col-span-1)
  const [spans, setSpans] = useState<Record<string, 1 | 2>>({
    overview: 2, goals: 2, kanban: 2, pipeline: 2,
  });
  const toggleSpan = (k: string) =>
    setSpans((prev) => ({ ...prev, [k]: prev[k] === 2 ? 1 : 2 }));

  const loadTasks = useCallback(async () => {
    setTasks(await getTasks(project.id));
  }, [project.id]);

  useEffect(() => { loadTasks(); }, [loadTasks]);

  const doneTasks = tasks.filter((t) => t.done);
  const pct = tasks.length === 0 ? 0 : Math.round((doneTasks.length / tasks.length) * 100);
  const days = project.deadline ? daysUntil(project.deadline) : null;
  const tags = parseTags(project.tags);

  // Task handlers — shared by TasksSection and KanbanSection
  async function handleAddTask(title: string, priority: Priority) {
    const t = await createTask({ plan_id: project.id, title, priority });
    setTasks((prev) => [...prev, t]);
  }
  async function handleToggleTask(id: number) {
    await toggleTask(id);
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, done: !t.done } : t));
  }
  async function handleUpdateTask(id: number, title: string, priority: Priority, due_date: string | null) {
    const updated = await updateTask(id, { title, priority, due_date });
    setTasks((prev) => prev.map((t) => t.id === id ? { ...t, ...updated } : t));
  }
  async function handleDeleteTask(id: number) {
    await deleteTask(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }
  async function handleMoveTask(id: number, status: string) {
    const t = await setTaskKanbanStatus(id, status);
    setTasks((prev) => prev.map((x) => x.id === id ? t : x));
  }
  async function handleAddKanbanTask(title: string, priority: Priority, status: string) {
    const t = await createTask({ plan_id: project.id, title, priority });
    const moved = await setTaskKanbanStatus(t.id, status);
    setTasks((prev) => [...prev, moved]);
  }

  async function handleSaveEdit(form: ProjectForm, goalId: number | null) {
    const updated = await updatePlan(project.id, {
      goal_id: goalId, title: form.title,
      description: form.description || null,
      deadline: form.deadline || null, status: form.status,
      tags: serializeTags(form.tags.split(",").map((s) => s.trim())),
      is_course: false, is_lifestyle: false, lifestyle_area_id: null,
      purpose: null, problem: null, solution: null,
    });
    onUpdate(updated);
    setEditing(false);
  }

  if (editing) {
    return (
      <div className="p-6">
        <ProjectFormPanel initial={project} goals={goals}
          onSave={handleSaveEdit} onCancel={() => setEditing(false)} />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 px-6 py-4 border-b border-border">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 className="text-lg font-semibold text-foreground truncate">{project.title}</h2>
              <span className={cn("text-xs px-2 py-0.5 rounded-full border font-medium", STATUS_STYLE[project.status as ProjStatus])}>
                {project.status}
              </span>
            </div>
            {project.description && (
              <p className="text-sm text-muted-foreground mb-1.5">{project.description}</p>
            )}
            <div className="flex items-center gap-3 flex-wrap">
              {days !== null && (
                <Badge variant={deadlineVariant(days)} className="text-xs gap-1 py-0">
                  <Calendar className="h-3 w-3" />{deadlineLabel(days)}
                </Badge>
              )}
              {tags.map((tag, i) => <TagChip key={tag} tag={tag} index={i} />)}
              {project.goal_id && goals.find((g) => g.id === project.goal_id) && (
                <span className="text-xs text-muted-foreground">↗ {goals.find((g) => g.id === project.goal_id)?.title}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0 relative">
            <button onClick={() => setEditing(true)}
              className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="Edit project">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <div className="relative">
              <button onClick={() => setMenuOpen((o) => !o)}
                className="flex h-7 w-7 items-center justify-center rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-1 z-20 w-36 rounded-lg border border-border bg-popover shadow-lg py-1">
                  <button onClick={async () => { setMenuOpen(false); await deletePlan(project.id); onDelete(); }}
                    className="flex items-center gap-2 w-full px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" /> Delete project
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        {tasks.length > 0 && (
          <div className="flex items-center gap-2 mt-3">
            <Progress value={doneTasks.length} max={tasks.length} className="flex-1 h-1.5" />
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{pct}% · {doneTasks.length}/{tasks.length}</span>
          </div>
        )}
      </div>

      {/* Body: left task sidebar + main sections */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left task sidebar ── */}
        <TaskSidebar
          tasks={tasks} today={today}
          onAdd={handleAddTask} onToggle={handleToggleTask}
          onUpdate={handleUpdateTask} onDelete={handleDeleteTask}
          collapsed={taskSidebarCollapsed}
          onToggleCollapse={() => setTaskSidebarCollapsed((v) => !v)}
        />

        {/* ── Flexible grid — sections can be half or full width ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-2 gap-4 p-6 auto-rows-min">

            <div className={spans.overview === 2 ? "col-span-2" : "col-span-1"}>
              <SectionBlock title="Roadmap" icon={Map} open={open.overview} onToggle={() => toggle("overview")}
                fullWidth={spans.overview === 2} onToggleWidth={() => toggleSpan("overview")}>
                <RoadmapSection planId={project.id} />
              </SectionBlock>
            </div>

            <div className={spans.goals === 2 ? "col-span-2" : "col-span-1"}>
              <SectionBlock title="Goals" icon={Target} open={open.goals} onToggle={() => toggle("goals")}
                fullWidth={spans.goals === 2} onToggleWidth={() => toggleSpan("goals")}>
                <GoalsTab planId={project.id} />
              </SectionBlock>
            </div>

            <div className={spans.kanban === 2 ? "col-span-2" : "col-span-1"}>
              <SectionBlock title="Kanban" icon={Columns3} open={open.kanban} onToggle={() => toggle("kanban")}
                fullWidth={spans.kanban === 2} onToggleWidth={() => toggleSpan("kanban")}>
                <KanbanSection
                  tasks={tasks} today={today}
                  onMove={handleMoveTask} onToggle={handleToggleTask}
                  onDelete={handleDeleteTask} onAdd={handleAddKanbanTask}
                />
              </SectionBlock>
            </div>

            <div className={spans.pipeline === 2 ? "col-span-2" : "col-span-1"}>
              <SectionBlock title="Pipeline" icon={GitBranch} open={open.pipeline} onToggle={() => toggle("pipeline")}
                fullWidth={spans.pipeline === 2} onToggleWidth={() => toggleSpan("pipeline")}>
                <PipelineTab planId={project.id} />
              </SectionBlock>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}

// ── Projects page ─────────────────────────────────────────────────────────────

export function Projects() {
  const [plans,            setPlans]            = useState<Plan[]>([]);
  const [goals,            setGoals]            = useState<Goal[]>([]);
  const [selectedId,       setSelectedId]       = useState<number | null>(null);
  const [creating,         setCreating]         = useState(false);
  const [statusFilter,     setStatusFilter]     = useState<ProjStatus | "all">("active");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    const [p, g] = await Promise.all([getPlans(), getGoals()]);
    setPlans(p); setGoals(g);
  }, []);

  useEffect(() => { load(); }, [load]);

  const projects = plans.filter((p) => !p.is_course && !p.is_lifestyle);
  const filtered = projects.filter((p) => statusFilter === "all" ? true : p.status === statusFilter);
  const selected = projects.find((p) => p.id === selectedId) ?? null;

  async function handleCreate(form: ProjectForm, goalId: number | null) {
    const p = await createPlan({
      goal_id: goalId, title: form.title,
      description: form.description || null, deadline: form.deadline || null,
      tags: serializeTags(form.tags.split(",").map((s) => s.trim())),
      is_course: false, is_lifestyle: false, lifestyle_area_id: null,
      purpose: null, problem: null, solution: null,
    });
    setPlans((prev) => [p, ...prev]);
    setSelectedId(p.id); setCreating(false);
  }

  function handleUpdate(updated: Plan) {
    setPlans((prev) => prev.map((p) => p.id === updated.id ? updated : p));
  }

  function handleDelete() {
    setPlans((prev) => prev.filter((p) => p.id !== selectedId));
    setSelectedId(null);
  }

  return (
    <div className="flex h-[calc(100vh-2.5rem)] overflow-hidden">

      {/* Left sidebar */}
      <div className={cn(
        "shrink-0 flex flex-col border-r border-border overflow-hidden transition-all duration-200",
        sidebarCollapsed ? "w-12" : "w-72"
      )}>
        {sidebarCollapsed ? (
          <div
            className="flex flex-col items-center h-full cursor-pointer hover:bg-secondary/30 transition-colors"
            onClick={() => setSidebarCollapsed(false)}
            title="Expand project sidebar"
          >
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground mt-3" />
            <div className="flex-1 flex items-center justify-center">
              <span
                className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap"
                style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}
              >
                Projects
              </span>
            </div>
            <div className="py-3 flex flex-col items-center gap-2">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(p.id); setCreating(false); setSidebarCollapsed(false); }}
                  title={p.title}
                  className={cn(
                    "w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-[9px] font-bold border transition-colors",
                    selectedId === p.id
                      ? "bg-primary text-primary-foreground border-primary"
                      : `border-border text-muted-foreground hover:border-primary ${STATUS_STYLE[p.status as ProjStatus]}`
                  )}
                >
                  {p.title.charAt(0).toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <>
            <div className="shrink-0 flex items-center gap-2 px-3 py-3 border-b border-border">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex-1">Projects</span>
              <button onClick={() => { setCreating(true); setSelectedId(null); }}
                className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors" title="New project">
                <Plus className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="flex h-6 w-6 items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                title="Collapse sidebar">
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="shrink-0 flex border-b border-border">
              {(["active", "all", "completed", "archived"] as const).map((s) => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={cn(
                    "flex-1 py-1.5 text-[10px] font-medium transition-colors capitalize",
                    statusFilter === s ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
                  )}>
                  {s}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 h-32 text-center px-4">
                  <FolderOpen className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-xs text-muted-foreground">
                    {statusFilter === "active" ? "No active projects." : "Nothing here yet."}
                  </p>
                </div>
              ) : filtered.map((p) => {
                const pct  = p.task_count === 0 ? 0 : Math.round((p.done_count / p.task_count) * 100);
                const days = p.deadline ? daysUntil(p.deadline) : null;
                const tags = parseTags(p.tags);
                return (
                  <button key={p.id} onClick={() => { setSelectedId(p.id); setCreating(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 transition-colors",
                      selectedId === p.id ? "bg-sidebar-accent text-sidebar-accent-foreground" : "hover:bg-sidebar-accent/50"
                    )}>
                    <div className="flex items-start gap-2 mb-1.5">
                      <span className="text-sm font-medium text-foreground truncate flex-1 leading-snug">{p.title}</span>
                      {days !== null && days <= 7 && (
                        <Badge variant={deadlineVariant(days)} className="text-[9px] shrink-0 px-1 py-0">
                          {deadlineLabel(days)}
                        </Badge>
                      )}
                    </div>
                    {p.task_count > 0 && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <Progress value={p.done_count} max={p.task_count} className="flex-1 h-1" />
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{pct}%</span>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className={cn("text-[9px] px-1.5 py-0 rounded-full border font-medium", STATUS_STYLE[p.status as ProjStatus])}>
                        {p.status}
                      </span>
                      {tags.slice(0, 2).map((tag, i) => <TagChip key={tag} tag={tag} index={i} />)}
                      {tags.length > 2 && <span className="text-[9px] text-muted-foreground">+{tags.length - 2}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {creating ? (
          <div className="p-6 max-w-xl">
            <ProjectFormPanel goals={goals} onSave={handleCreate} onCancel={() => setCreating(false)} />
          </div>
        ) : selected ? (
          <ProjectDetail key={selected.id} project={selected} goals={goals} today={today}
            onUpdate={handleUpdate} onDelete={handleDelete} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
            <FolderOpen className="h-12 w-12 opacity-20" />
            <p className="text-sm">Select a project or create a new one</p>
            <button onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 text-sm text-primary hover:underline">
              <Plus className="h-4 w-4" /> New project
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
