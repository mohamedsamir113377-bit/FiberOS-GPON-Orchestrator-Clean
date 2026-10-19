-- Wave 10: Customer impact + GIS fusion foundation
-- Read-model support only. No synthetic customer impact and no autonomous actions.
-- services is tenant-scoped, but does not expose an asset_id column in the canonical schema.
-- Keep this migration limited to columns that actually exist.
create index if not exists idx_services_tenant_customer
on services(tenant_id, customer_ref);
