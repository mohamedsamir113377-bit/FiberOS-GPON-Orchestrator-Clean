-- FiberOS Alpha47 — SLA / Operational Command foundation
-- No synthetic SLA deadlines are generated. A ticket participates in SLA
-- metrics only when sla_deadline is explicitly persisted by an authorized
-- workflow/provider.
alter table tickets add column if not exists sla_deadline timestamptz;
alter table tickets add column if not exists first_assigned_at timestamptz;
alter table tickets add column if not exists closed_at timestamptz;

create index if not exists idx_tickets_tenant_sla_open
  on tickets(tenant_id, sla_deadline)
  where sla_deadline is not null
    and status not in ('completed','cancelled','rejected','faulty');
create index if not exists idx_tickets_tenant_closed_at
  on tickets(tenant_id, closed_at)
  where closed_at is not null;

comment on column tickets.sla_deadline is
  'Authoritative SLA deadline. Null means no SLA deadline is currently assigned; never inferred by the dashboard.';
comment on column tickets.first_assigned_at is
  'First persisted assignment timestamp; populated only by the DB-authoritative lifecycle transition.';
comment on column tickets.closed_at is
  'Authoritative terminal timestamp; populated only by the DB-authoritative lifecycle transition.';
