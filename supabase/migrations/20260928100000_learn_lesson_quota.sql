-- The authored-lesson cadence becomes an explicit WEEKLY QUOTA (default 3),
-- replacing the phase heuristic for the lesson block: the target is a floor —
-- finishing early moves ahead in the curriculum, it never caps the week.
alter table lr_learn_settings add column if not exists lessons_per_week integer not null default 3;
