-- 142_path_bound_optical_and_pon_telemetry_boundary.sql
-- Completes path-bound optical assurance identity and a read-only PON telemetry
-- staging boundary. No vendor connectivity or measured evidence is claimed.

BEGIN;

ALTER TABLE public.network_optical_assurance_assessments
  ADD COLUMN IF NOT EXISTS service_path_version_id uuid
    REFERENCES public.network_service_path_versions(id) ON DELETE RESTRICT;

ALTER TABLE public.network_optical_assurance_assessments
  ADD COLUMN IF NOT EXISTS path_hop_ordinals integer[] NOT NULL DEFAULT '{}';

ALTER TABLE public.network_optical_assurance_assessments
  ADD COLUMN IF NOT EXISTS path_bound boolean NOT NULL DEFAULT false;

ALTER TABLE public.network_optical_assurance_assessments
  ADD COLUMN IF NOT EXISTS content_hash text;

CREATE INDEX IF NOT EXISTS idx_optical_assurance_path_version
  ON public.network_optical_assurance_assessments(
    tenant_id, service_path_version_id, created_at DESC
  )
  WHERE service_path_version_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'network_optical_assurance_path_bound_requires_version'
  ) THEN
    ALTER TABLE public.network_optical_assurance_assessments
      ADD CONSTRAINT network_optical_assurance_path_bound_requires_version
      CHECK (path_bound = false OR service_path_version_id IS NOT NULL);
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.fiberos_guard_optical_assurance_tenant()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  t uuid;
BEGIN
  IF NEW.asset_id IS NOT NULL THEN
    SELECT tenant_id INTO t
    FROM public.network_assets
    WHERE id = NEW.asset_id;

    IF t IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'OPTICAL_ASSURANCE_ASSET_TENANT_MISMATCH';
    END IF;
  END IF;

  IF NEW.port_id IS NOT NULL THEN
    SELECT tenant_id INTO t
    FROM public.network_ports
    WHERE id = NEW.port_id;

    IF t IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'OPTICAL_ASSURANCE_PORT_TENANT_MISMATCH';
    END IF;
  END IF;

  IF NEW.service_id IS NOT NULL THEN
    SELECT tenant_id INTO t
    FROM public.services
    WHERE id = NEW.service_id;

    IF t IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'OPTICAL_ASSURANCE_SERVICE_TENANT_MISMATCH';
    END IF;
  END IF;

  IF NEW.service_path_version_id IS NOT NULL THEN
    SELECT tenant_id INTO t
    FROM public.network_service_path_versions
    WHERE id = NEW.service_path_version_id;

    IF t IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'OPTICAL_ASSURANCE_PATH_VERSION_TENANT_MISMATCH';
    END IF;
  END IF;

  IF NEW.current_measurement_id IS NOT NULL THEN
    SELECT om.tenant_id INTO t
    FROM public.optical_measurements om
    WHERE om.id = NEW.current_measurement_id;

    IF t IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'OPTICAL_ASSURANCE_MEASUREMENT_TENANT_MISMATCH';
    END IF;
  END IF;

  IF NEW.previous_measurement_id IS NOT NULL THEN
    SELECT om.tenant_id INTO t
    FROM public.optical_measurements om
    WHERE om.id = NEW.previous_measurement_id;

    IF t IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'OPTICAL_ASSURANCE_PREVIOUS_MEASUREMENT_TENANT_MISMATCH';
    END IF;
  END IF;

  IF NEW.path_bound AND NEW.service_path_version_id IS NULL THEN
    RAISE EXCEPTION 'OPTICAL_ASSURANCE_PATH_BINDING_REQUIRED';
  END IF;

  RETURN NEW;
END
$$;

REVOKE ALL
ON FUNCTION public.fiberos_guard_optical_assurance_tenant()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_optical_assurance_tenant
ON public.network_optical_assurance_assessments;

CREATE TRIGGER trg_optical_assurance_tenant
BEFORE INSERT OR UPDATE
ON public.network_optical_assurance_assessments
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_guard_optical_assurance_tenant();

COMMENT ON COLUMN public.network_optical_assurance_assessments.service_path_version_id IS
  'Optional path version identity. Mandatory when path_bound is true.';

