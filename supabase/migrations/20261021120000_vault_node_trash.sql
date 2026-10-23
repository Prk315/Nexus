-- Vault: a recoverable bin for deleted nodes.
--
-- Why this exists. `api.deleteNode` was a hard delete that ALSO wiped
-- `vault_content_versions` for the node and every `<id>_suffix` key — so the one
-- mechanism built to survive a bad write did not survive a delete. The Supabase
-- org is on the free plan: no daily backups, no PITR, no restore point. Two book
-- nodes were lost on 2026-10-21 to a double-tap on an iPad, and there was
-- provably nothing anywhere to bring them back from.
--
-- So deletion becomes a state, not an event: `deleted_at` is set, nothing is
-- destroyed, and the row (plus all its content, annotations, journals, CRDT
-- state and version history) sits there until the bin is emptied by hand.
--
-- ⚠️ Additive only, and that is deliberate — this project has one database for
-- every branch, so a deployed build that does not know about `deleted_at`
-- ignores the column and keeps hard-deleting. The two behaviours coexist; the
-- older client is simply still destructive. Nothing breaks in either direction,
-- which is what lets this be applied before the Vault build ships.

alter table public.vault_nodes
  add column if not exists deleted_at timestamptz;

-- Partial, because the bin is the small set and the live set is what nearly
-- every other query wants. `loadGraph` does not filter server-side at all — it
-- needs the deleted ids anyway, to drop the edges that point at them — so this
-- index serves the bin listing and `emptyTrash`, not the hot read.
create index if not exists vault_nodes_deleted_at_idx
  on public.vault_nodes (user_id, deleted_at desc)
  where deleted_at is not null;

-- ⚠️ Soft delete turns a DELETE into an UPDATE, and the two have DIFFERENT
-- permissions here.
--
-- `vault_nodes` carries `owner_all` (ALL, `user_id = auth.uid()`) plus
-- `team_shared_select` and `team_shared_update`. There is deliberately no team
-- DELETE policy — "a teammate may edit but not delete", and DELETE is governed
-- only by USING, so that omission is the whole enforcement. Writing the bin as
-- an UPDATE would have routed deletion straight through `team_shared_update`
-- and handed a teammate the power to bin a shared note, which they have never
-- had. This trigger is what keeps that property.
--
-- It guards the TRANSITION rather than the table: an ordinary edit (rename,
-- retag, reshare) does not touch `deleted_at` and is unaffected, and `BEFORE
-- UPDATE OF deleted_at` means the trigger is not even consulted on those. There
-- is no way to change a column without naming it in SET, so that is airtight.
create or replace function public.vault_nodes_guard_trash()
returns trigger
language plpgsql
-- SECURITY INVOKER (the default, and stated because it matters): the claim has
-- to resolve against the CALLER, exactly as `vault_content_set_updated_by` does.
-- A SECURITY DEFINER function here would check the owner's uid against itself
-- and always pass.
as $$
begin
  if old.deleted_at is distinct from new.deleted_at
     -- A NULL uid is the service role, which bypasses RLS entirely and is how
     -- this database gets repaired by hand; anon also has a NULL uid but no
     -- policy on this table grants it UPDATE, so RLS has already refused it
     -- long before the trigger runs.
     and (select auth.uid()) is not null
     and new.user_id is distinct from (select auth.uid())::text
  then
    raise exception
      'only the owner may move a Vault node to the bin or restore it'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists vault_nodes_guard_trash on public.vault_nodes;
create trigger vault_nodes_guard_trash
  before update of deleted_at on public.vault_nodes
  for each row execute function public.vault_nodes_guard_trash();
