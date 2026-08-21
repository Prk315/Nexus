-- Drop pf_reminders, take two — this time after the deploy.
--
-- 20260821120000 dropped it while main still queried it and took the deployed
-- dashboard down; 20260821130000 restored it. The ordering rule recorded in
-- CLAUDE.md is: stop reading it -> merge -> deploy -> THEN drop.
--
-- All three prerequisites were met before applying this: the code that stopped
-- reading it merged as 30508bd, Vercel redeployed, and the live bundle was
-- fetched and grepped directly — zero occurrences of "pf_reminders", with
-- pf_task_planning / pf_task_sessions / aggregate_estimate present to prove it
-- was the new build rather than an empty download. Absence alone is not evidence.
--
-- The row-count guard stays. It is cheap, and it is why this is safe to re-run.

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
