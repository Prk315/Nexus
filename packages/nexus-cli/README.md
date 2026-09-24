# nexus-cli

`nexus` is a terminal CLI for the Nexus monorepo. It reads and writes Vault
notes and PathFinder tasks so that Claude Code, shell scripts and `nexus board`
— a TUI meant to live in a tmux pane next to the editor — can work with what
was planned in the apps, without opening them.

- TypeScript, ESM, Node 24, no build step (runs through `tsx`).
- Every command supports `--json` (stable field names) and prints a compact
  table otherwise. Every human-readable header starts with `[<profile> <email>]`.
- Exit codes: `0` ok, `1` user error, `2` auth error. Errors are one line on stderr.
- Everything except `nexus login` and `nexus board` is non-interactive.

## Install

From the repo root (npm workspaces; everything is hoisted):

```sh
npm install
npm run nexus -- --help          # run from the repo root
```

To have a global `nexus` command:

```sh
cd packages/nexus-cli && npm link        # symlinks bin/nexus.js onto your PATH
nexus --help
```

`bin/nexus.js` registers `tsx` as the ESM loader and imports `src/index.ts`,
so the linked command always runs the checked-out source.

### Supabase credentials

The CLI needs the NEXUS project's URL and **anon key**. Resolution order:

1. `NEXUS_SUPABASE_URL` / `NEXUS_SUPABASE_ANON_KEY` in the environment
2. `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` in the environment
3. a `.env` file: `$NEXUS_ENV_FILE`, then `.env` from the cwd upwards, then the
   repo root `.env`, `apps/Vault/Vault/.env`, `apps/PathFinder/.env`
4. the URL alone falls back to `https://efxmzsdisaymtpebaxlp.supabase.co`

Placeholder values from an unfilled `.env.example` (`your-project-url`,
`your-anon-key`, `<...>`) are ignored. The anon key is never embedded in the
CLI; if none is found the error names every file that was searched.
`nexus whoami` shows which source was used.

## Profiles

A profile is one signed-in account, stored at `~/.nexus/profiles/<name>.json`
with mode `0600` (`NEXUS_HOME` overrides `~/.nexus`). It holds
`{ email, user_id, refresh_token, access_token, expires_at }` and nothing else;
no password is ever written anywhere. Every command refreshes the session
transparently and writes the new tokens back.

```sh
nexus login --profile dev        # prompts for email and (masked) password
nexus login --profile me
nexus whoami --profile dev
nexus logout --profile dev
```

Pick the profile with `--profile <name>` (short `-p`), or `NEXUS_PROFILE` in
the environment; the default is `default`. With no session the command exits
`2` and prints the exact login command to run.

### The sandbox rule

Two profiles are in use, and they are not interchangeable:

| profile | account | use |
|---|---|---|
| `dev` | `bastianswork@gmail.com` | **Vault sandbox.** Create and delete Vault nodes freely. |
| `me`  | Bastian's personal account | **PathFinder lives here. Read-only during development.** |

Never run a PathFinder write (`nexus pf task ...`) against `me` during
development or in a test. The write commands are unit-tested against a mocked
`PathfinderApi`; smoke-test them for real only when Bastian says so. Vault
writes go to `dev`. The profile name is in every header so the two are never
confused.

## Commands

Global options: `-p, --profile <name>`, `--json`.

### Vault

```sh
nexus vault tree [--root <id|name>] [--tags] [--depth n] [--folders]
nexus vault node <id>
nexus vault note <id> [--raw]
nexus vault search <text>
nexus vault mkdir "<name>" [--parent <id>] [--tag t ...]
nexus vault mknote "<name>" [--parent <id>] [--tag t ...]
nexus vault rm <id> --yes
nexus vault note set <id> (--md <file> | --stdin) [--force]
nexus vault note append <id> (--md <file> | --stdin) [--force]
```

