// The three views a `pathfinderBlock` can wear.
//
// They deliberately do not converge on a shared "row" component. A to-do list is
// a column of sentences you tick; a board is a spatial arrangement you move
// things around in; a table is a grid you scan and edit cell by cell. Forcing
// one renderer to serve all three is how you get a board whose cards are table
// rows lying on their side. What IS shared is the write path — every one goes
// through the `TaskActions` the shell builds, so the ISA split and the
// scheduling gate are enforced identically whichever view you are looking at.
//
// ── Hierarchy lives in two of the three, and that is not an omission ─────────
//
// PathFinder tasks are recursive: a task's steps are tasks, with steps of their
// own. The list and the table render that as indentation with a disclosure
// triangle, over rows `runTreeQuery` has already nested (see
// @nexus/core/pathfinder/tree.ts — the nesting rules and their edge cases are
// tested there, not here).
//
// The board does not nest, because a Kanban card cannot contain another card
// without ceasing to be one. It shows a subtask roll-up chip instead: "3/12" on
// the card, and the whole subtree one click away in the detail sheet. A board
// that tried to nest would either hide the steps or turn each column into a
// second, worse outline.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  groupTasks,
  memberName,
  statFor,
  PRIORITIES,
  STAGES,
  STAGE_LABELS,
  TASK_TYPE_LABELS,
  URGENCIES,
  type PfPlan,
  type PfTask,
  type PfTeamMember,
  type SubtreeStat,
  type TaskTreeRow,
  insertionIndexFromPointer,
  reorderedIds,
} from "@nexus/core/pathfinder";
import {
  axisDropValue,
  axisWriteField,
  boardColumns,
  boardStatuses,
  PF_COLUMN_LABELS,
  META_PCT_MAX,
  META_PCT_MIN,
  listColumns,
  columnWidths,
  aggregate,
  fmtFormulaValue,
  formulaContext,
  formulaFieldNames,
  meterFraction,
  type FormulaColumn,
  type FieldColumn,
  columnWeight,
  moveColumn,
  COL_WEIGHT_MAX,
  COL_WEIGHT_MIN,
  type PfBlockSpec,
  type PfColumn,
} from "../lib/pathfinderBlock";
import type { TaskActions, TreeControls } from "./PathfinderBlockView";
import { HOST_ATTR, hostAt, type BlockHost } from "../lib/pathfinderHosts";
import { coerceField, FIELD_VALUE_MAX } from "../lib/taskFields";
import { compile, type FormulaValue } from "../lib/formula";

/** What every view needs, whatever shape it renders it in. */
interface ViewCommon {
  /** This block's drop-host id, so a drag can tell another block from its own. */
  hostId: string;
  spec: PfBlockSpec;
  members: PfTeamMember[];
  actions: TaskActions;
  today: string;
  editable: boolean;
  /** Vault-only tags for one task. Never empty-vs-undefined — see `tagsFor`. */
  tagsOf: (taskId: number) => string[];
  /** Shared with note tags, so one word means one colour everywhere in Vault. */
  tagColor: (tag: string) => string | undefined;
}

/** How a task's assignment reads on a card or row, or null when it has none. */
function assigneeLabel(task: PfTask, members: PfTeamMember[]): string | null {
  // `assigned_to` is documented as meaningless when `team_id` is null, so a
  // personal task shows nothing rather than "Unassigned" — it is not waiting
  // for anyone.
  if (!task.team_id) return null;
  if (task.assigned_to == null) return "Unassigned";
  if (task.assigned_to === "all") return "Everyone";
  return members.find((m) => m.user_id === task.assigned_to)?.display_name ?? memberName(task.assigned_to);
}

/** The same person on two teams is one option, not two. */
function dedupe(members: PfTeamMember[]): PfTeamMember[] {
  const seen = new Map<string, PfTeamMember>();
  for (const m of members) if (!seen.has(m.user_id)) seen.set(m.user_id, m);
  return [...seen.values()];
}

function AssigneeChip({ task, members }: { task: PfTask; members: PfTeamMember[] }) {
  const label = assigneeLabel(task, members);
  if (!label) return null;
  const unassigned = task.assigned_to == null;
  return (
    <span
      className={`pf-tag pf-tag-who${unassigned ? " is-unassigned" : ""}`}
      title={unassigned ? "Shared task, nobody has claimed it" : `Assigned to ${label}`}
    >
      {label}
    </span>
  );
}

// ─── Shared bits ────────────────────────────────────────────────────────────

/** Minutes as the shortest honest string: 45m, 1h, 2h30. */
function fmtEstimate(min: number | null): string {
  if (!min || min <= 0) return "";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${m}` : `${h}h`;
}

function fmtDue(due: string | null, today: string): { text: string; tone: "overdue" | "today" | "soon" | "none" } {
  if (!due) return { text: "", tone: "none" };
  if (due < today) return { text: shortDate(due), tone: "overdue" };
  if (due === today) return { text: "Today", tone: "today" };
  return { text: shortDate(due), tone: "soon" };
}

function shortDate(iso: string): string {
  // Parsed as local midnight, not UTC. `new Date("2026-08-27")` is UTC midnight,
  // which renders as the 26th anywhere west of Greenwich — a due date that
  // silently shows the wrong day is worse than no due date.
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/**
 * Click-to-edit text that commits on blur or Enter and reverts on Escape.
 *
 * Kept uncontrolled while focused: re-rendering a controlled input from the
 * shared store mid-keystroke (another block's refetch landing, say) would move
 * the caret to the end of the word.
 */
function EditableText({
  value, onCommit, disabled, className, placeholder, multilineHint,
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  multilineHint?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  if (disabled || !editing) {
    return (
      <span
        className={`pf-editable${disabled ? " is-locked" : ""} ${className ?? ""}`}
        title={multilineHint ?? (disabled ? undefined : "Click to rename")}
        onClick={() => !disabled && setEditing(true)}
      >
        {value || <span className="pf-placeholder">{placeholder ?? "Untitled"}</span>}
      </span>
    );
  }

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next && next !== value) onCommit(next);
    else setDraft(value);
  };

  return (
    <input
      ref={ref}
      className={`pf-edit-input ${className ?? ""}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); setDraft(value); setEditing(false); }
        // The block is an atom inside a document; without this, arrow keys and
        // Backspace reach ProseMirror's keymap and move the selection out.
        e.stopPropagation();
      }}
    />
  );
}

function PriorityDot({ priority }: { priority: string }) {
  return <span className={`pf-dot pf-dot-${priority}`} title={`Priority: ${priority}`} aria-hidden="true" />;
}

function DueChip({ due, today }: { due: string | null; today: string }) {
  const { text, tone } = fmtDue(due, today);
  if (!text) return null;
  return <span className={`pf-due pf-due-${tone}`}>{text}</span>;
}

/**
 * A task's Vault tags.
 *
 * The colour comes from `vault_tag_colors`, the same table the note tags use, so
 * "reading" is one colour across the graph, the tag panel and every task block.
 * Untinted tags fall back to the neutral chip rather than picking a colour —
 * a generated colour would disagree with the one the user later chooses.
 */
