-- 010_services_evidence_outbox.sql
-- services evidence outbox
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

-- =====================================================================
-- ENG-CONTRACT v1.0 — Schema extensions (evidence · outbox · services · close states)
-- =====================================================================
alter table tickets drop constraint if exists tickets_status_check;
alter table tickets add constraint tickets_status_check
  check (status in (
    'pending','in_progress','completed','faulty','rejected','manager_review',
    'pending_signature','awaiting_evidence','compensating','cancelled'
  ));
alter table tickets add column if not exists service_id uuid;
alter table tickets add column if not exists close_measurement_id bigint;
alter table tickets add column if not exists evidence_bundle_id uuid;
alter table tickets add column if not exists signature_ref text;
alter table tickets add column if not exists close_blocked_reason text;

create table if not exists services (
    id              uuid primary key default gen_random_uuid(),
    customer_ref    text,
    subscription_ref text,
    ont_serial      text,
    asset_path      jsonb default '{}'::jsonb,
    region          text,
    sla_tier        text default 'standard',
    is_active       boolean default true,
    created_at      timestamptz default now(),
    updated_at      timestamptz default now()
);
create index if not exists idx_services_ont on services (ont_serial);
create index if not exists idx_services_customer on services (customer_ref);

alter table tickets drop constraint if exists tickets_service_id_fkey;
alter table tickets add constraint tickets_service_id_fkey
  foreign key (service_id) references services(id) on delete set null;

create table if not exists evidence (
    id                uuid primary key default gen_random_uuid(),
    ticket_id         uuid not null references tickets(id) on delete cascade,
    kind              text not null check (kind in (
      'gps_arrival','photo','ocr','rx_reading','otdr_sor','customer_confirm','tech_sign','other'
    )),
    payload           jsonb not null default '{}'::jsonb,
    source            text not null check (source in ('field','nms','system','ai_simulated')),
    captured_at       timestamptz not null default now(),
    actor_id          uuid,
    geo               geography(Point, 4326),
    content_hash      text,
    created_at        timestamptz default now()
);
create index if not exists idx_evidence_ticket on evidence (ticket_id, captured_at desc);

alter table evidence enable row level security;
drop policy if exists evidence_select_owned_or_management on evidence;
create policy evidence_select_owned_or_management on evidence
for select using (
  exists (
    select 1 from tickets tk where tk.id = evidence.ticket_id and (
      fiberos_ticket_is_owned(tk.technician_id)
      or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','exec','sysadmin'])
    )
  )
);
drop policy if exists evidence_insert_field_or_management on evidence;
create policy evidence_insert_field_or_management on evidence
for insert with check (
  exists (
    select 1 from tickets tk where tk.id = evidence.ticket_id and (
      fiberos_ticket_is_owned(tk.technician_id)
      or fiberos_has_any_role(array['qc','ops_manager','area_supervisor','sysadmin'])
    )
  )
);

create table if not exists outbox_events (
    id              bigint generated always as identity primary key,
    event_id        uuid not null default gen_random_uuid(),
    aggregate_type  text not null,
    aggregate_id    text not null,
    event_type      text not null,
    payload         jsonb not null default '{}'::jsonb,
    created_at      timestamptz not null default now(),
    published_at    timestamptz,
    publish_status  text not null default 'pending'
                    check (publish_status in ('pending','published','failed','dead_letter')),
    attempts        int not null default 0,
    last_error      text,
    unique (event_id)
);
create index if not exists idx_outbox_pending on outbox_events (publish_status, created_at)
  where publish_status = 'pending';
alter table outbox_events enable row level security;
drop policy if exists outbox_select_management on outbox_events;
create policy outbox_select_management on outbox_events
for select using (fiberos_has_any_role(array['ops_manager','sysadmin','exec']));

alter table tickets drop constraint if exists tickets_close_measurement_id_fkey;
alter table tickets add constraint tickets_close_measurement_id_fkey
  foreign key (close_measurement_id) references optical_measurements(id) on delete set null;



