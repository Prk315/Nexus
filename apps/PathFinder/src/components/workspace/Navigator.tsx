import { useEffect, useMemo, useState, useCallback } from "react";
import {
  Plus, Pencil, Trash2, ChevronRight, ChevronDown, Target, FolderKanban,
  CheckCircle, Archive, RotateCcw, Inbox, ListTree,
} from "lucide-react";
import {
  getGoals, createGoal, updateGoal, deleteGoal,
  getGoalGroups, getPlans, createPlan, updatePlan, deletePlan,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent } from "../ui/dialog";
import { cn } from "../../lib/utils";
import type { Goal, GoalGroup, GoalStatus, Plan } from "../../types";
import { colorFor, GroupManager, GoalForm, type GoalFormState } from "./goalForms";

export type Selection =
  | { kind: "all" }
  | { kind: "goal"; id: number }
  | { kind: "plan"; id: number };

// ── Plan form ─────────────────────────────────────────────────────────────────
interface PlanFormState { title: string; description: string; deadline: string; goal_id: number | null; tags: string; }

function PlanForm({ initial, goals, submitLabel, onSubmit, onClose }: {
  initial: PlanFormState;
  goals: Goal[];
  submitLabel: string;
  onSubmit: (data: PlanFormState) => Promise<void>;
  onClose: () => void;
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
      <Input autoFocus placeholder="Plan title" value={form.title}
        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} required />
      <Textarea placeholder="Description (optional)" value={form.description}
        onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Goal</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.goal_id ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, goal_id: e.target.value ? Number(e.target.value) : null }))}
          >
            <option value="">— No goal —</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Deadline</label>
          <Input type="date" value={form.deadline}
            onChange={(e) => setForm((f) => ({ ...f, deadline: e.target.value }))} />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Tags <span className="opacity-60">(comma separated)</span></label>
        <Input placeholder="e.g. urgent, q3" value={form.tags}
          onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}

// ── Small row helpers ─────────────────────────────────────────────────────────
function RowButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
    >
      {children}
    </button>
  );
}

