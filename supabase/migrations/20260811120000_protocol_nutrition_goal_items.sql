-- Richer nutrition goals: one row per nutrient, each with an optional min and/or
-- max, so a goal can be "at least" (min only), "at most" (max only), or a range
-- (both — e.g. 2000–2800 kcal). Replaces the old wide single-row
-- protocol_nutrition_goals (12 fixed target columns), which stays in place as
-- dead data. Owner-only RLS, mirroring the rest of protocol_*.
create table if not exists public.protocol_nutrition_goal_items (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  nutrient_key text not null,
  min_value numeric,
  max_value numeric,
  created_at timestamptz not null default now(),
  unique (user_id, nutrient_key)
);

alter table public.protocol_nutrition_goal_items enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'protocol_nutrition_goal_items'
      and policyname = 'owner_all'
  ) then
    create policy owner_all on public.protocol_nutrition_goal_items
      for all
      using (user_id = ((select auth.uid()))::text)
      with check (user_id = ((select auth.uid()))::text);
  end if;
end $$;

-- Backfill the old wide-row targets as "at least" (min) goals — the only
-- meaningful legacy value in this DB is a protein target. Zeros are treated as
-- unset. Anything the user wants as a cap they can add a max to afterwards.
insert into public.protocol_nutrition_goal_items (user_id, nutrient_key, min_value)
select user_id, key, val
from public.protocol_nutrition_goals g
cross join lateral (values
  ('calories', g.calories), ('protein_g', g.protein_g), ('carbs_g', g.carbs_g),
  ('fat_g', g.fat_g), ('fiber_g', g.fiber_g), ('sugar_g', g.sugar_g),
  ('sodium_mg', g.sodium_mg), ('potassium_mg', g.potassium_mg),
  ('calcium_mg', g.calcium_mg), ('iron_mg', g.iron_mg),
  ('vitamin_c_mg', g.vitamin_c_mg), ('vitamin_d_mcg', g.vitamin_d_mcg)
) as cols(key, val)
where val is not null and val > 0
on conflict (user_id, nutrient_key) do nothing;
