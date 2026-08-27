// Everything about one task, editable, without leaving the note.
//
// The three views show what a task IS at a glance; this is where you change what
// it is. It exists because the alternative — "open PathFinder to set an
// estimate" — makes the block a read-mostly widget, and the whole point of the
// feature is that a note is a real surface onto the planner.
//
// ── What it may and may not write ───────────────────────────────────────────
//
// Every field routes through the same `TaskActions` the views use, so the ISA
// split (`urgency`/`stage`/`notes` live on `pf_task_planning`, not `pf_tasks`)
// and the scheduling gate (`stage = 'active'` needs calendar minutes behind it)
// are enforced identically here. Two fields are deliberately NOT offered:
//
//   • `aggregate_estimate` — trigger-maintained. It is shown next to the task's
//     own `time_estimate` precisely so the difference is legible, but writing it
//     would be overwritten on the next recompute.
//   • `task_type` — a generated column. The writable discriminator is
//     `category`, which is what the Kind control actually sets.
//
// Changing Kind away from `task` is the one lossy edit in here: the planning row
// is dropped by trigger, taking urgency, stage, completion mode, target count
// and notes with it. It is offered anyway — re-filing a "task" that was always
// really a reminder is a thing people need — but behind a confirm that names
// every field being destroyed, because nothing else in this panel loses data.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ancestorsOf,
  statFor,
  PRIORITIES,
  STAGES,
  STAGE_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  URGENCIES,
  type PfTask,
  type TaskType,
} from "@nexus/core/pathfinder";
import type { PfSnapshot } from "../lib/pathfinderStore";
import { normalizeTag } from "../lib/taskTags";
import { useConfirm } from "./ConfirmDialog";
import type { TaskActions } from "./PathfinderBlockView";

const COMPLETION_MODES = ["binary", "sessions", "time"] as const;
const COMPLETION_LABELS: Record<string, string> = {
  binary: "Just tick it",
  sessions: "Count sessions",
  time: "Count minutes",
};

interface Props {
  task: PfTask;
  snap: PfSnapshot;
  actions: TaskActions;
  editable: boolean;
  today: string;
  error: string | null;
  tagColor: (tag: string) => string | undefined;
  onClose: () => void;
  /** Follow a breadcrumb or a step without closing and reopening the sheet. */
  onSelectTask: (task: PfTask) => void;
}

