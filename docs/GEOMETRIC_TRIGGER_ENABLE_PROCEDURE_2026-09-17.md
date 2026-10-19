# Geometric Plausibility Trigger — Enable Procedure

Migration `084_geometric_plausibility_precheck.sql` creates:
- Function `fiberos_assess_path_plausibility(geometry, ...)`
- Trigger `trg_cable_segment_plausibility` on `ftth_cable_segments` **DISABLED by default**

## Before enabling
1. Sample existing cable geometries:
   ```sql
   SELECT id, ST_NPoints(geometry) AS verts,
          ST_Length(geometry::geography) AS len_m
   FROM ftth_cable_segments
   WHERE geometry IS NOT NULL
   LIMIT 100;
   ```
2. Choose thresholds that match your network (defaults: 5000 m / 3 vertices / 1 m min).
3. Dry-run the function on known good and bad rows.

## Enable (buyer decision)
```sql
ALTER TABLE public.ftth_cable_segments
  ENABLE TRIGGER trg_cable_segment_plausibility;
```

## Disable
```sql
ALTER TABLE public.ftth_cable_segments
  DISABLE TRIGGER trg_cable_segment_plausibility;
```

## Truth note
This is a plausibility pre-check, not proof of field survey accuracy. PostGIS remains authoritative for storage; survey process remains authoritative for ground truth.

---
*Procedure 2026-09-17*
