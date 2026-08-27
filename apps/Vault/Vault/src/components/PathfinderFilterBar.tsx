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

import { useEffect, useRef, useState } from "react";
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
  PF_COLUMNS,
  PF_COLUMN_LABELS,
  SPEC_MAX_LIMIT,
  sortColumns,
  type PfBlockSpec,
  type PfBlockView,
  type PfColumn,
} from "../lib/pathfinderBlock";

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
  onChange: (next: PfBlockSpec) => void;
}

export function PathfinderFilterBar({ spec, view, plans, goals, teams, members, onChange }: Props) {
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

      <div className="pf-filter-row pf-filter-row-end">
        <label className="pf-toggle">
          <input
            type="checkbox"
            checked={spec.filter.rootsOnly}
            onChange={(e) => setFilter({ rootsOnly: e.target.checked })}
          />
          <span title="Hide tasks that are steps of another task">Top-level only</span>
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

        {view === "table" ? (
          <ColumnPicker
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
  label, value, options, onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="pf-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
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

function ColumnPicker({
  selected, onChange,
}: {
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
      {PF_COLUMNS.map((c) => (
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
