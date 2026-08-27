// The configuration a `pathfinderBlock` carries in the document.
//
// Stored as a JSON **string** attribute, following SketchBlock: ProseMirror is
// happy with a nested object, but an attribute that round-trips through an HTML
// data-attribute has to be a string on the way out anyway, and having one
// representation instead of two removes the whole "works in JSON, silently empty
// after a paste" class of bug.
//
// ⚠️ Everything here is an ATTRIBUTE, which is the reason the three views are
// one node type rather than three. `Node.fromJSON` builds attrs by iterating the
// *type's* declared attributes and never looks for extras, so an attribute a
// client doesn't understand is dropped silently. An unknown NODE TYPE is the
// opposite: `createNodeFromContent` catches ProseMirror's throw and returns an
// EMPTY DOCUMENT, the autosave writes that blank over the note, and
// `vault_content` keeps no history. See lib/noteSchemaGuard.ts.
//
// So: new views, new filter axes and new columns can all ship ahead of the Mac
// and iPad builds. A fourth node type could not.

import {
  DEFAULT_FILTER,
  KANBAN_STATUSES,
  PRIORITIES,
  STAGES,
  STAGE_LABELS,
  TASK_TYPES,
  TASK_TYPE_LABELS,
  TREE_MODES,
  URGENCIES,
  activeFilterCount,
  isUnfiltered,
  memberName,
  type BoardAxis,
  type DoneFilter,
  type DueWindow,
  type OwnerScope,
  type PfGoal,
  type PfPlan,
  type PfTeam,
  type PfTeamMember,
  type SortDir,
  type SortKey,
  type TaskFilter,
  type TreeMode,
} from "@nexus/core/pathfinder";
// ⚠️ `./taskTags`, NEVER `./vaultTaskTags`. This module is part of the note
// schema — noteExtensions imports it, and noteSchemaGuard builds that schema
// before any editor or network client exists. `vaultTaskTags` imports
// `./supabase`, which constructs a client at module load and throws
// `supabaseUrl is required` wherever Vite's env is absent. It is the same rule
// PathfinderBlockLazy enforces for the view.
import { TAG_MODES, normalizeTagList, type TagMode } from "./taskTags";

export type PfBlockView = "list" | "board" | "table";

export const PF_VIEWS: PfBlockView[] = ["list", "board", "table"];

export const PF_VIEW_LABELS: Record<PfBlockView, string> = {
  list: "To-do list",
  board: "Board",
  table: "Table",
};

export const PF_VIEW_ICONS: Record<PfBlockView, string> = {
  list: "☑",
  board: "▦",
  table: "▤",
};

/** Table columns, in the order they render when all are on. */
export type PfColumn =
  | "done"
  | "title"
  | "tags"
  | "plan"
  | "goal"
  | "priority"
  | "urgency"
  | "stage"
  | "due"
  | "estimate"
  | "type"
  | "assignee";

export const PF_COLUMNS: PfColumn[] = [
  "done", "title", "tags", "plan", "goal", "assignee", "priority", "urgency", "stage", "due", "estimate", "type",
];

export const PF_COLUMN_LABELS: Record<PfColumn, string> = {
  done: "✓",
  title: "Task",
  tags: "Tags",
  plan: "Plan",
  goal: "Goal",
  assignee: "Who",
  priority: "Priority",
  urgency: "Urgency",
  stage: "Stage",
  due: "Due",
  estimate: "Est.",
  type: "Kind",
};

/** `title` is not optional — a table whose rows have no label is not a table. */
const REQUIRED_COLUMNS: PfColumn[] = ["title"];

/**
 * The columns the LIST view can actually draw.
 *
 * Narrower than PF_COLUMNS on purpose. `urgency` and `stage` have no place in a
 * list row — it is a line of text with a few chips, not a grid — and offering a
 * switch that does nothing is worse than not offering it: the user flips it,
 * nothing happens, and now they distrust the whole panel.
 *
 * `tags` is absent for a different reason: the list already gates them on
 * `showTags`, which predates this and has its own toggle in the filter bar. Two
 * switches for one chip is how they end up disagreeing.
 */
