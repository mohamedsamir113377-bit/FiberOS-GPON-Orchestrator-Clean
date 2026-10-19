-- 008_optical_measurements.sql
-- measurements with mandatory source
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create table if not exists optical_measurements (
    id                bigint generated always as identity primary key,
    asset_id          uuid references network_assets(id) on delete cascade,
    port_id           uuid references network_ports(id) on delete set null,
    measurement_type  text not null check (measurement_type in ('rx_power','otdr_trace','insertion_loss')),
    value_numeric     numeric(8,3),
    unit              text,
    sor_file_ref      text,                                 -- storage path to a real .SOR file, if any
    source            text not null check (source in ('field_reading','nms_poll','ai_simulated')),
    measured_by       uuid references technicians(id),
    measured_at       timestamptz default now()
);
create index if not exists idx_optical_measurements_asset on optical_measurements (asset_id, measured_at desc);
create index if not exists idx_optical_measurements_source on optical_measurements (source);

alter table network_assets enable row level security;
alter table network_ports enable row level security;
alter table optical_measurements enable row level security;

create policy network_assets_read_authenticated on network_assets
for select using (auth.uid() is not null);
create policy network_assets_write_management on network_assets
for all using (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']))
with check (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));

create policy network_ports_read_authenticated on network_ports
for select using (auth.uid() is not null);
create policy network_ports_write_management on network_ports
for all using (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']))
with check (fiberos_has_any_role(array['ops_manager','area_supervisor','sysadmin']));

create policy optical_measurements_read_authenticated on optical_measurements
for select using (auth.uid() is not null);
create policy optical_measurements_insert_field_or_management on optical_measurements
for insert with check (
  fiberos_ticket_is_owned(measured_by)
  or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin'])
);
-- No update/delete policy on optical_measurements: like audit_log, optical
-- readings should be append-only history, not editable after the fact.

-- ---------------------------------------------------------------------

