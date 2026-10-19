-- outbox reliability columns
alter table outbox_events add column if not exists attempts int not null default 0;
alter table outbox_events add column if not exists last_error text;
alter table outbox_events add column if not exists published_at timestamptz;

-- hash_ledger insert for authenticated (append-only still enforced by trigger on update/delete)
drop policy if exists hash_ledger_insert_auth on hash_ledger;
create policy hash_ledger_insert_auth on hash_ledger
  for insert to authenticated
  with check (fiberos_has_any_role(array['field_tech','qc','ops_manager','dispatcher','sysadmin','area_supervisor']));

drop policy if exists hash_ledger_select_ops on hash_ledger;
create policy hash_ledger_select_ops on hash_ledger
  for select to authenticated
  using (fiberos_has_any_role(array['ops_manager','sysadmin','qc','area_supervisor','exec']));
