// The interactive board: state, keys, and the refetch after every write.
//
// Three rules it keeps:
//
//   * A WRITE NEVER HAPPENS ON A BARE KEYPRESS THAT COULD BE A TYPO. `d`, `s`,
//     `x` and `e` change one field of one visible task and say so; `D` goes
//     through a y/n confirm, because a delete takes the subtree with it.
//   * EVERY WRITE REFETCHES. The board holds no optimistic copy — the row you
//     see after a write is the row the database returned, so a rule applied
//     server-side (a trigger-maintained roll-up, a stage the gate refused)
//     cannot look as though it did not happen.
//   * ⚠️ EVERY PIECE OF STATE A KEYSTROKE READS IS MIRRORED IN A REF. Keystrokes
//     arrive faster than React re-renders — a paste, a fast typist, a test
//     writing a word into stdin — and `useInput`'s callback closes over the
//     state of the render it was created in. Reading `mode.value` from that
//     closure loses every character but the last, and reading the selection
//     from it lets `d` act on the row you were on two keys ago. `useMirror`
//     updates the ref synchronously in the same call that schedules the render,
//     so the handler always reads what the user has actually typed.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import type { PathfinderApi, PfTask, TaskStage } from "@nexus/core/pathfinder";
import { KANBAN_STATUSES, STAGES } from "@nexus/core/pathfinder";
import { clampSelection, rowsFor, PANES, type BoardModel, type BoardRow, type PaneId } from "./data.ts";
import { parseDueInput, runAction, shortTitle, type BoardAction } from "./actions.ts";
import { Board, type MenuIntent, type Mode, type PromptIntent } from "./ui.tsx";

export interface BoardAppProps {
  who: { profileName: string; email: string; userId: string };
  api: PathfinderApi;
  load: () => Promise<BoardModel>;
  /** Rendered instead of the first load. Used by the tests; production passes none. */
  initialModel?: BoardModel;
  columns?: number;
  rowLines?: number;
}

/** Lines of chrome above and below the rows: header, tabs, rules, counts, status, hint. */
const CHROME_LINES = 9;
const DEFAULT_COLUMNS = 100;
const DEFAULT_ROWS = 28;

/** A terminal dimension, or the fallback when the value is absent or nonsense. */
function usable(value: number | undefined, min: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : fallback;
}

interface Target {
  task?: PfTask;
  planId: number | null;
  title?: string;
}

type Setter<T> = (next: T | ((prev: T) => T)) => void;

/** State whose ref is updated in the same synchronous call. See the header. */
function useMirror<T>(initial: T): [T, Setter<T>, React.MutableRefObject<T>] {
  const [value, setValue] = useState(initial);
  const ref = useRef(initial);
  const set = useCallback<Setter<T>>((next) => {
    const v = typeof next === "function" ? (next as (prev: T) => T)(ref.current) : next;
    ref.current = v;
    setValue(v);
  }, []);
  return [value, set, ref];
}

