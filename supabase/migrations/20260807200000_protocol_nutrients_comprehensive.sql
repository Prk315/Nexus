-- Protocol: broaden the nutrient set to "cover our bases" — amino acids (the 9
-- essentials + common conditional/supplemental ones), a sugar-alcohol carb sub,
-- boron/fluoride/choline, a wide supplement & nootropic palette, and a few common
-- OTC meds. Mirrors lib/nutrients.ts NUTRIENT_META; columns on both tables.
DO $$
DECLARE
  tbl text;
  cols text := '
    sugar_alcohol_g,
    histidine_g, isoleucine_g, leucine_g, lysine_g, methionine_g, phenylalanine_g,
    threonine_g, tryptophan_g, valine_g, cystine_g, tyrosine_g, arginine_g,
    glutamine_g, glycine_g, citrulline_g, taurine_g, beta_alanine_g, l_carnitine_g,
    boron_mg, fluoride_mcg, choline_mg,
    melatonin_mg, coq10_mg, curcumin_mg, resveratrol_mg, quercetin_mg, alpha_gpc_mg,
    lions_mane_mg, bacopa_mg, ginkgo_mg, ginseng_mg, five_htp_mg, gaba_mg, betaine_mg,
    nac_mg, glucosamine_mg, chondroitin_mg, msm_mg, collagen_g, spirulina_g,
    ibuprofen_mg, acetaminophen_mg, aspirin_mg';
  col text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['protocol_foods', 'protocol_supplements'] LOOP
    FOREACH col IN ARRAY string_to_array(regexp_replace(cols, '\s', '', 'g'), ',') LOOP
      EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I double precision', tbl, col);
    END LOOP;
  END LOOP;
END $$;
