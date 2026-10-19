-- 001_extensions.sql
-- PostGIS + pgcrypto
-- FiberOS migration — apply in order
-- Requires: Postgres 15+, extensions from 001

create extension if not exists postgis;
create extension if not exists pgcrypto;

