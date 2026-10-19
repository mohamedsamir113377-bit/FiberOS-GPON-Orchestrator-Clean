-- 175_user_preferences_select_app_role.sql
-- Under FORCE RLS, membership resolution for fiberos_app must be able to SELECT
-- the caller's own user_preferences row (auth.uid() = user_id). Without an
-- explicit policy targeting fiberos_app, tenant helpers return NULL and every
-- tenant-scoped WITH CHECK fails closed during live RLS admission.
BEGIN;

DROP POLICY IF EXISTS user_preferences_select_own ON user_preferences;
CREATE POLICY user_preferences_select_own ON user_preferences
  FOR SELECT TO authenticated, fiberos_app
  USING (user_id = auth.uid());

-- Defensive: keep update policy aligned with the same role set.
DROP POLICY IF EXISTS user_preferences_update_own ON user_preferences;
CREATE POLICY user_preferences_update_own ON user_preferences
  FOR UPDATE TO authenticated, fiberos_app
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = public.fiberos_current_tenant_id()
  );

COMMIT;
