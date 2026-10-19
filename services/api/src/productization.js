'use strict';

const { hasPermission } = require('../../../packages/security/src/authorization');
const crypto = require('crypto');

const { withPrincipal } = require('../../../packages/db/src/session');
const { validateCoordinates, validateMoneyMinorUnits, normalizeEvidenceSource } = require('../../../packages/productization/src');
const { parseAttestedOutboundUrl, joinAttestedPath, resolveAttestedOutboundTarget, requestAttestedJson } = require('../../../packages/security/src/outboundPolicy');

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function assertDb(db) {
  if (!db || !db.configured || !db.pool) {
    const e = new Error('DATABASE_REQUIRED');
    e.statusCode = 503;
    throw e;
  }
}

async function tenantForPrincipal(client) {
  const r = await client.query(
    'select tenant_id from user_preferences where user_id = auth.uid() limit 1'
  );
  if (!r.rows[0]) {
    const e = new Error('TENANT_CONTEXT_REQUIRED');
    e.statusCode = 403;
    throw e;
  }
  return r.rows[0].tenant_id;
}

async function listFleet(db, principal) {
  assertDb(db);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(`
      select t.id, t.name, t.zone, t.skills, t.battery_status, t.is_active,
             tp.captured_at, ST_Y(tp.position::geometry) as lat,
             ST_X(tp.position::geometry) as lon,
             tp.accuracy_meters, tp.heading_degrees, tp.speed_mps, tp.source
      from technicians t
      left join lateral (
        select * from technician_positions p
        where p.technician_id = t.id
        order by p.captured_at desc, p.id desc
        limit 1
      ) tp on true
      where t.is_active = true
      order by t.name asc, t.id asc
    `);
    return r.rows;
  });
}

function roleCanWriteOtherTechnicians(principal) {
  return hasPermission(principal, 'position:write:any');
}

function validateNoClientTenantAuthority(value, path) {
  if (value === null || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) validateNoClientTenantAuthority(value[i], `${path}[${i}]`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'tenantId' || key === 'tenant_id') {
      const e = new TypeError(`client tenant authority is forbidden at ${path}.${key}`);
      e.statusCode = 400; e.code = 'CLIENT_TENANT_AUTHORITY_FORBIDDEN';
      throw e;
    }
    validateNoClientTenantAuthority(child, `${path}.${key}`);
  }
}

async function recordPosition(db, principal, body) {
  assertDb(db);
  body = body || {};
  validateNoClientTenantAuthority(body, 'body');
  validateCoordinates(body.lat, body.lon);
  const capturedAt = body.capturedAt ? new Date(body.capturedAt) : new Date();
  if (Number.isNaN(capturedAt.getTime())) throw Object.assign(new TypeError('capturedAt must be a valid timestamp'), { statusCode: 400 });
  const source = 'field_device';
  if (body.source != null && body.source !== source) {
    throw Object.assign(new Error('POSITION_SOURCE_REQUIRES_TRUSTED_ADAPTER'), { statusCode: 403, code: 'POSITION_SOURCE_REQUIRES_TRUSTED_ADAPTER' });
  }
  if (body.sequenceNo != null && (!Number.isSafeInteger(body.sequenceNo) || body.sequenceNo < 0)) {
    throw Object.assign(new TypeError('sequenceNo must be a non-negative safe integer'), { statusCode: 400, code: 'POSITION_SEQUENCE_INVALID' });
  }

  return withPrincipal(db, principal, async client => {
    const tenantId = await tenantForPrincipal(client);
    const tech = await client.query(`
      select t.id, t.user_id
      from technicians t
      join user_preferences up on up.user_id = t.user_id
      where t.id = $1::uuid
        and t.is_active = true
        and up.tenant_id = $2::uuid
      limit 1`, [body.technicianId, tenantId]);
    if (!tech.rows[0]) throw Object.assign(new Error('TECHNICIAN_NOT_IN_SCOPE'), { statusCode: 403 });
    if (!roleCanWriteOtherTechnicians(principal) && String(tech.rows[0].user_id) !== String(principal && principal.sub)) {
      throw Object.assign(new Error('TECHNICIAN_POSITION_OWNER_ONLY'), { statusCode: 403 });
    }

    const canonical = {
      technicianId: body.technicianId,
      lat: body.lat,
      lon: body.lon,
      capturedAt: capturedAt.toISOString(),
      accuracyMeters: body.accuracyMeters ?? null,
      altitudeMeters: body.altitudeMeters ?? null,
      headingDegrees: body.headingDegrees ?? null,
      speedMps: body.speedMps ?? null,
      source,
      sequenceNo: body.sequenceNo ?? null
    };
    const payloadHash = sha256Json(canonical);
    const r = await client.query(`
      insert into technician_positions
        (technician_id,captured_at,position,accuracy_meters,altitude_meters,heading_degrees,speed_mps,source,sequence_no,payload_hash,signature)
      values ($1::uuid,$2,ST_SetSRID(ST_MakePoint($3,$4),4326)::geography,$5,$6,$7,$8,$9,$10,$11,$12)
      returning id, technician_id, captured_at,
                ST_Y(position::geometry) as lat, ST_X(position::geometry) as lon,
                accuracy_meters, heading_degrees, speed_mps, source, sequence_no, payload_hash
    `, [body.technicianId, capturedAt.toISOString(), body.lon, body.lat, body.accuracyMeters ?? null, body.altitudeMeters ?? null, body.headingDegrees ?? null, body.speedMps ?? null, source, body.sequenceNo ?? null, payloadHash, null]);
    return r.rows[0];
  });
}

