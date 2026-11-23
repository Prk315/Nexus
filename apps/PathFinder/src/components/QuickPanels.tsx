import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ComponentType, type ReactNode,
} from "react";
import {
  Bell, FileText, Zap, Calendar, Clock, Handshake,
  Check, ChevronDown, ChevronRight, Plus, X, Pencil, GripVertical,
  Brush, ShoppingCart, RefreshCw, Flame, Repeat, AlarmClock, Trash2,
} from "lucide-react";
import { cn } from "../lib/utils";
import { isSystemDue, frequencyLabel } from "../lib/systems";
import {
  LEAD_OPTIONS, compareReminders, fromLocalInputValue, isReminderActionable,
  reminderPresets, reminderStatus, toLocalInputValue,
  type ReminderMeta, type ReminderStatus,
} from "../lib/reminders";
import {
  distinctCategories, groupByCategory, parseChoreInput, parseShoppingInput,
} from "../lib/quickItems";
import { clampFloatRect, clampWidth, parseStoredPos, parseStoredWidth } from "../lib/paneLayout";
import {
  getQuickTasks, createQuickTask, toggleTask, deleteTask,
  getTaskSubtypeRows, saveTaskSubtype, promoteChoreToSystem,
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
 * The side-tools — reminders, chores, shopping, systems, quick notes, brain
 * dump, events, deadlines, agreements.
 *
 * They used to be a full-width strip of labelled buttons pinned above the
 * dashboard's content, which spent a prominent row on things that are relevant
 * a few times a day. They now live as icon "boxes" — in the sidebar below a
 * divider (they are *tools*, not places), on the Dashboard's capture bar, and in
 * the phone's More sheet, where there is no sidebar at all.
 *
 * NEXT STEPS — reminders do not actually fire yet.
 *
 * `pf_task_reminders.remind_at` is currently *surfaced*, not delivered: due
 * reminders sort to the top of the panel, change colour, are what the sidebar
 * badge counts. Nothing
 * notifies you, because nothing in this ecosystem can — there is no
 * UNUserNotificationCenter anywhere in the repo, and the free sideload tier has
 * neither silent push nor BGTaskScheduler (see CLAUDE.md).
 *
 * `lead_minutes` is honoured the only way it can be without delivery: inside the
 * lead window a reminder turns "soon" and joins the badge early (lib/reminders.ts).
 * The intended home for real delivery is Nexus Local, which already runs a
 * daemon loop on the Mac and is the one native app on the phone:
 *   - Mac:   a grid-module tick reads due reminders and posts a notification.
 *   - Phone: schedule UNCalendarNotificationTrigger alerts on foreground, for
 *            the reminders known at that moment.
 *
 * Owning their own data is what makes that possible. Nothing else on the
 * dashboard ever read these slices, so lifting them out of that page removed
 * state, loads and handlers from a 3000-line file — and made every tool
 * reachable from any page rather than only the dashboard.
 */

// ── Shared row pieces ────────────────────────────────────────────────────────

function Checkbox({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
        done ? "bg-primary border-primary text-primary-foreground" : "border-border hover:border-primary",
      )}
    >
      {done && <Check className="h-2 w-2" />}
    </button>
  );
}

const hoverBtn = "shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100 transition-all";

/**
 * One quick-task line: checkbox, optional leading chip, title, optional trailing
 * chip, hover actions, and an optional editor slot underneath.
 *
 * These lists are created mostly from Nexus Local on the phone, so the row stays
 * thin — a title and a box. The sparse ISA subtypes are what give each kind its
 * one or two extra attributes, and those are what the chips show.
 */
function QuickRow({ task, onToggle, onDelete, leading, trailing, actions, below }: {
  task: Task;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  leading?: ReactNode;
  trailing?: ReactNode;
  actions?: ReactNode;
  below?: ReactNode;
}) {
  return (
    <div className="group flex flex-col gap-1 rounded-md px-1 py-1 hover:bg-secondary/50 transition-colors">
      <div className="flex items-center gap-2">
        <Checkbox done={task.done} onClick={() => onToggle(task.id)} />
        {leading}
        <span className={cn("flex-1 min-w-0 truncate text-xs", task.done && "line-through text-muted-foreground")}>
          {task.title}
        </span>
        {trailing}
        {actions}
        <button onClick={() => onDelete(task.id)} title="Delete" className={cn(hoverBtn, "hover:text-destructive")}>
          <X className="h-3 w-3" />
        </button>
      </div>
      {below}
    </div>
  );
}

