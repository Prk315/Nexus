// The three views a `pathfinderBlock` can wear.
//
// They deliberately do not converge on a shared "row" component. A to-do list is
// a column of sentences you tick; a board is a spatial arrangement you move
// things around in; a table is a grid you scan and edit cell by cell. Forcing
// one renderer to serve all three is how you get a board whose cards are table
// rows lying on their side. What IS shared is the write path — every one goes
// through the `TaskActions` the shell builds, so the ISA split and the
// scheduling gate are enforced identically whichever view you are looking at.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  groupTasks,
  memberName,
  PRIORITIES,
  STAGES,
  STAGE_LABELS,
  TASK_TYPE_LABELS,
  URGENCIES,
  type PfPlan,
  type PfTask,
  type PfTeamMember,
} from "@nexus/core/pathfinder";
import {
  axisDropValue,
  axisWriteField,
  boardColumns,
  PF_COLUMN_LABELS,
  type PfBlockSpec,
  type PfColumn,
} from "../lib/pathfinderBlock";
import type { TaskActions } from "./PathfinderBlockView";

interface ViewProps {
  tasks: PfTask[];
  spec: PfBlockSpec;
  members: PfTeamMember[];
  actions: TaskActions;
  today: string;
  editable: boolean;
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

// ─── List ───────────────────────────────────────────────────────────────────

export function PfListView({
  tasks, spec, members, actions, today, editable, onAdd,
}: ViewProps & { onAdd: (title: string) => void }) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onAdd(text);
  };

  return (
    <div className="pf-list">
      {tasks.map((t) => (
        <div className={`pf-list-row${t.done ? " is-done" : ""}${actions.busy.has(t.id) ? " is-busy" : ""}`} key={t.id}>
          <input
            type="checkbox"
            className="pf-check"
            checked={t.done}
            disabled={actions.busy.has(t.id)}
            aria-label={t.done ? `Mark “${t.title}” not done` : `Mark “${t.title}” done`}
            onChange={() => actions.toggle(t)}
          />

          <PriorityDot priority={t.priority} />

          <EditableText
            value={t.title}
            className="pf-list-title"
            disabled={!editable}
            onCommit={(title) => actions.patch(t, { title })}
          />

          <span className="pf-meta">
            {t.plan_title ? <span className="pf-tag">{t.plan_title}</span> : null}
            <AssigneeChip task={t} members={members} />
            {t.task_type !== "task" ? <span className="pf-tag pf-tag-kind">{TASK_TYPE_LABELS[t.task_type]}</span> : null}
            {t.aggregate_estimate ? <span className="pf-tag pf-tag-est">{fmtEstimate(t.aggregate_estimate)}</span> : null}
            <DueChip due={t.due_date} today={today} />
          </span>

          {editable ? <DeleteButton onClick={() => actions.remove(t)} disabled={actions.busy.has(t.id)} /> : null}
        </div>
      ))}

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
  if (spec.filter.planIds.length === 1) return "Add a task to this plan…";
  if (spec.filter.due === "today") return "Add a task due today…";
  return "Add a task…";
}

// ─── Board ──────────────────────────────────────────────────────────────────

export function PfBoardView({
  tasks, spec, plans, members, actions, today, editable, onSpecChange,
}: ViewProps & { plans: PfPlan[]; onSpecChange: (next: PfBlockSpec) => void }) {
  const axis = spec.groupBy;
  const columns = boardColumns(axis, plans, members);
  const groups = groupTasks(tasks, axis, columns, axis === "assignee" ? "Personal" : "Other");
  const writeField = axisWriteField(axis);

  const { dragId, overKey, handlers } = useCardDrag({
    enabled: editable && writeField != null,
    onDrop: (taskId, colKey) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task || !writeField || colKey === "__other__") return;
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
              {g.tasks.map((t) => (
                <article
                  className={`pf-card${dragId === t.id ? " is-dragging" : ""}${t.done ? " is-done" : ""}${actions.busy.has(t.id) ? " is-busy" : ""}`}
                  key={t.id}
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
                  </div>

                  <div className="pf-card-meta">
                    <PriorityDot priority={t.priority} />
                    {/* Suppressed when the board is already grouped by person —
                        a chip repeating the column header is noise. */}
                    {axis !== "assignee" ? <AssigneeChip task={t} members={members} /> : null}
                    {t.plan_title ? <span className="pf-tag">{t.plan_title}</span> : null}
                    {t.aggregate_estimate ? <span className="pf-tag pf-tag-est">{fmtEstimate(t.aggregate_estimate)}</span> : null}
                    <DueChip due={t.due_date} today={today} />
                  </div>
                </article>
              ))}

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
  onDrop: (taskId: number, columnKey: string) => void;
}) {
  const [dragId, setDragId] = useState<number | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);

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

  const columnAt = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y);
    const col = (el as HTMLElement | null)?.closest?.("[data-col]") as HTMLElement | null;
    return col?.dataset.col ?? null;
  };

  const end = useCallback((commit: { x: number; y: number } | null) => {
    const g = gesture.current;
    if (!g) return;
    if (g.holdTimer) window.clearTimeout(g.holdTimer);
    g.detach();
    gesture.current = null;
    setDragId(null);
    setOverKey(null);

    if (commit && g.armed) {
      const key = columnAt(commit.x, commit.y);
      // `__other__` is the catch-all bucket, not a state anything can be moved
      // INTO — dropping there would have to invent a value for the axis.
      if (key && key !== "__other__") onDrop(g.id, key);
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
      setOverKey(columnAt(ev.clientX, ev.clientY));
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

  return { dragId, overKey, handlers: { onPointerDown } };
}

// ─── Table ──────────────────────────────────────────────────────────────────

export function PfTableView({
  tasks, spec, members, actions, today, editable, onSpecChange,
}: ViewProps & { onSpecChange: (next: PfBlockSpec) => void }) {
  const cols = spec.columns;

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
      <table className="pf-table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th
                key={c}
                className={`pf-th pf-th-${c}`}
                scope="col"
                onClick={() => sortBy(c)}
              >
                {c === "done" ? "" : PF_COLUMN_LABELS[c]}
                {sortIndicator(spec, c)}
              </th>
            ))}
            {editable ? <th className="pf-th pf-th-act" scope="col" aria-label="Actions" /> : null}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id} className={`${t.done ? "is-done" : ""}${actions.busy.has(t.id) ? " is-busy" : ""}`}>
              {cols.map((c) => (
                <Cell key={c} col={c} task={t} members={members} actions={actions} today={today} editable={editable} />
              ))}
              {editable ? (
                <td className="pf-td pf-td-act">
                  <DeleteButton onClick={() => actions.remove(t)} disabled={actions.busy.has(t.id)} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
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

function Cell({
  col, task, members, actions, today, editable,
}: {
  col: PfColumn;
  task: PfTask;
  members: PfTeamMember[];
  actions: TaskActions;
  today: string;
  editable: boolean;
}) {
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
      return (
        <td className="pf-td pf-td-title">
          <EditableText
            value={task.title}
            disabled={!editable}
            onCommit={(title) => actions.patch(task, { title })}
          />
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
