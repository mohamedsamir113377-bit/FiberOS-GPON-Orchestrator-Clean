-- 004_audit_log.sql
-- append-only audit_log + triggers
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create table if not exists audit_log (
    id              bigint generated always as identity primary key,
    "timestamp"     timestamptz not null default now(),
    actor_id        uuid,
    action          text not null,
    ref_id          text,
    detail          text,
    prev_hash       text,
    event_hash_chain text not null
);
create index if not exists idx_audit_actor on audit_log (actor_id);
create index if not exists idx_audit_ref on audit_log (ref_id);

create or replace function reject_audit_mutation() returns trigger as $$
begin
    raise exception 'audit_log is append-only: % not permitted', TG_OP;
end;
$$ language plpgsql;

drop trigger if exists trg_audit_no_update on audit_log;
create trigger trg_audit_no_update before update on audit_log
    for each row execute function reject_audit_mutation();

drop trigger if exists trg_audit_no_delete on audit_log;
create trigger trg_audit_no_delete before delete on audit_log
    for each row execute function reject_audit_mutation();

-- ---------------------------------------------------------------------

