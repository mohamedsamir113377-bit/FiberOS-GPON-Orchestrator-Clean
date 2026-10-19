-- Alpha46 productization layer.
-- This migration adds only data-backed primitives. Provider integrations are fail-closed
-- until configured; no synthetic delivery/payment/routing success is created here.
-- Requires migrations 001-025.
BEGIN;

CREATE TABLE IF NOT EXISTS technician_positions (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    technician_id       uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    captured_at         timestamptz NOT NULL,
    position            geography(Point, 4326) NOT NULL,
    accuracy_meters     numeric(10,3),
    altitude_meters     numeric(10,3),
    heading_degrees     numeric(7,3),
    speed_mps           numeric(10,3),
    source              text NOT NULL CHECK (source IN ('field_device','vehicle_device','nms','system')),
    sequence_no        bigint,
    payload_hash        char(64),
    signature           text,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_technician_positions_tech_time
    ON technician_positions (technician_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_technician_positions_geo
    ON technician_positions USING gist(position);

ALTER TABLE technician_positions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS technician_positions_select_scope ON technician_positions;
CREATE POLICY technician_positions_select_scope ON technician_positions
FOR SELECT USING (
    EXISTS (
        SELECT 1
        FROM technicians t
        LEFT JOIN user_preferences up ON up.user_id = t.user_id
        WHERE t.id = technician_positions.technician_id
          AND (
            up.tenant_id IN (SELECT up2.tenant_id FROM user_preferences up2 WHERE up2.user_id = auth.uid())
            OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','dispatcher','sysadmin'])
          )
    )
);
DROP POLICY IF EXISTS technician_positions_insert_owner_or_management ON technician_positions;
CREATE POLICY technician_positions_insert_owner_or_management ON technician_positions
FOR INSERT WITH CHECK (
    EXISTS (
        SELECT 1 FROM technicians t
        WHERE t.id = technician_positions.technician_id
          AND t.user_id = auth.uid()
    )
    OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','sysadmin'])
);

CREATE TABLE IF NOT EXISTS inventory_items (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    sku                 text NOT NULL,
    description         text NOT NULL,
    unit                text NOT NULL,
    quantity_on_hand    bigint NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
    reorder_point       bigint NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_inventory_items_tenant_sku ON inventory_items(tenant_id, sku);

CREATE TABLE IF NOT EXISTS inventory_transactions (
    id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id             uuid NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    delta_quantity      bigint NOT NULL CHECK (delta_quantity <> 0),
    reason              text NOT NULL,
    reference_type      text,
    reference_id        text,
    idempotency_key     text NOT NULL,
    actor_id            uuid,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_inventory_tx_item_time
    ON inventory_transactions(item_id, created_at DESC);
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_items_member ON inventory_items;
CREATE POLICY inventory_items_member ON inventory_items
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','warehouse','sysadmin'])
);
DROP POLICY IF EXISTS inventory_items_insert_member ON inventory_items;
CREATE POLICY inventory_items_insert_member ON inventory_items
FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','warehouse','sysadmin'])
);
DROP POLICY IF EXISTS inventory_items_update_member ON inventory_items;
CREATE POLICY inventory_items_update_member ON inventory_items
FOR UPDATE USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS inventory_items_delete_member ON inventory_items;
CREATE POLICY inventory_items_delete_member ON inventory_items
FOR DELETE USING (false);
DROP POLICY IF EXISTS inventory_transactions_member ON inventory_transactions;
CREATE POLICY inventory_transactions_member ON inventory_transactions
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['exec','ops_manager','area_supervisor','warehouse','sysadmin'])
);
DROP POLICY IF EXISTS inventory_transactions_insert_member ON inventory_transactions;
CREATE POLICY inventory_transactions_insert_member ON inventory_transactions
FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','warehouse','sysadmin'])
);
DROP POLICY IF EXISTS inventory_transactions_update_member ON inventory_transactions;
CREATE POLICY inventory_transactions_update_member ON inventory_transactions
FOR UPDATE USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS inventory_transactions_delete_member ON inventory_transactions;
CREATE POLICY inventory_transactions_delete_member ON inventory_transactions
FOR DELETE USING (false);

-- Quantity changes are ledger-authoritative. Direct table updates are rejected.
CREATE OR REPLACE FUNCTION fiberos_block_direct_inventory_quantity_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quantity_on_hand IS DISTINCT FROM OLD.quantity_on_hand
     AND current_setting('fiberos.inventory_ledger_authorized', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'INVENTORY_LEDGER_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_block_direct_inventory_quantity_update ON inventory_items;
CREATE TRIGGER trg_block_direct_inventory_quantity_update
BEFORE UPDATE ON inventory_items
FOR EACH ROW EXECUTE FUNCTION fiberos_block_direct_inventory_quantity_update();

CREATE TABLE IF NOT EXISTS customer_accounts (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id             uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    customer_ref        text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (tenant_id, customer_ref)
);
ALTER TABLE customer_accounts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customer_accounts_own ON customer_accounts;
CREATE POLICY customer_accounts_own ON customer_accounts
FOR SELECT USING (user_id = auth.uid() OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','exec','sysadmin','call_center']));

CREATE TABLE IF NOT EXISTS invoices (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    customer_ref        text NOT NULL,
    service_id          uuid REFERENCES services(id) ON DELETE SET NULL,
    ticket_id           uuid REFERENCES tickets(id) ON DELETE SET NULL,
    currency            char(3) NOT NULL CHECK (currency = upper(currency)),
    amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
    status              text NOT NULL CHECK (status IN ('draft','issued','void','paid','partially_paid','overdue')),
    due_at              timestamptz,
    provider_ref        text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_customer_time ON invoices(tenant_id, customer_ref, created_at DESC);
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_tenant_scope ON invoices;
CREATE POLICY invoices_tenant_scope ON invoices
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['cfo','exec','ops_manager','call_center','sysadmin'])
);
DROP POLICY IF EXISTS invoices_management_insert ON invoices;
CREATE POLICY invoices_management_insert ON invoices
FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    AND fiberos_has_any_role(ARRAY['cfo','exec','ops_manager','call_center','sysadmin'])
);

CREATE TABLE IF NOT EXISTS routing_requests (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    source_lat          numeric(9,6) NOT NULL,
    source_lon          numeric(9,6) NOT NULL,
    target_lat          numeric(9,6) NOT NULL,
    target_lon          numeric(9,6) NOT NULL,
    provider            text NOT NULL,
    request_hash        char(64) NOT NULL,
    response_hash       char(64),
    requested_at        timestamptz NOT NULL DEFAULT now(),
    completed_at        timestamptz,
    status              text NOT NULL CHECK(status IN ('requested','completed','failed')),
    UNIQUE (tenant_id, request_hash)
);
ALTER TABLE routing_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS routing_requests_tenant_scope ON routing_requests;
CREATE POLICY routing_requests_select_scope ON routing_requests
FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    OR fiberos_has_any_role(ARRAY['exec','sysadmin'])
);
CREATE POLICY routing_requests_insert_scope ON routing_requests
FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id = auth.uid())
    AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','exec','sysadmin'])
);
CREATE POLICY routing_requests_update_scope ON routing_requests
FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY routing_requests_delete_scope ON routing_requests
FOR DELETE USING (false);

COMMIT;
