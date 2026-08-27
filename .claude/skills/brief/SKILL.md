---
name: brief
description: Read what Bastian is currently working on — goals, active tasks, what is due, plans — from PathFinder and Vault. Use at the start of any session where the work relates to a task, plan or goal, or when the user refers to something they planned ("the thing I put in PathFinder", "pf-412", "the note about X") rather than describing it in full.
---

# What am I working on

Planning happens in PathFinder and Vault. Work happens here. This skill is the
bridge, and it exists because the alternative is expensive: finding the nine
tasks that matter among 369 open ones, across 51 `pf_` tables with an ISA
hierarchy, costs tens of thousands of tokens before the first useful thought.

Everything below is **read-only**. Writes are deliberately out of scope — see
the last section.

## The brief

One call. ~6.5 kB, about 1600 tokens, measured against the real database.

```
mcp__claude_ai_Supabase__execute_sql
  project_id: efxmzsdisaymtpebaxlp
  query: select pf_agent_brief('a33625c2-4dd2-44fa-b2e5-4d455eeac59d');
```

The uid is Bastian's. It is already public in
`packages/nexus-core/src/members.ts` (`KNOWN_MEMBERS`), which also maps uids to
names — use `memberName()` there rather than printing a raw uid at anyone.

**Pass the uid explicitly.** The MCP connects as service-role, where
`auth.uid()` is NULL, so the argument is the only scoping there is. Omitting it
returns an empty brief, which looks exactly like "nothing planned".

What comes back:

| key | what it is |
|---|---|
| `counts` | open / root / active / overdue — orientation, so the lists never have to be long |
| `goals` | all goals with their `pf_goals_with_counts` progress |
| `active` | tasks at `stage = 'active'` — the ones actually in flight |
| `due_soon` | overdue or due within 14 days, excluding anything already in `active` |
| `plans` | only plans with open work, with counts |
| `systems` | recurring commitments, **raw** — see the warning below |

## One task, in full

When the user names a task ("pf-412", "the migration task"), fetch just it.
`pf_tasks` is a supertype: the planning fields live in `pf_task_planning` and a
read without the embed silently yields default urgency and stage.

```sql
select t.*, row_to_json(p) as planning
from pf_tasks t
left join pf_task_planning p on p.task_id = t.id
where t.id = 412;
```

Its children, for a task that has been broken down:

```sql
select id, title, done, kanban_status from pf_tasks where parent_id = 412 order by sort_order;
```

## A note from Vault

Notes are too long to put in a brief — there are 173 of them — so look one up by
name instead. Vault's task blocks write to `pf_tasks`, so anything planned
*inside* a note is already in the brief above; this is for the prose around it.

```sql
select n.id, n.name, c.data
from vault_nodes n join vault_content c on c.node_id = n.id
where n.name ilike '%search term%';
```

`data` is Tiptap JSON. To read it as text rather than parsing by hand, the
repo's own flattener is `apps/Vault/Vault/src/lib/versionDiff.ts` → `noteLines()`.

## ⚠️ Do not compute due-ness, ranking, or roll-ups

`pf_agent_brief` returns **facts, never judgements**, and that is load-bearing
rather than lazy. Three rules live in exactly one place each:

- `apps/PathFinder/src/lib/systems.ts` — whether a system is due
- `apps/PathFinder/src/lib/nextUp.ts` — the "work on now" ranking
- `apps/PathFinder/src/lib/taskTree.ts` — roll-ups, coverage, the scheduling gate

CLAUDE.md records why: the due rule was previously written out three times, and
the copies already disagreed about monthly and about unknown frequencies. If you
need one of those answers, **read the module and apply it** — do not re-derive it
in SQL or in your head. `systems` comes back raw (`frequency`, `interval_days`,
`last_done`) precisely so the real rule can be applied to it.

Two more traps worth knowing:

- **`aggregate_estimate` is trigger-maintained.** It is the real total including
  children. Never sum `time_estimate` yourself; the two answers differ and the
  stored one is right.
- **`pf_tasks.due_date` is TEXT**, not `date`. Compare it against
  `to_char(current_date,'YYYY-MM-DD')`; a `::date` cast throws on any value that
  is not a clean ISO date.

## Writes are not part of this

Completing, re-staging or creating tasks goes through PathFinder's own layer,
not raw SQL — `setStage` in particular enforces a scheduling gate that spans
three tables and exists nowhere else (a task cannot reach `active` without
calendar minutes behind it). A raw `update` bypasses it silently.

If the user asks for a write, say what you would change and let them do it in the
app, or use `createPathfinderApi` from `@nexus/core/pathfinder`, which is the
shared implementation Vault's task blocks already use.
