import { useCallback, useEffect, useMemo, useState } from "react";
import { useNexusAuth } from "@nexus/core";
import {
  createTask,
  deleteTask,
  fetchOpenTasks,
  fetchRecentDone,
  setTaskDone,
  updateTask,
  type PfTask,
  type QuickCategory,
} from "./api";

/**
 * The PathFinder tasks dashboard — full CRUD on `pf_tasks` from the phone.
 *
 * Layout is four standing sections: the three quick-task lists (Reminders,
 * Chores, Shopping — the categories added 2026-08-13) and then the regular
 * project tasks. Quick lists come first because they're what the phone is
 * *for*; the project backlog is a review surface, not a capture surface.
 *
 * Everything here needs a session (owner-scoped RLS — see api.ts), so unlike
 * the timetracker panels this page gates on sign-in rather than rendering
 * empty and letting the user wonder where their data went.
 */

const CATEGORIES: Array<{ key: QuickCategory | null; label: string; icon: string }> = [
  { key: null, label: "Task", icon: "◆" },
  { key: "reminder", label: "Reminder", icon: "🔔" },
  { key: "chore", label: "Chore", icon: "🧹" },
  { key: "shopping", label: "Shopping", icon: "🛒" },
];

const SECTION_META: Array<{ key: QuickCategory | "task"; title: string }> = [
  { key: "reminder", title: "🔔 Reminders" },
  { key: "chore", title: "🧹 Chores" },
  { key: "shopping", title: "🛒 Shopping" },
  { key: "task", title: "◆ Project tasks" },
];

const PRIORITY_COLOR: Record<PfTask["priority"], string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-sky-400",
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dueLabel(due: string | null): { text: string; late: boolean } | null {
  if (!due) return null;
  const today = todayStr();
  if (due < today) return { text: "overdue", late: true };
  if (due === today) return { text: "today", late: false };
  return { text: due.slice(5), late: false }; // MM-DD
}

