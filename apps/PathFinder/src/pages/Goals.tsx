import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, CheckCircle, Archive, RotateCcw, X } from "lucide-react";
import { getGoals, createGoal, updateGoal, deleteGoal, getGoalGroups, createGoalGroup, updateGoalGroup, deleteGoalGroup } from "../lib/api";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Progress } from "../components/ui/progress";
import { Dialog, DialogTrigger, DialogContent, DialogClose } from "../components/ui/dialog";
import { PriorityDot } from "../components/PriorityDot";
import { daysUntil, deadlineLabel, deadlineVariant, cn } from "../lib/utils";
import type { Goal, GoalGroup, GoalStatus, Priority } from "../types";

// ── Color palette ──────────────────────────────────────────────────────────────

const GROUP_COLORS: { name: string; label: string; bg: string; text: string; ring: string }[] = [
  { name: "slate",  label: "Slate",  bg: "bg-slate-500/15",  text: "text-slate-600 dark:text-slate-400",  ring: "ring-slate-400/60" },
  { name: "red",    label: "Red",    bg: "bg-red-500/15",    text: "text-red-600 dark:text-red-400",      ring: "ring-red-400/60" },
  { name: "orange", label: "Orange", bg: "bg-orange-500/15", text: "text-orange-600 dark:text-orange-400",ring: "ring-orange-400/60" },
  { name: "yellow", label: "Yellow", bg: "bg-yellow-400/15", text: "text-yellow-600 dark:text-yellow-400",ring: "ring-yellow-400/60" },
  { name: "green",  label: "Green",  bg: "bg-green-500/15",  text: "text-green-600 dark:text-green-400",  ring: "ring-green-400/60" },
  { name: "teal",   label: "Teal",   bg: "bg-teal-500/15",   text: "text-teal-600 dark:text-teal-400",    ring: "ring-teal-400/60" },
  { name: "blue",   label: "Blue",   bg: "bg-blue-500/15",   text: "text-blue-600 dark:text-blue-400",    ring: "ring-blue-400/60" },
  { name: "purple", label: "Purple", bg: "bg-purple-500/15", text: "text-purple-600 dark:text-purple-400",ring: "ring-purple-400/60" },
  { name: "pink",   label: "Pink",   bg: "bg-pink-500/15",   text: "text-pink-600 dark:text-pink-400",    ring: "ring-pink-400/60" },
];

function colorFor(name: string | null) {
  return GROUP_COLORS.find((c) => c.name === name) ?? GROUP_COLORS[0];
}

// ── Status filter tabs ─────────────────────────────────────────────────────────

const STATUS_FILTERS: { id: GoalStatus | "all"; label: string }[] = [
  { id: "all",       label: "All" },
  { id: "active",    label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "archived",  label: "Archived" },
];

// ── Group manager dialog ───────────────────────────────────────────────────────

