-- Fokus-uge for den komponerede læringsdag: learn-plan binder reading+lesson
-- til ét kursus mens focus_until ikke er passeret. NULL = ingen fokus.
alter table lr_learn_settings add column if not exists focus_course_id bigint;
alter table lr_learn_settings add column if not exists focus_until date;
