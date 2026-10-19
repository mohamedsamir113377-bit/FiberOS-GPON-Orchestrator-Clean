#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPool } = require('../../packages/db/src');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function mustDb(url, label) {
  const db = createPool({ ...process.env, DATABASE_URL: url });
  if (!db.configured) throw new Error(label + ':' + (db.reason || 'DB_NOT_CONFIGURED'));
  return db;
}
function qi(identifier) {
  return '"' + String(identifier).replace(/"/g, '""') + '"';
}

function pgTextArray(value) {
  if (Array.isArray(value)) return value;
  const s = String(value || '');
  if (!s.startsWith('{') || !s.endsWith('}')) return s ? [s] : [];
  return s.slice(1, -1).split(',').map((x) => x.replace(/^"|"$/g, '').replace(/\"/g, '"'));
}

async function tableCatalog(client, cache, schema, table) {
  const key = schema + '.' + table;
  if (cache.has(key)) return cache.get(key);
  const result = await client.query(
    "select a.attname as column_name,a.attnotnull as not_null,a.attidentity as identity_kind," +
    "a.attgenerated as generated_kind,pg_get_expr(ad.adbin,ad.adrelid) as column_default," +
    "format_type(a.atttypid,a.atttypmod) as formatted_type,t.typcategory as type_category," +
    "t.typtype as type_kind,t.typname as udt_name," +
    "case when t.typtype='e' then (select array_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid) end as enum_values " +
    "from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace " +
    "join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum " +
    "where n.nspname=$1 and c.relname=$2 and a.attnum>0 and not a.attisdropped order by a.attnum",
    [schema, table]
  );
  if (!result.rows.length) throw new Error('FIXTURE_TABLE_NOT_FOUND:' + schema + '.' + table);
  const info = { schema, table, columns: result.rows };
  cache.set(key, info);
  return info;
}

async function tableConstraints(client, cache, schema, table) {
  const key = schema + '.' + table;
  if (cache.has(key)) return cache.get(key);
  const result = await client.query(
    "select conname,contype,pg_get_constraintdef(oid) as definition " +
    "from pg_constraint where conrelid=$1::regclass order by contype,conname",
    [schema + '.' + table]
  );
  cache.set(key, result.rows);
  return result.rows;
}

function getProtectedFkColumns(state, table) {
  const entry = state.fkColumns.get(table);
  if (!entry) return new Set();
  return new Set([...entry.child, ...entry.parent]);
}

function constraintTouchesAnyColumn(definition, columns) {
  const source = String(definition || '');
  return [...columns].some((column) =>
    new RegExp('(^|[^a-z0-9_])"?' + column + '"?([^a-z0-9_]|$)', 'i').test(source)
  );
}

function fixtureUuid(seed) {
  const hex = crypto.createHash('sha256').update(seed).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    (((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0') + hex.slice(18, 20)),
    hex.slice(20, 32)
  ].join('-');
}

function fixtureNumber(seed, type, ordinal) {
  const hex = crypto.createHash('sha256').update(seed + '|' + ordinal).digest('hex').slice(0, 15);
  const value = BigInt('0x' + hex);
  if (type === 'smallint' || type === 'int2') return Number(1n + (value % 30000n));
  if (type === 'bigint' || type === 'int8') return (1000000000000n + (value % 8000000000000000n)).toString();
  if (['numeric','decimal','real','double precision'].includes(type)) return String(100000 + Number(value % 900000000n));
  return Number(100000 + (value % 2000000000n));
}

function scalarFixtureValue(column, tenant, table, ordinal, seed) {
  const type = String(column.formatted_type || '').toLowerCase();
  const udt = String(column.udt_name || '').toLowerCase();
  const name = String(column.column_name).toLowerCase();
  const fixtureSeed = String(seed || 'default');
  if (type === 'uuid' || udt === 'uuid') return fixtureUuid(table + '|' + tenant + '|' + name + '|' + fixtureSeed);
  if (['smallint','integer','bigint','int2','int4','int8','numeric','decimal','real','double precision'].includes(type)) {
    return fixtureNumber(table + '|' + tenant + '|' + name + '|' + fixtureSeed, type, ordinal);
  }
  if (type === 'boolean') return false;
  if (type === 'json' || type === 'jsonb') return {};
  if (['date'].includes(type)) return new Date().toISOString().slice(0,10);
  if (type.includes('timestamp')) return new Date().toISOString();
  if (type.startsWith('time')) return '00:00:00';
  if (type === 'inet') return '127.0.0.1';
  if (type === 'cidr') return '127.0.0.0/8';
  if (type === 'bytea') return Buffer.from([0]);
  if (type === 'text' || type === 'character varying' || type === 'character' || type === 'name' || udt === 'citext') {
    if (name.includes('email')) return 'fk-audit-' + tenant.slice(0,8) + '-' + fixtureSeed + '-' + ordinal + '@example.invalid';
    return 'fiberos-fk-' + table + '-' + name + '-' + tenant.slice(0,8) + '-' + fixtureSeed + '-' + ordinal;
  }
  if (column.type_kind === 'e' && Array.isArray(column.enum_values) && column.enum_values.length) {
    const index = Number(BigInt('0x' + crypto.createHash('sha256').update(fixtureSeed).digest('hex').slice(0, 8)) % BigInt(column.enum_values.length));
    return column.enum_values[index];
  }
  return null;
}

async function loosenFixtureConstraints(client, table, state) {
  if (state.loosened.has(table)) return;
  const protectedColumns = getProtectedFkColumns(state, table);
  const constraints = await tableConstraints(client, state.constraintCache, 'public', table);
  for (const row of constraints) {
    if (row.contype === 'c') {
      // Keep checks that define the target FK's valid key shape. Otherwise a
      // fixture could create a production-invalid partial-NULL composite key,
      // which PostgreSQL MATCH SIMPLE deliberately does not check.
      if (constraintTouchesAnyColumn(row.definition, protectedColumns)) continue;
      await client.query('savepoint loosen_ck');
      try {
        await client.query('alter table public.' + qi(table) + ' drop constraint ' + qi(row.conname));
        await client.query('release savepoint loosen_ck');
        state.loosened.add(table);
      } catch (error) {
        await client.query('rollback to savepoint loosen_ck').catch(() => {});
        // ignore constraints that cannot be dropped in this session
      }
    }
  }
  const meta = await tableCatalog(client, state.tableCache, 'public', table);
  for (const column of meta.columns) {
    if (column.not_null && column.column_name !== 'tenant_id' &&
        !protectedColumns.has(column.column_name) &&
        column.identity_kind !== 'a' && column.generated_kind !== 's') {
      // SAVEPOINT so a rejected ALTER (e.g. PK column) does not abort the
      // surrounding fixture transaction and poison later statements (25P02).
      await client.query('savepoint loosen_nn');
      try {
        await client.query('alter table public.' + qi(table) + ' alter column ' + qi(column.column_name) + ' drop not null');
        await client.query('release savepoint loosen_nn');
      } catch (error) {
        await client.query('rollback to savepoint loosen_nn').catch(() => {});
        if (!/primary key|multiple primary keys|cannot drop not-null|is in a primary key/i.test(String(error && error.message || error))) {
          throw error;
        }
      }
    }
  }
  await client.query('savepoint loosen_trg');
  try {
    await client.query('alter table public.' + qi(table) + ' disable trigger user');
    await client.query('release savepoint loosen_trg');
  } catch (error) {
    await client.query('rollback to savepoint loosen_trg').catch(() => {});
  }
  state.loosened.add(table);
}

async function restoreFixtureEnvironment(client, state) {
  await client.query('set session_replication_role = origin');
  for (const table of state.loosened) {
    await client.query('alter table public.' + qi(table) + ' enable trigger user').catch(() => {});
  }
}

function sqlLiteral(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }

// Isolate one FK probe from unrelated FKs and workflow/business triggers.
// Keep only the target native FK's internal triggers active. The tenant guard
// generated by migration 180 is a user trigger and must be enabled explicitly.
async function isolateFkProbeTriggers(client, fk, nativeTenantKey) {
  const table = 'public.' + qi(fk.child_table);
  await client.query('alter table ' + table + ' disable trigger user');

  const fkTriggers = await client.query(
    'select t.tgname,t.tgconstraint::text as constraint_oid,t.tgenabled ' +
    'from pg_trigger t where t.tgrelid=$1::regclass and t.tgconstraint <> 0 order by t.tgname',
    ['public.' + fk.child_table]
  );
  const targetTriggers = fkTriggers.rows.filter(row => String(row.constraint_oid) === String(fk.oid));
  if (!targetTriggers.length) {
    throw new Error('TARGET_FOREIGN_KEY_TRIGGER_NOT_FOUND:' + fk.conname);
  }
  if (targetTriggers.some(row => row.tgenabled === 'D' || row.tgenabled === 'R')) {
    throw new Error('TARGET_FOREIGN_KEY_TRIGGER_NOT_ENABLED_FOR_ORIGIN:' + fk.conname);
  }

  // A child table may have several required FKs. Disable every unrelated FK
  // check in this transaction so its fixture cannot mask the FK under test.
  // Rollback at the end of each probe restores all original trigger states.
  for (const trigger of fkTriggers.rows) {
    if (String(trigger.constraint_oid) !== String(fk.oid)) {
      await client.query('alter table ' + table + ' disable trigger ' + qi(trigger.tgname));
    }
  }

  // Migration 180 deliberately relies on PostgreSQL's native composite FK
  // whenever tenant_id is paired with parent.tenant_id at any key position.
  if (nativeTenantKey) return;

  // Do not infer the guard from formatted trigger SQL: PostgreSQL formatting
  // may vary. Migration 180 defines this stable name from child table + FK name.
  const triggerName = 'trg_tenant_fk_' +
    crypto.createHash('md5').update(fk.child_table + ':' + fk.conname).digest('hex').slice(0, 24);
  const functionName = pgTextArray(fk.child_cols).length === 1
    ? 'fiberos_guard_fk_tenant_match'
    : 'fiberos_guard_composite_fk_tenant_match';
  const guard = await client.query(
    'select t.tgname,p.proname from pg_trigger t ' +
    'join pg_proc p on p.oid=t.tgfoid ' +
    'where t.tgrelid=$1::regclass and not t.tgisinternal and t.tgname=$2',
    ['public.' + fk.child_table, triggerName]
  );
  if (guard.rowCount !== 1 || guard.rows[0].proname !== functionName) {
    throw new Error('TARGET_TENANT_FK_GUARD_NOT_FOUND_OR_MISMATCH:' + fk.conname + ':' + triggerName);
  }
  await client.query('alter table ' + table + ' enable trigger ' + qi(triggerName));
}

async function ensureMinimalFixture(client, table, tenant, forced, state) {
  const meta = await tableCatalog(client, state.tableCache, 'public', table);
  const existing = await client.query(
    'select ctid::text as __ctid,* from public.' + qi(table) + ' where tenant_id=$1 limit 1',
    [tenant]
  );
  if (existing.rowCount && !forced.__forceNew) return existing.rows[0];

  await loosenFixtureConstraints(client, table, state);

  const values = { tenant_id: tenant };
  for (const [name, value] of Object.entries(forced || {})) {
    if (!name.startsWith('__') && value !== undefined) values[name] = value;
  }

  const primary = await client.query(
    "select a.attname as column_name,a.attnotnull as not_null,a.attidentity as identity_kind," +
    "a.attgenerated as generated_kind,pg_get_expr(ad.adbin,ad.adrelid) as column_default," +
    "format_type(a.atttypid,a.atttypmod) as formatted_type,t.typname as udt_name " +
    "from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) " +
    "join pg_type t on t.oid=a.atttypid left join pg_attrdef ad on ad.adrelid=a.attrelid and ad.adnum=a.attnum " +
    "where i.indrelid=$1::regclass and i.indisprimary order by a.attnum",
    ['public.' + table]
  );

  for (let i = 0; i < primary.rows.length; i += 1) {
    const column = primary.rows[i];
    if (values[column.column_name] !== undefined) continue;
    if (column.column_default || column.identity_kind || column.generated_kind) continue;
    values[column.column_name] = scalarFixtureValue(column, tenant, table, i + 100, forced.__seed);
  }

  // Target parent-key components must be materialized as non-NULL values even
  // when those columns are nullable in isolation. For self-referencing FKs,
  // an optional child reference stays null unless it is the tested key, while
  // the referenced parent key is constructed completely.
  const fkColumnSets = state.fkColumns.get(table) || { child: new Set(), parent: new Set() };
  const protectedColumns = new Set([...fkColumnSets.child, ...fkColumnSets.parent]);
  const parentKeyColumns = fkColumnSets.parent;
  for (let i = 0; i < meta.columns.length; i += 1) {
    const column = meta.columns[i];
    const name = column.column_name;
    if (values[name] !== undefined) continue;
    const preserveNotNull = column.not_null && protectedColumns.has(name);
    const materializeParentKey = parentKeyColumns.has(name) && name !== 'tenant_id';
    if (!preserveNotNull && !materializeParentKey) continue;
    if (column.identity_kind === 'a' || column.generated_kind === 's') continue;
    if (column.column_default && !materializeParentKey) continue;
    values[name] = scalarFixtureValue(column, tenant, table, i + 300, forced.__seed);
  }

  // The GIS segment-reference shape checks require the canonical layer and
  // generic segment_id to agree with the specialized tenant FK under test.
  // Build a valid shape instead of weakening that production constraint.
  let targetSegmentColumn = null;
  if (fkColumnSets.child.has('fiber_cable_segment_id')) targetSegmentColumn = 'fiber_cable_segment_id';
  else if (fkColumnSets.child.has('duct_segment_id')) targetSegmentColumn = 'duct_segment_id';
  if (targetSegmentColumn) {
    if (values[targetSegmentColumn] === undefined || values[targetSegmentColumn] === null) {
      throw new Error('FIXTURE_TARGET_SEGMENT_REFERENCE_MISSING:' + table + ':' + targetSegmentColumn);
    }
    values.segment_id = values[targetSegmentColumn];
    values.layer = targetSegmentColumn === 'fiber_cable_segment_id' ? 'FIBER_CABLE' : 'DUCT';
  }

  const names = Object.keys(values).filter((name) =>
    meta.columns.some((column) => column.column_name === name)
  );
  if (!names.includes('tenant_id')) {
    throw new Error('FIXTURE_TENANT_ID_NOT_AVAILABLE:' + table);
  }

  const params = names.map((name) => values[name]);
  const forcedNames = new Set(Object.keys(forced || {}).filter((name) => !name.startsWith('__')));
  const sql =
    'insert into public.' + qi(table) +
    ' (' + names.map(qi).join(',') + ') values (' +
    names.map((_, i) => '$' + (i + 1)).join(',') +
    ') returning ctid::text as __ctid,*';

  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await client.query('savepoint fixture_insert_attempt');
    try {
      const adjusted = params.map((value, index) => {
        const name = names[index];
        if (!forcedNames.has(name) && name !== 'tenant_id' && typeof value === 'string' &&
            (name.toLowerCase().includes('code') ||
             name.toLowerCase().includes('number') ||
             name.toLowerCase().includes('ref') ||
             name.toLowerCase().includes('name') ||
             name.toLowerCase().includes('slug') ||
             name.toLowerCase().includes('key') ||
             name.toLowerCase().includes('email'))) {
          return value + '-' + attempt;
        }
        return value;
      });
      const result = await client.query(sql, adjusted);
      await client.query('release savepoint fixture_insert_attempt');
      state.created += 1;
      return result.rows[0];
    } catch (error) {
      lastError = error;
      await client.query('rollback to savepoint fixture_insert_attempt');
      await client.query('release savepoint fixture_insert_attempt');
    }
  }

  throw lastError || new Error('FIXTURE_INSERT_FAILED:' + table);
}

async function main() {
  const db = mustDb(process.env.ADMIN_URL, 'ADMIN_DB');
  const client = await db.pool.connect();
  const results = [];
  const state = {
    tableCache: new Map(),
    constraintCache: new Map(),
    loosened: new Set(),
    fkColumns: new Map(),
    created: 0
  };
  try {
    const fkRows = await client.query(`
      select
        con.oid::bigint as oid,
        con.conname,
        cc.relname as child_table,
        pp.relname as parent_table,
        json_agg(ca.attname order by ck.ord) as child_cols,
        json_agg(pa.attname order by ck.ord) as parent_cols,
        cardinality(con.conkey) as column_count,
        exists(select 1 from pg_attribute x where x.attrelid=cc.oid and x.attname='tenant_id' and not x.attisdropped) as child_has_tenant,
        exists(select 1 from pg_attribute x where x.attrelid=pp.oid and x.attname='tenant_id' and not x.attisdropped) as parent_has_tenant
      from pg_constraint con
      join pg_class cc on cc.oid=con.conrelid
      join pg_namespace cn on cn.oid=cc.relnamespace
      join pg_class pp on pp.oid=con.confrelid
      join pg_namespace pn on pn.oid=pp.relnamespace
      join lateral unnest(con.conkey) with ordinality as ck(attnum,ord) on true
      join lateral unnest(con.confkey) with ordinality as pk(attnum,ord) on pk.ord=ck.ord
      join pg_attribute ca on ca.attrelid=cc.oid and ca.attnum=ck.attnum
      join pg_attribute pa on pa.attrelid=pp.oid and pa.attnum=pk.attnum
      where con.contype='f' and cn.nspname='public' and pn.nspname='public'
      group by con.oid,con.conname,cc.relname,pp.relname,con.conkey,cc.oid,pp.oid
      having exists(select 1 from pg_attribute x where x.attrelid=cc.oid and x.attname='tenant_id' and not x.attisdropped)
         and exists(select 1 from pg_attribute x where x.attrelid=pp.oid and x.attname='tenant_id' and not x.attisdropped)
      order by cc.relname,pp.relname,con.conname
    `);

    const candidates = fkRows.rows.filter(r => Number(r.column_count) === 1);
    const composite = fkRows.rows.filter(r => Number(r.column_count) > 1);

    for (const fk of fkRows.rows) {
      const childCols = pgTextArray(fk.child_cols);
      const parentCols = pgTextArray(fk.parent_cols);
      const nativeTenantKey = childCols.some((name, index) =>
        name === 'tenant_id' && parentCols[index] === 'tenant_id'
      );

      // Register the exact columns before fixture setup. Relaxations may ease
      // unrelated table rules but must not change the tested composite key.
      // Self-references merge the child and parent key columns for one table.
      state.fkColumns.clear();
      for (const [table, side, columns] of [
        [fk.child_table, 'child', childCols],
        [fk.parent_table, 'parent', parentCols]
      ]) {
        const entry = state.fkColumns.get(table) || { child: new Set(), parent: new Set() };
        for (const column of columns) entry[side].add(column);
        state.fkColumns.set(table, entry);
      }

      await client.query('begin');
      await client.query('set local row_security = off');
      await client.query('set local session_replication_role = replica');
      try {
        await client.query('savepoint fixture_setup');
        let parentA, parentB, child;
        try {
          parentA = await ensureMinimalFixture(client, fk.parent_table, A, {
            __forceNew: true,
            __seed: fk.conname + '|parent-a'
          }, state);
          parentB = await ensureMinimalFixture(client, fk.parent_table, B, {
            __forceNew: true,
            __seed: fk.conname + '|parent-b'
          }, state);
          await loosenFixtureConstraints(client, fk.child_table, state);
          await client.query('release savepoint fixture_setup');
        } catch (fixtureErr) {
          await client.query('rollback to savepoint fixture_setup').catch(() => {});
          throw fixtureErr;
        }

        await restoreFixtureEnvironment(client, state);
        await client.query('set local row_security = off');
        await client.query('set local session_replication_role = origin');
        await isolateFkProbeTriggers(client, fk, nativeTenantKey);

        const sameTenantValues = { __forceNew: true, __seed: fk.conname + '|child-a-valid' };
        const crossTenantValues = { __forceNew: true, __seed: fk.conname + '|child-a-cross' };
        for (let index = 0; index < childCols.length; index += 1) {
          const childCol = childCols[index];
          const parentCol = parentCols[index];
          if (childCol === 'tenant_id') continue;
          if (parentA[parentCol] === undefined || parentB[parentCol] === undefined) {
            throw new Error('FIXTURE_PARENT_KEY_UNAVAILABLE:' + fk.conname + ':' + parentCol);
          }
          sameTenantValues[childCol] = parentA[parentCol];
          crossTenantValues[childCol] = parentB[parentCol];
        }

        await client.query('savepoint same_tenant_probe');
        try {
          await ensureMinimalFixture(client, fk.child_table, A, sameTenantValues, state);
          await client.query('release savepoint same_tenant_probe');
        } catch (sameTenantError) {
          await client.query('rollback to savepoint same_tenant_probe');
          await client.query('release savepoint same_tenant_probe');
          throw new Error('SAME_TENANT_PROBE_FAILED:' + String(sameTenantError && sameTenantError.message || sameTenantError));
        }

        let crossTenantError = null;
        await client.query('savepoint cross_tenant_probe');
        try {
          await ensureMinimalFixture(client, fk.child_table, A, crossTenantValues, state);
          await client.query('release savepoint cross_tenant_probe');
        } catch (e) {
          crossTenantError = {
            code: e && e.code ? e.code : null,
            message: String(e && e.message ? e.message : e)
          };
          await client.query('rollback to savepoint cross_tenant_probe');
          await client.query('release savepoint cross_tenant_probe');
        }

        const errorText = crossTenantError ? String((crossTenantError.code || '') + ' ' + crossTenantError.message) : '';
        const tenantMismatch = /TENANT(?:_[A-Z0-9]+)*_(?:MISMATCH|CONTEXT|SCOPE)|CROSS.?TENANT|TENANT_REFERENCE_MISSING/i.test(errorText);
        const compositeFkMismatch = nativeTenantKey && crossTenantError && crossTenantError.code === '23503';
        const status = !crossTenantError
          ? 'FAIL_CROSS_TENANT_MUTATION_ACCEPTED'
          : tenantMismatch
            ? 'BLOCKED_TENANT_ENFORCEMENT'
            : compositeFkMismatch
              ? 'BLOCKED_TENANT_COMPOSITE_FK'
            : 'BLOCKED_UNRELATED_GUARD';

        results.push({
          constraint: fk.conname,
          child_table: fk.child_table,
          parent_table: fk.parent_table,
          status,
          sameTenantProbe: 'PASS',
          error: crossTenantError
        });
      } catch (error) {
        results.push({
          constraint: fk.conname,
          child_table: fk.child_table,
          parent_table: fk.parent_table,
          status: 'UNEXERCISED_FIXTURE_FAILURE',
          error: {
            code: error && error.code ? error.code : null,
            message: String(error && error.message ? error.message : error)
          }
        });
      } finally {
        await restoreFixtureEnvironment(client, state).catch(() => {});
        await client.query('rollback').catch(() => {});
        state.loosened.clear();
        state.fkColumns.clear();
      }
    }

    const tenantEnforcementBlocked = results.filter(x => x.status === 'BLOCKED_TENANT_ENFORCEMENT').length;
    const tenantCompositeFkBlocked = results.filter(x => x.status === 'BLOCKED_TENANT_COMPOSITE_FK').length;
    const acceptedCrossTenant = results.filter(x => x.status === 'FAIL_CROSS_TENANT_MUTATION_ACCEPTED').length;
    const passingStatuses = new Set(['BLOCKED_TENANT_ENFORCEMENT', 'BLOCKED_TENANT_COMPOSITE_FK']);
    const notProven = results.filter(x => !passingStatuses.has(x.status) || x.sameTenantProbe !== 'PASS').length;
    const inventoryCount = fkRows.rows.length;
    console.log(JSON.stringify({
      ok: acceptedCrossTenant === 0 && notProven === 0 && results.length === inventoryCount,
      evidenceClass: 'EPHEMERAL_CI_RUNTIME_ALL_LIVE_TENANT_FK_MUTATION_AUDIT',
      productionCertification: false,
      inventory: { tenantBearingFks: inventoryCount, singleColumnCandidates: candidates.length, compositeTenantFks: composite.length },
      executed: results.length,
      tenantEnforcementBlocked,
      tenantCompositeFkBlocked,
      notProven,
      results,
      note: 'Every tenant-bearing FK, including composite keys, must pass a same-tenant INSERT and reject a Tenant-A child referencing Tenant-B parent data. Append-only or unrelated guards are not tenant-isolation proof.'
    }, null, 2));
    assert.equal(results.length, inventoryCount, 'every tenant-bearing FK must be exercised');
    assert.equal(acceptedCrossTenant, 0, 'no tenant-bearing FK may accept a cross-tenant reference');
    assert.equal(notProven, 0, 'every tenant-bearing FK must have same-tenant and cross-tenant evidence');
  } finally {
    client.release();
    await db.end();
  }
}
main().catch((err) => {
  console.error(err && err.stack || err);
  process.exitCode = 1;
});