async function planRoute(body) {
  body = body || {};
  validateCoordinates(body.sourceLat, body.sourceLon);
  validateCoordinates(body.targetLat, body.targetLon);
  const lab = String(process.env.FIBEROS_LAB_MODE || '').toLowerCase() === 'true' && String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
  const providerUrl = String((lab ? body.providerUrl : process.env.ROUTING_BASE_URL) || '').trim();
  if (!providerUrl) throw Object.assign(new Error('ROUTING_PROVIDER_NOT_CONFIGURED'), { statusCode:503 });
  const provider = String(body.provider || process.env.ROUTING_PROVIDER || 'osrm').toLowerCase();
  let parsedBase;
  try {
    parsedBase = parseAttestedOutboundUrl(providerUrl, {
      envName:'ROUTING_BASE_URL', codePrefix:'ROUTING_PROVIDER',
      allowedHostsEnv:'ROUTING_ALLOWED_HOSTS', cidrsEnv:'ROUTING_ALLOWED_CIDRS',
      productionPort443:true, allowLabLoopback:lab
    });
  } catch (e) {
    const status = e.code && /HOST_NOT_ATTESTED|PRIVATE_ADDRESS_NOT_ATTESTED/.test(e.code) ? 403 : 400;
    throw Object.assign(new Error(e.code || 'ROUTING_PROVIDER_URL_INVALID'), { statusCode:status, code:e.code || 'ROUTING_PROVIDER_URL_INVALID' });
  }
  let url;
  if (provider === 'osrm') {
    url = joinAttestedPath(parsedBase, `/route/v1/driving/${encodeURIComponent(body.sourceLon)},${encodeURIComponent(body.sourceLat)};${encodeURIComponent(body.targetLon)},${encodeURIComponent(body.targetLat)}?overview=full&geometries=geojson&steps=true`);
  } else if (provider === 'valhalla') {
    url = new URL(`/route?json=${encodeURIComponent(JSON.stringify({locations:[{lat:body.sourceLat,lon:body.sourceLon},{lat:body.targetLat,lon:body.targetLon}],costing:body.costing||'auto',units:'kilometers'}))}`, parsedBase);
  } else {
    throw Object.assign(new Error('UNSUPPORTED_ROUTING_PROVIDER'), { statusCode:400 });
  }

  const timeoutMs = Number(process.env.ROUTING_TIMEOUT_MS || 10000);
  const maxResponseBytes = Number(process.env.ROUTING_MAX_RESPONSE_BYTES || 2 * 1024 * 1024);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) throw Object.assign(new Error('ROUTING_TIMEOUT_CONFIGURATION_INVALID'), { statusCode:503 });
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1024 || maxResponseBytes > 20 * 1024 * 1024) throw Object.assign(new Error('ROUTING_RESPONSE_LIMIT_CONFIGURATION_INVALID'), { statusCode:503 });
  const target = await resolveAttestedOutboundTarget(parsedBase, { codePrefix:'ROUTING_PROVIDER', allowedHostsEnv:'ROUTING_ALLOWED_HOSTS', cidrsEnv:'ROUTING_ALLOWED_CIDRS', allowLabLoopback:lab });
  const response = await requestAttestedJson(url, target, { codePrefix:'ROUTING_PROVIDER', method:'GET', timeoutMs, maxResponseBytes, headers:{ accept:'application/json' } });
  if (!response.ok) throw Object.assign(new Error(`ROUTING_PROVIDER_HTTP_${response.status}`), { statusCode:502 });
  return { provider, requested:{ sourceLat:body.sourceLat, sourceLon:body.sourceLon, targetLat:body.targetLat, targetLon:body.targetLon }, response:response.data };
}

