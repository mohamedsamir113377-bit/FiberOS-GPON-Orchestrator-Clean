-- R14.1 Deep Operations Wave: contact-center outcome, warehouse topology,
-- reservation/transfer controls, and command-room data foundations.
-- No synthetic records are inserted. Location stock remains ledger-derived.
BEGIN;

ALTER TABLE call_sessions
  ADD CONSTRAINT call_sessions_id_tenant_key UNIQUE (id, tenant_id);

CREATE TABLE IF NOT EXISTS call_dispositions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  call_session_id uuid NOT NULL,
  outcome_code text NOT NULL CHECK (outcome_code IN (
    'RESOLVED','ESCALATED','CALLBACK_REQUIRED','FIELD_VISIT_REQUIRED',
    'CUSTOMER_UNREACHABLE','DUPLICATE','OTHER'
  )),
  notes text NOT NULL DEFAULT '' CHECK (char_length(notes) <= 4000),
  follow_up_at timestamptz,
  actor_id uuid NOT NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, call_session_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (call_session_id, tenant_id) REFERENCES call_sessions(id, tenant_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_call_dispositions_tenant_time
  ON call_dispositions(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_dispositions_follow_up
  ON call_dispositions(tenant_id, follow_up_at) WHERE follow_up_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  warehouse_code text NOT NULL,
  name text NOT NULL,
  region text,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','QUARANTINED')),
  gps geography(Point,4326),
  manager_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, warehouse_code),
  UNIQUE (id, tenant_id)
);
CREATE INDEX IF NOT EXISTS idx_warehouses_tenant_status
  ON warehouses(tenant_id, status, warehouse_code);