function TagChips({
  tags, tagColor, onRemove,
}: {
  tags: string[];
  tagColor: (tag: string) => string | undefined;
  onRemove?: (tag: string) => void;
}) {
  if (tags.length === 0) return null;
  return (
    <>
      {tags.map((t) => {
        const c = tagColor(t);
        return (
          <span
            key={t}
            className="pf-tag pf-tag-vault"
            style={c ? { background: `${c}22`, color: c, borderColor: `${c}55` } : undefined}
            title={`Vault tag — not visible in PathFinder`}
          >
            #{t}
            {onRemove ? (
              <button
                type="button"
                className="pf-tag-x"
                aria-label={`Remove tag ${t}`}
                onClick={() => onRemove(t)}
              >
                ×
              </button>
            ) : null}
          </span>
        );
      })}
    </>
  );
}

/**
 * The "3/12" roll-up on a task that has steps.
 *
 * Counts every descendant in the whole dataset, not the ones this view happens
 * to be showing — the same choice `aggregate_estimate` makes server-side. A
 * roll-up that changes when you change the filter is not a roll-up.
 */
function SubtaskProgress({ stat }: { stat: SubtreeStat }) {
  if (stat.total === 0) return null;
  const pct = Math.round((stat.done / stat.total) * 100);
  const complete = stat.done === stat.total;
  return (
    <span
      className={`pf-progress${complete ? " is-complete" : ""}`}
      title={`${stat.done} of ${stat.total} step${stat.total === 1 ? "" : "s"} done`}
    >
      <span className="pf-progress-bar" aria-hidden="true">
        <span className="pf-progress-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="pf-progress-num">{stat.done}/{stat.total}</span>
    </span>
  );
}

/**
 * The disclosure control, and the "+N" that stands in for it.
 *
 * A row with children toggles. A row whose children the FILTER is hiding gets a
 * different affordance entirely — clicking it pulls that one subtree in rather
 * than changing the block's filter, which would be a heavy answer to "what else
 * is under this one?". Rendering the same triangle for both would promise an
 * expand that reveals nothing.
 *
 * A row with neither still renders the spacer: without it every leaf's checkbox
 * sits one notch left of its siblings' and the column stops reading as a column.
 */
function Disclosure({
  row, onToggle, onExpandHidden,
}: {
  row: TaskTreeRow;
  onToggle: (id: number) => void;
  onExpandHidden: (id: number) => void;
}) {
  if (row.childCount > 0) {
    return (
      <button
        type="button"
        className={`pf-disclose${row.collapsed ? "" : " is-open"}`}
        aria-expanded={!row.collapsed}
        aria-label={row.collapsed ? `Show steps of ${row.task.title}` : `Hide steps of ${row.task.title}`}
        title={row.collapsed ? "Show steps" : "Hide steps"}
        onClick={() => onToggle(row.task.id)}
      >
        ▸
      </button>
    );
  }

  if (row.hiddenChildren > 0) {
    return (
      <button
        type="button"
        className="pf-disclose is-hidden-kids"
        aria-label={`Show ${row.hiddenChildren} step${row.hiddenChildren === 1 ? "" : "s"} the filter is hiding`}
        title={`${row.hiddenChildren} step${row.hiddenChildren === 1 ? "" : "s"} hidden by this block's filter — show them anyway`}
        onClick={() => onExpandHidden(row.task.id)}
      >
        +{row.hiddenChildren}
      </button>
    );
  }

  return <span className="pf-disclose is-empty" aria-hidden="true" />;
}

/** The row action that is always available and always destructive. */
function DeleteButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="pf-row-del"
      title="Delete task"
      aria-label="Delete task"
      disabled={disabled}
      onClick={onClick}
    >
      ×
    </button>
  );
}

function DetailButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      className="pf-row-detail"
      title={`Open details for “${title}”`}
      aria-label={`Open details for ${title}`}
      onClick={onClick}
    >
      ⋯
    </button>
  );
}

function SubtaskButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      className="pf-row-sub"
      title="Add a step under this task"
      aria-label="Add a step under this task"
      disabled={disabled}
      onClick={onClick}
    >
      ⤵
    </button>
  );
}

/**
 * The inline "add a step" input.
 *
 * Enter commits and keeps the field open, so three steps are three keystrokes
 * plus three Enters rather than three round trips through a button. Escape and
 * blur close it — and blur COMMITS first, matching the list's own add row, so a
 * typed step is never silently discarded by clicking elsewhere.
 */
function InlineAdd({
  depth, placeholder, onSubmit, onClose,
}: {
  depth: number;
  placeholder: string;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState("");
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { ref.current?.focus(); }, []);

  const commit = (keepOpen: boolean) => {
    const text = draft.trim();
    if (text) {
      setDraft("");
      onSubmit(text);
    }
    if (!keepOpen) onClose();
  };

  return (
    <div className="pf-list-row pf-subadd" style={{ "--pf-depth": depth } as React.CSSProperties}>
      <span className="pf-disclose is-empty" aria-hidden="true" />
      <span className="pf-add-plus" aria-hidden="true">↳</span>
      <input
        ref={ref}
        className="pf-add-input"
        value={draft}
        placeholder={placeholder}
        aria-label={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(true); }
          if (e.key === "Escape") { e.preventDefault(); setDraft(""); onClose(); }
          e.stopPropagation();
        }}
        onBlur={() => commit(false)}
      />
    </div>
  );
}

// ─── List ───────────────────────────────────────────────────────────────────

