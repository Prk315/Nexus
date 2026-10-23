// `nexus pf ...` — PathFinder reads and writes.
//
// Every write goes through `createPathfinderApi` from @nexus/core/pathfinder,
// never a raw table update: `setStage` enforces the scheduling gate (no
// `active` without calendar minutes) and `patchTask` splits a flat patch across
// the pf_tasks / pf_task_planning ISA hierarchy. Neither rule exists in the
// database, so bypassing the API silently breaks them.
//
// The commands take their API through `PfDeps` so the unit tests can hand in a
// mocked PathfinderApi and assert exactly which method is called with what.

import { Command } from "commander";
import type { PathfinderApi, PfTask, TaskStage } from "@nexus/core/pathfinder";
import { STAGES, KANBAN_STATUSES } from "@nexus/core/pathfinder";
import { UserError } from "../errors.ts";
import { header, printJson, table } from "../output.ts";
import { renderTaskTree, taskTree, TREE_DEPTH } from "./tree.ts";

export interface Who {
  profileName: string;
  email: string;
  userId: string;
}

export interface PfSession {
  api: PathfinderApi;
  who: Who;
  /** `select pf_agent_brief(<uid>)` for the session's user. */
  brief(): Promise<unknown>;
}

export interface PfDeps {
  open(profileName: string | undefined): Promise<PfSession>;
}

type Opts = { profile?: string; json?: boolean };

const write = (s: string) => process.stdout.write(s + "\n");
const warn = (s: string) => process.stderr.write(s + "\n");

function parseId(raw: string, what = "id"): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new UserError(`invalid ${what} "${raw}": expected a positive integer`);
  return n;
}

function parseDate(raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new UserError(`invalid date "${raw}": expected YYYY-MM-DD (pf_tasks.due_date is text and the app compares it as ISO)`);
  }
  return raw;
}

/** Columns `task patch --set` may touch, and how to type their values. */
const PATCHABLE: Record<string, "string" | "number" | "boolean" | "priority" | "urgency" | "date"> = {
  title: "string", plan_id: "number", parent_id: "number", goal_id: "number", priority: "priority",
  due_date: "date", time_estimate: "number", kanban_status: "string", category: "string", sort_order: "number",
  team_id: "string", assigned_to: "string",
  urgency: "urgency", completion_mode: "string", target_count: "number", notes: "string",
};

export function parseSet(pairs: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new UserError(`--set expects key=value, got "${pair}"`);
    const key = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1);
    if (key === "stage") throw new UserError("use `nexus pf task stage <id> <stage>` — the scheduling gate lives there");
    if (key === "done") throw new UserError("use `nexus pf task done <id>` / `undone <id>` — they keep stage and done in step");
    if (key === "task_type" || key === "aggregate_estimate") throw new UserError(`${key} is database-maintained and cannot be set`);
    const kind = PATCHABLE[key];
    if (!kind) throw new UserError(`unknown field "${key}"; settable: ${Object.keys(PATCHABLE).join(", ")}`);
    if (raw === "null" || raw === "") { patch[key] = null; continue; }
    switch (kind) {
      case "number": {
        const n = Number(raw);
        if (!Number.isFinite(n)) throw new UserError(`${key} expects a number, got "${raw}"`);
        patch[key] = n;
        break;
      }
      case "boolean":
        patch[key] = raw === "true";
        break;
      case "priority":
      case "urgency":
        if (!["high", "medium", "low"].includes(raw)) throw new UserError(`${key} must be high, medium or low`);
        patch[key] = raw;
        break;
      case "date":
        patch[key] = parseDate(raw);
        break;
      default:
        patch[key] = raw;
    }
  }
  if (Object.keys(patch).length === 0) throw new UserError("nothing to set: pass --set key=value");
  return patch;
}

function taskRow(t: PfTask): Record<string, unknown> {
  return {
    id: t.id, title: t.title, type: t.task_type, done: t.done ? "x" : "",
    stage: t.planning?.stage ?? "", urg: t.planning?.urgency ?? "", pri: t.priority,
    due: t.due_date ?? "", kanban: t.kanban_status, est: t.aggregate_estimate || "",
    parent: t.parent_id ?? "", plan: t.plan_title ?? "", goal: t.goal_title ?? "",
  };
}