async function enqueueMessage(db, principal, body) {
  assertDb(db); body = body || {};
  validateNoClientTenantAuthority(body, 'body');
  const channel = String(body.channel || '').toLowerCase();
  if (!['whatsapp','sms'].includes(channel)) throw Object.assign(new TypeError('channel must be whatsapp or sms'), { statusCode: 400 });
  if (!body.recipient || !body.template) throw Object.assign(new TypeError('recipient and template are required'), { statusCode: 400 });
  return withPrincipal(db, principal, async client => {
    const tenantId = await tenantForPrincipal(client);
    const aggregateId = String(body.ticketId || body.customerRef || '');
    if (!aggregateId) throw Object.assign(new TypeError('ticketId or customerRef required'), { statusCode: 400 });
    const payload = { tenantId, channel, recipient: body.recipient, template: body.template, variables: body.variables || {}, requestedBy: principal.sub || null };
    const r = await client.query(`
      insert into outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload)
      values ($1::uuid,'communication',$2,$3,$4::jsonb)
      returning event_id, created_at, publish_status
    `, [tenantId, aggregateId, 'communication.requested.' + channel, JSON.stringify(payload)]);
    return r.rows[0];
  });
}

async function createInvoice(db, principal, body) {
  assertDb(db); body = body || {};
  validateNoClientTenantAuthority(body, 'body');
  validateMoneyMinorUnits(body.amountMinor, body.currency);
  if (!body.customerRef) throw Object.assign(new TypeError('customerRef required'), { statusCode: 400 });
  const status = body.status || 'draft';
  if (!['draft','issued'].includes(status)) throw Object.assign(new TypeError('invoice creation supports draft or issued only'), { statusCode: 400 });
  return withPrincipal(db, principal, async client => {
    const tenantId = await tenantForPrincipal(client);
    const customer = await client.query(
      'select 1 from customer_accounts where tenant_id=$1::uuid and customer_ref=$2 limit 1',
      [tenantId, body.customerRef]
    );
    if (!customer.rows[0]) throw Object.assign(new Error('CUSTOMER_NOT_IN_SCOPE'), { statusCode: 403 });
    if (body.serviceId) {
      const service = await client.query('select 1 from services where id=$1::uuid and tenant_id=$2::uuid limit 1', [body.serviceId, tenantId]);
      if (!service.rows[0]) throw Object.assign(new Error('SERVICE_NOT_IN_SCOPE'), { statusCode: 403 });
    }
    if (body.ticketId) {
      const ticket = await client.query('select 1 from tickets where id=$1::uuid and tenant_id=$2::uuid limit 1', [body.ticketId, tenantId]);
      if (!ticket.rows[0]) throw Object.assign(new Error('TICKET_NOT_IN_SCOPE'), { statusCode: 403 });
    }
    const r = await client.query(`
      insert into invoices(tenant_id,customer_ref,service_id,ticket_id,currency,amount_minor,status,due_at)
      values($1::uuid,$2,$3::uuid,$4::uuid,$5,$6,$7,$8)
      returning id, tenant_id, customer_ref, service_id, ticket_id, currency, amount_minor, status, due_at, created_at
    `, [tenantId, body.customerRef, body.serviceId || null, body.ticketId || null, String(body.currency).toUpperCase(), body.amountMinor, status, body.dueAt || null]);
    return r.rows[0];
  });
}

