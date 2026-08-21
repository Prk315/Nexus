-- Systems gain interval recurrence, so there is ONE recurrence engine.
--
-- `pf_task_chores.rotation_days` promised "comes back N days after I did it" and
-- had no engine behind it. Building that engine on tasks would have meant a
-- second recurrence mechanism next to pf_systems, which already has last_done,
-- streaks, day-of-week scheduling and a UI. Two engines drift; this augments the
-- one that exists instead.
--
-- The augmentation is a genuinely new *kind* of recurrence, not a re-mapping:
--
--   daily / weekly / monthly  — CALENDAR recurrence. "Every Monday." Due-ness is
--                               a function of today's date.
--   interval                  — INTERVAL-SINCE-COMPLETION. "Seven days after I
--                               last did it." Due-ness is a function of
--                               `last_done`, and the schedule floats: wash the
--                               clothes on Tuesday and the next one is the
--                               following Tuesday; do it Friday instead and it
--                               shifts with you.
--
-- That floating behaviour is exactly what a chore wants and what a calendar
-- frequency cannot express, which is why 'weekly' was not a substitute.
--
-- Additive: `frequency` has no CHECK constraint, and every existing row keeps
-- its calendar frequency with interval_days NULL. Deployed code that never
-- writes 'interval' is unaffected.

alter table public.pf_systems
  add column if not exists interval_days integer;

comment on column public.pf_systems.interval_days is
  'Days between completions when frequency = ''interval''. NULL for calendar frequencies. Due when last_done is null, or last_done + interval_days <= today.';

-- Guard the pairing rather than the value: an 'interval' system without a
-- positive interval_days would be due forever (or never), and both failure modes
-- are silent. Calendar frequencies must leave it NULL so the two kinds cannot be
-- half-configured into each other.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pf_systems_interval_days_check') then
    alter table public.pf_systems
      add constraint pf_systems_interval_days_check
      check (
        (frequency =  'interval' and interval_days is not null and interval_days > 0)
        or
        (frequency <> 'interval' and interval_days is null)
      );
  end if;
end $$;