export const LIST_COLUMNS: PfColumn[] = [
  "done", "title", "plan", "goal", "assignee", "priority", "due", "estimate", "type",
];

/**
 * Column visibility for the list, as a lookup.
 *
 * ⚠️ The list used to render every chip unconditionally, which is how a note
 * column ended up showing "Housewarming Clean/Prep" and "Unassigned" on all 27
 * rows while the task title itself was squeezed to one letter per line. The
 * information was not wrong; there was just no way to say "not that one".
 */
export function listColumns(spec: PfBlockSpec): Set<PfColumn> {
  return new Set(spec.columns.filter((c) => LIST_COLUMNS.includes(c)));
}

const DEFAULT_COLUMNS: PfColumn[] = ["done", "title", "plan", "priority", "due"];

export interface PfBlockSpec {
  filter: TaskFilter;
  sort: { key: SortKey; dir: SortDir };
  /** 0 = uncapped. Bounded by SPEC_MAX_LIMIT so one block cannot render 2,000 rows. */
  limit: number;
  /** Board only. */
  groupBy: BoardAxis;
  /** Table only. */
  columns: PfColumn[];
  /** Denser rows — the same block inline in a paragraph-heavy note. */
  compact: boolean;
  /** Show the per-block filter controls. Persisted so a configured block stays quiet. */
  showFilters: boolean;

  /**
   * How much of the task hierarchy the list and table render. The board ignores
   * it — a Kanban card cannot contain another card, so a board shows a subtask
   * roll-up chip instead of nesting.
   */
  tree: TreeMode;

  // ── Vault-only tags ───────────────────────────────────────────────────────
  //
  // These axes exist nowhere in PathFinder, which is the whole point: a note can
  // slice tasks by a vocabulary that means something *here* without pushing it
  // into PathFinder's own filters, its widgets, or a teammate's copy of a shared
  // task. They live on the block spec rather than in `TaskFilter` for the same
  // reason — `@nexus/core/pathfinder` is shared with apps that have no Vault.
  /** Tag names, already normalized. Empty = no constraint. */
  tags: string[];
  tagMode: TagMode;
  /** Only tasks carrying no Vault tags. A hard gate — see `matchesTags`. */
  untaggedOnly: boolean;
  /** Render each row's tags as chips. Off by default: a tagged list gets noisy fast. */
  showTags: boolean;

  /**
   * List only. How much of the row width the metadata strip may take, as a
   * PERCENTAGE. 0 means "as much as it needs", the behaviour before this
   * existed.
   *
   * A percentage rather than pixels, and that is not a detail: a Vault note is
   * 720 px to full-bleed depending on `NoteDocument`'s per-note width, and the
   * same note opens on an iPad. A width stored in pixels would be right on the
   * screen it was dragged on and wrong on every other one — the same reasoning
   * that puts sketch coordinates in a 1000-unit logical space.
   */
  metaPct: number;

  /**
   * Table only. Relative column widths, keyed by column. Missing = 1.
   *
   * WEIGHTS, not pixels and not percentages. Pixels would be wrong the moment
   * the note changes width or opens on the iPad (same reasoning as `metaPct`),
   * and stored percentages stop summing to 100 the moment a column is added or
   * removed — so they would need renormalising on every toggle, and any bug in
   * that renormalisation is a table that slowly drifts off the edge. Weights
   * normalise at render time, so adding a column simply gives everyone a
   * slightly smaller share and removing one gives it back.
   */
  colWeights: Record<string, number>;
}

/** A column may not be dragged to nothing, nor swallow the table. */
export const COL_WEIGHT_MIN = 0.25;
export const COL_WEIGHT_MAX = 6;

/**
 * The actions column's share. Not user-adjustable: it holds two icon buttons
 * and has no content that could want more room.
 */
const ACTIONS_WEIGHT = 0.55;

/** Neither side of the split may vanish; below these a drag becomes a delete. */
export const META_PCT_MIN = 12;
export const META_PCT_MAX = 70;

