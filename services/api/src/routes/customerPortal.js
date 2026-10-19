'use strict';

const crypto = require('node:crypto');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { appendOperationalEvent } = require('../../../../packages/operational-context/src');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const {
  PORTAL_BILLING_INTERVALS,
  PORTAL_REPORT_TYPES,
  normalizePortalBillingInterval,
  normalizePortalReportType,
  normalizePortalRecipients,
  validatePortalReportWindow,
  nextPortalRunAt,
  renderPortalReportCsv,
  portalSha256,
  periodKeyFor,
  evaluatePlanEntitlements,
  authorizeUsage,
  normalizeOrderType,
  normalizeOrderStatus,
  assertOrderTransition,
  evaluateSlaClocks,
  detectAllSlaThresholds,
  sumUsageDeltas
} = require('../../../../packages/productization/src');

const PORTAL_ROLES = Object.freeze([
  'customer',
  'contractor',
  'exec',
  'cfo',
  'ops_manager',
  'area_supervisor',
  'sysadmin'
]);
const PORTAL_INTERNAL_ROLES = Object.freeze(['exec','cfo','ops_manager','area_supervisor','sysadmin']);
const PORTAL_ADMIN_ROLES = Object.freeze(['owner','admin','billing']);
const PORTAL_MAX_ROWS = 100;

function assertDb(db) {
  if (!db || !db.configured || !db.pool) {
    throw Object.assign(new Error('DATABASE_REQUIRED'), { statusCode: 503, code: 'DATABASE_REQUIRED' });
  }
}

function auth(principal) {
  const verified = requireVerifiedPrincipal(principal, process.env);
  if (!verified.ok) return verified;
  return requireAnyRole(principal, PORTAL_ROLES);
}

function rejectClientTenant(body) {
  if (!body || typeof body !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(body, 'tenantId') || Object.prototype.hasOwnProperty.call(body, 'tenant_id')) {
    throw Object.assign(new Error('TENANT_ID_FORBIDDEN'), {
      statusCode: 400,
      code: 'TENANT_ID_FORBIDDEN'
    });
  }
}

function uuid(value, code='UUID_INVALID') {
  const v = String(value || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v)) {
    throw Object.assign(new Error(code), { statusCode: 400, code });
  }
  return v;
}

function idempotencyKey(body) {
  rejectClientTenant(body);
  const key = String(body?.idempotencyKey || '').trim();
  if (key.length < 16 || key.length > 160) {
    throw Object.assign(new Error('IDEMPOTENCY_KEY_REQUIRED'), { statusCode: 400, code: 'IDEMPOTENCY_KEY_REQUIRED' });
  }
  return key;
}

async function tenantContext(client) {
  const r = await client.query(
    'select up.tenant_id, t.name, t.slug, t.default_locale, t.timezone, t.currency ' +
    'from user_preferences up join tenants t on t.id=up.tenant_id ' +
    'where up.user_id=auth.uid() limit 1'
  );
  if (!r.rows[0]?.tenant_id) {
    throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'), { statusCode: 403, code: 'TENANT_CONTEXT_REQUIRED' });
  }
  return r.rows[0];
}

async function portalMembership(client, tenantId, principal) {
  const r = await client.query(
    'select id,user_id,portal_role,work_type_scope,active,created_at,updated_at ' +
    'from portal_tenant_memberships where tenant_id=$1 and user_id=auth.uid() and active=true limit 1',
    [tenantId]
  );
  if (r.rows[0]) return r.rows[0];

  const internal = PORTAL_INTERNAL_ROLES.includes(String(principal?.role || ''));
  return {
    id: null,
    user_id: principal?.sub || null,
    portal_role: internal ? 'admin' : (principal?.role === 'customer' ? 'billing' : (principal?.role === 'contractor' ? 'contractor_field' : 'viewer')),
    work_type_scope: [],
    active: true,
    implicit: true
  };
}

async function emitPortalOrderEvent(client, { tenantId, principal, operation, eventType, orderId, idempotencyKey, fromStatus, toStatus, payload }) {
  return appendOperationalEvent(client, {
    tenantId,
    correlationId: String(payload?.correlationId || 'service-order:' + orderId),
    causationId: payload?.causationId || null,
    actorId: principal?.sub || null,
    role: principal?.role || null,
    operation,
    networkFamily: String(payload?.networkFamily || 'unknown').trim().toLowerCase(),
    subjectRef: { type: 'service_order', id: String(orderId) },
    entityRefs: [
      { type: 'service_order', id: String(orderId) }
    ],
    truthBoundary: 'CUSTOMER_ORDER_STATE_PERSISTED_AS_DATABASE_EVENT; DOWNSTREAM_FIELD_EXECUTION_AND_EXTERNAL_PROVIDER_DELIVERY_REMAIN_SEPARATE',
    securityClassification: 'restricted',
    provenance: {
      origin: 'services/api/src/routes/customerPortal.js',
      requestIdempotencyKey: idempotencyKey,
      orderId: String(orderId),
      fromStatus: fromStatus || null,
      toStatus: toStatus || null
    },
    eventType,
    aggregateType: 'service_order',
    aggregateId: String(orderId),
    idempotencyKey: 'customer-order:' + operation.replace(/[^a-z0-9]+/gi, '_') + ':' + idempotencyKey,
    occurredAt: new Date().toISOString(),
    runtimeVerificationStatus: 'UNVERIFIED',
    payload: payload || {}
  });
}

const SLA_SUBJECT_TABLES = Object.freeze({
  ticket: 'tickets',
  service_order: 'portal_service_orders',
  incident: 'incidents',
  service: 'services',
  work_package: 'ftth_work_packages'
});

async function assertSlaSubject(client, tenantId, subjectType, subjectId) {
  const table = SLA_SUBJECT_TABLES[subjectType];
  if (!table) throw Object.assign(new Error('PORTAL_SLA_SUBJECT_TYPE_INVALID'), { statusCode: 400, code: 'PORTAL_SLA_SUBJECT_TYPE_INVALID' });
  const exists = await client.query(
    'select 1 from ' + table + ' where id=$1::uuid and tenant_id=$2::uuid limit 1',
    [subjectId, tenantId]
  );
  if (!exists.rows[0]) throw Object.assign(new Error('PORTAL_SLA_SUBJECT_NOT_IN_TENANT_SCOPE'), { statusCode: 403, code: 'PORTAL_SLA_SUBJECT_NOT_IN_TENANT_SCOPE' });
}

