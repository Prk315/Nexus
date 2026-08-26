// Pure helpers for team-scoped tasks. No React, no network — a function of
// fields already on the row, same spirit as taskTree.ts.

/**
 * Whether a task belongs on `myUid`'s glanceable surfaces (Dashboard, Week).
 *
 * `getAllTasks` now returns personal + every team's tasks in one list, so
 * boards need a client-side filter rather than a second query/cache — this is
 * that filter's rule, kept in one place so Dashboard and Week can't disagree.
 *
 * A personal task (no team) is always relevant — team membership doesn't gate
 * it. A team task is relevant to everyone on the team unless it names a
 * specific *other* member: `assigned_to` of `null` or the sentinel `"all"`
 * still means everyone, and only a concrete other user id narrows it to them.
 */
export function isTaskRelevantToMe(
  task: { team_id: string | null; assigned_to: string | null; user_id?: string },
  myUid: string,
): boolean {
  if (!task.team_id) return true;
  if (task.assigned_to == null || task.assigned_to === "all") return true;
  return task.assigned_to === myUid;
}