export function PfListView({
  hostId, rows, spec, members, actions, today, editable, tagsOf, tagColor, tree, onAdd, onSpecChange,
}: ViewCommon & {
  rows: TaskTreeRow[];
  tree: TreeControls;
  onAdd: (title: string) => void;
  /** Commits the meta-strip width after a drag. Omitted when not editable. */
  onSpecChange?: (next: PfBlockSpec) => void;
}) {
  const [draft, setDraft] = useState("");
  /** Which row currently has an open "add a step" field. One at a time. */
  const [addingUnder, setAddingUnder] = useState<number | null>(null);
  const cols = useMemo(() => listColumns(spec), [spec]);
  const listRef = useRef<HTMLDivElement>(null);

  // The same gesture the board uses, for one purpose only: carrying a row OUT
  // of this block and into another one. A drop back inside does nothing.
  //
  // Re-ordering or re-parenting within a list is a genuinely different
  // question — a list is a tree, so "dropped on that row" is ambiguous between
  // "before it" and "inside it" — and answering it by accident here would be
  // worse than not answering it.
  const { dragId: rowDragId, handlers: rowDrag } = useCardDrag({
    enabled: editable,
    onDrop: (taskId, _col, _slot, dropHost) => {
      if (!dropHost || dropHost.id === hostId) return;
      const task = rows.find((r) => r.task.id === taskId)?.task;
      if (task) actions.moveToHost(task, dropHost);
    },
  });

  // ── Dragging the title / metadata split ─────────────────────────────────
  //
  // The grip writes a CSS custom property straight to the DOM on every
  // pointermove and commits ONE transaction on release. A transaction per move
  // would be ~60 document rewrites a second, each waking the note's 400 ms
  // autosave — the shape of the 2026-08-15 incident, and the same rule the
  // column-resize plugin in extensions/structural follows.
  const dragRef = useRef<{ pointerId: number } | null>(null);

  const applyPct = useCallback((pct: number) => {
    listRef.current?.style.setProperty("--pf-meta-pct", `${pct}%`);
  }, []);

  const pctFromEvent = useCallback((clientX: number): number => {
    const el = listRef.current;
    if (!el) return spec.metaPct || META_PCT_MIN;
    const box = el.getBoundingClientRect();
    if (box.width <= 0) return spec.metaPct || META_PCT_MIN;
    // Measured from the RIGHT edge: the grip sits at the metadata strip's left
    // boundary, so dragging left widens it.
    const pct = ((box.right - clientX) / box.width) * 100;
    return Math.min(META_PCT_MAX, Math.max(META_PCT_MIN, Math.round(pct)));
  }, [spec.metaPct]);

  const onGripDown = useCallback((e: React.PointerEvent) => {
    if (!onSpecChange) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { pointerId: e.pointerId };
    applyPct(pctFromEvent(e.clientX));
  }, [onSpecChange, applyPct, pctFromEvent]);

  const onGripMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    applyPct(pctFromEvent(e.clientX));
  }, [applyPct, pctFromEvent]);

  const onGripUp = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    onSpecChange?.({ ...spec, metaPct: pctFromEvent(e.clientX) });
  }, [onSpecChange, pctFromEvent, spec]);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onAdd(text);
  };

  return (
    <div
      className={`pf-list${spec.metaPct ? " has-split" : ""}`}
      ref={listRef}
      style={spec.metaPct ? ({ "--pf-meta-pct": `${spec.metaPct}%` } as React.CSSProperties) : undefined}
    >
      {/* One grip for the whole block, not one per row: the split is a property
          of the list, and 27 identical handles would be 27 things to hit by
          accident. Hidden until the block is hovered — see the CSS. */}
      {onSpecChange && rows.length > 0 ? (
        <div
          className="pf-meta-grip"
          role="separator"
          aria-orientation="vertical"
          aria-label="Drag to resize the metadata column"
          title="Drag to resize · double-click to reset"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onDoubleClick={() => onSpecChange({ ...spec, metaPct: 0 })}
        />
      ) : null}
      {rows.map((r) => {
        const t = r.task;
        const tags = tagsOf(t.id);
        const busy = actions.busy.has(t.id);
        return (
          <div key={t.id}>
            <div
              className={
                `pf-list-row${t.done ? " is-done" : ""}${busy ? " is-busy" : ""}` +
                `${r.depth > 0 ? " is-step" : ""}${rowDragId === t.id ? " is-dragging" : ""}`
              }
              style={{ "--pf-depth": r.depth } as React.CSSProperties}
              onPointerDown={(e) => rowDrag.onPointerDown(e, t.id)}
            >
              <Disclosure row={r} onToggle={tree.toggleCollapse} onExpandHidden={tree.expandHidden} />

              {cols.has("done") ? (
                <input
                  type="checkbox"
                  className="pf-check"
                  checked={t.done}
                  disabled={busy}
                  aria-label={t.done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
                  onChange={() => actions.toggle(t)}
                />
              ) : null}

              {cols.has("priority") ? <PriorityDot priority={t.priority} /> : null}

              <EditableText
                value={t.title}
                className="pf-list-title"
                disabled={!editable}
                onCommit={(title) => actions.patch(t, { title })}
              />

              {/* Every chip below is now opt-out. It used to render
                  unconditionally, which is how a narrow note column showed the
                  SAME plan name and the same "Unassigned" on all 27 rows while
                  the titles were squeezed to one letter per line. The fix is not
                  to guess which ones matter — it is to let the block say. */}
              <span className="pf-meta">
                <SubtaskProgress stat={statFor(actions.stats, t.id)} />
                {spec.showTags ? <TagChips tags={tags} tagColor={tagColor} /> : null}
                {cols.has("plan") && t.plan_title ? <span className="pf-tag">{t.plan_title}</span> : null}
                {cols.has("goal") && t.goal_title ? <span className="pf-tag pf-tag-goal">{t.goal_title}</span> : null}
                {cols.has("assignee") ? <AssigneeChip task={t} members={members} /> : null}
                {cols.has("type") && t.task_type !== "task" ? <span className="pf-tag pf-tag-kind">{TASK_TYPE_LABELS[t.task_type]}</span> : null}
                {cols.has("estimate") && t.aggregate_estimate ? <span className="pf-tag pf-tag-est">{fmtEstimate(t.aggregate_estimate)}</span> : null}
                {cols.has("due") ? <DueChip due={t.due_date} today={today} /> : null}
              </span>

              <span className="pf-row-actions">
                <DetailButton onClick={() => actions.openDetail(t)} title={t.title} />
                {editable ? (
                  <>
                    <SubtaskButton
                      disabled={busy}
                      onClick={() => setAddingUnder((cur) => (cur === t.id ? null : t.id))}
                    />
                    <DeleteButton onClick={() => actions.remove(t)} disabled={busy} />
                  </>
                ) : null}
              </span>
            </div>

            {addingUnder === t.id && editable ? (
              <InlineAdd
                depth={r.depth + 1}
                placeholder={`Step of “${t.title}”…`}
                onSubmit={(title) => actions.addSubtask(t, title)}
                onClose={() => setAddingUnder(null)}
              />
            ) : null}
          </div>
        );
      })}

      {editable ? (
        <div className="pf-add">
          <span className="pf-add-plus" aria-hidden="true">+</span>
          <input
            className="pf-add-input"
            value={draft}
            placeholder={addPlaceholder(spec)}
            aria-label="Add a task"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submit(); }
              if (e.key === "Escape") { e.preventDefault(); setDraft(""); (e.target as HTMLInputElement).blur(); }
              e.stopPropagation();
            }}
            onBlur={submit}
          />
        </div>
      ) : null}
    </div>
  );
}

/**
 * The add-row says where the task will land.
 *
 * The block's filter doubles as its creation context, and that is only a good
 * idea if it is visible — silently filing a task into a plan the user forgot
 * they had filtered to is worse than making them pick.
 */
function addPlaceholder(spec: PfBlockSpec): string {
  if (spec.tags.length === 1 && spec.tagMode !== "none") return `Add a task tagged #${spec.tags[0]}…`;
  if (spec.filter.planIds.length === 1) return "Add a task to this plan…";
  if (spec.filter.due === "today") return "Add a task due today…";
  return "Add a task…";
}

// ─── Board ──────────────────────────────────────────────────────────────────

