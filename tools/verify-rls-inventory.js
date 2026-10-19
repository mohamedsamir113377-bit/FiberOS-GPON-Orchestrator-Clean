#!/usr/bin/env node
'use strict';
/**
 * Cross-check the LIVE database against config/rls-tenant-sensitive-inventory.json.
 * Static "a policy exists" is not proof: this asserts, per tenant-sensitive table,
 * relrowsecurity AND relforcerowsecurity AND at least one policy — and that no
 * runtime identity can bypass RLS.
 * Exit 0 = proven, 1 = gap found. Usage: node tools/verify-rls-inventory.js
 */
const fs = require('node:fs');
const path = require('node:path');
const { createPool } = require('../packages/db/src');

const inventory = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'config', 'rls-tenant-sensitive-inventory.json'), 'utf8'));
const tables = inventory.tables.map((t) => t.table);

async function main() {
  const db = createPool(Object.assign({}, process.env, {
    DATABASE_URL: process.env.RUNTIME_ADMIN_DATABASE_URL || process.env.DATABASE_URL,
  }));
  if (!db.configured) { console.error('DB_NOT_CONFIGURED'); process.exitCode = 1; return; }
  const c = await db.pool.connect();
  try {
    const missingTables = await c.query(
      `select n as name from unnest($1::text[]) n
        left join pg_class c on c.relname = n and c.relnamespace = 'public'::regnamespace
       where c.oid is null`, [tables]);
    const weak = await c.query(
      `select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
              (select count(*) from pg_policies p where p.schemaname='public' and p.tablename=c.relname) as policies
         from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname = any($1)`, [tables]);
    const roles = await c.query(
      `select rolname, rolsuper, rolbypassrls from pg_roles
        where rolname in ('fiberos_runtime','fiberos_worker','fiberos_app','fiberos_migrator')`);

    const gaps = [];
    for (const r of weak.rows) {
      if (!r.rls) gaps.push(`${r.table}: RLS_NOT_ENABLED`);
      if (!r.forced) gaps.push(`${r.table}: FORCE_RLS_MISSING`);
      if (Number(r.policies) === 0) gaps.push(`${r.table}: NO_POLICY`);
    }
    for (const r of roles.rows) {
      if (r.rolsuper || r.rolbypassrls) gaps.push(`${r.rolname}: BYPASS_CAPABLE`);
    }
    for (const r of missingTables.rows) gaps.push(`${r.name}: TABLE_MISSING`);

    console.log(JSON.stringify({
      inventoryTables: tables.length,
      checkedInDatabase: weak.rows.length,
      policiesTotal: weak.rows.reduce((a, r) => a + Number(r.policies), 0),
      runtimeRolesChecked: roles.rows.length,
      gaps,
      verdict: gaps.length === 0 ? 'RLS_INVENTORY_PROVEN' : 'RLS_INVENTORY_GAP',
    }, null, 2));
    if (gaps.length) process.exitCode = 1;
  } finally { c.release(); await db.end(); }
}
main().catch((e) => { console.error(String(e && e.message || e)); process.exitCode = 1; });