COMMENT ON COLUMN public.network_optical_assurance_assessments.path_bound IS
  'True when compiled against a service-path version; never implies instrument proof.';

CREATE TABLE IF NOT EXISTS public.network_pon_telemetry_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  adapter_id text,
  signal_type text NOT NULL CHECK (
    signal_type IN (
      'rx_power','tx_power','los','lof','onu_status','bias_current',
      'temperature','upstream_errors','downstream_errors','flapping'
    )
  ),
  value_numeric numeric(16,6),
  value_text text,
  unit text,
  observed_at timestamptz NOT NULL,
  evidence_class text NOT NULL CHECK (
    evidence_class IN (
      'observed','measured','derived','client_declared','simulated','unverified'
    )
  ),
  olt_external_key text,
  pon_port_external_key text,
  onu_serial text,
  onu_external_key text,
  external_resource_key text,
  technology text CHECK (
    technology IS NULL OR technology IN ('GPON','XG-PON','XGS-PON','50G-PON','OTHER')
  ),
  instrument_id text,
  adapter_receipt text,
  device_identity text,
  connectivity_proven boolean NOT NULL DEFAULT false
    CHECK (connectivity_proven = false),
  content_hash text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (value_numeric IS NOT NULL OR value_text IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_pon_telemetry_tenant_time
  ON public.network_pon_telemetry_observations(tenant_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_pon_telemetry_olt
  ON public.network_pon_telemetry_observations(tenant_id, olt_external_key)
  WHERE olt_external_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pon_telemetry_pon_port
  ON public.network_pon_telemetry_observations(tenant_id, pon_port_external_key)
  WHERE pon_port_external_key IS NOT NULL;

ALTER TABLE public.network_pon_telemetry_observations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.network_pon_telemetry_observations
  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS network_pon_telemetry_observations_tenant
ON public.network_pon_telemetry_observations;

CREATE POLICY network_pon_telemetry_observations_tenant
ON public.network_pon_telemetry_observations
FOR ALL TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

CREATE TRIGGER trg_network_pon_telemetry_immutable
BEFORE UPDATE OR DELETE
ON public.network_pon_telemetry_observations
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_reject_history_mutation();

COMMENT ON TABLE public.network_pon_telemetry_observations IS
  'Normalized PON/OLT telemetry staging. connectivity_proven is structurally false.';

CREATE TABLE IF NOT EXISTS public.network_pon_adapter_declarations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE RESTRICT,
  vendor text NOT NULL,
  protocol text NOT NULL,
  model text NOT NULL,
  firmware text,
  technology text NOT NULL CHECK (
    technology IN ('GPON','XG-PON','XGS-PON','50G-PON','OTHER')
  ),
  supported_signals text[] NOT NULL CHECK (cardinality(supported_signals) > 0),
  read_only boolean NOT NULL DEFAULT true CHECK (read_only = true),
  connectivity_claimed boolean NOT NULL DEFAULT false
    CHECK (connectivity_claimed = false),
  declaration_hash text NOT NULL CHECK (declaration_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, vendor, protocol, model, technology)
);

ALTER TABLE public.network_pon_adapter_declarations
  ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.network_pon_adapter_declarations
  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS network_pon_adapter_declarations_tenant
ON public.network_pon_adapter_declarations;

CREATE POLICY network_pon_adapter_declarations_tenant
ON public.network_pon_adapter_declarations
FOR ALL TO authenticated
USING (fiberos_enterprise_tenant_ok(tenant_id))
WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id));

CREATE TRIGGER trg_network_pon_adapter_declarations_immutable
BEFORE UPDATE OR DELETE
ON public.network_pon_adapter_declarations
FOR EACH ROW
EXECUTE FUNCTION public.fiberos_reject_history_mutation();

REVOKE INSERT, UPDATE, DELETE
ON public.network_pon_telemetry_observations,
   public.network_pon_adapter_declarations
FROM authenticated, fiberos_app, fiberos_runtime, fiberos_worker;

GRANT SELECT
ON public.network_pon_telemetry_observations,
   public.network_pon_adapter_declarations
TO authenticated;

COMMIT;