async function customerTickets(db, principal) {
  assertDb(db);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(`
      select ca.customer_ref, tk.id, tk.status, tk.type, tk.created_at, tk.updated_at,
             ST_Y(tk.location_coordinates::geometry) as lat,
             ST_X(tk.location_coordinates::geometry) as lon
      from customer_accounts ca
      join tickets tk on tk.service_id is not null
      join services s on s.id = tk.service_id and s.customer_ref = ca.customer_ref
      where ca.user_id = auth.uid()
      order by tk.created_at desc
    `);
    return r.rows;
  });
}

async function inventoryAdjust(db, principal, body) {
  assertDb(db); body = body || {};
  validateNoClientTenantAuthority(body, 'body');
  if (!body.sku || !body.reason || !body.idempotencyKey || !Number.isSafeInteger(body.deltaQuantity) || body.deltaQuantity === 0) {
    throw Object.assign(new TypeError('sku, reason, idempotencyKey and non-zero integer deltaQuantity are required'), { statusCode: 400 });
  }
  const warehouseId = body.warehouseId ? String(body.warehouseId) : null;
  const binId = body.binId ? String(body.binId) : null;
  const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v || ''));
  if (warehouseId && !uuid(warehouseId)) throw Object.assign(new Error('WAREHOUSE_ID_INVALID'), { statusCode: 400 });
  if (binId && !uuid(binId)) throw Object.assign(new Error('WAREHOUSE_BIN_ID_INVALID'), { statusCode: 400 });
  const allowedMovement = ['receipt','issue','return','adjustment','transfer_in','transfer_out'];
  const movementType = String(body.movementType || (body.deltaQuantity > 0 ? 'receipt' : 'issue')).toLowerCase();
  if (warehouseId && !allowedMovement.includes(movementType)) throw Object.assign(new Error('INVENTORY_MOVEMENT_TYPE_INVALID'), { statusCode: 400 });
  if (warehouseId && body.deltaQuantity > 0 && movementType === 'issue') throw Object.assign(new Error('INVENTORY_MOVEMENT_DIRECTION_INVALID'), { statusCode: 400 });
  if (warehouseId && body.deltaQuantity < 0 && ['receipt','return','transfer_in'].includes(movementType)) throw Object.assign(new Error('INVENTORY_MOVEMENT_DIRECTION_INVALID'), { statusCode: 400 });
  return withPrincipal(db, principal, async client => {
    const tenantId = await tenantForPrincipal(client);
    const item = await client.query(`select id, quantity_on_hand from inventory_items where tenant_id=$1 and sku=$2 for update`, [tenantId, body.sku]);
    if (!item.rows[0]) throw Object.assign(new Error('INVENTORY_SKU_NOT_FOUND'), { statusCode: 404 });
    if (warehouseId) {
      const w = await client.query(`select id from warehouses where id=$1::uuid and tenant_id=$2 and status='ACTIVE'`, [warehouseId, tenantId]);
      if (!w.rows[0]) throw Object.assign(new Error('WAREHOUSE_NOT_ACTIVE'), { statusCode: 409 });
      if (binId) {
        const b = await client.query(`select id from warehouse_bins where id=$1::uuid and tenant_id=$2 and warehouse_id=$3::uuid and status='ACTIVE'`, [binId, tenantId, warehouseId]);
        if (!b.rows[0]) throw Object.assign(new Error('WAREHOUSE_BIN_NOT_FOUND'), { statusCode: 404 });
      }
    } else if (binId) {
      throw Object.assign(new Error('WAREHOUSE_REQUIRED_FOR_BIN'), { statusCode: 400 });
    }
    try {
      const tx = await client.query(`
        insert into inventory_transactions(item_id,tenant_id,delta_quantity,reason,reference_type,reference_id,idempotency_key,actor_id,warehouse_id,bin_id,movement_type)
        values($1,$2,$3,$4,$5,$6,$7,auth.uid(),$8::uuid,$9::uuid,$10)
        on conflict (tenant_id,idempotency_key) do nothing
        returning id
      `, [item.rows[0].id, tenantId, body.deltaQuantity, body.reason, body.referenceType || null, body.referenceId || null, body.idempotencyKey, warehouseId, binId, warehouseId ? movementType : null]);
      if (!tx.rows[0]) {
        const existing = await client.query('select id from inventory_transactions where tenant_id=$1 and idempotency_key=$2', [tenantId, body.idempotencyKey]);
        return { idempotent: true, transactionId: existing.rows[0].id };
      }
      const next = Number(item.rows[0].quantity_on_hand) + body.deltaQuantity;
      if (next < 0) throw Object.assign(new Error('INVENTORY_NEGATIVE_STOCK_REJECTED'), { statusCode: 409 });
      await client.query("select set_config('fiberos.inventory_ledger_authorized','on',true)");
      await client.query('update inventory_items set quantity_on_hand=$1, updated_at=now() where id=$2', [next, item.rows[0].id]);
      return { idempotent: false, transactionId: tx.rows[0].id, quantityOnHand: next, warehouseId, binId, movementType: warehouseId ? movementType : null };
    } catch (e) { throw e; }
  });
}


