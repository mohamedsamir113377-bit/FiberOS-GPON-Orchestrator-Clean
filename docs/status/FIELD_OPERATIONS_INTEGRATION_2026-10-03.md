# FiberOS R14.1 — Field Operations Integration Update (2026-10-03)

This buyer ZIP incorporates the ordered field-operations update without synthetic telemetry.

1. ZTE RX optical-power adapter: read-only SNMP, opt-in through `NMS_VENDOR=zte`, env/secret injected credentials, explicit sentinel/error handling.
2. OTDR SOR ingestion: SR-4731 parser boundary with CRC validation; structural-only fallback remains explicitly gated and does not create measured values.
3. Field topology/workers: card/port mapping, worker roles, ticket worker assignments, and splice records with tenant checks.
4. Realtime foundation: tenant-owned technician positions and PostgreSQL `pg_notify` event trigger; existing GIS snapshot endpoints remain the read API.
5. Dashboard read model: tenant-scoped `operations_dashboard_summary`.

Deployment verification still requires real PostgreSQL/PostGIS, real ZTE SNMP access, and a real `.SOR` fixture. The package makes no live-integration claim without those prerequisites.