export function PathfinderTaskDetail({
  task, snap, actions, editable, today, error, tagColor, onClose, onSelectTask,
}: Props) {
  const { confirm, dialog: confirmDialog } = useConfirm();
  const busy = actions.busy.has(task.id);
  const planning = task.planning;

  const byId = useMemo(() => new Map(snap.tasks.map((t) => [t.id, t])), [snap.tasks]);
  const ancestors = useMemo(() => ancestorsOf(task, byId), [task, byId]);
  const steps = useMemo(
    () => snap.tasks.filter((t) => t.parent_id === task.id).sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [snap.tasks, task.id],
  );
  const stat = statFor(snap.stats, task.id);
  const tags = snap.tags.get(task.id) ?? [];

  // Capture phase, exactly as ConfirmDialog does: Vault has a global Escape
  // binding and it would otherwise also fire, closing whatever is behind this.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const set = (patch: Record<string, unknown>) => actions.patch(task, patch);

  const changeKind = async (next: TaskType) => {
    const category = next === "task" ? null : next;
    if (category === (task.category ?? null)) return;

    // Only the demotion is lossy — promoting TO `task` materialises a fresh
    // planning row by trigger and destroys nothing.
    if (task.task_type === "task" && next !== "task") {
      const ok = await confirm({
        title: `Make “${task.title}” a ${TASK_TYPE_LABELS[next].toLowerCase()}?`,
        message: "Only full tasks carry planning, so this permanently drops:",
        details: [
          `Urgency (${planning?.urgency ?? "—"}) and stage (${planning ? STAGE_LABELS[planning.stage] : "—"})`,
          "Completion mode and target count",
          planning?.notes ? "The notes on this task" : "Notes (empty)",
        ],
        confirmLabel: "Change kind",
      });
      if (!ok) return;
    }
    set({ category });
  };

  return (
    <div className="pf-detail-backdrop" onPointerDown={onClose}>
      <section
        className="pf-detail"
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${task.title}`}
        onPointerDown={(e) => e.stopPropagation()}
        // Arrow keys, Backspace and Enter inside this sheet belong to its
        // fields; the block is a ProseMirror atom and they would otherwise
        // reach the editor's keymap and move the selection out from under it.
        onKeyDown={(e) => e.stopPropagation()}
      >
        <header className="pf-detail-head">
          <div className="pf-crumbs">
            {ancestors.map((a) => (
              <button
                key={a.id}
                type="button"
                className="pf-crumb"
                title={`Open “${a.title}”`}
                onClick={() => onSelectTask(a)}
              >
                {a.title}
              </button>
            ))}
            {ancestors.length > 0 ? <span className="pf-crumb-sep" aria-hidden="true">/</span> : null}
            <span className="pf-crumb-kind">{TASK_TYPE_LABELS[task.task_type]}</span>
          </div>

          <button type="button" className="pf-detail-close" aria-label="Close details" onClick={onClose}>
            ×
          </button>
        </header>

        <div className="pf-detail-title-row">
          <input
            type="checkbox"
            className="pf-check pf-check-lg"
            checked={task.done}
            disabled={busy}
            aria-label={`Mark “${task.title}” ${task.done ? "not done" : "done"}`}
            onChange={() => actions.toggle(task)}
          />
          <CommitInput
            className="pf-detail-title"
            value={task.title}
            disabled={!editable}
            placeholder="Untitled task"
            onCommit={(title) => title && title !== task.title && set({ title })}
          />
        </div>

        {error ? <div className="pf-detail-error" role="alert">{error}</div> : null}

        <div className="pf-detail-grid">
          <Field label="Kind">
            <select
              className="pf-cell-select"
              value={task.task_type}
              disabled={!editable || busy}
              onChange={(e) => void changeKind(e.target.value as TaskType)}
            >
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>{TASK_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </Field>

          <Field label="Priority">
            <select
              className="pf-cell-select"
              value={task.priority}
              disabled={!editable || busy}
              onChange={(e) => set({ priority: e.target.value })}
            >
              {PRIORITIES.map((p) => <option key={p} value={p}>{cap(p)}</option>)}
            </select>
          </Field>

          <Field label="Urgency" hint={planning ? undefined : "Only full tasks have an urgency."}>
            {planning ? (
              <select
                className="pf-cell-select"
                value={planning.urgency}
                disabled={!editable || busy}
                onChange={(e) => set({ urgency: e.target.value })}
              >
                {URGENCIES.map((u) => <option key={u} value={u}>{cap(u)}</option>)}
              </select>
            ) : <span className="pf-na">—</span>}
          </Field>

          <Field
            label="Stage"
            hint={planning ? "“Active” needs calendar time booked against the task." : "Only full tasks have a stage."}
          >
            {planning ? (
              <select
                className="pf-cell-select"
                value={planning.stage}
                disabled={!editable || busy}
                // setStage, never patch — the gate lives in the api.
                onChange={(e) => actions.setStage(task, e.target.value)}
              >
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABELS[s]}</option>)}
              </select>
            ) : <span className="pf-na">—</span>}
          </Field>

          <Field label="Due">
            <input
              type="date"
              className="pf-date"
              value={task.due_date ?? ""}
              disabled={!editable || busy}
              aria-label="Due date"
              onChange={(e) => set({ due_date: e.target.value || null })}
            />
          </Field>

          <Field
            label="Estimate"
            hint={
              stat.total > 0
                ? `Rolls up to ${task.aggregate_estimate || 0} min across ${stat.total} step${stat.total === 1 ? "" : "s"}.`
                : "Minutes this task claims for itself."
            }
          >
            <CommitInput
              className="pf-num-input"
              type="number"
              value={task.time_estimate == null ? "" : String(task.time_estimate)}
              disabled={!editable || busy}
              placeholder="—"
              onCommit={(v) => {
                const trimmed = v.trim();
                if (trimmed === "") return set({ time_estimate: null });
                const n = Number(trimmed);
                if (Number.isFinite(n) && n >= 0) set({ time_estimate: Math.round(n) });
              }}
            />
          </Field>

          <Field label="Plan">
            <select
              className="pf-cell-select"
              value={task.plan_id == null ? "" : String(task.plan_id)}
              disabled={!editable || busy}
              onChange={(e) => set({ plan_id: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">No plan</option>
              {snap.plans.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>

          <Field
            label="Goal"
            hint="A direct goal wins over the one inherited from the plan."
          >
            <select
              className="pf-cell-select"
              value={task.goal_id == null ? "" : String(task.goal_id)}
              disabled={!editable || busy}
              onChange={(e) => set({ goal_id: e.target.value === "" ? null : Number(e.target.value) })}
            >
              <option value="">No goal</option>
              {snap.goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </Field>

          <Field label="Status">
            <CommitInput
              className="pf-text-input"
              value={task.kanban_status}
              disabled={!editable || busy}
              placeholder="backlog"
              onCommit={(v) => v.trim() && v.trim() !== task.kanban_status && set({ kanban_status: v.trim() })}
            />
          </Field>

          {planning ? (
            <Field label="Done when">
              <select
                className="pf-cell-select"
                value={planning.completion_mode}
                disabled={!editable || busy}
                onChange={(e) => set({ completion_mode: e.target.value })}
              >
                {COMPLETION_MODES.map((m) => (
                  <option key={m} value={m}>{COMPLETION_LABELS[m]}</option>
                ))}
              </select>
            </Field>
          ) : null}

          {planning && planning.completion_mode !== "binary" ? (
            <Field
              label={planning.completion_mode === "time" ? "Target minutes" : "Target sessions"}
              hint="Ticking a scheduled calendar block is what counts toward this."
            >
              <CommitInput
                className="pf-num-input"
                type="number"
                value={planning.target_count == null ? "" : String(planning.target_count)}
                disabled={!editable || busy}
                placeholder="—"
                onCommit={(v) => {
                  const trimmed = v.trim();
                  if (trimmed === "") return set({ target_count: null });
                  const n = Number(trimmed);
                  if (Number.isFinite(n) && n > 0) set({ target_count: Math.round(n) });
                }}
              />
            </Field>
          ) : null}

          {task.team_id ? (
            <Field label="Assigned to">
              <select
                className="pf-cell-select"
                value={task.assigned_to ?? "__unassigned__"}
                disabled={!editable || busy}
                onChange={(e) =>
                  set({ assigned_to: e.target.value === "__unassigned__" ? null : e.target.value })
                }
              >
                <option value="__unassigned__">Unassigned</option>
                <option value="all">Everyone</option>
                {dedupeMembers(snap.members).map((m) => (
                  <option key={m.user_id} value={m.user_id}>{m.display_name}</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        <TagEditor
          tags={tags}
          all={snap.allTags}
          available={snap.tagsAvailable}
          editable={editable}
          tagColor={tagColor}
          onAdd={(t) => actions.addTag(task, t)}
          onRemove={(t) => actions.removeTag(task, t)}
        />

        {planning ? (
          <section className="pf-detail-section">
            <h4 className="pf-detail-h">Notes</h4>
            <CommitTextarea
              value={planning.notes ?? ""}
              disabled={!editable || busy}
              placeholder="Anything the title doesn’t say…"
              onCommit={(notes) => set({ notes: notes.trim() || null })}
            />
            <p className="pf-detail-hint">
              Saved when you click away. These are PathFinder’s notes — they show there too.
            </p>
          </section>
        ) : null}

        <section className="pf-detail-section">
          <h4 className="pf-detail-h">
            Steps
            {stat.total > 0 ? (
              <span className="pf-detail-count">{stat.done}/{stat.total} done</span>
            ) : null}
          </h4>

          {steps.length === 0 ? (
            <p className="pf-detail-hint">No steps yet. Breaking a task down rolls its estimate up automatically.</p>
          ) : (
            <ul className="pf-steps">
              {steps.map((s) => {
                const sub = statFor(snap.stats, s.id);
                return (
                  <li key={s.id} className={s.done ? "is-done" : ""}>
                    <input
                      type="checkbox"
                      className="pf-check"
                      checked={s.done}
                      disabled={actions.busy.has(s.id)}
                      aria-label={`Mark “${s.title}” ${s.done ? "not done" : "done"}`}
                      onChange={() => actions.toggle(s)}
                    />
                    <button type="button" className="pf-step-open" onClick={() => onSelectTask(s)}>
                      {s.title}
                    </button>
                    {sub.total > 0 ? (
                      <span className="pf-step-count" title={`${sub.done} of ${sub.total} deeper steps done`}>
                        {sub.done}/{sub.total}
                      </span>
                    ) : null}
                    {s.due_date ? <span className={`pf-due pf-due-${s.due_date < today ? "overdue" : "soon"}`}>{s.due_date}</span> : null}
                  </li>
                );
              })}
            </ul>
          )}

          {editable ? (
            <AddStep onSubmit={(title) => actions.addSubtask(task, title)} />
          ) : null}
        </section>

        <footer className="pf-detail-foot">
          <span className="pf-detail-hint">
            Changes here are changes in PathFinder — except tags, which stay in Vault.
          </span>
          {editable ? (
            <button
              type="button"
              className="pf-detail-danger"
              disabled={busy}
              onClick={() => { actions.remove(task); onClose(); }}
            >
              Delete task
            </button>
          ) : null}
        </footer>

        {confirmDialog}
      </section>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dedupeMembers<T extends { user_id: string }>(members: T[]): T[] {
  const seen = new Map<string, T>();
  for (const m of members) if (!seen.has(m.user_id)) seen.set(m.user_id, m);
  return [...seen.values()];
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="pf-field">
      <span className="pf-field-label" title={hint}>{label}</span>
      {children}
      {hint ? <span className="pf-field-hint">{hint}</span> : null}
    </label>
  );
}

/**
 * An input that commits on blur and on Enter, and reverts on Escape.
 *
 * Uncontrolled while focused, for the reason `EditableText` is: this sheet
 * re-renders whenever the shared snapshot changes — another block's refetch, a
 * teammate's write — and a controlled input would jump the caret to the end of
 * whatever the user was mid-way through typing.
 */
function CommitInput({
  value, onCommit, disabled, className, placeholder, type = "text",
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  type?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <input
      type={type}
      className={className}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { focused.current = false; onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
        if (e.key === "Escape") { e.preventDefault(); setDraft(value); (e.target as HTMLInputElement).blur(); }
      }}
    />
  );
}

/** Same contract as CommitInput; Enter inserts a newline, Cmd/Ctrl-Enter commits. */
function CommitTextarea({
  value, onCommit, disabled, placeholder,
}: {
  value: string;
  onCommit: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return (
    <textarea
      className="pf-detail-notes"
      rows={4}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { focused.current = false; if (draft !== value) onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        }
        if (e.key === "Escape") { e.preventDefault(); setDraft(value); (e.target as HTMLTextAreaElement).blur(); }
      }}
    />
  );
}

/**
 * The Vault tag editor.
 *
 * Autocomplete comes from a `<datalist>` rather than a hand-rolled popover: it
 * is one element, it works with a hardware keyboard and a touch keyboard alike,
 * and it does not fight the sheet for focus. Typing a name that is not in the
 * list creates it — tags here have no separate "create" step, the same as
 * Vault's note tags.
 */
function TagEditor({
  tags, all, available, editable, tagColor, onAdd, onRemove,
}: {
  tags: string[];
  all: string[];
  available: boolean;
  editable: boolean;
  tagColor: (tag: string) => string | undefined;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const listId = "pf-tag-suggestions";

  const submit = () => {
    const t = normalizeTag(draft);
    setDraft("");
    if (t && !tags.includes(t)) onAdd(t);
  };

  return (
    <section className="pf-detail-section">
      <h4 className="pf-detail-h">
        Vault tags
        <span className="pf-detail-count">only here</span>
      </h4>

      {!available ? (
        // Distinct from "no tags yet". Silence here would look exactly like an
        // empty tag list, and the user would keep adding tags that never stick.
        <p className="pf-detail-hint pf-detail-warn">
          Tags are unavailable — <code>vault_task_tags</code> isn’t in the database yet.
          Apply <code>supabase/migrations/20260827140000_vault_task_tags.sql</code> to turn them on.
          Everything else on this task still works.
        </p>
      ) : (
        <>
          <div className="pf-tag-row">
            {tags.length === 0 ? <span className="pf-detail-hint">No tags.</span> : null}
            {tags.map((t) => {
              const c = tagColor(t);
              return (
                <span
                  key={t}
                  className="pf-tag pf-tag-vault"
                  style={c ? { background: `${c}22`, color: c, borderColor: `${c}55` } : undefined}
                >
                  #{t}
                  {editable ? (
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
          </div>

          {editable ? (
            <>
              <input
                className="pf-text-input pf-tag-input"
                value={draft}
                list={listId}
                placeholder="Add a tag…"
                aria-label="Add a Vault tag"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") { e.preventDefault(); submit(); }
                  if (e.key === "Escape") { e.preventDefault(); setDraft(""); }
                }}
                onBlur={submit}
              />
              <datalist id={listId}>
                {all.filter((t) => !tags.includes(t)).map((t) => <option key={t} value={t} />)}
              </datalist>
            </>
          ) : null}

          <p className="pf-detail-hint">
            Tags live in Vault only. PathFinder never sees them, and on a shared task
            each person has their own.
          </p>
        </>
      )}
    </section>
  );
}

function AddStep({ onSubmit }: { onSubmit: (title: string) => void }) {
  const [draft, setDraft] = useState("");

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    onSubmit(text);
  };

  return (
    <div className="pf-add">
      <span className="pf-add-plus" aria-hidden="true">+</span>
      <input
        className="pf-add-input"
        value={draft}
        placeholder="Add a step…"
        aria-label="Add a step"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter keeps the field open — breaking a task into five steps is five
          // lines and five Enters, not five trips back to a button.
          if (e.key === "Enter") { e.preventDefault(); submit(); }
          if (e.key === "Escape") { e.preventDefault(); setDraft(""); }
        }}
        onBlur={submit}
      />
    </div>
  );
}
