-- 112_technician_hierarchy_scope_materialization.sql
-- FiberOS R14.1 — DB mirror of immutable technician/supervisor permission scope.
-- The API may consume this materialization, but the database remains authoritative.
BEGIN;

ALTER TABLE technicians ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT;
ALTER TABLE technicians ADD COLUMN IF NOT EXISTS org_unit_id uuid REFERENCES org_units(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_technicians_tenant_org_unit ON technicians(tenant_id, org_unit_id, is_active);

CREATE TABLE IF NOT EXISTS technician_subordinates (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supervisor_technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  subordinate_technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'org_unit_materialization' CHECK (source IN ('org_unit_materialization','explicit_assignment')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, supervisor_technician_id, subordinate_technician_id),
  CHECK (supervisor_technician_id <> subordinate_technician_id)
);

CREATE INDEX IF NOT EXISTS idx_technician_subordinates_supervisor
  ON technician_subordinates(tenant_id, supervisor_technician_id, is_active);
CREATE INDEX IF NOT EXISTS idx_technician_subordinates_subordinate
  ON technician_subordinates(tenant_id, subordinate_technician_id, is_active);

CREATE OR REPLACE FUNCTION fiberos_enforce_technician_subordinate_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, auth AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM technicians WHERE id = NEW.supervisor_technician_id AND tenant_id = NEW.tenant_id)
     OR NOT EXISTS (SELECT 1 FROM technicians WHERE id = NEW.subordinate_technician_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'TECHNICIAN_SUBORDINATE_TENANT_MISMATCH';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_technician_subordinate_tenant ON technician_subordinates;
CREATE TRIGGER trg_technician_subordinate_tenant
  BEFORE INSERT OR UPDATE ON technician_subordinates
  FOR EACH ROW EXECUTE FUNCTION fiberos_enforce_technician_subordinate_tenant();

ALTER TABLE technician_subordinates ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_subordinates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS technician_subordinates_scope_select ON technician_subordinates;
CREATE POLICY technician_subordinates_scope_select ON technician_subordinates
FOR SELECT TO authenticated
USING (
  tenant_id = fiberos_current_tenant_id()
  AND (
    fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','sysadmin'])
    OR supervisor_technician_id IN (SELECT id FROM technicians WHERE user_id = auth.uid() AND tenant_id = fiberos_current_tenant_id())
    OR subordinate_technician_id IN (SELECT id FROM technicians WHERE user_id = auth.uid() AND tenant_id = fiberos_current_tenant_id())
  )
);
DROP POLICY IF EXISTS technician_subordinates_scope_write ON technician_subordinates;
CREATE POLICY technician_subordinates_scope_write ON technician_subordinates
FOR ALL TO authenticated
USING (tenant_id = fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin']))
WITH CHECK (tenant_id = fiberos_current_tenant_id() AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin']));

-- Direct client DML is not an authorization path; the trusted API/DB jobs own materialization.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON technician_subordinates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON technician_subordinates TO fiberos_app;

-- Technician and ticket reads are narrowed for field identities. Management roles
-- retain tenant reads; mutations remain governed by the existing API/RPC closures.
DROP POLICY IF EXISTS technicians_field_self_select ON technicians;
CREATE POLICY technicians_field_self_select ON technicians
FOR SELECT TO authenticated
USING (
  tenant_id = fiberos_current_tenant_id()
  AND (
    user_id = auth.uid()
    OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','sysadmin'])
    OR id IN (
      SELECT ts.subordinate_technician_id
      FROM technician_subordinates ts
      JOIN technicians me ON me.id = ts.supervisor_technician_id
      WHERE ts.tenant_id = fiberos_current_tenant_id() AND ts.is_active AND me.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS tickets_field_scope_select ON tickets;
CREATE POLICY tickets_field_scope_select ON tickets
FOR SELECT TO authenticated
USING (
  tenant_id = fiberos_current_tenant_id()
  AND (
    fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','sysadmin','qc','dispatcher'])
    OR technician_id IN (
      SELECT t.id FROM technicians t WHERE t.user_id = auth.uid() AND t.tenant_id = fiberos_current_tenant_id()
    )
    OR technician_id IN (
      SELECT ts.subordinate_technician_id
      FROM technician_subordinates ts
      JOIN technicians me ON me.id = ts.supervisor_technician_id
      WHERE ts.tenant_id = fiberos_current_tenant_id() AND ts.is_active AND me.user_id = auth.uid()
    )
  )
);

DROP POLICY IF EXISTS evidence_field_scope_select ON evidence;
CREATE POLICY evidence_field_scope_select ON evidence
FOR SELECT TO authenticated
USING (
  tenant_id = fiberos_current_tenant_id()
  AND (
    fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','sysadmin','qc','dispatcher'])
    OR EXISTS (SELECT 1 FROM tickets tk WHERE tk.id = evidence.ticket_id AND tk.tenant_id = evidence.tenant_id AND (
      tk.technician_id IN (SELECT t.id FROM technicians t WHERE t.user_id = auth.uid() AND t.tenant_id = fiberos_current_tenant_id())
      OR tk.technician_id IN (SELECT ts.subordinate_technician_id FROM technician_subordinates ts JOIN technicians me ON me.id=ts.supervisor_technician_id WHERE ts.tenant_id=fiberos_current_tenant_id() AND ts.is_active AND me.user_id=auth.uid())
    ))
  )
);

COMMENT ON TABLE technician_subordinates IS 'DB-materialized supervisor scope; API permission context reads this table and freezes the result per request.';
COMMENT ON COLUMN technicians.org_unit_id IS 'Organizational isolation anchor; populated by controlled HR/org-unit synchronization only.';

COMMIT;