async function networkTwin(db, principal, options) {
  const { withPrincipal } = require('../../../packages/db/src/session');
  if (!db || !db.configured) throw new Error('DB_NOT_CONFIGURED');
  options = options || {};
  const limit = Math.min(Math.max(Number(options.limit || 5000), 1), 10000);
  return withPrincipal(db, principal, async function (client) {
    const assets = await client.query(`
      select a.id, a.asset_code, a.asset_type, a.parent_asset_id, a.name, a.region,
             a.status, a.total_ports, a.splitter_ratio,
             case when a.gps is null then null else json_build_object('lat', ST_Y(a.gps::geometry), 'lng', ST_X(a.gps::geometry)) end as gps,
             coalesce(c.used_ports,0)::int as used_ports,
             coalesce(c.provisioned_ports,0)::int as provisioned_ports,
             coalesce(c.over_capacity,false) as over_capacity
      from network_assets a
      left join network_asset_capacity c on c.asset_id=a.id
      order by a.asset_code
      limit $1`, [limit]);
    const ports = await client.query(`
      select p.id, p.asset_id, p.port_number, p.port_type, p.status,
             p.connected_asset_id, p.connected_customer_id
      from network_ports p
      order by p.asset_id, p.port_number
      limit $1`, [limit * 4]);
    const edges = await client.query(`
      select e.id, e.from_asset_id, e.to_asset_id, e.relation, e.capacity,
             e.weight, e.shared_risk_group, e.direction, e.active
      from physical_topology_edges e
      where e.active = true
      order by e.from_asset_id, e.to_asset_id, e.relation
      limit $1`, [limit * 2]);
    const cores = await client.query(`
      select fc.id, fc.asset_id, fc.cable_type, fc.fiber_count, fc.route_length_m, fc.status,
             coalesce(count(fcr.id),0)::int as core_rows,
             count(fcr.id) filter (where fcr.status='active')::int as active_cores,
             count(fcr.id) filter (where fcr.status='broken')::int as broken_cores,
             count(fcr.id) filter (where fcr.status='spare')::int as spare_cores
      from fiber_cables fc
      left join fiber_cores fcr on fcr.cable_id=fc.id
      group by fc.id
      order by fc.asset_id
      limit $1`, [limit]);
    return {
      assets: assets.rows,
      ports: ports.rows,
      edges: edges.rows,
      cables: cores.rows,
      authority: 'DATABASE_BACKED_READ_ONLY',
      dataFreshness: 'QUERY_TIME',
      derivedCapacity: true,
      autonomousMutation: false
    };
  });
}


/**
 * Alpha 58 — Digital twin impact analysis (read-only, DB-backed hierarchy).
 * Uses parent_asset_id tree; capacity is derived from network_asset_capacity.
 */
