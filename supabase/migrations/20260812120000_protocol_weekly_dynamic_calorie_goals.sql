-- Dynamic weekly calorie/nutrition goals.
--
-- 1) Calorie strategy lives on protocol_activity_goals: a base burn (BMR), a
--    signed daily bulk/cut offset, and a ± tolerance band. The dashboard builds
--    each day's maintenance as base + Oura active calories, adds the offset, and
--    scores the week's intake against staying within tolerance of that target.
alter table public.protocol_activity_goals
  add column if not exists base_bmr numeric default 1800,
  add column if not exists calorie_offset numeric default 0,
  add column if not exists calorie_tolerance numeric default 200;

-- 2) Nutrition goals move from a daily to a WEEKLY basis. Existing per-nutrient
--    goals were entered as daily targets, so scale them ×7 (protein 150/day →
--    1050/week). One-shot data migration.
update public.protocol_nutrition_goal_items
  set min_value = case when min_value is not null then min_value * 7 else null end,
      max_value = case when max_value is not null then max_value * 7 else null end;

-- 3) Calories is now a dynamic target (base + active ± offset), not a fixed
--    goal item — drop any stored calorie goal so the two models don't collide.
delete from public.protocol_nutrition_goal_items where nutrient_key = 'calories';
