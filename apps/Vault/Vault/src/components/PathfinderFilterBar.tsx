// The per-block query controls.
//
// Hidden by default once a block is configured (`spec.showFilters`), because a
// note full of open control panels stops reading like a document. It is open on
// insert so the block announces that it *is* configurable — a live data block
// that looks like static output is a feature nobody finds.
//
// Every control writes the whole spec back through `onChange` in one call, which
// becomes exactly one ProseMirror transaction. Nothing here is debounced except
// the search box: the others are discrete choices, and a transaction per click
// is the correct granularity for undo — Cmd-Z should step back one decision.

import { normalizeFieldKey, FIELD_TYPES, FIELD_KEY_MAX, type FieldType } from "../lib/taskFields";
import { compile, MAX_FORMULA_CHARS } from "../lib/formula";
import { useEffect, useRef, useState, useMemo } from "react";
import {
  PRIORITIES,
  STAGES,
  STAGE_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  URGENCIES,
  type DoneFilter,
  type DueWindow,
  type OwnerScope,
  type PfGoal,
  type PfPlan,
  type PfTeam,
  type PfTeamMember,
  type SortKey,
  type TaskFilter,
} from "@nexus/core/pathfinder";
import {
  BOARD_AXIS_LABELS,
  MAX_FILTER_TAGS,
  PF_COLUMNS,
  PF_COLUMN_LABELS,
  LIST_COLUMNS,
  FORMULA_AGGS,
  FORMULA_FIELDS,
  RESERVED_FIELD_KEYS,
  METER_DISPLAYS,
  STAT_AGGS,
  MAX_STATS,
  type StatCard,
  METER_MAX_MIN,
  type MeterDisplay,
  formulaFieldNames,
  MAX_FIELDS,
  type FieldColumn,
  MAX_FORMULAS,
  type FormulaAgg,
  type FormulaColumn,
  boardStatuses,
  normalizeStatuses,
  SPEC_MAX_LIMIT,
  TREE_MODE_HINTS,
  TREE_MODE_LABELS,
  sortColumns,
  type PfBlockSpec,
  type PfBlockView,
  type PfColumn,
} from "../lib/pathfinderBlock";
import { TAG_MODES, TAG_MODE_LABELS, type TagMode } from "../lib/taskTags";

const DUE_OPTIONS: Array<{ value: DueWindow; label: string }> = [
  { value: "any", label: "Any date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due in 7 days" },
  { value: "month", label: "Due in 30 days" },
  { value: "dated", label: "Has a date" },
  { value: "none", label: "No date" },
];

const DONE_OPTIONS: Array<{ value: DoneFilter; label: string }> = [
  { value: "open", label: "Open" },
  { value: "done", label: "Completed" },
  { value: "all", label: "All" },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "urgency", label: "Urgency" },
  { value: "title", label: "Title" },
  { value: "created", label: "Created" },
  { value: "estimate", label: "Estimate" },
  { value: "plan", label: "Plan" },
  { value: "manual", label: "Manual order" },
];

const SCOPE_OPTIONS: Array<{ value: OwnerScope; label: string }> = [
  { value: "any", label: "Everything" },
  { value: "personal", label: "Personal only" },
  { value: "team", label: "Shared only" },
];

interface Props {
  spec: PfBlockSpec;
  view: PfBlockView;
  plans: PfPlan[];
  goals: PfGoal[];
  teams: PfTeam[];
  members: PfTeamMember[];
  /** Every Vault tag in use — the vocabulary, not this block's selection. */
  allTags: string[];
  /** False when `vault_task_tags` isn't in the database yet. */
  tagsAvailable: boolean;
  tagColor: (tag: string) => string | undefined;
  onRenameTag: (from: string, to: string) => void;
  onDeleteTag: (tag: string) => void;
  onChange: (next: PfBlockSpec) => void;
}

