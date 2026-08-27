// The shell every PathFinder block wears: title, view switcher, filter bar,
// footer, the three views it can render, and the detail sheet.
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
//     Expanding a row is on the DATA side of that line, deliberately. It is
//     ephemeral view state — held in React, forgotten on remount — not
//     configuration. Persisting it would put one undo step and one autosave
//     behind every triangle, and a note with a big outline in it would rewrite
//     `vault_content` as fast as you could click.
//
//  2. **An empty list must never be able to mean anything but "nothing
//     matched."** Signed out, still loading, and failed-to-load are each their
//     own state with their own words. `pf_tasks` is `auth.uid()`-scoped, so a
//     session-less read returns an empty set rather than an error — rendering
//     that as "All done ✓" is the same lie as an "Inbox zero" panel that has
//     never successfully run.

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import React from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  creationDefaults,
  isoDay,
  runQuery,
  runTreeQuery,
  statFor,
  SchedulingGateError,
  type PfTask,
  type SubtreeStat,
  type TaskTreeRow,
} from "@nexus/core/pathfinder";
import {
  clearedSpec,
  deriveLabel,
  parseSpec,
  serializeSpec,
  specFilterCount,
  specIsUnfiltered,
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
  setCachedTagIndex,
  setCachedTaskTags,
  subscribe,
  tagColorFor,
  upsertTask,
} from "../lib/pathfinderStore";
import {
  addTaskTag,
  deleteTaskTag,
  loadTaskTags,
  matchesTags,
  removeTaskTag,
  renameTaskTag,
} from "../lib/vaultTaskTags";
import { PathfinderFilterBar } from "./PathfinderFilterBar";
import { PathfinderTaskDetail } from "./PathfinderTaskDetail";
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
  /** Creates a child of `parent`, inheriting the block's creation context. */
  addSubtask: (parent: PfTask, title: string) => void;
  /** Persist a manual order. Pass the COMPLETE ordered group — see the api. */
  reorder: (orderedIds: number[]) => void;
  openDetail: (task: PfTask) => void;
  addTag: (task: PfTask, tag: string) => void;
  removeTag: (task: PfTask, tag: string) => void;
  busy: Set<number>;
  /** Descendant roll-ups, so a row can show "3/12" without walking the tree itself. */
  stats: Map<number, SubtreeStat>;
}

/** Expand/collapse, which is view state and never reaches the document. */
export interface TreeControls {
  toggleCollapse: (id: number) => void;
  /** Pulls one row's filtered-out steps in, without changing the block's filter. */
  expandHidden: (id: number) => void;
}

/**
 * What the block needs from whatever is hosting it.
 *
 * The block is used in two places now — a Tiptap node view in a note, and a
 * block on the canvas — and its coupling to Tiptap was always tiny:
 * `node.attrs`, `updateAttributes`, `editor.isEditable`, `selected`, and the
 * wrapper element. Naming those five is what lets one implementation serve both
 * hosts instead of the canvas growing a second, drifting copy of a 660-line
 * component.
 */
export interface PathfinderBlockHostProps {
  attrs: { view?: string | null; spec?: string | null; title?: string | null };
  setAttrs: (patch: { view?: string; spec?: string; title?: string }) => void;
  editable: boolean;
  selected: boolean;
  /**
   * The outer element.
   *
   * ⚠️ Tiptap MUST pass `NodeViewWrapper` — it is what registers the node view's
   * DOM with ProseMirror. The canvas must NOT: `NodeViewWrapper` reads React
   * context that only a node view renderer provides, so outside one it throws
   * rather than degrading.
   */
  Wrapper: React.ComponentType<PathfinderWrapperProps>;
}

/** Exactly what the block asks of its wrapper — nothing host-specific. */
export interface PathfinderWrapperProps {
  className?: string;
  "data-view"?: string;
  contentEditable?: boolean;
  children?: React.ReactNode;
}

/**
 * The plain wrapper, for hosts that are not a Tiptap node view.
 *
 * A component rather than the string `"div"` because the prop is typed as a
 * component: `NodeViewWrapper` and an intrinsic tag have no common type that
 * still checks the props being passed, and loosening it to `ElementType` gives
 * up that checking entirely.
 */
export function PlainBlockWrapper(props: PathfinderWrapperProps) {
  return <div {...props} />;
}

/** The Tiptap host. Maps a node view onto the props above and nothing else. */
export function PathfinderBlockView({ node, updateAttributes, editor, selected }: NodeViewProps) {
  return (
    <PathfinderBlock
      attrs={node.attrs as PathfinderBlockHostProps["attrs"]}
      setAttrs={updateAttributes}
      editable={editor.isEditable}
      selected={selected}
      Wrapper={NodeViewWrapper}
    />
  );
}