export function Navigator({ selection, onSelect, onDataChange }: {
  selection: Selection;
  onSelect: (s: Selection) => void;
  onDataChange: () => void; // notify parent so the task board reloads
}) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [groups, setGroups] = useState<GoalGroup[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showAll, setShowAll] = useState(false); // false → active goals only

  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedGoals, setExpandedGoals] = useState<Set<number>>(new Set());

  const [createGoalOpen, setCreateGoalOpen] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [planDialog, setPlanDialog] = useState<{ mode: "add"; goalId: number | null } | { mode: "edit"; plan: Plan } | null>(null);

  const load = useCallback(async () => {
    const [g, gr, p] = await Promise.all([getGoals(), getGoalGroups(), getPlans()]);
    setGoals(g); setGroups(gr); setPlans(p);
  }, []);
  useEffect(() => { load(); }, [load]);

  const refresh = async () => { await load(); onDataChange(); };

  // Plans that hold tasks (exclude schedule/course containers).
  const taskPlans = useMemo(() => plans.filter((p) => !p.is_schedule && !p.is_course), [plans]);
  const plansByGoal = useMemo(() => {
    const m = new Map<number | null, Plan[]>();
    for (const p of taskPlans) {
      const k = p.goal_id ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(p);
    }
    return m;
  }, [taskPlans]);

  const visibleGoals = useMemo(
    () => goals.filter((g) => showAll || g.status === "active"),
    [goals, showAll],
  );
  const goalsByGroup = useMemo(() => {
    const m = new Map<number | null, Goal[]>();
    for (const g of visibleGoals) {
      const k = g.group_id ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    }
    return m;
  }, [visibleGoals]);
  const orphanPlans = plansByGoal.get(null) ?? [];

  const toggleGroup = (key: string) =>
    setExpandedGroups((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const toggleGoal = (id: number) =>
    setExpandedGoals((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Mutations ────────────────────────────────────────────────────────────────
  const saveNewGoal = async (f: GoalFormState) => {
    await createGoal({ title: f.title.trim(), description: f.description || null, deadline: f.deadline || null, priority: f.priority, group_id: f.group_id });
    setCreateGoalOpen(false); refresh();
  };
  const saveEditGoal = async (f: GoalFormState) => {
    if (!editGoal) return;
    await updateGoal(editGoal.id, { title: f.title.trim(), description: f.description || null, deadline: f.deadline || null, status: f.status, priority: f.priority, group_id: f.group_id });
    setEditGoal(null); refresh();
  };
  const changeStatus = async (g: Goal, status: GoalStatus) => {
    await updateGoal(g.id, { title: g.title, description: g.description, deadline: g.deadline, status, priority: g.priority, group_id: g.group_id });
    refresh();
  };
  const removeGoal = async (g: Goal) => { await deleteGoal(g.id); if (selection.kind === "goal" && selection.id === g.id) onSelect({ kind: "all" }); refresh(); };

  const savePlan = async (f: PlanFormState) => {
    const tags = f.tags.trim() || null;
    if (planDialog?.mode === "edit") {
      const p = planDialog.plan;
      await updatePlan(p.id, { goal_id: f.goal_id, title: f.title.trim(), description: f.description || null, deadline: f.deadline || null, status: p.status, tags });
    } else {
      await createPlan({ goal_id: f.goal_id, title: f.title.trim(), description: f.description || null, deadline: f.deadline || null, tags });
    }
    setPlanDialog(null); refresh();
  };
  const removePlan = async (p: Plan) => { await deletePlan(p.id); if (selection.kind === "plan" && selection.id === p.id) onSelect({ kind: "all" }); refresh(); };

  // ── Render helpers ───────────────────────────────────────────────────────────
  const GoalNode = (g: Goal) => {
    const gplans = plansByGoal.get(g.id) ?? [];
    const expanded = expandedGoals.has(g.id);
    const selected = selection.kind === "goal" && selection.id === g.id;
    const pct = g.task_count === 0 ? 0 : Math.round((g.done_count / g.task_count) * 100);
    return (
      <div key={g.id}>
        <div
          onClick={() => onSelect({ kind: "goal", id: g.id })}
          className={cn(
            "group flex items-center gap-1 rounded-md pl-1 pr-1.5 py-1 cursor-pointer text-sm",
            selected ? "bg-secondary text-foreground" : "hover:bg-secondary/50 text-foreground/90",
          )}
        >
          <button
            onClick={(e) => { e.stopPropagation(); toggleGoal(g.id); }}
            className={cn("shrink-0 text-muted-foreground", gplans.length === 0 && "invisible")}
          >
            {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          <Target className={cn("h-3.5 w-3.5 shrink-0", g.status === "active" ? "text-violet-500" : "text-muted-foreground/50")} />
          <span className={cn("flex-1 truncate", g.status !== "active" && "text-muted-foreground opacity-70")}>{g.title}</span>
          {g.task_count > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{pct}%</span>
          )}
          <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
            {g.status === "active" ? (
              <>
                <RowButton title="Complete" onClick={() => changeStatus(g, "completed")}><CheckCircle className="h-3 w-3" /></RowButton>
                <RowButton title="Archive" onClick={() => changeStatus(g, "archived")}><Archive className="h-3 w-3" /></RowButton>
              </>
            ) : (
              <RowButton title="Reactivate" onClick={() => changeStatus(g, "active")}><RotateCcw className="h-3 w-3" /></RowButton>
            )}
            <RowButton title="Add plan" onClick={() => setPlanDialog({ mode: "add", goalId: g.id })}><Plus className="h-3 w-3" /></RowButton>
            <RowButton title="Edit goal" onClick={() => setEditGoal(g)}><Pencil className="h-3 w-3" /></RowButton>
            <RowButton title="Delete goal" onClick={() => removeGoal(g)}><Trash2 className="h-3 w-3" /></RowButton>
          </span>
        </div>
        {expanded && gplans.map((p) => PlanNode(p))}
      </div>
    );
  };

  const PlanNode = (p: Plan) => {
    const selected = selection.kind === "plan" && selection.id === p.id;
    return (
      <div
        key={p.id}
        onClick={() => onSelect({ kind: "plan", id: p.id })}
        className={cn(
          "group flex items-center gap-1.5 rounded-md pl-7 pr-1.5 py-1 cursor-pointer text-sm",
          selected ? "bg-secondary text-foreground" : "hover:bg-secondary/50 text-foreground/80",
        )}
      >
        <FolderKanban className="h-3.5 w-3.5 shrink-0 text-blue-500/80" />
        <span className="flex-1 truncate">{p.title}</span>
        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{p.done_count}/{p.task_count}</span>
        <span className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <RowButton title="Edit plan" onClick={() => setPlanDialog({ mode: "edit", plan: p })}><Pencil className="h-3 w-3" /></RowButton>
          <RowButton title="Delete plan" onClick={() => removePlan(p)}><Trash2 className="h-3 w-3" /></RowButton>
        </span>
      </div>
    );
  };

  const ungrouped = goalsByGroup.get(null) ?? [];

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="shrink-0 flex items-center gap-1 px-3 py-3 border-b border-border">
        <ListTree className="h-4 w-4 text-violet-500" />
        <span className="text-sm font-semibold text-foreground">Navigator</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowAll((v) => !v)}
          title={showAll ? "Showing all goals" : "Showing active goals"}
          className={cn("h-6 px-1.5 text-[10px] font-medium rounded border transition-colors",
            showAll ? "border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground")}
        >
          {showAll ? "All" : "Active"}
        </button>
        <RowButton title="Manage groups" onClick={() => setGroupsOpen(true)}><FolderKanban className="h-3.5 w-3.5" /></RowButton>
        <RowButton title="New goal" onClick={() => setCreateGoalOpen(true)}><Plus className="h-4 w-4" /></RowButton>
      </div>

      {/* Tree */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
        {/* All tasks */}
        <button
          onClick={() => onSelect({ kind: "all" })}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium",
            selection.kind === "all" ? "bg-secondary text-foreground" : "text-foreground/80 hover:bg-secondary/50",
          )}
        >
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" /> All tasks
        </button>

        <div className="h-px bg-border my-1" />

        {/* Groups → goals → plans */}
        {groups.map((grp) => {
          const gs = goalsByGroup.get(grp.id) ?? [];
          if (gs.length === 0) return null;
          const key = `grp-${grp.id}`;
          const expanded = !expandedGroups.has(key); // default expanded
          const col = colorFor(grp.color);
          return (
            <div key={grp.id}>
              <button
                onClick={() => toggleGroup(key)}
                className="w-full flex items-center gap-1 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
              >
                {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className={cn("px-1.5 py-0.5 rounded-full", col.bg, col.text)}>{grp.name}</span>
                <span className="opacity-50">{gs.length}</span>
              </button>
              {expanded && <div className="flex flex-col gap-0.5">{gs.map((g) => GoalNode(g))}</div>}
            </div>
          );
        })}

        {/* Ungrouped goals */}
        {ungrouped.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-1">
            {groups.length > 0 && <div className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">Ungrouped</div>}
            {ungrouped.map((g) => GoalNode(g))}
          </div>
        )}

        {/* Plans with no goal */}
        {orphanPlans.length > 0 && (
          <div className="flex flex-col gap-0.5 mt-2">
            <div className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">No goal</div>
            {orphanPlans.map((p) => PlanNode(p))}
          </div>
        )}

        <div className="pt-2">
          <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground" onClick={() => setPlanDialog({ mode: "add", goalId: null })}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New plan
          </Button>
        </div>
      </div>

      {/* Dialogs */}
      {createGoalOpen && (
        <Dialog open onOpenChange={(o) => { if (!o) setCreateGoalOpen(false); }}>
          <DialogContent title="New goal">
            <GoalForm groups={groups} submitLabel="Create" onSubmit={saveNewGoal} onClose={() => setCreateGoalOpen(false)}
              initial={{ title: "", description: "", deadline: "", priority: "medium", group_id: null, status: "active" }} />
          </DialogContent>
        </Dialog>
      )}
      {editGoal && (
        <Dialog open onOpenChange={(o) => { if (!o) setEditGoal(null); }}>
          <DialogContent title="Edit goal">
            <GoalForm groups={groups} showStatus submitLabel="Save" onSubmit={saveEditGoal} onClose={() => setEditGoal(null)}
              initial={{ title: editGoal.title, description: editGoal.description ?? "", deadline: editGoal.deadline ?? "", priority: editGoal.priority, group_id: editGoal.group_id, status: editGoal.status }} />
          </DialogContent>
        </Dialog>
      )}
      {groupsOpen && (
        <Dialog open onOpenChange={(o) => { if (!o) { setGroupsOpen(false); refresh(); } }}>
          <DialogContent title="Manage groups">
            <GroupManager groups={groups} onClose={() => { setGroupsOpen(false); refresh(); }} onRefresh={load} />
          </DialogContent>
        </Dialog>
      )}
      {planDialog && (
        <Dialog open onOpenChange={(o) => { if (!o) setPlanDialog(null); }}>
          <DialogContent title={planDialog.mode === "edit" ? "Edit plan" : "New plan"}>
            <PlanForm
              goals={visibleGoals}
              submitLabel={planDialog.mode === "edit" ? "Save" : "Create"}
              onSubmit={savePlan}
              onClose={() => setPlanDialog(null)}
              initial={planDialog.mode === "edit"
                ? { title: planDialog.plan.title, description: planDialog.plan.description ?? "", deadline: planDialog.plan.deadline ?? "", goal_id: planDialog.plan.goal_id, tags: planDialog.plan.tags ?? "" }
                : { title: "", description: "", deadline: "", goal_id: planDialog.goalId, tags: "" }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