export function TasksPage() {
  const { session, loading } = useNexusAuth();
  const userId = session?.user.id ?? null;

  const [open, setOpen] = useState<PfTask[]>([]);
  const [done, setDone] = useState<PfTask[]>([]);
  const [showDone, setShowDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Quick-add state
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<QuickCategory | null>("reminder");
  const [dueDate, setDueDate] = useState("");

  // Inline edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editPriority, setEditPriority] = useState<PfTask["priority"]>("medium");
  const [editDue, setEditDue] = useState("");
  const [editCategory, setEditCategory] = useState<QuickCategory | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      const [o, d] = await Promise.all([fetchOpenTasks(userId), fetchRecentDone(userId)]);
      setOpen(o);
      setDone(d);
      setErr(null);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sections = useMemo(
    () =>
      SECTION_META.map((s) => ({
        ...s,
        tasks: open.filter((t) => (s.key === "task" ? t.category == null : t.category === s.key)),
      })),
    [open],
  );

  const submitCreate = async () => {
    const t = title.trim();
    if (!t || !userId) return;
    try {
      const task = await createTask(userId, { title: t, category, due_date: dueDate || null });
      setOpen((prev) => [task, ...prev]);
      setTitle("");
      setDueDate("");
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  };

  const toggle = async (task: PfTask, to: boolean) => {
    // Optimistic: move the row now, reconcile on failure. A tick that takes a
    // round-trip to appear reads as "didn't register" on a phone.
    setOpen((prev) => (to ? prev.filter((t) => t.id !== task.id) : [{ ...task, done: false }, ...prev]));
    setDone((prev) => (to ? [{ ...task, done: true }, ...prev] : prev.filter((t) => t.id !== task.id)));
    try {
      await setTaskDone(task.id, to);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      void load();
    }
  };

  const startEdit = (t: PfTask) => {
    setEditingId(t.id);
    setEditTitle(t.title);
    setEditPriority(t.priority);
    setEditDue(t.due_date ?? "");
    setEditCategory(t.category);
  };

  const submitEdit = async (id: number) => {
    const t = editTitle.trim();
    setEditingId(null);
    if (!t) return;
    try {
      const updated = await updateTask(id, {
        title: t,
        priority: editPriority,
        due_date: editDue || null,
        category: editCategory,
      });
      setOpen((prev) => prev.map((x) => (x.id === id ? updated : x)));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
  };

  const remove = async (id: number) => {
    setOpen((prev) => prev.filter((t) => t.id !== id));
    setDone((prev) => prev.filter((t) => t.id !== id));
    try {
      await deleteTask(id);
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
      void load();
    }
  };

  if (loading) return null;

  if (!session) {
    return (
      <section className="flex flex-col gap-2 rounded-xl border border-amber-500/20 bg-amber-500/[0.07] p-4 text-sm text-amber-200/90">
        <span className="font-medium">Sign in to see your tasks</span>
        <span className="text-xs text-amber-200/60">
          PathFinder tasks are scoped to your account — use the avatar in the header.
        </span>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {err && <div className="rounded-lg bg-red-500/10 p-3 text-xs text-red-300">{err}</div>}

      {/* Quick add — capture first, categorize with one tap. */}
      <section className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submitCreate();
            }}
            placeholder="Add a task…"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm outline-none placeholder:text-white/30 focus:border-indigo-400/40"
          />
          <button
            type="button"
            onClick={() => void submitCreate()}
            disabled={!title.trim()}
            className="shrink-0 rounded-lg bg-indigo-500/20 px-4 py-2 text-sm font-medium text-indigo-200 disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setCategory(c.key)}
              className={`rounded-full px-2.5 py-1 text-[11px] transition-colors ${
                category === c.key
                  ? "bg-indigo-500/25 text-indigo-200"
                  : "bg-white/[0.05] text-white/45 hover:text-white/70"
              }`}
            >
              {c.icon} {c.label}
            </button>
          ))}
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="ml-auto rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-white/60 outline-none"
          />
        </div>
      </section>

      {sections.map((s) => (
        <section key={s.key} className="flex flex-col gap-2">
          <h3 className="text-xs uppercase tracking-wide text-white/40">
            {s.title}
            {s.tasks.length > 0 && <span className="ml-1.5 text-white/25">({s.tasks.length})</span>}
          </h3>
          {s.tasks.length === 0 ? (
            <p className="text-[11px] text-white/25">Nothing here.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {s.tasks.map((t) => {
                const due = dueLabel(t.due_date);
                const editing = editingId === t.id;
                return (
                  <div
                    key={t.id}
                    className="flex items-start gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5"
                  >
                    <button
                      type="button"
                      aria-label="Complete task"
                      onClick={() => void toggle(t, true)}
                      className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border border-white/20 text-transparent transition-colors hover:border-emerald-400/60 hover:text-emerald-300"
                    >
                      ✓
                    </button>
                    {editing ? (
                      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void submitEdit(t.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                          className="rounded-lg border border-white/15 bg-white/[0.05] px-2 py-1 text-sm outline-none"
                        />
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <select
                            value={editCategory ?? ""}
                            onChange={(e) => setEditCategory((e.target.value || null) as QuickCategory | null)}
                            className="rounded-md border border-white/10 bg-[#16161d] px-1.5 py-1 text-white/70 outline-none"
                          >
                            <option value="">Task</option>
                            <option value="reminder">Reminder</option>
                            <option value="chore">Chore</option>
                            <option value="shopping">Shopping</option>
                          </select>
                          <select
                            value={editPriority}
                            onChange={(e) => setEditPriority(e.target.value as PfTask["priority"])}
                            className="rounded-md border border-white/10 bg-[#16161d] px-1.5 py-1 text-white/70 outline-none"
                          >
                            <option value="high">High</option>
                            <option value="medium">Medium</option>
                            <option value="low">Low</option>
                          </select>
                          <input
                            type="date"
                            value={editDue}
                            onChange={(e) => setEditDue(e.target.value)}
                            className="rounded-md border border-white/10 bg-[#16161d] px-1.5 py-1 text-white/70 outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => void submitEdit(t.id)}
                            className="rounded-md bg-indigo-500/20 px-2 py-1 text-indigo-200"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(t.id)}
                            className="ml-auto rounded-md bg-red-500/10 px-2 py-1 text-red-300"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startEdit(t)}
                        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
                      >
                        <span className="flex w-full min-w-0 items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${PRIORITY_COLOR[t.priority]}`} />
                          <span className="truncate text-sm text-white/85">{t.title}</span>
                        </span>
                        <span className="flex items-center gap-2 text-[10px] text-white/35">
                          {due && (
                            <span className={due.late ? "font-semibold text-red-300" : ""}>{due.text}</span>
                          )}
                          {t.plan_title && <span className="truncate">{t.plan_title}</span>}
                        </span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ))}

      {/* Recently completed — the undo surface for a mis-tap. */}
      <section className="flex flex-col gap-2 pb-4">
        <button
          type="button"
          onClick={() => setShowDone((v) => !v)}
          className="w-fit text-xs uppercase tracking-wide text-white/40 hover:text-white/60"
        >
          {showDone ? "▾" : "▸"} Completed ({done.length})
        </button>
        {showDone && (
          <div className="flex flex-col gap-1">
            {done.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
              >
                <button
                  type="button"
                  aria-label="Reopen task"
                  onClick={() => void toggle(t, false)}
                  className="grid h-5 w-5 shrink-0 place-items-center rounded-md border border-emerald-400/40 bg-emerald-500/10 text-emerald-300"
                >
                  ✓
                </button>
                <span className="truncate text-sm text-white/40 line-through">{t.title}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
