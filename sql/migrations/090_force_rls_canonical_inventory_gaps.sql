-- 090_force_rls_canonical_inventory_gaps.sql
-- Aligns the database migration chain with the runtime gate's canonical RLS contract.
--
-- The 82 canonical tenant-sensitive tables are required to have both RLS ENABLED
-- and RLS FORCED before the application may report a verified runtime. Earlier
-- migrations enabled RLS on a set of later operational/enterprise/FTTH tables but
-- did not force it. Those tables were therefore validly protected for constrained
-- runtime roles, but the owner role could still bypass RLS. The runtime gate
-- intentionally rejects that mismatch rather than silently downgrading its check.
--
-- This migration adds FORCE RLS only; it does not invent policies or change the
-- policy predicates. Existing runtime roles remain subject to the same policies.
-- Owner/maintenance sessions are deliberately brought under the same RLS boundary.

ALTER TABLE contractor_entities FORCE ROW LEVEL SECURITY;
ALTER TABLE contractor_qualifications FORCE ROW LEVEL SECURITY;
ALTER TABLE contractor_work_authorizations FORCE ROW LEVEL SECURITY;
ALTER TABLE contractor_work_measurements FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_dashboard_contracts FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_departments FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_positions FORCE ROW LEVEL SECURITY;
ALTER TABLE enterprise_scope_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_activation_events FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_cable_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_construction_evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_customer_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_duct_segments FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_odn_connections FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_programs FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_quality_gates FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_splices FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_events FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_package_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE ftth_work_packages FORCE ROW LEVEL SECURITY;
ALTER TABLE material_chain_events FORCE ROW LEVEL SECURITY;