export const SPEC_MAX_LIMIT = 200;

/**
 * Serialized-attribute ceiling. A block's config shares the note's 2 MB
 * `saveContent` budget with its text, and an unbounded one would stop the note's
 * *prose* saving too — the same reasoning as SKETCH_MAX_CHARS, at a far smaller
 * scale because this is a handful of ids and enum strings.
 */
export const SPEC_MAX_CHARS = 8_000;

export function defaultSpec(view: PfBlockView): PfBlockSpec {
  return {
    filter: { ...DEFAULT_FILTER },
    // A fresh block should be useful before it is configured. Due-date order
    // answers "what is next", which is what someone dropping a task list into a
    // note almost always means.
    sort: { key: view === "board" ? "manual" : "due", dir: "asc" },
    limit: view === "list" ? 25 : 50,
    groupBy: "kanban_status",
    columns: [...DEFAULT_COLUMNS],
    compact: false,
    // Open on insert so the block announces that it is configurable, then
    // stays however the user left it. Persisted in the doc rather than in React
    // state so a block reads the same on every device.
    showFilters: true,
    // Nesting is the default, and `matched` rather than `full` is the reason it
    // can be. It shows the hierarchy where the filter already agrees there is
    // one, and never drags in rows the block was told to exclude — so turning it
    // on changes the SHAPE of an existing block's results without changing WHICH
    // tasks it contains. `full` is one click away on any row that has more.
    tree: "matched",
    tags: [],
    tagMode: "any",
    untaggedOnly: false,
    showTags: false,
    metaPct: 0,
    colWeights: {},
  };
}

// ── Parsing ─────────────────────────────────────────────────────────────────
//
// Every field is validated against its own domain rather than trusted. This
// attribute is user-editable text in the document: a paste from an older or
// newer build, a hand-edited HTML import, or a half-written value from a client
// that shipped an axis this one doesn't have. Anything unrecognised falls back
// to the default for that field alone — never to a default *spec*, which would
// silently discard the rest of a block's configuration.

function strArray(v: unknown, allowed: readonly string[]): string[] {
  if (!Array.isArray(v)) return [];
  const set = new Set(allowed);
  return [...new Set(v.filter((x): x is string => typeof x === "string" && set.has(x)))];
}

function numArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is number => typeof x === "number" && Number.isFinite(x)))];
}

/** Opaque identifiers (uuids, kanban labels) — only the shape can be validated. */
function freeStrings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

function pick<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

/**
 * Ceiling on the tag filter, so one block's spec cannot grow without bound and
 * push the serialized attribute past SPEC_MAX_CHARS — at which point
 * `serializeSpec` throws the WHOLE configuration away, not just the tags.
 */
export const MAX_FILTER_TAGS = 40;

const DUE_WINDOWS: DueWindow[] = ["any", "overdue", "today", "week", "month", "none", "dated"];
const DONE_FILTERS: DoneFilter[] = ["open", "done", "all"];
const OWNER_SCOPES: OwnerScope[] = ["any", "personal", "team"];
const SORT_KEYS: SortKey[] = ["manual", "due", "priority", "urgency", "title", "created", "estimate", "plan"];
const BOARD_AXES: BoardAxis[] = ["kanban_status", "stage", "priority", "urgency", "plan", "task_type", "assignee"];

