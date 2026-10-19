-- Allow field/ops to insert optical measurements (source constrained by CHECK)
-- Note: full tenant binding is applied in 023_p0_tenant_authority.sql.
DROP POLICY IF EXISTS optical_measurements_insert_field ON optical_measurements;
CREATE POLICY optical_measurements_insert_field ON optical_measurements
  FOR INSERT TO authenticated
  WITH CHECK (
    fiberos_has_any_role(ARRAY['field_tech','qc','ops_manager','dispatcher','area_supervisor','sysadmin'])
  );

DROP POLICY IF EXISTS optical_measurements_select_field ON optical_measurements;
CREATE POLICY optical_measurements_select_field ON optical_measurements
  FOR SELECT TO authenticated
  USING (
    fiberos_has_any_role(ARRAY['field_tech','qc','ops_manager','dispatcher','area_supervisor','sysadmin','exec'])
  );

-- C-1 fix: NEVER WITH CHECK (true) on outbox.
-- Role-gated insert only; tenant binding + FORCE RLS applied in 023.
DROP POLICY IF EXISTS outbox_insert_app ON outbox_events;
CREATE POLICY outbox_insert_app ON outbox_events
  FOR INSERT TO authenticated
  WITH CHECK (
    fiberos_has_any_role(ARRAY['field_tech','qc','ops_manager','dispatcher','area_supervisor','sysadmin','call_center'])
  );

DROP POLICY IF EXISTS outbox_select_app ON outbox_events;
CREATE POLICY outbox_select_app ON outbox_events
  FOR SELECT TO authenticated
  USING (fiberos_has_any_role(ARRAY['ops_manager','sysadmin','dispatcher','qc']));