function AddBar({ placeholder, onSubmit, hint, children }: {
  placeholder: string;
  onSubmit: (text: string) => void;
  /** Live preview of how the shorthand will be read. */
  hint?: (text: string) => ReactNode;
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState("");
  const submit = () => {
    const v = draft.trim();
    if (!v) return;
    onSubmit(v);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder={placeholder}
          className="flex-1 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground/50"
        />
        <button
          onClick={submit}
          disabled={!draft.trim()}
          title="Add"
          className="shrink-0 rounded-md bg-primary px-1.5 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-30"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {hint && draft.trim() && <div className="pl-0.5 text-[10px] text-muted-foreground">{hint(draft)}</div>}
      {children}
    </div>
  );
}

function GroupHeader({ label, count }: { label: string | null; count: number }) {
  return (
    <div className="flex items-center gap-1.5 px-1 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
      <span className="truncate">{label ?? "Other"}</span>
      <span className="opacity-60 tabular-nums">{count}</span>
    </div>
  );
}

/** Two-click destructive button: the first click arms it, the second commits. */
function ArmedButton({ label, armedLabel, onConfirm }: { label: string; armedLabel: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-px text-[10px] font-medium transition-colors",
        armed ? "bg-destructive text-white" : "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
      )}
    >
      <Trash2 className="h-2.5 w-2.5" />
      {armed ? armedLabel : label}
    </button>
  );
}

