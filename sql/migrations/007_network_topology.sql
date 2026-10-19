-- 007_network_topology.sql
-- assets ports capacity view
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create table if not exists network_assets (
    id              uuid primary key default gen_random_uuid(),
    asset_code      text unique not null,                 -- e.g. 'A-12', 'OLT-MA5800'
    asset_type      text not null check (asset_type in ('OLT','MDF','FDT','PFP','FAT','SPLITTER','ONT')),
    parent_asset_id uuid references network_assets(id) on delete restrict,
    name            text,
    region          text,
    gps             geography(Point, 4326),
    total_ports     smallint,
    splitter_ratio  text,                                  -- e.g. '1:8', '1:32'
    status          text default 'active' check (status in ('active','degrading','critical','decommissioned')),
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);
create index if not exists idx_network_assets_parent on network_assets (parent_asset_id);
create index if not exists idx_network_assets_type on network_assets (asset_type);
create index if not exists idx_network_assets_gps on network_assets using gist (gps);

create table if not exists network_ports (
    id                    uuid primary key default gen_random_uuid(),
    asset_id              uuid not null references network_assets(id) on delete cascade,
    port_number           integer not null,
    port_type             text check (port_type in ('pon','uplink','drop','splitter_leg')),
    status                text default 'free' check (status in ('free','used','faulty','reserved')),
    connected_asset_id    uuid references network_assets(id),   -- e.g. ONT this port serves
    connected_customer_id uuid,                                  -- optional FK to your customers table
    created_at            timestamptz default now(),
    updated_at            timestamptz default now(),
    unique (asset_id, port_number)
);
create index if not exists idx_network_ports_asset on network_ports (asset_id);
create index if not exists idx_network_ports_status on network_ports (status);

-- Capacity is DERIVED, never hand-entered — this is what actually closes
-- the 'capacity contradiction' gap: total/used come from
-- counting real rows, not from a number someone typed once and forgot.
create or replace view network_asset_capacity as
  select a.id as asset_id, a.asset_code, a.total_ports,
         count(p.*) filter (where p.status = 'used') as used_ports,
         count(p.*) as provisioned_ports,
         (a.total_ports is not null and count(p.*) filter (where p.status = 'used') > a.total_ports) as over_capacity
  from network_assets a
  left join network_ports p on p.asset_id = a.id
  group by a.id, a.asset_code, a.total_ports;

-- optical_measurements: every Rx/OTDR reading MUST declare its source.
-- This is the direct fix for 'Virtual OTDR = explicit simulation' being read as