export function parseSpec(raw: string | null | undefined, view: PfBlockView): PfBlockSpec {
  const base = defaultSpec(view);
  if (!raw) return base;

  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    return base;
  }
  if (!obj || typeof obj !== "object") return base;

  const f = obj.filter && typeof obj.filter === "object" ? obj.filter : {};

  const columns = strArray(obj.columns, PF_COLUMNS) as PfColumn[];
  for (const req of REQUIRED_COLUMNS) {
    if (!columns.includes(req)) columns.push(req);
  }

  return {
    filter: {
      planIds: numArray(f.planIds),
      goalIds: numArray(f.goalIds),
      taskTypes: strArray(f.taskTypes, TASK_TYPES) as TaskFilter["taskTypes"],
      priorities: strArray(f.priorities, PRIORITIES) as TaskFilter["priorities"],
      urgencies: strArray(f.urgencies, URGENCIES) as TaskFilter["urgencies"],
      stages: strArray(f.stages, STAGES) as TaskFilter["stages"],
      // Free text in the database, so any string is legitimate here — only the
      // shape is validated.
      kanbanStatuses: freeStrings(f.kanbanStatuses),
      done: pick(f.done, DONE_FILTERS, "open"),
      due: pick(f.due, DUE_WINDOWS, "any"),
      search: typeof f.search === "string" ? f.search.slice(0, 200) : "",
      rootsOnly: f.rootsOnly === true,
      excludeQuick: f.excludeQuick === true,
      scope: pick(f.scope, OWNER_SCOPES, "any"),
      // Team ids are uuids and member ids are auth uids — both opaque strings
      // this side of the network, so only the shape can be checked. A stale id
      // (a team you left) simply matches nothing.
      teamIds: freeStrings(f.teamIds),
      assignee: typeof f.assignee === "string" && f.assignee ? f.assignee : "any",
    },
    sort: {
      key: pick(obj.sort?.key, SORT_KEYS, base.sort.key),
      dir: pick(obj.sort?.dir, ["asc", "desc"] as const, base.sort.dir),
    },
    limit: clampLimit(obj.limit, base.limit),
    groupBy: pick(obj.groupBy, BOARD_AXES, base.groupBy),
    // NOT sorted. `sortColumns` used to run here, which meant a hand-ordered
    // table snapped back to canonical order on the next load — placement could
    // be changed but never survive. `strArray` already validates and dedupes
    // while preserving order, so the stored array IS the order.
    columns: columns.length ? columns : [...DEFAULT_COLUMNS],
    compact: obj.compact === true,
    showFilters: obj.showFilters !== false,
    // A block written before hierarchy existed carries no `tree` key, and gets
    // the default — which nests it. That is the intended migration: the shape of
    // the result changes, the set of tasks in it does not (see `defaultSpec`).
    tree: pick(obj.tree, TREE_MODES, base.tree),
    // Re-normalized on the way in, not trusted. This string is user-editable
    // text in the document: a paste from a build with different casing rules, or
    // a hand-edited export, would otherwise put `"Reading"` in a list the store
    // only ever holds `"reading"` in — and the filter would match nothing while
    // looking perfectly correct.
    tags: normalizeTagList(freeStrings(obj.tags)).slice(0, MAX_FILTER_TAGS),
    tagMode: pick(obj.tagMode, TAG_MODES, base.tagMode),
    untaggedOnly: obj.untaggedOnly === true,
    showTags: obj.showTags === true,
    metaPct: clampMetaPct(obj.metaPct),
    colWeights: parseWeights(obj.colWeights),
  };
}

/**
 * 0 (auto) or a value inside the band. Anything else — a hand-edited document, a
 * paste from a future build, NaN — becomes auto rather than a wedged layout.
 */
function clampMetaPct(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return 0;
  const n = Math.round(v);
  if (n <= 0) return 0;
  return Math.min(META_PCT_MAX, Math.max(META_PCT_MIN, n));
}

function clampLimit(v: unknown, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  if (v <= 0) return 0;
  return Math.min(Math.round(v), SPEC_MAX_LIMIT);
}

/**
 * Canonical column order. Still used to seed a fresh block and to reason about
 * where a re-enabled column belongs — but no longer imposed on a stored spec,
 * because that is what made column placement unstorable.
 */
export function sortColumns(cols: PfColumn[]): PfColumn[] {
  return PF_COLUMNS.filter((c) => cols.includes(c));
}

/**
 * Re-enable a column, at its canonical position RELATIVE to the columns already
 * shown — not appended to the end.
 *
 * This is what preserves the property `sortColumns` used to provide ("toggling
 * one off and on again doesn't move it") now that the array order is the user's
 * to set. Appending instead would mean every accidental double-click silently
 * rearranged the table.
 */
