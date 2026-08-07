-- Protocol: make the food/ingredient catalog a SHARED library.
--
-- Previously protocol_foods was private per user (owner_all: user_id = auth.uid()),
-- so an ingredient one user logged was invisible to everyone else and got
-- re-created row-by-row. The catalog holds no sensitive data — it is reference
-- nutrition facts — so every authenticated user should be able to browse and
-- reuse the whole library. Contributions stay attributed via user_id, and only
-- the contributor may edit or delete their own rows (nobody can clobber another
-- user's food). Weekly plan entries, saved meals and goals remain private.

-- Drop the old owner-only policy (idempotent: guarded by IF EXISTS).
DROP POLICY IF EXISTS owner_all ON protocol_foods;

-- Everyone signed in reads the whole shared catalog.
DROP POLICY IF EXISTS foods_shared_read ON protocol_foods;
CREATE POLICY foods_shared_read ON protocol_foods
  FOR SELECT TO authenticated
  USING (true);

-- You may only contribute rows attributed to yourself.
DROP POLICY IF EXISTS foods_insert_own ON protocol_foods;
CREATE POLICY foods_insert_own ON protocol_foods
  FOR INSERT TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid())::text);

-- You may only edit your own contributions.
DROP POLICY IF EXISTS foods_update_own ON protocol_foods;
CREATE POLICY foods_update_own ON protocol_foods
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid())::text)
  WITH CHECK (user_id = (SELECT auth.uid())::text);

-- You may only delete your own contributions.
DROP POLICY IF EXISTS foods_delete_own ON protocol_foods;
CREATE POLICY foods_delete_own ON protocol_foods
  FOR DELETE TO authenticated
  USING (user_id = (SELECT auth.uid())::text);
