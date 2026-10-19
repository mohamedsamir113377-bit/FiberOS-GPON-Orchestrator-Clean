# Deep Field Operations Intelligence — 2026-10-03

This release extension is intentionally source-backed and deterministic. It does not create synthetic alarms, optical readings, GPS positions, customer counts, or provider connectivity.

## 1. Alarm Correlation + Root Cause Candidate Graph
`alarm_signals` stores tenant-scoped alarm observations. The API correlates observations inside an explicit time window and explicit physical topology graph. Candidate support is calculated from observed signal count and observed downstream relationships. The result is advisory: no automatic isolation, remediation, dispatch, or prediction is performed.

## 2. Optical Health Timeline
`optical_health_timeline` exposes append-only optical measurements with previous-value deltas. The runtime calculates a linear trend from observed samples only. A degradation flag is emitted only when the caller supplies an explicit rate threshold; there is no forecasting.

## 3. Field Evidence Chain
The runtime joins existing ticket, technician, technician-position, splice, card/port/asset, evidence, and optical records where real relationships exist. The chain is canonicalized and SHA-256 hashed. Complete chains can be persisted as `evidence_chain_certificates`; when the production `LEDGER_SECRET_KEY` is available, the certificate event is additionally appended to the existing append-only hash ledger. Missing links block certification rather than being invented.

## 4. PON/Port Capacity Intelligence
`pon_capacity_intelligence` derives used/reserved/provisioned/free port counts from `network_ports` and `network_assets.total_ports`. It reports over-capacity and headroom states without trusting a manually entered used/free number.

## Acceptance boundary
Static JavaScript, migration, route-authorization, manifest, and package tests can be executed from the archive. Live acceptance of alarm ingestion, PostgreSQL/PostGIS, ZTE/NMS data, object storage, and production hash-ledger secrets remains environment-specific.
