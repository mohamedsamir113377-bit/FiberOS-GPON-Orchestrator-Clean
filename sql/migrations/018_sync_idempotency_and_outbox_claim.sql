-- FiberOS Enterprise Sync + Outbox reliability boundary.
create table if not exists sync_operations (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references tenants(id) on delete restrict,
 client_id text not null,
 operation_id text not null,
 operation_type text not null,
 aggregate_type text,
 aggregate_id text,
 base_version bigint,
 payload jsonb not null,
 request_hash char(64) not null,
 status text not null default 'PENDING' check(status in ('PENDING','SENDING','ACKED','REJECTED','CONFLICT')),
 server_version bigint,
 rejection_code text,
 rejection_detail text,
 created_at timestamptz not null default now(),
 processed_at timestamptz,
 unique(tenant_id,client_id,operation_id),
 unique(tenant_id,request_hash)
);
create index if not exists idx_sync_pending on sync_operations(tenant_id,status,created_at);
alter table sync_operations enable row level security;
alter table sync_operations force row level security;
drop policy if exists sync_member on sync_operations;
create policy sync_member on sync_operations for all to authenticated
using(exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=sync_operations.tenant_id))
with check(exists(select 1 from user_preferences up where up.user_id=auth.uid() and up.tenant_id=sync_operations.tenant_id));

alter table outbox_events add column if not exists locked_until timestamptz;
alter table outbox_events add column if not exists locked_by text;
create index if not exists idx_outbox_claim on outbox_events(publish_status,locked_until,created_at);

create or replace function fiberos_ingest_sync_batch(p_ops jsonb,p_principal jsonb) returns jsonb
language plpgsql security invoker as $$
declare op jsonb; tenant uuid; inserted int:=0; duplicate int:=0; rejected int:=0; out_arr jsonb:='[]'::jsonb;
begin
 select tenant_id into tenant from user_preferences where user_id=auth.uid() limit 1;
 if tenant is null then raise exception 'TENANT_CONTEXT_REQUIRED'; end if;
 if jsonb_typeof(p_ops)<>'array' then raise exception 'SYNC_BATCH_MUST_BE_ARRAY'; end if;
 for op in select value from jsonb_array_elements(p_ops) loop
   begin
     insert into sync_operations(tenant_id,client_id,operation_id,operation_type,aggregate_type,aggregate_id,base_version,payload,request_hash)
     values(tenant,op->>'clientId',op->>'operationId',op->>'type',op->>'aggregateType',op->>'aggregateId',nullif(op->>'baseVersion','')::bigint,coalesce(op->'payload','{}'::jsonb),op->>'requestHash');
     inserted:=inserted+1;
     out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','PENDING'));
   exception when unique_violation then
     duplicate:=duplicate+1;
     out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','DUPLICATE'));
   when others then
     rejected:=rejected+1;
     out_arr:=out_arr||jsonb_build_array(jsonb_build_object('operationId',op->>'operationId','status','REJECTED','error',sqlerrm));
   end;
 end loop;
 return jsonb_build_object('inserted',inserted,'duplicate',duplicate,'rejected',rejected,'operations',out_arr);
end $$;
