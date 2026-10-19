-- 003_tickets.sql
-- tickets lifecycle columns
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create table if not exists tickets (
    id                    uuid primary key default gen_random_uuid(),
    status                text not null default 'pending'
                          check (status in ('pending','in_progress','completed','faulty','rejected','manager_review','pending_signature','awaiting_evidence','compensating','cancelled')),
    type                  text,
    technician_id         uuid references technicians(id),
    location_coordinates  geography(Point, 4326) not null,
    rx_power              numeric(6,2),
    ont_serial            text,
    box_code              text,
    exif_provenance       jsonb,
    confidence_score      smallint,
    requires_manager_approval boolean default false,
    approved_by           uuid references technicians(id),
    created_at            timestamptz default now(),
    updated_at            timestamptz default now()
);
create index if not exists idx_tickets_location on tickets using gist (location_coordinates);
create index if not exists idx_tickets_status on tickets (status);
create index if not exists idx_tickets_technician on tickets (technician_id);