export function PathfinderFilterBar({
  spec, view, plans, goals, teams, members,
  allTags, tagsAvailable, tagColor, onRenameTag, onDeleteTag, onChange,
}: Props) {
  const set = (patch: Partial<PfBlockSpec>) => onChange({ ...spec, ...patch });
  const setFilter = (patch: Partial<TaskFilter>) => set({ filter: { ...spec.filter, ...patch } });

  // A solo account has no teams, and every team control would then be a
  // dropdown with one meaningless option. Hiding the whole row is better than
  // showing controls that cannot do anything.
  const hasTeams = teams.length > 0;

  const assigneeOptions = [
    { value: "any", label: "Anyone" },
    { value: "me", label: "Me" },
    { value: "unassigned", label: "Unassigned" },
    ...dedupeMembers(members).map((m) => ({ value: m.user_id, label: m.display_name })),
  ];

  return (
    <div className="pf-filters">
      <div className="pf-filter-row">
        <SearchBox value={spec.filter.search} onChange={(search) => setFilter({ search })} />

        <Select
          label="Show"
          value={spec.filter.done}
          options={DONE_OPTIONS}
          onChange={(v) => setFilter({ done: v as DoneFilter })}
        />

        <Select
          label="Due"
          value={spec.filter.due}
          options={DUE_OPTIONS}
          onChange={(v) => setFilter({ due: v as DueWindow })}
        />

        <MultiSelect
          label="Plan"
          selected={spec.filter.planIds.map(String)}
          options={plans.map((p) => ({ value: String(p.id), label: p.title }))}
          onChange={(vals) => setFilter({ planIds: vals.map(Number) })}
        />

        <MultiSelect
          label="Goal"
          selected={spec.filter.goalIds.map(String)}
          options={goals.map((g) => ({ value: String(g.id), label: g.title }))}
          onChange={(vals) => setFilter({ goalIds: vals.map(Number) })}
        />
      </div>

      {hasTeams ? (
        <div className="pf-filter-row">
          <Select
            label="Ownership"
            value={spec.filter.scope}
            options={SCOPE_OPTIONS}
            onChange={(v) => setFilter({ scope: v as OwnerScope })}
          />
          <Select
            label="Assigned to"
            value={spec.filter.assignee}
            options={assigneeOptions}
            onChange={(v) => setFilter({ assignee: v })}
          />
          <MultiSelect
            label="Team"
            selected={spec.filter.teamIds}
            options={teams.map((t) => ({ value: t.id, label: t.name }))}
            onChange={(teamIds) => setFilter({ teamIds })}
          />
          <span className="pf-hint" title="An unclaimed or everyone-assigned team task counts as yours — the same rule PathFinder's own dashboard uses.">
            “Me” includes unclaimed shared work
          </span>
        </div>
      ) : null}

      <div className="pf-filter-row">
        <ChipGroup
          label="Priority"
          options={PRIORITIES.map((p) => ({ value: p, label: cap(p) }))}
          selected={spec.filter.priorities}
          onChange={(v) => setFilter({ priorities: v as TaskFilter["priorities"] })}
        />
        <ChipGroup
          label="Urgency"
          options={URGENCIES.map((u) => ({ value: u, label: cap(u) }))}
          selected={spec.filter.urgencies}
          onChange={(v) => setFilter({ urgencies: v as TaskFilter["urgencies"] })}
        />
        <ChipGroup
          label="Stage"
          options={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
          selected={spec.filter.stages}
          onChange={(v) => setFilter({ stages: v as TaskFilter["stages"] })}
        />
        <ChipGroup
          label="Kind"
          options={TASK_TYPES.map((t) => ({ value: t, label: TASK_TYPE_LABELS[t] }))}
          selected={spec.filter.taskTypes}
          onChange={(v) => setFilter({ taskTypes: v as TaskFilter["taskTypes"] })}
        />
      </div>

      {/* Vault's own axis. It sits in its own row and says so out loud: a
          control that looks like the PathFinder filters above but writes
          somewhere PathFinder cannot see would be the most confusing thing in
          this bar. */}
      <div className="pf-filter-row pf-filter-row-tags">
        <span className="pf-chips-label" title="Tags stored in Vault only — PathFinder never sees them">
          Vault tags
        </span>

        {!tagsAvailable ? (
          <span className="pf-hint pf-hint-warn">
            Not available — apply <code>20260827140000_vault_task_tags.sql</code>.
          </span>
        ) : (
          <>
            <TagPicker
              selected={spec.tags}
              options={allTags}
              tagColor={tagColor}
              disabled={spec.untaggedOnly}
              onChange={(tags) => set({ tags: tags.slice(0, MAX_FILTER_TAGS) })}
              onRename={onRenameTag}
              onDelete={onDeleteTag}
            />

            <Select
              label="Match"
              value={spec.tagMode}
              options={TAG_MODES.map((m) => ({ value: m, label: TAG_MODE_LABELS[m] }))}
              onChange={(v) => set({ tagMode: v as TagMode })}
            />

            <label className="pf-toggle">
              <input
                type="checkbox"
                checked={spec.untaggedOnly}
                // A hard gate rather than another AND-ed clause: "untagged AND
                // tagged #reading" matches nothing, and a filter that can be
                // configured into matching nothing reads as broken. The picker
                // above disables itself for the same reason.
                onChange={(e) => set({ untaggedOnly: e.target.checked })}
              />
              <span title="Only tasks with no Vault tags. Ignores the tag list while it is on.">
                Untagged only
              </span>
            </label>

            <label className="pf-toggle">
              <input
                type="checkbox"
                checked={spec.showTags}
                onChange={(e) => set({ showTags: e.target.checked })}
              />
              <span title="Render each row's tags as chips">Show on rows</span>
            </label>
          </>
        )}
      </div>

      <div className="pf-filter-row pf-filter-row-end">
        {view !== "board" ? (
          <Select
            label="Subtasks"
            value={spec.tree}
            options={(Object.keys(TREE_MODE_LABELS) as Array<keyof typeof TREE_MODE_LABELS>).map((k) => ({
              value: k,
              label: TREE_MODE_LABELS[k],
            }))}
            onChange={(v) => set({ tree: v as PfBlockSpec["tree"] })}
            hint={TREE_MODE_HINTS[spec.tree]}
          />
        ) : (
          <span className="pf-hint" title="A card cannot contain another card. Each one shows a “done/total” roll-up instead, and the detail sheet holds the steps.">
            Cards show a subtask roll-up
          </span>
        )}

        <label className="pf-toggle">
          <input
            type="checkbox"
            checked={spec.filter.rootsOnly}
            onChange={(e) => setFilter({ rootsOnly: e.target.checked })}
          />
          <span title="Hide tasks that are steps of another task. With “Nested + hidden steps” this gives the full outline of every top-level task.">
            Top-level only
          </span>
        </label>

        <label className="pf-toggle">
          <input
            type="checkbox"
            checked={spec.filter.excludeQuick}
            onChange={(e) => setFilter({ excludeQuick: e.target.checked })}
          />
          <span title="Hide reminders, chores and shopping items">Projects only</span>
        </label>

        <label className="pf-toggle">
          <input
            type="checkbox"
            checked={spec.compact}
            onChange={(e) => set({ compact: e.target.checked })}
          />
          <span>Compact</span>
        </label>

        <Select
          label="Sort"
          value={spec.sort.key}
          options={SORT_OPTIONS}
          onChange={(v) => set({ sort: { ...spec.sort, key: v as SortKey } })}
        />
        <button
          type="button"
          className="pf-icon-btn"
          title={spec.sort.dir === "asc" ? "Ascending" : "Descending"}
          aria-label="Reverse sort order"
          onClick={() => set({ sort: { ...spec.sort, dir: spec.sort.dir === "asc" ? "desc" : "asc" } })}
        >
          {spec.sort.dir === "asc" ? "↑" : "↓"}
        </button>

        <label className="pf-num">
          <span>Limit</span>
          <input
            type="number"
            min={0}
            max={SPEC_MAX_LIMIT}
            value={spec.limit}
            onChange={(e) => {
              const n = Number(e.target.value);
              set({ limit: Number.isFinite(n) ? Math.max(0, Math.min(SPEC_MAX_LIMIT, Math.round(n))) : spec.limit });
            }}
          />
        </label>

        {view === "board" ? (
          <Select
            label="Columns by"
            value={spec.groupBy}
            options={(Object.keys(BOARD_AXIS_LABELS) as Array<keyof typeof BOARD_AXIS_LABELS>).map((k) => ({
              value: k,
              label: BOARD_AXIS_LABELS[k],
            }))}
            onChange={(v) => set({ groupBy: v as PfBlockSpec["groupBy"] })}
          />
        ) : null}

        {/* The list gets one too. It renders a narrower set — a list row is a
            line of text with chips, not a grid, so `urgency` and `stage` have
            nowhere to go — and offering a switch that does nothing is worse
            than offering none. */}
        {/* Only on the axis whose values are free text. Every other axis has a
            closed domain — you cannot invent a priority — so offering to edit
            its columns would promise something the model cannot keep. */}
        {view === "board" && spec.groupBy === "kanban_status" ? (
          <StatusEditor
            statuses={boardStatuses(spec)}
            isCustom={spec.statuses.length > 0}
            onChange={(statuses) => set({ statuses })}
          />
        ) : null}

        {/* Every view: a stat is one figure, so it needs no column to live in.
            This is the only one of the three editors not gated on `table`. */}
        <StatEditor stats={spec.stats} onChange={(stats) => set({ stats })} />

        {/* Table only, and stored before computed — that is the order they are
            drawn in, and the order the dependency runs: a formula may read a
            stored column, never the other way round. */}
        {view === "table" ? (
          <FieldEditor
            fields={spec.fields}
            onChange={(fields) => set({ fields })}
          />
        ) : null}

        {/* Table only: a list row has nowhere to put a computed column. */}
        {view === "table" ? (
          <FormulaEditor
            formulas={spec.formulas}
            fields={spec.fields}
            onChange={(formulas) => set({ formulas })}
          />
        ) : null}

        {view === "table" || view === "list" ? (
          <ColumnPicker
            choices={view === "list" ? LIST_COLUMNS : PF_COLUMNS}
            selected={spec.columns}
            onChange={(columns) => set({ columns })}
          />
        ) : null}
      </div>
    </div>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The same person on two teams is one option, not two. */
function dedupeMembers(members: PfTeamMember[]): PfTeamMember[] {
  const seen = new Map<string, PfTeamMember>();
  for (const m of members) if (!seen.has(m.user_id)) seen.set(m.user_id, m);
  return [...seen.values()];
}

/**
 * Debounced, and it has to be: every keystroke committing a transaction would
 * put one undo step per character between the user and their previous edit, and
 * would wake the note's autosave on each one.
 */
function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useState(value);
  const timer = useRef<number | null>(null);

  // Adopt an external change (undo, another device) without clobbering typing.
  useEffect(() => {
    setLocal(value);
  }, [value]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <label className="pf-search">
      <span aria-hidden="true">⌕</span>
      <input
        type="text"
        value={local}
        placeholder="Search tasks…"
        aria-label="Search tasks"
        onChange={(e) => {
          const next = e.target.value;
          setLocal(next);
          if (timer.current) window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => onChange(next), 300);
        }}
      />
    </label>
  );
}

function Select({
  label, value, options, onChange, hint,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <label className="pf-select" title={hint}>
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/**
 * The tag filter, and the only place tags can be renamed or deleted globally.
 *
 * Tag *management* lives inside the filter's popover rather than in a settings
 * screen because that is where a bad tag is noticed — you open the picker to
 * filter by "chaper-3" and see the typo. Vault's note tags work the same way
 * (TagsPanel), and the two share `vault_tag_colors`, so a colour set for a note
 * tag shows up on task chips with the same name.
 *
 * Both destructive operations go through the RPCs, not a client-side loop: a
 * rename that fails halfway would leave the tag existing under both names with
 * no way to tell which tasks got which. See lib/vaultTaskTags.ts.
 */
function TagPicker({
  selected, options, tagColor, disabled, onChange, onRename, onDelete,
}: {
  selected: string[];
  options: string[];
  tagColor: (tag: string) => string | undefined;
  disabled?: boolean;
  onChange: (v: string[]) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [managing, setManaging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) { setOpen(false); setManaging(false); }
    };
    // `mousedown`, not `click`: a click listener added during a click event can
    // fire on the very event that opened the popover and close it immediately.
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const summary = disabled
    ? "—"
    : selected.length === 0
      ? "Any"
      : selected.length === 1
        ? `#${selected[0]}`
        : `${selected.length} tags`;

  return (
    <div className="pf-multi" ref={ref}>
      <button
        type="button"
        className={`pf-multi-btn${selected.length && !disabled ? " is-on" : ""}`}
        aria-expanded={open}
        disabled={disabled}
        title={disabled ? "Turn off “Untagged only” to filter by tag" : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pf-multi-label">Tag</span>
        <span className="pf-multi-value">{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="pf-multi-pop">
          {options.length === 0 ? (
            <div className="pf-multi-empty">
              No tags yet. Open any task’s details (⋯) to add one.
            </div>
          ) : (
            <>
              <div className="pf-multi-tools">
                {selected.length > 0 ? (
                  <button type="button" className="pf-multi-clear" onClick={() => onChange([])}>Clear</button>
                ) : <span />}
                <button
                  type="button"
                  className={`pf-multi-clear${managing ? " is-on" : ""}`}
                  onClick={() => setManaging((m) => !m)}
                >
                  {managing ? "Done" : "Manage"}
                </button>
              </div>

              {options.map((t) => (
                <div className="pf-multi-row" key={t}>
                  {managing ? (
                    <TagManageRow tag={t} tagColor={tagColor} onRename={onRename} onDelete={onDelete} />
                  ) : (
                    <label className="pf-multi-check">
                      <input
                        type="checkbox"
                        checked={selected.includes(t)}
                        onChange={() => toggle(t)}
                      />
                      <span className="pf-tag-swatch" style={{ background: tagColor(t) ?? "#94a3b8" }} aria-hidden="true" />
                      <span>#{t}</span>
                    </label>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function TagManageRow({
  tag, tagColor, onRename, onDelete,
}: {
  tag: string;
  tagColor: (tag: string) => string | undefined;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
}) {
  const [draft, setDraft] = useState(tag);

  useEffect(() => { setDraft(tag); }, [tag]);

  const commit = () => {
    const next = draft.trim();
    if (next && next !== tag) onRename(tag, next);
    else setDraft(tag);
  };

  return (
    <span className="pf-tag-manage">
      <span className="pf-tag-swatch" style={{ background: tagColor(tag) ?? "#94a3b8" }} aria-hidden="true" />
      <input
        className="pf-tag-rename"
        value={draft}
        aria-label={`Rename tag ${tag}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
          if (e.key === "Escape") { e.preventDefault(); setDraft(tag); }
          e.stopPropagation();
        }}
      />
      <button
        type="button"
        className="pf-row-del"
        title={`Remove #${tag} from every task`}
        aria-label={`Delete tag ${tag}`}
        onClick={() => onDelete(tag)}
      >
        ×
      </button>
    </span>
  );
}

/**
 * Multi-value axes render as toggle chips rather than a multi-select.
 *
 * There are three or four options on each of these and they are the block's
 * primary controls; a `<select multiple>` hides the current state behind a
 * scroll box and needs a modifier key to deselect, which on an iPad means it
 * cannot be deselected at all.
 */
function ChipGroup({
  label, options, selected, onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div className="pf-chips" role="group" aria-label={label}>
      <span className="pf-chips-label">{label}</span>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`pf-chip${selected.includes(o.value) ? " is-on" : ""}`}
          aria-pressed={selected.includes(o.value)}
          onClick={() => toggle(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Plans and goals can number in the dozens, so those get a popover list, not chips. */
function MultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // `mousedown`, not `click`: a click listener added during a click event can
    // fire on the very event that opened the popover and close it immediately.
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const summary =
    selected.length === 0
      ? "Any"
      : selected.length === 1
        ? (options.find((o) => o.value === selected[0])?.label ?? "1 selected")
        : `${selected.length} selected`;

  return (
    <div className="pf-multi" ref={ref}>
      <button
        type="button"
        className={`pf-multi-btn${selected.length ? " is-on" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="pf-multi-label">{label}</span>
        <span className="pf-multi-value">{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>

      {open ? (
        <div className="pf-multi-pop">
          {options.length === 0 ? (
            <div className="pf-multi-empty">Nothing to choose from yet.</div>
          ) : (
            <>
              {selected.length > 0 ? (
                <button type="button" className="pf-multi-clear" onClick={() => onChange([])}>
                  Clear
                </button>
              ) : null}
              {options.map((o) => (
                <label className="pf-multi-row" key={o.value}>
                  <input
                    type="checkbox"
                    checked={selected.includes(o.value)}
                    onChange={() => toggle(o.value)}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Add, remove and reset the board's status columns.
 *
 * Removing a column does NOT touch the tasks in it — they keep their status and
 * appear in the board's "Other" bucket, which is deliberately not a drop target.
 * Deleting a column that silently rewrote every card in it would be a bulk edit
 * disguised as a layout change.
 */
function StatusEditor({
  statuses, isCustom, onChange,
}: {
  statuses: string[];
  isCustom: boolean;
  onChange: (v: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const next = normalizeStatuses([...statuses, draft]);
    setDraft("");
    // normalizeStatuses drops blanks, duplicates and anything past the cap, so
    // a no-op add is simply a list that did not grow.
    if (next.length !== statuses.length) onChange(next);
  };

  return (
    <div className="pf-chips" role="group" aria-label="Board columns">
      <span className="pf-chips-label">Columns</span>
      {statuses.map((s) => (
        <span key={s} className="pf-chip is-on pf-chip-status">
          {s.charAt(0).toUpperCase() + s.slice(1)}
          <button
            type="button"
            className="pf-tag-x"
            aria-label={`Remove the ${s} column`}
            title="Remove this column — the tasks in it keep their status and move to Other"
            // The last column cannot go: a board with no columns has nowhere to
            // show anything and no way back except editing the document.
            disabled={statuses.length <= 1}
            onClick={() => onChange(statuses.filter((x) => x !== s))}
          >×</button>
        </span>
      ))}
      <input
        className="pf-chip-input"
        value={draft}
        placeholder="Add column…"
        aria-label="Add a board column"
        maxLength={24}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(); }
          // The block lives inside a ProseMirror node view; an un-stopped key
          // reaches the editor and types into the note.
          e.stopPropagation();
        }}
        onBlur={add}
      />
      {isCustom ? (
        <button
          type="button"
          className="pf-chip"
          title="Back to Backlog / Todo / Doing / Done"
          onClick={() => onChange([])}
        >Reset</button>
      ) : null}
    </div>
  );
}

/**
 * Add, edit and remove computed columns.
 *
 * The expression is validated as you type and the error is shown inline —
 * `compile` knows the field list, so a typo reads "unknown field: estimat"
 * rather than producing a column of blanks with no explanation.
 */
/**
 * Stored custom columns.
 *
 * The key is the storage key and is normalised, so renaming a column is a data
 * operation, not a label change — the editor makes that visible by showing the
 * key next to the name rather than hiding it. Removing a column here removes it
 * from THIS note only; the values stay, because the same key is very often a
 * column in another note too.
 */
/**
 * Summary cards above the view.
 *
 * Deliberately the same controls as a computed column, minus the aggregate's
 * "none" — a stat IS an aggregate. Sharing the vocabulary is the point: someone
 * who has written one column formula can write a stat without learning a second
 * language, and the two can never disagree about what `sum(estimate)` means.
 */
function StatEditor({
  stats, onChange,
}: {
  stats: StatCard[];
  onChange: (v: StatCard[]) => void;
}) {
  const patch = (id: string, part: Partial<StatCard>) =>
    onChange(stats.map((c) => (c.id === id ? { ...c, ...part } : c)));

  return (
    <div className="pf-formulas" role="group" aria-label="Summary figures">
      <span className="pf-chips-label">Summary</span>

      {stats.map((c) => (
        <span key={c.id} className="pf-formula-row">
          <input
            className="pf-formula-label"
            value={c.label}
            placeholder="Name"
            maxLength={40}
            aria-label="Figure name"
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => patch(c.id, { label: e.target.value })}
          />
          <input
            className="pf-formula-expr"
            value={c.expr}
            placeholder="estimate / 60"
            maxLength={MAX_FORMULA_CHARS}
            aria-label="Expression"
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) => patch(c.id, { expr: e.target.value })}
          />
          <select
            className="pf-formula-agg"
            value={c.agg}
            aria-label="How the rows collapse to one figure"
            onChange={(e) => patch(c.id, { agg: e.target.value as StatCard["agg"] })}
          >
            {STAT_AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select
            className="pf-formula-agg"
            value={c.display}
            aria-label="How the figure is drawn"
            onChange={(e) => patch(c.id, { display: e.target.value as MeterDisplay })}
          >
            {/* A ring is not offered: a card is wide and short, and a ring in it
                is a small circle beside a large number saying the same thing. */}
            <option value="number">number</option>
            <option value="bar">bar</option>
          </select>
          <button
            type="button"
            className="pf-tag-x"
            aria-label={`Remove the ${c.label || c.expr} figure`}
            onClick={() => onChange(stats.filter((x) => x.id !== c.id))}
          >×</button>
        </span>
      ))}

      {stats.length < MAX_STATS ? (
        <button
          type="button"
          className="pf-chip"
          onClick={() => onChange([
            ...stats,
            { id: crypto.randomUUID().slice(0, 8), label: "", expr: "estimate", agg: "sum", display: "number", max: 100 },
          ])}
        >+ figure</button>
      ) : null}
    </div>
  );
}

function FieldEditor({
  fields, onChange,
}: {
  fields: FieldColumn[];
  onChange: (v: FieldColumn[]) => void;
}) {
  const [adding, setAdding] = useState("");

  const add = () => {
    const key = normalizeFieldKey(adding);
    setAdding("");
    if (!key) return;
    // Two refusals with different reasons, and both are silent-by-design: the
    // button simply does nothing rather than throwing a dialog into a note.
    // A duplicate would split one column's values across two headers; a
    // built-in name would make `estimate` mean two things in one formula.
    if (fields.some((f) => f.key === key)) return;
    if (RESERVED_FIELD_KEYS.has(key)) return;
    onChange([...fields, { key, label: adding.trim().slice(0, 40), type: "text" }]);
  };

  return (
    <div className="pf-fields" role="group" aria-label="Stored columns">
      <span className="pf-chips-label">Stored</span>

      {fields.map((f) => (
        <span key={f.key} className="pf-field-row">
          <input
            className="pf-field-label"
            value={f.label}
            placeholder={f.key}
            maxLength={40}
            aria-label={`Name of the ${f.key} column`}
            onKeyDown={(e) => e.stopPropagation()}
            onChange={(e) =>
              onChange(fields.map((x) => (x.key === f.key ? { ...x, label: e.target.value } : x)))}
          />
          <select
            className="pf-field-type"
            value={f.type}
            aria-label={`Type of the ${f.label || f.key} column`}
            onChange={(e) =>
              onChange(fields.map((x) => (x.key === f.key ? { ...x, type: e.target.value as FieldType } : x)))}
          >
            {FIELD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            type="button"
            className="pf-tag-x"
            // Deliberately "Hide": the values survive. Deleting them everywhere
            // is a separate, explicit act — see deleteTaskFieldEverywhere.
            aria-label={`Hide the ${f.label || f.key} column here`}
            title="Removes the column from this block. The values are kept."
            onClick={() => onChange(fields.filter((x) => x.key !== f.key))}
          >×</button>
        </span>
      ))}

      {fields.length < MAX_FIELDS ? (
        <span className="pf-field-add">
          <input
            className="pf-field-new"
            value={adding}
            placeholder="+ stored column"
            maxLength={FIELD_KEY_MAX}
            aria-label="Add a stored column"
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") { e.preventDefault(); add(); }
            }}
            onBlur={add}
          />
        </span>
      ) : null}
    </div>
  );
}

function FormulaEditor({
  formulas, fields, onChange,
}: {
  formulas: FormulaColumn[];
  /** The block's stored columns — their numeric keys are readable names. */
  fields: FieldColumn[];
  onChange: (v: FormulaColumn[]) => void;
}) {
  // Compiled against the same names the table uses, so a formula that works
  // here works there. Getting this wrong would validate `budget * 2` in the
  // editor and blank it in the table, or the reverse.
  const names = useMemo(() => formulaFieldNames(fields), [fields]);
  const patch = (id: string, part: Partial<FormulaColumn>) =>
    onChange(formulas.map((f) => (f.id === id ? { ...f, ...part } : f)));

  return (
    <div className="pf-formulas" role="group" aria-label="Computed columns">
      <span className="pf-chips-label">Computed</span>

      {formulas.map((f) => {
        const prog = compile(f.expr, names);
        return (
          <span key={f.id} className="pf-formula-row">
            <input
              className="pf-formula-label"
              value={f.label}
              placeholder="Name"
              maxLength={40}
              aria-label="Column name"
              onChange={(e) => patch(f.id, { label: e.target.value })}
              onKeyDown={(e) => e.stopPropagation()}
            />
            <input
              className={`pf-formula-expr${prog.ok ? "" : " is-bad"}`}
              value={f.expr}
              placeholder="estimate / 60"
              maxLength={MAX_FORMULA_CHARS}
              aria-label="Formula"
              aria-invalid={!prog.ok}
              // The block lives in a ProseMirror node view; an un-stopped key
              // reaches the editor and types into the note.
              onKeyDown={(e) => e.stopPropagation()}
              onChange={(e) => patch(f.id, { expr: e.target.value })}
            />
            <select
              className="pf-formula-agg"
              value={f.agg}
              aria-label="Footer total"
              onChange={(e) => patch(f.id, { agg: e.target.value as FormulaAgg })}
            >
              {FORMULA_AGGS.map((a) => (
                <option key={a} value={a}>{a === "none" ? "no total" : a}</option>
              ))}
            </select>
            <select
              className="pf-formula-agg"
              value={f.display}
              aria-label="How the cell is drawn"
              onChange={(e) => patch(f.id, { display: e.target.value as MeterDisplay })}
            >
              {METER_DISPLAYS.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            {/* The scale only exists for a meter. Showing it beside a plain
                number column would be a control with nothing to control. */}
            {f.display !== "number" ? (
              <input
                className="pf-formula-max"
                value={f.max === "auto" ? "auto" : String(f.max)}
                aria-label="What counts as full"
                title={'A number, or "auto" to scale to the largest visible row'}
                onKeyDown={(e) => e.stopPropagation()}
                onChange={(e) => {
                  const raw = e.target.value.trim().toLowerCase();
                  if (raw === "auto") return patch(f.id, { max: "auto" });
                  const n = Number(raw);
                  // Anything unparseable is ignored rather than reset to a
                  // default: the user is mid-typing "1" of "150".
                  if (Number.isFinite(n) && n >= METER_MAX_MIN) patch(f.id, { max: n });
                }}
              />
            ) : null}
            <button
              type="button"
              className="pf-tag-x"
              aria-label={`Remove the ${f.label || f.expr} column`}
              onClick={() => onChange(formulas.filter((x) => x.id !== f.id))}
            >×</button>
            {!prog.ok ? <span className="pf-formula-msg">{prog.error}</span> : null}
          </span>
        );
      })}

      {formulas.length < MAX_FORMULAS ? (
        <button
          type="button"
          className="pf-chip"
          onClick={() => onChange([
            ...formulas,
            // crypto.randomUUID is used for node ids elsewhere in Vault; a
            // stable id is what lets a column keep its width and position
            // across edits to its own label.
            { id: crypto.randomUUID().slice(0, 8), label: "", expr: "estimate / 60", agg: "none", display: "number", max: 100 },
          ])}
        >+ column</button>
      ) : null}

      <details className="pf-formula-help">
        <summary>fields</summary>
        <ul>
          {FORMULA_FIELDS.map((f) => (
            <li key={f.name}><code>{f.name}</code> — {f.help}</li>
          ))}
          {/* Text columns are absent by design: they have no numeric meaning,
              and offering one here would produce a formula that is always
              blank rather than an error naming the reason. */}
          {fields.filter((f) => f.type !== "text").map((f) => (
            <li key={f.key}><code>{f.key}</code> — stored {f.type}{f.label && f.label !== f.key ? ` ("${f.label}")` : ""}</li>
          ))}
          <li>
            <code>+ - * / %</code>, comparisons, <code>&amp;&amp;</code> <code>||</code>,
            {" "}<code>a ? b : c</code>, and <code>min max round floor ceil abs if</code>
          </li>
        </ul>
      </details>
    </div>
  );
}

function ColumnPicker({
  choices,
  selected, onChange,
}: {
  /** Which columns this view can actually draw — see LIST_COLUMNS. */
  choices: PfColumn[];
  selected: PfColumn[];
  onChange: (v: PfColumn[]) => void;
}) {
  const toggle = (c: PfColumn) => {
    // `title` is not removable — a table whose rows carry no label is not a
    // table, and the parser puts it back anyway.
    if (c === "title") return;
    onChange(sortColumns(selected.includes(c) ? selected.filter((x) => x !== c) : [...selected, c]));
  };

  return (
    <div className="pf-chips" role="group" aria-label="Columns">
      <span className="pf-chips-label">Columns</span>
      {choices.map((c) => (
        <button
          key={c}
          type="button"
          className={`pf-chip${selected.includes(c) ? " is-on" : ""}${c === "title" ? " is-locked" : ""}`}
          aria-pressed={selected.includes(c)}
          disabled={c === "title"}
          title={c === "title" ? "Always shown" : undefined}
          onClick={() => toggle(c)}
        >
          {c === "done" ? "✓ Done" : PF_COLUMN_LABELS[c]}
        </button>
      ))}
    </div>
  );
}
