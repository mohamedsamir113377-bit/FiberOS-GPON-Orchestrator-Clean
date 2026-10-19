-- R14.1 contractor hierarchy + material chain of custody.
-- inventory_transactions.id is BIGINT; the FK below must use the same type.
BEGIN;
CREATE TABLE IF NOT EXISTS contractor_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  parent_contractor_id uuid REFERENCES contractor_entities(id) ON DELETE RESTRICT, legal_name text NOT NULL, code text NOT NULL,
  tier integer NOT NULL CHECK(tier BETWEEN 1 AND 9), status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','qualified','suspended','active','expired','terminated')),
  qualification jsonb NOT NULL DEFAULT '{}'::jsonb, sla_profile jsonb NOT NULL DEFAULT '{}'::jsonb, geographic_scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,code)
);
CREATE INDEX IF NOT EXISTS idx_contractor_parent ON contractor_entities(tenant_id,parent_contractor_id);
CREATE TABLE IF NOT EXISTS contractor_work_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  contractor_id uuid NOT NULL REFERENCES contractor_entities(id) ON DELETE CASCADE, work_package_id uuid NOT NULL REFERENCES ftth_work_packages(id) ON DELETE CASCADE,
  max_subcontract_tier integer NOT NULL DEFAULT 1 CHECK(max_subcontract_tier>=0), authorized_by uuid NOT NULL, authorized_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','expired')),
  UNIQUE(contractor_id,work_package_id)
);
CREATE TABLE IF NOT EXISTS material_chain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  inventory_transaction_id bigint REFERENCES inventory_transactions(id), material_id uuid REFERENCES inventory_items(id), work_package_id uuid REFERENCES ftth_work_packages(id),
  event_type text NOT NULL CHECK(event_type IN ('received','reserved','issued','transferred','installed','consumed','returned','damaged','scrapped','reconciled')),
  quantity numeric(18,4) NOT NULL CHECK(quantity>0), actor_id uuid NOT NULL, occurred_at timestamptz NOT NULL, evidence_reference text, metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_material_chain_work ON material_chain_events(tenant_id,work_package_id,occurred_at);
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['contractor_entities','contractor_work_authorizations','material_chain_events'] LOOP EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t); EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t); EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I',t,t); EXECUTE format('CREATE POLICY %I_tenant ON %I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',t,t); END LOOP; END $$;
CREATE OR REPLACE FUNCTION fiberos_contractor_chain_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER set search_path=pg_catalog,public,auth AS $$
DECLARE parent_tier integer;
BEGIN
  IF NEW.parent_contractor_id IS NULL AND NEW.tier <> 1 THEN RAISE EXCEPTION 'CONTRACTOR_ROOT_MUST_BE_TIER_1' USING ERRCODE='22023'; END IF;
  IF NEW.parent_contractor_id IS NOT NULL THEN
    SELECT tier INTO parent_tier FROM contractor_entities WHERE id=NEW.parent_contractor_id AND tenant_id=NEW.tenant_id;
    IF parent_tier IS NULL OR NEW.tier <> parent_tier+1 THEN RAISE EXCEPTION 'CONTRACTOR_TIER_MUST_INCREMENT_BY_ONE' USING ERRCODE='42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contractor_chain_guard ON contractor_entities;
CREATE TRIGGER trg_contractor_chain_guard BEFORE INSERT OR UPDATE ON contractor_entities FOR EACH ROW EXECUTE FUNCTION fiberos_contractor_chain_guard();

ALTER TABLE contractor_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE contractor_work_authorizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE material_chain_events ENABLE ROW LEVEL SECURITY;
COMMIT;
