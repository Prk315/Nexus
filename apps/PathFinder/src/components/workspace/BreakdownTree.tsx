import { useEffect, useRef, useState } from "react";
import {
  Check, ChevronRight, ChevronDown, CornerDownRight, Indent, Outdent,
  Plus, X, CalendarClock, Repeat,
} from "lucide-react";
import { cn, formatDateShort } from "../../lib/utils";
import {
  formatMinutes, rollupEstimate, rollupProgress, rollupCoverage,
  isDerivedEstimate, planningOf, type TaskNode,
} from "../../lib/taskTree";
import type { TaskCoverage, TaskSession } from "../../types";

/**
 * The recursive breakdown editor.
 *
 * Every row is a real task, so a subtask carries everything its parent does — its
 * own done-state, estimate, due date and schedule. That is the whole reason the
 * breakdown lives in `pf_tasks.parent_id` rather than a separate steps table:
 * "sub-steps themselves carry states and time required" is only true if a
 * sub-step *is* a task.
 *
 * Editing is keyboard-first, because a breakdown you have to click through is a
 * breakdown you don't write: Enter commits a step and opens the next one, so a
 * whole plan can be typed without touching the mouse.
 */

export interface BreakdownHandlers {
  onAddChild: (parentId: number, title: string) => void;
  onPatch: (id: number, patch: Record<string, unknown>) => void;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  onReparent: (id: number, parentId: number | null) => void;
  onSchedule: (id: number) => void;
}

interface RowContext {
  coverage: Map<number, TaskCoverage>;
  sessionsByTask: Map<number, TaskSession[]>;
  handlers: BreakdownHandlers;
  collapsed: Set<number>;
  onToggleCollapse: (id: number) => void;
  composingUnder: number | null;
  setComposingUnder: (id: number | null) => void;
}

export function BreakdownTree({
  root, coverage, sessionsByTask, handlers,
}: {
  root: TaskNode;
  coverage: Map<number, TaskCoverage>;
  sessionsByTask: Map<number, TaskSession[]>;
  handlers: BreakdownHandlers;
}) {
  // Folded rows, keyed by id so the set survives a refetch that rebuilds nodes.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  // Which row is showing an empty "new step" input, keyed by the parent's id.
  const [composingUnder, setComposingUnder] = useState<number | null>(null);

  const ctx: RowContext = {
    coverage, sessionsByTask, handlers, collapsed,
    onToggleCollapse: (id) =>
      setCollapsed((s) => {
        const next = new Set(s);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }),
    composingUnder,
    setComposingUnder,
  };

  const composingAtRoot = composingUnder === root.task.id;

  return (
    <div className="flex flex-col">
      {root.children.length === 0 && !composingAtRoot && (
        <button
          type="button"
          onClick={() => setComposingUnder(root.task.id)}
          className="flex items-center gap-2 rounded-md border border-dashed border-border/70 px-3 py-3 text-xs text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Break this into steps
        </button>
      )}

      {root.children.map((child, i) => (
        <BreakdownRow
          key={child.task.id}
          node={child}
          parent={root}
          siblings={root.children}
          index={i}
          ctx={ctx}
        />
      ))}

      {composingAtRoot && (
        <NewRowInput
          depth={1}
          onCommit={(title, andAnother) => {
            handlers.onAddChild(root.task.id, title);
            setComposingUnder(andAnother ? root.task.id : null);
          }}
          onCancel={() => setComposingUnder(null)}
        />
      )}

      {root.children.length > 0 && !composingAtRoot && (
        <button
          type="button"
          onClick={() => setComposingUnder(root.task.id)}
          className="self-start mt-1 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
        >
          <Plus className="h-3 w-3" /> Add step
        </button>
      )}
    </div>
  );
}

