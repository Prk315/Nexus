-- Multiple named supplement stacks per user. Until now every supplement lived
-- in one implicit stack; this makes stacks first-class (CRUD + drag-and-drop of
-- supplements between them). Stacks are owner-only, mirroring protocol_supplements.
create table if not exists public.protocol_supplement_stacks (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  name text not null default 'My Stack',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.protocol_supplement_stacks enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'protocol_supplement_stacks'
      and policyname = 'owner_all'
  ) then
    create policy owner_all on public.protocol_supplement_stacks
      for all
      using (user_id = ((select auth.uid()))::text)
      with check (user_id = ((select auth.uid()))::text);
  end if;
end $$;

-- Which stack a supplement belongs to. Nullable + ON DELETE SET NULL so deleting
-- a stack never cascades away supplements or their historical logs; the app
-- reassigns a stack's supplements to another stack before deleting it.
alter table public.protocol_supplements
  add column if not exists stack_id uuid references public.protocol_supplement_stacks(id) on delete set null;

create index if not exists protocol_supplements_stack_id_idx
  on public.protocol_supplements (stack_id);

-- Backfill: every user who already has supplements gets one "My Stack", and all
-- their existing supplements (archived or not) are placed in it.
insert into public.protocol_supplement_stacks (user_id, name, sort_order)
select distinct s.user_id, 'My Stack', 0
from public.protocol_supplements s
where s.user_id is not null
  and not exists (
    select 1 from public.protocol_supplement_stacks st where st.user_id = s.user_id
  );

update public.protocol_supplements p
set stack_id = (
  select st.id from public.protocol_supplement_stacks st
  where st.user_id = p.user_id
  order by st.sort_order, st.created_at
  limit 1
)
where p.stack_id is null and p.user_id is not null;
