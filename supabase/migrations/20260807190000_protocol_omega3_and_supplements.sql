-- Protocol: add omega-3 fatty acids (EPA/DHA/ALA + omega-3/6 totals) and two
-- common supplements (L-Theanine, Creatine) to the loggable nutrient set.
ALTER TABLE protocol_foods
  ADD COLUMN IF NOT EXISTS omega3_mg double precision,
  ADD COLUMN IF NOT EXISTS epa_mg double precision,
  ADD COLUMN IF NOT EXISTS dha_mg double precision,
  ADD COLUMN IF NOT EXISTS ala_mg double precision,
  ADD COLUMN IF NOT EXISTS omega6_mg double precision,
  ADD COLUMN IF NOT EXISTS l_theanine_mg double precision,
  ADD COLUMN IF NOT EXISTS creatine_g double precision;
ALTER TABLE protocol_supplements
  ADD COLUMN IF NOT EXISTS omega3_mg double precision,
  ADD COLUMN IF NOT EXISTS epa_mg double precision,
  ADD COLUMN IF NOT EXISTS dha_mg double precision,
  ADD COLUMN IF NOT EXISTS ala_mg double precision,
  ADD COLUMN IF NOT EXISTS omega6_mg double precision,
  ADD COLUMN IF NOT EXISTS l_theanine_mg double precision,
  ADD COLUMN IF NOT EXISTS creatine_g double precision;
