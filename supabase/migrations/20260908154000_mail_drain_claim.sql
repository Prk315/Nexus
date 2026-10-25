-- 20260908154000_mail_drain_claim.sql
--
-- Give the drain queue a claim, so two overlapping passes cannot classify the
-- same message twice.
--
-- # The bug this fixes
--
-- `mail-drain` asked `n8n-ingest` for `score IS NULL` rows, classified them one
-- by one, and wrote every verdict in a single upsert at the *end* of the pass.
-- Nothing marked a row as "someone is already working on this". A pass over ten
-- messages takes ~370 s on the local 7B; the schedule fired every 300 s. So the
-- next pass started while the first was still mid-inference, re-read the very
-- same untriaged rows, and ran the model over them again.
--
-- Measured on 2026-09-08 over fourteen consecutive passes: 140 classifications
-- performed, 36 distinct messages advanced. **74% of the GPU work was
-- duplicate.** Individual messages were classified up to eight times. The
-- backlog looked stalled because it nearly was — six messages an hour on
-- hardware that manages ninety.
--
-- This was invisible while the queue was empty: a pass with nothing to do
-- finishes in about a second and never overlaps anything. It took a 200-message
-- re-triage to expose it.
--
-- # Why a claim column and not a shorter schedule
--
-- Widening the interval past the pass duration also stops the overlap, and that
-- is shipped alongside this. But it is a guess about how long inference takes,
-- and the guess is wrong the moment a message is long, Ollama is cold, or the
-- Mac is busy. Interval tuning makes collisions *unlikely*; a claim makes them
-- *impossible*. Both, because the interval keeps Ollama serial on a 16 GB
-- machine and the claim keeps correctness independent of that.

-- ───────────────────────────────────────────────────────────────────────────
-- The claim marker
-- ───────────────────────────────────────────────────────────────────────────
--
-- Deliberately NOT a boolean. A timestamp answers "is this claimed?" and "has
-- the claimer died?" with one column — a bare flag would strand a row forever
-- when n8n restarts mid-pass, which it does (see the 0-second executions in
-- `execution_entity` every time the container bounces).
--
-- `claimed_at` is never cleared. Once a verdict lands, `score` is non-null and
-- the row is out of the queue regardless; leaving the stamp behind keeps a
-- record of when the work was picked up.

alter table public.mail_messages
  add column if not exists claimed_at timestamptz;

comment on column public.mail_messages.claimed_at is
  'When a drain pass took this row for classification. NULL means unclaimed. '
  'A claim older than the staleness window is reclaimable — the pass that took '
  'it is assumed dead, because an n8n restart kills in-flight executions '
  'without unwinding anything.';

-- The queue scan. Partial on `score is null` because that predicate IS the
-- queue and it is a shrinking minority of the table — 92 of 226 rows today,
-- and normally zero. Safe to make partial: this index serves an ordinary
-- ordered scan, not an `on_conflict` inference, which is the case that cannot
-- use a partial index (see the unique index in the mail bus migration).
create index if not exists mail_messages_drain_queue_idx
  on public.mail_messages (user_id, received_at)
  where score is null;

-- ───────────────────────────────────────────────────────────────────────────
-- claim_untriaged_mail — take a batch, atomically
-- ───────────────────────────────────────────────────────────────────────────
--
-- `for update skip locked` is the same primitive `n8n_requests` already uses to
-- hand work to n8n exactly once. Two concurrent callers cannot receive the same
-- row: the second skips what the first has locked, and by the time the lock is
-- released `claimed_at` is set, so it is filtered out on the next pass too.
--
-- The lock alone is not enough — it lives only as long as the transaction, and
-- this one commits in milliseconds while the classification it authorises runs
-- for minutes. The lock prevents two callers colliding *inside* this function;
-- the `claimed_at` stamp is what holds the claim for the duration of the actual
-- work. Both are needed.
--
-- Ordered `received_at asc` to match the read it replaces: a backlog drains
-- oldest-first, so the morning's mail is classified in the order it arrived
-- rather than leaving the oldest — the most likely to be waited on — for last.

create or replace function public.claim_untriaged_mail(
  p_user  uuid,
  p_limit int,
  p_stale interval default interval '30 minutes'
)
returns table (external_id text)
language sql
security definer
-- Pinned so a caller cannot shadow `mail_messages` with a same-named relation
-- on a search path they control. Standard for security-definer functions here.
set search_path = public, pg_temp
as $$
  with candidate as (
    select m.id
      from public.mail_messages m
     where m.user_id = p_user
       and m.score is null
       -- Either never claimed, or claimed so long ago that the pass which took
       -- it cannot still be running. Without this second arm a container
       -- restart would park a row permanently: claimed, unscored, invisible.
       and (m.claimed_at is null or m.claimed_at < now() - p_stale)
     order by m.received_at asc
     limit p_limit
     for update skip locked
  )
  update public.mail_messages m
     set claimed_at = now()
    from candidate c
   where m.id = c.id
  returning m.external_id;
$$;

comment on function public.claim_untriaged_mail(uuid, int, interval) is
  'Atomically take up to p_limit untriaged messages for one drain pass, '
  'stamping claimed_at so a concurrent pass cannot pick the same rows. '
  'Reclaims rows whose claim is older than p_stale, on the assumption that '
  'the claiming pass died.';

-- ───────────────────────────────────────────────────────────────────────────
-- Grants
-- ───────────────────────────────────────────────────────────────────────────
--
-- `security definer` plus the default `execute to public` would be a hole: the
-- function takes a `p_user` argument, so anyone able to call it could stamp
-- another account's rows. Only the service role — which is to say, only
-- `n8n-ingest` — may call it. The anon and authenticated roles get nothing,
-- consistent with `mail_messages` having no anon policy at all.

revoke all on function public.claim_untriaged_mail(uuid, int, interval) from public;
revoke all on function public.claim_untriaged_mail(uuid, int, interval) from anon;
revoke all on function public.claim_untriaged_mail(uuid, int, interval) from authenticated;
grant execute on function public.claim_untriaged_mail(uuid, int, interval) to service_role;