async function persistSlaThresholdEvents(client, {
  tenantId, principal, contractId, subjectType, subjectId, evaluation, sourceIdsByKind, correlationId
}) {
  const thresholds = detectAllSlaThresholds(evaluation);
  const persisted = [];
  for (const threshold of thresholds) {
    const sourceIds = [];
    for (const kind of ['detected', String(threshold.clockKind)]) {
      const id = sourceIdsByKind[kind];
      if (id && !sourceIds.includes(id)) sourceIds.push(id);
    }
    const eventKey = 'sla-enforcement:' + contractId + ':' + subjectType + ':' + subjectId + ':' + threshold.clockKind + ':' + threshold.thresholdPct;
    const ins = await client.query(
      `insert into portal_sla_enforcement_events(
         tenant_id,contract_id,subject_type,subject_id,clock_kind,threshold_pct,
         elapsed_minutes,limit_minutes,state,source_event_ids,details,event_idempotency_key
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::uuid[],$11::jsonb,$12)
       on conflict(tenant_id,event_idempotency_key) do nothing
       returning id,detected_at,state,event_idempotency_key`,
      [
        tenantId, contractId, subjectType, subjectId, threshold.clockKind,
        threshold.thresholdPct, threshold.elapsedMinutes, threshold.limitMinutes,
        threshold.state, sourceIds,
        JSON.stringify({ correlationId, evaluator: 'productization.detectAllSlaThresholds' }),
        eventKey
      ]
    );
    if (!ins.rows[0]) {
      const replay = await client.query(
        'select id,detected_at,state,event_idempotency_key from portal_sla_enforcement_events where tenant_id=$1 and event_idempotency_key=$2',
        [tenantId, eventKey]
      );
      if (replay.rows[0]) {
        persisted.push({ ...replay.rows[0], replayed: true });
        continue;
      }
      throw Object.assign(new Error('SLA_ENFORCEMENT_IDEMPOTENCY_RACE'), { statusCode: 409, code: 'SLA_ENFORCEMENT_IDEMPOTENCY_RACE' });
    }

    const emitted = await appendOperationalEvent(client, {
      tenantId,
      correlationId,
      causationId: sourceIds[0] || null,
      actorId: principal?.sub || null,
      role: principal?.role || null,
      operation: 'sla.threshold.enforcement',
      networkFamily: 'unknown',
      subjectRef: { type: subjectType, id: subjectId },
      entityRefs: [
        { type: subjectType, id: subjectId },
        { type: 'sla_contract', id: String(contractId) },
        { type: 'sla_enforcement', id: String(ins.rows[0].id) }
      ],
      truthBoundary: 'SLA_THRESHOLD_DERIVED_FROM_PERSISTED_CLOCK_EVENTS; ESCALATION OR REASSIGNMENT IS NOT AUTOMATICALLY IMPLIED',
      securityClassification: 'restricted',
      provenance: {
        origin: 'services/api/src/routes/customerPortal.js',
        eventSource: 'portal_sla_enforcement_events',
        eventId: String(ins.rows[0].id),
        thresholdPct: threshold.thresholdPct,
        sourceEventIds: sourceIds
      },
      eventType: threshold.state === 'breached' ? 'sla.threshold.breached' : 'sla.threshold.breach_risk',
      aggregateType: subjectType,
      aggregateId: subjectId,
      idempotencyKey: eventKey,
      occurredAt: ins.rows[0].detected_at,
      runtimeVerificationStatus: 'UNVERIFIED',
      payload: {
        contractId,
        subjectType,
        subjectId,
        clockKind: threshold.clockKind,
        thresholdPct: threshold.thresholdPct,
        elapsedMinutes: threshold.elapsedMinutes,
        limitMinutes: threshold.limitMinutes,
        state: threshold.state,
        sourceEventIds: sourceIds
      }
    });
    persisted.push({ ...ins.rows[0], outboxEventId: emitted.outbox.event_id, replayed: emitted.replayed });
  }
  return persisted;
}

function membershipCan(membership, capability) {
  if (!membership || !membership.active) return false;
  const role = String(membership.portal_role || '');
  if (PORTAL_ADMIN_ROLES.includes(role)) return true;
  const map = {
    read: ['owner','admin','operations','engineering','quality','billing','viewer','contractor_manager','contractor_supervisor','contractor_field'],
    reports: ['owner','admin','operations','engineering','quality','billing','viewer','contractor_manager','contractor_supervisor','contractor_field'],
    schedule: ['owner','admin','operations','engineering','quality','billing','contractor_manager','contractor_supervisor'],
    subscription: ['owner','admin','billing'],
    members: ['owner','admin'],
    billing: ['owner','admin','billing'],
    entitlements: ['owner','admin','operations','engineering','billing','viewer','contractor_manager'],
    orders: ['owner','admin','operations','engineering','contractor_manager','contractor_supervisor'],
    sla: ['owner','admin','operations','engineering','quality','viewer']
  };
  return (map[capability] || []).includes(role);
}

async function portalReport(client, tenantId, reportType, periodStart, periodEnd) {
  const r = await client.query(
    'select fiberos_portal_report($1::uuid,$2::text,$3::timestamptz,$4::timestamptz) as report',
    [tenantId, reportType, periodStart, periodEnd]
  );
  const report = r.rows[0]?.report;
  if (!report) throw Object.assign(new Error('PORTAL_REPORT_EMPTY'), { statusCode: 503, code: 'PORTAL_REPORT_EMPTY' });
  return report;
}

function reportWindowFromQuery(url) {
  const end = new Date();
  const daysRaw = Number(url.searchParams.get('days') || 30);
  if (!Number.isInteger(daysRaw) || daysRaw < 1 || daysRaw > 366) {
    throw Object.assign(new Error('PORTAL_REPORT_DAYS_INVALID'), { statusCode: 400, code: 'PORTAL_REPORT_DAYS_INVALID' });
  }
  const start = new Date(end.getTime() - daysRaw * 86400000);
  return { start, end };
}

async function handleBootstrap(client, tenant, membership) {
  const [subscription, plans, workTypes] = await Promise.all([
    client.query(
      'select s.id,s.status,s.payment_state,s.billing_interval,s.currency,s.amount_minor,s.started_at,' +
      's.current_period_start,s.current_period_end,s.auto_renew,s.provider,s.cancellation_at,s.created_at,' +
      'p.code plan_code,p.display_name plan_name,w.code work_type_code,w.display_name work_type_name ' +
      'from portal_subscriptions s join portal_plan_catalog p on p.id=s.plan_id ' +
      'join portal_work_type_catalog w on w.code=p.work_type_code ' +
      'where s.tenant_id=$1 order by s.created_at desc limit 5',
      [tenant.tenant_id]
    ),
    client.query(
      'select p.id,p.code,p.work_type_code,p.billing_interval,p.display_name,p.summary,p.currency,p.amount_minor,' +
      'p.quote_required,p.seat_limit,p.work_item_limit,p.feature_flags ' +
      'from portal_plan_catalog p where p.published=true and p.active=true ' +
      'order by p.work_type_code,p.billing_interval,p.code',
      []
    ),
    client.query(
      'select code,display_name,discipline,summary,required_evidence,standards,feature_flags ' +
      'from portal_work_type_catalog where active=true order by sort_order,code'
    )
  ]);

  return {
    ok: true,
    portalVersion: '2026.10.08',
    tenant: {
      id: tenant.tenant_id,
      name: tenant.name,
      slug: tenant.slug,
      locale: tenant.default_locale,
      timezone: tenant.timezone,
      currency: tenant.currency
    },
    membership,
    subscription: subscription.rows[0] || null,
    subscriptionHistory: subscription.rows,
    plans: plans.rows,
    workTypes: workTypes.rows,
    capabilities: {
      reports: membershipCan(membership, 'reports'),
      schedules: membershipCan(membership, 'schedule'),
      subscriptions: membershipCan(membership, 'subscription'),
      membershipAdmin: membershipCan(membership, 'members')
    },
    securityPosture: {
      tenantIsolation: 'RLS_ENFORCED_IN_DATABASE',
      routeAuthorization: 'CENTRAL_ROUTE_POLICY_PLUS_PORTAL_ROLE',
      session: 'OIDC_HTTPONLY_SECURE_SAMESITE_COOKIE_PLUS_CSRF',
      tenantAuthority: 'SERVER_DERIVED_FROM_AUTH_UID',
      paymentData: 'NO_CARD_DATA_STORED_BY_PORTAL',
      reportTruth: 'PERSISTED_DATABASE_FACTS_ONLY',
      limitations: [
        'Live deployment evidence, IdP/KMS/HSM/provider configuration and availability engineering remain environment-specific proof requirements.'
      ]
    }
  };
}