async function twinImpact(db, principal, body) {
  assertDb(db);
  body = body || {};
  const failedId = body.assetId || body.failedAssetId;
  if (!failedId) throw Object.assign(new TypeError('assetId required'), { statusCode: 400 });
  const twin = require('../../../packages/digital-twin-gis/src/index');
  return withPrincipal(db, principal, async client => {
    const assets = await client.query(`
      select id, asset_type, parent_asset_id, asset_code, status, total_ports
      from network_assets
      order by asset_code
      limit 20000`);
    const nodes = assets.rows.map(r => ({
      id: r.id,
      assetType: r.asset_type,
      parentId: r.parent_asset_id,
      code: r.asset_code,
      status: r.status,
      totalPorts: r.total_ports
    }));
    // Optional service/customer maps from services.asset_path if present
    let serviceByAsset = {};
    let customerByAsset = {};
    try {
      const svc = await client.query(`
        select id, customer_ref, asset_path from services where is_active = true limit 20000`);
      for (const row of svc.rows) {
        const path = row.asset_path || {};
        const ids = [];
        if (typeof path === 'object' && path !== null) {
          for (const k of Object.keys(path)) {
            const v = path[k];
            if (v) ids.push(String(v));
          }
        }
        for (const aid of ids) {
          if (!serviceByAsset[aid]) serviceByAsset[aid] = [];
          serviceByAsset[aid].push(String(row.id));
          if (row.customer_ref) {
            if (!customerByAsset[aid]) customerByAsset[aid] = [];
            customerByAsset[aid].push(String(row.customer_ref));
          }
        }
      }
    } catch (e) {
      // services table or asset_path may not be populated — impact still returns assets
    }
    const impact = twin.impactFromAsset(nodes, failedId, serviceByAsset, customerByAsset);
    return Object.assign({}, impact, {
      authority: 'DATABASE_BACKED_HIERARCHY_READ_ONLY',
      syntheticData: false,
      autonomousMutation: false
    });
  });
}

/**
 * Derived capacity for one asset — never trusts a hand-typed total alone.
 */
async function twinCapacity(db, principal, assetId) {
  assertDb(db);
  if (!assetId) throw Object.assign(new TypeError('assetId required'), { statusCode: 400 });
  const twin = require('../../../packages/digital-twin-gis/src/index');
  return withPrincipal(db, principal, async client => {
    const a = await client.query(`
      select id, asset_code, asset_type, total_ports, status
      from network_assets where id = $1::uuid limit 1`, [assetId]);
    if (!a.rows[0]) throw Object.assign(new Error('ASSET_NOT_FOUND'), { statusCode: 404 });
    const ports = await client.query(`
      select status from network_ports where asset_id = $1::uuid`, [assetId]);
    const cap = twin.deriveCapacity(
      { id: a.rows[0].id, totalPorts: a.rows[0].total_ports },
      ports.rows
    );
    return Object.assign({}, cap, {
      assetCode: a.rows[0].asset_code,
      assetType: a.rows[0].asset_type,
      status: a.rows[0].status,
      authority: 'DERIVED_FROM_PORT_ROWS',
      syntheticData: false
    });
  });
}

/**
 * Nearest active technicians via PostGIS ST_DWithin — role gated at route layer.
 */
async function nearestTechnicians(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { nearestTechniciansQuery } = require('../../../packages/sovereign-gis/src/proximityPolicy');
  const q = nearestTechniciansQuery({
    lat: body.lat,
    lon: body.lon,
    maxMeters: body.maxMeters,
    limit: body.limit,
    maxAgeMinutes: body.maxAgeMinutes
  });
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    return {
      technicians: r.rows,
      query: q.meta,
      authority: 'POSTGIS_ST_DWITHIN_KNN',
      syntheticData: false
    };
  });
}



async function technicianDensityCluster(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { technicianDensityClusterQuery } = require('../../../packages/sovereign-gis/src/spatialClusteringPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = technicianDensityClusterQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    const clusters = {};
    for (const row of r.rows) {
      const key = row.cluster_id == null ? 'NOISE' : String(row.cluster_id);
      if (!clusters[key]) clusters[key] = [];
      clusters[key].push(row);
    }
    return {
      points: r.rows,
      clusters,
      query: q.meta,
      authority: 'POSTGIS_CLUSTERDBSCAN',
      syntheticData: false
    };
  });
}