export function withColumn(cols: PfColumn[], c: PfColumn): PfColumn[] {
  if (cols.includes(c)) return cols;
  const rank = (x: PfColumn) => PF_COLUMNS.indexOf(x);
  const at = cols.findIndex((x) => rank(x) > rank(c));
  const next = [...cols];
  next.splice(at === -1 ? next.length : at, 0, c);
  return next;
}

export function withoutColumn(cols: PfColumn[], c: PfColumn): PfColumn[] {
  // `title` is not removable — a table whose rows carry no label is not a table.
  if (REQUIRED_COLUMNS.includes(c)) return cols;
  return cols.filter((x) => x !== c);
}

/** Move `from` so that it sits where `to` currently is. */
export function moveColumn(cols: PfColumn[], from: PfColumn, to: PfColumn): PfColumn[] {
  if (from === to) return cols;
  const i = cols.indexOf(from);
  const j = cols.indexOf(to);
  if (i === -1 || j === -1) return cols;
  const next = [...cols];
  next.splice(i, 1);
  next.splice(j, 0, from);
  return next;
}

function clampWeight(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return Math.min(COL_WEIGHT_MAX, Math.max(COL_WEIGHT_MIN, Math.round(v * 100) / 100));
}

function parseWeights(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    // Unknown column names are dropped rather than kept: a weight for a column
    // this build does not have is dead weight in a size-capped attribute.
    if (!(PF_COLUMNS as string[]).includes(k)) continue;
    const w = clampWeight(raw);
    if (w !== null && w !== 1) out[k] = w;   // 1 is the default; storing it is noise
  }
  return out;
}

export function columnWeight(weights: Record<string, number>, c: PfColumn): number {
  return clampWeight(weights[c]) ?? 1;
}

/**
 * Weights → CSS percentages, including the trailing actions column.
 *
 * Percentages rather than pixels so a table keeps its proportions across the
 * 720px-to-full-bleed range a note can be, and on the iPad. The actions column
 * is folded into the same total rather than given a fixed px width: mixing px
 * and % under `table-layout: fixed` leaves the browser to reconcile them, and
 * "the browser will sort it out" is how a table ends up 3px wider than its
 * scroll container on one platform only.
 */
export function columnWidths(
  cols: PfColumn[],
  weights: Record<string, number>,
): { data: number[]; actions: number } {
  const ws = cols.map((c) => columnWeight(weights, c));
  const total = ws.reduce((a, b) => a + b, 0) + ACTIONS_WEIGHT;
  if (total <= 0) return { data: cols.map(() => 0), actions: 100 };
  return {
    data: ws.map((w) => (w / total) * 100),
    actions: (ACTIONS_WEIGHT / total) * 100,
  };
}

export function serializeSpec(spec: PfBlockSpec): string {
  const json = JSON.stringify(spec);
  // Over the cap the block reverts to a default rather than writing a truncated
  // string that would not parse — a config that silently becomes invalid JSON is
  // worse than one that visibly resets.
  return json.length <= SPEC_MAX_CHARS ? json : JSON.stringify(defaultSpec("list"));
}

// ── Labelling ───────────────────────────────────────────────────────────────

/**
 * The heading a block shows when the user hasn't named it.
 *
 * Derived rather than stored: a block filtered to a plan should say so, and keep
 * saying so if the plan is renamed. An explicit `title` attribute always wins.
 */
