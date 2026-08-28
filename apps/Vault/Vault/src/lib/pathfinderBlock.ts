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

import { MAX_FORMULA_CHARS, type FormulaContext, type FormulaValue } from "./formula";
// The PURE half only — this module is on the schema path, so it must not
// reach vaultTaskFields.ts and through it a Supabase client. Asserted by
// lib/schemaPath.test.ts.
import { coerceField, normalizeFieldKey, FIELD_TYPES, type FieldType } from "./taskFields";
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
  creationDefaults,
  type PfTask,
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

  /**
   * Board only, and only on the `kanban_status` axis: the columns this board
   * shows. Empty means the built-in four.
   *
   * Per BLOCK rather than global, and that is a real choice. `kanban_status` is
   * free text on the task, so a status is not owned by anything — one note can
   * track a review pipeline and another a shipping one without either becoming
   * the definition. The cost is that a task whose status no board lists still
   * exists: it lands in the "Other" bucket, which is why that bucket is not a
   * drop target (dropping there would have to invent a value).
   */
  statuses: string[];

  /**
   * Computed columns. Table view only — a list row has nowhere to put one.
   *
   * The formula is stored, never a value: a column is a QUESTION about a task,
   * so it stays right when the task changes. Storing computed values would be a
   * cache with no invalidation, going stale the moment an estimate is edited.
   */
  formulas: FormulaColumn[];

  /**
   * Stored custom columns. Table view only.
   *
   * The DEFINITION lives here; the values live in `vault_task_fields`. So the
   * type is a lens the note applies rather than a constraint the database
   * enforces — changing it never destroys a value, and two notes may read the
   * same key differently. See the migration header.
   */
  fields: FieldColumn[];
}

export interface FieldColumn {
  /** Normalised; this IS the storage key, so case and spacing are collapsed. */
  key: string;
  label: string;
  type: FieldType;
}

export const MAX_FIELDS = 6;

export interface FormulaColumn {
  /** Stable across edits so a column keeps its width and position. */
  id: string;
  label: string;
  /** Source. Validated on parse; an invalid one is kept so it can be fixed
   *  rather than silently dropped along with the user's work. */
  expr: string;
  /** Footer aggregate over the visible rows, or none. */
  agg: FormulaAgg;
}

export const FORMULA_AGGS = ["none", "sum", "count", "percent", "avg"] as const;
export type FormulaAgg = (typeof FORMULA_AGGS)[number];

/** A block may hold a handful, not a spreadsheet. The spec is size-capped. */
export const MAX_FORMULAS = 6;

/**
 * The fields a formula may name, and what each means.
 *
 * Deliberately numeric or boolean. The language has no string literals, so a
 * string field could only ever be compared to another field — which is not
 * worth the parser surface. `priority` and `urgency` arrive as RANKS (1 low,
 * 2 medium, 3 high) because that is the only form an expression can use.
 */
export const FORMULA_FIELDS: Array<{ name: string; help: string }> = [
  { name: "estimate", help: "this task's own estimate, in minutes" },
  { name: "rollup", help: "estimate including subtasks (trigger-maintained)" },
  { name: "done", help: "1 when complete" },
  { name: "subtasks", help: "number of descendants" },
  { name: "subtasksDone", help: "how many of them are complete" },
  { name: "priority", help: "1 low, 2 medium, 3 high" },
  { name: "urgency", help: "1 low, 2 medium, 3 high" },
  { name: "overdue", help: "1 when the due date has passed" },
  { name: "hasDue", help: "1 when the task has a due date at all" },
];

export const FORMULA_FIELD_NAMES = FORMULA_FIELDS.map((f) => f.name);

/**
 * The built-in names as a stored key would be written.
 *
 * ⚠️ Not the same set: `subtasksDone` normalises to `subtasksdone`, so
 * comparing a normalised key against the raw names lets a column named
 * "subtasksDone" through — and it then sits in the field list one character
 * from the built-in, with no way to tell which a formula means. The key is
 * normalised, so the collision check must be too.
 */
export const RESERVED_FIELD_KEYS = new Set(FORMULA_FIELD_NAMES.map(normalizeFieldKey));

/** A board with thirty columns is not a board, and the spec is size-capped. */
export const MAX_STATUSES = 12;
const MAX_STATUS_CHARS = 24;

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
    statuses: [],
    formulas: [],
    fields: [],
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
    statuses: normalizeStatuses(obj.statuses),
    formulas: parseFormulas(obj.formulas),
    fields: parseFields(obj.fields),
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

/**
 * Clean a status list: trimmed, lower-cased, de-duplicated, bounded.
 *
 * Lower-cased because the KEY is matched against `pf_tasks.kanban_status` by
 * exact string equality, and a column labelled "Doing" that does not hold the
 * tasks whose status is "doing" is the worst kind of wrong — it looks like the
 * board is empty rather than like a mismatch. Every one of the 543 rows in the
 * database today is already lower-case, so this agrees with the data as well as
 * with itself. Display capitalisation is applied at render time.
 */