async function subscribe(client, tenant, membership, body, principal) {
  if (!membershipCan(membership, 'subscription')) {
    throw Object.assign(new Error('PORTAL_SUBSCRIPTION_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_SUBSCRIPTION_ROLE_REQUIRED' });
  }
  const key = idempotencyKey(body);
  const planId = uuid(body?.planId, 'PORTAL_PLAN_ID_INVALID');

  const prior = await client.query(
    'select s.id,s.status,s.payment_state,s.billing_interval,s.currency,s.amount_minor,p.code plan_code,p.display_name plan_name ' +
    'from portal_subscriptions s join portal_plan_catalog p on p.id=s.plan_id where s.tenant_id=$1 and s.idempotency_key=$2 limit 1',
    [tenant.tenant_id, key]
  );
  if (prior.rows[0]) return { ok:true, idempotent:true, subscription:prior.rows[0] };

  const plan = await client.query(
    'select id,code,work_type_code,billing_interval,display_name,currency,amount_minor,quote_required ' +
    'from portal_plan_catalog where id=$1 and published=true and active=true',
    [planId]
  );
  if (!plan.rows[0]) throw Object.assign(new Error('PORTAL_PLAN_NOT_FOUND'), { statusCode: 404, code: 'PORTAL_PLAN_NOT_FOUND' });
  const p = plan.rows[0];

  const live = await client.query(
    'select s.id,s.status,p.work_type_code from portal_subscriptions s join portal_plan_catalog p on p.id=s.plan_id ' +
    'where s.tenant_id=$1 and s.status in (\'pending\',\'active\',\'paused\',\'past_due\') and p.work_type_code=$2 limit 1',
    [tenant.tenant_id,p.work_type_code]
  );
  if (live.rows[0]) {
    throw Object.assign(new Error('PORTAL_WORK_TYPE_SUBSCRIPTION_EXISTS'), { statusCode: 409, code: 'PORTAL_WORK_TYPE_SUBSCRIPTION_EXISTS' });
  }

  const paymentState = p.quote_required ? 'quote_required' : 'pending_external_checkout';
  const inserted = await client.query(
    'insert into portal_subscriptions(' +
    'tenant_id,plan_id,status,payment_state,billing_interval,currency,amount_minor,auto_renew,provider,idempotency_key,created_by,updated_by,metadata) ' +
    'values($1,$2,\'pending\',$3,$4,$5,$6,true,\'external_checkout\',$7,$8::uuid,$8::uuid,$9::jsonb) ' +
    'returning id,status,payment_state,billing_interval,currency,amount_minor,auto_renew,provider,created_at',
    [
      tenant.tenant_id,p.id,paymentState,p.billing_interval,p.currency,p.amount_minor,
      key,principal?.sub || null,JSON.stringify({requestedByRole:principal?.role || null,planCode:p.code,workTypeCode:p.work_type_code})
    ]
  );

  const sub = inserted.rows[0];
  await client.query(
    'insert into portal_subscription_events(tenant_id,subscription_id,event_type,event_idempotency_key,actor_id,details) ' +
    'values($1,$2,\'created\',$3,$4::uuid,$5::jsonb)',
    [tenant.tenant_id,sub.id,key+':created',principal?.sub || null,JSON.stringify({planCode:p.code,billingInterval:p.billing_interval,paymentState})]
  );

  let invoice = null;
  if (!p.quote_required && p.amount_minor != null && p.currency) {
    const inv = await client.query(
      'insert into invoices(tenant_id,customer_ref,currency,amount_minor,status,due_at,provider_ref) ' +
      'values($1,$2,$3,$4,\'issued\',now()+interval \'7 days\',$5) ' +
      'returning id,currency,amount_minor,status,due_at,created_at',
      [tenant.tenant_id,tenant.slug,p.currency,p.amount_minor,'portal_subscription:'+sub.id]
    );
    invoice = inv.rows[0] || null;
  }

  return {
    ok:true,
    idempotent:false,
    subscription:sub,
    invoice,
    checkout:{
      state:paymentState,
      provider:p.quote_required ? null : 'external_checkout',
      quoteRequired:Boolean(p.quote_required),
      nextAction:p.quote_required ? 'SELLER_QUOTE_REQUIRED' : 'EXTERNAL_PROVIDER_CONFIGURATION_REQUIRED'
    },
    authority:'DATABASE_BACKED_PORTAL_SUBSCRIPTION'
  };
}

async function mutateSubscription(client, tenant, membership, body, principal, action, subscriptionId) {
  if (!membershipCan(membership, 'subscription')) {
    throw Object.assign(new Error('PORTAL_SUBSCRIPTION_ROLE_REQUIRED'), { statusCode:403, code:'PORTAL_SUBSCRIPTION_ROLE_REQUIRED' });
  }
  const key=idempotencyKey(body);
  const id=uuid(subscriptionId,'PORTAL_SUBSCRIPTION_ID_INVALID');
  const current=await client.query(
    'select id,status,payment_state,auto_renew,current_period_start,current_period_end from portal_subscriptions where tenant_id=$1 and id=$2 for update',
    [tenant.tenant_id,id]
  );
  if(!current.rows[0]) throw Object.assign(new Error('PORTAL_SUBSCRIPTION_NOT_FOUND'),{statusCode:404,code:'PORTAL_SUBSCRIPTION_NOT_FOUND'});
  const s=current.rows[0];

  if(action==='cancel'){
    if(s.status==='cancelled'||s.status==='expired') return {ok:true,idempotent:true,subscription:s};
    const reason=String(body?.reason||'customer_requested').trim().slice(0,240);
    const r=await client.query(
      'update portal_subscriptions set status=\'cancelled\',cancellation_at=now(),cancellation_reason=$1,auto_renew=false,updated_by=$2::uuid,version=version+1 where id=$3 and tenant_id=$4 ' +
      'returning id,status,auto_renew,cancellation_at,cancellation_reason',
      [reason,principal?.sub||null,id,tenant.tenant_id]
    );
    await client.query(
      'insert into portal_subscription_events(tenant_id,subscription_id,event_type,event_idempotency_key,actor_id,details) values($1,$2,\'cancelled\',$3,$4::uuid,$5::jsonb)',
      [tenant.tenant_id,id,key,principal?.sub||null,JSON.stringify({reason})]
    );
    return {ok:true,idempotent:false,subscription:r.rows[0]};
  }

  if(action==='auto-renew'){
    const enabled=Boolean(body?.autoRenew);
    const r=await client.query(
      'update portal_subscriptions set auto_renew=$1,updated_by=$2::uuid,version=version+1 where id=$3 and tenant_id=$4 ' +
      'returning id,status,auto_renew,current_period_end,version',
      [enabled,principal?.sub||null,id,tenant.tenant_id]
    );
    await client.query(
      'insert into portal_subscription_events(tenant_id,subscription_id,event_type,event_idempotency_key,actor_id,details) values($1,$2,\'renewal_toggled\',$3,$4::uuid,$5::jsonb)',
      [tenant.tenant_id,id,key,principal?.sub||null,JSON.stringify({autoRenew:enabled})]
    );
    return {ok:true,idempotent:false,subscription:r.rows[0]};
  }

  if(action==='pause'){
    if(s.status!=='active') throw Object.assign(new Error('PORTAL_SUBSCRIPTION_MUST_BE_ACTIVE_TO_PAUSE'),{statusCode:409,code:'PORTAL_SUBSCRIPTION_MUST_BE_ACTIVE_TO_PAUSE'});
    const r=await client.query(
      'update portal_subscriptions set status=\'paused\',updated_by=$1::uuid,version=version+1 where id=$2 and tenant_id=$3 returning id,status,current_period_end,version',
      [principal?.sub||null,id,tenant.tenant_id]
    );
    await client.query(
      'insert into portal_subscription_events(tenant_id,subscription_id,event_type,event_idempotency_key,actor_id) values($1,$2,\'paused\',$3,$4::uuid)',
      [tenant.tenant_id,id,key,principal?.sub||null]
    );
    return {ok:true,idempotent:false,subscription:r.rows[0]};
  }

  if(action==='resume'){
    if(s.status!=='paused') throw Object.assign(new Error('PORTAL_SUBSCRIPTION_MUST_BE_PAUSED_TO_RESUME'),{statusCode:409,code:'PORTAL_SUBSCRIPTION_MUST_BE_PAUSED_TO_RESUME'});
    const start=new Date();
    const end=new Date(start.getTime() + (
      s.current_period_end && s.current_period_start
        ? Math.max(86400000, new Date(s.current_period_end).getTime()-new Date(s.current_period_start).getTime())
        : 30*86400000
    ));
    const r=await client.query(
      'update portal_subscriptions set status=\'active\',current_period_start=$1,current_period_end=$2,updated_by=$3::uuid,version=version+1 where id=$4 and tenant_id=$5 returning id,status,current_period_start,current_period_end,version',
      [start.toISOString(),end.toISOString(),principal?.sub||null,id,tenant.tenant_id]
    );
    await client.query(
      'insert into portal_subscription_events(tenant_id,subscription_id,event_type,event_idempotency_key,actor_id,details) values($1,$2,\'resumed\',$3,$4::uuid,$5::jsonb)',
      [tenant.tenant_id,id,key,principal?.sub||null,JSON.stringify({periodReset:true})]
    );
    return {ok:true,idempotent:false,subscription:r.rows[0]};
  }

  throw Object.assign(new Error('PORTAL_SUBSCRIPTION_ACTION_INVALID'),{statusCode:400,code:'PORTAL_SUBSCRIPTION_ACTION_INVALID'});
}

