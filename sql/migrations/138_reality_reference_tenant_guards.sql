-- 138_reality_reference_tenant_guards.sql
-- Closes cross-tenant reference gaps introduced by generic/declarative reality tables.
BEGIN;

CREATE OR REPLACE FUNCTION public.fiberos_guard_reality_reference_tenants()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE t uuid;
BEGIN
  IF TG_TABLE_NAME='network_asset_semantic_links' THEN
    SELECT tenant_id INTO t FROM public.network_assets WHERE id=NEW.asset_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'ASSET_SEMANTIC_LINK_TENANT_MISMATCH'; END IF;
    SELECT tenant_id INTO t FROM public.network_asset_class_registry WHERE id=NEW.class_registry_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'ASSET_CLASS_REGISTRY_TENANT_MISMATCH'; END IF;

  ELSIF TG_TABLE_NAME='network_shared_graph_edges' THEN
    IF NEW.from_type='NETWORK_ASSET' THEN
      SELECT tenant_id INTO t FROM public.network_assets WHERE id=NEW.from_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SHARED_GRAPH_FROM_ASSET_TENANT_MISMATCH'; END IF;
    END IF;
    IF NEW.to_type='NETWORK_ASSET' THEN
      SELECT tenant_id INTO t FROM public.network_assets WHERE id=NEW.to_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SHARED_GRAPH_TO_ASSET_TENANT_MISMATCH'; END IF;
    END IF;
    IF NEW.work_package_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.ftth_work_packages WHERE id=NEW.work_package_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SHARED_GRAPH_WORK_PACKAGE_TENANT_MISMATCH'; END IF;
    END IF;
    IF NEW.evidence_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.evidence WHERE id=NEW.evidence_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'SHARED_GRAPH_EVIDENCE_TENANT_MISMATCH'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME='network_asset_acceptance_gates' THEN
    IF NEW.entity_type='FTTH_CABLE' THEN
      SELECT tenant_id INTO t FROM public.ftth_cable_segments WHERE id=NEW.entity_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'ACCEPTANCE_CABLE_TENANT_MISMATCH'; END IF;
    ELSIF NEW.entity_type='FTTH_DUCT' THEN
      SELECT tenant_id INTO t FROM public.ftth_duct_segments WHERE id=NEW.entity_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'ACCEPTANCE_DUCT_TENANT_MISMATCH'; END IF;
    ELSIF NEW.entity_type='ODN_CONNECTION' THEN
      SELECT tenant_id INTO t FROM public.ftth_odn_connections WHERE id=NEW.entity_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'ACCEPTANCE_ODN_TENANT_MISMATCH'; END IF;
    ELSIF NEW.entity_type='NETWORK_ASSET' THEN
      SELECT tenant_id INTO t FROM public.network_assets WHERE id=NEW.entity_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'ACCEPTANCE_ASSET_TENANT_MISMATCH'; END IF;
    ELSIF NEW.entity_type='SERVICE_PATH' THEN
      SELECT tenant_id INTO t FROM public.network_service_path_versions WHERE id=NEW.entity_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'ACCEPTANCE_PATH_TENANT_MISMATCH'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME='ftth_civil_inspections' THEN
    IF NEW.duct_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.ftth_duct_segments WHERE id=NEW.duct_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'CIVIL_DUCT_TENANT_MISMATCH'; END IF;
    END IF;
    IF NEW.work_package_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.ftth_work_packages WHERE id=NEW.work_package_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'CIVIL_WORK_PACKAGE_TENANT_MISMATCH'; END IF;
    END IF;
    IF NEW.evidence_id IS NOT NULL THEN
      SELECT tenant_id INTO t FROM public.evidence WHERE id=NEW.evidence_id;
      IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'CIVIL_EVIDENCE_TENANT_MISMATCH'; END IF;
    END IF;

  ELSIF TG_TABLE_NAME='network_failure_domain_members' THEN
    SELECT tenant_id INTO t FROM public.network_failure_domains WHERE id=NEW.failure_domain_id;
    IF t IS DISTINCT FROM NEW.tenant_id THEN RAISE EXCEPTION 'FAILURE_DOMAIN_TENANT_MISMATCH'; END IF;

  ELSIF TG_TABLE_NAME='network_capacity_scenarios' THEN
    NULL;

  ELSIF TG_TABLE_NAME='network_authority_policies'
     OR TG_TABLE_NAME='network_evidence_admissibility_rules'
     OR TG_TABLE_NAME='network_truth_compilation_runs'
     OR TG_TABLE_NAME='network_truth_conflict_events'
     OR TG_TABLE_NAME='network_fault_hypotheses'
     OR TG_TABLE_NAME='network_uncertainty_assessments'
     OR TG_TABLE_NAME='network_replay_events'
     OR TG_TABLE_NAME='network_capability_claims' THEN
    NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fiberos_guard_reality_reference_tenants() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'network_asset_semantic_links','network_shared_graph_edges',
    'network_asset_acceptance_gates','ftth_civil_inspections',
    'network_failure_domain_members'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_reference_tenant ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_%s_reference_tenant BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fiberos_guard_reality_reference_tenants()',t,t);
  END LOOP;
END $$;

-- Replay sequencing is a tenant-local immutable order. The DB, not the client,
-- owns the monotonic sequence.
CREATE OR REPLACE FUNCTION public.fiberos_replay_sequence_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE max_seq bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text,13802026));
  SELECT coalesce(max(sequence_no),0) INTO max_seq
  FROM public.network_replay_events
  WHERE tenant_id=NEW.tenant_id;
  IF NEW.sequence_no <= max_seq THEN
    RAISE EXCEPTION 'REPLAY_SEQUENCE_NOT_MONOTONIC' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_replay_sequence_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_replay_sequence_guard ON public.network_replay_events;
CREATE TRIGGER trg_replay_sequence_guard
BEFORE INSERT ON public.network_replay_events
FOR EACH ROW EXECUTE FUNCTION public.fiberos_replay_sequence_guard();

COMMIT;