/**
 * Validate stored formula columns.
 *
 * An INVALID expression is kept rather than dropped. The column will show an
 * error instead of a value, which is recoverable; silently discarding it would
 * lose whatever the user was in the middle of writing, and they would have no
 * idea why the column vanished.
 */
/**
 * Validate stored custom-column definitions.
 *
 * A key colliding with a built-in formula field is DROPPED: `estimate` meaning
 * two different things depending on which column you look at is worse than the
 * column not existing. The editor refuses it up front too, so this is the
 * backstop for a hand-edited or pasted document.
 */
function parseFields(v: unknown): FieldColumn[] {
  if (!Array.isArray(v)) return [];
  const out: FieldColumn[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const key = typeof o.key === "string" ? normalizeFieldKey(o.key) : "";
    if (!key || seen.has(key) || RESERVED_FIELD_KEYS.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: typeof o.label === "string" ? o.label.slice(0, 40) : "",
      type: pick(o.type, FIELD_TYPES, "text"),
    });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

function parseFormulas(v: unknown): FormulaColumn[] {
  if (!Array.isArray(v)) return [];
  const out: FormulaColumn[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const o = raw as Record<string, unknown>;
    const id = typeof o.id === "string" && o.id ? o.id.slice(0, 32) : "";
    const expr = typeof o.expr === "string" ? o.expr.slice(0, MAX_FORMULA_CHARS) : "";
    if (!id || seen.has(id) || !expr.trim()) continue;
    seen.add(id);
    out.push({
      id,
      label: typeof o.label === "string" ? o.label.slice(0, 40) : "",
      expr,
      agg: pick(o.agg, FORMULA_AGGS, "none"),
    });
    if (out.length >= MAX_FORMULAS) break;
  }
  return out;
}

const RANK: Record<string, number> = { low: 1, medium: 2, high: 3 };

/**
 * One task as a set of numbers a formula can use.
 *
 * `today` is passed rather than read from the clock so the same row computes
 * the same way for every column, and so this stays testable without freezing
 * time. Dates compare as text — `pf_tasks.due_date` is TEXT and ISO-8601 sorts
 * lexicographically in date order.
 */
export function formulaContext(
  task: PfTask,
  stat: { total: number; done: number } | undefined,
  today: string,
  /**
   * The task's stored custom values, and the column definitions that give them
   * a type. This is the join between the two halves of custom columns: a
   * stored number column is a NAME A FORMULA CAN READ, which is the whole
   * reason `budget * 1.25` is possible at all.
   *
   * Only number and check columns are exposed — a text column has no numeric
   * meaning, and `null` for an absent value is what keeps a sum honest.
   */
  fields?: { bag: Record<string, string> | undefined; cols: readonly FieldColumn[] },
): FormulaContext {
  const due = typeof task.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(task.due_date)
    ? task.due_date
    : null;
  return {
    estimate: task.time_estimate ?? null,
    rollup: task.aggregate_estimate ?? null,
    done: task.done,
    subtasks: stat?.total ?? 0,
    subtasksDone: stat?.done ?? 0,
    priority: RANK[task.priority] ?? null,
    urgency: RANK[task.planning?.urgency ?? ""] ?? null,
    overdue: due !== null && !task.done && due < today,
    hasDue: due !== null,
    ...storedFieldValues(fields),
  };
}

/**
 * A task's stored fields as formula bindings.
 *
 * A key colliding with a built-in is dropped at parse time (see `parseFields`),
 * so spreading these after the built-ins cannot shadow `estimate`.
 */
function storedFieldValues(
  fields: { bag: Record<string, string> | undefined; cols: readonly FieldColumn[] } | undefined,
): Record<string, number | boolean | null> {
  if (!fields) return {};
  const out: Record<string, number | boolean | null> = {};
  for (const c of fields.cols) {
    if (c.type === "text") continue;
    const v = coerceField(fields.bag?.[c.key], c.type);
    // ⚠️ An absent value is null, NOT 0. `sum(budget)` over ten tasks where two
    // have a budget must be the sum of two, and `avg` must divide by two.
    out[c.key] = typeof v === "number" || typeof v === "boolean" ? v : null;
  }
  return out;
}

/** Every name a formula in this block may read: built-ins plus numeric stored
 *  columns. Text columns are deliberately absent — see storedFieldValues. */
export function formulaFieldNames(fields: readonly FieldColumn[]): string[] {
  return [...FORMULA_FIELD_NAMES, ...fields.filter((f) => f.type !== "text").map((f) => f.key)];
}

/**
 * A column's footer value over the rows on screen.
 *
 * Nulls are SKIPPED, not counted as zero — a task with no estimate has no
 * estimate, and averaging it in as 0 would quietly drag every mean down. The
 * count of contributing rows is returned alongside so the UI can say "4 of 12"
 * rather than implying the whole column was measured.
 */
export function aggregate(agg: FormulaAgg, values: FormulaValue[]): { value: number | null; n: number } {
  const nums = values
    .map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v))
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));

  switch (agg) {
    case "sum":
      return { value: nums.reduce((a, b) => a + b, 0), n: nums.length };
    case "avg":
      return nums.length ? { value: nums.reduce((a, b) => a + b, 0) / nums.length, n: nums.length } : { value: null, n: 0 };
    // "count" counts rows where the formula is TRUTHY, which is what makes
    // `done` or `overdue` useful as a column — not how many rows exist, which
    // the block already shows.
    case "count":
      return { value: nums.filter((v) => v !== 0).length, n: nums.length };
    case "percent":
      return nums.length
        ? { value: (100 * nums.filter((v) => v !== 0).length) / nums.length, n: nums.length }
        : { value: null, n: 0 };
    default:
      return { value: null, n: 0 };
  }
}

