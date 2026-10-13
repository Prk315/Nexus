-- Deliberate code practice (Codecademy-style, optional daily): authored
-- exercises per language, graded by hidden tests run client-side (Pyodide on
-- web / system toolchain via Tauri). lr_* convention: anon_all, user 'default'.
create table if not exists lr_code_exercises (
  id bigint generated always as identity primary key,
  slug text not null unique,
  language text not null check (language in ('python','c')),
  course_key text,
  title text not null,
  difficulty int not null default 1,
  spec jsonb not null,
  status text not null default 'live',
  created_at timestamptz not null default now()
);
create table if not exists lr_code_attempts (
  id bigint generated always as identity primary key,
  user_id text not null default 'default',
  exercise_slug text not null,
  passed boolean not null,
  code text,
  at timestamptz not null default now()
);
create index if not exists lr_code_attempts_user_idx on lr_code_attempts (user_id, exercise_slug);
alter table lr_code_exercises enable row level security;
alter table lr_code_attempts enable row level security;
do $$ begin
  create policy anon_all on lr_code_exercises for all using (true) with check (true);
exception when duplicate_object then null; end $$;
do $$ begin
  create policy anon_all on lr_code_attempts for all using (true) with check (true);
exception when duplicate_object then null; end $$;