async function scheduleReport(client, tenant, membership, body, principal) {
  if(!membershipCan(membership,'schedule')) throw Object.assign(new Error('PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'});
  const key=idempotencyKey(body);
  const existing=await client.query(
    'select id,name,report_type,report_format,cadence,weekday,day_of_month,month_of_year,hour,minute,timezone,recipients,active,next_run_at,last_run_at from portal_report_schedules where tenant_id=$1 and idempotency_key=$2',
    [tenant.tenant_id,key]
  );
  if(existing.rows[0]) return {ok:true,idempotent:true,schedule:existing.rows[0]};

  const name=String(body?.name||'').trim();
  if(!name) throw Object.assign(new Error('PORTAL_SCHEDULE_NAME_REQUIRED'),{statusCode:400,code:'PORTAL_SCHEDULE_NAME_REQUIRED'});
  const reportType=normalizePortalReportType(body?.reportType);
  const reportFormat=String(body?.format||'csv').trim().toLowerCase();
  if(!['json','csv'].includes(reportFormat)) throw Object.assign(new Error('PORTAL_REPORT_FORMAT_INVALID'),{statusCode:400,code:'PORTAL_REPORT_FORMAT_INVALID'});
  const cadence=normalizePortalBillingInterval(body?.cadence);
  if(!PORTAL_BILLING_INTERVALS.includes(cadence)) throw Object.assign(new Error('PORTAL_SCHEDULE_CADENCE_INVALID'),{statusCode:400,code:'PORTAL_SCHEDULE_CADENCE_INVALID'});
  const recipients=normalizePortalRecipients(body?.recipients);
  const timezone=String(body?.timezone||tenant.timezone||'UTC').trim();
  const hour=Number(body?.hour ?? 8);
  const minute=Number(body?.minute ?? 0);
  const weekday=body?.weekday == null ? null : Number(body.weekday);
  const dayOfMonth=body?.dayOfMonth == null ? null : Number(body.dayOfMonth);
  const monthOfYear=body?.monthOfYear == null ? null : Number(body.monthOfYear);
  const schedule={cadence,hour,minute,weekday,dayOfMonth,monthOfYear,timezone};
  const nextRun=nextPortalRunAt(schedule,new Date());

  const r=await client.query(
    'insert into portal_report_schedules(tenant_id,created_by,name,report_type,report_format,cadence,weekday,day_of_month,month_of_year,hour,minute,timezone,recipients,next_run_at,idempotency_key) ' +
    'values($1,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ' +
    'returning id,name,report_type,report_format,cadence,weekday,day_of_month,month_of_year,hour,minute,timezone,recipients,active,next_run_at,created_at',
    [tenant.tenant_id,principal?.sub||null,name,reportType,reportFormat,cadence,weekday,dayOfMonth,monthOfYear,hour,minute,timezone,recipients,nextRun.toISOString(),key]
  );
  return {ok:true,idempotent:false,schedule:r.rows[0]};
}

async function runReport(client, tenant, membership, body, principal) {
  if(!membershipCan(membership,'reports')) throw Object.assign(new Error('PORTAL_REPORT_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_REPORT_ROLE_REQUIRED'});
  const key=idempotencyKey(body);
  const existing=await client.query(
    'select id,report_type,report_format,status,period_start,period_end,generated_at,source_snapshot,report_payload,rendered_csv,content_sha256 from portal_report_runs where tenant_id=$1 and idempotency_key=$2',
    [tenant.tenant_id,key]
  );
  if(existing.rows[0]) return {ok:true,idempotent:true,run:existing.rows[0]};

  const reportType=normalizePortalReportType(body?.reportType);
  const reportFormat=String(body?.format||'json').trim().toLowerCase();
  if(!['json','csv'].includes(reportFormat)) throw Object.assign(new Error('PORTAL_REPORT_FORMAT_INVALID'),{statusCode:400,code:'PORTAL_REPORT_FORMAT_INVALID'});
  const window=validatePortalReportWindow(body?.periodStart,body?.periodEnd||new Date(),new Date());
  const report=await portalReport(client,tenant.tenant_id,reportType,window.from.toISOString(),window.to.toISOString());
  const csv=renderPortalReportCsv(report);
  const contentHash=portalSha256({reportType,periodStart:window.from.toISOString(),periodEnd:window.to.toISOString(),report});
  const r=await client.query(
    'insert into portal_report_runs(tenant_id,requested_by,report_type,report_format,status,period_start,period_end,generated_at,source_snapshot,report_payload,rendered_csv,content_sha256,idempotency_key) ' +
    'values($1,$2::uuid,$3,$4,\'generated\',$5,$6,now(),$7::jsonb,$8::jsonb,$9,$10,$11) ' +
    'returning id,report_type,report_format,status,period_start,period_end,generated_at,source_snapshot,report_payload,rendered_csv,content_sha256',
    [tenant.tenant_id,principal?.sub||null,reportType,reportFormat,window.from.toISOString(),window.to.toISOString(),
      JSON.stringify(report.sourceSnapshot||{}),JSON.stringify(report),reportFormat==='csv'?csv:null,contentHash,key]
  );
  const run=r.rows[0];
  return {
    ok:true,idempotent:false,run,
    ...(reportFormat==='csv'?{csv}:{}),
    authority:'DATABASE_BACKED_CUSTOMER_REPORT',
    syntheticData:false
  };
}

