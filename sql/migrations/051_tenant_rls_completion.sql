-- FiberOS migration 051: tenant-wide RLS completion
-- Fail-closed: tenant identity comes only from fiberos_current_tenant_id().

do $$ begin if to_regprocedure('public.fiberos_current_tenant_id()') is null then raise exception 'RLS_PREREQUISITE_MISSING: fiberos_current_tenant_id()'; end if; end $$;

alter table data_conflicts enable row level security;
alter table data_conflicts force row level security;
drop policy if exists data_conflicts_tenant_select on data_conflicts;
create policy data_conflicts_tenant_select on data_conflicts for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists data_conflicts_tenant_insert_management on data_conflicts;
create policy data_conflicts_tenant_insert_management on data_conflicts for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists data_conflicts_tenant_update_management on data_conflicts;
create policy data_conflicts_tenant_update_management on data_conflicts for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists data_conflicts_tenant_delete_management on data_conflicts;
create policy data_conflicts_tenant_delete_management on data_conflicts for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_data_conflicts_tenant_id on data_conflicts(tenant_id);

alter table decision_certificates enable row level security;
alter table decision_certificates force row level security;
drop policy if exists decision_certificates_tenant_select on decision_certificates;
create policy decision_certificates_tenant_select on decision_certificates for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists decision_certificates_tenant_insert_management on decision_certificates;
create policy decision_certificates_tenant_insert_management on decision_certificates for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists decision_certificates_tenant_update_management on decision_certificates;
create policy decision_certificates_tenant_update_management on decision_certificates for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists decision_certificates_tenant_delete_management on decision_certificates;
create policy decision_certificates_tenant_delete_management on decision_certificates for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_decision_certificates_tenant_id on decision_certificates(tenant_id);

alter table decision_executions enable row level security;
alter table decision_executions force row level security;
drop policy if exists decision_executions_tenant_select on decision_executions;
create policy decision_executions_tenant_select on decision_executions for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists decision_executions_tenant_insert_management on decision_executions;
create policy decision_executions_tenant_insert_management on decision_executions for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists decision_executions_tenant_update_management on decision_executions;
create policy decision_executions_tenant_update_management on decision_executions for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists decision_executions_tenant_delete_management on decision_executions;
create policy decision_executions_tenant_delete_management on decision_executions for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_decision_executions_tenant_id on decision_executions(tenant_id);

alter table decision_rollbacks enable row level security;
alter table decision_rollbacks force row level security;
drop policy if exists decision_rollbacks_tenant_select on decision_rollbacks;
create policy decision_rollbacks_tenant_select on decision_rollbacks for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists decision_rollbacks_tenant_insert_management on decision_rollbacks;
create policy decision_rollbacks_tenant_insert_management on decision_rollbacks for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists decision_rollbacks_tenant_update_management on decision_rollbacks;
create policy decision_rollbacks_tenant_update_management on decision_rollbacks for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists decision_rollbacks_tenant_delete_management on decision_rollbacks;
create policy decision_rollbacks_tenant_delete_management on decision_rollbacks for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_decision_rollbacks_tenant_id on decision_rollbacks(tenant_id);

alter table engineering_calibrations enable row level security;
alter table engineering_calibrations force row level security;
drop policy if exists engineering_calibrations_tenant_select on engineering_calibrations;
create policy engineering_calibrations_tenant_select on engineering_calibrations for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists engineering_calibrations_tenant_insert_management on engineering_calibrations;
create policy engineering_calibrations_tenant_insert_management on engineering_calibrations for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists engineering_calibrations_tenant_update_management on engineering_calibrations;
create policy engineering_calibrations_tenant_update_management on engineering_calibrations for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists engineering_calibrations_tenant_delete_management on engineering_calibrations;
create policy engineering_calibrations_tenant_delete_management on engineering_calibrations for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_engineering_calibrations_tenant_id on engineering_calibrations(tenant_id);

