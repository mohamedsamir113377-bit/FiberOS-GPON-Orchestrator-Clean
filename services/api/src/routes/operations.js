'use strict';

const { error: logError } = require('../../../../packages/observability/src/logger');

const crypto = require('crypto');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { rankAssignments } = require('../../../../packages/dispatch/src');
const twinGis = require('../../../../packages/digital-twin-gis/src/index');
const { assignNextInQueue, releaseAssignment } = require('../../../../packages/call-routing/src');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { resolveWebhookSecret } = require('../../../../packages/security/src/webhookSecrets');
const { recordDegraded } = require('../../../../packages/observability/src/degradedReads');
const { loadImmutablePermissionContext, canSupervisorActOnTechnician } = require('../../../../packages/security/src/permissionContext');
const { fieldOperationsIntelligence } = require('../../../../packages/operational-assurance/src');
const { appendLedgerBlock } = require('../../../../packages/domain/src/ledgerAppend');
const { linkOperationalEventToIncident } = require('../../../../packages/operational-context/src/incidentLink');
const { buildOperationalTrace } = require('../../../../packages/operational-context/src/trace');

function assertDb(db) {
  if (!db || !db.configured) {
    const e = new Error('DATABASE_REQUIRED');
    e.statusCode = 503;
    throw e;
  }
}
function json(res, status, body, send) { return send(res, status, body); }
// R3 fix (C-2): enrichment reads must never silently masquerade as "no data".
// A failed query used to resolve to {rows:[]} with no trace, which is
// indistinguishable from a genuinely empty result set. That can let a
// caller (or an operator reading the response) believe a system is clear
// of incidents/tickets/calls when the query actually errored. This logs
// the failure with query context and tags the fallback so callers can see
// the read was degraded rather than empty-by-fact.
function softQuery(client, label, sql, params) {
  return client.query(sql, params).catch((e) => {
    logError('enrichment_query_failed', {
      label,
      error: String(e && e.message || e)
    });
    recordDegraded(label, e);
    return { rows: [], degraded: true };
  });
}
async function tenant(client) {
  const r = await client.query('select tenant_id from user_preferences where user_id=auth.uid() limit 1');
  if (!r.rows[0]) { const e = new Error('TENANT_CONTEXT_REQUIRED'); e.statusCode = 403; throw e; }
  return r.rows[0].tenant_id;
}
function auth(principal, roles) {
  const a = requireVerifiedPrincipal(principal, process.env); if (!a.ok) return a;
  return requireAnyRole(principal, roles);
}
function ivrTransition(state, action) {
  const a = String(action || '').trim(); const s = String(state || 'welcome');
  if (s === 'welcome') return a === '1'
    ? { state: 'fault', prompt: 'A fault report was selected. We will request the service number or phone number.' }
    : a === '2' ? { state: 'appointment', prompt: 'An appointment was selected. Enter/send the service and appointment details.' }
    : a === '3' ? { state: 'agent', prompt: 'A support agent was requested. The call will move to the agent queue.' }
    : { state: 'welcome', prompt: 'Invalid selection. Choose 1 for fault, 2 for appointment, or 3 for a support agent.' };
  if (s === 'agent') return { state: 'queued', prompt: 'The call was placed in the agent queue.' };
  return { state: s, prompt: 'The next step depends on the service data sent by the communications provider.' };
}
function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')); const y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function verifyWebhookSignature(rawBody, req, secret) {
  const timestamp = String(req.headers['x-fiberos-timestamp'] || '');
  const signature = String(req.headers['x-fiberos-signature'] || '');
  if (!/^\d{10,13}$/.test(timestamp) || !signature) return false;
  const n = Number(timestamp); const ms = timestamp.length === 13 ? n : n * 1000;
  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > 300000) return false;
  const expected = crypto.createHmac('sha256', secret).update(timestamp + '.').update(rawBody || '').digest('hex');
  return safeEqual(signature, expected) || safeEqual(signature, 'sha256=' + expected);
}

async function inboundCall(req, res, ctx) {
  const { body, rawBody, db, send } = ctx;
  assertDb(db);
  const providerKey = String(req.headers['x-fiberos-provider'] || (body && body.provider) || '').trim();
  const eventId = String(req.headers['x-fiberos-event-id'] || (body && body.eventId) || '').trim();
  if (!providerKey || !eventId) return json(res, 400, { ok: false, error: 'WEBHOOK_IDENTITY_REQUIRED' }, send);
  if (providerKey.length > 128 || eventId.length > 128) return json(res, 400, { ok: false, error: 'WEBHOOK_IDENTITY_TOO_LONG' }, send);
  if (!/^[A-Za-z0-9._:-]+$/.test(providerKey) || !/^[A-Za-z0-9._:-]+$/.test(eventId)) return json(res, 400, { ok: false, error: 'WEBHOOK_IDENTITY_INVALID' }, send);
  if (typeof rawBody !== 'string') return json(res, 400, { ok: false, error: 'RAW_BODY_REQUIRED' }, send);
  if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.externalCallId !== 'string' || !body.externalCallId.trim()) return json(res, 400, { ok: false, error: 'EXTERNAL_CALL_ID_REQUIRED' }, send);
  if (body.externalCallId.length > 256) return json(res, 400, { ok: false, error: 'EXTERNAL_CALL_ID_TOO_LONG' }, send);
  if (body.direction != null && !['inbound','outbound'].includes(String(body.direction).toLowerCase())) return json(res, 400, { ok: false, error: 'WEBHOOK_DIRECTION_INVALID' }, send);
  if (body.callerNumber != null && String(body.callerNumber).length > 64) return json(res, 400, { ok: false, error: 'CALLER_NUMBER_TOO_LONG' }, send);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const providerResult = await client.query(
      `select * from fiberos_webhook_provider_context($1)`,
      [providerKey]
    );
    if (!providerResult.rows[0]) {
      await client.query('ROLLBACK');
      return json(res, 401, { ok: false, error: 'TELCO_PROVIDER_UNAUTHORIZED' }, send);
    }
    const provider = providerResult.rows[0];
    const resolvedSecret = resolveWebhookSecret(provider.signing_secret_ref, process.env);
    if (!resolvedSecret.ok) {
      await client.query('ROLLBACK');
      return json(res, 503, { ok: false, error: resolvedSecret.code }, send);
    }
    if (!verifyWebhookSignature(rawBody, req, resolvedSecret.secret)) {
      await client.query('ROLLBACK');
      return json(res, 401, { ok: false, error: 'TELCO_WEBHOOK_SIGNATURE_INVALID' }, send);
    }

    let ins;
    try {
      const recorded = await client.query(
        `select * from fiberos_record_telco_webhook($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::text)`,
        [
          provider.provider_id,
          eventId,
          provider.signing_secret_ref,
          body.direction || 'inbound',
          body.externalCallId,
          body.callerNumber || null
        ]
      );
      if (!recorded.rows[0]) {
        const e = new Error('TELCO_WEBHOOK_SESSION_NOT_CREATED');
        e.code = 'TELCO_WEBHOOK_SESSION_NOT_CREATED';
        throw e;
      }
      ins = {
        id: recorded.rows[0].session_id,
        ivr_state: recorded.rows[0].ivr_state
      };
    } catch (e) {
      if (String(e && e.message || e) === 'TELCO_WEBHOOK_REPLAY') {
        await client.query('ROLLBACK');
        return json(res, 409, { ok: false, error: 'TELCO_WEBHOOK_REPLAY' }, send);
      }
      throw e;
    }

    await client.query('COMMIT');
    return json(res, 200, { ok: true, session: ins, authority: 'SIGNED_PROVIDER_MAPPED_TENANT' }, send);
  } catch (e) {
    await client.query('ROLLBACK').catch((e2) => { logError('db_rollback_failed', { error: String(e2 && e2.message || e2) }); }); throw e;
  } finally { client.release(); }
}

async function callCenterMetrics(db, principal, windowMinutes = 60) {
  assertDb(db); const minutes=Math.min(Math.max(Number(windowMinutes)||60,5),10080);
  return withPrincipal(db,principal,async client=>{const tid=await tenant(client);
    const summary=await client.query(`WITH scoped AS (
      SELECT status,started_at,assigned_at,CASE WHEN assigned_at IS NOT NULL THEN EXTRACT(EPOCH FROM (assigned_at-started_at)) ELSE NULL END wait_seconds
      FROM call_sessions WHERE tenant_id=$1 AND started_at>=now()-($2::int*interval '1 minute')
    ) SELECT count(*)::int total,count(*) FILTER(WHERE status='queued')::int queued,
      count(*) FILTER(WHERE status IN ('assigned','in_progress','connected','ivr'))::int active,
      count(*) FILTER(WHERE status='completed')::int completed,count(*) FILTER(WHERE status='abandoned')::int abandoned,
      count(*) FILTER(WHERE status='failed')::int failed,
      count(*) FILTER(WHERE wait_seconds IS NOT NULL)::int assigned_count,
      round(coalesce(avg(wait_seconds) FILTER(WHERE wait_seconds IS NOT NULL),0)::numeric,1)::float8 average_wait_seconds,
      count(*) FILTER(WHERE wait_seconds IS NOT NULL AND wait_seconds<=30)::int assigned_within_30s FROM scoped`,[tid,minutes]);
    const outcomes=await softQuery(client,'call-center.metrics.dispositions',`SELECT outcome_code,count(*)::int count FROM call_dispositions WHERE tenant_id=$1 AND created_at>=now()-($2::int*interval '1 minute') GROUP BY outcome_code ORDER BY outcome_code`,[tid,minutes]);
    const agents=await client.query(`SELECT count(*) FILTER(WHERE status='AVAILABLE')::int available,count(*) FILTER(WHERE status='BUSY')::int busy,count(*) FILTER(WHERE status='AWAY')::int away,count(*) FILTER(WHERE status='OFFLINE')::int offline FROM contact_center_agent_presence WHERE tenant_id=$1`,[tid]);
    const s=summary.rows[0],terminal=Number(s.completed||0)+Number(s.abandoned||0)+Number(s.failed||0);
    return {windowMinutes:minutes,summary:{total:Number(s.total||0),queued:Number(s.queued||0),active:Number(s.active||0),completed:Number(s.completed||0),abandoned:Number(s.abandoned||0),failed:Number(s.failed||0),averageWaitSeconds:Number(s.average_wait_seconds||0),serviceLevel30sPct:Number(s.assigned_count||0)?Number(((Number(s.assigned_within_30s)/Number(s.assigned_count))*100).toFixed(1)):0,abandonRatePct:terminal?Number(((Number(s.abandoned)/terminal)*100).toFixed(1)):0},dispositions:outcomes.rows,agents:agents.rows[0],authority:'DATABASE_BACKED_CALL_CENTER_METRICS',syntheticData:false,telephonyConfirmed:false,dataDegraded:Boolean(outcomes.degraded)};
  });
}

