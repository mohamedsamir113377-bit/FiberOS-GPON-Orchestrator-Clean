# Deep Reality Kernel — Implementation Boundary

This change implements the first database-backed kernel boundary from the 2026-10-07 Master Operating Statement without replacing the existing FTTH core.

Implemented at source level:
- canonical semantic metadata for network assets;
- effective-dated service-path versions with database temporal exclusion;
- explicit observation evidence classes;
- proof-bearing truth claims;
- non-live counterfactual scenario records;
- bounded authorized-command records;
- continuous integrity finding storage;
- database-level uniqueness for active ODN port claims;
- tenant RLS/FORCE-RLS on all new kernel tables.

Not claimed by this change:
- live PostgreSQL/PostGIS execution on a buyer environment;
- vendor NMS/OLT connectivity;
- OTDR instrument calibration or physical fault localization;
- KMS/HSM-backed production signing;
- hosted CI success until the exact new head runs;
- production readiness.

The kernel therefore follows the statement's rule: source implementation is promoted only after tests and required runtime proof exist.