export function deriveLabel(
  spec: PfBlockSpec,
  view: PfBlockView,
  plans: PfPlan[],
  goals: PfGoal[],
  teams: PfTeam[] = [],
  members: PfTeamMember[] = [],
): string {
  const f = spec.filter;
  const parts: string[] = [];

  // A tag leads even ownership: it is the most specific thing the user chose,
  // and it is the axis PathFinder cannot see — a block that exists *because* of
  // a tag should say the tag's name, not "Open tasks".
  if (spec.untaggedOnly) parts.push("Untagged");
  else if (spec.tags.length === 1 && spec.tagMode !== "none") parts.push(`#${spec.tags[0]}`);
  else if (spec.tags.length > 1 && spec.tagMode !== "none") {
    parts.push(spec.tags.map((t) => `#${t}`).join(spec.tagMode === "all" ? " + " : " / "));
  }

  // Ownership leads the label. "Josefine · overdue" is a different list from
  // "overdue", and a block that shows someone else's work should say so before
  // it says anything else.
  if (f.assignee === "me") parts.push("My");
  else if (f.assignee === "unassigned") parts.push("Unassigned");
  else if (f.assignee !== "any") {
    parts.push(members.find((m) => m.user_id === f.assignee)?.display_name ?? memberName(f.assignee));
  }

  if (f.teamIds.length === 1) {
    parts.push(teams.find((t) => t.id === f.teamIds[0])?.name ?? "Team");
  } else if (f.teamIds.length > 1) {
    parts.push(`${f.teamIds.length} teams`);
  } else if (f.scope === "team") {
    parts.push("Shared");
  } else if (f.scope === "personal") {
    parts.push("Personal");
  }

  if (f.planIds.length === 1) {
    parts.push(plans.find((p) => p.id === f.planIds[0])?.title ?? "Plan");
  } else if (f.planIds.length > 1) {
    parts.push(`${f.planIds.length} plans`);
  } else if (f.goalIds.length === 1) {
    parts.push(goals.find((g) => g.id === f.goalIds[0])?.title ?? "Goal");
  } else if (f.goalIds.length > 1) {
    parts.push(`${f.goalIds.length} goals`);
  }

  if (f.taskTypes.length === 1) parts.push(`${TASK_TYPE_LABELS[f.taskTypes[0]]}s`);
  else if (f.stages.length === 1) parts.push(STAGE_LABELS[f.stages[0]]);

  if (f.due === "overdue") parts.push("overdue");
  else if (f.due === "today") parts.push("due today");
  else if (f.due === "week") parts.push("due this week");
  else if (f.due === "month") parts.push("due this month");

  if (f.done === "done") parts.push("completed");

  if (parts.length === 0) return f.done === "all" ? "All tasks" : "Open tasks";

  const label = parts.join(" · ");
  return label.charAt(0).toUpperCase() + label.slice(1) || PF_VIEW_LABELS[view];
}

// ── Board columns ───────────────────────────────────────────────────────────

/**
 * The columns a board renders for an axis.
 *
 * `kanban_status` is FREE TEXT in the database — `setTaskKanbanStatus` takes a
 * string and nothing constrains it — so the board owns this list rather than
 * discovering it from the data. Discovering it would mean a column appears and
 * disappears as the last card leaves it, which is exactly the drop target you
 * need to still be there.
 */
export function boardColumns(
  axis: BoardAxis,
  plans: PfPlan[],
  members: PfTeamMember[] = [],
): Array<{ key: string; label: string }> {
  switch (axis) {
    case "assignee": {
      // Deduplicated across teams — the same person on two teams is one column,
      // not two. "Unassigned" leads, because that is the column work needs
      // moving OUT of and it should not be hunted for at the far right.
      const seen = new Map<string, string>();
      for (const m of members) seen.set(m.user_id, m.display_name || memberName(m.user_id));
      return [
        { key: "__unassigned__", label: "Unassigned" },
        { key: "all", label: "Everyone" },
        ...[...seen.entries()].map(([id, label]) => ({ key: id, label })),
      ];
    }
    case "kanban_status":
      return KANBAN_STATUSES.map((k) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1) }));
    case "stage":
      return STAGES.map((s) => ({ key: s, label: STAGE_LABELS[s] }));
    case "priority":
      return PRIORITIES.map((p) => ({ key: p, label: p.charAt(0).toUpperCase() + p.slice(1) }));
    case "urgency":
      return URGENCIES.map((u) => ({ key: u, label: u.charAt(0).toUpperCase() + u.slice(1) }));
    case "task_type":
      return TASK_TYPES.map((t) => ({ key: t, label: TASK_TYPE_LABELS[t] }));
    case "plan":
      return plans.map((p) => ({ key: String(p.id), label: p.title }));
    default:
      return [];
  }
}