async function saveCallDisposition(db, principal, body) {
  assertDb(db);const b=body||{},sid=String(b.callSessionId||'').trim(),outcome=String(b.outcomeCode||'').trim().toUpperCase(),notes=String(b.notes||''),key=String(b.idempotencyKey||'').trim();
  const allowed=['RESOLVED','ESCALATED','CALLBACK_REQUIRED','FIELD_VISIT_REQUIRED','CUSTOMER_UNREACHABLE','DUPLICATE','OTHER'];
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sid)||!allowed.includes(outcome)||notes.length>4000||key.length<8||key.length>128)throw Object.assign(new Error('CALL_DISPOSITION_INPUT_INVALID'),{statusCode:400});
  let follow=null;if(b.followUpAt!=null){const d=new Date(b.followUpAt);if(!Number.isFinite(d.getTime())||d.getTime()<Date.now())throw Object.assign(new Error('CALL_FOLLOW_UP_AT_INVALID'),{statusCode:400});follow=d.toISOString();}
  return withPrincipal(db,principal,async client=>{const tid=await tenant(client),s=await client.query('SELECT id FROM call_sessions WHERE id=$1::uuid AND tenant_id=$2 FOR UPDATE',[sid,tid]);if(!s.rows[0])throw Object.assign(new Error('CALL_SESSION_NOT_FOUND'),{statusCode:404});
    const d=await client.query(`INSERT INTO call_dispositions(tenant_id,call_session_id,outcome_code,notes,follow_up_at,actor_id,idempotency_key) VALUES($1,$2::uuid,$3,$4,$5,$6::uuid,$7)
      ON CONFLICT(tenant_id,call_session_id) DO UPDATE SET outcome_code=excluded.outcome_code,notes=excluded.notes,follow_up_at=excluded.follow_up_at,actor_id=excluded.actor_id,idempotency_key=excluded.idempotency_key,created_at=now()
      RETURNING id,call_session_id,outcome_code,notes,follow_up_at,actor_id,created_at`,[tid,sid,outcome,notes,follow,principal.sub,key]);
    await client.query(`INSERT INTO call_events(tenant_id,call_session_id,event_type,payload)
      VALUES($1,$2::uuid,'disposition.recorded',$3::jsonb)`,
      [tid,sid,JSON.stringify({outcomeCode:outcome,followUpAt:follow,actorId:principal.sub})]);
    return {disposition:d.rows[0],authority:'DATABASE_BACKED_CALL_DISPOSITION',syntheticData:false};
  });
}

async function warehouseOverview(db, principal) {
  assertDb(db);return withPrincipal(db,principal,async client=>{const tid=await tenant(client);
    const [w,b,resv,trans,items,allocation]=await Promise.all([
      client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='ACTIVE')::int active FROM warehouses WHERE tenant_id=$1`,[tid]),
      client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE status='ACTIVE')::int active FROM warehouse_bins WHERE tenant_id=$1`,[tid]),
      client.query(`SELECT count(*)::int reserved FROM inventory_reservations WHERE tenant_id=$1 AND status='RESERVED'`,[tid]),
      client.query(`SELECT count(*)::int open FROM warehouse_transfers WHERE tenant_id=$1 AND status='REQUESTED'`,[tid]),
      client.query(`SELECT count(*)::int items,coalesce(sum(quantity_on_hand),0)::numeric global_units,count(*) FILTER(WHERE quantity_on_hand<=reorder_point)::int reorder_alerts FROM inventory_items WHERE tenant_id=$1`,[tid]),
      client.query(`SELECT coalesce(sum(i.quantity_on_hand),0)::numeric global_units,coalesce((SELECT sum(x.allocated_units) FROM (SELECT item_id,sum(delta_quantity)::numeric allocated_units FROM inventory_transactions WHERE tenant_id=$1 AND warehouse_id IS NOT NULL GROUP BY item_id)x),0)::numeric allocated_units FROM inventory_items i WHERE i.tenant_id=$1`,[tid])
    ]);
    const gu=Number(allocation.rows[0].global_units||0),au=Number(allocation.rows[0].allocated_units||0);
    return {warehouses:w.rows[0],bins:b.rows[0],reservations:Number(resv.rows[0].reserved||0),transfers:Number(trans.rows[0].open||0),inventory:{items:Number(items.rows[0].items||0),globalUnits:String(items.rows[0].global_units||'0'),reorderAlerts:Number(items.rows[0].reorder_alerts||0),allocatedUnits:String(allocation.rows[0].allocated_units||'0'),unallocatedUnits:String((gu-au).toFixed(0))},authority:'DATABASE_BACKED_WAREHOUSE_LEDGER',sourceOfTruth:'INVENTORY_TRANSACTIONS_LEDGER',syntheticData:false};
  });
}

async function warehouseStock(db, principal, warehouseId) {
  assertDb(db);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(warehouseId||'')))throw Object.assign(new Error('WAREHOUSE_ID_INVALID'),{statusCode:400});
  return withPrincipal(db,principal,async client=>{const tid=await tenant(client),w=await client.query(`SELECT id,warehouse_code,name,region,status FROM warehouses WHERE id=$1::uuid AND tenant_id=$2`,[warehouseId,tid]);if(!w.rows[0])throw Object.assign(new Error('WAREHOUSE_NOT_FOUND'),{statusCode:404});
    const stock=await client.query(`SELECT i.id item_id,i.sku,i.description,i.unit,t.bin_id,b.bin_code,sum(t.delta_quantity)::numeric quantity_on_hand FROM inventory_transactions t JOIN inventory_items i ON i.id=t.item_id AND i.tenant_id=t.tenant_id LEFT JOIN warehouse_bins b ON b.id=t.bin_id AND b.tenant_id=t.tenant_id WHERE t.tenant_id=$1 AND t.warehouse_id=$2 GROUP BY i.id,i.sku,i.description,i.unit,t.bin_id,b.bin_code HAVING sum(t.delta_quantity)<>0 ORDER BY i.sku,t.bin_id NULLS FIRST`,[tid,warehouseId]);
    const reservations=await client.query(`SELECT item_id,bin_id,sum(quantity)::numeric reserved_quantity FROM inventory_reservations WHERE tenant_id=$1 AND warehouse_id=$2 AND status='RESERVED' GROUP BY item_id,bin_id`,[tid,warehouseId]);
    const rm=new Map(reservations.rows.map(x=>[String(x.item_id)+'|'+String(x.bin_id||''),Number(x.reserved_quantity||0)]));
    return {warehouse:w.rows[0],stock:stock.rows.map(x=>{const r=rm.get(String(x.item_id)+'|'+String(x.bin_id||''))||0,q=Number(x.quantity_on_hand||0);return {...x,quantity_on_hand:String(x.quantity_on_hand),reserved_quantity:String(r),available_quantity:String(Math.max(0,q-r))};}),authority:'DATABASE_BACKED_WAREHOUSE_LOCATION_LEDGER',syntheticData:false};
  });
}

async function warehouseTransfer(db, principal, body) {
  assertDb(db);const b=body||{},uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')),qty=Number(b.quantity);
  if(!uuid(b.sourceWarehouseId)||!uuid(b.targetWarehouseId)||b.sourceWarehouseId===b.targetWarehouseId||!Number.isSafeInteger(qty)||qty<=0||!String(b.sku||'').trim()||String(b.idempotencyKey||'').trim().length<8)throw Object.assign(new Error('WAREHOUSE_TRANSFER_INPUT_INVALID'),{statusCode:400});
  return withPrincipal(db,principal,async client=>{await client.query('BEGIN');try{const tid=await tenant(client),key=String(b.idempotencyKey).trim(),existing=await client.query('SELECT id,status FROM warehouse_transfers WHERE tenant_id=$1 AND idempotency_key=$2',[tid,key]);if(existing.rows[0]){await client.query('COMMIT');return {transferId:existing.rows[0].id,status:existing.rows[0].status,idempotent:true};}
    const w=await client.query(`SELECT id FROM warehouses WHERE tenant_id=$1 AND id=ANY($2::uuid[]) AND status='ACTIVE' FOR UPDATE`,[tid,[b.sourceWarehouseId,b.targetWarehouseId]]);if(w.rowCount!==2)throw Object.assign(new Error('WAREHOUSE_NOT_ACTIVE'),{statusCode:409});
    const item=await client.query('SELECT id FROM inventory_items WHERE tenant_id=$1 AND sku=$2 FOR UPDATE',[tid,String(b.sku).trim()]);if(!item.rows[0])throw Object.assign(new Error('INVENTORY_SKU_NOT_FOUND'),{statusCode:404});
    const sb=b.sourceBinId||null,tb=b.targetBinId||null;
    if(sb){const x=await client.query(`SELECT id FROM warehouse_bins WHERE id=$1::uuid AND tenant_id=$2 AND warehouse_id=$3::uuid AND status='ACTIVE'`,[sb,tid,b.sourceWarehouseId]);if(!x.rows[0])throw Object.assign(new Error('SOURCE_BIN_NOT_FOUND'),{statusCode:404});}
    if(tb){const x=await client.query(`SELECT id FROM warehouse_bins WHERE id=$1::uuid AND tenant_id=$2 AND warehouse_id=$3::uuid AND status='ACTIVE'`,[tb,tid,b.targetWarehouseId]);if(!x.rows[0])throw Object.assign(new Error('TARGET_BIN_NOT_FOUND'),{statusCode:404});}
    const stock=await client.query(`SELECT coalesce(sum(delta_quantity),0)::numeric quantity,coalesce((SELECT sum(quantity) FROM inventory_reservations WHERE tenant_id=$1 AND warehouse_id=$2 AND item_id=$3 AND status='RESERVED' AND ($4::uuid IS NULL OR bin_id=$4::uuid)),0)::numeric reserved FROM inventory_transactions WHERE tenant_id=$1 AND warehouse_id=$2 AND item_id=$3 AND ($4::uuid IS NULL OR bin_id=$4::uuid)`,[tid,b.sourceWarehouseId,item.rows[0].id,sb]);
    if(Number(stock.rows[0].quantity||0)-Number(stock.rows[0].reserved||0)<qty)throw Object.assign(new Error('WAREHOUSE_INSUFFICIENT_AVAILABLE_STOCK'),{statusCode:409});
    const tr=await client.query(`INSERT INTO warehouse_transfers(tenant_id,source_warehouse_id,target_warehouse_id,work_package_id,status,idempotency_key,requested_by) VALUES($1,$2::uuid,$3::uuid,$4::uuid,'POSTED',$5,$6::uuid) RETURNING id,status`,[tid,b.sourceWarehouseId,b.targetWarehouseId,b.workPackageId||null,key,principal.sub]),id=tr.rows[0].id;
    await client.query(`INSERT INTO warehouse_transfer_lines(tenant_id,transfer_id,item_id,source_bin_id,target_bin_id,quantity) VALUES($1,$2,$3,$4::uuid,$5::uuid,$6)`,[tid,id,item.rows[0].id,sb,tb,qty]);
    await client.query(`INSERT INTO inventory_transactions(item_id,tenant_id,delta_quantity,reason,reference_type,reference_id,idempotency_key,actor_id,warehouse_id,bin_id,movement_type) VALUES($1,$2,$3,'warehouse_transfer','WAREHOUSE_TRANSFER',$4,$5,$6::uuid,$7::uuid,$8::uuid,'transfer_out')`,[item.rows[0].id,tid,-qty,id,id+':out',principal.sub,b.sourceWarehouseId,sb]);
    await client.query(`INSERT INTO inventory_transactions(item_id,tenant_id,delta_quantity,reason,reference_type,reference_id,idempotency_key,actor_id,warehouse_id,bin_id,movement_type) VALUES($1,$2,$3,'warehouse_transfer','WAREHOUSE_TRANSFER',$4,$5,$6::uuid,$7::uuid,$8::uuid,'transfer_in')`,[item.rows[0].id,tid,qty,id,id+':in',principal.sub,b.targetWarehouseId,tb]);
    await client.query('UPDATE warehouse_transfers SET posted_at=now() WHERE id=$1',[id]);await client.query('COMMIT');return {transferId:id,status:'POSTED',quantity:qty,sku:String(b.sku).trim(),authority:'DATABASE_BACKED_WAREHOUSE_TRANSFER',syntheticData:false};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}});
}

