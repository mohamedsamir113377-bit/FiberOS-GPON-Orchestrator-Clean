-- 117_field_operations_integration.sql
-- Field-operations closure: card/port topology, worker roles/assignments,
-- splice evidence, tenant-safe position broadcast, and dashboard read model.
-- No synthetic telemetry is inserted.
BEGIN;

CREATE TABLE IF NOT EXISTS network_cards (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_id uuid NOT NULL REFERENCES network_assets(id) ON DELETE CASCADE,
    slot_number integer NOT NULL CHECK (slot_number >= 0),
    card_type text,
    model text,
    serial_number text,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','degraded','faulty','removed','reserved')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (asset_id, slot_number)
);
CREATE INDEX IF NOT EXISTS idx_network_cards_asset_status ON network_cards(asset_id, status);
ALTER TABLE network_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE network_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_cards_scope ON network_cards;
CREATE POLICY network_cards_scope ON network_cards FOR SELECT USING (
  EXISTS (SELECT 1 FROM network_assets a WHERE a.id = network_cards.asset_id AND a.tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()))
  OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','qc','sysadmin'])
);
DROP POLICY IF EXISTS network_cards_management ON network_cards;
CREATE POLICY network_cards_management ON network_cards FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM network_assets a WHERE a.id = network_cards.asset_id AND a.tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()))
  AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin'])
);

ALTER TABLE network_ports ADD COLUMN IF NOT EXISTS card_id uuid REFERENCES network_cards(id) ON DELETE SET NULL;
ALTER TABLE network_ports ADD COLUMN IF NOT EXISTS physical_port integer;
ALTER TABLE network_ports ADD COLUMN IF NOT EXISTS connector_label text;
CREATE INDEX IF NOT EXISTS idx_network_ports_card ON network_ports(card_id, port_number);
CREATE OR REPLACE FUNCTION fiberos_network_port_card_tenant_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE port_tenant uuid; card_tenant uuid;
BEGIN
  SELECT tenant_id INTO port_tenant FROM network_assets WHERE id=NEW.asset_id;
  IF port_tenant IS NULL THEN RAISE EXCEPTION 'NETWORK_PORT_ASSET_TENANT_REQUIRED'; END IF;
  IF NEW.card_id IS NOT NULL THEN
    SELECT a.tenant_id INTO card_tenant FROM network_cards c JOIN network_assets a ON a.id=c.asset_id WHERE c.id=NEW.card_id;
    IF card_tenant IS NULL OR card_tenant<>port_tenant THEN RAISE EXCEPTION 'NETWORK_PORT_CARD_TENANT_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_network_port_card_tenant_guard ON network_ports;
CREATE TRIGGER trg_network_port_card_tenant_guard BEFORE INSERT OR UPDATE OF asset_id,card_id ON network_ports FOR EACH ROW EXECUTE FUNCTION fiberos_network_port_card_tenant_guard();

CREATE TABLE IF NOT EXISTS technician_role_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE CASCADE,
    role_code text NOT NULL CHECK (role_code IN ('technician','team_lead','fiber_splicer','welder','cable_worker','dispatcher','qc')),
    valid_from timestamptz NOT NULL DEFAULT now(), valid_until timestamptz, is_primary boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), CHECK (valid_until IS NULL OR valid_until > valid_from)
);
CREATE INDEX IF NOT EXISTS idx_tech_roles_tenant_role ON technician_role_assignments(tenant_id, role_code, technician_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tech_primary_role ON technician_role_assignments(tenant_id, technician_id, role_code) WHERE is_primary AND valid_until IS NULL;
CREATE OR REPLACE FUNCTION fiberos_field_ops_tenant_guard(expected_tenant uuid, supplied_tenant uuid)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF supplied_tenant IS NULL OR expected_tenant IS NULL OR supplied_tenant<>expected_tenant THEN RAISE EXCEPTION 'FIELD_OPS_TENANT_MISMATCH'; END IF; END $$;
CREATE OR REPLACE FUNCTION fiberos_technician_role_tenant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tt uuid; BEGIN SELECT tenant_id INTO tt FROM technicians WHERE id=NEW.technician_id; PERFORM fiberos_field_ops_tenant_guard(tt,NEW.tenant_id); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_tech_role_tenant_guard ON technician_role_assignments;
CREATE TRIGGER trg_tech_role_tenant_guard BEFORE INSERT OR UPDATE ON technician_role_assignments FOR EACH ROW EXECUTE FUNCTION fiberos_technician_role_tenant_guard();
ALTER TABLE technician_role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE technician_role_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS technician_role_assignments_scope ON technician_role_assignments;
CREATE POLICY technician_role_assignments_scope ON technician_role_assignments FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()) OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','qc','sysadmin']));
DROP POLICY IF EXISTS technician_role_assignments_management ON technician_role_assignments;
CREATE POLICY technician_role_assignments_management ON technician_role_assignments FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()) AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','sysadmin']));

