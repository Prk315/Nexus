-- Foreground usage: which apps and which sites, as measured by the Nexus Local
-- daemon (`usage_tracker.rs`) and the Chrome extension.
--
-- # Why this table's RLS looks nothing like its neighbours
--
-- Every other table in this project carries a permissive `USING (true)` anon
-- policy and keys rows by `user_id = 'default'`. That is tolerable for a block
-- list. It is NOT tolerable here: this table holds full URLs and page titles,
-- the repo is public, and the anon key is committed in
-- `apps/NexusLocal/src-tauri/src/config.rs` — so a permissive policy would make
-- every page the user visits world-readable to anyone who clones the repo.
--
-- So there is deliberately **no anon policy at all**. Reads require a real
-- session (`auth.uid()`), which the web apps already have via `useNexusAuth`.
--
-- # How writes get in
--
-- The daemon has no session — it authenticates with nothing but the anon key —
-- so it cannot satisfy `auth.uid()`. Rather than build a refresh-token flow into
-- the Rust node, writes go through the `usage-ingest` edge function, which holds
-- a scoped secret and a service-role client and stamps the owner id server-side.
-- This is the same shape as `habit-toggle` / `session-toggle`, which exist for
-- exactly this reason on the widget side.

create table if not exists usage_intervals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- Which machine reported it. Same value as `nexus_local_nodes.device_id`, so
  -- usage can be attributed per-machine once there is more than one node.
  device_id   text not null,
  kind        text not null check (kind in ('app', 'web')),
  app_name    text,          -- kind = 'app'
  host        text,          -- kind = 'web'
  url         text,          -- kind = 'web'
  title       text,          -- kind = 'web'
  started_at  timestamptz not null,
  ended_at    timestamptz not null,
  seconds     integer not null check (seconds >= 0),
  -- The LOCAL calendar day (Europe/Copenhagen), computed by the writer, not
  -- derived here. A `date(started_at)` expression would bucket by UTC midnight
  -- and split every evening across two days.
  local_date  date not null,
  -- Idempotency. The extension delivers at-least-once and the daemon retries a
  -- failed batch, so the same interval WILL arrive more than once. Composed by
  -- the ingest function as `<kind>|<started_at>|<url or app_name>`.
  dedupe_key  text not null,
  created_at  timestamptz not null default now()
);

-- The natural key. Named columns rather than an expression index so PostgREST's
-- `on_conflict` can reference it directly from the edge function.
create unique index if not exists usage_intervals_dedupe
  on usage_intervals (user_id, device_id, dedupe_key);

-- The two read patterns the consuming apps will actually use: "my day" and
-- "this app/host over time".
create index if not exists usage_intervals_user_day
  on usage_intervals (user_id, local_date desc);
create index if not exists usage_intervals_user_host
  on usage_intervals (user_id, host) where host is not null;
create index if not exists usage_intervals_user_app
  on usage_intervals (user_id, app_name) where app_name is not null;

alter table usage_intervals enable row level security;

-- Owner-only. Note there is no `to anon` policy anywhere in this file, and that
-- omission is the entire security model — do not add one "for consistency" with
-- the older tables.
drop policy if exists usage_intervals_owner on usage_intervals;
create policy usage_intervals_owner on usage_intervals
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Pre-rolled daily totals, so a dashboard in PathFinder or Protocol does not
-- pull a day of raw intervals just to sum them.
--
-- `security_invoker = on` matters: without it the view would run as its owner
-- and quietly bypass the RLS above, handing every caller everyone's rows.
create or replace view usage_daily_totals
  with (security_invoker = on)
as
  select
    user_id,
    local_date,
    kind,
    coalesce(host, app_name) as label,
    sum(seconds)::bigint     as seconds,
    count(*)::bigint         as intervals
  from usage_intervals
  group by user_id, local_date, kind, coalesce(host, app_name);

comment on table usage_intervals is
  'Foreground app/site time from the Nexus Local daemon. Owner-scoped RLS with no anon access: this holds URLs and page titles, unlike the permissive legacy tables. Written only by the usage-ingest edge function.';