function BreakdownRow({ node, parent, siblings, index, ctx }: {
  node: TaskNode;
  /** The row above in the hierarchy — needed to compute the outdent target. */
  parent: TaskNode;
  siblings: TaskNode[];
  index: number;
  ctx: RowContext;
}) {
  const t = node.task;
  const { coverage, sessionsByTask, handlers, collapsed, composingUnder, setComposingUnder } = ctx;
  const hasChildren = node.children.length > 0;
  const isCollapsed = collapsed.has(t.id);

  const estimate = rollupEstimate(node);
  const derived = isDerivedEstimate(node);
  const progress = rollupProgress(node, sessionsByTask);
  const scheduled = rollupCoverage(node, coverage).scheduledMin;
  const recurring = planningOf(t).completion_mode === "sessions";

  // Indent = become a child of the sibling above. Outdent = become a sibling of
  // the parent. Both are refused at the edges rather than silently doing nothing
  // somewhere unexpected: the first sibling has nothing to tuck under, and a
  // depth-1 row outdenting would leave the task being planned entirely.
  const canIndent = index > 0;
  const canOutdent = node.depth > 1;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(t.title);
  useEffect(() => setDraft(t.title), [t.title]);

  const commitTitle = () => {
    const v = draft.trim();
    if (v && v !== t.title) handlers.onPatch(t.id, { title: v });
    else setDraft(t.title);
    setEditing(false);
  };

  return (
    <div className="flex flex-col">
      <div
        className="group flex items-center gap-1.5 rounded-md py-1 pr-1 hover:bg-secondary/40 transition-colors"
        style={{ paddingLeft: `${(node.depth - 1) * 18}px` }}
      >
        {/* Fold control — keeps its slot when empty so titles stay aligned. */}
        <button
          type="button"
          onClick={() => hasChildren && ctx.onToggleCollapse(t.id)}
          className={cn(
            "h-4 w-4 shrink-0 flex items-center justify-center rounded text-muted-foreground",
            hasChildren ? "hover:bg-secondary hover:text-foreground" : "opacity-0 pointer-events-none",
          )}
          aria-label={isCollapsed ? "Expand" : "Collapse"}
        >
          {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        <button
          type="button"
          onClick={() => handlers.onToggle(t.id)}
          disabled={hasChildren}
          title={hasChildren ? "Done when every step below is done" : "Mark done"}
          className={cn(
            "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors",
            progress.done
              ? "bg-primary border-primary text-primary-foreground"
              : "border-border hover:border-primary",
            hasChildren && "opacity-70 cursor-default",
          )}
        >
          {progress.done && <Check className="h-2 w-2" />}
        </button>

        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commitTitle(); }
              if (e.key === "Escape") { setDraft(t.title); setEditing(false); }
            }}
            className="flex-1 min-w-0 bg-transparent border-b border-primary/40 text-sm outline-none py-0.5"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className={cn(
              "flex-1 min-w-0 text-left text-sm truncate py-0.5",
              progress.done && "line-through text-muted-foreground",
            )}
          >
            {t.title}
          </button>
        )}

        {hasChildren && (
          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
            {progress.label}
          </span>
        )}

        {recurring && (
          <span
            className="shrink-0 inline-flex items-center gap-0.5 text-[10px] text-violet-500"
            title={`Recurring — ${progress.label}`}
          >
            <Repeat className="h-2.5 w-2.5" />
            {!hasChildren && progress.label}
          </span>
        )}

        <EstimateField
          minutes={derived ? estimate : t.time_estimate}
          derived={derived}
          onChange={(v) => handlers.onPatch(t.id, { time_estimate: v })}
        />

        <DueField
          value={t.due_date}
          onChange={(v) => handlers.onPatch(t.id, { due_date: v })}
        />

        {/* Coverage: how much of this step has calendar time behind it. */}
        <button
          type="button"
          onClick={() => handlers.onSchedule(t.id)}
          title={
            scheduled > 0
              ? `${formatMinutes(scheduled)} of ${formatMinutes(estimate)} scheduled — click to add more`
              : "Not scheduled — click to commit calendar time"
          }
          className={cn(
            "shrink-0 inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] tabular-nums transition-colors",
            scheduled === 0
              ? "text-muted-foreground/50 hover:text-primary hover:bg-secondary"
              : scheduled >= estimate
                ? "text-emerald-500 hover:bg-secondary"
                : "text-amber-500 hover:bg-secondary",
          )}
        >
          <CalendarClock className="h-2.5 w-2.5" />
          {scheduled > 0 ? formatMinutes(scheduled) : "—"}
        </button>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
          <IconBtn title="Add sub-step" onClick={() => setComposingUnder(t.id)}>
            <CornerDownRight className="h-3 w-3" />
          </IconBtn>
          <IconBtn
            title="Indent — tuck under the step above"
            disabled={!canIndent}
            onClick={() => handlers.onReparent(t.id, siblings[index - 1].task.id)}
          >
            <Indent className="h-3 w-3" />
          </IconBtn>
          <IconBtn
            title="Outdent"
            disabled={!canOutdent}
            onClick={() => handlers.onReparent(t.id, parent.task.parent_id)}
          >
            <Outdent className="h-3 w-3" />
          </IconBtn>
          <IconBtn title="Delete step" onClick={() => handlers.onDelete(t.id)} danger>
            <X className="h-3 w-3" />
          </IconBtn>
        </div>
      </div>

      {!isCollapsed && node.children.map((child, i) => (
        <BreakdownRow
          key={child.task.id}
          node={child}
          parent={node}
          siblings={node.children}
          index={i}
          ctx={ctx}
        />
      ))}

      {composingUnder === t.id && (
        <NewRowInput
          depth={node.depth + 1}
          onCommit={(title, andAnother) => {
            handlers.onAddChild(t.id, title);
            setComposingUnder(andAnother ? t.id : null);
          }}
          onCancel={() => setComposingUnder(null)}
        />
      )}
    </div>
  );
}

