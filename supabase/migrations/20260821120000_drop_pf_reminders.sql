-- Drop `pf_reminders`.
--
-- It was PathFinder's original reminder store, and it holds zero rows. Every
-- reminder the user actually has is a quick task — `pf_tasks` with
-- `category = 'reminder'`, captured from Nexus Local on the phone. Two tables
-- meaning "reminder" was how the dashboard's Reminders icon ended up pointing at
-- an empty table while the real reminders sat in the task list.
--
-- All readers are gone as of this migration: PathFinder's `getReminders` /
-- `addReminder` / `toggleReminder` / `deleteReminder`, the `pf_reminders` query
-- inside `getWeekItems`, the Week view's reminders row and side-panel section,
-- the `Reminder` type, and the node in Nexus's schema graph.
--
-- DESTRUCTIVE and forward-only: there is no down migration. The guard below is
-- the safety net — if the table has somehow regained rows since this was
-- written, the migration aborts rather than deleting data. Clear them
-- deliberately first if that ever happens.

do $$
declare
  n bigint;
begin
  if to_regclass('public.pf_reminders') is null then
    raise notice 'pf_reminders already absent — nothing to do';
    return;
  end if;

  execute 'select count(*) from public.pf_reminders' into n;
  if n > 0 then
    raise exception
      'refusing to drop pf_reminders: % row(s) present. Migrate or delete them first.', n;
  end if;

  drop table public.pf_reminders;
  raise notice 'pf_reminders dropped (was empty)';
end $$;
