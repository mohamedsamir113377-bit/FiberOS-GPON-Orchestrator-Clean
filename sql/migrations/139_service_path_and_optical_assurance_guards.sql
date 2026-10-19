-- 139_service_path_and_optical_assurance_guards.sql
-- Closes two master-statement gaps: immutable live service-path versions and
-- an explicit optical-assurance result ledger. No forecasting is introduced.
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_guard_live_service_path_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE active_count integer;
BEGIN
  IF TG_OP='UPDATE' AND OLD.state='live' THEN
    IF NEW.service_id IS DISTINCT FROM OLD.service_id
       OR NEW.version_no IS DISTINCT FROM OLD.version_no
       OR NEW.path_hash IS DISTINCT FROM OLD.path_hash
       OR NEW.valid_from IS DISTINCT FROM OLD.valid_from THEN
      RAISE EXCEPTION 'LIVE_SERVICE_PATH_VERSION_IMMUTABLE_USE_NEW_VERSION' USING ERRCODE='42501';
    END IF;
  END IF;

  IF NEW.state='live' THEN
    SELECT count(*) INTO active_count
    FROM public.network_service_path_versions v
    WHERE v.tenant_id=NEW.tenant_id
      AND v.service_id=NEW.service_id
      AND v.state='live'
      AND v.id<>NEW.id
      AND v.valid_from <= COALESCE(NEW.valid_to, 'infinity'::timestamptz)
      AND COALESCE(v.valid_to, 'infinity'::timestamptz) >= NEW.valid_from;
    IF active_count > 0 THEN
      RAISE EXCEPTION 'MULTIPLE_OVERLAPPING_LIVE_SERVICE_PATH_VERSIONS' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_live_service_path_version() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_live_service_path_version_guard ON public.network_service_path_versions;
CREATE TRIGGER trg_live_service_path_version_guard
BEFORE INSERT OR UPDATE ON public.network_service_path_versions
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_live_service_path_version();

CREATE TABLE IF NOT EXISTS network_optical_assurance_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  service_id uuid REFERENCES services(id) ON DELETE RESTRICT,
  asset_id uuid REFERENCES network_assets(id) ON DELETE RESTRICT,
  port_id uuid REFERENCES network_ports(id) ON DELETE RESTRICT,
  current_measurement_id bigint REFERENCES optical_measurements(id) ON DELETE RESTRICT,
  previous_measurement_id bigint REFERENCES optical_measurements(id) ON DELETE RESTRICT,
  expected_rx_dbm numeric(10,4),
  current_rx_dbm numeric(10,4),
  residual_db numeric(10,4),
  residual_sigma_db numeric(10,4),
  alarm_signal_ids uuid[] NOT NULL DEFAULT '{}',
  peer_observation_ids uuid[] NOT NULL DEFAULT '{}',
  assurance_state text NOT NULL CHECK (assurance_state IN ('HEALTHY','DEGRADED','ALARM_CORRELATED','CONFLICTED','UNVERIFIED')),
  assessment_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  method text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_optical_assurance_asset_time
  ON network_optical_assurance_assessments(tenant_id,asset_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_optical_assurance_service_time
  ON network_optical_assurance_assessments(tenant_id,service_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.fiberos_guard_optical_assurance_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE t uuid;
BEGIN
  IF NEW.asset_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.network_assets WHERE id=NEW.asset_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'OPTICAL_ASSURANCE_ASSET_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.port_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.network_ports WHERE id=NEW.port_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'OPTICAL_ASSURANCE_PORT_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.service_id IS NOT NULL THEN
    SELECT tenant_id INTO t FROM public.services WHERE id=NEW.service_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'OPTICAL_ASSURANCE_SERVICE_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.current_measurement_id IS NOT NULL THEN
    SELECT om.tenant_id INTO t FROM public.optical_measurements om WHERE om.id=NEW.current_measurement_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'OPTICAL_ASSURANCE_MEASUREMENT_TENANT_MISMATCH'; END IF;
  END IF;
  IF NEW.previous_measurement_id IS NOT NULL THEN
    SELECT om.tenant_id INTO t FROM public.optical_measurements om WHERE om.id=NEW.previous_measurement_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'OPTICAL_ASSURANCE_PREVIOUS_MEASUREMENT_TENANT_MISMATCH'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_guard_optical_assurance_tenant() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_optical_assurance_tenant ON public.network_optical_assurance_assessments;
CREATE TRIGGER trg_optical_assurance_tenant
BEFORE INSERT OR UPDATE ON public.network_optical_assurance_assessments
FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_optical_assurance_tenant();

ALTER TABLE public.network_optical_assurance_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_optical_assurance_assessments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS network_optical_assurance_assessments_tenant ON public.network_optical_assurance_assessments;
CREATE POLICY network_optical_assurance_assessments_tenant
ON public.network_optical_assurance_assessments
FOR ALL TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

CREATE TRIGGER trg_network_optical_assurance_immutable
BEFORE UPDATE OR DELETE ON public.network_optical_assurance_assessments
FOR EACH ROW EXECUTE FUNCTION public.fiberos_reject_history_mutation();

COMMENT ON TABLE public.network_optical_assurance_assessments IS
'Observed/derived optical assurance ledger. It may correlate history, residual, alarms and peers; it never forecasts or upgrades evidence authority.';

COMMIT;