function IconBtn({ children, title, onClick, disabled, danger }: {
  children: React.ReactNode; title: string; onClick: () => void;
  disabled?: boolean; danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "p-1 rounded hover:bg-secondary text-muted-foreground transition-colors",
        "disabled:opacity-20 disabled:hover:bg-transparent",
        danger ? "hover:text-destructive" : "hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** Inline minutes field. A derived roll-up is shown read-only — see taskTree.ts. */
function EstimateField({ minutes, derived, onChange }: {
  minutes: number | null;
  derived: boolean;
  onChange: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (derived) {
    return (
      <span
        className="shrink-0 w-12 text-right text-[10px] text-muted-foreground/70 tabular-nums"
        title="Summed from the steps below"
      >
        {formatMinutes(minutes ?? 0)}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        min={0}
        value={draft}
        placeholder="min"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const raw = draft.trim();
          const n = raw === "" ? null : Number(raw);
          onChange(n != null && Number.isFinite(n) ? Math.max(0, n) : null);
          setEditing(false);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        className="shrink-0 w-12 bg-transparent border-b border-primary/40 text-[10px] text-right outline-none tabular-nums"
      />
    );
  }

  return (
    <button
      type="button"
      title="Time required"
      onClick={() => { setDraft(minutes != null ? String(minutes) : ""); setEditing(true); }}
      className={cn(
        "shrink-0 w-12 text-right text-[10px] tabular-nums rounded hover:bg-secondary transition-colors",
        minutes != null ? "text-muted-foreground" : "text-muted-foreground/40",
      )}
    >
      {minutes != null ? formatMinutes(minutes) : "est"}
    </button>
  );
}

/**
 * Per-step due date.
 *
 * This column is what makes "a subtask need not share the goal's date" real:
 * every step owns its deadline independently of the thing it rolls up into.
 */
function DueField({ value, onChange }: {
  value: string | null;
  onChange: (v: string | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative shrink-0 w-14">
      <input
        ref={ref}
        type="date"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
        title="Due date for this step"
      />
      <span
        className={cn(
          "block text-right text-[10px] tabular-nums pointer-events-none",
          value ? "text-muted-foreground" : "text-muted-foreground/40",
        )}
      >
        {value ? formatDateShort(value) : "date"}
      </span>
    </span>
  );
}

/** The empty row that captures a new step. Enter commits and opens another. */
function NewRowInput({ depth, onCommit, onCancel }: {
  depth: number;
  onCommit: (title: string, andAnother: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  // Enter re-renders this same input with a cleared value; committing on blur
  // would then fire a second time with the stale text. This guard makes the
  // blur handler a no-op once Enter has already taken the value.
  const committed = useRef(false);

  return (
    <div className="flex items-center gap-1.5 py-1" style={{ paddingLeft: `${(depth - 1) * 18 + 22}px` }}>
      <Plus className="h-3 w-3 shrink-0 text-muted-foreground/50" />
      <input
        autoFocus
        value={value}
        placeholder="Step title — Enter for another, Esc to finish"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            const v = value.trim();
            if (!v) { committed.current = true; onCancel(); return; }
            onCommit(v, true);
            setValue("");
          }
          if (e.key === "Escape") { committed.current = true; onCancel(); }
        }}
        onBlur={() => {
          if (committed.current) return;
          const v = value.trim();
          if (v) onCommit(v, false);
          else onCancel();
        }}
        className="flex-1 min-w-0 bg-transparent border-b border-primary/40 text-sm outline-none py-0.5 placeholder:text-muted-foreground/40"
      />
    </div>
  );
}