export const BOARD_AXIS_LABELS: Record<BoardAxis, string> = {
  kanban_status: "Status",
  stage: "Stage",
  priority: "Priority",
  urgency: "Urgency",
  plan: "Plan",
  task_type: "Kind",
  assignee: "Assignee",
};

/**
 * Which write a drop on this axis performs — or null when the axis is read-only.
 *
 * `plan` and `task_type` are deliberately not draggable. Moving a task between
 * plans is a re-parenting decision with goal-linkage consequences, and
 * `task_type` is a GENERATED column that cannot be written at all; offering a
 * drag that silently does nothing is worse than not offering it.
 */
export type AxisWriteField = "kanban_status" | "stage" | "priority" | "urgency" | "assigned_to";

export function axisWriteField(axis: BoardAxis): AxisWriteField | null {
  if (axis === "kanban_status" || axis === "stage" || axis === "priority" || axis === "urgency") {
    return axis;
  }
  // Reassigning by dragging a card into someone's column is the whole point of
  // a team board, so this axis IS writable — unlike `plan` and `task_type`.
  if (axis === "assignee") return "assigned_to";
  return null;
}

/**
 * The value a drop on `columnKey` should write.
 *
 * The assignee axis needs this indirection because two of its columns are not
 * user ids: `__unassigned__` means the column is `null`, and `all` is the
 * literal sentinel for "everyone on the team". Writing the string
 * `"__unassigned__"` into `assigned_to` would produce a task assigned to a
 * person who does not exist — visible to nobody, and indistinguishable from
 * unassigned until someone looked at the row.
 */
export function axisDropValue(axis: BoardAxis, columnKey: string): string | null {
  if (axis === "assignee") return columnKey === "__unassigned__" ? null : columnKey;
  return columnKey;
}

// ── Hierarchy ───────────────────────────────────────────────────────────────

export const TREE_MODE_LABELS: Record<TreeMode, string> = {
  off: "Flat list",
  matched: "Nested",
  full: "Nested + hidden steps",
};

export const TREE_MODE_HINTS: Record<TreeMode, string> = {
  off: "One row per matching task, no indentation.",
  matched: "Indent matching tasks under their matching parents. A step whose parent is filtered out becomes a top-level row rather than disappearing.",
  full: "Every step of a matching task, even ones the filter excludes.",
};

// ── Spec-wide filter state ──────────────────────────────────────────────────
//
// `activeFilterCount` and `isUnfiltered` in @nexus/core count PathFinder's axes
// and cannot count Vault's tags — the shared module has no idea they exist.
// These wrap them so the badge on the ⚙ button and the "Clear filters" empty
// state stay honest. Forgetting this is a specific and confusing bug: a block
// filtered to one tag would show no badge, read "No open tasks", and offer a
// Clear button that clears everything except the thing actually hiding the rows.

export function specFilterCount(spec: PfBlockSpec): number {
  let n = activeFilterCount(spec.filter);
  if (spec.tags.length > 0) n++;
  if (spec.untaggedOnly) n++;
  return n;
}

export function specIsUnfiltered(spec: PfBlockSpec): boolean {
  return isUnfiltered(spec.filter) && spec.tags.length === 0 && !spec.untaggedOnly;
}

/**
 * The spec "Clear filters" resets.
 *
 * Deliberately not `done`, `tree`, `columns`, `compact` or `showTags` — those
 * are how the block is *displayed*, not what it is showing, and resetting them
 * would make one button undo a different decision than the one it names.
 */
export function clearedSpec(spec: PfBlockSpec): PfBlockSpec {
  return {
    ...spec,
    filter: {
      ...spec.filter,
      planIds: [],
      goalIds: [],
      taskTypes: [],
      priorities: [],
      urgencies: [],
      stages: [],
      kanbanStatuses: [],
      due: "any",
      search: "",
      rootsOnly: false,
      excludeQuick: false,
      scope: "any",
      teamIds: [],
      assignee: "any",
    },
    tags: [],
    untaggedOnly: false,
  };
}
