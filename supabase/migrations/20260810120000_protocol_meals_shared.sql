-- Share saved meals across users, mirroring protocol_foods:
-- everyone can read every meal (and its items) so any user can see and log a
-- meal another user created, but only the owner can edit or delete it.

-- ── protocol_meals: shared read, write-own ──────────────────────────────────
alter table protocol_meals enable row level security;

drop policy if exists owner_all on protocol_meals;
drop policy if exists meals_shared_read on protocol_meals;
drop policy if exists meals_insert_own on protocol_meals;
drop policy if exists meals_update_own on protocol_meals;
drop policy if exists meals_delete_own on protocol_meals;

create policy meals_shared_read on protocol_meals
  for select using (true);
create policy meals_insert_own on protocol_meals
  for insert with check (user_id = (select auth.uid())::text);
create policy meals_update_own on protocol_meals
  for update using (user_id = (select auth.uid())::text)
             with check (user_id = (select auth.uid())::text);
create policy meals_delete_own on protocol_meals
  for delete using (user_id = (select auth.uid())::text);

-- ── protocol_meal_items: shared read, write only on meals you own ────────────
-- Replaces the old blanket authenticated_all (which let anyone edit anyone's
-- meal items). Reads are open so shared meals resolve their ingredients/macros;
-- writes are gated on ownership of the parent meal.
alter table protocol_meal_items enable row level security;

drop policy if exists authenticated_all on protocol_meal_items;
drop policy if exists meal_items_shared_read on protocol_meal_items;
drop policy if exists meal_items_write_own on protocol_meal_items;

create policy meal_items_shared_read on protocol_meal_items
  for select using (true);
create policy meal_items_write_own on protocol_meal_items
  for all
  using (exists (
    select 1 from protocol_meals m
    where m.id = protocol_meal_items.meal_id
      and m.user_id = (select auth.uid())::text))
  with check (exists (
    select 1 from protocol_meals m
    where m.id = protocol_meal_items.meal_id
      and m.user_id = (select auth.uid())::text));
