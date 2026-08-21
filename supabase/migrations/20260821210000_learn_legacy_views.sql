-- LearnAndRetain legacy-name bridge views. The retired LearnAndRetain
-- project (vfxrxlhwdymdktfzzqqp) used un-prefixed table names; its
-- generated web viewers (dag_forcegraph3d.html etc.) query those names
-- live from the browser. These pass-through views let that UI read the
-- REAL lr_* data in NEXUS after a URL/key swap — zero client changes.
-- security_invoker so base-table RLS applies (CLAUDE.md rule); base
-- tables are anon_all today, but the views must not become a bypass if
-- that ever tightens. attempt_log aliases item_ref -> item_id (the one
-- column the port renamed). Writes: plain single-table views are
-- auto-updatable, but PostgREST upserts (onConflict) FAIL on views —
-- the legacy UI is a read-only window; real learning happens in
-- NexusLocal.
DO $$
DECLARE pair text[];
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['concept','lr_concept'], ['concept_prereq','lr_concept_prereq'],
    ['topic','lr_topic'], ['course','lr_course'],
    ['unit','lr_unit'], ['unit_concept','lr_unit_concept'],
    ['unit_progress','lr_unit_progress'], ['memory_state','lr_memory_state'],
    ['item','lr_item'], ['written_item','lr_written_item'],
    ['mcq_option','lr_mcq_option'], ['qmatrix','lr_qmatrix']
  ] LOOP
    EXECUTE format(
      'CREATE OR REPLACE VIEW %I WITH (security_invoker = on) AS SELECT * FROM %I',
      pair[1], pair[2]);
    EXECUTE format('GRANT SELECT ON %I TO anon, authenticated', pair[1]);
  END LOOP;
END $$;

CREATE OR REPLACE VIEW attempt_log WITH (security_invoker = on) AS
  SELECT a_id, user_id, item_ref AS item_id, lens, grade, at FROM lr_attempt_log;
GRANT SELECT ON attempt_log TO anon, authenticated;

CREATE OR REPLACE VIEW retained_concept WITH (security_invoker = on) AS
  SELECT * FROM lr_retained_concept;
GRANT SELECT ON retained_concept TO anon, authenticated;
