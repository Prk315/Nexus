-- Food-quality tiers in the Meal Planner. A food card is coloured by how well
-- its nutrition data is covered:
--   • white  — a normal log (USDA / Open Food Facts / manual)
--   • silver — pulled from Frida (source = 'frida'), a richer Danish dataset
--   • gold   — this flag: a food someone curated to be even more detailed than
--              Frida. Manual, owner-toggled, and — because protocol_foods is a
--              SHARED read-all/write-own library — visible to everyone.
--
-- Defaults false so every existing row stays white/silver by its source.
alter table public.protocol_foods
  add column if not exists detailed boolean not null default false;
