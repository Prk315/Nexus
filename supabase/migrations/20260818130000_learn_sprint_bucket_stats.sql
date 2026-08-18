-- Sprint bucket ordering RPC (LEARN_PLAN.md "Sprint — bucketed fast-feedback
-- exam training", pinned 2026-08-18 — DBMS pilot; sprint UI brief §D.4).
-- One round trip, joined on lr_attempt_log by drill CODE (never drill_id or
-- source_slug — see SprintSession.tsx's gradeSprintDrill comment). Drives
-- SprintPanel's "Next: <bucket>" readout and SprintSession's bucket queue:
-- never-practiced buckets first, then lowest accuracy.
create or replace function lr_sprint_bucket_stats(
  p_course_id bigint,
  p_user_id   text default 'default'
)
returns table (
  bucket    text,
  drills    bigint,
  attempts  bigint,
  correct   bigint,
  accuracy  double precision,
  last_at   timestamptz
)
language sql
stable
as $$
  select
    d.bucket,
    count(distinct d.drill_id)                          as drills,
    count(a.a_id)                                       as attempts,
    count(a.a_id) filter (where a.grade >= 2)           as correct,
    case when count(a.a_id) = 0 then null
         else count(a.a_id) filter (where a.grade >= 2)::float8
              / count(a.a_id)
    end                                                 as accuracy,
    max(a.at)                                           as last_at
  from lr_sprint_drill d
  left join lr_attempt_log a
         on a.item_ref = d.code
        and a.user_id  = p_user_id
  where d.course_id = p_course_id
    and d.status in ('draft', 'live')
  group by d.bucket;
$$;

grant execute on function lr_sprint_bucket_stats(bigint, text) to anon, authenticated;