alter table fiber_cables enable row level security;
alter table fiber_cables force row level security;
drop policy if exists fiber_cables_tenant_select on fiber_cables;
create policy fiber_cables_tenant_select on fiber_cables for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists fiber_cables_tenant_write_management on fiber_cables;
create policy fiber_cables_tenant_write_management on fiber_cables for all to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
create index if not exists idx_fiber_cables_tenant_id on fiber_cables(tenant_id);

alter table fiber_core_links enable row level security;
alter table fiber_core_links force row level security;
drop policy if exists fiber_core_links_tenant_select on fiber_core_links;
create policy fiber_core_links_tenant_select on fiber_core_links for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists fiber_core_links_tenant_write_management on fiber_core_links;
create policy fiber_core_links_tenant_write_management on fiber_core_links for all to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
create index if not exists idx_fiber_core_links_tenant_id on fiber_core_links(tenant_id);

alter table fiber_cores enable row level security;
alter table fiber_cores force row level security;
drop policy if exists fiber_cores_tenant_select on fiber_cores;
create policy fiber_cores_tenant_select on fiber_cores for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists fiber_cores_tenant_write_management on fiber_cores;
create policy fiber_cores_tenant_write_management on fiber_cores for all to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
create index if not exists idx_fiber_cores_tenant_id on fiber_cores(tenant_id);

alter table model_predictions enable row level security;
alter table model_predictions force row level security;
drop policy if exists model_predictions_tenant_select on model_predictions;
create policy model_predictions_tenant_select on model_predictions for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists model_predictions_tenant_insert_management on model_predictions;
create policy model_predictions_tenant_insert_management on model_predictions for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists model_predictions_tenant_update_management on model_predictions;
create policy model_predictions_tenant_update_management on model_predictions for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists model_predictions_tenant_delete_management on model_predictions;
create policy model_predictions_tenant_delete_management on model_predictions for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_model_predictions_tenant_id on model_predictions(tenant_id);

alter table physical_topology_edges enable row level security;
alter table physical_topology_edges force row level security;
drop policy if exists physical_topology_edges_tenant_select on physical_topology_edges;
create policy physical_topology_edges_tenant_select on physical_topology_edges for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists physical_topology_edges_tenant_write_management on physical_topology_edges;
create policy physical_topology_edges_tenant_write_management on physical_topology_edges for all to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
create index if not exists idx_physical_topology_edges_tenant_id on physical_topology_edges(tenant_id);

alter table security_events enable row level security;
alter table security_events force row level security;
drop policy if exists security_events_tenant_select on security_events;
create policy security_events_tenant_select on security_events for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists security_events_tenant_insert_management on security_events;
create policy security_events_tenant_insert_management on security_events for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists security_events_tenant_update_management on security_events;
create policy security_events_tenant_update_management on security_events for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists security_events_tenant_delete_management on security_events;
create policy security_events_tenant_delete_management on security_events for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_security_events_tenant_id on security_events(tenant_id);

alter table truth_facts enable row level security;
alter table truth_facts force row level security;
drop policy if exists truth_facts_tenant_select on truth_facts;
create policy truth_facts_tenant_select on truth_facts for select to authenticated using (tenant_id = fiberos_current_tenant_id());
drop policy if exists truth_facts_tenant_insert_management on truth_facts;
create policy truth_facts_tenant_insert_management on truth_facts for insert to authenticated with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin']));
drop policy if exists truth_facts_tenant_update_management on truth_facts;
create policy truth_facts_tenant_update_management on truth_facts for update to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin'])) with check (tenant_id = fiberos_current_tenant_id() and fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));
drop policy if exists truth_facts_tenant_delete_management on truth_facts;
create policy truth_facts_tenant_delete_management on truth_facts for delete to authenticated using (tenant_id = fiberos_current_tenant_id() and fiberos_has_role('sysadmin'));
create index if not exists idx_truth_facts_tenant_id on truth_facts(tenant_id);

