---
name: nexus-cli
description: Read and write Vault notes and PathFinder tasks from the terminal with the `nexus` CLI (packages/nexus-cli). Use when a task needs a note's content, the folder tree, a task subtree with leaf counts, the pf_agent_brief, or a write to a note or task — instead of raw SQL or the Supabase MCP.
---

# nexus CLI

Run as `npm run nexus -- <args>` from the repo root, or `nexus <args>` if linked
(`cd packages/nexus-cli && npm link`). Full docs: `packages/nexus-cli/README.md`.

**Profiles — the sandbox rule.** `-p dev` is the Vault sandbox (write freely).
`-p me` is Bastian's personal account, where PathFinder lives: **read-only
unless he says otherwise**. Never run `pf task ...` against `me` on your own.
Every header starts with `[<profile> <email>]`; check it.

No session → exit 2 and the message names the command: `nexus login --profile <name>`
(interactive; Bastian runs it himself — never handle a password). Exit 1 = user
error. Add `--json` for machine output. Errors are one line on stderr.

## Reads

```
nexus -p dev vault tree [--root <id|name>] [--tags] [--depth 4] [--folders]
nexus -p dev vault node <id>
nexus -p dev vault note <id> [--raw]        # Markdown on stdout, header on stderr
nexus -p dev vault search <text>
nexus -p me  pf brief                       # pf_agent_brief for the profile's uid
nexus -p me  pf tasks [--active] [--due] [--plan <id>] [--roots] [--all]
nexus -p me  pf tasks --tree <taskId>       # depth 4, counts LEAVES not nodes
nexus -p me  pf goals | pf plans
```

`vault note` renders blocks it does not write as ```` ```vault:<type> ```` fences
holding the JSON; that is the note's real content, not an error.

## Writes

```
nexus -p dev vault mkdir "<name>" [--parent <id>] [--tag t ...]
nexus -p dev vault mknote "<name>" [--parent <id>] [--tag t ...]
nexus -p dev vault note set <id> --md file.md | --stdin   [--force]
nexus -p dev vault note append <id> --md file.md | --stdin
nexus -p dev vault rm <id> --yes
nexus -p me  pf task add "<title>" [--parent id] [--plan id] [--due YYYY-MM-DD] [--priority p]
nexus -p me  pf task done <id> | undone <id>
nexus -p me  pf task stage <id> <refine|schedule|active|done>   # gate error is verbatim
nexus -p me  pf task status <id> <kanban>
nexus -p me  pf task patch <id> --set key=value ...             # not stage/done
nexus -p me  pf task rm <id> --yes
```

Note writes emit only paragraph/heading/lists/codeBlock/text/hardBreak and
bold/italic/code/link; other Markdown is flattened with a stderr warning. They
refuse shared notes (`team_id` set), legacy HTML without `--force`, and abort if
`updated_at` moved during the write. PathFinder writes go through
`createPathfinderApi` — never raw SQL; `setStage` holds the scheduling gate.

## --json shapes

- `vault tree` → `{profile, user_id, depth, roots:[{id,name,kind,tags,depth,repeat?,children?}]}`
- `vault node` → `{profile, node:{id,name,kind,tags,team_id,user_id,parents:[{id,name}],children:[{id,name,kind}]}}`
- `vault note` → `{profile, id, name, kind, team_id, shape:"json"|"html"|"empty", enveloped, updated_at, updated_by, markdown, doc?}`
- `vault search` → `{profile, query, count, results:[{id,name,kind,tags,team_id,parents:[name]}]}`
- `vault mkdir|mknote` → `{profile, created:{id,name,kind,tags,parent}}`; `note set|append` → `{profile,id,name,updated_at,warnings,blocks}`
- `pf brief` → the RPC JSON: `{generated_at,user_id,counts,goals,active,due_soon,plans,systems}`
- `pf tasks` → `{profile, capped, count, tasks:[PfTask]}`; `--tree` → `{profile,root,depth,nodes,leaves,open_leaves,done_leaves,containers,truncated_at,tree}`
- `pf task <write>` → `{profile, task:PfTask}`; `pf task rm` → `{profile, deleted, title}`