CREATE TABLE IF NOT EXISTS ticket_worker_assignments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    technician_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
    role_code text NOT NULL CHECK (role_code IN ('technician','team_lead','fiber_splicer','welder','cable_worker','qc')),
    assigned_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (released_at IS NULL OR released_at >= assigned_at)
);
CREATE INDEX IF NOT EXISTS idx_ticket_workers_ticket_role ON ticket_worker_assignments(tenant_id,ticket_id,role_code);
CREATE INDEX IF NOT EXISTS idx_ticket_workers_tech_time ON ticket_worker_assignments(tenant_id,technician_id,assigned_at DESC);
CREATE OR REPLACE FUNCTION fiberos_ticket_worker_tenant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tt uuid; ticket_tenant uuid; BEGIN SELECT tenant_id INTO tt FROM technicians WHERE id=NEW.technician_id; SELECT tenant_id INTO ticket_tenant FROM tickets WHERE id=NEW.ticket_id; IF tt IS NULL OR ticket_tenant IS NULL OR tt<>NEW.tenant_id OR ticket_tenant<>NEW.tenant_id THEN RAISE EXCEPTION 'FIELD_OPS_TENANT_MISMATCH'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_ticket_worker_tenant_guard ON ticket_worker_assignments;
CREATE TRIGGER trg_ticket_worker_tenant_guard BEFORE INSERT OR UPDATE ON ticket_worker_assignments FOR EACH ROW EXECUTE FUNCTION fiberos_ticket_worker_tenant_guard();
ALTER TABLE ticket_worker_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_worker_assignments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ticket_worker_assignments_scope ON ticket_worker_assignments;
CREATE POLICY ticket_worker_assignments_scope ON ticket_worker_assignments FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()) OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','qc','sysadmin']));
DROP POLICY IF EXISTS ticket_worker_assignments_management ON ticket_worker_assignments;
CREATE POLICY ticket_worker_assignments_management ON ticket_worker_assignments FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()) AND fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','dispatcher','sysadmin']));

CREATE TABLE IF NOT EXISTS splice_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ticket_id uuid REFERENCES tickets(id) ON DELETE SET NULL,
    worker_id uuid NOT NULL REFERENCES technicians(id) ON DELETE RESTRICT,
    port_a_id uuid REFERENCES network_ports(id) ON DELETE SET NULL,
    port_b_id uuid REFERENCES network_ports(id) ON DELETE SET NULL,
    splice_type text NOT NULL CHECK (splice_type IN ('fusion','mechanical')),
    measured_loss_db numeric(8,3), closure_status text NOT NULL DEFAULT 'open' CHECK (closure_status IN ('open','verified','rejected')),
    evidence_ref text, created_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_splice_records_ticket ON splice_records(tenant_id,ticket_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_splice_records_worker ON splice_records(tenant_id,worker_id,created_at DESC);
CREATE OR REPLACE FUNCTION fiberos_splice_tenant_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tt uuid; ta uuid; tb uuid; BEGIN SELECT tenant_id INTO tt FROM technicians WHERE id=NEW.worker_id; IF NEW.port_a_id IS NOT NULL THEN SELECT a.tenant_id INTO ta FROM network_ports p JOIN network_assets a ON a.id=p.asset_id WHERE p.id=NEW.port_a_id; END IF; IF NEW.port_b_id IS NOT NULL THEN SELECT a.tenant_id INTO tb FROM network_ports p JOIN network_assets a ON a.id=p.asset_id WHERE p.id=NEW.port_b_id; END IF; IF tt IS NULL OR tt<>NEW.tenant_id OR (ta IS NOT NULL AND ta<>NEW.tenant_id) OR (tb IS NOT NULL AND tb<>NEW.tenant_id) THEN RAISE EXCEPTION 'SPLICE_TENANT_MISMATCH'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_splice_tenant_guard ON splice_records;
CREATE TRIGGER trg_splice_tenant_guard BEFORE INSERT OR UPDATE ON splice_records FOR EACH ROW EXECUTE FUNCTION fiberos_splice_tenant_guard();
ALTER TABLE splice_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE splice_records FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS splice_records_scope ON splice_records;
CREATE POLICY splice_records_scope ON splice_records FOR SELECT USING (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()) OR fiberos_has_any_role(ARRAY['ops_manager','area_supervisor','qc','sysadmin']));
DROP POLICY IF EXISTS splice_records_insert ON splice_records;
CREATE POLICY splice_records_insert ON splice_records FOR INSERT WITH CHECK (tenant_id IN (SELECT tenant_id FROM user_preferences WHERE user_id=auth.uid()) AND fiberos_has_any_role(ARRAY['technician','team_lead','fiber_splicer','welder','ops_manager','area_supervisor','qc','sysadmin']));