async function handleCustomerPortal(req,res,ctx) {
  const {method,path,principal,db,send,body}=ctx;
  if(!path.startsWith('/v1/customer-portal/')) return null;
  const a=auth(principal);
  if(!a.ok) return send(res,a.status,a.body);

  try {
    assertDb(db);
    return await withPrincipal(db,principal,async client=>{
      const tenant=await tenantContext(client);
      const membership=await portalMembership(client,tenant.tenant_id,principal);

      if(method==='GET'&&path==='/v1/customer-portal/bootstrap'){
        return send(res,200,await handleBootstrap(client,tenant,membership));
      }

      if(method==='GET'&&path==='/v1/customer-portal/overview'){
        if(!membershipCan(membership,'read')) throw Object.assign(new Error('PORTAL_READ_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_READ_ROLE_REQUIRED'});
        const url=new URL(req.url||path,'http://fiberos.local');
        const {start,end}=reportWindowFromQuery(url);
        const report=await portalReport(client,tenant.tenant_id,'executive',start.toISOString(),end.toISOString());
        return send(res,200,{ok:true,report});
      }

      if(method==='GET'&&path==='/v1/customer-portal/plans'){
        const r=await client.query('select p.id,p.code,p.work_type_code,p.billing_interval,p.display_name,p.summary,p.currency,p.amount_minor,p.quote_required,p.seat_limit,p.work_item_limit,p.feature_flags from portal_plan_catalog p where p.published=true and p.active=true order by p.work_type_code,p.billing_interval,p.code');
        return send(res,200,{ok:true,plans:r.rows,billingIntervals:PORTAL_BILLING_INTERVALS});
      }

      if(method==='GET'&&path==='/v1/customer-portal/work-types'){
        const r=await client.query('select code,display_name,discipline,summary,required_evidence,standards,feature_flags from portal_work_type_catalog where active=true order by sort_order,code');
        return send(res,200,{ok:true,workTypes:r.rows});
      }

      if(method==='GET'&&path==='/v1/customer-portal/subscription'){
        const r=await client.query(
          'select s.id,s.status,s.payment_state,s.billing_interval,s.currency,s.amount_minor,s.started_at,s.current_period_start,s.current_period_end,s.auto_renew,s.provider,s.provider_subscription_ref,s.cancellation_at,s.cancellation_reason,s.created_at,s.updated_at,p.code plan_code,p.display_name plan_name,p.work_type_code ' +
          'from portal_subscriptions s join portal_plan_catalog p on p.id=s.plan_id where s.tenant_id=$1 order by s.created_at desc limit 10',[tenant.tenant_id]
        );
        return send(res,200,{ok:true,subscriptions:r.rows});
      }

      if(method==='GET'&&path==='/v1/customer-portal/members'){
        if(!membershipCan(membership,'members')) throw Object.assign(new Error('PORTAL_MEMBERSHIP_ADMIN_REQUIRED'),{statusCode:403,code:'PORTAL_MEMBERSHIP_ADMIN_REQUIRED'});
        const r=await client.query(
          'select id,user_id,portal_role,work_type_scope,active,created_at,updated_at from portal_tenant_memberships where tenant_id=$1 order by active desc,created_at asc limit $2',[tenant.tenant_id,PORTAL_MAX_ROWS]);
        return send(res,200,{ok:true,members:r.rows});
      }

      if(method==='POST'&&path==='/v1/customer-portal/members'){
        if(!membershipCan(membership,'members')) throw Object.assign(new Error('PORTAL_MEMBERSHIP_ADMIN_REQUIRED'),{statusCode:403,code:'PORTAL_MEMBERSHIP_ADMIN_REQUIRED'});
        rejectClientTenant(body);
        const userId=uuid(body?.userId,'PORTAL_USER_ID_INVALID');
        const role=String(body?.portalRole||'').trim();
        if(!['owner','admin','operations','engineering','quality','billing','viewer','contractor_manager','contractor_supervisor','contractor_field'].includes(role))
          throw Object.assign(new Error('PORTAL_ROLE_INVALID'),{statusCode:400,code:'PORTAL_ROLE_INVALID'});
        const types=Array.isArray(body?.workTypeScope)?body.workTypeScope.map(x=>String(x||'').trim()).filter(Boolean).slice(0,20):[];
        if(types.some(x=>!/^[-a-z0-9_]+$/i.test(x))) throw Object.assign(new Error('PORTAL_WORK_TYPE_SCOPE_INVALID'),{statusCode:400,code:'PORTAL_WORK_TYPE_SCOPE_INVALID'});
        const key=idempotencyKey(body);
        const r=await client.query(
          'insert into portal_tenant_memberships(tenant_id,user_id,portal_role,work_type_scope,active,created_by) values($1,$2::uuid,$3,$4,true,$5::uuid) ' +
          'on conflict(tenant_id,user_id) do update set portal_role=excluded.portal_role,work_type_scope=excluded.work_type_scope,active=true,created_by=excluded.created_by ' +
          'returning id,user_id,portal_role,work_type_scope,active,created_at,updated_at',
          [tenant.tenant_id,userId,role,types,principal?.sub||null]
        );
        return send(res,201,{ok:true,idempotencyKey:key,member:r.rows[0]});
      }

      if(method==='POST'&&path==='/v1/customer-portal/subscriptions'){
        return send(res,201,await subscribe(client,tenant,membership,body,principal));
      }

      const subCancel=path.match(/^\/v1\/customer-portal\/subscriptions\/([0-9a-f-]+)\/cancel$/i);
      if(method==='POST'&&subCancel) return send(res,200,await mutateSubscription(client,tenant,membership,body,principal,'cancel',subCancel[1]));
      const subRenew=path.match(/^\/v1\/customer-portal\/subscriptions\/([0-9a-f-]+)\/auto-renew$/i);
      if(method==='POST'&&subRenew) return send(res,200,await mutateSubscription(client,tenant,membership,body,principal,'auto-renew',subRenew[1]));
      const subPause=path.match(/^\/v1\/customer-portal\/subscriptions\/([0-9a-f-]+)\/pause$/i);
      if(method==='POST'&&subPause) return send(res,200,await mutateSubscription(client,tenant,membership,body,principal,'pause',subPause[1]));
      const subResume=path.match(/^\/v1\/customer-portal\/subscriptions\/([0-9a-f-]+)\/resume$/i);
      if(method==='POST'&&subResume) return send(res,200,await mutateSubscription(client,tenant,membership,body,principal,'resume',subResume[1]));

      if(method==='GET'&&path==='/v1/customer-portal/report-schedules'){
        if(!membershipCan(membership,'schedule')) throw Object.assign(new Error('PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'});
        const r=await client.query(
          'select id,name,report_type,report_format,cadence,weekday,day_of_month,month_of_year,hour,minute,timezone,recipients,active,next_run_at,last_run_at,last_error,consecutive_failures,created_at,updated_at from portal_report_schedules where tenant_id=$1 order by active desc,next_run_at asc limit $2',
          [tenant.tenant_id,PORTAL_MAX_ROWS]
        );
        return send(res,200,{ok:true,schedules:r.rows});
      }

      if(method==='POST'&&path==='/v1/customer-portal/report-schedules'){
        return send(res,201,await scheduleReport(client,tenant,membership,body,principal));
      }

      const schedulePause=path.match(/^\/v1\/customer-portal\/report-schedules\/([0-9a-f-]+)\/pause$/i);
      if(method==='POST'&&schedulePause){
        if(!membershipCan(membership,'schedule')) throw Object.assign(new Error('PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'});
        const key=idempotencyKey(body); const id=uuid(schedulePause[1],'PORTAL_SCHEDULE_ID_INVALID');
        const r=await client.query('update portal_report_schedules set active=false,last_error=null,consecutive_failures=0 where id=$1 and tenant_id=$2 returning id,active,next_run_at',[id,tenant.tenant_id]);
        if(!r.rows[0]) throw Object.assign(new Error('PORTAL_SCHEDULE_NOT_FOUND'),{statusCode:404,code:'PORTAL_SCHEDULE_NOT_FOUND'});
        return send(res,200,{ok:true,idempotencyKey:key,schedule:r.rows[0]});
      }
      const scheduleResume=path.match(/^\/v1\/customer-portal\/report-schedules\/([0-9a-f-]+)\/resume$/i);
      if(method==='POST'&&scheduleResume){
        if(!membershipCan(membership,'schedule')) throw Object.assign(new Error('PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_REPORT_SCHEDULE_ROLE_REQUIRED'});
        const key=idempotencyKey(body); const id=uuid(scheduleResume[1],'PORTAL_SCHEDULE_ID_INVALID');
        const existing=await client.query('select id,cadence,weekday,day_of_month,month_of_year,hour,minute,timezone,recipients,active from portal_report_schedules where id=$1 and tenant_id=$2',[id,tenant.tenant_id]);
        if(!existing.rows[0]) throw Object.assign(new Error('PORTAL_SCHEDULE_NOT_FOUND'),{statusCode:404,code:'PORTAL_SCHEDULE_NOT_FOUND'});
        const s=existing.rows[0];
        const next=nextPortalRunAt({
          cadence:s.cadence,
          weekday:s.weekday,
          dayOfMonth:s.day_of_month,
          monthOfYear:s.month_of_year,
          hour:s.hour,
          minute:s.minute,
          timezone:s.timezone
        },new Date());
        const r=await client.query('update portal_report_schedules set active=true,next_run_at=$1,last_error=null,consecutive_failures=0 where id=$2 and tenant_id=$3 returning id,active,next_run_at',[next.toISOString(),id,tenant.tenant_id]);
        return send(res,200,{ok:true,idempotencyKey:key,schedule:r.rows[0]});
      }

      if(method==='POST'&&path==='/v1/customer-portal/reports/run'){
        return send(res,201,await runReport(client,tenant,membership,body,principal));
      }

      if(method==='GET'&&path==='/v1/customer-portal/reports'){
        if(!membershipCan(membership,'reports')) throw Object.assign(new Error('PORTAL_REPORT_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_REPORT_ROLE_REQUIRED'});
        const r=await client.query(
          'select id,report_type,report_format,status,period_start,period_end,generated_at,content_sha256,outbox_event_id,error_code,created_at from portal_report_runs where tenant_id=$1 order by created_at desc limit $2',
          [tenant.tenant_id,PORTAL_MAX_ROWS]
        );
        return send(res,200,{ok:true,reports:r.rows});
      }

      const reportGet=path.match(/^\/v1\/customer-portal\/reports\/([0-9a-f-]+)$/i);
      if(method==='GET'&&reportGet){
        if(!membershipCan(membership,'reports')) throw Object.assign(new Error('PORTAL_REPORT_ROLE_REQUIRED'),{statusCode:403,code:'PORTAL_REPORT_ROLE_REQUIRED'});
        const id=uuid(reportGet[1],'PORTAL_REPORT_ID_INVALID');
        const r=await client.query(
          'select id,report_type,report_format,status,period_start,period_end,generated_at,source_snapshot,report_payload,rendered_csv,content_sha256,outbox_event_id,error_code,created_at from portal_report_runs where tenant_id=$1 and id=$2',
          [tenant.tenant_id,id]
        );
        if(!r.rows[0]) throw Object.assign(new Error('PORTAL_REPORT_NOT_FOUND'),{statusCode:404,code:'PORTAL_REPORT_NOT_FOUND'});
        return send(res,200,{ok:true,report:r.rows[0]});
      }


      // --- Entitlement & usage snapshot (server ledger only) ---
      if (method === 'GET' && path === '/v1/customer-portal/entitlements') {
        if (!membershipCan(membership, 'entitlements')) {
          throw Object.assign(new Error('PORTAL_ENTITLEMENT_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_ENTITLEMENT_ROLE_REQUIRED' });
        }
        const sub = await client.query(
          `select s.id, s.status, s.billing_interval, s.plan_id, s.current_period_start, s.current_period_end
           from portal_subscriptions s
           where s.tenant_id=$1 and s.status='active'
           order by s.created_at desc limit 1`,
          [tenant.tenant_id]
        );
        if (!sub.rows[0]) {
          return send(res, 200, {
            ok: true,
            available: false,
            reason: 'NO_ACTIVE_SUBSCRIPTION',
            authority: 'PORTAL_SUBSCRIPTIONS'
          });
        }
        const planId = sub.rows[0].plan_id;
        const interval = sub.rows[0].billing_interval || 'monthly';
        const periodKey = periodKeyFor(interval, new Date());
        const ents = await client.query(
          `select metric_code, limit_value, soft_warn_ratio, hard_enforce
           from portal_plan_entitlements where plan_id=$1`,
          [planId]
        );
        const usage = await client.query(
          `select metric_code, coalesce(sum(delta),0)::bigint as used
           from portal_usage_ledger
           where tenant_id=$1 and period_key=$2
           group by metric_code`,
          [tenant.tenant_id, periodKey]
        );
        const usageByMetric = {};
        for (const row of usage.rows) usageByMetric[row.metric_code] = Number(row.used);
        const snapshot = evaluatePlanEntitlements({
          entitlements: ents.rows.map((r) => ({
            metricCode: r.metric_code,
            limitValue: r.limit_value,
            softWarnRatio: r.soft_warn_ratio,
            hardEnforce: r.hard_enforce
          })),
          usageByMetric
        });
        return send(res, 200, {
          ok: true,
          available: true,
          periodKey,
          subscriptionId: sub.rows[0].id,
          planId,
          snapshot,
          authority: 'SERVER_USAGE_LEDGER_AND_PLAN_ENTITLEMENTS'
        });
      }

      if (method === 'POST' && path === '/v1/customer-portal/usage/authorize') {
        if (!membershipCan(membership, 'entitlements')) {
          throw Object.assign(new Error('PORTAL_ENTITLEMENT_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_ENTITLEMENT_ROLE_REQUIRED' });
        }
        rejectClientTenant(body);
        const metricCode = String(body?.metricCode || '');
        const proposedDelta = Number(body?.proposedDelta);
        const sub = await client.query(
          `select s.plan_id, s.billing_interval from portal_subscriptions s
           where s.tenant_id=$1 and s.status='active' order by s.created_at desc limit 1`,
          [tenant.tenant_id]
        );
        if (!sub.rows[0]) {
          return send(res, 403, { ok: false, error: 'NO_ACTIVE_SUBSCRIPTION', authority: 'PORTAL_SUBSCRIPTIONS' });
        }
        const periodKey = periodKeyFor(sub.rows[0].billing_interval || 'monthly', new Date());
        const ents = await client.query(
          `select metric_code, limit_value, soft_warn_ratio, hard_enforce
           from portal_plan_entitlements where plan_id=$1`,
          [sub.rows[0].plan_id]
        );
        const usage = await client.query(
          `select metric_code, coalesce(sum(delta),0)::bigint as used
           from portal_usage_ledger where tenant_id=$1 and period_key=$2 group by metric_code`,
          [tenant.tenant_id, periodKey]
        );
        const usageByMetric = {};
        for (const row of usage.rows) usageByMetric[row.metric_code] = Number(row.used);
        const decision = authorizeUsage({
          entitlements: ents.rows.map((r) => ({
            metricCode: r.metric_code,
            limitValue: r.limit_value,
            softWarnRatio: r.soft_warn_ratio,
            hardEnforce: r.hard_enforce
          })),
          usageByMetric,
          metricCode,
          proposedDelta
        });
        return send(res, decision.allowed ? 200 : 403, { ok: decision.allowed, decision, periodKey });
      }

      // --- Service orders ---
      if (method === 'GET' && path === '/v1/customer-portal/orders') {
        if (!membershipCan(membership, 'orders')) {
          throw Object.assign(new Error('PORTAL_ORDER_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_ORDER_ROLE_REQUIRED' });
        }
        const r = await client.query(
          `select id, order_type, status, priority, service_id, customer_ref, title, work_type_code,
                  requested_at, submitted_at, accepted_at, closed_at, linked_ticket_id
           from portal_service_orders where tenant_id=$1
           order by requested_at desc limit $2`,
          [tenant.tenant_id, PORTAL_MAX_ROWS]
        );
        return send(res, 200, { ok: true, orders: r.rows });
      }

      if (method === 'POST' && path === '/v1/customer-portal/orders') {
        if (!membershipCan(membership, 'orders')) {
          throw Object.assign(new Error('PORTAL_ORDER_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_ORDER_ROLE_REQUIRED' });
        }
        const key = idempotencyKey(body);
        const existing = await client.query(
          'select id, order_type, status, title, requested_at from portal_service_orders where tenant_id=$1 and idempotency_key=$2',
          [tenant.tenant_id, key]
        );
        if (existing.rows[0]) return send(res, 200, { ok: true, idempotencyKey: key, order: existing.rows[0], replayed: true });
        const orderType = normalizeOrderType(body?.orderType);
        const title = String(body?.title || '').trim();
        if (title.length < 3 || title.length > 200) {
          throw Object.assign(new Error('PORTAL_ORDER_TITLE_INVALID'), { statusCode: 400, code: 'PORTAL_ORDER_TITLE_INVALID' });
        }
        const priority = String(body?.priority || 'normal').toLowerCase();
        const r = await client.query(
          `insert into portal_service_orders(
             tenant_id, order_type, status, priority, service_id, customer_ref, title, description,
             work_type_code, requested_by, idempotency_key, details
           ) values ($1,$2,'draft',$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
           returning id, order_type, status, priority, title, requested_at, idempotency_key`,
          [
            tenant.tenant_id,
            orderType,
            ['low','normal','high','critical','emergency'].includes(priority) ? priority : 'normal',
            body?.serviceId ? uuid(body.serviceId, 'PORTAL_SERVICE_ID_INVALID') : null,
            body?.customerRef ? String(body.customerRef).slice(0, 120) : null,
            title,
            body?.description != null ? String(body.description).slice(0, 4000) : null,
            body?.workTypeCode ? String(body.workTypeCode).slice(0, 64) : null,
            principal.sub || null,
            key,
            JSON.stringify(body?.details && typeof body.details === 'object' ? body.details : {})
          ]
        );
        await client.query(
          `insert into portal_service_order_events(
             tenant_id, order_id, event_type, from_status, to_status, actor_id, event_idempotency_key, details
           ) values ($1,$2,'created',null,'draft',$3,$4,$5::jsonb)`,
          [tenant.tenant_id, r.rows[0].id, principal.sub || null, key + ':created', JSON.stringify({ orderType })]
        );
        const emitted = await emitPortalOrderEvent(client, {
          tenantId: tenant.tenant_id, principal,
          operation: 'customer.order.create',
          eventType: 'customer.order.created',
          orderId: r.rows[0].id,
          idempotencyKey: key,
          fromStatus: null,
          toStatus: 'draft',
          payload: {
            orderId: r.rows[0].id,
            orderType,
            priority: r.rows[0].priority,
            serviceId: body?.serviceId ? uuid(body.serviceId, 'PORTAL_SERVICE_ID_INVALID') : null,
            workTypeCode: body?.workTypeCode ? String(body.workTypeCode).slice(0, 64) : null
          }
        });
        return send(res, 201, { ok: true, idempotencyKey: key, order: r.rows[0], event: {
          outboxEventId: emitted.outbox.event_id,
          canonicalEventVersion: emitted.envelope.schema,
          integritySha256: emitted.envelope.integritySha256,
          publishStatus: emitted.outbox.publish_status
        }});
      }

      const orderTransition = path.match(/^\/v1\/customer-portal\/orders\/([0-9a-f-]+)\/transition$/i);
      if (method === 'POST' && orderTransition) {
        if (!membershipCan(membership, 'orders')) {
          throw Object.assign(new Error('PORTAL_ORDER_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_ORDER_ROLE_REQUIRED' });
        }
        const orderId = uuid(orderTransition[1], 'PORTAL_ORDER_ID_INVALID');
        const key = idempotencyKey(body);
        const toStatus = normalizeOrderStatus(body?.toStatus);
        const cur = await client.query(
          'select id, status from portal_service_orders where tenant_id=$1 and id=$2',
          [tenant.tenant_id, orderId]
        );
        if (!cur.rows[0]) throw Object.assign(new Error('PORTAL_ORDER_NOT_FOUND'), { statusCode: 404, code: 'PORTAL_ORDER_NOT_FOUND' });
        assertOrderTransition(cur.rows[0].status, toStatus);
        const eventExisting = await client.query(
          'select id from portal_service_order_events where tenant_id=$1 and event_idempotency_key=$2',
          [tenant.tenant_id, key]
        );
        if (eventExisting.rows[0]) {
          const refreshed = await client.query(
            'select id, order_type, status, title, requested_at from portal_service_orders where id=$1',
            [orderId]
          );
          return send(res, 200, { ok: true, idempotencyKey: key, order: refreshed.rows[0], replayed: true });
        }
        const stampCol =
          toStatus === 'submitted' ? ', submitted_at=now()' :
          toStatus === 'accepted' ? ', accepted_at=now()' :
          (toStatus === 'accepted_closed' || toStatus === 'rejected' || toStatus === 'cancelled') ? ', closed_at=now()' : '';
        const updated = await client.query(
          `update portal_service_orders set status=$1, updated_at=now()${stampCol}
           where tenant_id=$2 and id=$3
           returning id, order_type, status, priority, service_id, customer_ref, title, work_type_code,
                     requested_at, submitted_at, accepted_at, closed_at, linked_ticket_id`,
          [toStatus, tenant.tenant_id, orderId]
        );
        await client.query(
          `insert into portal_service_order_events(
             tenant_id, order_id, event_type, from_status, to_status, actor_id, event_idempotency_key, details
           ) values ($1,$2,'transition',$3,$4,$5,$6,$7::jsonb)`,
          [tenant.tenant_id, orderId, cur.rows[0].status, toStatus, principal.sub || null, key, JSON.stringify({})]
        );
        const emitted = await emitPortalOrderEvent(client, {
          tenantId: tenant.tenant_id, principal,
          operation: 'customer.order.transition',
          eventType: 'customer.order.status_changed',
          orderId,
          idempotencyKey: key,
          fromStatus: cur.rows[0].status,
          toStatus,
          payload: {
            orderId,
            fromStatus: cur.rows[0].status,
            toStatus,
            orderType: updated.rows[0].order_type,
            priority: updated.rows[0].priority || null,
            linkedTicketId: updated.rows[0].linked_ticket_id || null
          }
        });
        return send(res, 200, { ok: true, idempotencyKey: key, order: updated.rows[0], event: {
          outboxEventId: emitted.outbox.event_id,
          canonicalEventVersion: emitted.envelope.schema,
          integritySha256: emitted.envelope.integritySha256,
          publishStatus: emitted.outbox.publish_status
        }});
      }

      // --- SLA clock record + threshold enforcement ---
      if (method === 'POST' && path === '/v1/customer-portal/sla/clocks') {
        if (!membershipCan(membership, 'sla')) {
          throw Object.assign(new Error('PORTAL_SLA_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_SLA_ROLE_REQUIRED' });
        }
        rejectClientTenant(body);
        const key = idempotencyKey(body);
        const contractId = uuid(body?.contractId, 'PORTAL_SLA_CONTRACT_ID_INVALID');
        const subjectType = String(body?.subjectType || '').trim().toLowerCase();
        const subjectId = uuid(body?.subjectId, 'PORTAL_SLA_SUBJECT_ID_INVALID');
        const clockKind = String(body?.clockKind || '').trim().toLowerCase();
        const evidenceClass = String(body?.evidenceClass || '').trim().toLowerCase();
        const sourceRef = String(body?.sourceRef || '').trim().slice(0, 400);
        const allowedClockKinds = ['detected','responded','restored','resolved'];
        const allowedEvidence = ['observed','measured','derived','declared','unverified'];
        if (!allowedClockKinds.includes(clockKind)) {
          throw Object.assign(new Error('PORTAL_SLA_CLOCK_KIND_INVALID'), { statusCode: 400, code: 'PORTAL_SLA_CLOCK_KIND_INVALID' });
        }
        if (!allowedEvidence.includes(evidenceClass)) {
          throw Object.assign(new Error('PORTAL_SLA_EVIDENCE_CLASS_INVALID'), { statusCode: 400, code: 'PORTAL_SLA_EVIDENCE_CLASS_INVALID' });
        }
        if (!sourceRef) {
          throw Object.assign(new Error('PORTAL_SLA_SOURCE_REF_REQUIRED'), { statusCode: 400, code: 'PORTAL_SLA_SOURCE_REF_REQUIRED' });
        }
        const occurredAt = body?.occurredAt ? new Date(body.occurredAt) : new Date();
        const now = new Date();
        if (Number.isNaN(occurredAt.getTime())) {
          throw Object.assign(new Error('PORTAL_SLA_OCCURRED_AT_INVALID'), { statusCode: 400, code: 'PORTAL_SLA_OCCURRED_AT_INVALID' });
        }
        if (occurredAt.getTime() > now.getTime() + 60000) {
          throw Object.assign(new Error('PORTAL_SLA_FUTURE_CLOCK_REJECTED'), { statusCode: 400, code: 'PORTAL_SLA_FUTURE_CLOCK_REJECTED' });
        }
        const requestHash = portalSha256({
          contractId, subjectType, subjectId, clockKind, evidenceClass, sourceRef,
          occurredAt: occurredAt.toISOString()
        });

        const contract = await client.query(
          `select id,response_minutes,restore_minutes,resolution_minutes,measurement_source
           from portal_sla_contracts where tenant_id=$1 and id=$2 and active=true`,
          [tenant.tenant_id, contractId]
        );
        if (!contract.rows[0]) {
          throw Object.assign(new Error('PORTAL_SLA_CONTRACT_NOT_FOUND'), { statusCode: 404, code: 'PORTAL_SLA_CONTRACT_NOT_FOUND' });
        }
        await assertSlaSubject(client, tenant.tenant_id, subjectType, subjectId);

        const existing = await client.query(
          'select id,contract_id,subject_type,subject_id,clock_kind,occurred_at,evidence_class,source_ref,actor_id,details,idempotency_key from portal_sla_clock_events where tenant_id=$1 and idempotency_key=$2',
          [tenant.tenant_id, key]
        );
        if (existing.rows[0]) {
          if (String(existing.rows[0].details?.requestHash || '') !== requestHash) {
            throw Object.assign(new Error('PORTAL_SLA_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_CLOCK'), { statusCode: 409, code: 'PORTAL_SLA_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_CLOCK' });
          }
          return send(res, 200, { ok: true, clock: existing.rows[0], replayed: true, enforcement: [] });
        }

        const clock = await client.query(
          `insert into portal_sla_clock_events(
             tenant_id,contract_id,subject_type,subject_id,clock_kind,occurred_at,
             evidence_class,source_ref,actor_id,details,idempotency_key
           ) values($1,$2,$3,$4,$5,$6,$7,$8,auth.uid(),$9::jsonb,$10)
           on conflict(tenant_id,idempotency_key) do nothing
           returning id,contract_id,subject_type,subject_id,clock_kind,occurred_at,evidence_class,source_ref,actor_id,details,idempotency_key`,
          [
            tenant.tenant_id, contractId, subjectType, subjectId, clockKind,
            occurredAt.toISOString(), evidenceClass, sourceRef,
            JSON.stringify({ requestHash, sourceRef, evidenceClass })
            , key
          ]
        );
        if (!clock.rows[0]) {
          const replay = await client.query(
            'select id,contract_id,subject_type,subject_id,clock_kind,occurred_at,evidence_class,source_ref,actor_id,details,idempotency_key from portal_sla_clock_events where tenant_id=$1 and idempotency_key=$2',
            [tenant.tenant_id, key]
          );
          if (!replay.rows[0]) throw Object.assign(new Error('PORTAL_SLA_CLOCK_IDEMPOTENCY_RACE'), { statusCode: 409, code: 'PORTAL_SLA_CLOCK_IDEMPOTENCY_RACE' });
          if (String(replay.rows[0].details?.requestHash || '') !== requestHash) {
            throw Object.assign(new Error('PORTAL_SLA_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_CLOCK'), { statusCode: 409, code: 'PORTAL_SLA_IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_CLOCK' });
          }
          return send(res, 200, { ok: true, clock: replay.rows[0], replayed: true, enforcement: [] });
        }

        const clockRows = await client.query(
          `select id,clock_kind,occurred_at,evidence_class
           from portal_sla_clock_events
           where tenant_id=$1 and contract_id=$2 and subject_type=$3 and subject_id=$4
           order by occurred_at asc,id asc`,
          [tenant.tenant_id, contractId, subjectType, subjectId]
        );
        const sourceIdsByKind = {};
        for (const row of clockRows.rows) {
          if (!sourceIdsByKind[row.clock_kind]) sourceIdsByKind[row.clock_kind] = row.id;
        }
        const evaluation = evaluateSlaClocks({
          contract: contract.rows[0],
          events: clockRows.rows.map((e) => ({
            clockKind: e.clock_kind,
            occurredAt: e.occurred_at,
            evidenceClass: e.evidence_class
          }))
        });
        const negative = ['response','restore','resolution'].some((kind) => {
          const w = evaluation[kind];
          return w && w.elapsedMinutes != null && Number(w.elapsedMinutes) < 0;
        });
        if (negative) {
          throw Object.assign(new Error('PORTAL_SLA_CLOCK_SEQUENCE_INVALID'), { statusCode: 409, code: 'PORTAL_SLA_CLOCK_SEQUENCE_INVALID' });
        }

        const correlationId = 'sla:' + contractId + ':' + subjectType + ':' + subjectId;
        const emittedClock = await appendOperationalEvent(client, {
          tenantId: tenant.tenant_id,
          correlationId,
          causationId: body?.causationId || null,
          actorId: principal?.sub || null,
          role: principal?.role || null,
          operation: 'sla.clock.record',
          networkFamily: 'unknown',
          subjectRef: { type: subjectType, id: subjectId },
          entityRefs: [
            { type: subjectType, id: subjectId },
            { type: 'sla_contract', id: String(contractId) },
            { type: 'sla_clock', id: String(clock.rows[0].id) }
          ],
          truthBoundary: 'SLA_CLOCK_PERSISTED_AS_EXPLICIT_DATABASE_EVENT; THRESHOLDS ARE DERIVED FROM RECORDED CLOCKS ONLY',
          securityClassification: 'restricted',
          provenance: {
            origin: 'services/api/src/routes/customerPortal.js',
            eventSource: 'portal_sla_clock_events',
            eventId: String(clock.rows[0].id),
            requestHash,
            evidenceClass,
            sourceRef
          },
          eventType: 'sla.clock.recorded',
          aggregateType: subjectType,
          aggregateId: subjectId,
          idempotencyKey: 'sla-clock:' + key,
          occurredAt: clock.rows[0].occurred_at,
          runtimeVerificationStatus: 'UNVERIFIED',
          payload: {
            clockEventId: clock.rows[0].id,
            contractId,
            subjectType,
            subjectId,
            clockKind,
            occurredAt: clock.rows[0].occurred_at,
            evidenceClass,
            sourceRef
          }
        });
        const enforcement = await persistSlaThresholdEvents(client, {
          tenantId: tenant.tenant_id,
          principal,
          contractId,
          subjectType,
          subjectId,
          evaluation,
          sourceIdsByKind,
          correlationId
        });

        return send(res, 201, {
          ok: true,
          clock: clock.rows[0],
          evaluation,
          enforcement,
          event: {
            outboxEventId: emittedClock.outbox.event_id,
            canonicalEventVersion: emittedClock.envelope.schema,
            correlationId: emittedClock.envelope.correlationId,
            integritySha256: emittedClock.envelope.integritySha256,
            publishStatus: emittedClock.outbox.publish_status
          },
          authority: 'DATABASE_CLOCK_EVENT_AND_DERIVED_THRESHOLD',
          truthBoundary: 'NO_INVENTED_ETA; NO_AUTOMATIC_ESCALATION_AUTHORITY'
        });
      }

      // --- SLA evaluate (documented clocks only) ---
      if (method === 'POST' && path === '/v1/customer-portal/sla/evaluate') {
        if (!membershipCan(membership, 'sla')) {
          throw Object.assign(new Error('PORTAL_SLA_ROLE_REQUIRED'), { statusCode: 403, code: 'PORTAL_SLA_ROLE_REQUIRED' });
        }
        rejectClientTenant(body);
        const contractId = uuid(body?.contractId, 'PORTAL_SLA_CONTRACT_ID_INVALID');
        const subjectType = String(body?.subjectType || '').toLowerCase();
        const subjectId = uuid(body?.subjectId, 'PORTAL_SLA_SUBJECT_ID_INVALID');
        if (!['ticket', 'service_order', 'incident', 'service'].includes(subjectType)) {
          throw Object.assign(new Error('PORTAL_SLA_SUBJECT_TYPE_INVALID'), { statusCode: 400, code: 'PORTAL_SLA_SUBJECT_TYPE_INVALID' });
        }
        const contract = await client.query(
          `select id, response_minutes, restore_minutes, resolution_minutes, measurement_source
           from portal_sla_contracts where tenant_id=$1 and id=$2 and active=true`,
          [tenant.tenant_id, contractId]
        );
        if (!contract.rows[0]) {
          throw Object.assign(new Error('PORTAL_SLA_CONTRACT_NOT_FOUND'), { statusCode: 404, code: 'PORTAL_SLA_CONTRACT_NOT_FOUND' });
        }
        const events = await client.query(
          `select clock_kind, occurred_at, evidence_class
           from portal_sla_clock_events
           where tenant_id=$1 and contract_id=$2 and subject_type=$3 and subject_id=$4
           order by occurred_at asc`,
          [tenant.tenant_id, contractId, subjectType, subjectId]
        );
        const evaluation = evaluateSlaClocks({
          contract: contract.rows[0],
          events: events.rows.map((e) => ({
            clockKind: e.clock_kind,
            occurredAt: e.occurred_at,
            evidenceClass: e.evidence_class
          }))
        });
        return send(res, 200, {
          ok: true,
          contractId,
          subjectType,
          subjectId,
          evaluation,
          authority: 'DATABASE_EVENT_TIMESTAMPS_ONLY'
        });
      }


      return null;
    });
  } catch(e) {
    return send(res,e.statusCode||500,{ok:false,error:e.code||e.message||'CUSTOMER_PORTAL_ERROR',authority:'CUSTOMER_PORTAL_API'});
  }
}

module.exports=Object.freeze({handleCustomerPortal});
