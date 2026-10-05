-- Roadmap: a lesson that is decided but not yet authored is PLANNED — a
-- fourth state, distinct from paused (was active, set aside) and done.
-- learn-plan's rotation and learn-daily's read-gate both filter on
-- status='active'/'any', so planned rows are inert until flipped.
alter table lr_materials drop constraint if exists lr_materials_status_check;
alter table lr_materials add constraint lr_materials_status_check
  check (status = any (array['active'::text, 'paused'::text, 'done'::text, 'planned'::text]));
