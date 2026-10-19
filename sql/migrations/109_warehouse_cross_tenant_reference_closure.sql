-- R14.1 deep-operations integrity closure.
-- Prevent UUID-only foreign keys in the 108 warehouse model from creating
-- cross-tenant relationships when a caller knows an object UUID.
BEGIN;

-- Parent bins must belong to the same tenant as the child bin.
ALTER TABLE warehouse_bins
  ADD CONSTRAINT warehouse_bins_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE warehouse_bins
  DROP CONSTRAINT IF EXISTS warehouse_bins_parent_bin_id_fkey;
ALTER TABLE warehouse_bins
  DROP CONSTRAINT IF EXISTS warehouse_bins_parent_bin_tenant_fk;
ALTER TABLE warehouse_bins
  ADD CONSTRAINT warehouse_bins_parent_bin_tenant_fk
  FOREIGN KEY (parent_bin_id, warehouse_id, tenant_id)
  REFERENCES warehouse_bins(id, warehouse_id, tenant_id)
  ON DELETE RESTRICT;

-- Transfer rows and their line items must remain tenant-consistent.
ALTER TABLE warehouse_transfers
  ADD CONSTRAINT warehouse_transfers_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE warehouse_transfer_lines
  DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_transfer_id_fkey;
ALTER TABLE warehouse_transfer_lines
  ADD CONSTRAINT warehouse_transfer_lines_transfer_tenant_fk
  FOREIGN KEY (transfer_id, tenant_id)
  REFERENCES warehouse_transfers(id, tenant_id)
  ON DELETE CASCADE;

-- Inventory items are globally UUID-keyed but tenant-owned. Add a composite
-- uniqueness key so transfer lines cannot point at another tenant's item.
ALTER TABLE inventory_items
  ADD CONSTRAINT inventory_items_id_tenant_key UNIQUE (id, tenant_id);

ALTER TABLE warehouse_transfer_lines
  DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_item_id_fkey;
ALTER TABLE warehouse_transfer_lines
  ADD CONSTRAINT warehouse_transfer_lines_item_tenant_fk
  FOREIGN KEY (item_id, tenant_id)
  REFERENCES inventory_items(id, tenant_id)
  ON DELETE RESTRICT;

-- Source/target bins must belong to the same tenant as the transfer line.
ALTER TABLE warehouse_transfer_lines
  DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_source_bin_id_fkey,
  DROP CONSTRAINT IF EXISTS warehouse_transfer_lines_target_bin_id_fkey;

ALTER TABLE warehouse_transfer_lines
  ADD CONSTRAINT warehouse_transfer_lines_source_bin_tenant_fk
  FOREIGN KEY (source_bin_id, tenant_id)
  REFERENCES warehouse_bins(id, tenant_id)
  ON DELETE RESTRICT,
  ADD CONSTRAINT warehouse_transfer_lines_target_bin_tenant_fk
  FOREIGN KEY (target_bin_id, tenant_id)
  REFERENCES warehouse_bins(id, tenant_id)
  ON DELETE RESTRICT;

-- UUID/tenant integrity alone does not encode which warehouse a transfer line
-- is leaving/entering. This trigger closes that remaining same-tenant data
-- integrity gap without trusting client-provided warehouse ownership.
CREATE OR REPLACE FUNCTION fiberos_validate_warehouse_transfer_line_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_source_warehouse uuid;
  v_target_warehouse uuid;
  v_source_bin_warehouse uuid;
  v_target_bin_warehouse uuid;
BEGIN
  SELECT source_warehouse_id, target_warehouse_id
    INTO v_source_warehouse, v_target_warehouse
    FROM warehouse_transfers
   WHERE id = NEW.transfer_id
     AND tenant_id = NEW.tenant_id;

  IF v_source_warehouse IS NULL OR v_target_warehouse IS NULL THEN
    RAISE EXCEPTION 'WAREHOUSE_TRANSFER_TENANT_CONTEXT_INVALID';
  END IF;

  IF NEW.source_bin_id IS NOT NULL THEN
    SELECT warehouse_id INTO v_source_bin_warehouse
      FROM warehouse_bins
     WHERE id = NEW.source_bin_id
       AND tenant_id = NEW.tenant_id;
    IF v_source_bin_warehouse IS NULL OR v_source_bin_warehouse <> v_source_warehouse THEN
      RAISE EXCEPTION 'WAREHOUSE_TRANSFER_SOURCE_BIN_SCOPE_INVALID';
    END IF;
  END IF;

  IF NEW.target_bin_id IS NOT NULL THEN
    SELECT warehouse_id INTO v_target_bin_warehouse
      FROM warehouse_bins
     WHERE id = NEW.target_bin_id
       AND tenant_id = NEW.tenant_id;
    IF v_target_bin_warehouse IS NULL OR v_target_bin_warehouse <> v_target_warehouse THEN
      RAISE EXCEPTION 'WAREHOUSE_TRANSFER_TARGET_BIN_SCOPE_INVALID';
    END IF;
  END IF;

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS warehouse_transfer_lines_scope_guard ON warehouse_transfer_lines;
CREATE TRIGGER warehouse_transfer_lines_scope_guard
BEFORE INSERT OR UPDATE OF tenant_id, transfer_id, source_bin_id, target_bin_id
ON warehouse_transfer_lines
FOR EACH ROW
EXECUTE FUNCTION fiberos_validate_warehouse_transfer_line_scope();

REVOKE ALL ON FUNCTION fiberos_validate_warehouse_transfer_line_scope() FROM PUBLIC, anon, authenticated, fiberos_app;

COMMIT;