export function BoardApp(props: BoardAppProps): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const [model, setModel, modelRef] = useMirror<BoardModel | null>(props.initialModel ?? null);
  const [loading, setLoading] = useState(!props.initialModel);
  const [pane, setPane, paneRef] = useMirror<PaneId>("current");
  const [selection, setSelection, selectionRef] = useMirror<Record<PaneId, number>>({
    roadmap: 0,
    current: 0,
    upcoming: 0,
    progress: 0,
  });
  const [expanded, setExpanded, expandedRef] = useMirror<ReadonlySet<string>>(new Set<string>());
  const [filter, setFilter, filterRef] = useMirror("");
  const [status, setStatus] = useState("");
  const [statusKind, setStatusKind] = useState<"info" | "error">("info");
  const [mode, setMode, modeRef] = useMirror<Mode>({ kind: "browse" });
  const targetRef = useRef<Target | null>(null);
  const busy = useRef(false);

  // ⚠️ `??` is the wrong operator for a terminal size. A pty that has never been
  // sized reports `columns: 0`, and `0 ?? 100` is 0 — which renders every cell
  // one character wide, one character per line. Measured under `expect`. Sizes
  // are therefore taken only when they are plausible.
  const columns = props.columns ?? usable(stdout?.columns, 80, DEFAULT_COLUMNS);
  const rowLines = props.rowLines ?? Math.max(4, usable(stdout?.rows, 10, DEFAULT_ROWS) - CHROME_LINES);

  const say = useCallback((text: string, kind: "info" | "error" = "info") => {
    setStatus(text);
    setStatusKind(kind);
  }, []);

  const refresh = useCallback(
    async (note?: string) => {
      setLoading(true);
      try {
        setModel(await props.load());
        if (note !== undefined) say(note);
      } catch (e) {
        say(oneLine(e), "error");
      } finally {
        setLoading(false);
      }
    },
    [props, say, setModel],
  );

  useEffect(() => {
    if (!props.initialModel) void refresh();
    // Deliberately once: the board refetches on `r` and after a write, never on a timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // What the render draws. The key handler recomputes the same thing from the
  // refs, so a burst of keystrokes cannot act on a stale view.
  const rows: BoardRow[] = useMemo(
    () => (model ? rowsFor(pane, model, expanded, filter) : []),
    [model, pane, expanded, filter],
  );
  const selected = clampSelection(rows.length, selection[pane]);

  const liveRows = useCallback((): BoardRow[] => {
    const m = modelRef.current;
    return m ? rowsFor(paneRef.current, m, expandedRef.current, filterRef.current) : [];
  }, [expandedRef, filterRef, modelRef, paneRef]);

  const liveRow = useCallback((): BoardRow | undefined => {
    const list = liveRows();
    const index = clampSelection(list.length, selectionRef.current[paneRef.current]);
    return index >= 0 ? list[index] : undefined;
  }, [liveRows, paneRef, selectionRef]);

  const move = useCallback(
    (delta: number) => {
      const count = liveRows().length;
      const p = paneRef.current;
      setSelection((s) => ({ ...s, [p]: clampSelection(count, clampSelection(count, s[p]) + delta) }));
    },
    [liveRows, paneRef, setSelection],
  );

  const write = useCallback(
    async (action: BoardAction) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      try {
        const note = await runAction(props.api, action);
        // The refetch is what makes the board honest after a write.
        setModel(await props.load());
        say(note);
      } catch (e) {
        // Verbatim: a SchedulingGateError's message IS the rule being enforced.
        say(oneLine(e), "error");
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [props, say, setModel],
  );

  const needTask = useCallback((): PfTask | null => {
    const row = liveRow();
    if (row?.task) return row.task;
    say("select a task row first — goals, plans and headings are not writable here", "error");
    return null;
  }, [liveRow, say]);

  const submitPrompt = useCallback(
    (intent: PromptIntent, value: string): void => {
      const target = targetRef.current;
      if (intent === "filter") {
        const next = value.trim();
        targetRef.current = null;
        setFilter(next);
        setSelection((s) => ({ ...s, [paneRef.current]: 0 }));
        say(next ? `filter: ${next}` : "filter cleared");
        return;
      }
      if (intent === "add") {
        const title = value.trim();
        const planId = target?.planId ?? null;
        targetRef.current = null;
        if (!title) {
          say("add cancelled: an empty title is not a task", "error");
          return;
        }
        void write({ kind: "add", title, planId });
        return;
      }
      const task = target?.task;
      if (!task) return;
      if (intent === "edit-title") {
        // Two fields, two prompts. An empty title keeps the old one — a task
        // with no name is not something to write.
        targetRef.current = { ...target, title: value.trim() || task.title };
        setMode({
          kind: "prompt",
          label: `due ${task.id} (YYYY-MM-DD, empty clears): `,
          value: task.due_date ?? "",
          intent: "edit-due",
        });
        return;
      }
      // edit-due
      const title = target?.title;
      targetRef.current = null;
      const parsed = parseDueInput(value);
      if ("error" in parsed) {
        say(parsed.error, "error");
        return;
      }
      void write({ kind: "edit", task, title, due: parsed.due });
    },
    [paneRef, say, setFilter, setMode, setSelection, write],
  );

  const submitMenu = useCallback(
    (intent: MenuIntent, choice: string): void => {
      const task = targetRef.current?.task;
      targetRef.current = null;
      if (!task || !choice) return;
      if (intent === "stage") void write({ kind: "stage", task, stage: choice as TaskStage });
      else void write({ kind: "kanban", task, status: choice });
    },
    [write],
  );

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      exit();
      return;
    }
    const current = modeRef.current;

    // ── prompt ──────────────────────────────────────────────────────────────
    if (current.kind === "prompt") {
      if (key.escape) {
        setMode({ kind: "browse" });
        targetRef.current = null;
        say("cancelled");
        return;
      }
      if (key.return) {
        setMode({ kind: "browse" });
        submitPrompt(current.intent, current.value);
        return;
      }
      if (key.backspace || key.delete) {
        setMode({ ...current, value: current.value.slice(0, -1) });
        return;
      }
      if (input && !key.ctrl && !key.meta && !key.tab) setMode({ ...current, value: current.value + input });
      return;
    }

    // ── menu ────────────────────────────────────────────────────────────────
    if (current.kind === "menu") {
      if (key.escape) {
        setMode({ kind: "browse" });
        targetRef.current = null;
        say("cancelled");
        return;
      }
      if (key.return) {
        setMode({ kind: "browse" });
        submitMenu(current.intent, current.options[current.index]);
        return;
      }
      if (key.leftArrow || key.upArrow || input === "k" || input === "h") {
        setMode({ ...current, index: Math.max(0, current.index - 1) });
        return;
      }
      if (key.rightArrow || key.downArrow || input === "j" || input === "l") {
        setMode({ ...current, index: Math.min(current.options.length - 1, current.index + 1) });
        return;
      }
      const picked = Number(input);
      if (input !== "" && Number.isInteger(picked) && picked >= 1 && picked <= current.options.length) {
        setMode({ kind: "browse" });
        submitMenu(current.intent, current.options[picked - 1]);
      }
      return;
    }

    // ── confirm ─────────────────────────────────────────────────────────────
    if (current.kind === "confirm") {
      if (input === "y") {
        const task = targetRef.current?.task;
        setMode({ kind: "browse" });
        targetRef.current = null;
        if (task) void write({ kind: "delete", task });
        return;
      }
      if (input === "n" || key.escape) {
        setMode({ kind: "browse" });
        targetRef.current = null;
        say("delete cancelled");
      }
      return;
    }

    // ── browse ──────────────────────────────────────────────────────────────
    if (input === "q") {
      exit();
      return;
    }
    if (key.tab) {
      setPane(PANES[(PANES.indexOf(paneRef.current) + 1) % PANES.length]);
      return;
    }
    const paneNumber = Number(input);
    if (input !== "" && Number.isInteger(paneNumber) && paneNumber >= 1 && paneNumber <= PANES.length) {
      setPane(PANES[paneNumber - 1]);
      return;
    }
    if (input === "j" || key.downArrow) return move(1);
    if (input === "k" || key.upArrow) return move(-1);
    if (key.pageDown) return move(rowLines);
    if (key.pageUp) return move(-rowLines);

    if (key.return) {
      const row = liveRow();
      if (!row?.expandable) return;
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(row.key)) next.delete(row.key);
        else next.add(row.key);
        return next;
      });
      return;
    }

    if (key.escape) {
      if (filterRef.current) {
        setFilter("");
        say("filter cleared");
      }
      return;
    }

    if (input === "r") {
      void refresh("refreshed");
      return;
    }
    if (input === "/") {
      targetRef.current = null;
      setMode({ kind: "prompt", label: "filter: ", value: filterRef.current, intent: "filter" });
      return;
    }
    if (input === "a") {
      const planId = liveRow()?.planId ?? null;
      targetRef.current = { planId };
      setMode({
        kind: "prompt",
        label: `add task${planId != null ? ` (plan ${planId})` : ""}: `,
        value: "",
        intent: "add",
      });
      return;
    }
    if (input === "d") {
      const task = needTask();
      if (task) void write({ kind: "done", task, done: !task.done });
      return;
    }
    if (input === "s") {
      const task = needTask();
      if (!task) return;
      targetRef.current = { task, planId: task.plan_id };
      setMode({
        kind: "menu",
        label: `stage ${task.id}:`,
        options: [...STAGES],
        index: Math.max(0, STAGES.indexOf(task.planning?.stage ?? "refine")),
        intent: "stage",
      });
      return;
    }
    if (input === "x") {
      const task = needTask();
      if (!task) return;
      targetRef.current = { task, planId: task.plan_id };
      // `kanban_status` is free text on the task — PathFinder's four are a
      // default, not a domain — so a status outside the list is legitimate and
      // simply starts the menu at the first option rather than erroring.
      const options: string[] = [...KANBAN_STATUSES];
      setMode({
        kind: "menu",
        label: `status ${task.id}:`,
        options,
        index: Math.max(0, options.indexOf(task.kanban_status)),
        intent: "kanban",
      });
      return;
    }
    if (input === "e") {
      const task = needTask();
      if (!task) return;
      targetRef.current = { task, planId: task.plan_id };
      setMode({ kind: "prompt", label: `title ${task.id}: `, value: task.title, intent: "edit-title" });
      return;
    }
    if (input === "D") {
      const task = needTask();
      if (!task) return;
      targetRef.current = { task, planId: task.plan_id };
      setMode({ kind: "confirm", label: `delete ${task.id} ${shortTitle(task.title)} and its subtree?` });
    }
  });

  if (!model && loading) {
    return (
      <Box>
        <Text>{`[${props.who.profileName} <${props.who.email}>] nexus board · loading…`}</Text>
      </Box>
    );
  }

  return (
    <Board
      who={props.who}
      model={model}
      pane={pane}
      rows={rows}
      selected={selected}
      status={status}
      statusKind={statusKind}
      filter={filter}
      mode={mode}
      columns={columns}
      rowLines={rowLines}
      loading={loading}
    />
  );
}

function oneLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/\s*\n\s*/g, " ").trim();
}