async function reserveInventory(db, principal, body) {
  assertDb(db);const b=body||{},uuid=v=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||'')),qty=Number(b.quantity);
  if(!uuid(b.warehouseId)||!uuid(b.binId)||!Number.isSafeInteger(qty)||qty<=0||!String(b.sku||'').trim()||String(b.idempotencyKey||'').trim().length<8)throw Object.assign(new Error('INVENTORY_RESERVATION_INPUT_INVALID'),{statusCode:400});
  return withPrincipal(db,principal,async client=>{await client.query('BEGIN');try{const tid=await tenant(client),key=String(b.idempotencyKey).trim(),existing=await client.query('SELECT id,status FROM inventory_reservations WHERE tenant_id=$1 AND idempotency_key=$2',[tid,key]);if(existing.rows[0]){await client.query('COMMIT');return {reservationId:existing.rows[0].id,status:existing.rows[0].status,idempotent:true};}
    const item=await client.query('SELECT id FROM inventory_items WHERE tenant_id=$1 AND sku=$2 FOR UPDATE',[tid,String(b.sku).trim()]);if(!item.rows[0])throw Object.assign(new Error('INVENTORY_SKU_NOT_FOUND'),{statusCode:404});
    const bin=await client.query(`SELECT id FROM warehouse_bins WHERE id=$1::uuid AND tenant_id=$2 AND warehouse_id=$3::uuid AND status='ACTIVE'`,[b.binId,tid,b.warehouseId]);if(!bin.rows[0])throw Object.assign(new Error('WAREHOUSE_BIN_NOT_FOUND'),{statusCode:404});
    const stock=await client.query(`SELECT coalesce(sum(delta_quantity),0)::numeric quantity,coalesce((SELECT sum(quantity) FROM inventory_reservations WHERE tenant_id=$1 AND warehouse_id=$2 AND item_id=$3 AND bin_id=$4::uuid AND status='RESERVED'),0)::numeric reserved FROM inventory_transactions WHERE tenant_id=$1 AND warehouse_id=$2 AND item_id=$3 AND bin_id=$4::uuid`,[tid,b.warehouseId,item.rows[0].id,b.binId]);
    if(Number(stock.rows[0].quantity||0)-Number(stock.rows[0].reserved||0)<qty)throw Object.assign(new Error('INVENTORY_INSUFFICIENT_AVAILABLE_STOCK'),{statusCode:409});
    const rr=await client.query(`INSERT INTO inventory_reservations(tenant_id,item_id,warehouse_id,bin_id,quantity,status,reference_type,reference_id,idempotency_key,actor_id) VALUES($1,$2,$3,$4::uuid,$5,'RESERVED',$6,$7,$8,$9::uuid) RETURNING id,status,quantity,warehouse_id,bin_id,created_at`,[tid,item.rows[0].id,b.warehouseId,b.binId,qty,b.referenceType||null,b.referenceId||null,key,principal.sub]);
    await client.query('COMMIT');return {reservation:rr.rows[0],authority:'DATABASE_BACKED_WAREHOUSE_RESERVATION',syntheticData:false};
  }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}});
}

async function releaseInventoryReservation(db, principal, reservationId) {
  assertDb(db);if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(reservationId||'')))throw Object.assign(new Error('RESERVATION_ID_INVALID'),{statusCode:400});
  return withPrincipal(db,principal,async client=>{const tid=await tenant(client),r=await client.query(`UPDATE inventory_reservations SET status='RELEASED',updated_at=now() WHERE id=$1::uuid AND tenant_id=$2 AND status='RESERVED' RETURNING id,status,updated_at`,[reservationId,tid]);if(!r.rows[0])throw Object.assign(new Error('RESERVATION_NOT_ACTIVE'),{statusCode:404});return {reservation:r.rows[0],authority:'DATABASE_BACKED_WAREHOUSE_RESERVATION'};});
}

async function commandRoomsOverview(db, principal) {
  assertDb(db);return withPrincipal(db,principal,async client=>{const tid=await tenant(client);
    const [cc,agents,net,field,wh,resv,trans,crisis]=await Promise.all([
      softQuery(client,'command.rooms.call_center',`SELECT count(*) FILTER(WHERE status='queued')::int queued,count(*) FILTER(WHERE status IN ('assigned','in_progress','connected','ivr'))::int active,count(*) FILTER(WHERE status='abandoned')::int abandoned,count(*)::int total FROM call_sessions WHERE tenant_id=$1 AND started_at>=now()-interval '24 hours'`,[tid]),
      softQuery(client,'command.rooms.call_center_agents',`SELECT count(*) FILTER(WHERE status='AVAILABLE')::int available,count(*) FILTER(WHERE status='BUSY')::int busy FROM contact_center_agent_presence WHERE tenant_id=$1`,[tid]),
      softQuery(client,'command.rooms.network',`SELECT (SELECT count(*) FROM network_assets WHERE tenant_id=$1)::int assets,(SELECT count(*) FROM network_assets WHERE tenant_id=$1 AND gps IS NOT NULL)::int mapped_assets,(SELECT count(*) FROM incidents WHERE tenant_id=$1 AND state NOT IN ('resolved','closed'))::int active_incidents,(SELECT count(*) FROM tickets WHERE tenant_id=$1 AND status NOT IN ('completed','cancelled','rejected'))::int open_tickets`,[tid]),
      softQuery(client,'command.rooms.field',`SELECT (SELECT count(*) FROM technicians WHERE tenant_id=$1 AND is_active=true)::int technicians,(SELECT count(*) FROM technicians WHERE tenant_id=$1 AND is_active=true AND current_gps IS NOT NULL)::int tracked_technicians,(SELECT count(*) FROM tickets WHERE tenant_id=$1 AND status NOT IN ('completed','cancelled','rejected') AND technician_id IS NULL)::int unassigned_tickets,(SELECT count(*) FROM dispatch_requests WHERE tenant_id=$1 AND status IN ('requested','ranked'))::int pending_dispatch`,[tid]),
      softQuery(client,'command.rooms.warehouses',`SELECT (SELECT count(*) FROM warehouses WHERE tenant_id=$1 AND status='ACTIVE')::int active_warehouses,(SELECT count(*) FROM warehouse_bins WHERE tenant_id=$1 AND status='ACTIVE')::int active_bins,(SELECT count(*) FROM inventory_items WHERE tenant_id=$1)::int items`,[tid]),
      softQuery(client,'command.rooms.reservations',`SELECT count(*)::int active_reservations FROM inventory_reservations WHERE tenant_id=$1 AND status='RESERVED'`,[tid]),
      softQuery(client,'command.rooms.transfers',`SELECT count(*)::int pending_transfers FROM warehouse_transfers WHERE tenant_id=$1 AND status='REQUESTED'`,[tid]),
      softQuery(client,'command.rooms.crisis',`SELECT count(*) FILTER(WHERE state NOT IN ('resolved','closed'))::int active_incidents,count(*) FILTER(WHERE severity='P1' AND state NOT IN ('resolved','closed'))::int p1_incidents,coalesce(sum(affected_customers) FILTER(WHERE state NOT IN ('resolved','closed')),0)::int affected_customers FROM incidents WHERE tenant_id=$1`,[tid])
    ]);
    return {generatedAt:new Date().toISOString(),rooms:{contactCenter:{...cc.rows[0],agents:agents.rows[0]},network:{...net.rows[0]},fieldOperations:{...field.rows[0]},supplyChain:{...wh.rows[0],activeReservations:Number(resv.rows[0]?.active_reservations||0),pendingTransfers:Number(trans.rows[0]?.pending_transfers||0)},crisisExecutive:{...crisis.rows[0]}},authority:'DATABASE_BACKED_COMMAND_ROOMS',syntheticData:false,readOnly:true,externalRuntimeConnected:false,dataDegraded:[cc,agents,net,field,wh,resv,trans,crisis].some(x=>x.degraded)};
  });
}