ALTER TABLE technician_positions ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE;
UPDATE technician_positions p SET tenant_id=t.tenant_id FROM technicians t WHERE t.id=p.technician_id AND p.tenant_id IS NULL;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM technician_positions WHERE tenant_id IS NULL) THEN RAISE EXCEPTION 'TECHNICIAN_POSITION_TENANT_BACKFILL_INCOMPLETE'; END IF; END $$;
ALTER TABLE technician_positions ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_technician_positions_tenant_time ON technician_positions(tenant_id,captured_at DESC);
CREATE OR REPLACE FUNCTION fiberos_position_set_tenant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE tech_tenant uuid; BEGIN SELECT tenant_id INTO tech_tenant FROM technicians WHERE id=NEW.technician_id; IF tech_tenant IS NULL THEN RAISE EXCEPTION 'TECHNICIAN_TENANT_REQUIRED'; END IF; IF NEW.tenant_id IS NULL THEN NEW.tenant_id:=tech_tenant; END IF; IF NEW.tenant_id<>tech_tenant THEN RAISE EXCEPTION 'TECHNICIAN_POSITION_TENANT_MISMATCH'; END IF; RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_technician_position_set_tenant ON technician_positions;
CREATE TRIGGER trg_technician_position_set_tenant BEFORE INSERT ON technician_positions FOR EACH ROW EXECUTE FUNCTION fiberos_position_set_tenant();
CREATE OR REPLACE FUNCTION fiberos_notify_technician_position() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE payload jsonb; BEGIN payload=jsonb_build_object('tenant_id',NEW.tenant_id,'technician_id',NEW.technician_id,'captured_at',NEW.captured_at,'latitude',ST_Y(NEW.position::geometry),'longitude',ST_X(NEW.position::geometry),'accuracy_meters',NEW.accuracy_meters,'source',NEW.source,'sequence_no',NEW.sequence_no); PERFORM pg_notify('fiberos_technician_position',payload::text); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_technician_position_notify ON technician_positions;
CREATE TRIGGER trg_technician_position_notify AFTER INSERT ON technician_positions FOR EACH ROW EXECUTE FUNCTION fiberos_notify_technician_position();

CREATE OR REPLACE VIEW operations_dashboard_summary WITH (security_invoker = true) AS
SELECT t.id AS tenant_id,
 (SELECT count(*) FROM technicians tx WHERE tx.tenant_id=t.id AND tx.is_active) active_workers,
 (SELECT count(*) FROM tickets tk WHERE tk.tenant_id=t.id AND tk.status IN ('pending','in_progress','awaiting_evidence','manager_review')) open_tickets,
 (SELECT count(*) FROM network_assets na WHERE na.tenant_id=t.id AND na.status='critical') critical_assets,
 (SELECT count(*) FROM splice_records sr WHERE sr.tenant_id=t.id AND sr.closure_status='open') open_splices,
 (SELECT count(*) FROM optical_measurements om JOIN network_assets na ON na.id=om.asset_id WHERE na.tenant_id=t.id AND om.measured_at>=now()-interval '24 hours') optical_measurements_24h
FROM tenants t;

COMMIT;