- `tree` builds the graph from `vault_nodes` + `vault_edges` (`from_id` is the
  parent). Roots are nodes with no incoming edge. Default depth 4. A node
  reached a second time (two parents) is printed once and marked `↺`.
  `--root` accepts an id or a name; an ambiguous name is an error.
- `note <id>` dumps the body as Markdown on **stdout** and puts the header on
  **stderr**, so `nexus vault note <id> > file.md` gives a clean file.
  Paragraphs, headings, bullet/ordered lists, code blocks (with language),
  bold/italic/code/link marks and hard breaks render as Markdown; task lists,
  blockquotes and rules render textually; any other block renders as a fenced
  block tagged ```` ```vault:<type> ```` containing its JSON, so nothing is
  silently dropped. Unknown inline nodes become `` `vault:<type> {json}` ``
  code spans; unknown marks keep their text. `--raw` prints the stored string.
- `note set` / `note append` convert Markdown to TipTap JSON and upsert
  `{"__vault":1,"doc":...}` into `vault_content` with `updated_at = now`.
  The converter only emits `doc, paragraph, heading, bulletList, orderedList,
  listItem, codeBlock, text, hardBreak` and the marks `bold, italic, code,
  link`; an unknown node type would blank the note in the app. Constructs
  outside that set are flattened or kept as literal text with a warning on
  stderr (blockquote → its blocks, `---` dropped, `- [ ]` → literal text,
  image → link, heading 5–6 → 4). A ```` ```vault:<type> ```` fence is refused.
  `append` keeps the existing blocks untouched (including types the CLI does
  not write) and adds the new ones.
- Three refusals protect data other clients hold: a note with `team_id` set
  (shared, possibly CRDT co-edited) is never written; legacy HTML content is
  only replaced with `--force` (`append --force` flattens it to plain
  paragraphs first, with a warning); `updated_at` is read before converting and
  re-checked right before the upsert, and a change in between aborts with exit 1.
- `rm` deletes the node, its edges (FK cascade) and the content rows the app's
  `deleteNode` removes (`vault_content` incl. `_annot/_hl/_textannot/_bookmarks/_margins`,
  `vault_journals`, `vault_records`, `vault_ydoc`, `vault_content_versions`).
  Children are not deleted; they lose the edge and are listed on stderr.

Examples:

```sh
nexus -p dev vault tree --root UNI --tags --depth 2
nexus -p dev vault search robotics --json
nexus -p dev vault mknote "Week 3" --parent 3f2a... --tag robots
nexus -p dev vault note set 7b1c... --md notes.md
echo "## Follow-ups" | nexus -p dev vault note append 7b1c... --stdin
nexus -p dev vault note 7b1c... > week3.md
```

### PathFinder

```sh
nexus pf brief
nexus pf tasks [--active] [--due] [--plan <id>] [--roots] [--all] [--tree <taskId>]
nexus pf goals
nexus pf plans
nexus pf task add "<title>" [--parent id] [--plan id] [--goal id] [--due YYYY-MM-DD]
                            [--priority p] [--urgency u] [--estimate min] [--category c]
nexus pf task done <id> | undone <id>
nexus pf task stage <id> <refine|schedule|active|done>
nexus pf task status <id> <kanbanStatus>
nexus pf task patch <id> --set key=value ...
nexus pf task rm <id> --yes
```

- `brief` calls the `pf_agent_brief(p_user_id)` RPC with the profile's uid and
  prints a readable summary (counts, goals, active, due_soon, plans, systems).
  `--json` prints the RPC result untouched. Systems come back raw on purpose:
  due-ness is computed only by `apps/PathFinder/src/lib/systems.ts`.
- `tasks` reads through `createPathfinderApi().loadTasks()` (with the
  `pf_task_planning` embed, so stage and urgency are real). Open tasks by
  default; `--all` includes done.
- `tasks --tree <id>` prints the subtree to **depth 4** and reports **leaf**
  counts (open/done) separately from containers, following the `brief` skill's
  rule that headings are not work. If the cap hid children it says so and the
  counts are a floor.
