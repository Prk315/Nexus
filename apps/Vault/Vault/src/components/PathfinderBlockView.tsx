// The shell every PathFinder block wears: title, view switcher, filter bar,
// footer, and the three views it can render.
//
// Two rules shape this component more than anything else:
//
//  1. **Data never touches the document.** A refetch, a checkbox, a card drag —
//     none of them dispatch a ProseMirror transaction. Only a CONFIG change
//     (view, filter, sort, columns, title) calls `updateAttributes`. Getting
//     this wrong would mean every poll wakes the note's 400 ms autosave and
//     rewrites `vault_content` with content that did not change, which is the
//     shape of the 2026-08-15 incident and of the BubbleMenu 130 Hz loop.
//
//  2. **An empty list must never be able to mean anything but "nothing
//     matched."** Signed out, still loading, and failed-to-load are each their
//     own state with their own words. `pf_tasks` is `auth.uid()`-scoped, so a
//     session-less read returns an empty set rather than an error — rendering
//     that as "All done ✓" is the same lie as an "Inbox zero" panel that has
//     never successfully run.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  activeFilterCount,
  creationDefaults,
  isUnfiltered,
  isoDay,
  runQuery,
  SchedulingGateError,
  type PfTask,
} from "@nexus/core/pathfinder";
import {
  deriveLabel,
  parseSpec,
  serializeSpec,
  PF_VIEWS,
  PF_VIEW_ICONS,
  PF_VIEW_LABELS,
  type PfBlockSpec,
  type PfBlockView,
} from "../lib/pathfinderBlock";
import {
  getSnapshot,
  pathfinderApi,
  patchCachedTask,
  refresh,
  removeTask,
  subscribe,
  upsertTask,
} from "../lib/pathfinderStore";
import { PathfinderFilterBar } from "./PathfinderFilterBar";
import { PfBoardView, PfListView, PfTableView } from "./PathfinderViews";
import { useConfirm } from "./ConfirmDialog";

/** Subscribes to the shared snapshot and kicks off a load on first mount. */
function usePathfinderData() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    void refresh(false);
  }, []);
  return snap;
}

export interface TaskActions {
  toggle: (task: PfTask) => void;
  patch: (task: PfTask, patch: Record<string, unknown>) => void;
  setStage: (task: PfTask, stage: string) => void;
  remove: (task: PfTask) => void;
  busy: Set<number>;
}