function GroupManager({ groups, onClose, onRefresh }: {
  groups: GoalGroup[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [newName,  setNewName]  = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [editId,   setEditId]   = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("blue");

  const handleAdd = async () => {
    const n = newName.trim();
    if (!n) return;
    await createGoalGroup(n, newColor);
    setNewName("");
    setNewColor("blue");
    onRefresh();
  };

  const startEdit = (g: GoalGroup) => { setEditId(g.id); setEditName(g.name); setEditColor(g.color); };
  const commitEdit = async () => {
    if (editId == null || !editName.trim()) return;
    await updateGoalGroup(editId, editName.trim(), editColor);
    setEditId(null);
    onRefresh();
  };

  return (
    <div className="flex flex-col gap-3 mt-2">
      {/* Existing groups */}
      {groups.length === 0 && (
        <p className="text-xs text-muted-foreground italic">No groups yet.</p>
      )}
      <div className="flex flex-col gap-1.5">
        {groups.map((g) => {
          const col = colorFor(g.color);
          return editId === g.id ? (
            <div key={g.id} className="flex items-center gap-2">
              <input
                autoFocus
                className="flex-1 h-7 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditId(null); }}
              />
              <ColorPicker value={editColor} onChange={setEditColor} />
              <button onClick={commitEdit} className="text-primary hover:text-primary/80 text-xs font-medium">Save</button>
              <button onClick={() => setEditId(null)} className="text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <div key={g.id} className="flex items-center gap-2 group">
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", col.bg, col.text)}>{g.name}</span>
              <span className="flex-1" />
              <button onClick={() => startEdit(g)} className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-opacity">
                <Pencil className="h-3 w-3" />
              </button>
              <button
                onClick={async () => { await deleteGoalGroup(g.id); onRefresh(); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Add new */}
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <input
          className="flex-1 h-7 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          placeholder="New group name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <ColorPicker value={newColor} onChange={setNewColor} />
        <button onClick={handleAdd} className="text-primary hover:text-primary/80">
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex justify-end mt-1">
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex gap-1">
      {GROUP_COLORS.map((c) => (
        <button
          key={c.name}
          type="button"
          title={c.label}
          onClick={() => onChange(c.name)}
          className={cn(
            "h-4 w-4 rounded-full border-2 transition-all",
            c.bg.replace("/15", ""),
            value === c.name ? "border-foreground scale-110" : "border-transparent opacity-60 hover:opacity-100"
          )}
        />
      ))}
    </div>
  );
}

// ── Goal form ──────────────────────────────────────────────────────────────────

interface GoalFormState {
  title: string;
  description: string;
  deadline: string;
  priority: Priority;
  group_id: number | null;
}

const emptyForm: GoalFormState = { title: "", description: "", deadline: "", priority: "medium", group_id: null };

function GoalForm({ initial = emptyForm, groups, onSubmit, submitLabel }: {
  initial?: GoalFormState;
  groups: GoalGroup[];
  onSubmit: (data: GoalFormState) => Promise<void>;
  submitLabel: string;
}) {
  const [form, setForm] = useState<GoalFormState>(initial);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setLoading(true);
    try { await onSubmit(form); } finally { setLoading(false); }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 mt-2">
      <Input placeholder="Goal title" value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
      <Textarea placeholder="Description (optional)" value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Priority</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.priority}
            onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as Priority }))}
          >
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Deadline</label>
          <Input type="date" value={form.deadline}
            onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
        </div>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Group</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.group_id ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, group_id: e.target.value ? Number(e.target.value) : null }))}
          >
            <option value="">— No group —</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-1">
        <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// ── Goals page ─────────────────────────────────────────────────────────────────