- `patch --set` accepts `title, plan_id, parent_id, goal_id, priority, due_date,
  time_estimate, kanban_status, category, sort_order, team_id, assigned_to,
  urgency, completion_mode, target_count, notes`; `null` clears a field. It
  refuses `stage` and `done` (use `task stage` / `task done`, which carry the
  rules) and the database-maintained `task_type` / `aggregate_estimate`.

Examples:

```sh
nexus -p me pf brief
nexus -p me pf tasks --active
nexus -p me pf tasks --tree 412
nexus -p me pf tasks --plan 98 --json | jq '.tasks[] | {id, title}'
# writes — only when the lead says so:
nexus -p me pf task add "Write the abstract" --parent 412 --due 2026-10-01
nexus -p me pf task stage 415 active        # fails with the gate message if unscheduled
```

### Board — the TUI

```sh
nexus board [-p profile]        # e.g. nexus -p me board
```

A full-screen Ink board with four panes, for a tmux pane beside the editor. The
header is always `[<profile> <email>] nexus board · <today>`, so the account
being edited is never in doubt. It is interactive: it refuses `--json` and
refuses to start when stdin/stdout is not a TTY.

| pane | what |
|---|---|
| **1 Roadmap** | goals (status, priority, deadline) → their plans → a plan's top-level tasks. Every row carries `done/total` **leaves** and a bar. |
| **2 Current** | stage `active` plus anything open that is due today or overdue. Overdue first, then due date, then urgency. Columns: id, title, due, urgency, kanban, plan. |
| **3 Upcoming** | the open work Current does not hold, grouped *due within 7 days* / *due later* / *no date*, by due date then priority. |
| **4 Progress** | the brief's headline numbers (open, roots, active, overdue) and per-goal done/total leaves with a bar. |

Keys (the bottom line lists them):

| key | does |
|---|---|
| `1`–`4`, `Tab` | switch pane |
| `j`/`k`, `↑`/`↓`, PgUp/PgDn | move |
| `Enter` | expand / collapse a goal or plan |
| `a` | add a task — title prompt; the plan is inherited from the selected plan or task |
| `d` | toggle done |
| `s` | set stage (menu: refine / schedule / active / done) |
| `x` | set kanban status (menu) |
| `e` | edit title, then due date (empty clears it) |
| `D` | delete — **y/n confirm**, and it takes the subtree |
| `r` | refresh |
| `/` | filter by text; `Esc` clears it |
| `q`, `Ctrl-C` | quit |

Every write goes through `createPathfinderApi`, re-fetches, and prints one
status line (`done: 1023 Book: …`). A failure prints the error **verbatim** —
`setStage`'s scheduling-gate message is the rule, not a generic "couldn't set
stage". `D` is the only key that writes without a further keystroke being
impossible to reach by accident; every other write changes one field of one
visible row and says which.

Three things it deliberately refuses to round off:

