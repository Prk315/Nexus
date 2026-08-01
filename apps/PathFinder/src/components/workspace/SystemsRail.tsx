import { useEffect, useState, useCallback } from "react";
import { Plus, Pencil, Trash2, CheckCircle, Flame, Check, RefreshCw, PanelRightClose } from "lucide-react";
import {
  getSystems, createSystem, updateSystem, deleteSystem, markSystemDone,
  getSystemSubtasks, toggleSystemSubtask,
} from "../../lib/api";
import { Button } from "../ui/button";
import { Dialog, DialogContent } from "../ui/dialog";
import { cn } from "../../lib/utils";
import type { SystemEntry, SystemSubtask } from "../../types";
import {
  isDue, frequencyBadge, lastDoneLabel, SystemForm, SubtaskManager,
  systemToForm, formToDaysOfWeek, type SystemFormState,
} from "./systemForms";

const todayDate = () => new Date().toISOString().slice(0, 10);

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
  const doneSubs = subtasks.filter((s) => s.done).length;
  const allSubsDone = hasSubtasks && doneSubs === subtasks.length;

  return (
    <div className={cn("rounded-lg border bg-card p-2.5 flex flex-col gap-2 group", due ? "border-primary/30" : "border-border")}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {due && <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />}
          <span className="text-sm font-medium text-foreground truncate">{sys.title}</span>
        </div>
        {frequencyBadge(sys)}
      </div>

      {hasSubtasks && (
        <div className="flex flex-col gap-1">
          {subtasks.map((sub) => (
            <div key={sub.id} className="flex items-center gap-2">
              <button
                onClick={() => onToggleSubtask(sub.id)}
                className={cn(
                  "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
                  sub.done ? "bg-primary border-primary" : "border-border hover:border-primary",
                )}
              >
                {sub.done && <Check className="h-2 w-2 text-primary-foreground" />}
              </button>
              <span className={cn("text-xs flex-1 truncate", sub.done ? "line-through text-muted-foreground" : "text-foreground")}>
                {sub.title}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {sys.streak_count > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0">
              <Flame className={cn("h-3 w-3", sys.streak_count >= 7 ? "text-orange-500" : sys.streak_count >= 3 ? "text-yellow-500" : "text-muted-foreground")} />
              {sys.streak_count}
            </span>
          )}
          <span className={cn("text-[10px] truncate", due ? "text-primary" : "text-muted-foreground")}>{lastDoneLabel(sys.last_done)}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!hasSubtasks ? (
            <Button variant={due ? "default" : "outline"} size="sm" className="h-6 px-2 text-xs" onClick={onMarkDone}>
              <CheckCircle className="h-3 w-3" />{due ? "Done" : "Again"}
            </Button>
          ) : allSubsDone ? (
            <span className="flex items-center gap-0.5 text-[10px] text-green-600 font-medium"><CheckCircle className="h-3 w-3" />Done</span>
          ) : null}
          <button onClick={onEdit} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-opacity"><Pencil className="h-3 w-3" /></button>
          <button onClick={onDelete} className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-secondary text-muted-foreground hover:text-destructive transition-opacity"><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
    </div>
  );
}

export function SystemsRail({ onCollapse }: { onCollapse?: () => void }) {
  const date = todayDate();
  const [systems, setSystems] = useState<SystemEntry[]>([]);
  const [subtaskMap, setSubtaskMap] = useState<Record<number, SystemSubtask[]>>({});
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SystemEntry | null>(null);

  const loadSubtasks = useCallback(async (list: SystemEntry[]) => {
    const entries = await Promise.all(list.map(async (s) => [s.id, await getSystemSubtasks(s.id, date)] as [number, SystemSubtask[]]));
    setSubtaskMap(Object.fromEntries(entries));
  }, [date]);
  const load = useCallback(async () => {
    const s = await getSystems();
    setSystems(s);
    loadSubtasks(s);
  }, [loadSubtasks]);
  useEffect(() => { load(); }, [load]);

  const toggleSub = async (subtaskId: number, systemId: number) => {
    const result = await toggleSystemSubtask(subtaskId, date);
    setSubtaskMap((prev) => ({ ...prev, [systemId]: result.subtasks }));
    setSystems((prev) => prev.map((s) => s.id === result.system.id ? result.system : s));
  };

  const saveNew = async (f: SystemFormState) => {
    await createSystem({ title: f.title, description: f.description || null, frequency: f.frequency, days_of_week: formToDaysOfWeek(f), start_time: f.start_time || null, end_time: f.end_time || null });
    setCreating(false); load();
  };
  const saveEdit = async (f: SystemFormState) => {
    if (!editing) return;
    await updateSystem(editing.id, { title: f.title, description: f.description || null, frequency: f.frequency, days_of_week: formToDaysOfWeek(f), start_time: f.start_time || null, end_time: f.end_time || null });
    setEditing(null); load();
  };

  const due = systems.filter(isDue);
  const upToDate = systems.filter((s) => !isDue(s));

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 flex items-center gap-1.5 px-3 py-3 border-b border-border">
        <RefreshCw className="h-4 w-4 text-cyan-500" />
        <span className="text-sm font-semibold text-foreground">Systems</span>
        {due.length > 0 && <span className="text-[10px] text-muted-foreground">· {due.length} due</span>}
        <div className="flex-1" />
        <button title="New system" onClick={() => setCreating(true)} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
          <Plus className="h-4 w-4" />
        </button>
        {onCollapse && (
          <button title="Hide Systems" onClick={onCollapse} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground">
            <PanelRightClose className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-2.5 py-2.5 flex flex-col gap-3">
        {systems.length === 0 ? (
          <p className="text-xs text-muted-foreground italic px-1 py-4">No systems yet. Add recurring routines here.</p>
        ) : (
          <>
            {due.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Due</p>
                {due.map((sys) => (
                  <SystemCard key={sys.id} sys={sys} due subtasks={subtaskMap[sys.id] ?? []}
                    onMarkDone={async () => { await markSystemDone(sys.id); load(); }}
                    onToggleSubtask={(sid) => toggleSub(sid, sys.id)}
                    onEdit={() => setEditing(sys)}
                    onDelete={async () => { await deleteSystem(sys.id); load(); }} />
                ))}
              </div>
            )}
            {upToDate.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-1">Up to date</p>
                {upToDate.map((sys) => (
                  <SystemCard key={sys.id} sys={sys} due={false} subtasks={subtaskMap[sys.id] ?? []}
                    onMarkDone={async () => { await markSystemDone(sys.id); load(); }}
                    onToggleSubtask={(sid) => toggleSub(sid, sys.id)}
                    onEdit={() => setEditing(sys)}
                    onDelete={async () => { await deleteSystem(sys.id); load(); }} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {creating && (
        <Dialog open onOpenChange={(o) => { if (!o) setCreating(false); }}>
          <DialogContent title="New system">
            <SystemForm submitLabel="Create" onSubmit={saveNew} onClose={() => setCreating(false)} />
          </DialogContent>
        </Dialog>
      )}
      {editing && (
        <Dialog open onOpenChange={(o) => { if (!o) { setEditing(null); load(); } }}>
          <DialogContent title="Edit system">
            <SystemForm initial={systemToForm(editing)} submitLabel="Save" onSubmit={saveEdit} onClose={() => setEditing(null)} />
            <SubtaskManager systemId={editing.id} onClose={() => { setEditing(null); load(); }} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
