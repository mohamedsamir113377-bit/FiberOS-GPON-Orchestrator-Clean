-- FiberOS cluster-admin extension bootstrap.
-- Required before the application migration runner when the migration role is not a superuser.
-- This is infrastructure bootstrap, not application runtime code.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
-- Required by migration 165 EXCLUDE (GiST) constraint on field_visit_time_slots.
CREATE EXTENSION IF NOT EXISTS btree_gist;