export function PfBoardView({
  hostId, tasks, spec, plans, members, actions, today, editable, tagsOf, tagColor, onSpecChange,
}: ViewCommon & {
  tasks: PfTask[];
  plans: PfPlan[];
  onSpecChange: (next: PfBlockSpec) => void;
}) {
  const axis = spec.groupBy;
  const columns = boardColumns(axis, plans, members, boardStatuses(spec));
  const groups = groupTasks(tasks, axis, columns, axis === "assignee" ? "Personal" : "Other");
  const writeField = axisWriteField(axis);

  // Reordering is only meaningful under manual sort. Under any other key the
  // board recomputes the order from the data, so a drag would write sort_order
  // that nothing displays — a gesture that appears to do nothing, which is
  // worse than one that is refused. The board defaults to manual.
  const canReorder = editable && spec.sort.key === "manual";

  const { dragId, overKey, overSlot, handlers } = useCardDrag({
    enabled: editable && (writeField != null || canReorder),
    onDrop: (taskId, colKey, slot, dropHost) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Dropped on a DIFFERENT block: that block's filter decides everything,
      // so neither the column nor the slot means anything here.
      if (dropHost && dropHost.id !== hostId) {
        actions.moveToHost(task, dropHost);
        return;
      }
      if (colKey === "__other__" || !colKey) return;

      // Same column: this is a reorder, not a move. The axis value is already
      // right, and writing it again would be a no-op round trip.
      const from = groups.find((g) => g.tasks.some((t) => t.id === taskId));
      if (from?.key === colKey) {
        if (!canReorder) return;
        const ids = from.tasks.map((t) => t.id);
        // `reorderedIds` returns null for the two slots either side of the
        // dragged card, which change nothing — so a nudge writes no rows.
        const next = reorderedIds(ids, ids.indexOf(taskId), slot);
        if (next) actions.reorder(next);
        return;
      }

      if (!writeField) return;
      // Assigning a task that belongs to nobody's team has no meaning — the
      // column would claim an owner for work that is not shared. Refuse rather
      // than writing a field the model says is meaningless.
      if (writeField === "assigned_to" && !task.team_id) return;
      const value = axisDropValue(axis, colKey);
      // `stage` alone goes through setStage: 'active' is gated on the task
      // having scheduled calendar time, and that rule lives in the api.
      if (writeField === "stage") actions.setStage(task, String(value));
      else actions.patch(task, { [writeField]: value });
    },
  });

  return (
    <div className="pf-board-wrap">
      {writeField == null ? (
        <div className="pf-board-note">
          {/* Saying so beats offering a drag that silently does nothing:
              `task_type` is a generated column, and moving a task between plans
              has goal-linkage consequences that belong in PathFinder. */}
          Grouped by {axis === "plan" ? "plan" : "kind"} — drag is off for this axis. Group by
          {" "}
          <button type="button" className="pf-inline-btn" onClick={() => onSpecChange({ ...spec, groupBy: "kanban_status" })}>
            status
          </button>{" "}
          to move cards.
        </div>
      ) : null}

      <div className="pf-board">
        {groups.map((g) => (
          <section
            className={`pf-col${overKey === g.key ? " is-over" : ""}${g.key === "__other__" ? " is-other" : ""}`}
            key={g.key}
            data-col={g.key}
          >
            <header className="pf-col-head">
              <span className="pf-col-title">{g.label}</span>
              <span className="pf-col-count">{g.tasks.length}</span>
            </header>

            <div className="pf-col-body">
              {g.tasks.map((t, i) => (
                <React.Fragment key={t.id}>
                {/* The gap the card would land in. Shown only for the column
                    under the pointer, and only when a reorder would actually
                    result — no line where the drop is a no-op. */}
                {dragId != null && overKey === g.key && overSlot === i && canReorder ? (
                  <div className="pf-drop-line" aria-hidden="true" />
                ) : null}
                <article
                  className={`pf-card${dragId === t.id ? " is-dragging" : ""}${t.done ? " is-done" : ""}${actions.busy.has(t.id) ? " is-busy" : ""}`}
                  data-card={t.id}
                  onPointerDown={(e) => handlers.onPointerDown(e, t.id)}
                >
                  <div className="pf-card-top">
                    <input
                      type="checkbox"
                      className="pf-check"
                      checked={t.done}
                      disabled={actions.busy.has(t.id)}
                      aria-label={`Mark “${t.title}” ${t.done ? "not done" : "done"}`}
                      // The card's pointerdown arms a drag; a tick must not.
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={() => actions.toggle(t)}
                    />
                    <EditableText
                      value={t.title}
                      className="pf-card-title"
                      disabled={!editable}
                      onCommit={(title) => actions.patch(t, { title })}
                    />
                    <span className="pf-row-actions" onPointerDown={(e) => e.stopPropagation()}>
                      <DetailButton onClick={() => actions.openDetail(t)} title={t.title} />
                    </span>
                  </div>

                  <div className="pf-card-meta">
                    <PriorityDot priority={t.priority} />
                    {/* A card cannot nest, so the subtree shows as a roll-up and
                        the detail sheet is where the steps themselves live. */}
                    <SubtaskProgress stat={statFor(actions.stats, t.id)} />
                    {spec.showTags ? <TagChips tags={tagsOf(t.id)} tagColor={tagColor} /> : null}
                    {/* Suppressed when the board is already grouped by person —
                        a chip repeating the column header is noise. */}
                    {axis !== "assignee" ? <AssigneeChip task={t} members={members} /> : null}
                    {t.plan_title ? <span className="pf-tag">{t.plan_title}</span> : null}
                    {t.aggregate_estimate ? <span className="pf-tag pf-tag-est">{fmtEstimate(t.aggregate_estimate)}</span> : null}
                    <DueChip due={t.due_date} today={today} />
                  </div>
                </article>
                </React.Fragment>
              ))}
              {/* The gap after the last card. `slot === length` is a real slot
                  in `insertionIndexFromPointer`'s numbering, and without this
                  the one drop position users reach for most has no indicator. */}
              {dragId != null && overKey === g.key && overSlot === g.tasks.length && canReorder ? (
                <div className="pf-drop-line" aria-hidden="true" />
              ) : null}

              {g.tasks.length === 0 ? <div className="pf-col-empty">Drop here</div> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * Pointer-driven card dragging.
 *
 * HTML5 drag-and-drop is not an option here for two independent reasons: touch
 * never fires `dragstart`, so the board would be undraggable on the iPad that
 * Vault explicitly targets; and setting `draggable` inside a ProseMirror node
 * view collides with the node's own drag handling exactly as BlockHandle.ts
 * documents from the other side.
 *
 * Mouse arms on movement, touch arms on a hold. That asymmetry is not a
 * preference — on a touch screen the same gesture that starts a drag also
 * scrolls the board, and the hold is what disambiguates them. Arming on movement
 * would make the board impossible to scroll sideways.
 */
const TOUCH_HOLD_MS = 260;
const MOUSE_SLOP_PX = 5;

function useCardDrag({
  enabled, onDrop,
}: {
  enabled: boolean;
  /**
   * `slot` is the insertion index WITHIN the target column, in the same
   * numbering `reorderedIds` expects: slot i means "before the card currently
   * at index i", and length means "after the last one".
   */
  onDrop: (taskId: number, columnKey: string, slot: number, dropHost: BlockHost | null) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);

  // The whole gesture lives in a ref, and the window listeners are attached
  // imperatively in pointerdown rather than by an effect keyed on state. An
  // effect would be a deadlock: it could only attach once the drag has ARMED,
  // but arming is itself decided by the pointermove that the listener would
  // have delivered — so the drag could never start.
  const gesture = useRef<{
    id: number;
    startX: number;
    startY: number;
    armed: boolean;
    holdTimer: number | null;
    pointerId: number;
    detach: () => void;
  } | null>(null);

  const columnAt = (x: number, y: number): HTMLElement | null => {
    const el = document.elementFromPoint(x, y);
    return ((el as HTMLElement | null)?.closest?.("[data-col]") as HTMLElement | null) ?? null;
  };

  /**
   * Which gap in this column the pointer is over.
   *
   * Geometry is read from the DOM at the moment it is needed rather than
   * cached at pointerdown: the board reflows while a drag is in flight (a
   * column highlights, a card animates), and a cached rect drops the card in
   * the wrong gap without ever looking wrong on screen.
   *
   * The slot arithmetic itself is `insertionIndexFromPointer` from
   * @nexus/core/pathfinder — the same function PathFinder's row reorder uses,
   * rather than a second copy that would disagree about the edges.
   */
  /**
   * Mark the block under the pointer as the drop target.
   *
   * A DOM attribute rather than React state, and deliberately: the hovered
   * block is a different React tree from the dragged one, so lifting this into
   * state would mean re-rendering every block in the note on every
   * pointermove — sixty times a second, each one a task list.
   */
  const markDropTarget = (el: HTMLElement | null) => {
    for (const prev of document.querySelectorAll("[data-pf-drop]")) {
      prev.removeAttribute("data-pf-drop");
    }
    const root = el?.closest(`[${HOST_ATTR}]`);
    if (root) root.setAttribute("data-pf-drop", "");
  };

  const slotAt = (col: HTMLElement | null, y: number): number => {
    if (!col) return 0;
    const cards = Array.from(col.querySelectorAll<HTMLElement>("[data-card]"));
    return insertionIndexFromPointer(
      y,
      cards.map((c) => {
        const b = c.getBoundingClientRect();
        return { top: b.top, height: b.height };
      }),
    );
  };

  const end = useCallback((commit: { x: number; y: number } | null) => {
    const g = gesture.current;
    if (!g) return;
    if (g.holdTimer) window.clearTimeout(g.holdTimer);
    g.detach();
    gesture.current = null;
    setDragId(null);
    setOverKey(null);
    setOverSlot(null);
    markDropTarget(null);

    if (commit && g.armed) {
      const col = columnAt(commit.x, commit.y);
      const key = col?.dataset.col ?? null;
      // Resolved here rather than in the caller: by the time a React handler
      // runs the pointer has moved on, and `elementFromPoint` would answer
      // about wherever it is now.
      const dropHost = hostAt(commit.x, commit.y);
      // A drop on ANOTHER block is a move, and it does not need a column — the
      // target block decides where the task lands from its own filter. Only a
      // drop inside this block needs the column, and `__other__` is the
      // catch-all bucket rather than a state anything can be moved INTO.
      if (dropHost || (key && key !== "__other__")) {
        onDrop(g.id, key ?? "", slotAt(col, commit.y), dropHost);
      }
    }
  }, [onDrop]);

  // A gesture in flight when the block unmounts would leave listeners on window.
  useEffect(() => () => { gesture.current?.detach(); gesture.current = null; }, []);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>, id: number) => {
    if (!enabled || e.button !== 0 || gesture.current) return;

    const onMove = (ev: PointerEvent) => {
      const g = gesture.current;
      if (!g || ev.pointerId !== g.pointerId) return;

      if (!g.armed) {
        const moved = Math.hypot(ev.clientX - g.startX, ev.clientY - g.startY);
        if (ev.pointerType === "touch") {
          // Movement before the hold elapses is a scroll, not a drag. Abandon
          // the gesture rather than hijacking it — otherwise the board cannot
          // be scrolled sideways on a touch screen at all.
          if (moved > MOUSE_SLOP_PX * 2) end(null);
          return;
        }
        if (moved < MOUSE_SLOP_PX) return;
        g.armed = true;
        setDragId(g.id);
      }

      // Only once armed. Preventing the default earlier would swallow the very
      // scroll gesture we just decided not to take over.
      ev.preventDefault();
      const col = columnAt(ev.clientX, ev.clientY);
      setOverKey(col?.dataset.col ?? null);
      setOverSlot(col ? slotAt(col, ev.clientY) : null);
      markDropTarget(document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null);
    };

    const onUp = (ev: PointerEvent) => {
      if (gesture.current && ev.pointerId !== gesture.current.pointerId) return;
      end({ x: ev.clientX, y: ev.clientY });
    };

    const onCancel = () => end(null);

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);

    const g = {
      id,
      startX: e.clientX,
      startY: e.clientY,
      armed: false,
      holdTimer: null as number | null,
      pointerId: e.pointerId,
      detach: () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      },
    };
    gesture.current = g;

    if (e.pointerType === "touch") {
      g.holdTimer = window.setTimeout(() => {
        if (gesture.current === g) { g.armed = true; setDragId(id); }
      }, TOUCH_HOLD_MS);
    }
  }, [enabled, end]);

  return { dragId, overKey, overSlot, handlers: { onPointerDown } };
}

/** A stable empty list: an inline `[]` would be a new identity every render
 *  and would defeat every memo keyed on the field list. */
const EMPTY_FIELDS_LIST: FieldColumn[] = [];

// ─── Table ──────────────────────────────────────────────────────────────────

export function PfTableView({
  rows, spec, members, actions, today, editable, tagsOf, tagColor, tree, onSpecChange,
}: ViewCommon & {
  rows: TaskTreeRow[];
  tree: TreeControls;
  onSpecChange: (next: PfBlockSpec) => void;
}) {
  const cols = spec.columns;
  // Stored columns are hidden entirely when the table does not exist yet, rather
  // than drawn as a wall of blanks — "unavailable" and "nobody has filled this
  // in" are different states and must not look the same. Same rule as tags.
  const fields = actions.fieldsAvailable ? spec.fields : EMPTY_FIELDS_LIST;
  const widths = useMemo(
    () => columnWidths(cols, spec.colWeights, spec.formulas.length, fields.length),
    [cols, spec.colWeights, spec.formulas.length, fields.length],
  );

  // Compiled once per formula, not once per row. 200 rows would otherwise be
  // 200 tokenisations of the same string — and, more to the point, a syntax
  // error is then known before any row is drawn, so the column can say
  // "unknown field: estimat" instead of rendering two hundred blanks.
  // The names a formula may read include this block's numeric stored columns,
  // so `budget * 1.25` compiles. Recompiling when the FIELD LIST changes is the
  // point: renaming a stored column must turn a formula reading it into a named
  // error, not a silently blank cell.
  const names = useMemo(() => formulaFieldNames(fields), [fields]);
  const compiled = useMemo(
    () => spec.formulas.map((f) => ({ col: f, prog: compile(f.expr, names) })),
    [spec.formulas, names],
  );

  // Every row's value for every formula column, computed once so the cells and
  // the footer agree and neither recomputes the other's work.
  const computed = useMemo(() => {
    const out = new Map<string, FormulaValue[]>();
    for (const { col, prog } of compiled) {
      out.set(col.id, prog.ok
        ? rows.map((r) => prog.run(formulaContext(
            r.task, statFor(actions.stats, r.task.id), today,
            { bag: actions.fieldsOf(r.task.id), cols: fields },
          )))
        : []);
    }
    return out;
  }, [compiled, rows, actions.stats, actions.fieldsOf, fields, today]);
  const tableRef = useRef<HTMLTableElement>(null);

  // ── Resizing ────────────────────────────────────────────────────────────
  //
  // A grip on each column's right edge transfers weight between it and its
  // neighbour, so the total stays put and the table never grows past its
  // container. The last data column has no grip: to its right is the actions
  // column, which is not the user's to size — widen the one before it instead,
  // which is what every table does.
  //
  // Widths are written straight onto the <col> elements during the drag and
  // committed as ONE transaction on release. Per-move transactions would be
  // ~60 document rewrites a second, each waking the note's 400ms autosave.
  const resizeRef = useRef<{ i: number; startX: number; a: number; b: number; width: number } | null>(null);

  // Every <col> in order, not just the data ones. Writing the actions width at
  // index `data.length` was correct only while the data columns were the last
  // ones — with stored and computed columns in between, that index is the first
  // stored column, so a drag squeezed it to the actions column's share and the
  // actions column kept a stale width until the next render.
  const paintWidths = useCallback((all: number[]) => {
    const colEls = tableRef.current?.querySelectorAll("col");
    if (!colEls) return;
    all.forEach((pct, i) => {
      const c = colEls[i] as HTMLElement | undefined;
      if (c) c.style.width = `${pct}%`;
    });
  }, []);

  const onResizeDown = useCallback((e: React.PointerEvent, i: number) => {
    if (!editable) return;
    e.preventDefault();
    e.stopPropagation();
    const width = tableRef.current?.getBoundingClientRect().width ?? 0;
    if (width <= 0) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = {
      i,
      startX: e.clientX,
      a: columnWeight(spec.colWeights, cols[i]),
      b: columnWeight(spec.colWeights, cols[i + 1]),
      width,
    };
  }, [editable, spec.colWeights, cols]);

  /** The weights this drag would produce, clamped so neither side collapses. */
  const resizeTo = useCallback((clientX: number): Record<string, number> | null => {
    const r = resizeRef.current;
    if (!r) return null;
    const total = cols.reduce((sum, c) => sum + columnWeight(spec.colWeights, c), 0);
    // Pixels → weight, in the same units the column already uses.
    const delta = ((clientX - r.startX) / r.width) * total;
    const pair = r.a + r.b;
    const a = Math.min(Math.max(r.a + delta, COL_WEIGHT_MIN), pair - COL_WEIGHT_MIN);
    return {
      ...spec.colWeights,
      [cols[r.i]]: Math.round(Math.min(a, COL_WEIGHT_MAX) * 100) / 100,
      [cols[r.i + 1]]: Math.round(Math.min(pair - a, COL_WEIGHT_MAX) * 100) / 100,
    };
  }, [cols, spec.colWeights]);

  const onResizeMove = useCallback((e: React.PointerEvent) => {
    const next = resizeTo(e.clientX);
    if (!next) return;
    const w = columnWidths(cols, next, spec.formulas.length, fields.length);
    paintWidths([...w.data, ...w.fields, ...w.formulas, w.actions]);
  }, [resizeTo, cols, spec.formulas.length, fields.length, paintWidths]);

  const onResizeUp = useCallback((e: React.PointerEvent) => {
    const next = resizeTo(e.clientX);
    resizeRef.current = null;
    try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* gone */ }
    if (next) onSpecChange({ ...spec, colWeights: next });
  }, [resizeTo, onSpecChange, spec]);

  // ── Reordering ──────────────────────────────────────────────────────────
  //
  // Pointer-based rather than HTML5 drag-and-drop: this table lives inside a
  // ProseMirror node view, and a native dragstart there competes with the
  // editor's own drag handling. Same reason BlockHandle is hand-rolled.
  const [dragCol, setDragCol] = useState<PfColumn | null>(null);
  const [dropCol, setDropCol] = useState<PfColumn | null>(null);

  const onHeadDown = useCallback((e: React.PointerEvent, c: PfColumn) => {
    if (!editable) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragCol(c);
  }, [editable]);

  const onHeadMove = useCallback((e: React.PointerEvent) => {
    if (!dragCol) return;
    // Which header is under the pointer? Read the DOM rather than tracking
    // offsets: the row reflows as columns move, so cached geometry goes stale.
    const ths = tableRef.current?.querySelectorAll<HTMLElement>("th[data-col]");
    if (!ths) return;
    for (const th of ths) {
      const b = th.getBoundingClientRect();
      if (e.clientX >= b.left && e.clientX <= b.right) {
        setDropCol((th.dataset.col as PfColumn) ?? null);
        return;
      }
    }
  }, [dragCol]);

  const onHeadUp = useCallback((e: React.PointerEvent) => {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* gone */ }
    // A press that never moved to another column is a CLICK, and a click on a
    // header sorts. Only an actual move reorders.
    if (dragCol && dropCol && dragCol !== dropCol) {
      onSpecChange({ ...spec, columns: moveColumn(cols, dragCol, dropCol) });
    } else if (dragCol) {
      sortBy(dragCol);
    }
    setDragCol(null);
    setDropCol(null);
  }, [dragCol, dropCol, cols, spec, onSpecChange]);

  const sortBy = (key: PfColumn) => {
    const map: Partial<Record<PfColumn, PfBlockSpec["sort"]["key"]>> = {
      title: "title", plan: "plan", priority: "priority",
      urgency: "urgency", due: "due", estimate: "estimate",
    };
    const next = map[key];
    if (!next || !editable) return;
    onSpecChange({
      ...spec,
      sort: spec.sort.key === next
        ? { key: next, dir: spec.sort.dir === "asc" ? "desc" : "asc" }
        : { key: next, dir: "asc" },
    });
  };

  return (
    // Wide content scrolls inside its own container — the note body must never
    // scroll horizontally.
    <div className="pf-table-wrap">
      <table className={`pf-table${dragCol ? " is-reordering" : ""}`} ref={tableRef}>
        {/* Proportional widths, so the table keeps its shape across the
            720px-to-full-bleed range a note can be, and on the iPad. The
            actions column is in the same total rather than a fixed px width —
            mixing px and % under `table-layout: fixed` leaves the browser to
            reconcile them. */}
        <colgroup>
          {cols.map((c, i) => <col key={c} style={{ width: `${widths.data[i]}%` }} />)}
          {fields.map((f, i) => <col key={f.key} style={{ width: `${widths.fields[i]}%` }} />)}
          {spec.formulas.map((f, i) => <col key={f.id} style={{ width: `${widths.formulas[i]}%` }} />)}
          <col style={{ width: `${widths.actions}%` }} />
        </colgroup>
        <thead>
          <tr>
            {cols.map((c, i) => (
              <th
                key={c}
                data-col={c}
                className={
                  `pf-th pf-th-${c}` +
                  (dragCol === c ? " is-dragging" : "") +
                  (dropCol === c && dragCol && dragCol !== c ? " is-drop" : "")
                }
                scope="col"
                // Sorting happens on pointer-UP when the press did not move to
                // another column — see onHeadUp. An onClick here as well would
                // fire after a reorder and sort by whatever was dropped.
                onPointerDown={(e) => onHeadDown(e, c)}
                onPointerMove={onHeadMove}
                onPointerUp={onHeadUp}
                onPointerCancel={onHeadUp}
              >
                <span className="pf-th-label">
                  {c === "done" ? "" : PF_COLUMN_LABELS[c]}
                  {sortIndicator(spec, c)}
                </span>
                {editable && i < cols.length - 1 ? (
                  <span
                    className="pf-col-grip"
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize the ${PF_COLUMN_LABELS[c]} column`}
                    onPointerDown={(e) => onResizeDown(e, i)}
                    onPointerMove={onResizeMove}
                    onPointerUp={onResizeUp}
                    onPointerCancel={onResizeUp}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      // Reset this pair to equal shares rather than to 1/1 —
                      // the rest of the table keeps whatever it was given.
                      const w = { ...spec.colWeights };
                      delete w[cols[i]];
                      delete w[cols[i + 1]];
                      onSpecChange({ ...spec, colWeights: w });
                    }}
                  />
                ) : null}
              </th>
            ))}
            {fields.map((f) => (
              <th key={f.key} className="pf-th pf-th-field" scope="col" title={`${f.label || f.key} — stored ${f.type}`}>
                <span className="pf-th-label">{f.label || f.key}</span>
              </th>
            ))}
            {compiled.map(({ col, prog }) => (
              <th key={col.id} className="pf-th pf-th-formula" scope="col"
                  title={prog.ok ? col.expr : `${col.expr} — ${prog.error}`}>
                <span className="pf-th-label">{col.label || col.expr}</span>
                {!prog.ok ? <span className="pf-th-bad" aria-label="invalid formula">!</span> : null}
              </th>
            ))}
            <th className="pf-th pf-th-act" scope="col" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr
              key={r.task.id}
              className={`${r.task.done ? "is-done" : ""}${actions.busy.has(r.task.id) ? " is-busy" : ""}${r.depth > 0 ? " is-step" : ""}`}
            >
              {cols.map((c) => (
                <Cell
                  key={c}
                  col={c}
                  row={r}
                  members={members}
                  actions={actions}
                  today={today}
                  editable={editable}
                  tagsOf={tagsOf}
                  tagColor={tagColor}
                  tree={tree}
                />
              ))}
              {fields.map((f) => (
                <FieldCell
                  key={f.key}
                  col={f}
                  taskId={r.task.id}
                  value={actions.fieldsOf(r.task.id)?.[f.key] ?? ""}
                  editable={editable}
                  onCommit={actions.setField}
                />
              ))}
              {compiled.map(({ col, prog }) => (
                <td key={col.id} className="pf-td pf-td-formula">
                  {prog.ok
                    ? <MeterCell col={col} value={computed.get(col.id)?.[ri] ?? null}
                                 column={computed.get(col.id) ?? []} />
                    : <span className="pf-formula-err" title={prog.error}>—</span>}
                </td>
              ))}
              <td className="pf-td pf-td-act">
                <span className="pf-row-actions">
                  <DetailButton onClick={() => actions.openDetail(r.task)} title={r.task.title} />
                  {editable ? (
                    <DeleteButton onClick={() => actions.remove(r.task)} disabled={actions.busy.has(r.task.id)} />
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </tbody>

        {/* Only when something is actually aggregated. An empty footer row is a
            border and a gap that say nothing. */}
        {compiled.some(({ col }) => col.agg !== "none") ? (
          <tfoot>
            <tr className="pf-tfoot">
              {cols.map((c, i) => (
                <td key={c} className="pf-td pf-tfoot-td">{i === 0 ? "Total" : ""}</td>
              ))}
              {/* Stored columns carry no footer of their own. Summing one is
                  what a formula column is FOR — `sum(budget)` is one expression
                  away, and a second aggregation mechanism would be a second
                  place for "what does empty mean" to be answered differently. */}
              {fields.map((f) => <td key={f.key} className="pf-td pf-tfoot-td" />)}
              {compiled.map(({ col, prog }) => {
                if (!prog.ok || col.agg === "none") {
                  return <td key={col.id} className="pf-td pf-tfoot-td" />;
                }
                const { value, n } = aggregate(col.agg, computed.get(col.id) ?? []);
                return (
                  <td key={col.id} className="pf-td pf-tfoot-td"
                      // Nulls are skipped rather than counted as zero, so say how
                      // many rows actually contributed instead of implying the
                      // whole column was measured.
                      title={`${col.agg} over ${n} row${n === 1 ? "" : "s"} with a value`}>
                    {value === null ? "—" : col.agg === "percent"
                      ? `${fmtFormulaValue(value)}%`
                      : fmtFormulaValue(value)}
                    <span className="pf-tfoot-n">{n}</span>
                  </td>
                );
              })}
              <td className="pf-td pf-tfoot-td" />
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function sortIndicator(spec: PfBlockSpec, col: PfColumn) {
  const map: Partial<Record<PfColumn, string>> = {
    title: "title", plan: "plan", priority: "priority",
    urgency: "urgency", due: "due", estimate: "estimate",
  };
  if (map[col] !== spec.sort.key) return null;
  return <span className="pf-sort" aria-hidden="true">{spec.sort.dir === "asc" ? "↑" : "↓"}</span>;
}

/**
 * One stored custom-field cell.
 *
 * ⚠️ The draft only exists WHILE FOCUSED. The block refreshes on a timer and on
 * every write elsewhere in the note, so a cell that kept a permanent draft would
 * show a stale value forever after the first edit — and one that had no draft at
 * all would have each keystroke overwritten by the in-flight refresh. Focused:
 * the user owns the text. Not focused: the store does.
 */
/**
 * One computed cell: a number, or a bar or ring scaled against the column's max.
 *
 * ⚠️ A null value renders as a DASH, never as an empty meter. An empty bar is
 * indistinguishable from 0%, so a task with no estimate would read as "0% done"
 * rather than "not measured" — the same distinction `aggregate` preserves by
 * skipping nulls instead of counting them as zero.
 *
 * The number is kept beside the meter rather than replaced by it. A bar is a
 * comparison; it cannot say "130% of target", and clamping without the number
 * would silently lose that.
 */
function MeterCell({
  col, value, column,
}: {
  col: FormulaColumn;
  value: FormulaValue;
  column: readonly FormulaValue[];
}) {
  const text = fmtFormulaValue(value);
  if (col.display === "number") return <>{text}</>;

  const f = meterFraction(value, col.max, column);
  // No scale, or nothing to scale. Falls back to the number rather than drawing
  // a meter that means nothing — including when max is "auto" and every visible
  // row is null.
  if (f === null) return <span className="pf-meter-none">{text}</span>;

  const pct = Math.round(f * 100);
  const label = `${text}${col.max === "auto" ? "" : ` of ${col.max}`}`;

  if (col.display === "ring") {
    // A stroked circle with a dash gap. r is chosen so the circumference is a
    // round 100 units, which makes the dash array the percentage directly —
    // no arithmetic to get subtly wrong at the wrap point.
    const R = 100 / (2 * Math.PI);
    const D = (R + 2) * 2;
    return (
      <span className="pf-meter pf-meter-ring" role="meter" aria-valuenow={pct}
            aria-valuemin={0} aria-valuemax={100} aria-label={label} title={label}>
        <svg viewBox={`0 0 ${D} ${D}`} width="18" height="18" aria-hidden="true">
          <circle cx={D / 2} cy={D / 2} r={R} className="pf-ring-track" />
          <circle cx={D / 2} cy={D / 2} r={R} className="pf-ring-fill"
                  strokeDasharray={`${pct} 100`}
                  transform={`rotate(-90 ${D / 2} ${D / 2})`} />
        </svg>
        <span className="pf-meter-text">{text}</span>
      </span>
    );
  }

  return (
    <span className="pf-meter pf-meter-bar" role="meter" aria-valuenow={pct}
          aria-valuemin={0} aria-valuemax={100} aria-label={label} title={label}>
      <span className="pf-bar-track">
        <span className="pf-bar-fill" style={{ width: `${pct}%` }} />
      </span>
      <span className="pf-meter-text">{text}</span>
    </span>
  );
}

function FieldCell({
  col, taskId, value, editable, onCommit,
}: {
  col: FieldColumn;
  taskId: number;
  value: string;
  editable: boolean;
  onCommit: (taskId: number, key: string, value: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  if (col.type === "check") {
    // No draft: a checkbox has nothing to type, so it commits on the click and
    // the optimistic store update is the feedback.
    const on = coerceField(value, "check") === true;
    return (
      <td className="pf-td pf-td-field pf-td-field-check">
        <input
          type="checkbox"
          checked={on}
          disabled={!editable}
          aria-label={col.label || col.key}
          // "" rather than "0": clearing the box DELETES the row. A stored "0"
          // and no row at all would both render unchecked, but only one of them
          // answers "has anyone filled this column in".
          onChange={(e) => onCommit(taskId, col.key, e.target.checked ? "1" : "")}
        />
      </td>
    );
  }

  const commit = () => {
    setDraft(null);
    if (draft !== null && draft !== value) onCommit(taskId, col.key, draft);
  };

  return (
    <td className={`pf-td pf-td-field${col.type === "number" ? " pf-td-field-num" : ""}`}>
      <input
        className="pf-field-input"
        // `text` even for a number column: a number input's spinner and its
        // locale-dependent parsing of "1,5" both fight the coercion rule, which
        // already decides what is and is not a number.
        type="text"
        inputMode={col.type === "number" ? "decimal" : undefined}
        value={shown}
        readOnly={!editable}
        aria-label={col.label || col.key}
        maxLength={FIELD_VALUE_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setDraft(value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          // Escape restores what the store has, which is also what a failed
          // write rolls back to — one meaning of "cancel", not two.
          else if (e.key === "Escape") { setDraft(null); (e.target as HTMLInputElement).blur(); }
        }}
      />
    </td>
  );
}

function Cell({
  col, row, members, actions, today, editable, tagsOf, tagColor, tree,
}: {
  col: PfColumn;
  row: TaskTreeRow;
  members: PfTeamMember[];
  actions: TaskActions;
  today: string;
  editable: boolean;
  tagsOf: (taskId: number) => string[];
  tagColor: (tag: string) => string | undefined;
  tree: TreeControls;
}) {
  const task = row.task;
  const busy = actions.busy.has(task.id);
  // Every planning-backed cell is blank-and-inert on a sparse kind rather than
  // showing an invented default. A reminder has no stage; a dropdown claiming it
  // is in "Refine" would be making that up.
  const hasPlanning = task.planning != null;

  switch (col) {
    case "done":
      return (
        <td className="pf-td pf-td-done">
          <input
            type="checkbox"
            className="pf-check"
            checked={task.done}
            disabled={busy}
            aria-label={`Mark “${task.title}” ${task.done ? "not done" : "done"}`}
            onChange={() => actions.toggle(task)}
          />
        </td>
      );

    case "title":
      // The indent lives in the title cell rather than on the <tr>: a row-level
      // padding would push every column right, and the table would lose its
      // grid the moment anything nested.
      return (
        <td className="pf-td pf-td-title">
          <span className="pf-cell-tree" style={{ "--pf-depth": row.depth } as React.CSSProperties}>
            <Disclosure row={row} onToggle={tree.toggleCollapse} onExpandHidden={tree.expandHidden} />
            <EditableText
              value={task.title}
              disabled={!editable}
              onCommit={(title) => actions.patch(task, { title })}
            />
            <SubtaskProgress stat={statFor(actions.stats, task.id)} />
          </span>
        </td>
      );

    case "tags":
      return (
        <td className="pf-td pf-td-tags">
          {tagsOf(task.id).length > 0
            ? <TagChips tags={tagsOf(task.id)} tagColor={tagColor} />
            : <span className="pf-na">—</span>}
        </td>
      );

    case "plan":
      return <td className="pf-td pf-td-soft">{task.plan_title ?? "—"}</td>;

    case "goal":
      return <td className="pf-td pf-td-soft">{task.goal_title ?? "—"}</td>;

    case "type":
      return <td className="pf-td pf-td-soft">{TASK_TYPE_LABELS[task.task_type]}</td>;

    case "assignee":
      return (
        <td className="pf-td pf-td-who">
          {/* A personal task has nobody to assign it to, so the cell is inert
              rather than offering a dropdown that would write a meaningless
              column. */}
          {!task.team_id ? (
            <span className="pf-na" title="Personal task — not shared with a team">—</span>
          ) : editable ? (
            <select
              className="pf-cell-select"
              value={task.assigned_to ?? "__unassigned__"}
              disabled={busy}
              aria-label={`Assign ${task.title}`}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) =>
                actions.patch(task, {
                  assigned_to: e.target.value === "__unassigned__" ? null : e.target.value,
                })
              }
            >
              <option value="__unassigned__">Unassigned</option>
              <option value="all">Everyone</option>
              {dedupe(members).map((m) => (
                <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
              ))}
            </select>
          ) : (
            <AssigneeChip task={task} members={members} />
          )}
        </td>
      );

    case "priority":
      return (
        <td className="pf-td">
          <EnumSelect
            value={task.priority}
            options={PRIORITIES}
            disabled={!editable || busy}
            onChange={(v) => actions.patch(task, { priority: v })}
          />
        </td>
      );

    case "urgency":
      return (
        <td className="pf-td">
          {hasPlanning ? (
            <EnumSelect
              value={task.planning!.urgency}
              options={URGENCIES}
              disabled={!editable || busy}
              onChange={(v) => actions.patch(task, { urgency: v })}
            />
          ) : <span className="pf-na" title="Only full tasks have an urgency">—</span>}
        </td>
      );

    case "stage":
      return (
        <td className="pf-td">
          {hasPlanning ? (
            <EnumSelect
              value={task.planning!.stage}
              options={STAGES}
              labels={STAGE_LABELS}
              disabled={!editable || busy}
              // Through setStage, not patch: 'active' is gated on the task
              // having calendar minutes behind it, and that rule lives in the
              // api rather than in the database.
              onChange={(v) => actions.setStage(task, v)}
            />
          ) : <span className="pf-na" title="Only full tasks have a stage">—</span>}
        </td>
      );

    case "due":
      return (
        <td className="pf-td pf-td-due">
          {editable ? (
            <input
              type="date"
              className="pf-date"
              value={task.due_date ?? ""}
              disabled={busy}
              aria-label={`Due date for ${task.title}`}
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => actions.patch(task, { due_date: e.target.value || null })}
            />
          ) : <DueChip due={task.due_date} today={today} />}
        </td>
      );

    case "estimate":
      return (
        <td className="pf-td pf-td-num">
          {/* aggregate_estimate is trigger-maintained, so it is shown but never
              written; the editable number is the task's own claim. */}
          <span title={task.aggregate_estimate !== (task.time_estimate ?? 0) ? "Rolled up from subtasks" : undefined}>
            {fmtEstimate(task.aggregate_estimate) || "—"}
          </span>
        </td>
      );

    default:
      return <td className="pf-td" />;
  }
}

function EnumSelect({
  value, options, labels, disabled, onChange,
}: {
  value: string;
  options: readonly string[];
  labels?: Record<string, string>;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <select
      className="pf-cell-select"
      value={value}
      disabled={disabled}
      onKeyDown={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o} value={o}>{labels?.[o] ?? o.charAt(0).toUpperCase() + o.slice(1)}</option>
      ))}
    </select>
  );
}