async function handleOperations(req, res, ctx) {
  const { method, path, body, principal, db, send } = ctx;

  if (path.startsWith('/v1/call-center/')) {
    if (method === 'POST' && path === '/v1/call-center/ivr/inbound') return inboundCall(req, res, ctx);
    if (method === 'GET' && path === '/v1/call-center/metrics') {
      const a=auth(principal,['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
      try{return json(res,200,await callCenterMetrics(db,principal,new URL(req.url,'http://localhost').searchParams.get('windowMinutes')),send);}catch(e){return json(res,e.statusCode||400,{ok:false,error:e.code||e.message},send);}
    }
    if (method === 'POST' && path === '/v1/call-center/dispositions') {
      const a=auth(principal,['call_center','ops_manager','area_supervisor','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
      try{return json(res,200,{ok:true,...await saveCallDisposition(db,principal,body)},send);}catch(e){return json(res,e.statusCode||400,{ok:false,error:e.code||e.message},send);}
    }
    const match = path.match(/^\/v1\/call-center\/sessions\/([^/]+)\/ivr$/);
    if (method === 'POST' && match) {
      const a = auth(principal, ['call_center','ops_manager','area_supervisor','sysadmin']); if (!a.ok) return send(res,a.status,a.body);
      assertDb(db);
      return withPrincipal(db, principal, async client => {
        const tid = await tenant(client);
        const cur = await client.query(`select id,ivr_state,status from call_sessions where id=$1::uuid and tenant_id=$2 for update`, [match[1], tid]);
        if (!cur.rows[0]) return json(res,404,{ok:false,error:'CALL_SESSION_NOT_FOUND'},send);
        const next = ivrTransition(cur.rows[0].ivr_state, body && body.action);
        await client.query(`update call_sessions set ivr_state=$1,status=$2 where id=$3::uuid`, [next.state,next.state==='queued'?'queued':'ivr',match[1]]);
        await client.query(`insert into call_events(tenant_id,call_session_id,event_type,payload) values($1,$2,$3,$4::jsonb)`, [tid,match[1],'ivr.input',JSON.stringify({action:body&&body.action,fromState:cur.rows[0].ivr_state,toState:next.state})]);
        return json(res,200,{ok:true,nextState:next.state,nextPrompt:next.prompt},send);
      });
    }
    if (method === 'POST' && path === '/v1/call-center/sessions') {
      const a = auth(principal, ['call_center','ops_manager','area_supervisor','sysadmin']); if (!a.ok) return send(res,a.status,a.body);
      assertDb(db);
      return withPrincipal(db,principal,async client=>{
        const tid=await tenant(client); const b=body||{};
        const r=await client.query(`insert into call_sessions(tenant_id,provider,direction,external_call_id,caller_number,customer_ref,service_id,ticket_id,status,ivr_state)
          values($1,$2,$3,$4,$5,$6,$7::uuid,$8::uuid,'ringing','welcome') returning id,provider,direction,status,ivr_state,started_at`,
          [tid,b.provider||'generic',b.direction||'inbound',b.externalCallId||null,b.callerNumber||null,b.customerRef||null,b.serviceId||null,b.ticketId||null]);
        return json(res,200,{ok:true,session:r.rows[0],telephony:'SESSION_REGISTERED_ONLY'},send);
      });
    }
    if (method === 'POST' && path === '/v1/call-center/queue/assign') {
      const a = auth(principal, ['call_center','ops_manager','area_supervisor','sysadmin']); if (!a.ok) return send(res,a.status,a.body);
      assertDb(db);
      const out = await assignNextInQueue(db, principal);
      return json(res, 200, { ok: true, ...out, authority: 'DATABASE_BACKED_ASSIGNMENT_ADVISORY', telephonyConfirmed: false }, send);
    }
    if (method === 'POST' && path === '/v1/call-center/queue/release') {
      const a = auth(principal, ['call_center','ops_manager','area_supervisor','sysadmin']); if (!a.ok) return send(res,a.status,a.body);
      assertDb(db);
      const b = body || {};
      try {
        const out = await releaseAssignment(db, principal, { callSessionId: b.callSessionId, reason: b.reason });
        return json(res, 200, { ok: true, ...out }, send);
      } catch (e) {
        return json(res, e.statusCode || 400, { ok: false, error: e.code || 'REQUEST_REJECTED' }, send);
      }
    }
    if (method === 'GET' && path === '/v1/call-center/queue/status') {
      const a = auth(principal, ['call_center','ops_manager','area_supervisor','dispatcher','sysadmin','exec']);
      if (!a.ok) return send(res, a.status, a.body);
      assertDb(db);
      return withPrincipal(db, principal, async client => {
        const tid = await tenant(client);
        const queued = await client.query(
          `select count(*)::int as n from call_sessions where tenant_id=$1 and status='queued'`,
          [tid]
        );
        const assigned = await client.query(
          `select count(*)::int as n from call_sessions where tenant_id=$1 and status in ('connected','ivr','queued','in_progress')`,
          [tid]
        );
        const oldest = await client.query(
          `select id, started_at, caller_number, customer_ref,
                  extract(epoch from (now() - started_at))::int as wait_seconds
           from call_sessions
           where tenant_id=$1 and status='queued'
           order by started_at asc
           limit 10`,
          [tid]
        );
        let agents;
        try {
          agents = await client.query(
            `select
               count(*) filter (where status='AVAILABLE')::int as available,
               count(*) filter (where status='BUSY')::int as busy
             from contact_center_agent_presence`
          );
        } catch (e) {
          logError('agent_presence_read_failed', {
            error: String(e && e.message || e)
          });
          return json(res, 503, {
            ok: false,
            error: 'CONTACT_CENTER_AGENT_PRESENCE_READ_FAILED',
            authority: 'DATABASE_BACKED_QUEUE_READ',
            dataDegraded: true
          }, send);
        }
        return json(res, 200, {
          ok: true,
          queue: {
            queued: queued.rows[0].n,
            assignedOrInProgress: assigned.rows[0].n,
            oldestQueued: oldest.rows,
            agents: agents.rows[0]
          },
          authority: 'DATABASE_BACKED_QUEUE_READ',
          syntheticData: false,
          telephonyConfirmed: false
        }, send);
      });
    }
  }

  if (method === 'GET' && path === '/v1/command/rooms/overview') {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return json(res,200,await commandRoomsOverview(db,principal),send);}catch(e){return json(res,e.statusCode||503,{ok:false,error:e.code||e.message,authority:'DATABASE_BACKED_COMMAND_ROOMS',dataDegraded:true},send);}
  }
  if (method === 'GET' && path === '/v1/warehouses/overview') {
    const a=auth(principal,['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return json(res,200,await warehouseOverview(db,principal),send);}catch(e){return json(res,e.statusCode||503,{ok:false,error:e.code||e.message,authority:'DATABASE_BACKED_WAREHOUSE_LEDGER'},send);}
  }
  if (method === 'GET' && path.startsWith('/v1/warehouses/') && path.endsWith('/stock')) {
    const a=auth(principal,['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return json(res,200,await warehouseStock(db,principal,path.split('/')[3]),send);}catch(e){return json(res,e.statusCode||503,{ok:false,error:e.code||e.message,authority:'DATABASE_BACKED_WAREHOUSE_LOCATION_LEDGER'},send);}
  }
  if (method === 'POST' && path === '/v1/warehouses/transfers') {
    const a=auth(principal,['warehouse','ops_manager','area_supervisor','dispatcher','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return json(res,200,{ok:true,...await warehouseTransfer(db,principal,body)},send);}catch(e){return json(res,e.statusCode||409,{ok:false,error:e.code||e.message,authority:'DATABASE_BACKED_WAREHOUSE_TRANSFER'},send);}
  }
  if (method === 'POST' && path === '/v1/warehouses/reservations') {
    const a=auth(principal,['warehouse','ops_manager','area_supervisor','dispatcher','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return json(res,200,{ok:true,...await reserveInventory(db,principal,body)},send);}catch(e){return json(res,e.statusCode||409,{ok:false,error:e.code||e.message,authority:'DATABASE_BACKED_WAREHOUSE_RESERVATION'},send);}
  }
  if (method === 'POST' && path.startsWith('/v1/warehouses/reservations/') && path.endsWith('/release')) {
    const a=auth(principal,['warehouse','ops_manager','area_supervisor','dispatcher','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return json(res,200,{ok:true,...await releaseInventoryReservation(db,principal,path.split('/')[4])},send);}catch(e){return json(res,e.statusCode||404,{ok:false,error:e.code||e.message,authority:'DATABASE_BACKED_WAREHOUSE_RESERVATION'},send);}
  }

  if (method === 'GET' && path === '/v1/crisis/command-state') {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{const tid=await tenant(client);const r=await client.query(`select id,incident_key,title,severity,state,affected_customers,declared_at,sla_deadline from incidents where tenant_id=$1 and state not in ('resolved','closed') order by case severity when 'P1' then 1 when 'P2' then 2 when 'P3' then 3 else 4 end,created_at desc`,[tid]);const affected=r.rows.reduce((n,x)=>n+Number(x.affected_customers||0),0);const active=r.rows.some(x=>x.severity==='P1'||x.state==='declared'||x.state==='mitigating');return json(res,200,{ok:true,mode:active?'CRISIS_ACTIVE':'NORMAL',affectedCustomers:affected,incidents:r.rows,authority:'DATABASE_BACKED_INCIDENT_STATE'},send);});
  }

  if (method === 'POST' && path === '/v1/crisis/incidents') {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client); const b=body||{}; const allowed=['open','investigating','declared','mitigating','resolved','closed']; const state=b.state||'declared';
      if(!b.incidentKey||!b.title||!['P1','P2','P3','P4'].includes(b.severity)||!allowed.includes(state))return json(res,400,{ok:false,error:'INCIDENT_INPUT_INVALID'},send);
      const prior=await client.query(`select id,state,severity,title,affected_customers from incidents where tenant_id=$1 and incident_key=$2 for update`,[tid,b.incidentKey]);
      if (!prior.rows[0] && !['open','declared'].includes(state)) {
        return json(res,422,{ok:false,error:'INCIDENT_INITIAL_STATE_INVALID'},send);
      }
      await client.query('BEGIN');
      try {
        const r=await client.query(`insert into incidents(tenant_id,incident_key,title,severity,state,affected_customers,declared_at,resolved_at) values($1,$2,$3,$4,$5,$6,case when $5='declared' then now() else null end,case when $5 in ('resolved','closed') then now() else null end) on conflict(tenant_id,incident_key) do update set title=excluded.title,severity=excluded.severity,state=excluded.state,affected_customers=excluded.affected_customers,declared_at=coalesce(incidents.declared_at,excluded.declared_at),resolved_at=case when excluded.state in ('resolved','closed') then now() else incidents.resolved_at end,updated_at=now() returning *`,[tid,b.incidentKey,b.title,b.severity,state,Math.max(0,Number(b.affectedCustomers||0))]);
        const eventType=prior.rows[0]?'state.changed':'incident.created';
        await client.query(`insert into incident_events(tenant_id,incident_id,event_type,payload,actor_id) values($1,$2,$3,$4::jsonb,$5::uuid)`,[tid,r.rows[0].id,eventType,JSON.stringify({from:prior.rows[0]&&prior.rows[0].state,to:state,severity:b.severity,affectedCustomers:Math.max(0,Number(b.affectedCustomers||0))}),principal&&principal.sub]);
        let operationalEventIncidentLink=null;
        if (b.operationalEventId) {
          operationalEventIncidentLink=await linkOperationalEventToIncident(client,{
            tenantId:tid,
            eventId:String(b.operationalEventId),
            incidentId:r.rows[0].id,
            linkRole:b.operationalEventLinkRole||'trigger',
            actorId:principal&&principal.sub
          });
        }
        await client.query('COMMIT');
        return json(res,200,{ok:true,incident:r.rows[0],operationalEventIncidentLink:operationalEventIncidentLink?{
          id:operationalEventIncidentLink.link.id,
          eventId:operationalEventIncidentLink.link.event_id,
          incidentId:operationalEventIncidentLink.link.incident_id,
          linkRole:operationalEventIncidentLink.link.link_role,
          replayed:operationalEventIncidentLink.replayed,
          eventIntegritySha256:operationalEventIncidentLink.event.integrity_sha256
        }:null,audit:'INCIDENT_EVENT_RECORDED',authority:'DB_INCIDENT_STATE_AUTHORITY'},send);
      } catch (e) {
        await client.query('ROLLBACK').catch(()=>{});
        if (String(e && e.message || e) === 'INCIDENT_TRANSITION_REJECTED') {
          return json(res,409,{ok:false,error:'INCIDENT_TRANSITION_REJECTED'},send);
        }
        if (String(e && e.message || e) === 'INCIDENT_EVENT_ACTOR_MISMATCH') {
          return json(res,403,{ok:false,error:'INCIDENT_EVENT_ACTOR_MISMATCH'},send);
        }
        if (String(e && e.message || e) === 'INCIDENT_ROLE_FORBIDDEN') {
          return json(res,403,{ok:false,error:'INCIDENT_ROLE_FORBIDDEN'},send);
        }
        if (['OPERATIONAL_EVENT_NOT_FOUND','INCIDENT_NOT_FOUND'].includes(e.code)) return json(res,404,{ok:false,error:e.code},send);
        if (['OPERATIONAL_EVENT_NOT_CANONICAL','TENANT_MISMATCH_OPERATIONAL_EVENT','OPERATIONAL_EVENT_INCIDENT_ACTOR_MISMATCH'].includes(e.code)) return json(res,409,{ok:false,error:e.code},send);
        await client.query('ROLLBACK').catch(()=>{});
        throw e;
      }
    });
  }

  if (method === 'GET' && /^\/v1\/crisis\/incidents\/[^/]+\/impact$/.test(path)) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const incidentId=path.split('/')[4];
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const incident=await client.query(`select i.id,i.incident_key,i.title,i.severity,i.state,i.primary_asset_id,
          i.affected_customers,i.declared_at,i.sla_deadline,
          case when a.gps is null then null else ST_Y(a.gps::geometry) end as lat,
          case when a.gps is null then null else ST_X(a.gps::geometry) end as lon
        from incidents i left join network_assets a on a.id=i.primary_asset_id
        where i.id=$1::uuid and i.tenant_id=$2`,[incidentId,tid]);
      if(!incident.rows[0]) return json(res,404,{ok:false,error:'INCIDENT_NOT_FOUND'},send);
      const row=incident.rows[0];
      if(row.lat===null||row.lon===null) return json(res,200,{ok:true,incident:row,impact:{assetCount:0,openTicketCount:0,distinctCustomerCount:0,method:'NO_PRIMARY_ASSET_GPS'},authority:'DATABASE_BACKED_IMPACT_ONLY'},send);
      const radius=Number((new URL(req.url,'http://localhost')).searchParams.get('radiusMeters')||5000);
      if(!Number.isFinite(radius)||radius<100||radius>50000)return json(res,400,{ok:false,error:'RADIUS_OUT_OF_RANGE'},send);
      const assets=await client.query(`select a.id,a.asset_code,a.asset_type,a.status,ST_Distance(a.gps,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)::float8 distance_meters
        from network_assets a where a.tenant_id=$3 and a.gps is not null and ST_DWithin(a.gps,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$4)
        order by distance_meters asc,a.asset_code asc limit 1000`,[row.lon,row.lat,tid,radius]);
      const tickets=await client.query(`select tk.id,tk.status,tk.type,tk.technician_id,ca.customer_ref,
          ST_Distance(tk.location_coordinates,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography)::float8 distance_meters
        from tickets tk
        left join services sv on sv.id=tk.service_id
        left join customer_accounts ca on ca.customer_ref=sv.customer_ref and ca.tenant_id=$3
        where tk.tenant_id=$3 and tk.status not in ('completed','cancelled','rejected')
          and ST_DWithin(tk.location_coordinates,ST_SetSRID(ST_MakePoint($1,$2),4326)::geography,$4)
        order by distance_meters asc limit 2000`,[row.lon,row.lat,tid,radius]);
      const customers=new Set(tickets.rows.map(x=>x.customer_ref).filter(Boolean));
      return json(res,200,{ok:true,incident:row,impact:{radiusMeters:radius,assetCount:assets.rowCount,openTicketCount:tickets.rowCount,distinctCustomerCount:customers.size,assets:assets.rows,tickets:tickets.rows},authority:'DATABASE_BACKED_SPATIAL_IMPACT',syntheticData:false},send);
    });
  }


  if (method === 'GET' && /^\/v1\/operations\/realtime\/snapshot$/.test(path)) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const [incidents,tickets,calls]=await Promise.all([
        client.query(`select id,state,severity,updated_at from incidents where tenant_id=$1 and state not in ('resolved','closed') order by updated_at desc limit 500`,[tid]),
        client.query(`select id,status,type,updated_at from tickets where tenant_id=$1 and status not in ('completed','cancelled','rejected') order by updated_at desc limit 1000`,[tid]),
        softQuery(client,'operations.snapshot.calls',`select id,status,started_at,ended_at from call_sessions where tenant_id=$1 order by started_at desc limit 500`,[tid])
      ]);
      const dataDegraded = Boolean(calls.degraded);
      return json(res,200,{ok:true,authority:'DATABASE_BACKED_OPERATIONS_SNAPSHOT',syntheticData:false,streaming:false,realtimeProvider:'NOT_CONNECTED',snapshot:{incidents:incidents.rows,tickets:tickets.rows,calls:calls.rows},dataDegraded},send);
    });
  }

  if (method === 'POST' && path === '/v1/dispatch/rank') {
    const a=auth(principal,['dispatcher','ops_manager','area_supervisor','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client); const b=body||{};
      const permissionContext = await loadImmutablePermissionContext(client, principal);
      const supervisorScoped = ['area_supervisor','team_lead'].includes(permissionContext.role);
      if (supervisorScoped && permissionContext.subordinates.length === 0) return json(res,403,{ok:false,error:'SUPERVISOR_TECHNICIAN_SCOPE_REQUIRED'},send);
      const technicianScopeSql = supervisorScoped ? ' and t.id = any($2::uuid[])' : '';
      const techResult=await client.query(`select t.id,t.name,t.skills,t.battery_status,t.is_active,
        coalesce(ST_Y(tp.position::geometry),ST_Y(t.current_gps::geometry),null) latitude,
        coalesce(ST_X(tp.position::geometry),ST_X(t.current_gps::geometry),null) longitude,
        case when coalesce(w.active_jobs,0)=0 then 'AVAILABLE' else 'ACTIVE_MIDAN' end status,
        coalesce(w.active_jobs,0) activeJobs
        from technicians t
        left join lateral(select * from technician_positions p where p.technician_id=t.id order by p.captured_at desc,p.id desc limit 1) tp on true
        left join lateral(select count(*)::int active_jobs from tickets tk where tk.tenant_id=$1 and tk.technician_id=t.id and tk.status in ('pending','in_progress','awaiting_evidence','manager_review')) w on true
        where t.is_active=true${technicianScopeSql}`,[tid].concat(supervisorScoped ? [permissionContext.subordinates] : []));
      let lat=Number(b.jobLat),lon=Number(b.jobLon);
      if(b.ticketId){const tr=await client.query(`select ST_Y(location_coordinates::geometry) lat,ST_X(location_coordinates::geometry) lon from tickets where id=$1::uuid and tenant_id=$2`,[b.ticketId,tid]);if(!tr.rows[0])return json(res,404,{ok:false,error:'TICKET_NOT_FOUND'},send);lat=Number(tr.rows[0].lat);lon=Number(tr.rows[0].lon);}
      if(!Number.isFinite(lat)||!Number.isFinite(lon))return json(res,400,{ok:false,error:'JOB_LOCATION_REQUIRED'},send);
      const traffic=Number(b.trafficMultiplier); const trafficMultiplier=Number.isFinite(traffic)&&traffic>0?traffic:1;
      const ranked=rankAssignments({latitude:lat,longitude:lon,skill:b.requiredSkill,slaDeadlineTimestamp:b.slaDeadline?Date.parse(b.slaDeadline):undefined},techResult.rows,{trafficMultiplier});
      if (supervisorScoped && ranked[0]) {
        const allowed = canSupervisorActOnTechnician(permissionContext, { tenantId: tid, technicianId: ranked[0].technicianId });
        if (!allowed.ok) return json(res,403,{ok:false,error:allowed.error},send);
      }
      // Cross-check ranking from digital-twin-gis (Haversine + load). Advisory only;
      // primary authority remains rankAssignments (dispatch package).
      const twinRanked = twinGis.rankTechnicians(
        { lat: lat, lon: lon, skill: b.requiredSkill },
        techResult.rows.map(function (t) {
          return {
            id: t.id,
            lat: t.latitude,
            lon: t.longitude,
            activeJobs: t.activejobs != null ? t.activejobs : t.activeJobs,
            skills: t.skills,
            status: t.status,
            active: true
          };
        }),
        { maxMeters: b.maxMeters != null ? Number(b.maxMeters) : null }
      );
      const dr=await client.query(`insert into dispatch_requests(tenant_id,ticket_id,required_skill,sla_deadline,request_payload,result_payload,status,completed_at) values($1,$2::uuid,$3,$4,$5::jsonb,$6::jsonb,$7,now()) returning id`,[tid,b.ticketId||null,b.requiredSkill||'unspecified',b.slaDeadline||null,JSON.stringify({...b,trafficSource:b.trafficMultiplier!=null?'CALLER_ADVISORY':'DEFAULT_BASELINE_1_0'}),JSON.stringify({primary:ranked,twinCrossCheck:twinRanked}),ranked.length?'ranked':'no_candidate']);
      return json(res,200,{ok:true,dispatchRequestId:dr.rows[0].id,ranked:ranked.map(x=>({technicianId:x.technicianId,name:x.technician&&x.technician.name,score:x.score,distanceMeters:x.distanceMeters,travelMinutes:x.travelMinutes,reasons:x.reasons})),twinCrossCheck:twinRanked.slice(0,20),authority:'DETERMINISTIC_SERVER_RANKING',crossCheckAuthority:'DIGITAL_TWIN_GIS_HAVERSINE',dataAuthority:'DB_TECHNICIAN_STATE_AND_LATEST_POSITION',trafficSource:b.trafficMultiplier!=null?'CALLER_ADVISORY':'DEFAULT_BASELINE_1_0'},send);
    });
  }


  if (method === 'GET' && path === '/v1/gis/fusion/layers') {
    const a=auth(principal,['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const assets=await client.query(`select id,asset_code,asset_type,status,ST_Y(gps::geometry) latitude,ST_X(gps::geometry) longitude from network_assets where tenant_id=$1 and gps is not null order by asset_code limit 5000`,[tid]);
      const incidents=await client.query(`select id,incident_key,title,severity,state,primary_asset_id from incidents where tenant_id=$1 and state not in ('resolved','closed') order by created_at desc limit 2000`,[tid]);
      const technicians=await client.query(`select id as technician_id,name,zone,battery_status,ST_Y(current_gps::geometry) latitude,ST_X(current_gps::geometry) longitude from technicians where tenant_id=$1 and is_active=true and current_gps is not null order by name limit 2000`,[tid]);
      const tickets=await client.query(`select id,status,type,technician_id,ST_Y(location_coordinates::geometry) latitude,ST_X(location_coordinates::geometry) longitude,sla_deadline from tickets where tenant_id=$1 and location_coordinates is not null and status not in ('completed','cancelled','rejected') order by updated_at desc limit 3000`,[tid]);
      return json(res,200,{ok:true,authority:'DATABASE_BACKED_SPATIAL_READ_ONLY',syntheticData:false,layers:{assets:assets.rows,incidents:incidents.rows,technicians:technicians.rows,tickets:tickets.rows},capabilities:{liveTelemetry:false,nmsStreaming:false,threeDTwin:false,technicianPositions:true,ticketLocations:true,vectorTiles:true}},send);
    });
  }

  if (method === 'GET' && path === '/v1/command/fabric/overview') {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      let calls;
      try {
        calls = await client.query(
          `select count(*)::int total_calls, count(*) filter(where status not in ('completed','failed','abandoned'))::int active_calls
           from call_sessions where tenant_id=$1`,
          [tid]
        );
      } catch (e) {
        logError('command_fabric_calls_query_failed', {
          error:String(e && e.message || e)
        });
        return json(res,503,{ok:false,error:'COMMAND_FABRIC_DATA_UNAVAILABLE',dataDegraded:true,authority:'DATABASE_BACKED_READ_ONLY'},send);
      }
      const incidents=await client.query(`select count(*)::int active_incidents from incidents where tenant_id=$1 and state not in ('resolved','closed')`,[tid]);
      const tickets=await client.query(`select count(*)::int open_tickets from tickets where tenant_id=$1 and status not in ('completed','cancelled','rejected')`,[tid]);
      return json(res,200,{ok:true,authority:'DATABASE_BACKED_READ_ONLY',syntheticData:false,commandFabric:{calls:calls.rows[0],activeIncidents:Number(incidents.rows[0].active_incidents||0),openTickets:Number(tickets.rows[0].open_tickets||0)},capabilities:{autonomousDispatch:false,autonomousIncidentResolution:false,liveTelephony:false}},send);
    });
  }

  if (method === 'GET' && path === '/v1/executive/financial-snapshot') {
    const a=auth(principal,['cfo','exec','ops_manager','area_supervisor','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{const tid=await tenant(client);const inv=await client.query(`select coalesce(sum(amount_minor) filter(where status in ('issued','paid','partially_paid','overdue')),0)::bigint issued_amount,count(*) filter(where status='overdue') overdue_count from invoices where tenant_id=$1`,[tid]);const tk=await client.query(`select count(*) filter(where status not in ('completed','cancelled','rejected','faulty')) open_tickets,count(*) filter(where status='completed') completed_tickets from tickets where tenant_id=$1`,[tid]);return json(res,200,{ok:true,authority:'DATABASE_BACKED_READ_ONLY',modelValidated:false,decisionAutomationAuthorized:false,financial:{issuedAmountMinor:String(inv.rows[0].issued_amount||0),overdueInvoices:Number(inv.rows[0].overdue_count||0)},operations:{openTickets:Number(tk.rows[0].open_tickets||0),completedTickets:Number(tk.rows[0].completed_tickets||0)}},send);});
  }

  if (method === 'POST' && path === '/v1/contact-center/agents/presence') {
    const a=auth(principal,['call_center','ops_manager','area_supervisor','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const status=String((body||{}).status||'').toUpperCase();
      if(!['AVAILABLE','BUSY','AWAY','OFFLINE'].includes(status)) return json(res,400,{ok:false,error:'AGENT_STATUS_INVALID'},send);
      const agentId=principal.sub;
      const r=await client.query(`insert into contact_center_agent_presence(tenant_id,agent_id,status,updated_at) values($1,$2::uuid,$3,now()) on conflict(tenant_id,agent_id) do update set status=excluded.status,updated_at=now() returning agent_id,status,updated_at`,[tid,agentId,status]);
      return json(res,200,{ok:true,presence:r.rows[0],authority:'AUTHENTICATED_AGENT_ID'},send);
    });
  }

  if (method === 'GET' && path.startsWith('/v1/contact-center/customer-360/')) {
    const a=auth(principal,['call_center','ops_manager','area_supervisor','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const ref=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const r=await client.query(`select ca.customer_ref, count(t.id)::int ticket_count from customer_accounts ca left join services s on s.customer_ref=ca.customer_ref and s.tenant_id=ca.tenant_id left join tickets t on t.service_id=s.id and t.tenant_id=ca.tenant_id where ca.customer_ref=$1 and ca.tenant_id=$2 group by ca.customer_ref`,[ref,tid]);
      if(!r.rows[0]) return json(res,404,{ok:false,error:'CUSTOMER_NOT_FOUND'},send);
      return json(res,200,{ok:true,customer360:{...r.rows[0],incidentCountSupported:false},authority:'DATABASE_BACKED_READ_ONLY'},send);
    });
  }

  if (method === 'GET' && path.startsWith('/v1/operations/case-context/')) {
    const a=auth(principal,['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const ref=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const calls=await softQuery(client,'case-context.calls',`select id,status,customer_ref,service_id,ticket_id,started_at from call_sessions where tenant_id=$1 and (id::text=$2 or customer_ref=$2) order by started_at desc limit 20`,[tid,ref]);
      const tickets=await softQuery(client,'case-context.tickets',`select id,status,type,service_id,technician_id,sla_deadline from tickets where tenant_id=$1 and (id::text=$2 or service_id::text=$2) order by created_at desc limit 50`,[tid,ref]);
      const incidents=await softQuery(client,'case-context.incidents',`select id,incident_key,title,severity,state,primary_asset_id from incidents where tenant_id=$1 and (id::text=$2 or primary_asset_id::text=$2) order by created_at desc limit 50`,[tid,ref]);
      const degraded=Boolean(calls.degraded||tickets.degraded||incidents.degraded);
      return json(res,200,{ok:true,caseContext:{reference:ref,calls:calls.rows,tickets:tickets.rows,incidents:incidents.rows},authority:'DATABASE_BACKED_OPERATIONAL_CORRELATION',syntheticData:false,autonomousDecision:false,dataDegraded:degraded},send);
    });
  }


  if (method === 'GET' && path.startsWith('/v1/network-intelligence/topology/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const asset=await client.query(`select id,asset_code,asset_type,status from network_assets where id=$1::uuid and tenant_id=$2`,[assetId,tid]);
      if(!asset.rows[0]) return json(res,404,{ok:false,error:'ASSET_NOT_FOUND'},send);
      const ports=await softQuery(client,'topology.ports',`select id,port_number,port_type,status from network_ports where asset_id=$1::uuid order by port_number`,[assetId]);
      const edges=await softQuery(client,'topology.edges',`select id,from_asset_id,to_asset_id,relation,active from physical_topology_edges where tenant_id=$1 and (from_asset_id=$2::uuid or to_asset_id=$2::uuid)`,[tid,assetId]);
      return json(res,200,{ok:true,topology:{asset:asset.rows[0],ports:ports.rows,edges:edges.rows},authority:'DATABASE_BACKED_TOPOLOGY_GRAPH_READ_ONLY',syntheticData:false,liveNms:false,faultAutomation:false,dataDegraded:Boolean(ports.degraded||edges.degraded)},send);
    });
  }

  if (method === 'GET' && path.startsWith('/v1/network-intelligence/path/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const asset=await client.query(`select id,asset_code,asset_type,status from network_assets where id=$1::uuid and tenant_id=$2`,[assetId,tid]);
      if(!asset.rows[0]) return json(res,404,{ok:false,error:'ASSET_NOT_FOUND'},send);
      const ports=await softQuery(client,'network-path.ports',`select id,port_number,port_type,status from network_ports where asset_id=$1::uuid order by port_number`,[assetId]);
      return json(res,200,{ok:true,networkPath:{asset:asset.rows[0],ports:ports.rows},authority:'DATABASE_BACKED_TOPOLOGY_READ_ONLY',syntheticData:false,liveNms:false,autonomousFaultIsolation:false,dataDegraded:Boolean(ports.degraded)},send);
    });
  }


  if (method === 'GET' && path.startsWith('/v1/network-intelligence/traverse/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const result=await softQuery(client,'traverse.graph',`with recursive graph as (select id,from_asset_id,to_asset_id,relation,active,0 depth from physical_topology_edges where tenant_id=$1 and (from_asset_id=$2::uuid or to_asset_id=$2::uuid) union all select e.id,e.from_asset_id,e.to_asset_id,e.relation,e.active,g.depth+1 from physical_topology_edges e join graph g on (e.from_asset_id=g.to_asset_id or e.to_asset_id=g.from_asset_id) where e.tenant_id=$1 and g.depth < 5) select distinct id,from_asset_id,to_asset_id,relation,active,depth from graph order by depth,id`,[tid,assetId]);
      return json(res,200,{ok:true,traversal:{rootAssetId:assetId,edges:result.rows,maxDepth:5},authority:'DATABASE_BACKED_GRAPH_TRAVERSAL_ADVISORY',syntheticData:false,impactAutomation:false,dataDegraded:Boolean(result.degraded)},send);
    });
  }


  if (method === 'GET' && path.startsWith('/v1/network-intelligence/impact/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const graph=await softQuery(client,'impact.graph',`with recursive graph as (
        select id,from_asset_id,to_asset_id,relation,active,0 depth
        from physical_topology_edges
        where tenant_id=$1 and (from_asset_id=$2::uuid or to_asset_id=$2::uuid)
        union all
        select e.id,e.from_asset_id,e.to_asset_id,e.relation,e.active,g.depth+1
        from physical_topology_edges e join graph g
        on (e.from_asset_id=g.to_asset_id or e.to_asset_id=g.from_asset_id)
        where e.tenant_id=$1 and g.depth < 5
      ) select distinct id,from_asset_id,to_asset_id,relation,active,depth from graph order by depth,id`,
      [tid,assetId]);
      const incidents=await softQuery(client,'impact.incidents',`select id,state from incidents where tenant_id=$1 and state not in ('closed','resolved')`,[tid]);
      return json(res,200,{
        ok:true,
        impact:{
          rootAssetId:assetId,
          topologyEdges:graph.rows,
          activeIncidents:incidents.rows,
          maxDepth:5
        },
        authority:'DATABASE_BACKED_IMPACT_ADVISORY',
        syntheticData:false,
        automaticIsolation:false,
        autonomousResolution:false,
        dataDegraded:Boolean(graph.degraded||incidents.degraded)
      },send);
    });
  }


  if (method === 'GET' && path.startsWith('/v1/network-intelligence/customer-impact/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const graph=await softQuery(client,'customer-impact.graph',`with recursive impacted as (
        select to_asset_id asset_id,0 depth from physical_topology_edges
        where tenant_id=$1 and from_asset_id=$2::uuid
        union all
        select e.to_asset_id,g.depth+1 from physical_topology_edges e join impacted g on e.from_asset_id=g.asset_id
        where e.tenant_id=$1 and g.depth < 5
      )
      select distinct asset_id,depth from impacted order by depth,asset_id`,[tid,assetId]);
      const services=[];
      return json(res,200,{
        ok:true,
        customerImpact:{
          rootAssetId:assetId,
          impactedAssets:graph.rows,
          directlyLinkedServices:services,
          directServiceLinkageSupported:false
        },
        authority:'DATABASE_BACKED_CUSTOMER_IMPACT_ADVISORY',
        syntheticData:false,
        automaticCustomerNotification:false,
        autonomousResolution:false,
        dataDegraded:Boolean(graph.degraded)
      },send);
    });
  }



  if (method === 'GET' && path.startsWith('/v1/network-intelligence/root-cause/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    const url=new URL(req.url || path,'http://fiberos.local');
    const windowMinutes=Math.max(5,Math.min(1440,Number(url.searchParams.get('windowMinutes')||60)));
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const asset=await client.query(`select id,asset_code,asset_type,status from network_assets where id=$1::uuid and tenant_id=$2`,[assetId,tid]);
      if(!asset.rows[0]) return json(res,404,{ok:false,error:'ASSET_NOT_FOUND'},send);
      const fromTs=new Date(Date.now()-windowMinutes*60000).toISOString();
      const signals=await client.query(`select external_alarm_id as alarm_id,asset_id,alarm_code,severity,source,correlation_key,observed_at,cleared_at,metadata from alarm_signals where tenant_id=$1 and observed_at >= $2::timestamptz and observed_at <= now() order by observed_at asc limit 5000`,[tid,fromTs]);
      const edges=await client.query(`select from_asset_id,to_asset_id,relation,active from physical_topology_edges where tenant_id=$1 and active=true`,[tid]);
      const correlated=fieldOperationsIntelligence.correlateAlarmSignals(signals.rows.map(x=>({alarmId:x.alarm_id,assetId:x.asset_id,code:x.alarm_code,severity:x.severity,source:x.source,correlationKey:x.correlation_key,observedAt:x.observed_at,clearedAt:x.cleared_at,metadata:x.metadata})),edges.rows,{windowMinutes});
      const match=correlated.filter(c=>c.assets.includes(assetId));
      return json(res,200,{ok:true,rootCause:{asset:asset.rows[0],windowMinutes,clusters:match},authority:'DETERMINISTIC_ALARM_TOPOLOGY_CORRELATION_ADVISORY',syntheticData:false,autonomousAction:false,prediction:false,dataDegraded:false},send);
    });
  }

  if (method === 'GET' && path.startsWith('/v1/network-intelligence/optical-health/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    const url=new URL(req.url || path,'http://fiberos.local');
    const hours=Math.max(1,Math.min(8760,Number(url.searchParams.get('hours')||168)));
    const rateParam=url.searchParams.get('degradationRatePerDay');
    const threshold=rateParam==null||rateParam===''?null:Number(rateParam);
    if(threshold!==null && (!Number.isFinite(threshold)||threshold<0)) return json(res,400,{ok:false,error:'DEGRADATION_RATE_INVALID'},send);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const asset=await client.query(`select id,asset_code,asset_type,status from network_assets where id=$1::uuid and tenant_id=$2`,[assetId,tid]);
      if(!asset.rows[0]) return json(res,404,{ok:false,error:'ASSET_NOT_FOUND'},send);
      const r=await client.query(`select measurement_id,asset_id,port_id,asset_code,asset_type,measurement_type,value_numeric,unit,source,sor_file_ref,measured_by,measured_at,previous_value,delta_from_previous from optical_health_timeline where tenant_id=$1 and asset_id=$2::uuid and measured_at>=now()-($3::int*interval '1 hour') order by measured_at,measurement_id`,[tid,assetId,hours]);
      const byType={};
      for(const row of r.rows){ if(!byType[row.measurement_type])byType[row.measurement_type]=[]; byType[row.measurement_type].push(row); }
      const fingerprints={};
      for(const [type,samples] of Object.entries(byType)){
        if(!['rx_power','insertion_loss'].includes(type) || samples.length<2) continue;
        fingerprints[type]=fieldOperationsIntelligence.opticalHealthFingerprint(samples,{degradationRatePerDay:threshold,lowerIsWorse:type!=='insertion_loss'});
      }
      return json(res,200,{ok:true,opticalHealth:{asset:asset.rows[0],windowHours:hours,sampleCount:r.rowCount,timeline:r.rows,fingerprints},authority:'DATABASE_BACKED_OPTICAL_HEALTH_TIMELINE',syntheticData:false,forecasting:false,dataDegraded:false},send);
    });
  }

  if (method === 'GET' && path.startsWith('/v1/network-intelligence/capacity/')) {
    const a=auth(principal,['ops_manager','area_supervisor','dispatcher','exec','sysadmin','qc']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const assetId=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const r=await client.query(`select asset_id,tenant_id,asset_code,asset_type,total_ports,used_ports,reserved_ports,provisioned_ports,free_ports,utilization_pct,over_capacity from pon_capacity_intelligence where tenant_id=$1 and asset_id=$2::uuid`,[tid,assetId]);
      if(!r.rows[0]) return json(res,404,{ok:false,error:'ASSET_CAPACITY_NOT_FOUND'},send);
      const row=r.rows[0];
      const capacity=fieldOperationsIntelligence.capacityIntelligence({totalPorts:row.total_ports ?? 0,provisionedPorts:row.provisioned_ports,usedPorts:row.used_ports,reservedPorts:row.reserved_ports});
      return json(res,200,{ok:true,capacity:{assetId:row.asset_id,assetCode:row.asset_code,assetType:row.asset_type,...capacity},authority:'DATABASE_DERIVED_PORT_CAPACITY_INTELLIGENCE',syntheticData:false,autonomousProvisioning:false,dataDegraded:false},send);
    });
  }

  if (method === 'GET' && /^\/v1\/operations\/trace\/contact-center\/conversations\/[0-9a-f-]+$/i.test(path)) {
    const a = auth(principal, ['call_center','ops_manager','area_supervisor','dispatcher','exec','sysadmin']);
    if (!a.ok) return send(res,a.status,a.body);
    assertDb(db);
    const conversationId = path.split('/').pop();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) {
      return json(res,400,{ok:false,error:'CC_CONVERSATION_ID_INVALID'},send);
    }
    return withPrincipal(db,principal,async client=>{
      const tid = await tenant(client);
      const conversation = await client.query(
        `select id,tenant_id,channel,call_session_id,customer_ref,language_code,locale,dialect_mode,status,correlation_id,idempotency_key,created_at,updated_at
         from contact_center_conversations
         where id=$1::uuid and tenant_id=$2`,
        [conversationId,tid]
      );
      if (!conversation.rows[0]) return json(res,404,{ok:false,error:'CC_CONVERSATION_NOT_FOUND'},send);
      const events = await client.query(
        `select event_id,event_type,aggregate_type,aggregate_id,correlation_id,causation_id,idempotency_key,
                runtime_verification_status,publish_status,occurred_at,payload_sha256,integrity_sha256
         from outbox_events
         where tenant_id=$1
           and aggregate_type='contact_center_conversation'
           and aggregate_id=$2
         order by occurred_at asc,created_at asc,event_id asc`,
        [tid,conversationId]
      );
      const eventIds = events.rows.map(e=>e.event_id);
      let incidentLinks={rows:[]}, evidenceLinks={rows:[]}, incidents={rows:[]}, evidence={rows:[]};
      if(eventIds.length){
        incidentLinks = await client.query(
          `select id,event_id,incident_id,link_role,created_by,created_at
           from operational_event_incident_links
           where tenant_id=$1 and event_id=any($2::uuid[])
           order by created_at asc,id asc`,
          [tid,eventIds]
        );
        evidenceLinks = await client.query(
          `select id,event_id,evidence_vault_id,link_role,created_by,created_at
           from operational_event_evidence_links
           where tenant_id=$1 and event_id=any($2::uuid[])
           order by created_at asc,id asc`,
          [tid,eventIds]
        );
      }
      const incidentIds=[...new Set(incidentLinks.rows.map(x=>String(x.incident_id)))];
      const evidenceIds=[...new Set(evidenceLinks.rows.map(x=>String(x.evidence_vault_id)))];
      if(incidentIds.length){
        incidents=await client.query(
          `select id,tenant_id,incident_key,title,severity,state,affected_customers,declared_at,sla_deadline,updated_at
           from incidents where tenant_id=$1 and id=any($2::uuid[])`,
          [tid,incidentIds]
        );
      }
      if(evidenceIds.length){
        evidence=await client.query(
          `select id,tenant_id,evidence_class,source_path,content_sha256,storage_status,storage_reference,
                  captured_at,received_at,verification_method,provider_verified_sha256,provider_verified_at,retention_until
           from evidence_vault_objects
           where tenant_id=$1 and id=any($2::uuid[])
           order by captured_at asc,id asc`,
          [tid,evidenceIds]
        );
      }
      const trace = buildOperationalTrace({
        conversation: conversation.rows[0],
        events: events.rows,
        incidentLinks: incidentLinks.rows,
        incidents: incidents.rows,
        evidenceLinks: evidenceLinks.rows,
        evidence: evidence.rows
      });
      return json(res,200,{
        ok:true,
        trace,
        authority:'DATABASE_BACKED_OPERATIONAL_TRACE',
        runtimeVerification:'UNVERIFIED',
        syntheticData:false
      },send);
    });
  }

  if (method === 'GET' && path.startsWith('/v1/operations/evidence-chain/')) {
    const a=auth(principal,['technician','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const ticketId=path.split('/').pop();
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const ticket=await client.query(`select id,tenant_id,status,technician_id,created_at,updated_at from tickets where id=$1::uuid and tenant_id=$2`,[ticketId,tid]);
      if(!ticket.rows[0])return json(res,404,{ok:false,error:'TICKET_NOT_FOUND'},send);
      const t=ticket.rows[0];
      const entries=[{type:'ticket',reference:t.id,observedAt:t.created_at},{type:'timestamp',observedAt:t.updated_at}];
      if(t.technician_id){
        const tech=await client.query(`select id,name from technicians where id=$1::uuid and tenant_id=$2`,[t.technician_id,tid]);
        if(tech.rows[0])entries.splice(1,0,{type:'technician',reference:tech.rows[0].id});
        const pos=await client.query(`select id,captured_at from technician_positions where tenant_id=$1 and technician_id=$2::uuid and captured_at between $3::timestamptz and $4::timestamptz order by captured_at desc,id desc limit 1`,[tid,t.technician_id,t.created_at,t.updated_at]);
        if(pos.rows[0])entries.splice(2,0,{type:'gps',reference:String(pos.rows[0].id),observedAt:pos.rows[0].captured_at});
      }
      const splices=await client.query(`select sr.id,sr.created_at,sr.worker_id,sr.port_a_id,sr.port_b_id,sr.evidence_ref from splice_records sr where sr.tenant_id=$1 and sr.ticket_id=$2::uuid order by sr.created_at asc,sr.id`,[tid,ticketId]);
      for(const sr of splices.rows){
        if(sr.port_a_id||sr.port_b_id){
          const ids=[sr.port_a_id,sr.port_b_id].filter(Boolean);
          const ports=await client.query(`select p.id,p.card_id,p.asset_id from network_ports p where p.id=any($1::uuid[])`,[ids]);
          for(const port of ports.rows){
            entries.push({type:'port',reference:port.id,observedAt:sr.created_at});
            if(port.card_id)entries.push({type:'card',reference:port.card_id,observedAt:sr.created_at});
            if(port.asset_id)entries.push({type:'asset',reference:port.asset_id,observedAt:sr.created_at});
          }
        }
        entries.push({type:'splice',reference:sr.id,observedAt:sr.created_at});
      }
      const evidence=await client.query(`select id,kind,captured_at,content_hash,source from evidence where tenant_id=$1 and ticket_id=$2::uuid order by captured_at asc,id`,[tid,ticketId]);
      for(const ev of evidence.rows){
        if(ev.kind==='photo')entries.push({type:'photo',reference:ev.id,observedAt:ev.captured_at,source:ev.source,contentHash:ev.content_hash});
        if(ev.kind==='rx_reading')entries.push({type:'rx',reference:ev.id,observedAt:ev.captured_at,source:ev.source,contentHash:ev.content_hash});
        if(ev.kind==='otdr_sor')entries.push({type:'otdr',reference:ev.id,observedAt:ev.captured_at,source:ev.source,contentHash:ev.content_hash});
      }
      const measurements=await client.query(`select om.id,om.port_id,om.asset_id,om.measurement_type,om.measured_at,om.source,om.sor_file_ref from optical_measurements om where om.tenant_id=$1 and om.measured_at between $2::timestamptz and $3::timestamptz and (om.asset_id in (select distinct p.asset_id from network_ports p join splice_records sr on sr.ticket_id=$4::uuid and (p.id=sr.port_a_id or p.id=sr.port_b_id)) or om.port_id in (select sr.port_a_id from splice_records sr where sr.ticket_id=$4::uuid and sr.port_a_id is not null) or om.port_id in (select sr.port_b_id from splice_records sr where sr.ticket_id=$4::uuid and sr.port_b_id is not null)) order by om.measured_at asc,om.id`,[tid,t.created_at,t.updated_at,ticketId]);
      for(const m of measurements.rows){
        const type=m.measurement_type==='rx_power'?'rx':m.measurement_type==='otdr_trace'?'otdr':null;
        if(type)entries.push({type,reference:String(m.id),observedAt:m.measured_at,source:m.source});
      }
      entries.push({type:'closure',reference:t.status,observedAt:t.updated_at});
      const orderedEntries=entries.slice().sort((x,y)=>{
        const xo=['ticket','technician','gps','asset','card','port','splice','rx','otdr','photo','timestamp','closure'].indexOf(x.type);
        const yo=['ticket','technician','gps','asset','card','port','splice','rx','otdr','photo','timestamp','closure'].indexOf(y.type);
        return xo-yo || String(x.observedAt||'').localeCompare(String(y.observedAt||'')) || String(x.reference||'').localeCompare(String(y.reference||''));
      });
      const chain=fieldOperationsIntelligence.buildEvidenceChain(orderedEntries);
      return json(res,200,{ok:true,evidenceChain:{ticketId,chain,sourceCounts:{databaseEvidence:evidence.rowCount,splices:splices.rowCount,opticalMeasurements:measurements.rowCount}},authority:'DATABASE_DERIVED_EVIDENCE_CHAIN',syntheticData:false,autonomousVerification:false},send);
    });
  }

  if (method === 'POST' && path.startsWith('/v1/operations/evidence-chain/') && path.endsWith('/certify')) {
    const a=auth(principal,['technician','team_lead','qc','ops_manager','area_supervisor','dispatcher','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    const ticketId=path.split('/')[4];
    if(!ticketId)return json(res,400,{ok:false,error:'TICKET_ID_REQUIRED'},send);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      const ticket=await client.query(`select id,status,technician_id,created_at,updated_at from tickets where id=$1::uuid and tenant_id=$2`,[ticketId,tid]);
      if(!ticket.rows[0])return json(res,404,{ok:false,error:'TICKET_NOT_FOUND'},send);
      if(ticket.rows[0].status!=='completed')return json(res,409,{ok:false,error:'EVIDENCE_CHAIN_REQUIRES_COMPLETED_TICKET',status:ticket.rows[0].status},send);
      const existing=await client.query(`select id,chain_hash,status,certificate,created_at from evidence_chain_certificates where tenant_id=$1 and ticket_id=$2::uuid order by created_at desc limit 1`,[tid,ticketId]);
      if(existing.rows[0])return json(res,200,{ok:true,persisted:true,certificate:existing.rows[0],idempotent:true,authority:'DATABASE_DERIVED_EVIDENCE_CHAIN'},send);
      const chainRows=await client.query(`select e.id,e.kind,e.captured_at,e.source,e.content_hash from evidence e where e.tenant_id=$1 and e.ticket_id=$2::uuid order by e.captured_at asc,e.id`,[tid,ticketId]);
      const positions=ticket.rows[0].technician_id ? await client.query(`select id,captured_at from technician_positions where tenant_id=$1 and technician_id=$2::uuid and captured_at between $3::timestamptz and $4::timestamptz order by captured_at desc,id desc limit 1`,[tid,ticket.rows[0].technician_id,ticket.rows[0].created_at,ticket.rows[0].updated_at]) : {rows:[]};
      const splices=await client.query(`select id,created_at,port_a_id,port_b_id from splice_records where tenant_id=$1 and ticket_id=$2::uuid order by created_at asc,id`,[tid,ticketId]);
      const entries=[{type:'ticket',reference:ticketId,observedAt:ticket.rows[0].created_at}];
      if(ticket.rows[0].technician_id)entries.push({type:'technician',reference:ticket.rows[0].technician_id});
      if(positions.rows[0])entries.push({type:'gps',reference:String(positions.rows[0].id),observedAt:positions.rows[0].captured_at});
      for(const sr of splices.rows){
        const ports=[sr.port_a_id,sr.port_b_id].filter(Boolean);
        for(const pid of ports){
          const pr=await client.query(`select id,card_id,asset_id from network_ports where id=$1::uuid`,[pid]);
          if(pr.rows[0]){
            if(pr.rows[0].asset_id)entries.push({type:'asset',reference:pr.rows[0].asset_id,observedAt:sr.created_at});
            if(pr.rows[0].card_id)entries.push({type:'card',reference:pr.rows[0].card_id,observedAt:sr.created_at});
            entries.push({type:'port',reference:pr.rows[0].id,observedAt:sr.created_at});
          }
        }
        entries.push({type:'splice',reference:sr.id,observedAt:sr.created_at});
      }
      for(const ev of chainRows.rows){
        if(ev.kind==='photo')entries.push({type:'photo',reference:ev.id,observedAt:ev.captured_at,source:ev.source,contentHash:ev.content_hash});
        if(ev.kind==='rx_reading')entries.push({type:'rx',reference:ev.id,observedAt:ev.captured_at,source:ev.source,contentHash:ev.content_hash});
        if(ev.kind==='otdr_sor')entries.push({type:'otdr',reference:ev.id,observedAt:ev.captured_at,source:ev.source,contentHash:ev.content_hash});
      }
      entries.push({type:'timestamp',observedAt:ticket.rows[0].updated_at});
      entries.push({type:'closure',reference:'completed',observedAt:ticket.rows[0].updated_at});
      const orderedEntries=entries.slice().sort((x,y)=>{
        const xo=['ticket','technician','gps','asset','card','port','splice','rx','otdr','photo','timestamp','closure'].indexOf(x.type);
        const yo=['ticket','technician','gps','asset','card','port','splice','rx','otdr','photo','timestamp','closure'].indexOf(y.type);
        return xo-yo || String(x.observedAt||'').localeCompare(String(y.observedAt||'')) || String(x.reference||'').localeCompare(String(y.reference||''));
      });
      const chain=fieldOperationsIntelligence.buildEvidenceChain(orderedEntries);
      if(!chain.completeness.orderValid || chain.completeness.missingTypes.length) return json(res,409,{ok:false,error:'EVIDENCE_CHAIN_INCOMPLETE',chain},send);
      await client.query('BEGIN');
      try{
        const ins=await client.query(`insert into evidence_chain_certificates(tenant_id,ticket_id,actor_id,chain_hash,certificate,status) values($1,$2::uuid,$3::uuid,$4,$5::jsonb,'COMPLETE') on conflict (tenant_id,ticket_id,chain_hash) do nothing returning id,chain_hash,status,created_at`,[tid,ticketId,principal.sub,chain.chainHash,JSON.stringify(chain)]);
        let ledger=null;
        if(ins.rowCount){
          ledger=await appendLedgerBlock(client,{eventType:'EVIDENCE_CHAIN_CERTIFIED',actorId:principal.sub,payload:{ticketId,chainHash:chain.chainHash,certificateId:chain.certificateId},env:process.env});
        }
        await client.query('COMMIT');
        return json(res,200,{ok:true,persisted:Boolean(ins.rowCount),certificate:ins.rows[0]||null,chainHash:chain.chainHash,ledger,authority:'HASHED_EVIDENCE_CHAIN_WITH_OPTIONAL_APPEND_ONLY_LEDGER',syntheticData:false,autonomousVerification:false},send);
      }catch(e){await client.query('ROLLBACK');throw e;}
    });
  }

  if (method === 'GET' && path === '/v1/events/processing/health') {
    const a=auth(principal,['ops_manager','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body); assertDb(db);
    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);
      let result;
      try {
        result = await client.query(`select
          count(*) filter(where status='READY') ready_count,
          count(*) filter(where status='PROCESSED') processed_count,
          count(*) filter(where status='FAILED') failed_count
          from event_processing_attempts where tenant_id=$1`,[tid]);
      } catch (e) {
        logError('event_processing_health_query_failed', {
          error:String(e && e.message || e)
        });
        return json(res,503,{ok:false,error:'EVENT_PROCESSING_HEALTH_UNAVAILABLE',dataDegraded:true,authority:'DATABASE_BACKED_EVENT_PROCESSING_OBSERVABILITY'},send);
      }
      return json(res,200,{
        ok:true,
        eventProcessing:{
          ready:Number(result.rows[0].ready_count||0),
          processed:Number(result.rows[0].processed_count||0),
          failed:Number(result.rows[0].failed_count||0)
        },
        authority:'DATABASE_BACKED_EVENT_PROCESSING_OBSERVABILITY',
        brokerConnected:false,
        liveStreaming:false,
        autonomousConsumers:false,
        syntheticData:false
      },send);
    });
  }


  if (method === 'POST' && path === '/v1/events/runtime/validate') {
    const a=auth(principal,['ops_manager','exec','sysadmin']); if(!a.ok)return send(res,a.status,a.body);
    assertDb(db);
    const body=ctx.body || {};
    if (Object.prototype.hasOwnProperty.call(body, 'tenant_id') ||
        Object.prototype.hasOwnProperty.call(body, 'tenantId')) {
      return json(res,400,{ok:false,error:'TENANT_ID_FORBIDDEN'},send);
    }
    const eventId=String(body.event_id || '').trim();
    const aggregateType=String(body.aggregate_type || '').trim();

    if(!eventId || !aggregateType){
      return json(res,400,{ok:false,error:'EVENT_CONTRACT_REQUIRED'},send);
    }

    return withPrincipal(db,principal,async client=>{
      const tid=await tenant(client);

      const result=await client.query(
        `insert into event_processing_attempts
          (tenant_id,event_id,status,attempt_count)
         values($1,$2::uuid,'READY',0)
         on conflict (tenant_id,event_id) do update
         set updated_at=now()
         returning event_id,status,attempt_count`,
        [tid,eventId]
      );

      return json(res,200,{
        ok:true,
        eventRuntime:{
          accepted:true,
          event:result.rows[0]
        },
        authority:'DATABASE_BACKED_EVENT_RUNTIME_VALIDATION',
        duplicateSafe:true,
        brokerConnected:false,
        liveStreaming:false,
        syntheticData:false
      },send);
    });
  }


  if (method === 'GET' && path === '/v1/events/runtime/recovery') {
    const a = auth(principal, ['ops_manager','area_supervisor','exec','sysadmin']);
    if (!a.ok) return send(res,a.status,a.body);
    assertDb(db);
    return withPrincipal(db, principal, async (client)=>{
      const tid = await tenant(client);
      const result = await client.query(
        `select status, count(*)::int as count
         from event_processing_attempts
         where tenant_id=$1
         group by status
         order by status`,
        [tid]
      );
      return json(res,200,{
        ok:true,
        recovery:{
          processingStates:result.rows,
          retryExecution:false,
          deadLetterExecution:false
        },
        authority:'DATABASE_BACKED_EVENT_RECOVERY_OBSERVABILITY',
        brokerConnected:false,
        autonomousRecovery:false,
        syntheticData:false
      },send);
    });
  }


  if (method === 'GET' && path === '/v1/integration/readiness') {
    const a = auth(principal, ['ops_manager','area_supervisor','exec','sysadmin']);
    if (!a.ok) return send(res,a.status,a.body);
    return json(res,200,{
      ok:true,
      readiness:{
        databaseBacked:true,
        externalAdapters:true,
        healthChecks:false,
        providerCredentialsConfigured:false,
        deploymentAutomation:false
      },
      integrations:{
        nms:{
          configured:false,
          liveTelemetry:false
        },
        telephony:{
          configured:false,
          liveCalls:false
        },
        gis:{
          configured:false,
          liveLayers:false
        }
      },
      authority:'INTEGRATION_BOUNDARY_READINESS_REPORT',
      syntheticData:false
    },send);
  }



  if (method === 'GET' && path === '/v1/security/hardening/readiness') {
    const a = auth(principal, ['ops_manager','area_supervisor','exec','sysadmin']);
    if (!a.ok) return send(res,a.status,a.body);
    return json(res,200,{
      ok:true,
      controls:{
        authenticationGate:true,
        authorizationGate:true,
        auditRequired:true,
        rateLimitingConfigured:true,
        securityHeadersConfigured:true,
        secretRotationConfigured:false,
        dependencyScanningConfigured:false
      },
      authority:'SECURITY_HARDENING_READINESS_REPORT',
      syntheticData:false
    },send);
  }

  return null;
}
module.exports={handleOperations,softQuery};
