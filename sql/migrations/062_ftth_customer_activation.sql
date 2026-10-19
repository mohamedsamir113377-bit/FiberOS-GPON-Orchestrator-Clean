-- R14.1 customer/service activation traceability.
BEGIN;
CREATE TABLE IF NOT EXISTS ftth_customer_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  customer_account_id uuid REFERENCES customer_accounts(id) ON DELETE RESTRICT, order_code text NOT NULL,
  work_package_id uuid REFERENCES ftth_work_packages(id) ON DELETE RESTRICT, status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','validated','scheduled','installed','tested','activated','accepted','cancelled','failed')),
  service_type text NOT NULL, requested_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz, accepted_at timestamptz,
  UNIQUE(tenant_id,order_code)
);
CREATE TABLE IF NOT EXISTS ftth_activation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES ftth_customer_orders(id) ON DELETE CASCADE, event_type text NOT NULL CHECK(event_type IN ('validated','scheduled','drop_installed','ont_installed','router_installed','optical_tested','nms_activated','customer_accepted','failed')),
  actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, source text NOT NULL, evidence_reference text, device_id text, gps geometry(Point,4326), metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_ftth_activation_order ON ftth_activation_events(tenant_id,order_id,occurred_at);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['ftth_customer_orders','ftth_activation_events'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t); EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',t,t); END LOOP; END $$;
CREATE OR REPLACE FUNCTION fiberos_activation_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER set search_path = pg_catalog, public, auth AS $$
BEGIN
  IF NEW.event_type='nms_activated' AND NOT EXISTS (SELECT 1 FROM ftth_activation_events e WHERE e.order_id=NEW.order_id AND e.event_type='optical_tested') THEN
    RAISE EXCEPTION 'ACTIVATION_REQUIRES_OPTICAL_TEST' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_ftth_activation_guard ON ftth_activation_events;
CREATE TRIGGER trg_ftth_activation_guard BEFORE INSERT ON ftth_activation_events FOR EACH ROW EXECUTE FUNCTION fiberos_activation_guard();

ALTER TABLE ftth_customer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE ftth_activation_events ENABLE ROW LEVEL SECURITY;
COMMIT;
