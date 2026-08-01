import { useState } from "react";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import { createGoalGroup, updateGoalGroup, deleteGoalGroup } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { cn } from "../../lib/utils";
import type { GoalGroup, GoalStatus, Priority } from "../../types";

// ── Group color palette (shared with the legacy Goals page) ───────────────────
export const GROUP_COLORS: { name: string; label: string; bg: string; text: string; ring: string }[] = [
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

export function colorFor(name: string | null) {
  return GROUP_COLORS.find((c) => c.name === name) ?? GROUP_COLORS[0];
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
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
            value === c.name ? "border-foreground scale-110" : "border-transparent opacity-60 hover:opacity-100",
          )}
        />
      ))}
    </div>
  );
}

export function GroupManager({ groups, onClose, onRefresh }: {
  groups: GoalGroup[];
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("blue");
  const [editId, setEditId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("blue");

  const handleAdd = async () => {
    const n = newName.trim();
    if (!n) return;
    await createGoalGroup(n, newColor);
    setNewName(""); setNewColor("blue");
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
      {groups.length === 0 && <p className="text-xs text-muted-foreground italic">No groups yet.</p>}
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
              <button onClick={async () => { await deleteGoalGroup(g.id); onRefresh(); }}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-border">
        <input
          className="flex-1 h-7 rounded border border-input bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          placeholder="New group name..."
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        />
        <ColorPicker value={newColor} onChange={setNewColor} />
        <button onClick={handleAdd} className="text-primary hover:text-primary/80"><Plus className="h-4 w-4" /></button>
      </div>
      <div className="flex justify-end mt-1"><Button size="sm" onClick={onClose}>Done</Button></div>
    </div>
  );
}

// ── Goal form (create/edit; status shown only when provided) ──────────────────
export interface GoalFormState {
  title: string;
  description: string;
  deadline: string;
  priority: Priority;
  group_id: number | null;
  status: GoalStatus;
}

export function GoalForm({ initial, groups, showStatus, submitLabel, onSubmit, onClose }: {
  initial: GoalFormState;
  groups: GoalGroup[];
  showStatus?: boolean;
  submitLabel: string;
  onSubmit: (data: GoalFormState) => Promise<void>;
  onClose: () => void;
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
      <Input autoFocus placeholder="Goal title" value={form.title}
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
      {showStatus && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Status</label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as GoalStatus }))}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="archived">Archived</option>
          </select>
        </div>
      )}
      <div className="flex justify-end gap-2 mt-1">
        <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={loading}>{submitLabel}</Button>
      </div>
    </form>
  );
}