export function Goals() {
  const [goals,       setGoals]       = useState<Goal[]>([]);
  const [groups,      setGroups]      = useState<GoalGroup[]>([]);
  const [statusFilter, setStatusFilter] = useState<GoalStatus | "all">("active");
  const [groupFilter,  setGroupFilter]  = useState<number | null>(null);
  const [editing,     setEditing]     = useState<Goal | null>(null);
  const [createOpen,  setCreateOpen]  = useState(false);
  const [editOpen,    setEditOpen]    = useState(false);
  const [groupsOpen,  setGroupsOpen]  = useState(false);

  const loadGroups = useCallback(() => getGoalGroups().then(setGroups), []);
  const load = useCallback(async () => {
    await Promise.all([getGoals().then(setGoals), loadGroups()]);
  }, [loadGroups]);

  useEffect(() => { load(); }, [load]);

  const filtered = goals
    .filter((g) => statusFilter === "all" || g.status === statusFilter)
    .filter((g) => groupFilter === null || g.group_id === groupFilter);

  async function handleCreate(form: GoalFormState) {
    await createGoal({ title: form.title, description: form.description || null, deadline: form.deadline || null, priority: form.priority, group_id: form.group_id });
    setCreateOpen(false);
    load();
  }

  async function handleUpdate(form: GoalFormState) {
    if (!editing) return;
    await updateGoal(editing.id, { title: form.title, description: form.description || null, deadline: form.deadline || null, status: editing.status, priority: form.priority, group_id: form.group_id });
    setEditOpen(false);
    setEditing(null);
    load();
  }

  async function handleStatusChange(goal: Goal, status: GoalStatus) {
    await updateGoal(goal.id, { title: goal.title, description: goal.description, deadline: goal.deadline, status, priority: goal.priority, group_id: goal.group_id });
    load();
  }

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-foreground">Goals</h1>
        <div className="flex items-center gap-2">
          {/* Manage groups */}
          <Dialog open={groupsOpen} onOpenChange={(o) => { setGroupsOpen(o); if (!o) load(); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">Groups</Button>
            </DialogTrigger>
            <DialogContent title="Manage Groups">
              <GroupManager groups={groups} onClose={() => setGroupsOpen(false)} onRefresh={loadGroups} />
            </DialogContent>
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-3.5 w-3.5" /> New Goal</Button>
            </DialogTrigger>
            <DialogContent title="New Goal" description="Define something you want to achieve.">
              <GoalForm groups={groups} onSubmit={handleCreate} submitLabel="Create" />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
        {/* Status toggles */}
        <div className="flex gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={cn(
                "px-3 py-1 text-xs rounded-md font-medium transition-colors",
                statusFilter === f.id ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {f.label}
              <span className="ml-1 opacity-60">
                {f.id === "all" ? goals.length : goals.filter((g) => g.status === f.id).length}
              </span>
            </button>
          ))}
        </div>

        {/* Group toggles */}
        {groups.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            <div className="w-px h-4 bg-border self-center mx-1" />
            <button
              onClick={() => setGroupFilter(null)}
              className={cn(
                "px-3 py-1 text-xs rounded-full font-medium border transition-colors",
                groupFilter === null
                  ? "bg-foreground text-background border-foreground"
                  : "text-muted-foreground border-border hover:text-foreground"
              )}
            >
              All groups
            </button>
            {groups.map((g) => {
              const col = colorFor(g.color);
              const active = groupFilter === g.id;
              return (
                <button
                  key={g.id}
                  onClick={() => setGroupFilter(active ? null : g.id)}
                  className={cn(
                    "px-3 py-1 text-xs rounded-full font-medium border transition-colors",
                    active
                      ? cn("border-transparent ring-2", col.bg, col.text, col.ring)
                      : "text-muted-foreground border-border hover:text-foreground"
                  )}
                >
                  {g.name}
                  <span className="ml-1 opacity-60">
                    {goals.filter((goal) => goal.group_id === g.id).length}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Goal cards */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No goals here. {statusFilter === "active" && groupFilter === null && "Create one to get started."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {filtered.map((goal) => {
            const pct  = goal.task_count === 0 ? 0 : Math.round((goal.done_count / goal.task_count) * 100);
            const days = goal.deadline ? daysUntil(goal.deadline) : null;
            const col  = goal.group_color ? colorFor(goal.group_color) : null;

            return (
              <div key={goal.id} className="rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
                {/* Header */}
                <div className="flex items-start gap-2">
                  <PriorityDot priority={goal.priority} className="mt-1.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-medium text-foreground truncate">{goal.title}</span>
                      {col && goal.group_name && (
                        <span className={cn("text-xs px-1.5 py-0.5 rounded-full shrink-0 font-medium", col.bg, col.text)}>
                          {goal.group_name}
                        </span>
                      )}
                    </div>
                    {goal.description && (
                      <span className="text-xs text-muted-foreground line-clamp-2 mt-0.5">{goal.description}</span>
                    )}
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    {goal.status === "completed" && <Badge variant="success">Done</Badge>}
                    {goal.status === "archived"  && <Badge variant="outline">Archived</Badge>}
                    {days !== null && <Badge variant={deadlineVariant(days)}>{deadlineLabel(days)}</Badge>}
                  </div>
                </div>

                {/* Progress */}
                {goal.task_count > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{goal.done_count} of {goal.task_count} tasks done</span>
                      <span>{pct}%</span>
                    </div>
                    <Progress value={goal.done_count} max={goal.task_count} />
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-0.5 pt-1 border-t border-border">
                  {goal.status === "active" && (
                    <>
                      <Button variant="ghost" size="icon" title="Complete" onClick={() => handleStatusChange(goal, "completed")}>
                        <CheckCircle className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" title="Archive" onClick={() => handleStatusChange(goal, "archived")}>
                        <Archive className="h-4 w-4" />
                      </Button>
                    </>
                  )}
                  {goal.status !== "active" && (
                    <Button variant="ghost" size="icon" title="Reactivate" onClick={() => handleStatusChange(goal, "active")}>
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                  )}
                  <Dialog open={editOpen && editing?.id === goal.id} onOpenChange={(o) => { setEditOpen(o); if (!o) setEditing(null); }}>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => { setEditing(goal); setEditOpen(true); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent title="Edit Goal">
                      <GoalForm
                        groups={groups}
                        initial={{ title: goal.title, description: goal.description ?? "", deadline: goal.deadline ?? "", priority: goal.priority, group_id: goal.group_id }}
                        onSubmit={handleUpdate}
                        submitLabel="Save"
                      />
                    </DialogContent>
                  </Dialog>
                  <Button variant="ghost" size="icon" className="ml-auto text-muted-foreground hover:text-destructive"
                    onClick={() => { deleteGoal(goal.id); load(); }}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
