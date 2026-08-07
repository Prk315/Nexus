-- Protocol: deepen the Danish reference table (Frida/FCDB) — add the full
-- nutrient columns so searchFridaDK can surface micros, amino acids and fatty
-- acids, not just the 12 headline nutrients. Data is loaded from FCDB 6.1
-- (Frida) separately; this only adds the columns. Mirrors lib/nutrients.ts keys
-- for the subset Frida provides.
DO $$
DECLARE
  cols text := '
    added_sugar_g, sugar_alcohol_g,
    saturated_fat_g, monounsaturated_fat_g, polyunsaturated_fat_g, trans_fat_g,
    omega3_mg, omega6_mg, epa_mg, dha_mg, ala_mg, cholesterol_mg,
    water_ml, alcohol_g, caffeine_mg,
    magnesium_mg, phosphorus_mg, zinc_mg, copper_mg, manganese_mg, selenium_mcg,
    iodine_mcg, chloride_mg, chromium_mcg, molybdenum_mcg, boron_mg, fluoride_mcg,
    vitamin_a_mcg, thiamin_mg, riboflavin_mg, niacin_mg, pantothenic_acid_mg,
    vitamin_b6_mg, biotin_mcg, folate_mcg, vitamin_b12_mcg, vitamin_e_mg, vitamin_k_mcg, choline_mg,
    histidine_g, isoleucine_g, leucine_g, lysine_g, methionine_g, phenylalanine_g,
    threonine_g, tryptophan_g, valine_g, cystine_g, tyrosine_g, arginine_g, glycine_g, taurine_g';
  col text;
BEGIN
  FOREACH col IN ARRAY string_to_array(regexp_replace(cols, '\s', '', 'g'), ',') LOOP
    EXECUTE format('ALTER TABLE protocol_foods_dk ADD COLUMN IF NOT EXISTS %I numeric', col);
  END LOOP;
END $$;
