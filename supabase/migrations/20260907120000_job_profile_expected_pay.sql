-- 20260907120000_job_profile_expected_pay.sql
--
-- `job_profiles` gains an expected-pay range: monthly and hourly, DKK, both
-- optional. Not every profile has a rate worth stating — an hourly student job
-- and a salaried engineering role do not share a unit — so all four columns are
-- nullable and independent rather than one pair with an implied unit.
--
-- The point is not to gate anything. Nothing in the pipeline reads these to
-- decide whether to notify or send; a profile's threshold already does that
-- job. This is the READY ANSWER for the one box almost every ATS form asks for
-- ("expected salary" / "lønforventning") that the pipeline cannot otherwise
-- fill in — a number is not a fact `evaluate.js` can infer from a posting, and
-- guessing one and mailing it to a stranger would be worse than leaving the
-- field for the human. So it lives on the profile (a statement about a target
-- category, same reasoning as `approval_threshold`), and the decision email /
-- panel surface it as a ready value to copy into that box.
--
-- Additive only, per this repo's one-database-every-branch rule: nullable
-- columns, no default that could read as a real answer, no rewrite of any
-- existing row.

alter table public.job_profiles
  add column if not exists expected_monthly_min integer,
  add column if not exists expected_monthly_max integer,
  add column if not exists expected_hourly_min  integer,
  add column if not exists expected_hourly_max  integer;

comment on column public.job_profiles.expected_monthly_min is
  'Expected monthly salary, DKK, lower bound. Null = not stated. Independent of the hourly pair — a profile may carry either, both, or neither.';
comment on column public.job_profiles.expected_monthly_max is
  'Expected monthly salary, DKK, upper bound. Null = not stated.';
comment on column public.job_profiles.expected_hourly_min is
  'Expected hourly rate, DKK, lower bound. Null = not stated.';
comment on column public.job_profiles.expected_hourly_max is
  'Expected hourly rate, DKK, upper bound. Null = not stated.';

-- Guard the ORDER, not presence: a min above its own max is not a range, it is
-- a typo that would render as nonsense ("50-42k kr/md") in an email and in a
-- form a human pastes verbatim. Either half may be null on its own (an
-- open-ended "at least X" or "up to X" is a real answer), so the check only
-- fires when BOTH halves of a pair are present.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'job_profiles_expected_monthly_range_chk'
  ) then
    alter table public.job_profiles
      add constraint job_profiles_expected_monthly_range_chk
      check (
        expected_monthly_min is null
        or expected_monthly_max is null
        or expected_monthly_min <= expected_monthly_max
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'job_profiles_expected_hourly_range_chk'
  ) then
    alter table public.job_profiles
      add constraint job_profiles_expected_hourly_range_chk
      check (
        expected_hourly_min is null
        or expected_hourly_max is null
        or expected_hourly_min <= expected_hourly_max
      );
  end if;
end $$;
