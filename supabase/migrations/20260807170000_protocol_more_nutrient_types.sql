-- Protocol: expand the nutrient set on foods + supplements with the extra types
-- seeded in nut_nutrient_types — more minerals (incl. magnesium forms), the
-- B-vitamins, hydration/other, and supplement + medication compounds. All
-- nullable double precision, mirroring lib/nutrients.ts NUTRIENT_KEYS. Adding a
-- column here + an entry in nutrients.ts is all it takes to surface a nutrient in
-- the food/supplement editors and the daily breakdown.

DO $$
DECLARE
  tbl text;
  cols text := '
    water_ml, alcohol_g, caffeine_mg,
    phosphorus_mg, copper_mg, manganese_mg, selenium_mcg, iodine_mcg,
    chloride_mg, chromium_mcg, molybdenum_mcg,
    magnesium_l_threonate_mg, magnesium_glycinate_mg, magnesium_citrate_mg,
    vitamin_b6_mg, thiamin_mg, riboflavin_mg, niacin_mg, pantothenic_acid_mg, biotin_mcg,
    apigenin_mg, rhodiola_rosea_mg, ashwagandha_mg,
    methylphenidate_mg';
  col text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['protocol_foods', 'protocol_supplements'] LOOP
    FOREACH col IN ARRAY string_to_array(regexp_replace(cols, '\s', '', 'g'), ',') LOOP
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I double precision', tbl, col);
    END LOOP;
  END LOOP;
END $$;
