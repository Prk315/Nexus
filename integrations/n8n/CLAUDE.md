# CLAUDE.md — Mail triage (n8n)

Loaded automatically when working under this directory. Cross-cutting rules
(Supabase removal ordering, RLS posture, iOS deployment, environment gotchas)
live in the root `CLAUDE.md`.

## Mail triage: n8n on the Mac, Supabase as the bus

`NexusHeader`'s mail panel shows a priority-sorted inbox with a suggested reply per
message. **The header never talks to n8n**, and it is worth being precise about why,
because "just point the panel at the workflow" is the first thing anyone tries.

Vault, PathFinder and Protocol are HTTPS pages served by Vercel. An HTTPS page cannot
fetch `http://localhost:5678` — the browser blocks it as mixed content, and no CORS
header fixes that. The iPad PWA and the iPhone are not even on the same host, so for
them `localhost` is the phone. There is no configuration of n8n that makes a Vercel
page reach it.

So the same shape as everything else here: the machine that *can* do the work does it
on a schedule and writes the result to Postgres; every client just reads.

```
Gmail --> n8n (Mac, Docker) --> local Qwen (Ollama) --> n8n-ingest --> Supabase
                                                                          |
                        NexusHeader / MailPanel <------ reads ------------+
```

This is `focus-evaluate` → `blocking_state` and `learn-evaluate` → `lr_learn_state`
with a different producer. If that framing is familiar, the rest of this section is
mostly bookkeeping.

The pieces:

| Piece | Where | Does |
|---|---|---|
| `mail-triage` | `integrations/n8n/workflows/` | Gmail trigger → persist untriaged → classify → POST verdicts |
| `mail-drain` | `integrations/n8n/workflows/` | every 5 min: classify anything still untriaged |
| `mail-heartbeat` | `integrations/n8n/workflows/` | every 15 min: calls Gmail, records "we looked" |
| `n8n-ingest` | `supabase/functions/n8n-ingest/` | n8n → `mail_messages` (upsert on `user_id,external_id`), applies `mail_rules`, and answers `{"action":"pending"}` with the untriaged ids |
| `n8n-requests` | `supabase/functions/n8n-requests/` | n8n claims/completes rows in `n8n_requests` |
| `mail_messages`, `mail_rules`, `mail_categories`, `n8n_requests` | `supabase/migrations/20260823120000_n8n_mail_bus.sql` | the bus |

The workflows live **in this repo**, not in `~/docker/n8n`. That directory is a
separate, unrelated local repo holding older experiments; nothing here reads it.

### The queue: fetch and classify are separate

`mail-triage` persists every fetched message **before** the model sees it, with no
verdict, on a branch that runs in parallel with classification. Classification used to
happen first, so a slow Ollama or a lid closing mid-batch lost the whole batch —
irrecoverably, because the Gmail trigger's watermark had already moved past it.

**`score IS NULL` is the queue**, and that is not a new state: it is what the column has
always meant, and `MailPanel` already sorts those rows to the top under their own
`untriaged` bucket. `mail-drain` empties it on a schedule, re-fetching each body **from
Gmail by id** — bodies are never stored, which is the whole reason the model is local.

A failed classification leaves the row untriaged for the next pass. Nothing is marked
done that was not done; the cost is that a permanently unparseable message retries
forever, visible as a row that never leaves the top of the panel.

`n8n_requests` is the other direction: the UI cannot reach n8n either, so an action
("sync now", "send this reply", "archive") is a **row n8n polls for**, not a webhook.
That is deliberate — a webhook to a laptop that is asleep is a lost request; a queued
row survives until the Mac is back. Single worker, so a `claimed_at` with no
`finished_at` and no lease column is enough; a row stuck in `claimed` past the longest
plausible workflow is stranded work and needs re-queueing.

### The rule: edge functions for what must happen, n8n for what is nice to happen

n8n runs in Docker on this Mac and stops when the Mac sleeps — precisely the failure
mode the whole NexusLocal design exists to route around (a schedule window opening or
a reward unlocking while every device is asleep is why `focus-evaluate` lives on
pg_cron and not in a `setInterval`). **Nothing load-bearing may hang off n8n.**
Blocking policy, health imports, learn state: pg_cron + edge function. Mail triage,
scraping, "ping me when a flat is listed": n8n, and the system degrades to "stale" not
"broken" when it is down.

If you find yourself moving something into n8n because the workflow editor is more
pleasant, ask what happens to it overnight. That question is the rule.

### Why a local Qwen, and what it costs

Mail bodies never leave the Mac. Triage is Ollama on `localhost`, not a hosted model.
This is the same posture as `usage_intervals`, which has no anon policy at all
precisely because it holds URLs and page titles — mail is strictly more sensitive than
browsing history, and shipping it to a third party to be scored 0–100 is not a trade
worth making for a header panel.