export function normalizeStatuses(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== "string") continue;
    const k = raw.trim().toLowerCase().slice(0, MAX_STATUS_CHARS);
    if (!k || out.includes(k)) continue;
    out.push(k);
    if (out.length >= MAX_STATUSES) break;
  }
  return out;
}

/** The statuses a board actually shows: the block's own, or the built-in four. */
/**
 * What a task created from inside a block inherits.
 *
 * The filter doubles as the creation context: a block showing plan "Thesis"
 * creates tasks in "Thesis", and a block showing today's work dates them today.
 * Only unambiguous single-value constraints carry over — see `creationDefaults`.
 */
export function creationPayload(spec: PfBlockSpec, today: string): Record<string, unknown> {
  const raw = creationDefaults(spec.filter) as Record<string, unknown> & { __dueToday?: boolean };
  const { __dueToday, ...rest } = raw;
  return __dueToday ? { ...rest, due_date: today } : rest;
}

/**
 * What a task dragged INTO a block inherits. The creation payload minus one
 * field.
 *
 * ⚠️ `category` is excluded, and that is the whole difference. It is the ISA
 * discriminator: re-typing a `task` to a sparse kind DROPS its planning row —
 * urgency, stage, completion mode, notes — and the demotion is lossy by
 * construction. Creating a chore in a chore block is a choice; dragging a
 * planned task into one and silently deleting its plan is not.
 *
 * Everything else carries: "inherits the new requirements while forgoing the
 * old ones" needs no clearing step, because each field is single-valued —
 * setting plan_id to the target's plan IS forgoing the source's.
 */
export function movePayload(spec: PfBlockSpec, today: string): Record<string, unknown> {
  const { category, ...rest } = creationPayload(spec, today);
  void category;
  return rest;
}

export function boardStatuses(spec: PfBlockSpec): string[] {
  return spec.statuses.length ? spec.statuses : [...KANBAN_STATUSES];
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
  /** How many computed columns follow the standard ones. They share the same
   *  total: leaving them out would let the table claim more than 100%. */
  formulaCount = 0,
  /** Stored custom columns. They sit between the standard columns and the
   *  computed ones and, like them, share the same 100%. */
  fieldCount = 0,
): { data: number[]; fields: number[]; formulas: number[]; actions: number } {
  const ws = cols.map((c) => columnWeight(weights, c));
  const dws = Array.from({ length: fieldCount }, () => 1);
  const fws = Array.from({ length: formulaCount }, () => 1);
  const total = [...ws, ...dws, ...fws].reduce((a, b) => a + b, 0) + ACTIONS_WEIGHT;
  if (total <= 0) {
    return { data: cols.map(() => 0), fields: dws.map(() => 0), formulas: fws.map(() => 0), actions: 100 };
  }
  const pct = (w: number) => (w / total) * 100;
  return {
    data: ws.map(pct),
    fields: dws.map(pct),
    formulas: fws.map(pct),
    actions: pct(ACTIONS_WEIGHT),
  };
}

/** How a computed value reads in a cell. */
export function fmtFormulaValue(v: FormulaValue): string {
  if (v === null) return "—";
  if (typeof v === "boolean") return v ? "✓" : "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "—";
    // Integers stay integers; anything else gets two places. A column of
    // "2.0000000000000004" is arithmetic showing through the UI.
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  return v;
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
  /** Overrides the built-in four on the `kanban_status` axis. */
  statuses: string[] = [],
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
    case "kanban_status": {
      const list = statuses.length ? statuses : [...KANBAN_STATUSES];
      return list.map((k) => ({ key: k, label: k.charAt(0).toUpperCase() + k.slice(1) }));
    }
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