CREATE INDEX IF NOT EXISTS idx_warehouses_gps_gist
  ON warehouses USING gist(gps) WHERE gps IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouse_bins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL,
  bin_code text NOT NULL,
  bin_type text NOT NULL DEFAULT 'STORAGE' CHECK (bin_type IN ('RECEIVING','STORAGE','QUARANTINE','DISPATCH','TRANSIT')),
  parent_bin_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','BLOCKED','QUARANTINED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (warehouse_id, bin_code),
  UNIQUE (id, warehouse_id, tenant_id),
  FOREIGN KEY (warehouse_id, tenant_id) REFERENCES warehouses(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (parent_bin_id) REFERENCES warehouse_bins(id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_warehouse_bins_tenant_warehouse
  ON warehouse_bins(tenant_id, warehouse_id, bin_code);

ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS warehouse_id uuid,
  ADD COLUMN IF NOT EXISTS bin_id uuid,
  ADD COLUMN IF NOT EXISTS movement_type text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_transactions_movement_type_ck') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_movement_type_ck
      CHECK (movement_type IS NULL OR movement_type IN ('receipt','issue','return','adjustment','transfer_in','transfer_out'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_transactions_bin_requires_warehouse_ck') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_bin_requires_warehouse_ck
      CHECK (bin_id IS NULL OR warehouse_id IS NOT NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_transactions_warehouse_tenant_fk') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_warehouse_tenant_fk
      FOREIGN KEY (warehouse_id, tenant_id) REFERENCES warehouses(id, tenant_id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='inventory_transactions_bin_location_fk') THEN
    ALTER TABLE inventory_transactions ADD CONSTRAINT inventory_transactions_bin_location_fk
      FOREIGN KEY (bin_id, warehouse_id, tenant_id) REFERENCES warehouse_bins(id, warehouse_id, tenant_id) ON DELETE RESTRICT;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_inventory_tx_tenant_warehouse_item_time
  ON inventory_transactions(tenant_id, warehouse_id, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_tenant_bin_item_time
  ON inventory_transactions(tenant_id, bin_id, item_id, created_at DESC) WHERE bin_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  warehouse_id uuid NOT NULL,
  bin_id uuid,
  quantity bigint NOT NULL CHECK (quantity > 0),
  status text NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED','RELEASED','FULFILLED','CANCELLED')),
  reference_type text,
  reference_id text,
  idempotency_key text NOT NULL,
  actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (warehouse_id, tenant_id) REFERENCES warehouses(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (bin_id, warehouse_id, tenant_id) REFERENCES warehouse_bins(id, warehouse_id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_open
  ON inventory_reservations(tenant_id, warehouse_id, item_id, status) WHERE status='RESERVED';

CREATE TABLE IF NOT EXISTS warehouse_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  source_warehouse_id uuid NOT NULL,
  target_warehouse_id uuid NOT NULL,
  work_package_id uuid REFERENCES ftth_work_packages(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','POSTED','CANCELLED')),
  idempotency_key text NOT NULL,
  requested_by uuid NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  posted_at timestamptz,
  cancelled_at timestamptz,
  CHECK (source_warehouse_id <> target_warehouse_id),
  UNIQUE (tenant_id, idempotency_key),
  FOREIGN KEY (source_warehouse_id, tenant_id) REFERENCES warehouses(id, tenant_id) ON DELETE RESTRICT,
  FOREIGN KEY (target_warehouse_id, tenant_id) REFERENCES warehouses(id, tenant_id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_tenant_status
  ON warehouse_transfers(tenant_id, status, requested_at DESC);

CREATE TABLE IF NOT EXISTS warehouse_transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  transfer_id uuid NOT NULL REFERENCES warehouse_transfers(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
  source_bin_id uuid REFERENCES warehouse_bins(id) ON DELETE RESTRICT,
  target_bin_id uuid REFERENCES warehouse_bins(id) ON DELETE RESTRICT,
  quantity bigint NOT NULL CHECK (quantity > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_lines_transfer
  ON warehouse_transfer_lines(tenant_id, transfer_id);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['call_dispositions','warehouses','warehouse_bins','inventory_reservations','warehouse_transfers','warehouse_transfer_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS call_dispositions_select ON call_dispositions;
CREATE POLICY call_dispositions_select ON call_dispositions FOR SELECT
  USING (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['call_center','ops_manager','area_supervisor','exec','sysadmin']));
DROP POLICY IF EXISTS call_dispositions_app_write ON call_dispositions;
CREATE POLICY call_dispositions_app_write ON call_dispositions FOR ALL TO fiberos_app
  USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS warehouses_select ON warehouses;
CREATE POLICY warehouses_select ON warehouses FOR SELECT
  USING (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin']));
DROP POLICY IF EXISTS warehouses_app_write ON warehouses;
CREATE POLICY warehouses_app_write ON warehouses FOR ALL TO fiberos_app
  USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS warehouse_bins_select ON warehouse_bins;
CREATE POLICY warehouse_bins_select ON warehouse_bins FOR SELECT
  USING (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin']));
DROP POLICY IF EXISTS warehouse_bins_app_write ON warehouse_bins;
CREATE POLICY warehouse_bins_app_write ON warehouse_bins FOR ALL TO fiberos_app
  USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS inventory_reservations_select ON inventory_reservations;
CREATE POLICY inventory_reservations_select ON inventory_reservations FOR SELECT
  USING (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin']));
DROP POLICY IF EXISTS inventory_reservations_app_write ON inventory_reservations;
CREATE POLICY inventory_reservations_app_write ON inventory_reservations FOR ALL TO fiberos_app
  USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS warehouse_transfers_select ON warehouse_transfers;
CREATE POLICY warehouse_transfers_select ON warehouse_transfers FOR SELECT
  USING (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin']));
DROP POLICY IF EXISTS warehouse_transfers_app_write ON warehouse_transfers;
CREATE POLICY warehouse_transfers_app_write ON warehouse_transfers FOR ALL TO fiberos_app
  USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

DROP POLICY IF EXISTS warehouse_transfer_lines_select ON warehouse_transfer_lines;
CREATE POLICY warehouse_transfer_lines_select ON warehouse_transfer_lines FOR SELECT
  USING (fiberos_enterprise_tenant_ok(tenant_id) AND fiberos_has_any_role(ARRAY['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin']));
DROP POLICY IF EXISTS warehouse_transfer_lines_app_write ON warehouse_transfer_lines;
CREATE POLICY warehouse_transfer_lines_app_write ON warehouse_transfer_lines FOR ALL TO fiberos_app
  USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON call_dispositions, warehouses, warehouse_bins, inventory_reservations, warehouse_transfers, warehouse_transfer_lines FROM anon, authenticated;
GRANT SELECT ON call_dispositions, warehouses, warehouse_bins, inventory_reservations, warehouse_transfers, warehouse_transfer_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON call_dispositions, warehouses, warehouse_bins, inventory_reservations, warehouse_transfers, warehouse_transfer_lines TO fiberos_app;

COMMIT;
