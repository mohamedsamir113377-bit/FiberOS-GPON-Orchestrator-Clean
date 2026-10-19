-- 140_proof_state_control_kernels.sql
-- Master Operating Statement 2026-10-07: explicit proof graph, state/invariant
-- journal, safety budget and closed-loop control records.
-- These structures are auditable boundaries; they do not enable autonomous
-- production mutation by themselves.
BEGIN;

CREATE TABLE IF NOT EXISTS network_proof_graph_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  node_type text NOT NULL CHECK (node_type IN (
    'CLAIM','OBJECT','RELATIONSHIP','OBSERVATION','EVIDENCE','ACTOR',
    'DEVICE','TIME','LOCATION','METHOD','MEASUREMENT','INSTRUMENT',
    'CALIBRATION','HASH','ACCEPTANCE'
  )),
  node_key text NOT NULL,
  resource_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  node_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,node_type,node_key)
);
CREATE INDEX IF NOT EXISTS idx_proof_nodes_resource
  ON network_proof_graph_nodes(tenant_id,resource_id,node_type);

CREATE TABLE IF NOT EXISTS network_proof_graph_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  from_node_id uuid NOT NULL REFERENCES network_proof_graph_nodes(id) ON DELETE CASCADE,
  to_node_id uuid NOT NULL REFERENCES network_proof_graph_nodes(id) ON DELETE CASCADE,
  relation text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal > 0),
  edge_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,from_node_id,to_node_id,relation,ordinal)
);

CREATE OR REPLACE FUNCTION public.fiberos_proof_graph_tenant_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE a uuid; b uuid;
BEGIN
  SELECT tenant_id INTO a FROM public.network_proof_graph_nodes WHERE id=NEW.from_node_id;
  SELECT tenant_id INTO b FROM public.network_proof_graph_nodes WHERE id=NEW.to_node_id;
  IF a IS DISTINCT FROM NEW.tenant_id OR b IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'PROOF_GRAPH_NODE_TENANT_MISMATCH' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.fiberos_proof_graph_tenant_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_proof_graph_edge_tenant ON public.network_proof_graph_edges;
CREATE TRIGGER trg_proof_graph_edge_tenant
BEFORE INSERT OR UPDATE ON public.network_proof_graph_edges
FOR EACH ROW EXECUTE FUNCTION public.fiberos_proof_graph_tenant_guard();

CREATE TABLE IF NOT EXISTS network_state_transition_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  preconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  required_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  invariants jsonb NOT NULL DEFAULT '[]'::jsonb,
  side_effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  postconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy_version text NOT NULL,
  rule_hash char(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,entity_type,from_state,to_state,policy_version)
);

CREATE TABLE IF NOT EXISTS network_state_transitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  from_state text NOT NULL,
  to_state text NOT NULL,
  command_id uuid REFERENCES network_authorized_commands(id) ON DELETE RESTRICT,
  actor_id uuid,
  policy_version text,
  preconditions_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_ids uuid[] NOT NULL DEFAULT '{}',
  invariant_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  side_effects jsonb NOT NULL DEFAULT '[]'::jsonb,
  postconditions jsonb NOT NULL DEFAULT '[]'::jsonb,
  transition_hash char(64) NOT NULL,
  status text NOT NULL CHECK (status IN ('PROPOSED','AUTHORIZED','EXECUTED','VERIFIED','REJECTED','ROLLED_BACK','FAILED')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,transition_hash)
);

CREATE TABLE IF NOT EXISTS network_safety_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  command_id uuid REFERENCES network_authorized_commands(id) ON DELETE RESTRICT,
  target_type text NOT NULL,
  target_id uuid,
  max_affected_customers integer CHECK (max_affected_customers IS NULL OR max_affected_customers >= 0),
  max_affected_services integer CHECK (max_affected_services IS NULL OR max_affected_services >= 0),
  max_capacity_loss numeric CHECK (max_capacity_loss IS NULL OR max_capacity_loss >= 0),
  max_shared_risk_domains integer CHECK (max_shared_risk_domains IS NULL OR max_shared_risk_domains >= 0),
  window_start timestamptz,
  window_end timestamptz,
  rollback_required boolean NOT NULL DEFAULT true,
  actual_impact jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL DEFAULT 'UNASSESSED' CHECK (decision IN ('UNASSESSED','ALLOW','BLOCK','REVIEW')),
  decision_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (window_end IS NULL OR window_start IS NULL OR window_end > window_start)
);

CREATE TABLE IF NOT EXISTS network_control_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  correlation_id text NOT NULL,
  stage text NOT NULL CHECK (stage IN (
    'MONITOR','ANALYZE','REFLECT','DECIDE','POLICY','AUTH','EXECUTE',
    'VERIFY','ROLLBACK','COMMIT','LEARN'
  )),
  input_hash char(64) NOT NULL,
  output_hash char(64),
  policy_version text,
  command_id uuid REFERENCES network_authorized_commands(id) ON DELETE RESTRICT,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  autonomous boolean NOT NULL DEFAULT false CHECK (autonomous=false),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,correlation_id,stage,input_hash)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'network_proof_graph_nodes','network_proof_graph_edges',
    'network_state_transition_rules','network_state_transitions',
    'network_safety_budgets','network_control_cycles'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON public.%I',t,t);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON public.%I FOR ALL TO authenticated USING (fiberos_enterprise_tenant_ok(tenant_id)) WITH CHECK (fiberos_enterprise_tenant_ok(tenant_id))',
      t,t
    );
  END LOOP;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'network_proof_graph_nodes','network_proof_graph_edges',
    'network_state_transition_rules','network_state_transitions',
    'network_safety_budgets','network_control_cycles'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s_immutable ON public.%I',t,t);
    EXECUTE format('CREATE TRIGGER trg_%s_immutable BEFORE UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fiberos_reject_history_mutation()',t,t);
  END LOOP;
END $$;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
  ON network_proof_graph_nodes, network_proof_graph_edges,
     network_state_transition_rules, network_state_transitions,
     network_safety_budgets, network_control_cycles
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON
  network_proof_graph_nodes, network_proof_graph_edges,
  network_state_transition_rules, network_state_transitions,
  network_safety_budgets, network_control_cycles
  TO authenticated;

COMMENT ON TABLE network_proof_graph_nodes IS 'Proof-carrying graph nodes; evidence identity is explicit and auditable.';
COMMENT ON TABLE network_state_transition_rules IS 'Declarative lifecycle rule registry; enforcement remains at authoritative transaction boundaries.';
COMMENT ON TABLE network_safety_budgets IS 'Bounded impact budget for controlled commands; no budget grants authorization.';
COMMENT ON TABLE network_control_cycles IS 'Closed-loop operational stages; autonomous execution is structurally disabled.';

COMMIT;