- **Counts are leaves, not nodes** (the `brief` skill's rule), and a plan's work
  is the *closure* over its tasks' descendants — a step does not inherit its
  parent's `plan_id`, so `plan_id = n` alone misses whole branches.
- **The goal buckets partition the tasks.** A step reaching no goal of its own
  still sits inside its ancestor's goal closure, so `(no goal)` is what is left
  over rather than "tasks whose goal is null" — otherwise those steps are
  counted twice.
- **Unknown is not zero.** If `pf_agent_brief` fails the headline numbers read
  `?` and the board says so; if `loadTasks()` hit the row cap it says every
  count below is a floor; a plan with no leaves gets an empty track and `0/0`,
  never a filled bar.

Readable at 100 columns; at 80 it drops the `plan` and `kanban`/`stage`/
`deadline` columns and gives the space back to the title, which is the last
thing to give way.

### The "never raw SQL" rule

**All PathFinder writes go through `createPathfinderApi` from
`@nexus/core/pathfinder`**, never through a table update, an RPC of your own,
or the Supabase MCP's `execute_sql`. Three invariants live only in that layer:

1. `setStage` enforces the scheduling gate: a task cannot become `active`
   without calendar minutes behind it. A raw `update` bypasses it silently.
2. `patchTask` splits a flat patch across `pf_tasks` and `pf_task_planning`.
   Writing `urgency` or `stage` onto `pf_tasks` does not error; it does nothing.
3. `task_type` is generated and `aggregate_estimate` is trigger-maintained.

`nexus pf task stage` surfaces the gate's error verbatim.

## Development

```sh
cd packages/nexus-cli
npx vitest run       # Markdown round trips, tree walks, profiles, the board's data
                     # shaping and pane snapshots, and every write command and
                     # board keystroke against a mocked PathfinderApi
npx tsc --noEmit     # type-check
```

The tests are pure: no network, no Supabase env needed. Command tests hand a
mocked `PathfinderApi` / `VaultApi` to `registerPfCommands` /
`registerVaultCommands` and assert the calls. The board is tested the same way
in three layers: `src/board/data.test.ts` (the buckets, the leaf counts, the
sorting — pure functions, no React), `src/board/render.test.tsx` (each pane
rendered to a string on `src/board/fixture.ts`, at 100 and 80 columns) and
`src/board/app.test.tsx` (every key driven through `ink-testing-library`'s
stdin, asserting exactly which api method was called). Nothing in the suite can
reach the personal account.

⚠️ One known-flaky case, unrelated to the board: `profiles.test.ts`'s "prefers
NEXUS_* env, then VITE_*" expects `source.url` to be `built-in default`, which
only holds when no `.env` on the search path supplies a URL. This worktree's
root `.env` does, so that one assertion fails here. `candidateEnvFiles` always
appends `<repo root>/.env`, and no environment variable suppresses it.

`@nexus/core`'s package `exports` point at `.ts` source; the CLI imports the
deep path `@nexus/core/pathfinder` (never the `@nexus/core` barrel, which pulls
in React and three.js) and `tsx` resolves it directly. Note that
`node_modules/@nexus/core` is a workspace symlink: in a git worktree with its
own `node_modules` it points at that worktree's `packages/nexus-core`; with a
symlinked `node_modules` it points at the main checkout's copy.

## JSON shapes

- `vault tree`: `{ profile, user_id, depth, roots: TreeRow[] }`,
  `TreeRow = { id, name, kind, tags, depth, repeat?, children? }`
- `vault node`: `{ profile, node: { id, name, kind, tags, team_id, user_id, parents: [{id,name}], children: [{id,name,kind}] } }`
- `vault note`: `{ profile, id, name, kind, team_id, shape: "json"|"html"|"empty", enveloped, updated_at, updated_by, markdown, doc?, raw? }`
- `vault search`: `{ profile, query, count, results: [{ id, name, kind, tags, team_id, parents: [name] }] }`
- `vault mkdir|mknote`: `{ profile, created: { id, name, kind, tags, parent } }`
- `vault rm`: `{ profile, deleted, name, kind, orphaned_children }`
- `vault note set|append`: `{ profile, id, name, updated_at, warnings, blocks }`
- `pf brief`: the RPC's JSON (`generated_at, user_id, counts, goals, active, due_soon, plans, systems`)
- `pf tasks`: `{ profile, capped, count, tasks: PfTask[] }`; with `--tree`:
  `{ profile, capped, root, depth, nodes, leaves, open_leaves, done_leaves, containers, truncated_at, tree }`
- `pf goals` / `pf plans`: `{ profile, count, goals|plans }`
- `pf task add|done|undone|stage|status|patch`: `{ profile, task: PfTask }`; `rm`: `{ profile, deleted, title }`
- `whoami`: `{ profile, email, user_id, expires_at, supabase_url, anon_key_source, file, profiles }`