/** Inline editor for one or two free-text subtype attributes (store, area…). */
function AttrEditor({ fields, initial, onSave, onClose }: {
  fields: { key: string; label: string; placeholder: string; suggestions?: string[] }[];
  initial: Record<string, string | null | undefined>;
  onSave: (values: Record<string, string | null>) => void;
  onClose: () => void;
}) {
  const [vals, setVals] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f.key, initial[f.key] ?? ""])),
  );
  const save = () => {
    onSave(Object.fromEntries(fields.map((f) => [f.key, vals[f.key].trim() || null])));
    onClose();
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5 pl-5 pb-0.5">
      {fields.map((f, i) => (
        <label key={f.key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
          {f.label}
          <input
            autoFocus={i === 0}
            list={f.suggestions?.length ? `qp-${f.key}-list` : undefined}
            value={vals[f.key]}
            placeholder={f.placeholder}
            onChange={(e) => setVals((p) => ({ ...p, [f.key]: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
            className="w-20 rounded border border-border bg-transparent px-1 py-px text-[10px] text-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {f.suggestions && f.suggestions.length > 0 && (
            <datalist id={`qp-${f.key}-list`}>
              {f.suggestions.map((s) => <option key={s} value={s} />)}
            </datalist>
          )}
        </label>
      ))}
      <button onClick={save} className="rounded bg-primary px-1.5 py-px text-[10px] font-medium text-primary-foreground hover:bg-primary/90">Save</button>
      <button onClick={onClose} className="rounded px-1 py-px text-[10px] text-muted-foreground hover:text-foreground">Cancel</button>
    </div>
  );
}

// ── Reminders ────────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<ReminderStatus, string> = {
  unscheduled: "text-muted-foreground/50",
  scheduled:   "text-muted-foreground/70",
  soon:        "text-amber-500 font-medium",
  due:         "text-rose-500 font-medium",
};
const STATUS_TITLE: Record<ReminderStatus, string> = {
  unscheduled: "No time set — click to schedule",
  scheduled:   "Scheduled",
  soon:        "Inside its heads-up window",
  due:         "Due",
};

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function leadLabel(min: number | null): string | null {
  if (!min) return null;
  return min >= 1440 && min % 1440 === 0 ? `${min / 1440}d` : min >= 60 && min % 60 === 0 ? `${min / 60}h` : `${min}m`;
}

/** Time + heads-up controls, shared by the add form and the per-row editor. */
function ReminderTimeFields({ value, onChange }: {
  value: ReminderMeta;
  onChange: (m: ReminderMeta) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <input
          type="datetime-local"
          value={toLocalInputValue(value.remind_at)}
          onChange={(e) => onChange({ ...value, remind_at: fromLocalInputValue(e.target.value) })}
          className="flex-1 min-w-0 rounded border border-border bg-transparent px-1 py-px text-[10px] tabular-nums outline-none focus:ring-1 focus:ring-ring"
        />
        <select
          value={value.lead_minutes ?? ""}
          onChange={(e) => onChange({ ...value, lead_minutes: e.target.value ? Number(e.target.value) : null })}
          disabled={!value.remind_at}
          title="Heads-up: the reminder turns amber and joins the badge this long before its time"
          className="rounded border border-border bg-transparent px-1 py-px text-[10px] outline-none disabled:opacity-40"
        >
          {LEAD_OPTIONS.map((o) => <option key={o.label} value={o.value ?? ""}>{o.label}</option>)}
        </select>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {reminderPresets(new Date()).map((p) => (
          <button
            key={p.label}
            onClick={() => onChange({ ...value, remind_at: p.iso })}
            className="rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            {p.label}
          </button>
        ))}
        {value.remind_at && (
          <button
            onClick={() => onChange({ remind_at: null, lead_minutes: null })}
            className="rounded-full px-1.5 py-px text-[10px] text-muted-foreground hover:text-destructive transition-colors"
          >
            No time
          </button>
        )}
      </div>
    </div>
  );
}

function RemindersPanel({ tasks, meta, onToggle, onDelete, onAdd, onSetMeta }: {
  tasks: Task[];
  meta: Map<number, ReminderMeta>;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onAdd: (title: string, m: ReminderMeta) => void;
  onSetMeta: (id: number, m: ReminderMeta) => void;
}) {
  const [timing, setTiming] = useState<ReminderMeta>({ remind_at: null, lead_minutes: null });
  const [showTime, setShowTime] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const now = Date.now();

  const open = tasks.filter((t) => !t.done).sort((a, b) => compareReminders(meta.get(a.id), meta.get(b.id)));
  const done = tasks.filter((t) => t.done);

  const row = (t: Task) => {
    const m = meta.get(t.id);
    const status = reminderStatus(m, now);
    const lead = leadLabel(m?.lead_minutes ?? null);
    return (
      <QuickRow
        key={t.id}
        task={t}
        onToggle={onToggle}
        onDelete={onDelete}
        trailing={
          <button
            onClick={() => setEditing(editing === t.id ? null : t.id)}
            title={STATUS_TITLE[status]}
            className={cn(
              "shrink-0 inline-flex items-center gap-0.5 rounded px-0.5 text-[10px] tabular-nums hover:bg-secondary transition-colors",
              STATUS_CHIP[status],
              status === "unscheduled" && "opacity-0 group-hover:opacity-100 focus:opacity-100 [@media(hover:none)]:opacity-100",
            )}
          >
            <AlarmClock className="h-2.5 w-2.5" />
            {m?.remind_at ? fmtWhen(m.remind_at) : "Set time"}
            {lead && m?.remind_at && <span className="opacity-60">−{lead}</span>}
          </button>
        }
        below={editing === t.id ? (
          <div className="pl-5 pb-0.5">
            <ReminderTimeFields
              value={m ?? { remind_at: null, lead_minutes: null }}
              onChange={(next) => onSetMeta(t.id, next)}
            />
          </div>
        ) : undefined}
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <AddBar
        placeholder="Remind me to… (Enter)"
        onSubmit={(title) => {
          onAdd(title, showTime ? timing : { remind_at: null, lead_minutes: null });
          setTiming({ remind_at: null, lead_minutes: null });
        }}
      >
        <button
          onClick={() => setShowTime((v) => !v)}
          className={cn(
            "self-start inline-flex items-center gap-1 text-[10px] transition-colors",
            showTime ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <AlarmClock className="h-2.5 w-2.5" />
          {showTime ? "With a time" : "Add a time"}
        </button>
        {showTime && <ReminderTimeFields value={timing} onChange={setTiming} />}
      </AddBar>

      {open.length === 0 && done.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nothing here.</p>
      )}
      <div className="flex flex-col gap-0.5">{open.map(row)}</div>
      {done.length > 0 && (
        <div className="flex flex-col gap-0.5 pt-1.5 border-t border-border/60">{done.map(row)}</div>
      )}
    </div>
  );
}

// ── Shopping ─────────────────────────────────────────────────────────────────

interface ShoppingMeta { quantity: string | null; store: string | null }

function ShoppingPanel({ tasks, meta, onToggle, onDelete, onAdd, onSetMeta, onClearDone }: {
  tasks: Task[];
  meta: Map<number, ShoppingMeta>;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onAdd: (raw: string) => void;
  onSetMeta: (id: number, m: ShoppingMeta) => void;
  onClearDone: (ids: number[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const stores = useMemo(() => distinctCategories([...meta.values()].map((m) => m.store)), [meta]);
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  // Grouping only appears once a store is actually in use — a single "Other"
  // heading over an ungrouped list is noise.
  const grouped = open.some((t) => meta.get(t.id)?.store);
  const groups = grouped ? groupByCategory(open, (t) => meta.get(t.id)?.store) : [{ key: null, label: null, items: open }];

  const row = (t: Task) => {
    const m = meta.get(t.id);
    return (
      <QuickRow
        key={t.id}
        task={t}
        onToggle={onToggle}
        onDelete={onDelete}
        leading={m?.quantity ? (
          <span className="shrink-0 rounded bg-secondary px-1 text-[10px] font-medium tabular-nums text-foreground/80">{m.quantity}</span>
        ) : undefined}
        trailing={!grouped && m?.store ? (
          <span className="shrink-0 max-w-20 truncate text-[10px] text-muted-foreground/70">@{m.store}</span>
        ) : undefined}
        actions={
          <button onClick={() => setEditing(editing === t.id ? null : t.id)} title="Quantity & store" className={cn(hoverBtn, "hover:text-foreground")}>
            <Pencil className="h-3 w-3" />
          </button>
        }
        below={editing === t.id ? (
          <AttrEditor
            fields={[
              { key: "quantity", label: "Qty", placeholder: "2, 500 g" },
              { key: "store", label: "Store", placeholder: "Netto", suggestions: stores },
            ]}
            initial={{ quantity: m?.quantity, store: m?.store }}
            onSave={(v) => onSetMeta(t.id, { quantity: v.quantity, store: v.store })}
            onClose={() => setEditing(null)}
          />
        ) : undefined}
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <AddBar
        placeholder="2x milk @netto (Enter)"
        onSubmit={onAdd}
        hint={(raw) => {
          const p = parseShoppingInput(raw);
          if (!p.quantity && !p.store) return null;
          return <>Adds <b>{p.title}</b>{p.quantity && <> · qty {p.quantity}</>}{p.store && <> · @{p.store}</>}</>;
        }}
      />

      {open.length === 0 && done.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nothing here.</p>
      )}
      <div className="flex flex-col gap-0.5">
        {groups.map((g) => (
          <div key={g.key ?? "__none"} className="flex flex-col gap-0.5">
            {grouped && <GroupHeader label={g.label} count={g.items.length} />}
            {g.items.map(row)}
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <div className="flex flex-col gap-0.5 pt-1.5 border-t border-border/60">
          <div className="flex justify-end">
            <ArmedButton
              label={`Clear ${done.length} checked`}
              armedLabel="Click again to delete"
              onConfirm={() => onClearDone(done.map((t) => t.id))}
            />
          </div>
          {done.map(row)}
        </div>
      )}
    </div>
  );
}

// ── Chores ───────────────────────────────────────────────────────────────────

interface ChoreMeta { area: string | null; rotation_days: number | null }

function ChoresPanel({ tasks, meta, onToggle, onDelete, onAdd, onSetArea, onMakeRecurring }: {
  tasks: Task[];
  meta: Map<number, ChoreMeta>;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onAdd: (raw: string) => void;
  onSetArea: (id: number, area: string | null) => void;
  onMakeRecurring: (id: number, intervalDays: number) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [everyFor, setEveryFor] = useState<{ id: number; draft: string } | null>(null);
  const areas = useMemo(() => distinctCategories([...meta.values()].map((m) => m.area)), [meta]);
  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const grouped = open.some((t) => meta.get(t.id)?.area);
  const groups = grouped ? groupByCategory(open, (t) => meta.get(t.id)?.area) : [{ key: null, label: null, items: open }];

  const commitEvery = () => {
    if (!everyFor) return;
    const n = Number(everyFor.draft);
    if (Number.isFinite(n) && n >= 1) { onMakeRecurring(everyFor.id, n); setEveryFor(null); }
  };

  const row = (t: Task) => {
    const m = meta.get(t.id);
    return (
      <QuickRow
        key={t.id}
        task={t}
        onToggle={onToggle}
        onDelete={onDelete}
        trailing={!grouped && m?.area ? (
          <span className="shrink-0 max-w-20 truncate text-[10px] text-muted-foreground/70">#{m.area}</span>
        ) : undefined}
        actions={!t.done ? (
          <>
            <button onClick={() => setEditing(editing === t.id ? null : t.id)} title="Area" className={cn(hoverBtn, "hover:text-foreground")}>
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => setEveryFor(everyFor?.id === t.id ? null : { id: t.id, draft: "7" })}
              title="Make recurring — moves it to Systems"
              className={cn(hoverBtn, "hover:text-foreground")}
            >
              <Repeat className="h-3 w-3" />
            </button>
          </>
        ) : undefined}
        below={
          editing === t.id ? (
            <AttrEditor
              fields={[{ key: "area", label: "Area", placeholder: "kitchen", suggestions: areas }]}
              initial={{ area: m?.area }}
              onSave={(v) => onSetArea(t.id, v.area)}
              onClose={() => setEditing(null)}
            />
          ) : everyFor?.id === t.id ? (
            <div className="flex items-center gap-1.5 pl-5 pb-0.5">
              <span className="text-[10px] text-muted-foreground">Every</span>
              <input
                autoFocus
                type="number"
                min={1}
                value={everyFor.draft}
                onChange={(e) => setEveryFor({ id: t.id, draft: e.target.value })}
                onKeyDown={(e) => { if (e.key === "Escape") setEveryFor(null); if (e.key === "Enter") commitEvery(); }}
                className="w-12 rounded border border-border bg-transparent px-1 py-px text-[10px] tabular-nums outline-none focus:ring-1 focus:ring-ring"
              />
              <span className="text-[10px] text-muted-foreground">days</span>
              <button
                onClick={commitEvery}
                className="rounded bg-primary px-1.5 py-px text-[10px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Move to Systems
              </button>
            </div>
          ) : undefined
        }
      />
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <AddBar
        placeholder="wipe counters #kitchen (Enter)"
        onSubmit={onAdd}
        hint={(raw) => {
          const p = parseChoreInput(raw);
          return p.area ? <>Adds <b>{p.title}</b> · #{p.area}</> : null;
        }}
      />
      {open.length === 0 && done.length === 0 && (
        <p className="text-xs text-muted-foreground italic">Nothing here.</p>
      )}
      <div className="flex flex-col gap-0.5">
        {groups.map((g) => (
          <div key={g.key ?? "__none"} className="flex flex-col gap-0.5">
            {grouped && <GroupHeader label={g.label} count={g.items.length} />}
            {g.items.map(row)}
          </div>
        ))}
      </div>
      {done.length > 0 && (
        <div className="flex flex-col gap-0.5 pt-1.5 border-t border-border/60">{done.map(row)}</div>
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


// ── The tool set: provider, buttons, flyout ──────────────────────────────────

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

/** What the Dashboard's capture bar can file, and where each lands. */
export type CaptureKind = "reminder" | "chore" | "shopping" | "note" | "brain" | "event" | "deadline" | "agreement";

export interface CaptureExtra {
  /** event / deadline: YYYY-MM-DD. */
  date?: string;
  /** reminder: timing. */
  reminder?: ReminderMeta;
}

interface QuickPanelsCtx {
  panels: QuickPanelDef[];
  open: QuickPanelId | null;
  toggle: (id: QuickPanelId) => void;
  openPanel: (id: QuickPanelId) => void;
  close: () => void;
  /** Files one item into the tool it belongs to. Rejects on failure. */
  capture: (kind: CaptureKind, text: string, extra?: CaptureExtra) => Promise<void>;
}

const Ctx = createContext<QuickPanelsCtx | null>(null);

/** Throws outside the provider rather than silently rendering nothing. */
export function useQuickPanels(): QuickPanelsCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useQuickPanels must be used inside <QuickPanelsProvider>");
  return v;
}

const IS_IOS = typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent);
const today = () => new Date().toISOString().slice(0, 10);

export function QuickPanelsProvider({ children }: { children: React.ReactNode }) {
  // Quick tasks (reminder / chore / shopping) — created almost entirely from
  // Nexus Local on the phone. One query, grouped by category here.
  const [quickTasks, setQuickTasks]     = useState<Task[]>([]);
  const [systems, setSystems]           = useState<SystemEntry[]>([]);
  // task_id -> subtype attributes, one map per sparse kind.
  const [reminderMeta, setReminderMeta] = useState<Map<number, ReminderMeta>>(new Map());
  const [shoppingMeta, setShoppingMeta] = useState<Map<number, ShoppingMeta>>(new Map());
  const [choreMeta, setChoreMeta]       = useState<Map<number, ChoreMeta>>(new Map());
  const [subtaskMap, setSubtaskMap]     = useState<Record<number, SystemSubtask[]>>({});
  const [notes, setNotes]               = useState<QuickNote[]>([]);
  const [brainEntries, setBrainEntries] = useState<BrainEntry[]>([]);
  const [events, setEvents]             = useState<CalEvent[]>([]);
  const [deadlines, setDeadlines]       = useState<Deadline[]>([]);
  const [agreements, setAgreements]     = useState<Agreement[]>([]);
  const [open, setOpen]                 = useState<QuickPanelId | null>(null);
  const [loaded, setLoaded]             = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const lastLoad = useRef(0);

  // Loaded on mount, not lazily on first open.
  //
  // Lazy was the obvious optimisation and it broke the feature: the badges are
  // meant to tell you how many unchecked items are waiting, and a badge that
  // only appears after you have already opened the panel tells you nothing. The
  // counts have to be true before the first click.
  const load = useCallback(async () => {
    lastLoad.current = Date.now();
    const [qt, sys, rem, shop, chore, n, b, e, d, a] = await Promise.all([
      getQuickTasks(), getSystems(),
      getTaskSubtypeRows("reminder"), getTaskSubtypeRows("shopping"), getTaskSubtypeRows("chore"),
      getQuickNotes(), getBrainDump(), getEvents(), getDeadlines(), getAgreements(),
    ]);
    setQuickTasks(qt); setSystems(sys); setNotes(n); setBrainEntries(b);
    setEvents(e); setDeadlines(d); setAgreements(a);
    setReminderMeta(new Map(rem.map((r) => [Number(r.task_id), {
      remind_at: r.remind_at ? String(r.remind_at) : null,
      lead_minutes: r.lead_minutes != null ? Number(r.lead_minutes) : null,
    }])));
    setShoppingMeta(new Map(shop.map((r) => [Number(r.task_id), {
      quantity: r.quantity ?? null, store: r.store ?? null,
    }])));
    setChoreMeta(new Map(chore.map((r) => [Number(r.task_id), {
      area: r.area ?? null, rotation_days: r.rotation_days != null ? Number(r.rotation_days) : null,
    }])));

    // Subtasks are per-system, so they can only be fetched once the systems are
    // known. Failing here must not blank the panel — a system with no subtasks
    // and a system whose subtasks failed to load look the same to the UI, so we
    // keep whatever we had rather than clearing.
    try {
      const entries = await Promise.all(
        sys.map(async (x) => [x.id, await getSystemSubtasks(x.id, today())] as [number, SystemSubtask[]]),
      );
      setSubtaskMap(Object.fromEntries(entries));
    } catch { /* keep the previous map */ }

    setLoaded(true);
  }, []);

  useEffect(() => { load().catch(() => {}); }, [load]);

  // Quick tasks arrive from the phone (Nexus Local, the widgets) while this tab
  // sits in the background. Refetch when the window comes back — throttled, so
  // alt-tabbing doesn't issue ten reads a minute.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastLoad.current < 30_000) return;
      load().catch(() => {});
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const toggle = useCallback((id: QuickPanelId) => setOpen((prev) => (prev === id ? null : id)), []);
  const openPanel = useCallback((id: QuickPanelId) => setOpen(id), []);
  const close = useCallback(() => setOpen(null), []);

  // Counts stay undefined until the first load, so a badge never claims "0"
  // about data that simply hasn't been read yet.
  const n = (v: number) => (loaded && v > 0 ? v : undefined);

  const byCategory = (c: TaskCategory) => quickTasks.filter((t) => t.category === c);
  const nowMs = Date.now();
  const actionableReminders = byCategory("reminder")
    .filter((t) => !t.done && isReminderActionable(reminderMeta.get(t.id), nowMs)).length;
  const openIn = (c: TaskCategory) => byCategory(c).filter((t) => !t.done).length;
  const todayStr = today();

  const panels: QuickPanelDef[] = [
    // The three phone-captured kinds first — these are the ones with live counts
    // you act on, and they are why the rail exists.
    // Reminders count what is ACTIONABLE now: undated, due, or inside their
    // heads-up window. A reminder set for next week shouldn't sit on the badge
    // all week — that is how a badge stops meaning anything.
    { id: "reminders",  label: "Reminders",   icon: Bell,         count: n(actionableReminders) },
    { id: "chores",     label: "Chores",      icon: Brush,        count: n(openIn("chore")) },
    { id: "shopping",   label: "Shopping",    icon: ShoppingCart, count: n(openIn("shopping")) },
    { id: "systems",    label: "Systems",     icon: RefreshCw,    count: n(systems.filter((x) => isSystemDue(x)).length) },
    { id: "notes",      label: "Quick Notes", icon: FileText,     count: n(notes.length) },
    { id: "brain",      label: "Brain Dump",  icon: Zap,          count: n(brainEntries.length) },
    { id: "events",     label: "Events",      icon: Calendar,     count: n(events.filter((e) => e.date >= todayStr).length) },
    { id: "deadlines",  label: "Deadlines",   icon: Clock,        count: n(deadlines.filter((d) => !d.done).length) },
    { id: "agreements", label: "Agreements",  icon: Handshake,    count: n(agreements.length) },
  ];

  // ── Quick-task handlers ──
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  const toggleQuickTask = useCallback(async (id: number) => {
    // Optimistic — a checkbox that waits on the network feels broken.
    setQuickTasks((p) => p.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    try { await toggleTask(id); } catch { load().catch(() => {}); }
  }, [load]);
  const handleDeleteQuickTask = async (id: number) => {
    setQuickTasks((p) => p.filter((t) => t.id !== id));
    try { await deleteTask(id); } catch { load().catch(() => {}); }
  };
  /** Deletes one at a time: one connection per row in parallel is the shape that wedged Supabase on 2026-08-15. */
  const handleClearDone = async (ids: number[]) => {
    const gone = new Set(ids);
    setQuickTasks((p) => p.filter((t) => !gone.has(t.id)));
    try { for (const id of ids) await deleteTask(id); } catch (e) { fail(e); load().catch(() => {}); }
  };

  const addReminder = async (title: string, m: ReminderMeta) => {
    const { task } = await createQuickTask("reminder", title, { remind_at: m.remind_at, lead_minutes: m.remind_at ? m.lead_minutes : null });
    setQuickTasks((p) => [task, ...p]);
    if (m.remind_at) setReminderMeta((p) => new Map(p).set(task.id, m));
  };
  const addShopping = async (raw: string) => {
    const { title, quantity, store } = parseShoppingInput(raw);
    const { task } = await createQuickTask("shopping", title, { quantity, store });
    setQuickTasks((p) => [task, ...p]);
    if (quantity || store) setShoppingMeta((p) => new Map(p).set(task.id, { quantity, store }));
  };
  const addChore = async (raw: string) => {
    const { title, area } = parseChoreInput(raw);
    const { task } = await createQuickTask("chore", title, { area });
    setQuickTasks((p) => [task, ...p]);
    if (area) setChoreMeta((p) => new Map(p).set(task.id, { area, rotation_days: null }));
  };

  const setReminder = async (id: number, m: ReminderMeta) => {
    const next = { remind_at: m.remind_at, lead_minutes: m.remind_at ? m.lead_minutes : null };
    setReminderMeta((p) => new Map(p).set(id, next));
    try { await saveTaskSubtype(id, "reminder", next); } catch (e) { fail(e); load().catch(() => {}); }
  };
  const setShopping = async (id: number, m: ShoppingMeta) => {
    setShoppingMeta((p) => new Map(p).set(id, m));
    try { await saveTaskSubtype(id, "shopping", m); } catch (e) { fail(e); load().catch(() => {}); }
  };
  const setChoreArea = async (id: number, area: string | null) => {
    setChoreMeta((p) => new Map(p).set(id, { area, rotation_days: p.get(id)?.rotation_days ?? null }));
    try { await saveTaskSubtype(id, "chore", { area }); } catch (e) { fail(e); load().catch(() => {}); }
  };

  const handleMakeRecurring = async (id: number, intervalDays: number) => {
    await promoteChoreToSystem(id, intervalDays);
    await load();      // the chore is gone and a system exists — reload both
    setOpen("systems"); // land the user where the thing now lives
  };

  // ── Other tools (moved verbatim from Dashboard) ──
  const handleMarkSystem = async (id: number) => {
    const x = await markSystemDone(id); setSystems((p) => p.map((y) => (y.id === id ? x : y)));
  };
  const handleUnmarkSystem = async (id: number) => {
    const x = await unmarkSystemDone(id); setSystems((p) => p.map((y) => (y.id === id ? x : y)));
  };
  const handleToggleSubtask = async (subtaskId: number, systemId: number) => {
    const res = await toggleSystemSubtask(subtaskId, today());
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

  /**
   * The Dashboard's capture bar routes through here, not straight to the api,
   * so the item lands in this provider's state and the sidebar badge moves the
   * moment it is filed — a capture that only shows after a reload reads as lost.
   */
  const capture = async (kind: CaptureKind, text: string, extra?: CaptureExtra) => {
    const t = text.trim();
    if (!t) return;
    switch (kind) {
      case "reminder":  return addReminder(t, extra?.reminder ?? { remind_at: null, lead_minutes: null });
      case "shopping":  return addShopping(t);
      case "chore":     return addChore(t);
      case "note":      return handleAddNote(t, null);
      case "brain":     return handleAddBrain(t);
      case "event":     return handleAddEvent(t, extra?.date || today());
      case "deadline":  return handleAddDeadline(t, extra?.date || today());
      case "agreement": return handleAddAgreement(t, null);
    }
  };

  const guard = <A extends unknown[]>(f: (...a: A) => Promise<unknown>) =>
    (...a: A) => { f(...a).catch(fail); };

  const body = (() => {
    switch (open) {
      case "reminders":  return <RemindersPanel tasks={byCategory("reminder")} meta={reminderMeta} onToggle={toggleQuickTask} onDelete={handleDeleteQuickTask} onAdd={guard(addReminder)} onSetMeta={setReminder} />;
      case "chores":     return <ChoresPanel    tasks={byCategory("chore")}    meta={choreMeta}    onToggle={toggleQuickTask} onDelete={handleDeleteQuickTask} onAdd={guard(addChore)} onSetArea={setChoreArea} onMakeRecurring={guard(handleMakeRecurring)} />;
      case "shopping":   return <ShoppingPanel  tasks={byCategory("shopping")} meta={shoppingMeta} onToggle={toggleQuickTask} onDelete={handleDeleteQuickTask} onAdd={guard(addShopping)} onSetMeta={setShopping} onClearDone={handleClearDone} />;
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
    <Ctx.Provider value={{ panels, open, toggle, openPanel, close, capture }}>
      {children}
      {open && (
        <QuickPanelFlyout title={label} loaded={loaded} onClose={close}>
          {error && (
            <div className="mb-2 flex items-center gap-2 rounded-md border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-300">
              <span className="flex-1 min-w-0">{error}</span>
              <button onClick={() => setError(null)} title="Dismiss"><X className="h-3 w-3" /></button>
            </div>
          )}
          {body}
        </QuickPanelFlyout>
      )}
    </Ctx.Provider>
  );
}

/**
 * The tool "boxes" — one icon button per panel, with its badge.
 *
 * Rendered in more than one place (sidebar rail, Dashboard capture bar, the
 * phone's More sheet), so it lives here rather than in Sidebar. Every copy
 * carries `data-quick-panel-trigger` so the flyout's click-outside handler
 * ignores it — otherwise closing then re-toggling would fight.
 */
export function QuickPanelButtons({ layout = "row", size = "md", className, onPick }: {
  /** "grid3": the sidebar's two rows of three; "column": collapsed sidebar; "row": inline strip. */
  layout?: "grid3" | "column" | "row";
  size?: "sm" | "md";
  className?: string;
  /** Called after a box is toggled — e.g. to close the sheet it lives in. */
  onPick?: (id: QuickPanelId) => void;
}) {
  const { panels, open, toggle } = useQuickPanels();
  const box = size === "sm" ? "h-7 w-7" : "h-8 w-8";
  return (
    <div
      className={cn(
        layout === "grid3" && "grid grid-cols-3 gap-x-1 gap-y-2.5 justify-items-center",
        layout === "column" && "grid grid-cols-1 gap-y-2.5 justify-items-center",
        layout === "row" && "flex flex-wrap items-center gap-1.5",
        className,
      )}
    >
      {panels.map(({ id, label, icon: Icon, count }) => (
        <button
          key={id}
          data-quick-panel-trigger
          onClick={() => { toggle(id); onPick?.(id); }}
          title={label}
          aria-label={label}
          aria-pressed={open === id}
          className={cn(
            "relative flex items-center justify-center rounded-md transition-colors",
            box,
            layout === "row" && "border border-border bg-card",
            open === id
              ? "bg-sidebar-accent text-sidebar-accent-foreground border-primary/40"
              : cn(
                layout === "row" ? "text-muted-foreground" : "text-sidebar-foreground/60",
                "hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
              ),
          )}
        >
          <Icon className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} />
          {/* Superscript count of unchecked items. Capped at "9+" so a long
              shopping list can't widen the badge past the icon it sits on. */}
          {count != null && (
            <span className={cn(
              "absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-500 px-1 text-[9px] font-semibold leading-none text-white ring-2",
              layout === "row" ? "ring-background" : "ring-sidebar",
            )}>
              {count > 9 ? "9+" : count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

const FLYOUT_POS_KEY = "pf-quick-panel-pos";
const FLYOUT_W_KEY = "pf-quick-panel-w";
const FLYOUT_W_MIN = 280, FLYOUT_W_MAX = 560, FLYOUT_W_DEFAULT = 320;
/** Only the header must stay on screen — it is the drag handle. */
const FLYOUT_HEADER_PX = 40;

function readStore(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeStore(key: string, v: string | null) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* private mode */ }
}

/**
 * The open tool, as a floating panel.
 *
 * A flyout rather than an inline block: the triggers live in global navigation,
 * so the panel has to be able to appear over any page. Click-outside and Escape
 * both dismiss it — a panel opened by a single click should not need a hunt to
 * close.
 *
 * It can be MOVED by its header and RESIZED by its right edge, and both persist:
 * anchored to the sidebar corner it covered whatever was in the bottom-left of
 * the page, which is exactly where the Week grid's early hours and the
 * Workspace navigator's last rows sit. Double-click the header to put it back.
 * Positions are clamped so the header can never leave the viewport — a panel
 * dragged off-screen would otherwise need storage cleared to recover.
 */
function QuickPanelFlyout({ title, loaded, onClose, children }: {
  title: string;
  loaded: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(() => parseStoredPos(readStore(FLYOUT_POS_KEY)));
  const [width, setWidth] = useState(() => parseStoredWidth(readStore(FLYOUT_W_KEY), FLYOUT_W_MIN, FLYOUT_W_MAX, FLYOUT_W_DEFAULT));
  const [, setViewportTick] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      const el = ref.current;
      if (!el || el.contains(e.target as Node)) return;
      // Ignore clicks on the triggers — they toggle for themselves, and closing
      // here first would make a second click reopen instead of close.
      if ((e.target as HTMLElement).closest?.("[data-quick-panel-trigger]")) return;
      onClose();
    };
    // Re-clamp on window resize so a panel parked at the right edge of a wide
    // window doesn't end up out of reach when the window narrows.
    const onResize = () => setViewportTick((v) => v + 1);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onResize);
    };
  }, [onClose]);

  const vw = window.innerWidth, vh = window.innerHeight;
  const w = clampWidth(width, Math.min(FLYOUT_W_MIN, vw - 16), Math.min(FLYOUT_W_MAX, vw - 16));
  const placed = pos ? clampFloatRect({ x: pos.x, y: pos.y, w, h: FLYOUT_HEADER_PX }, vw, vh) : null;

  /** Window listeners rather than pointer capture — see Dashboard's rail resize for why. */
  const track = (e: React.PointerEvent, onMove: (ev: PointerEvent) => void, onEnd: () => void) => {
    e.preventDefault();
    const move = (ev: PointerEvent) => onMove(ev);
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.userSelect = "";
      onEnd();
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const startMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = e.clientX - rect.left, dy = e.clientY - rect.top;
    let last = { x: rect.left, y: rect.top };
    // A plain click on the header must not pin the default placement into
    // storage — only a real drag moves the panel.
    let moved = false;
    track(e, (ev) => {
      moved = true;
      last = clampFloatRect({ x: ev.clientX - dx, y: ev.clientY - dy, w: rect.width, h: FLYOUT_HEADER_PX }, window.innerWidth, window.innerHeight);
      setPos({ x: last.x, y: last.y });
    }, () => { if (moved) writeStore(FLYOUT_POS_KEY, JSON.stringify(last)); });
  };

  const startResize = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    let last = rect.width;
    track(e, (ev) => {
      last = clampWidth(ev.clientX - rect.left, FLYOUT_W_MIN, FLYOUT_W_MAX);
      setWidth(last);
    }, () => writeStore(FLYOUT_W_KEY, String(last)));
  };

  const reset = () => {
    setPos(null); setWidth(FLYOUT_W_DEFAULT);
    writeStore(FLYOUT_POS_KEY, null); writeStore(FLYOUT_W_KEY, null);
  };

  // Default placement: the sidebar corner on desktop; on the phone (no sidebar)
  // just above the bottom tab bar, which would otherwise cover it.
  const style: React.CSSProperties = placed
    ? { left: placed.x, top: placed.y, width: w, maxHeight: Math.max(160, Math.min(vh * 0.8, vh - placed.y - 8)) }
    : IS_IOS
      ? { left: 8, bottom: "calc(4.5rem + env(safe-area-inset-bottom))", width: w, maxHeight: "65vh" }
      : { left: 8, bottom: 56, width: w, maxHeight: "70vh" };

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-50 flex flex-col rounded-xl border border-border bg-popover shadow-2xl"
    >
      <div
        onPointerDown={startMove}
        onDoubleClick={reset}
        title="Drag to move · double-click to reset"
        className="flex shrink-0 cursor-grab active:cursor-grabbing touch-none select-none items-center justify-between gap-2 px-3 pt-3 pb-2"
      >
        <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <GripVertical className="h-3 w-3 opacity-40" />
          {title}
        </span>
        <button
          onClick={onClose}
          title="Close"
          className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {loaded ? children : <p className="text-xs text-muted-foreground italic">Loading…</p>}
      </div>
      {/* Right-edge resize grip — 8px hit area around a hairline. */}
      <div
        onPointerDown={startResize}
        title="Drag to resize"
        className="absolute right-0 top-3 bottom-3 w-2 translate-x-1 cursor-col-resize touch-none group/grip hidden md:block"
      >
        <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover/grip:bg-primary/60" />
      </div>
    </div>
  );
}
