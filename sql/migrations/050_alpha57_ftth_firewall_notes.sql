-- 050_alpha57_ftth_firewall_notes.sql
-- Alpha 57 does not alter the authoritative Zero-Trust schema.
-- FTTH measurement source constraints and network_asset_capacity view
-- already exist from earlier migrations (optical_measurements.source CHECK,
-- network_assets / network_ports).
-- This migration is a documentation anchor + optional comment for operators.

-- No structural DDL required for Alpha 57 domain packages.
-- Application-level enforcement:
--   packages/ftth-measurements (close gate + GPON window)
--   packages/security-firewall (HTTP request boundary)
--   packages/digital-twin-gis (hierarchy + derived capacity)

SELECT 1 AS alpha57_noop;