export function PathfinderBlock({
  attrs, setAttrs, editable, selected, Wrapper,
}: PathfinderBlockHostProps) {
  const view = (attrs.view ?? "list") as PfBlockView;
  const title = (attrs.title ?? "") as string;
  const spec = useMemo(() => parseSpec(attrs.spec, view), [attrs.spec, view]);

  const snap = usePathfinderData();
  // `useConfirm`, never window.confirm — the latter is a silent no-op in the iOS
  // WKWebView, so a "cancelled" delete would just make deleting stop working on
  // the iPad. `confirmDialog` has to be rendered for the promise to ever settle.
  const { confirm, dialog: confirmDialog } = useConfirm();

  /** Rows mid-write, so a second click can't race the first. */
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [writeError, setWriteError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Collapse state is a set of COLLAPSED ids, not expanded ones, so a freshly
  // loaded block shows the whole outline. Defaulting to collapsed would hide the
  // hierarchy the feature exists to show, and every row would need one click
  // before it said anything a flat list didn't.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [expandFull, setExpandFull] = useState<Set<number>>(new Set());
  const [detailId, setDetailId] = useState<number | null>(null);

  // Today is computed once per mount rather than per render: it feeds every
  // due-date comparison, and recomputing it inside the memo would make the
  // filter result a new array on every render for no reason.
  const today = useMemo(() => isoDay(new Date()), []);

  const commitSpec = useCallback(
    (next: PfBlockSpec) => {
      if (!editable) return;
      setAttrs({ spec: serializeSpec(next) });
    },
    [editable, setAttrs],
  );

  const setView = useCallback(
    (next: PfBlockView) => {
      if (!editable || next === view) return;
      // The spec survives the switch — the whole point of one node type is that
      // a configured list becomes a configured board without being rebuilt. Only
      // sort is nudged, because a board's manual order and a list's due order
      // are different questions.
      setAttrs({ view: next });
    },
    [editable, setAttrs, view],
  );

  // ── Tags ──────────────────────────────────────────────────────────────────

  const tagsOf = useCallback((taskId: number) => snap.tags.get(taskId) ?? [], [snap.tags]);
  const tagColor = useCallback((tag: string) => tagColorFor(snap, tag), [snap]);

  /**
   * The Vault-tag half of the query, as a predicate `runQuery` can apply
   * alongside PathFinder's own axes.
   *
   * Memoized because it is passed INTO the query memo: an inline arrow would be
   * a new identity every render, which would recompute the whole filter on every
   * keystroke anywhere in the note.
   */
  const tagPredicate = useMemo(() => {
    if (spec.tags.length === 0 && !spec.untaggedOnly) return undefined;
    // A tag filter against a database that has no tag table would match nothing
    // and read as "no tasks" — the block would look empty rather than
    // unconfigured. Ignoring the axis keeps the rest of the block honest; the
    // filter bar is where the missing table is reported.
    if (!snap.tagsAvailable) return undefined;
    return (t: PfTask) =>
      matchesTags(snap.tags.get(t.id) ?? [], spec.tags, spec.tagMode, spec.untaggedOnly);
  }, [spec.tags, spec.tagMode, spec.untaggedOnly, snap.tags, snap.tagsAvailable]);

  // ── Query ─────────────────────────────────────────────────────────────────

  const query = useMemo(() => {
    // The board is always flat, whatever `tree` says. It has no nesting to
    // render, and honouring the axis there would mean switching a block from
    // list to board silently changed WHICH tasks it contains — `full` pulls in
    // steps the filter excludes, so the card count would jump on a view switch
    // that is supposed to be a pure re-presentation of the same rows.
    if (spec.tree === "off" || view === "board") {
      const r = runQuery(snap.tasks, spec.filter, spec.sort, spec.limit, today, snap.myUid, tagPredicate);
      // Wrapped in the same row shape the tree produces so the list and table
      // render one way rather than branching per row. Flat rows carry no
      // children and no hidden-children count: in this mode subtasks appear as
      // their own top-level rows, so there is nothing to disclose.
      const rows: TaskTreeRow[] = r.tasks.map((task) => {
        const stat = statFor(snap.stats, task.id);
        return {
          task,
          depth: 0,
          childCount: 0,
          directCount: stat.direct,
          descendants: stat.total,
          descendantsDone: stat.done,
          hiddenChildren: 0,
          collapsed: false,
        };
      });
      return { rows, tasks: r.tasks, matched: r.matched, truncated: r.truncated };
    }

    const r = runTreeQuery({
      all: snap.tasks,
      filter: spec.filter,
      sort: spec.sort,
      limit: spec.limit,
      today,
      myUid: snap.myUid,
      mode: spec.tree,
      collapsed,
      expandFull,
      extra: tagPredicate,
      stats: snap.stats,
    });
    return { rows: r.rows, tasks: r.rows.map((x) => x.task), matched: r.matched, truncated: r.truncated };
  }, [
    snap.tasks, snap.myUid, snap.stats,
    spec.filter, spec.sort, spec.limit, spec.tree, view,
    today, collapsed, expandFull, tagPredicate,
  ]);

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
      stats: snap.stats,
      openDetail: (task) => setDetailId(task.id),
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
      reorder: (orderedIds) => {
        setWriteError(null);
        void (async () => {
          try {
            await pathfinderApi.reorderTasks(orderedIds);
            // Refetch rather than patch the snapshot: the write touches every
            // id in the list, and reproducing that locally is a second copy of
            // "sort_order = index" that can disagree with the one that ran.
            await refresh(true);
          } catch (e: any) {
            setWriteError(e?.message ?? String(e));
          }
        })();
      },
      addSubtask: (parent, titleText) => {
        const text = titleText.trim();
        if (!text) return;
        setWriteError(null);
        void (async () => {
          try {
            // A step inherits the block's creation context the same way a
            // top-level add does, then overrides `parent_id`. Plan and goal come
            // along because a step of a planned task belongs to that plan — but
            // the parent's own plan wins over the filter's, since the parent is
            // the more specific statement about where this work lives.
            const defaults = creationPayload(spec, today);
            upsertTask(await pathfinderApi.createTask({
              ...defaults,
              title: text,
              parent_id: parent.id,
              plan_id: parent.plan_id ?? (defaults.plan_id as number | null | undefined) ?? null,
            }));
            // A newly-broken-down task with a collapsed row would swallow the
            // step the user just typed.
            setCollapsed((c) => {
              if (!c.has(parent.id)) return c;
              const n = new Set(c);
              n.delete(parent.id);
              return n;
            });
          } catch (e: any) {
            setWriteError(e?.message ?? String(e));
          }
        })();
      },
      remove: (task) => {
        void (async () => {
          const stat = statFor(snap.stats, task.id);
          const ok = await confirm({
            title: `Delete “${task.title}”?`,
            message: "This deletes the task in PathFinder, not just in this note.",
            details: [
              stat.total > 0
                ? `Its ${stat.total} step${stat.total === 1 ? "" : "s"} are deleted with it.`
                : "Any subtasks are deleted with it.",
              "Future calendar blocks for it are removed; past ones are kept.",
              "Its Vault tags go with it.",
            ],
            confirmLabel: "Delete",
          });
          if (!ok) return;
          if (detailId === task.id) setDetailId(null);
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
      addTag: (task, tag) => {
        const current = snap.tags.get(task.id) ?? [];
        const prev = setCachedTaskTags(task.id, [...current, tag]);
        setWriteError(null);
        void (async () => {
          try {
            await addTaskTag(task.id, tag);
          } catch (e: any) {
            setCachedTaskTags(task.id, prev);
            setWriteError(e?.message ?? String(e));
          }
        })();
      },
      removeTag: (task, tag) => {
        const current = snap.tags.get(task.id) ?? [];
        const prev = setCachedTaskTags(task.id, current.filter((t) => t !== tag));
        setWriteError(null);
        void (async () => {
          try {
            await removeTaskTag(task.id, tag);
          } catch (e: any) {
            setCachedTaskTags(task.id, prev);
            setWriteError(e?.message ?? String(e));
          }
        })();
      },
    }),
    [busy, confirm, withBusy, snap.stats, snap.tags, spec, today, detailId],
  );

  const treeControls: TreeControls = useMemo(
    () => ({
      toggleCollapse: (id) =>
        setCollapsed((c) => {
          const n = new Set(c);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }),
      expandHidden: (id) =>
        setExpandFull((e) => {
          if (e.has(id)) return e;
          const n = new Set(e);
          n.add(id);
          return n;
        }),
    }),
    [],
  );

  const addTask = useCallback(
    async (titleText: string) => {
      const text = titleText.trim();
      if (!text) return;
      setWriteError(null);
      try {
        const defaults = creationPayload(spec, today);
        const created = await pathfinderApi.createTask({ title: text, ...defaults });
        upsertTask(created);
        // A block filtered to exactly one tag creates INTO that tag, for the
        // same reason it creates into a single filtered plan: otherwise the task
        // you just typed vanishes from the block that created it. Ambiguous
        // selections (several tags, or "none of") contribute nothing — see
        // `creationDefaults` for the same rule on PathFinder's axes.
        if (snap.tagsAvailable && spec.tagMode === "any" && spec.tags.length === 1 && !spec.untaggedOnly) {
          const tag = spec.tags[0];
          setCachedTaskTags(created.id, [tag]);
          try {
            await addTaskTag(created.id, tag);
          } catch {
            setCachedTaskTags(created.id, []);
          }
        }
      } catch (e: any) {
        setWriteError(e?.message ?? String(e));
      }
    },
    [spec, today, snap.tagsAvailable],
  );

  /** Rename and delete rewrite many rows, so both refetch rather than guess. */
  const renameTag = useCallback((from: string, to: string) => {
    setWriteError(null);
    void (async () => {
      try {
        await renameTaskTag(from, to);
        setCachedTagIndex(await loadTaskTags());
      } catch (e: any) {
        setWriteError(e?.message ?? String(e));
      }
    })();
  }, []);

  const deleteTag = useCallback(
    (tag: string) => {
      void (async () => {
        const ok = await confirm({
          title: `Delete the tag “#${tag}”?`,
          message: "It is removed from every task that carries it.",
          details: [
            "The tasks themselves are untouched.",
            "PathFinder is unaffected — this tag only ever existed in Vault.",
          ],
          confirmLabel: "Delete tag",
        });
        if (!ok) return;
        setWriteError(null);
        try {
          await deleteTaskTag(tag);
          setCachedTagIndex(await loadTaskTags());
          if (spec.tags.includes(tag)) {
            commitSpec({ ...spec, tags: spec.tags.filter((t) => t !== tag) });
          }
        } catch (e: any) {
          setWriteError(e?.message ?? String(e));
        }
      })();
    },
    [confirm, spec, commitSpec],
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
  const filterCount = specFilterCount(spec);

  // Resolved from the live snapshot rather than held as an object: the sheet
  // must show the task as it is NOW, and it must close by itself when the task
  // stops existing — deleted here, or by another block, or in PathFinder.
  const detailTask = detailId == null ? null : snap.tasks.find((t) => t.id === detailId) ?? null;
  useEffect(() => {
    if (detailId != null && !detailTask && snap.status === "ready") setDetailId(null);
  }, [detailId, detailTask, snap.status]);

  return (
    <Wrapper
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
          onChange={(e) => editable && setAttrs({ title: e.target.value })}
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
          allTags={snap.allTags}
          tagsAvailable={snap.tagsAvailable}
          tagColor={tagColor}
          onRenameTag={renameTag}
          onDeleteTag={deleteTag}
          onChange={commitSpec}
        />
      ) : null}

      <div className="pf-body">
        <PfBody
          status={snap.status}
          error={snap.error}
          hasRows={snap.tasks.length > 0}
          matched={query.matched}
          unfiltered={specIsUnfiltered(spec)}
          onRetry={doRefresh}
          onClearFilters={() => commitSpec(clearedSpec(spec))}
          editable={editable}
        >
          {view === "list" ? (
            <PfListView
              rows={query.rows}
              spec={spec}
              members={snap.members}
              actions={actions}
              today={today}
              editable={editable}
              tagsOf={tagsOf}
              tagColor={tagColor}
              tree={treeControls}
              onAdd={addTask}
              onSpecChange={editable ? commitSpec : undefined}
            />
          ) : view === "board" ? (
            <PfBoardView
              tasks={query.tasks}
              spec={spec}
              plans={snap.plans}
              members={snap.members}
              actions={actions}
              today={today}
              editable={editable}
              tagsOf={tagsOf}
              tagColor={tagColor}
              onSpecChange={commitSpec}
            />
          ) : (
            <PfTableView
              rows={query.rows}
              spec={spec}
              members={snap.members}
              actions={actions}
              today={today}
              editable={editable}
              tagsOf={tagsOf}
              tagColor={tagColor}
              tree={treeControls}
              onSpecChange={commitSpec}
            />
          )}
        </PfBody>
      </div>

      <footer className="pf-foot">
        <span className="pf-count">
          {query.truncated
            ? `Showing ${query.rows.length} of ${query.matched}`
            : `${query.matched} ${query.matched === 1 ? "task" : "tasks"}`}
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

      {detailTask ? (
        <PathfinderTaskDetail
          task={detailTask}
          snap={snap}
          actions={actions}
          editable={editable}
          today={today}
          error={writeError}
          tagColor={tagColor}
          onClose={() => setDetailId(null)}
          onSelectTask={(t) => setDetailId(t.id)}
        />
      ) : null}

      {confirmDialog}
    </Wrapper>
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
