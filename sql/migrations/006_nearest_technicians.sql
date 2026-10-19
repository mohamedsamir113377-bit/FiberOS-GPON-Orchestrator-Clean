-- 006_nearest_technicians.sql
-- geo dispatch RPC with role gate
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create or replace function nearest_technicians(
    target_lat double precision,
    target_lon double precision,
    max_meters integer default 5000
) returns table (technician_id uuid, name text, distance_m double precision)
language sql stable security invoker
set search_path = pg_catalog, public, auth
as $$
    select t.id, t.name,
           ST_Distance(t.current_gps, ST_MakePoint(target_lon, target_lat)::geography) as distance_m
    from technicians t
    where t.is_active = true
      and fiberos_has_any_role(array['ops_manager','area_supervisor','exec','sysadmin','dispatcher'])
      and ST_DWithin(t.current_gps, ST_MakePoint(target_lon, target_lat)::geography, max_meters)
    order by distance_m asc;
$$;

revoke all on function nearest_technicians(double precision, double precision, integer) from public, anon, authenticated;
grant execute on function nearest_technicians(double precision, double precision, integer) to authenticated;

-- ---------------------------------------------------------------------
-- P1 ADDITION (audit item 'no physical asset network model' / 'no trace of a unified physical layer'): the app previously had NO persisted physical-topology model —
-- OLT/FAT/ONT relationships lived only as loose string tags on customer
-- rows (box/cab/main) and as in-browser demo arrays (BOXES, GPON). This
-- is a first cut of a real asset hierarchy + port + measurement model.
-- It intentionally does not replace anything client-side yet; it is the
-- backend counterpart the client-side FiberOSNetworkTopology sync
-- (see FiberOSNocIntelligence.syncAssetsFromLiveInventory in-app) should

