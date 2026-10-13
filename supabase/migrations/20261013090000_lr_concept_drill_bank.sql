-- Claude-authored drills per concept, generated once by the primer-drills
-- edge function and cached forever. Exists because the deterministic synth
-- cards ("Hvilket begreb beskrives her?") have a hard quality ceiling: they
-- can only rearrange the book's description text. lr_* convention: anon_all.
create table if not exists lr_concept_drill_bank (
  id bigint generated always as identity primary key,
  concept_id text not null,
  drill jsonb not null,
  model text,
  created_at timestamptz not null default now()
);
create index if not exists lr_concept_drill_bank_concept_idx
  on lr_concept_drill_bank (concept_id);
alter table lr_concept_drill_bank enable row level security;
do $$ begin
  create policy anon_all on lr_concept_drill_bank
    for all using (true) with check (true);
exception when duplicate_object then null; end $$;
