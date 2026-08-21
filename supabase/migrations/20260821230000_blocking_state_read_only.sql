-- blocking_state: anon may READ the verdict, never write it.
--
-- Why this table first, out of the 13 permissive ones: it is the only one with
-- no client writer. `focus-evaluate` is its sole writer (see
-- `apps/NexusLocal/src-tauri/src/timetracker/blocking_state.rs`, which says so
-- in its module docs), and that function builds its client from
-- SUPABASE_SERVICE_ROLE_KEY. `service_role` carries `rolbypassrls`, so policies
-- here do not apply to it at all. Every other consumer — Mac daemon, iOS
-- widget, app panels — only reads.
--
-- Why it matters more than "someone could delete rows": this table is a
-- BYPASS. The design's invariant is that a missing or failed verdict means
-- "no verdict has ever been computed", and every enforcer keeps enforcing the
-- last known state. But a *present* row with empty `effective_domains` is a
-- legitimate-looking "nothing is blocked" verdict, and is treated as one. So
-- with `USING (true)` for ALL, anyone holding the public anon key could switch
-- off blocking on Mac and phone with a single request. This closes that.
--
-- Why it is safe to do ahead of the rest of SECURITY_RLS_MIGRATION.md: this
-- does NOT add an `auth.uid()` predicate, so no reader can start silently
-- returning an empty set — the failure mode that governs the ordering of every
-- other step. Readers are untouched; only writers lose access, and there are
-- none. Deliberately keeps the same `anon` role and `using (true)` read
-- predicate so behaviour is otherwise byte-identical: an authenticated JWT
-- still reads nothing here, exactly as it did before (see the `supabasePublic`
-- note in CLAUDE.md).
--
-- Reversal, if a writer turns up:
--   drop policy if exists "blocking_state_anon_read" on public.blocking_state;
--   create policy "anon full access" on public.blocking_state
--     for all to anon using (true) with check (true);

drop policy if exists "anon full access" on public.blocking_state;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'blocking_state'
      and policyname = 'blocking_state_anon_read'
  ) then
    create policy "blocking_state_anon_read"
      on public.blocking_state
      for select
      to anon
      using (true);
  end if;
end $$;
