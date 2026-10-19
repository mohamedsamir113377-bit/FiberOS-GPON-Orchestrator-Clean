-- 002_identity_technicians.sql
-- technicians + user_id mapping
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create table if not exists technicians (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid unique references auth.users(id) on delete restrict,
    name            text not null,
    zone            text,
    skills          text[] default '{}',
    current_gps     geography(Point, 4326),
    battery_status  smallint check (battery_status between 0 and 100),
    is_active       boolean default true,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);

-- Safe migration for an existing technicians table.
alter table technicians add column if not exists user_id uuid;
create unique index if not exists uq_technicians_user_id
    on technicians(user_id) where user_id is not null;
alter table technicians
    drop constraint if exists technicians_user_id_fkey;
alter table technicians
    add constraint technicians_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete restrict;

create index if not exists idx_technicians_gps on technicians using gist (current_gps);