export function PathfinderBlockView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  const view = (node.attrs.view ?? "list") as PfBlockView;
  const title = (node.attrs.title ?? "") as string;
  const spec = useMemo(() => parseSpec(node.attrs.spec, view), [node.attrs.spec, view]);

  const snap = usePathfinderData();
  // `useConfirm`, never window.confirm — the latter is a silent no-op in the iOS
  // WKWebView, so a "cancelled" delete would just make deleting stop working on
  // the iPad. `confirmDialog` has to be rendered for the promise to ever settle.
  const { confirm, dialog: confirmDialog } = useConfirm();
  const editable = editor.isEditable;

  /** Rows mid-write, so a second click can't race the first. */
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [writeError, setWriteError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Today is computed once per mount rather than per render: it feeds every
  // due-date comparison, and recomputing it inside the memo would make the
  // filter result a new array on every render for no reason.
  const today = useMemo(() => isoDay(new Date()), []);

  const commitSpec = useCallback(
    (next: PfBlockSpec) => {
      if (!editable) return;
      updateAttributes({ spec: serializeSpec(next) });
    },
    [editable, updateAttributes],
  );

  const setView = useCallback(
    (next: PfBlockView) => {
      if (!editable || next === view) return;
      // The spec survives the switch — the whole point of one node type is that
      // a configured list becomes a configured board without being rebuilt. Only
      // sort is nudged, because a board's manual order and a list's due order
      // are different questions.
      updateAttributes({ view: next });
    },
    [editable, updateAttributes, view],
  );

  const result = useMemo(
    () => runQuery(snap.tasks, spec.filter, spec.sort, spec.limit, today, snap.myUid),
    [snap.tasks, spec.filter, spec.sort, spec.limit, today, snap.myUid],
  );

  // ── Writes ────────────────────────────────────────────────────────────────
  //
  // Every one is optimistic against the shared cache and rolls back on failure.
  // They go through `pathfinderApi` rather than issuing their own updates so the
  // ISA split and the scheduling gate are enforced — see nexus-core/pathfinder/api.ts.

  const withBusy = useCallback(async (id: number, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(id));
    try {
      await fn();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(id);
        return n;
      });
    }
  }, []);

  const actions: TaskActions = useMemo(
    () => ({
      busy,
      toggle: (task) => {
        const prev = patchCachedTask(task.id, { done: !task.done });
        setWriteError(null);
        void withBusy(task.id, async () => {
          try {
            upsertTask(await pathfinderApi.toggleTask(task.id, !task.done));
          } catch (e: any) {
            if (prev) upsertTask(prev);
            setWriteError(e?.message ?? String(e));
          }
        });
      },
      patch: (task, patch) => {
        const prev = patchCachedTask(task.id, optimistic(task, patch));
        setWriteError(null);
        void withBusy(task.id, async () => {
          try {
            upsertTask(await pathfinderApi.patchTask(task.id, patch));
          } catch (e: any) {
            if (prev) upsertTask(prev);
            setWriteError(e?.message ?? String(e));
          }
        });
      },
      setStage: (task, stage) => {
        const prev = patchCachedTask(task.id, {
          planning: task.planning ? { ...task.planning, stage: stage as any } : task.planning,
        });
        setWriteError(null);
        void withBusy(task.id, async () => {
          try {
            upsertTask(await pathfinderApi.setStage(task.id, stage as any));
          } catch (e: any) {
            if (prev) upsertTask(prev);
            // The gate refusing is not a failure, it is the rule working. Say
            // what it wants rather than showing a raw error.
            setWriteError(
              e instanceof SchedulingGateError || e?.name === "SchedulingGateError"
                ? "Schedule calendar time for this task in PathFinder before starting it."
                : (e?.message ?? String(e)),
            );
          }
        });
      },
      remove: (task) => {
        void (async () => {
          const ok = await confirm({
            title: `Delete “${task.title}”?`,
            message: "This deletes the task in PathFinder, not just in this note.",
            details: [
              "Any subtasks are deleted with it.",
              "Future calendar blocks for it are removed; past ones are kept.",
            ],
            confirmLabel: "Delete",
          });
          if (!ok) return;
          removeTask(task.id);
          setWriteError(null);
          try {
            await pathfinderApi.deleteTask(task.id);
          } catch (e: any) {
            setWriteError(e?.message ?? String(e));
            void refresh(true);
          }
        })();
      },
    }),
    [busy, confirm, withBusy],
  );

  const addTask = useCallback(
    async (titleText: string) => {
      const text = titleText.trim();
      if (!text) return;
      setWriteError(null);
      try {
        const defaults = creationPayload(spec, today);
        upsertTask(await pathfinderApi.createTask({ title: text, ...defaults }));
      } catch (e: any) {
        setWriteError(e?.message ?? String(e));
      }
    },
    [spec, today],
  );

  const doRefresh = useCallback(async () => {
    setRefreshing(true);
    setWriteError(null);
    try {
      await refresh(true);
    } finally {
      setRefreshing(false);
    }
  }, []);

  const label = title || deriveLabel(spec, view, snap.plans, snap.goals, snap.teams, snap.members);
  const filterCount = activeFilterCount(spec.filter);

  return (
    <NodeViewWrapper
      className={`pf-block${selected ? " is-selected" : ""}${spec.compact ? " is-compact" : ""}`}
      data-view={view}
      // The node view owns its own pointer handling; without this a click on a
      // checkbox is also a click on the paragraph behind it and ProseMirror
      // moves the selection into the block.
      contentEditable={false}
    >
      <header className="pf-head">
        <span className="pf-head-icon" aria-hidden="true">{PF_VIEW_ICONS[view]}</span>

        <input
          className="pf-title"
          value={title}
          placeholder={label}
          disabled={!editable}
          aria-label="Block title"
          onChange={(e) => editable && updateAttributes({ title: e.target.value })}
        />

        <div className="pf-views" role="group" aria-label="View">
          {PF_VIEWS.map((v) => (
            <button
              key={v}
              type="button"
              className={`pf-view-btn${v === view ? " is-active" : ""}`}
              title={PF_VIEW_LABELS[v]}
              aria-label={PF_VIEW_LABELS[v]}
              aria-pressed={v === view}
              disabled={!editable}
              onClick={() => setView(v)}
            >
              {PF_VIEW_ICONS[v]}
            </button>
          ))}
        </div>

        <button
          type="button"
          className={`pf-icon-btn${refreshing || snap.status === "loading" ? " is-spinning" : ""}`}
          title="Refresh"
          aria-label="Refresh"
          onClick={doRefresh}
        >
          ⟳
        </button>

        <button
          type="button"
          className={`pf-icon-btn${spec.showFilters ? " is-active" : ""}`}
          title={spec.showFilters ? "Hide filters" : "Show filters"}
          aria-label="Toggle filters"
          aria-expanded={spec.showFilters}
          disabled={!editable}
          onClick={() => commitSpec({ ...spec, showFilters: !spec.showFilters })}
        >
          ⚙{filterCount > 0 ? <span className="pf-badge">{filterCount}</span> : null}
        </button>
      </header>

      {spec.showFilters && editable ? (
        <PathfinderFilterBar
          spec={spec}
          view={view}
          plans={snap.plans}
          goals={snap.goals}
          teams={snap.teams}
          members={snap.members}
          onChange={commitSpec}
        />
      ) : null}

      <div className="pf-body">
        <PfBody
          status={snap.status}
          error={snap.error}
          hasRows={snap.tasks.length > 0}
          matched={result.matched}
          unfiltered={isUnfiltered(spec.filter)}
          onRetry={doRefresh}
          onClearFilters={() => commitSpec({ ...spec, filter: { ...spec.filter, ...clearedFilter() } })}
          editable={editable}
        >
          {view === "list" ? (
            <PfListView
              tasks={result.tasks}
              spec={spec}
              members={snap.members}
              actions={actions}
              today={today}
              editable={editable}
              onAdd={addTask}
            />
          ) : view === "board" ? (
            <PfBoardView
              tasks={result.tasks}
              spec={spec}
              plans={snap.plans}
              members={snap.members}
              actions={actions}
              today={today}
              editable={editable}
              onSpecChange={commitSpec}
            />
          ) : (
            <PfTableView
              tasks={result.tasks}
              spec={spec}
              members={snap.members}
              actions={actions}
              today={today}
              editable={editable}
              onSpecChange={commitSpec}
            />
          )}
        </PfBody>
      </div>

      <footer className="pf-foot">
        <span className="pf-count">
          {result.truncated
            ? `Showing ${result.tasks.length} of ${result.matched}`
            : `${result.matched} ${result.matched === 1 ? "task" : "tasks"}`}
          {snap.capped ? " · read was capped" : ""}
        </span>
        {writeError ? (
          <span className="pf-foot-error" role="alert">{writeError}</span>
        ) : snap.status === "error" && snap.tasks.length > 0 ? (
          <span className="pf-foot-error" role="alert">Refresh failed — showing the last known list.</span>
        ) : snap.loadedAt > 0 ? (
          <span className="pf-stamp">Updated {new Date(snap.loadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
        ) : null}
      </footer>

      {confirmDialog}
    </NodeViewWrapper>
  );
}

/**
 * Picks the right words for whatever the store is doing.
 *
 * Every branch that is NOT "ready with rows" says something specific. The one
 * thing this must never do is render zero rows and a cheerful empty state for a
 * read that never happened.
 */
function PfBody({
  status, error, hasRows, matched, unfiltered, onRetry, onClearFilters, editable, children,
}: {
  status: string;
  error: string | null;
  hasRows: boolean;
  matched: number;
  unfiltered: boolean;
  onRetry: () => void;
  onClearFilters: () => void;
  editable: boolean;
  children: React.ReactNode;
}) {
  if (status === "signedOut") {
    return (
      <div className="pf-empty">
        <strong>Not signed in.</strong>
        <span>PathFinder tasks are private to your account. Sign in to Nexus to show them here.</span>
      </div>
    );
  }

  if (status === "error" && !hasRows) {
    return (
      <div className="pf-empty pf-empty-error">
        <strong>Couldn’t load tasks.</strong>
        <span>{error}</span>
        <button type="button" className="pf-empty-btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  if (status === "loading" && !hasRows) {
    return (
      <div className="pf-skeleton" aria-busy="true" aria-label="Loading tasks">
        {[0, 1, 2].map((i) => <div className="pf-skeleton-row" key={i} />)}
      </div>
    );
  }

  if (status === "idle" && !hasRows) {
    return <div className="pf-skeleton" aria-busy="true"><div className="pf-skeleton-row" /></div>;
  }

  if (matched === 0) {
    return (
      <div className="pf-empty">
        {unfiltered ? (
          <>
            <strong>No open tasks.</strong>
            <span>Nothing in PathFinder matches — add one below or in PathFinder.</span>
          </>
        ) : (
          <>
            <strong>No tasks match this filter.</strong>
            {editable ? (
              <button type="button" className="pf-empty-btn" onClick={onClearFilters}>Clear filters</button>
            ) : null}
          </>
        )}
      </div>
    );
  }

  return <>{children}</>;
}

/** The filter axes "Clear filters" resets — deliberately not `done`, which is a view choice. */
function clearedFilter() {
  return {
    planIds: [] as number[],
    goalIds: [] as number[],
    taskTypes: [] as never[],
    priorities: [] as never[],
    urgencies: [] as never[],
    stages: [] as never[],
    kanbanStatuses: [] as string[],
    due: "any" as const,
    search: "",
    rootsOnly: false,
    excludeQuick: false,
    scope: "any" as const,
    teamIds: [] as string[],
    assignee: "any" as const,
  };
}

/**
 * Mirrors a patch onto the cached row for the optimistic update.
 *
 * `urgency` and `stage` live on the planning relation, so spreading a flat patch
 * straight onto a task sets a dead property and the control appears frozen until
 * the refetch lands — the same trap `applyTaskPatch` exists for in PathFinder.
 */
function optimistic(task: PfTask, patch: Record<string, unknown>): Partial<PfTask> {
  const out: Record<string, unknown> = {};
  const planning: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "urgency" || k === "stage" || k === "completion_mode" || k === "target_count" || k === "notes") {
      planning[k] = v;
    } else {
      out[k] = v;
    }
  }
  if (Object.keys(planning).length && task.planning) {
    out.planning = { ...task.planning, ...planning };
  }
  return out as Partial<PfTask>;
}

/**
 * What a task created from inside this block inherits.
 *
 * The filter doubles as the creation context: a block showing plan "Thesis"
 * creates tasks in "Thesis", and a block showing today's work dates them today.
 * Only unambiguous single-value constraints carry over — see `creationDefaults`.
 */
function creationPayload(spec: PfBlockSpec, today: string): Record<string, unknown> {
  const raw = creationDefaults(spec.filter) as Record<string, unknown> & { __dueToday?: boolean };
  const { __dueToday, ...rest } = raw;
  return __dueToday ? { ...rest, due_date: today } : rest;
}
