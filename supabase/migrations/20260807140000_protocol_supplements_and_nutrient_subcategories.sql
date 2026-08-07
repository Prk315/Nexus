-- Protocol: expand the nutrient model and add the supplement stack.
--
-- 1. protocol_foods gains macro sub-categories (added sugar, the four fat types,
--    cholesterol) and more minerals/vitamins, so a normal ingredient can be
--    specified in full. All nullable — a blank field means "not specified".
-- 2. protocol_supplements + protocol_supplement_logs mirror the habits model:
--    a personal list of supplements, each toggled "taken" per day. Supplement
--    nutrient values are ABSOLUTE per dose (not per 100g).

-- ── 1. Food nutrient sub-categories ─────────────────────────────────────────
ALTER TABLE protocol_foods
  ADD COLUMN IF NOT EXISTS added_sugar_g            double precision,
  ADD COLUMN IF NOT EXISTS saturated_fat_g          double precision,
  ADD COLUMN IF NOT EXISTS monounsaturated_fat_g    double precision,
  ADD COLUMN IF NOT EXISTS polyunsaturated_fat_g    double precision,
  ADD COLUMN IF NOT EXISTS trans_fat_g              double precision,
  ADD COLUMN IF NOT EXISTS cholesterol_mg           double precision,
  ADD COLUMN IF NOT EXISTS magnesium_mg             double precision,
  ADD COLUMN IF NOT EXISTS zinc_mg                  double precision,
  ADD COLUMN IF NOT EXISTS vitamin_a_mcg            double precision,
  ADD COLUMN IF NOT EXISTS vitamin_e_mg             double precision,
  ADD COLUMN IF NOT EXISTS vitamin_k_mcg            double precision,
  ADD COLUMN IF NOT EXISTS vitamin_b12_mcg          double precision,
  ADD COLUMN IF NOT EXISTS folate_mcg               double precision;

-- ── 2. Supplements ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS protocol_supplements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     text NOT NULL,
  name        text NOT NULL,
  brand       text,
  dose        text,
  sort_order  integer NOT NULL DEFAULT 0,
  archived    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Nutrient block (absolute per dose). Mirrors lib/nutrients.ts NUTRIENT_KEYS.
  calories                double precision,
  protein_g               double precision,
  carbs_g                 double precision,
  fiber_g                 double precision,
  sugar_g                 double precision,
  added_sugar_g           double precision,
  fat_g                   double precision,
  saturated_fat_g         double precision,
  monounsaturated_fat_g   double precision,
  polyunsaturated_fat_g   double precision,
  trans_fat_g             double precision,
  cholesterol_mg          double precision,
  sodium_mg               double precision,
  potassium_mg            double precision,
  calcium_mg              double precision,
  iron_mg                 double precision,
  magnesium_mg            double precision,
  zinc_mg                 double precision,
  vitamin_a_mcg           double precision,
  vitamin_c_mg            double precision,
  vitamin_d_mcg           double precision,
  vitamin_e_mg            double precision,
  vitamin_k_mcg           double precision,
  vitamin_b12_mcg         double precision,
  folate_mcg              double precision
);

ALTER TABLE protocol_supplements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON protocol_supplements;
CREATE POLICY owner_all ON protocol_supplements
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

CREATE TABLE IF NOT EXISTS protocol_supplement_logs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        text NOT NULL,
  supplement_id  uuid NOT NULL REFERENCES protocol_supplements(id) ON DELETE CASCADE,
  date           date NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplement_id, date)
);

CREATE INDEX IF NOT EXISTS protocol_supplement_logs_user_date_idx
  ON protocol_supplement_logs (user_id, date);

ALTER TABLE protocol_supplement_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_all ON protocol_supplement_logs;
CREATE POLICY owner_all ON protocol_supplement_logs
  FOR ALL TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);
