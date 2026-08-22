-- n8n_claim_requests — the atomic half of the queue.
--
-- ⚠️ APPLY THIS BY HAND (Supabase dashboard → SQL editor, or psql). It is
-- deliberately NOT in `supabase/migrations/`: a sibling unit owns that directory
-- and creates `n8n_requests` there, and two units writing the same directory
-- conflict. Fold it into a migration once both have landed.
--
-- Depends on: table `public.n8n_requests` (columns id, user_id uuid, kind text,
-- payload jsonb, status text, created_at, claimed_at, completed_at, error,
-- result).
--
--
-- # Why this is a SQL function and not two PostgREST calls
--
-- Two n8n polls overlap constantly — the workflow runs on a schedule and a slow
-- run is still in flight when the next one starts. A read-then-write ("select
-- the oldest queued rows, then update them by id") is a race with a window of a
-- whole HTTP round trip: both polls read the same rows, both update them, and
-- the same `mail.draft_reply` job runs twice. That is a duplicate draft, and for
-- any kind that ever sends, a double-send.
--
-- `for update skip locked` closes it inside one statement: the second poll's
-- subquery *skips* the rows the first has locked and takes the next ones down,
-- rather than blocking on them or picking them up.
--
-- The `status = 'queued'` predicate is re-evaluated by the UPDATE against the
-- row version it locked, so even the pathological interleaving cannot flip an
-- already-claimed row a second time.

create or replace function public.n8n_claim_requests(
  p_user_id uuid,
  p_kind    text,
  p_limit   int
)
returns setof public.n8n_requests
language sql
volatile
-- security definer + the revoke below: the edge function reaches this with the
-- service role and nothing else can execute it at all.
security definer
set search_path = public, pg_temp
as $$
  update public.n8n_requests r
     set status     = 'claimed',
         claimed_at = now()
   where r.id in (
           select q.id
             from public.n8n_requests q
            where q.user_id = p_user_id
              and q.kind    = p_kind
              and q.status  = 'queued'
            -- `id` as a tiebreak so a batch of rows written in the same
            -- transaction (identical created_at) still has a total order, and a
            -- poll can't oscillate between two orderings of the same tie.
            order by q.created_at, q.id
              for update skip locked
            limit greatest(1, least(coalesce(p_limit, 10), 50))
         )
     and r.status = 'queued'
  returning r.*;
$$;

-- Least privilege: PUBLIC gets EXECUTE on new functions by default, and `anon`
-- and `authenticated` are members of PUBLIC. Since the body is SECURITY
-- DEFINER, leaving that grant in place would hand every holder of the committed
-- anon key the ability to drain the queue.
revoke all on function public.n8n_claim_requests(uuid, text, int) from public;
revoke all on function public.n8n_claim_requests(uuid, text, int) from anon;
revoke all on function public.n8n_claim_requests(uuid, text, int) from authenticated;
grant execute on function public.n8n_claim_requests(uuid, text, int) to service_role;

-- Makes the claim's ordered scan an index hit rather than a sort over the whole
-- table once the queue has any history in it.
create index if not exists n8n_requests_claim_idx
  on public.n8n_requests (user_id, kind, created_at, id)
  where status = 'queued';


-- ─────────────────────────────────────────────────────────────────────────────
-- REQUIRED RLS POSTURE — without this the edge function is security theatre
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The whole point of `n8n-requests` is that n8n holds a narrow scoped secret
-- instead of a service-role key. That buys nothing if `n8n_requests` itself is
-- reachable with the anon key: the anon key is committed in `config.rs` and the
-- repo is public, so a permissive `using (true)` policy — the house default on
-- 13 existing tables, see SECURITY_RLS_MIGRATION.md — would let anyone read
-- every queued mail payload, mark rows done, or inject a `result`, bypassing the
-- secret entirely.
--
-- `anon` must not reach this table at all. `authenticated` still must, because
-- the producer half is the NexusHeader running in the browser as a signed-in
-- user — so revoke `anon` only, and make sure the sibling unit's policies are
-- `user_id = auth.uid()` and NOT `using (true)`.
--
-- ⚠️ If the producer turns out to enqueue with the anon key, the fix is the
-- producer, not deleting this revoke.

alter table public.n8n_requests enable row level security;
revoke all on public.n8n_requests from anon;


-- ─────────────────────────────────────────────────────────────────────────────
-- Applying this, in order
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. The sibling unit's migration creating `n8n_requests` must be applied first
--    — every statement above references it.
-- 2. Run this file (dashboard SQL editor, or psql).
-- 3. PostgREST caches the schema. The dashboard's event trigger reloads it
--    automatically; if applied over psql, `notify pgrst, 'reload schema';`
--    or the rpc 404s until the next reload.
-- 4. `npx supabase secrets set N8N_REQUESTS_KEY=<64 hex chars> N8N_OWNER_UID=<uuid>`
--    then deploy the function. Until all of this lands, every poll is a
--    `500 claim_failed`.
--
-- Note the function is deployed with JWT verification at whatever the deploy
-- used; unless deployed `--no-verify-jwt`, n8n must send the anon key as
-- `Authorization: Bearer …` *in addition to* `x-n8n-key`.
--
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Known gaps, deliberately out of scope for this unit
-- ─────────────────────────────────────────────────────────────────────────────
--
-- * **No stale-claim recovery.** Rows only ever move `queued → claimed`. If n8n
--   crashes mid-run those rows are `claimed` forever: nothing times them out and
--   `complete` refuses `queued`, so there is no path back. The fix is a reclaim
--   predicate in the subquery —
--       (q.status = 'queued'
--        or (q.status = 'claimed' and q.claimed_at < now() - interval '15 minutes'))
--   — but it MUST NOT be added before the next gap is closed, because reclaim is
--   exactly what makes it exploitable.
--
-- * **The completion CAS is state-safe but not generation-safe.** It pins
--   `status = 'claimed'`, not *which* claim. With reclaim in place, a stalled
--   worker from claim #1 would find `status = 'claimed'` again and its write
--   would succeed, clobbering claim #2's in-flight job. Fix cheaply by having
--   `complete` echo the `claimedAt` it was handed (the claim response already
--   returns it) and adding `.eq("claimed_at", echoed)` to the CAS, or by adding
--   a `claim_token uuid` that this function sets per claim.
