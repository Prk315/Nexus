-- Dojo bridge: the code-practice repo (Prk315/code-practice, VS Code dojo)
-- publishes its state here so Nexus Learn can VISUALIZE it. One-way by
-- design: the dojo writes (tools/report.mjs after every check.sh run and
-- after /review), the app only reads. No coupling to lr_* paths.
--
-- RLS matches the lr_* anon_all posture: data is non-sensitive (project
-- slugs, pass/fail, verdict labels), keyed user_id default 'default'.

create table if not exists dojo_projects (
  user_id    text not null default 'default',
  project    text not null,                      -- folder slug, e.g. '01-runlog'
  title      text,
  archetype  int,
  track      text,
  level      text,
  status     text not null default 'started',    -- started | green | reviewed
  concepts   jsonb,                              -- {mastered:[], stretch:[]} from project.json
  review     jsonb,                              -- verdict map after /review
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, project)
);

create table if not exists dojo_runs (
  id      bigint generated always as identity primary key,
  user_id text not null default 'default',
  project text not null,
  passed  boolean not null,
  at      timestamptz not null default now()
);

create index if not exists dojo_runs_user_at_idx on dojo_runs (user_id, at desc);

alter table dojo_projects enable row level security;
alter table dojo_runs enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dojo_projects' and policyname = 'anon_all') then
    create policy anon_all on dojo_projects for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dojo_runs' and policyname = 'anon_all') then
    create policy anon_all on dojo_runs for all using (true) with check (true);
  end if;
end $$;