async function snapPointToPlant(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { snapPointToSegmentQuery } = require('../../../packages/sovereign-gis/src/linearSnapPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = snapPointToSegmentQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    const best = r.rows[0] || null;
    if (best && body.persist === true) {
      const tid = (await client.query('select tenant_id from user_preferences where user_id = auth.uid() limit 1')).rows[0];
      if (tid) {
        await client.query(
          `insert into gis_snap_events (
             tenant_id, layer, input_lat, input_lon, segment_id, distance_m,
             snap_lat, snap_lon, measure_fraction, created_by
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            tid.tenant_id,
            q.meta.layer,
            Number(body.lat),
            Number(body.lon),
            best.segment_id,
            best.distance_m,
            best.snap_lat,
            best.snap_lon,
            best.measure_fraction,
            principal && principal.sub ? principal.sub : null
          ]
        );
      }
    }
    return {
      matches: r.rows,
      best,
      query: q.meta,
      authority: 'POSTGIS_SNAP_TO_LINESTRING',
      syntheticData: false
    };
  });
}

async function geotagPointRegion(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { geotagPointToRegionQuery } = require('../../../packages/sovereign-gis/src/linearSnapPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = geotagPointToRegionQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    return {
      region: r.rows[0] || null,
      query: q.meta,
      authority: 'POSTGIS_GEOTAG_REGION',
      syntheticData: false
    };
  });
}

async function assetsBetweenDistances(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { assetsBetweenDistancesQuery } = require('../../../packages/sovereign-gis/src/linearSnapPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = assetsBetweenDistancesQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    return {
      assets: r.rows,
      query: q.meta,
      authority: 'POSTGIS_DISTANCE_BAND',
      syntheticData: false
    };
  });
}


async function evaluateDigCorridorConflict(db, principal, body) {
  assertDb(db);
  body = body || {};
  const {
    plantConflictWithDigQuery,
    classifyConflicts
  } = require('../../../packages/sovereign-gis/src/corridorConflictPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = plantConflictWithDigQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    const summary = classifyConflicts(r.rows, q.meta.bufferM);
    if (body.persist === true && r.rows.length) {
      const tid = (await client.query('select tenant_id from user_preferences where user_id = auth.uid() limit 1')).rows[0];
      if (tid) {
        for (const row of r.rows.slice(0, 50)) {
          const sev = row.intersects_buffer ? 'CRITICAL' : (Number(row.distance_m) <= q.meta.bufferM ? 'WARNING' : 'CLEAR');
          await client.query(
            `insert into gis_corridor_conflict_events (
               tenant_id, layer, segment_id, distance_m, severity, buffer_m, details
             ) values ($1,$2,$3,$4,$5,$6,$7)`,
            [tid.tenant_id, row.layer, row.segment_id, row.distance_m, sev, q.meta.bufferM, JSON.stringify(row)]
          );
        }
      }
    }
    return { matches: r.rows, summary, query: q.meta, authority: 'POSTGIS_CORRIDOR_CONFLICT', syntheticData: false };
  });
}

async function interpolateAlongPlant(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { interpolateAlongSegmentQuery } = require('../../../packages/sovereign-gis/src/linearMeasurePolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = interpolateAlongSegmentQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    const row = r.rows[0] || null;
    if (row && body.persist === true) {
      const tid = (await client.query('select tenant_id from user_preferences where user_id = auth.uid() limit 1')).rows[0];
      if (tid) {
        await client.query(
          `insert into gis_linear_measure_events (
             tenant_id, layer, segment_id, measure_fraction, measure_m, map_lat, map_lon, event_kind, created_by
           ) values ($1,$2,$3,$4,$5,$6,$7,'INTERPOLATE',$8)`,
          [tid.tenant_id, q.meta.layer, row.segment_id, row.measure_fraction, row.measure_m, row.lat, row.lon, principal && principal.sub]
        );
      }
    }
    return { point: row, query: q.meta, authority: 'POSTGIS_LINEAR_INTERPOLATE', syntheticData: false };
  });
}

async function locateBetweenOnPlant(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { locateBetweenFractionsQuery } = require('../../../packages/sovereign-gis/src/linearMeasurePolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = locateBetweenFractionsQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    return { segment: r.rows[0] || null, query: q.meta, authority: 'POSTGIS_LINE_SUBSTRING', syntheticData: false };
  });
}

async function bindOtdrToMap(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { otdrMetersToMapQuery } = require('../../../packages/sovereign-gis/src/linearMeasurePolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = otdrMetersToMapQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    const row = r.rows[0] || null;
    if (row && body.persist === true) {
      const tid = (await client.query('select tenant_id from user_preferences where user_id = auth.uid() limit 1')).rows[0];
      if (tid) {
        await client.query(
          `insert into gis_linear_measure_events (
             tenant_id, layer, segment_id, measure_fraction, measure_m, otdr_meters, map_lat, map_lon, event_kind, created_by
           ) values ($1,$2,$3,$4,$5,$6,$7,$8,'OTDR_BIND',$9)`,
          [tid.tenant_id, body.layer === 'DUCT' ? 'DUCT' : 'FIBER_CABLE', row.segment_id, row.measure_fraction, row.otdr_meters, row.otdr_meters, row.lat, row.lon, principal && principal.sub]
        );
      }
    }
    return { binding: row, query: q.meta, authority: 'OTDR_LINEAR_BIND', syntheticData: false };
  });
}

async function runTopologyIntegrityScan(db, principal, body) {
  assertDb(db);
  body = body || {};
  const T = require('../../../packages/sovereign-gis/src/topologyIntegrityPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body || {});
  return withPrincipal(db, principal, async client => {
    const [d, l, inv, deg] = await Promise.all([
      client.query(T.danglingEdgesQuery().text),
      client.query(T.selfLoopEdgesQuery().text),
      client.query(T.invalidPlantGeometryQuery().text),
      client.query(T.emptyOrDegenerateGeometryQuery().text)
    ]);
    const summary = T.summarizeIntegrity({
      dangling: d.rows, loops: l.rows, invalidGeom: inv.rows, degenerate: deg.rows
    });
    return {
      summary,
      dangling: d.rows,
      selfLoops: l.rows,
      invalidGeometries: inv.rows,
      degenerate: deg.rows,
      authority: 'TOPOLOGY_INTEGRITY_SCAN',
      syntheticData: false
    };
  });
}

async function simplifyPlantSegment(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { simplifySegmentQuery } = require('../../../packages/sovereign-gis/src/geometryQualityPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  const q = simplifySegmentQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    return { result: r.rows[0] || null, query: q.meta, authority: 'POSTGIS_SIMPLIFY_DISPLAY', syntheticData: false };
  });
}

async function applicationGraphRoute(db, principal, body) {
  assertDb(db);
  body = body || {};
  const { applicationGraphPathQuery, routingCapabilityManifest } = require('../../../packages/sovereign-gis/src/routingBoundaryPolicy');
  const { rejectClientAuthorityFields } = require('../../../packages/security/src/objectAccessGuard');
  rejectClientAuthorityFields(body);
  if (body.capabilityOnly === true) {
    return { capability: routingCapabilityManifest(), authority: 'ROUTING_ADAPTER_BOUNDARY' };
  }
  const q = applicationGraphPathQuery(body);
  return withPrincipal(db, principal, async client => {
    const r = await client.query(q.text, q.values);
    return {
      paths: r.rows,
      best: r.rows[0] || null,
      query: q.meta,
      capability: routingCapabilityManifest(),
      authority: 'APPLICATION_GRAPH_HOP_PATH',
      syntheticData: false
    };
  });
}

module.exports = { roleCanWriteOtherTechnicians, validateNoClientTenantAuthority, listFleet, recordPosition, planRoute, enqueueMessage, createInvoice, customerTickets, inventoryAdjust, normalizeEvidenceSource, networkTwin, twinImpact, twinCapacity, nearestTechnicians, technicianDensityCluster, snapPointToPlant, geotagPointRegion, assetsBetweenDistances, evaluateDigCorridorConflict, interpolateAlongPlant, locateBetweenOnPlant, bindOtdrToMap, runTopologyIntegrityScan, simplifyPlantSegment, applicationGraphRoute };