const TASK_COLUMNS = [
  { key: "id", label: "id", align: "right" as const },
  { key: "done", label: "✓" },
  { key: "title", label: "title", max: 60 },
  { key: "type", label: "type" },
  { key: "stage", label: "stage" },
  { key: "urg", label: "urg" },
  { key: "pri", label: "pri" },
  { key: "due", label: "due" },
  { key: "kanban", label: "kanban" },
  { key: "est", label: "min", align: "right" as const },
  { key: "parent", label: "parent", align: "right" as const },
  { key: "plan", label: "plan", max: 24 },
];

function printTask(t: PfTask, who: Who, json: boolean, title: string): void {
  if (json) return printJson({ profile: who.profileName, task: t });
  write(header(who.profileName, who.email, title));
  write(table(TASK_COLUMNS, [taskRow(t)]));
}

export function registerPfCommands(root: Command, deps: PfDeps): void {
  const pf = root.command("pf").description("PathFinder: goals, plans, tasks (writes go through createPathfinderApi)");

  pf.command("brief")
    .description("what am I working on — the pf_agent_brief RPC for this profile's user")
    .action(async (_o, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      const s = await deps.open(profile);
      const brief = (await s.brief()) as any;
      if (json) return printJson(brief);
      write(header(s.who.profileName, s.who.email, `brief for ${brief?.user_id ?? s.who.userId} at ${brief?.generated_at ?? ""}`));
      const c = brief?.counts ?? {};
      write(`open ${c.open_tasks ?? "?"}  roots ${c.open_root_tasks ?? "?"}  active ${c.active ?? "?"}  overdue ${c.overdue ?? "?"}`);
      const section = (name: string, rows: any[] | undefined, cols: Parameters<typeof table>[0]) => {
        write(`\n${name} (${rows?.length ?? 0})`);
        if (rows?.length) write(table(cols, rows));
      };
      section("goals", brief?.goals, [
        { key: "id", label: "id", align: "right" }, { key: "title", label: "title", max: 50 }, { key: "status", label: "status" },
        { key: "priority", label: "pri" }, { key: "deadline", label: "deadline" }, { key: "done", label: "done", align: "right" }, { key: "tasks", label: "tasks", align: "right" },
      ]);
      section("active", brief?.active, [
        { key: "id", label: "id", align: "right" }, { key: "title", label: "title", max: 50 }, { key: "urgency", label: "urg" }, { key: "priority", label: "pri" },
        { key: "due", label: "due" }, { key: "rollup_min", label: "min", align: "right" }, { key: "kanban", label: "kanban" }, { key: "plan", label: "plan", max: 24 }, { key: "goal", label: "goal", max: 24 },
      ]);
      section("due_soon", brief?.due_soon, [
        { key: "id", label: "id", align: "right" }, { key: "title", label: "title", max: 50 }, { key: "due", label: "due" }, { key: "stage", label: "stage" }, { key: "urgency", label: "urg" }, { key: "priority", label: "pri" },
      ]);
      section("plans", brief?.plans, [
        { key: "id", label: "id", align: "right" }, { key: "title", label: "title", max: 50 }, { key: "status", label: "status" }, { key: "deadline", label: "deadline" }, { key: "open_tasks", label: "open", align: "right" },
      ]);
      section("systems (raw — apply lib/systems.ts for due-ness)", brief?.systems, [
        { key: "id", label: "id", align: "right" }, { key: "title", label: "title", max: 40 }, { key: "frequency", label: "freq" }, { key: "interval_days", label: "every" }, { key: "days_of_week", label: "days" }, { key: "last_done", label: "last_done" }, { key: "streak", label: "streak", align: "right" },
      ]);
    });

  pf.command("tasks")
    .description("list tasks (open by default) or print one task's subtree to depth 4")
    .option("--active", "only stage = active")
    .option("--due", "only tasks with a due date, soonest first")
    .option("--plan <id>", "only tasks in this plan")
    .option("--roots", "only root tasks (no parent)")
    .option("--all", "include done tasks")
    .option("--tree <taskId>", `print the subtree of one task to depth ${TREE_DEPTH} with leaf counts`)
    .action(async (o: { active?: boolean; due?: boolean; plan?: string; roots?: boolean; all?: boolean; tree?: string }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      const s = await deps.open(profile);
      const { tasks, capped } = await s.api.loadTasks();
      if (capped) warn(`warning: task read hit the ${tasks.length} row cap; the list may be partial`);

      if (o.tree) {
        const rootId = parseId(o.tree, "task id");
        const r = taskTree(tasks, rootId);
        if (!r) throw new UserError(`task ${rootId} not found`);
        if (json) return printJson({ profile: s.who.profileName, capped, ...r.summary, tree: r.tree });
        write(header(s.who.profileName, s.who.email, `task ${rootId} subtree (depth ${TREE_DEPTH})`));
        write(renderTaskTree(r.tree));
        const sm = r.summary;
        write(`\n${sm.leaves} leaves (${sm.open_leaves} open, ${sm.done_leaves} done), ${sm.containers} containers, ${sm.nodes} nodes` +
          (sm.truncated_at.length ? `; cut at depth ${TREE_DEPTH} under ${sm.truncated_at.join(", ")} — counts are a floor` : ""));
        return;
      }

      let list = tasks;
      if (!o.all) list = list.filter((t) => !t.done);
      if (o.active) list = list.filter((t) => t.planning?.stage === "active");
      if (o.plan) { const p = parseId(o.plan, "plan id"); list = list.filter((t) => t.plan_id === p); }
      if (o.roots) list = list.filter((t) => t.parent_id == null);
      if (o.due) list = list.filter((t) => !!t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!) || a.id - b.id);

      if (json) return printJson({ profile: s.who.profileName, capped, count: list.length, tasks: list });
      const filters = [o.all ? "all" : "open", o.active && "active", o.due && "due", o.plan && `plan ${o.plan}`, o.roots && "roots"].filter(Boolean).join(", ");
      write(header(s.who.profileName, s.who.email, `${list.length} tasks (${filters})`));
      write(table(TASK_COLUMNS, list.map(taskRow)));
    });

  pf.command("goals").description("list goals").action(async (_o, cmd: Command) => {
    const { profile, json } = cmd.optsWithGlobals<Opts>();
    const s = await deps.open(profile);
    const goals = await s.api.loadGoals();
    if (json) return printJson({ profile: s.who.profileName, count: goals.length, goals });
    write(header(s.who.profileName, s.who.email, `${goals.length} goals`));
    write(table([{ key: "id", label: "id", align: "right" }, { key: "title", label: "title", max: 70 }, { key: "status", label: "status" }], goals));
  });

  pf.command("plans").description("list plans").action(async (_o, cmd: Command) => {
    const { profile, json } = cmd.optsWithGlobals<Opts>();
    const s = await deps.open(profile);
    const plans = await s.api.loadPlans();
    if (json) return printJson({ profile: s.who.profileName, count: plans.length, plans });
    write(header(s.who.profileName, s.who.email, `${plans.length} plans`));
    write(table([
      { key: "id", label: "id", align: "right" }, { key: "title", label: "title", max: 60 }, { key: "status", label: "status" },
      { key: "deadline", label: "deadline" }, { key: "goal_id", label: "goal", align: "right" }, { key: "team_id", label: "team" },
    ], plans));
  });

  // ── writes ────────────────────────────────────────────────────────────────

  const task = pf.command("task").description("create and change tasks");

  task.command("add <title>")
    .description("create a task")
    .option("--parent <id>", "parent task id (makes this a step of that task)")
    .option("--plan <id>", "plan id")
    .option("--goal <id>", "goal id")
    .option("--due <date>", "due date, YYYY-MM-DD")
    .option("--priority <p>", "high | medium | low")
    .option("--urgency <u>", "high | medium | low")
    .option("--estimate <minutes>", "time estimate in minutes")
    .option("--category <c>", "reminder | chore | shopping (default: a full task)")
    .action(async (title: string, o: Record<string, string | undefined>, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      if (!title.trim()) throw new UserError("title must not be empty");
      const input: Record<string, unknown> = { title: title.trim() };
      if (o.parent) input.parent_id = parseId(o.parent, "parent id");
      if (o.plan) input.plan_id = parseId(o.plan, "plan id");
      if (o.goal) input.goal_id = parseId(o.goal, "goal id");
      if (o.due) input.due_date = parseDate(o.due);
      if (o.priority) input.priority = parseSet([`priority=${o.priority}`]).priority;
      if (o.urgency) input.urgency = parseSet([`urgency=${o.urgency}`]).urgency;
      if (o.estimate) input.time_estimate = parseSet([`time_estimate=${o.estimate}`]).time_estimate;
      if (o.category) {
        if (!["reminder", "chore", "shopping"].includes(o.category)) throw new UserError("category must be reminder, chore or shopping");
        input.category = o.category;
      }
      const s = await deps.open(profile);
      const created = await s.api.createTask(input as any);
      printTask(created, s.who, !!json, `created task ${created.id}`);
    });

  task.command("done <id>").description("mark a task done (stage follows)").action(async (id: string, _o, cmd: Command) => {
    const { profile, json } = cmd.optsWithGlobals<Opts>();
    const s = await deps.open(profile);
    const t = await s.api.toggleTask(parseId(id), true);
    printTask(t, s.who, !!json, `task ${t.id} done`);
  });

  task.command("undone <id>").description("re-open a done task").action(async (id: string, _o, cmd: Command) => {
    const { profile, json } = cmd.optsWithGlobals<Opts>();
    const s = await deps.open(profile);
    const t = await s.api.toggleTask(parseId(id), false);
    printTask(t, s.who, !!json, `task ${t.id} re-opened`);
  });

  task.command("stage <id> <stage>")
    .description(`move a task through its lifecycle (${STAGES.join(" | ")}); 'active' needs scheduled calendar time`)
    .action(async (id: string, stage: string, _o, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      if (!STAGES.includes(stage as TaskStage)) throw new UserError(`stage must be one of ${STAGES.join(", ")}`);
      const s = await deps.open(profile);
      // A SchedulingGateError surfaces verbatim: its message is the rule.
      const t = await s.api.setStage(parseId(id), stage as TaskStage);
      printTask(t, s.who, !!json, `task ${t.id} stage → ${t.planning?.stage ?? stage}`);
    });

  task.command("status <id> <kanbanStatus>")
    .description(`set the kanban column (PathFinder's defaults: ${KANBAN_STATUSES.join(" | ")}; free text)`)
    .action(async (id: string, status: string, _o, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      if (!status.trim()) throw new UserError("status must not be empty");
      const s = await deps.open(profile);
      const t = await s.api.setKanbanStatus(parseId(id), status.trim());
      printTask(t, s.who, !!json, `task ${t.id} status → ${t.kanban_status}`);
    });

  task.command("patch <id>")
    .description("set fields: --set key=value (repeatable). Not stage or done — those have their own commands")
    .requiredOption("--set <kv...>", "key=value pairs; `null` clears a field")
    .action(async (id: string, o: { set: string[] }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      const patch = parseSet(o.set);
      const s = await deps.open(profile);
      const t = await s.api.patchTask(parseId(id), patch);
      printTask(t, s.who, !!json, `task ${t.id} patched (${Object.keys(patch).join(", ")})`);
    });

  task.command("rm <id>")
    .description("delete a task and its subtree (future calendar blocks go too). Requires --yes")
    .option("--yes", "confirm the deletion")
    .action(async (id: string, o: { yes?: boolean }, cmd: Command) => {
      const { profile, json } = cmd.optsWithGlobals<Opts>();
      const taskId = parseId(id);
      if (!o.yes) throw new UserError(`refusing to delete task ${taskId} without --yes`);
      const s = await deps.open(profile);
      const before = await s.api.getTask(taskId);
      await s.api.deleteTask(taskId);
      if (json) return printJson({ profile: s.who.profileName, deleted: taskId, title: before.title });
      write(header(s.who.profileName, s.who.email, `deleted task ${taskId} "${before.title}"`));
    });
}
