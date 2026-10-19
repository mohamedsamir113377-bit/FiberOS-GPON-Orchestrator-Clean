-- R14.1 Alpha85: server-authoritative Asset DNA snapshot generation.
-- The client may request a snapshot, but cannot author its canonical payload/hash.
BEGIN;

CREATE OR REPLACE FUNCTION fiberos_asset_dna_canonical_payload(p_asset_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'asset', (
      SELECT jsonb_build_object(
        'id', a.id,
        'asset_code', a.asset_code,
        'asset_type', a.asset_type,
        'parent_asset_id', a.parent_asset_id,
        'name', a.name,
        'region', a.region,
        'gps', CASE WHEN a.gps IS NULL THEN NULL ELSE ST_AsGeoJSON(a.gps)::jsonb END,
        'total_ports', a.total_ports,
        'splitter_ratio', a.splitter_ratio,
        'status', a.status,
        'created_at', a.created_at,
        'updated_at', a.updated_at
      ) FROM network_assets a WHERE a.id = p_asset_id
    ),
    'ports', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id, 'port_number', p.port_number, 'port_type', p.port_type,
        'status', p.status, 'connected_asset_id', p.connected_asset_id,
        'connected_customer_id', p.connected_customer_id
      ) ORDER BY p.port_number, p.id)
      FROM network_ports p WHERE p.asset_id = p_asset_id
    ), '[]'::jsonb),
    'fiber_cable', (
      SELECT jsonb_build_object(
        'id', c.id, 'asset_id', c.asset_id, 'cable_type', c.cable_type,
        'fiber_count', c.fiber_count, 'route_length_m', c.route_length_m,
        'installed_at', c.installed_at, 'status', c.status
      ) FROM fiber_cables c WHERE c.asset_id = p_asset_id
    ),
    'fiber_cores', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', fc.id, 'cable_id', fc.cable_id, 'core_number', fc.core_number,
        'status', fc.status, 'color_code', fc.color_code, 'service_capacity', fc.service_capacity
      ) ORDER BY fc.core_number, fc.id)
      FROM fiber_cores fc
      JOIN fiber_cables c ON c.id = fc.cable_id
      WHERE c.asset_id = p_asset_id
    ), '[]'::jsonb),
    'topology_edges', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', e.id, 'from_asset_id', e.from_asset_id, 'to_asset_id', e.to_asset_id,
        'relation', e.relation, 'capacity', e.capacity, 'weight', e.weight,
        'shared_risk_group', e.shared_risk_group, 'direction', e.direction, 'active', e.active
      ) ORDER BY e.from_asset_id, e.to_asset_id, e.relation, e.id)
      FROM physical_topology_edges e
      WHERE e.from_asset_id = p_asset_id OR e.to_asset_id = p_asset_id
    ) , '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION fiberos_asset_dna_before_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_payload jsonb;
  v_tenant uuid;
  v_max integer;
BEGIN
  SELECT a.tenant_id INTO v_tenant FROM network_assets a WHERE a.id = NEW.asset_id FOR SHARE;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'ASSET_NOT_FOUND'; END IF;
  IF v_tenant <> NEW.tenant_id THEN RAISE EXCEPTION 'TENANT_ASSET_MISMATCH'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text || ':' || NEW.asset_id::text, 0));
  SELECT COALESCE(MAX(dna_version), 0) INTO v_max
  FROM fiberos_asset_dna
  WHERE tenant_id = NEW.tenant_id AND asset_id = NEW.asset_id;
  IF NEW.dna_version <> v_max + 1 THEN
    RAISE EXCEPTION 'DNA_VERSION_MUST_BE_NEXT expected=% actual=%', v_max + 1, NEW.dna_version;
  END IF;

  v_payload := fiberos_asset_dna_canonical_payload(NEW.asset_id);
  NEW.identity_kind := 'FIBEROS_ASSET_DNA';
  NEW.canonical_payload := v_payload;
  NEW.payload_sha256 := encode(digest(convert_to(v_payload::text, 'UTF8'), 'sha256'), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fiberos_asset_dna_before_insert ON fiberos_asset_dna;
CREATE TRIGGER trg_fiberos_asset_dna_before_insert
BEFORE INSERT ON fiberos_asset_dna
FOR EACH ROW EXECUTE FUNCTION fiberos_asset_dna_before_insert();

CREATE OR REPLACE FUNCTION fiberos_asset_dna_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ASSET_DNA_IMMUTABLE';
END;
$$;

DROP TRIGGER IF EXISTS trg_fiberos_asset_dna_no_update ON fiberos_asset_dna;
CREATE TRIGGER trg_fiberos_asset_dna_no_update
BEFORE UPDATE ON fiberos_asset_dna
FOR EACH ROW EXECUTE FUNCTION fiberos_asset_dna_immutable();

DROP TRIGGER IF EXISTS trg_fiberos_asset_dna_no_delete ON fiberos_asset_dna;
CREATE TRIGGER trg_fiberos_asset_dna_no_delete
BEFORE DELETE ON fiberos_asset_dna
FOR EACH ROW EXECUTE FUNCTION fiberos_asset_dna_immutable();

COMMIT;
