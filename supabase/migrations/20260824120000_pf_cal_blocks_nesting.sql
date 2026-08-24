-- 20260824120000_pf_cal_blocks_nesting.sql
--
-- WHAT
--   Nested calendar blocks: `pf_cal_blocks` gains `parent_block_id`, a
--   self-referencing FK. A block whose `parent_block_id` points at another
--   block on the SAME date is a "segment" of it (e.g. a 45-minute Deep-work
--   stretch scheduled inside a 10-13 "transport" task) — Week view renders it
--   as an inset card inside its parent instead of a separate overlapping
--   top-level block.
--
-- WHY
--   User's own words: "I have to be on the train from 10-13, that's a task,
--   but I'd like to spend some of that time on school work and other time on
--   other things within the transport task — specify this as a subtask/step
--   in the transport task and the event card would then change to display
--   tasks within tasks recursively." This is the schema half of that; the
--   frontend half (TimeColumn's recursive card, the "Add segment" creation
--   flow, and nexus-core's children-win span math) lands in the same change.
--
-- TYPE NOTE — deviates from the original spec draft
--   The draft for this migration assumed `pf_cal_blocks.id` was `uuid`. Live
--   schema check (information_schema.columns) shows it is `bigint` (a plain
--   serial-style PK, matching `CalBlock.id: number` throughout the TS types
--   and the `num()` coercion every mapper in api/_shared.ts already applies).
--   `parent_block_id` is therefore `bigint`, not `uuid`. Reported per the
--   task instructions asking for exactly this check.
--
-- SCOPE
--   `pf_recurring_cal_blocks` is NOT touched. Recurring series never nest —
--   a virtual (negative-id) occurrence has no row to point a real FK at, and
--   `expandRecurring` in api/_shared.ts always sets a virtual occurrence's
--   `parent_block_id` to null client-side regardless of the series row's
--   shape. Nesting under/within a recurring occurrence is out of scope by the
--   same reasoning: there is no stable row for a child to reference.
--
-- RLS
--   No policy changes. The existing `owner_all` (authenticated, `auth.uid()`)
--   and the anon `widget_anon_read` / `coverage_anon_insert` policies
--   (20260821220000_pf_cal_blocks_anon_access.sql) already cover every column
--   on the table, including new ones — Postgres RLS is row-scoped, not
--   column-scoped, so a new nullable column needs no new policy.
--
-- DEPTH
--   The schema and this migration place no limit on nesting depth (the FK
--   and the self-parent CHECK below are the only constraints). The Week view
--   UI caps the *visual* inset at 3 levels for legibility but keeps
--   rendering deeper levels of real data — see TimeColumn.tsx.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pf_cal_blocks' and column_name = 'parent_block_id'
  ) then
    alter table public.pf_cal_blocks
      add column parent_block_id bigint references public.pf_cal_blocks(id) on delete cascade;
  end if;
end $$;

create index if not exists pf_cal_blocks_parent_idx on public.pf_cal_blocks (parent_block_id);

do $$
begin
  -- A block cannot be its own parent. This is only the trivial one-hop case —
  -- deeper cycles (A -> B -> A) are not expressible as a single-column CHECK
  -- and are instead refused client-side before the write (see
  -- `wouldCreateCalBlockCycle` in api/calendar.ts), which walks the existing
  -- parent chain. This constraint is the backstop for the case that needs no
  -- walk at all.
  if not exists (select 1 from pg_constraint where conname = 'pf_cal_blocks_no_self_parent') then
    alter table public.pf_cal_blocks
      add constraint pf_cal_blocks_no_self_parent
      check (parent_block_id is null or parent_block_id <> id);
  end if;
end $$;

comment on column public.pf_cal_blocks.parent_block_id is
  'Nested block support: set when this block is a segment scheduled inside another pf_cal_blocks row on the same date. NULL = top-level. Only ever set on one-off blocks — recurring occurrences (virtual, negative ids) are never nested, and expandRecurring() always returns parent_block_id: null for them.';