The accepted cost, stated plainly so nobody "fixes" it: **nothing is triaged
overnight.** Mail that arrives while the Mac sleeps sits un-triaged until it wakes.
`mail_messages.score` / `triaged_at` are nullable for exactly this reason, and the
panel sorts `score desc nulls first` so un-triaged mail lands at the *top* of a
triage list rather than being buried at the bottom where `default 0` would put it.

⚠️ **The column is `score`, not `priority`.** It was renamed because
`pf_tasks.priority` means *importance* on a `high|medium|low` domain, so a 0–100
`priority` in the same database would be the same word with the opposite meaning. One
`.order("priority")` survived that rename in the panel's loader and took the whole
feature down: PostgREST rejects an unknown column outright (`42703`), so the query
threw, and the panel showed "Mail is unavailable" with correctly triaged mail sitting
in the table. A column name inside a string is invisible to `tsc` — `MAIL_COLUMNS` is
a pinned constant for this reason, and `loader.test.ts` now pins the query shape too.

### Traps

- **Inside the container, `localhost` is the container.** An HTTP node pointing at
  `http://localhost:11434` reaches n8n's own loopback, not the Mac's. Use
  `http://host.docker.internal:11434`.
- **`OLLAMA_HOST=0.0.0.0` is NOT needed on this machine**, and this entry used to say
  it was. Measured: Ollama listening on `127.0.0.1:11434` only, `OLLAMA_HOST` unset,
  and the container reaching it through `host.docker.internal` regardless — Docker
  Desktop for macOS proxies that name through its own network stack, so the connection
  originates on the host side and arrives on loopback like any other local client. The
  advice is correct for **Docker on Linux**, where the container arrives over a bridge
  IP and a loopback-bound service genuinely is unreachable. Following it here buys
  nothing and publishes an unauthenticated model server to the LAN, which sits badly
  with a design whose entire justification is that mail bodies never leave the machine.
- **`mail_messages` / `n8n_requests` are `auth.uid()`-scoped with no anon policy** —
  unlike the 13 permissive productivity tables (see `SECURITY_RLS_MIGRATION.md`; they
  are a defect being migrated away from, not a convention to copy). Read them with the
  **authenticated** client `supabase`, never `supabasePublic`. Getting this backwards
  returns an **empty set, not an error** — an empty mail panel, indistinguishable from
  a clean inbox. It is the same trap as the conventions list above, with the polarity
  reversed: those tables need the anon client, these need the JWT.
- **Row count is not a freshness signal.** Zero rows in `mail_messages` means "the
  inbox is clean" *or* "n8n has never run", and a panel rendering both as "Inbox
  zero ✓" is lying half the time — the `blocking_state`-seeding mistake wearing a
  different hat. Last-synced comes from the newest `n8n_requests` row with
  `kind = 'mail_sync'` and `status = 'done'`; no such row means *unknown*, and the UI
  must say so.
- **n8n 2.x rejects workflow JSON that 1.x accepted.** Import fails on a missing
  top-level `id`, and on `tags` given as plain strings — 2.x wants tag *objects*. The
  error is unhelpful; check those two before debugging the nodes.
- **The migration is not applied by the code that writes it, and there is no staging
  database.** Both edge functions 500 against a project where the tables do not
  exist, and a deploy does not create them. See `supabase/migrations/APPLY.md`.

### Status, and the one thing with a clock on it

The pipeline is live and verified end to end: a real Gmail message triaged and written
to `mail_messages`, and a row reset to `score IS NULL` picked up by `mail-drain` within
four minutes and re-scored. Ollama 0.31.1 is installed with `qwen2.5:latest`; the Gmail
credential works; all three workflows are active.

⚠️ **The Google OAuth consent screen is still in *Testing*.** Google expires refresh
tokens for unpublished apps on a ~7-day cycle, so the Gmail credential will stop working
and the only symptom will be triage quietly ceasing. Fix once, permanently: Google Auth
Platform → **Audience** → **Publish app**.

### A workflow with `active = 1` is not necessarily running

n8n 2.x versions workflows. A workflow is only live when **`activeVersionId` is set**,
and `n8n import:workflow` clears it — so re-importing a running workflow silently
retires it, and setting `active = 1` by hand does not bring it back. Worse, an active
trigger runs that *published snapshot*, while a manual run uses the live nodes: wiring
credentials with a raw `UPDATE` creates no version, so the trigger keeps running a copy
where the credential id is still `null` and reports `uses invalid credential` while
manual execution works perfectly. Check n8n's startup log (`Currently active
workflows:`), never the `active` column. Full write-up in
`integrations/n8n/README.md`.

