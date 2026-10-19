'use strict';

const { withPrincipal } = require('../../../../packages/db/src/session');
const { applySecurityHeaders } = require('../../../../packages/security/src/httpHardening');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { DEPARTMENTS: KPI_DEPARTMENTS, DEPARTMENT_KPI_MAP } = require('../../../../packages/operations-kpi/src');
const { permissionsForRole } = require('../../../../packages/security/src/authorization');

const ENTERPRISE_DEPARTMENT_TYPES = Object.freeze([
  'corporate','sector','regional','central','team','network','field','warehouse',
  'data_noc','planning','engineering','quality','hse','procurement','finance',
  'hr','customer','security','other'
]);

const ORGANIZATION_DEPARTMENT_PROFILES = Object.freeze({
  NETWORK_OPERATIONS: Object.freeze({ roles: ['dispatcher','qc','ops_manager','area_supervisor','exec','sysadmin'], workflowSurfaces: ['/v1/workflows/overview'], slaSurfaces: ['/v1/operations/sla-command'], queueSurfaces: ['/v1/operations/workload-balance'] }),
  CONSTRUCTION: Object.freeze({ roles: ['field_tech','technician','team_lead','qc','ops_manager','area_supervisor','sysadmin'], workflowSurfaces: ['/v1/workflows/overview','/v1/installations/{id}'], slaSurfaces: ['/v1/operations/sla-command'], queueSurfaces: ['/v1/operations/workload-balance'] }),
  FIELD: Object.freeze({ roles: ['technician','field_tech','team_lead','qc','dispatcher','ops_manager','area_supervisor','sysadmin'], workflowSurfaces: ['/v1/workflows/overview','/v1/installations/{id}','/v1/faults/{id}'], slaSurfaces: ['/v1/operations/sla-command'], queueSurfaces: ['/v1/operations/workload-balance'] }),
  CALL_CENTER: Object.freeze({ roles: ['call_center','ops_manager','area_supervisor','exec','sysadmin'], workflowSurfaces: ['/v1/workflows/overview'], slaSurfaces: ['/v1/operations/sla-command'], queueSurfaces: ['/v1/call-center/queue/status','/v1/contact-center/agents/presence'] }),
  WAREHOUSE: Object.freeze({ roles: ['warehouse','dispatcher','ops_manager','area_supervisor','exec','sysadmin'], workflowSurfaces: ['/v1/workflows/overview'], slaSurfaces: ['/v1/operations/sla-command'], queueSurfaces: ['/v1/smart-inventory/overview'] }),
  ENGINEERING: Object.freeze({ roles: ['qc','ops_manager','area_supervisor','exec','sysadmin'], workflowSurfaces: ['/v1/workflows/overview'], slaSurfaces: ['/v1/operations/sla-command'], queueSurfaces: [] })
});
const ORGANIZATION_COMMON_SURFACES = Object.freeze({
  evidence: ['/v1/evidence/submit','/v1/operations/evidence-chain/{ticketId}'],
  events: ['/v1/operations/timeline'],
  audit: ['/v1/audit/events'],
  escalation: ['/v1/crisis/command-state'],
  executiveRollup: ['/v1/executive/radar','/v1/company/operating-system'],
  dashboard: ['/v1/command/rooms/overview']
});
const ORGANIZATION_COVERAGE_FIELDS = Object.freeze([
  'departmentIdentity','authorityPositions','scopeAuthority','workflow','sla','kpi','dashboard','queue',
  'evidence','events','audit','escalation','executiveRollup'
]);

const ROLES = Object.freeze({
  management: ['ops_manager', 'area_supervisor', 'exec', 'sysadmin', 'dispatcher'],
  organization: ['ops_manager', 'area_supervisor', 'exec', 'sysadmin'],
  audit: ['qc', 'ops_manager', 'area_supervisor', 'exec', 'sysadmin'],
  communications: ['call_center', 'ops_manager', 'area_supervisor', 'exec', 'sysadmin'],
  contractor: ['procurement', 'ops_manager', 'area_supervisor', 'exec', 'sysadmin'],
  inventory: ['warehouse', 'dispatcher', 'ops_manager', 'area_supervisor', 'exec', 'sysadmin'],
  rbac: ['ops_manager', 'area_supervisor', 'exec', 'sysadmin'],
  dna: ['technician', 'field_tech', 'team_lead', 'qc', 'ops_manager', 'area_supervisor', 'dispatcher', 'exec', 'sysadmin']
});

function auth(principal, roles) {
  const verified = requireVerifiedPrincipal(principal, process.env);
  return verified.ok ? requireAnyRole(principal, roles) : verified;
}

function dbRequired(db) {
  if (!db || !db.configured) {
    throw Object.assign(new Error('DATABASE_REQUIRED'), { statusCode: 503 });
  }
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

function limit(req, fallback, max) {
  const n = Number(new URL(req.url || '/', 'http://fiberos.local').searchParams.get('limit'));
  return Number.isInteger(n) ? Math.min(Math.max(n, 1), max) : fallback;
}

async function tenant(client) {
  const result = await client.query(
    'select tenant_id from user_preferences where user_id=auth.uid() limit 1'
  );
  if (!result.rows[0]) {
    throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'), { statusCode: 403 });
  }
  return result.rows[0].tenant_id;
}

function resultError(out) {
  return out && out.errorStatus ? out : null;
}

function buildAuthorityPath(position, positionById, options = {}) {
  const includeUserId = options.includeUserId !== false;
  const path=[]; const seen=new Set(); let current=position;
  while(current){
    const id=String(current.id);
    if(seen.has(id)){path.unshift('[CYCLE_DETECTED]');break;}
    seen.add(id);
    const entry={
      id:current.id,
      title:current.title,
      authorityLevel:Number(current.authority_level),
      departmentId:current.department_id
    };
    if(includeUserId) entry.userId=current.user_id;
    else entry.identityRedacted=true;
    path.unshift(entry);
    current=current.manager_position_id?positionById.get(String(current.manager_position_id)):null;
    if(path.length>64){path.unshift('[DEPTH_BOUND_EXCEEDED]');break;}
  }
  return path;
}

async function organizationOperatingModel(db, principal) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const tenantId = await tenant(client);
    const [departments, positions, scopes, positionRows] = await Promise.all([
      client.query('select id,code,name,department_type,parent_id,active from enterprise_departments where tenant_id=$1 order by code,id',[tenantId]),
      client.query("select department_id,count(*)::int total_positions,count(*) filter(where active=true and valid_from<=now() and (valid_to is null or valid_to>now()))::int active_positions from enterprise_positions where tenant_id=$1 group by department_id",[tenantId]),
      client.query("select ep.department_id,count(*)::int active_scope_grants from enterprise_scope_grants sg join enterprise_positions ep on ep.id=sg.position_id and ep.tenant_id=sg.tenant_id where sg.tenant_id=$1 and ep.active=true and ep.valid_from<=now() and (ep.valid_to is null or ep.valid_to>now()) and sg.valid_from<=now() and (sg.valid_to is null or sg.valid_to>now()) group by ep.department_id",[tenantId]),
      client.query("select ep.id,ep.department_id,ep.user_id,ep.title,ep.authority_level,ep.manager_position_id,ep.active,ep.valid_from,ep.valid_to from enterprise_positions ep where ep.tenant_id=$1 order by ep.authority_level desc,ep.id",[tenantId])
    ]);
    const posMap=new Map(positions.rows.map(r=>[String(r.department_id),r]));
    const scopeMap=new Map(scopes.rows.map(r=>[String(r.department_id),r]));
    const positionById=new Map(positionRows.rows.map(r=>[String(r.id),r]));
    const byId=new Map(departments.rows.map(r=>[String(r.id),r]));
    function hierarchyPath(row) {
      const parts=[]; const seen=new Set(); let cur=row;
      while(cur){
        const id=String(cur.id);
        if(seen.has(id)){parts.unshift('[CYCLE_DETECTED]');break;}
        seen.add(id); parts.unshift(String(cur.code));
        cur=cur.parent_id?byId.get(String(cur.parent_id)):null;
        if(parts.length>64){parts.unshift('[DEPTH_BOUND_EXCEEDED]');break;}
      }
      return parts;
    }
    const exposePositionIdentity = ['exec','sysadmin'].includes(String(principal && principal.role || '').trim());
    const organization=departments.rows.map(row=>{
      const code=String(row.code||'').trim().toUpperCase();
      const profile=ORGANIZATION_DEPARTMENT_PROFILES[code]||null;
      const departmentTypeKnown=ENTERPRISE_DEPARTMENT_TYPES.includes(String(row.department_type||'').trim().toLowerCase());
      const p=posMap.get(String(row.id))||{total_positions:0,active_positions:0};
      const sc=scopeMap.get(String(row.id))||{active_scope_grants:0};
      const coverage={
        departmentIdentity:Boolean(row.active),
        authorityPositions:Number(p.active_positions)>0,
        scopeAuthority:Number(sc.active_scope_grants)>0,
        workflow:Boolean(profile?.workflowSurfaces?.length),
        sla:Boolean(profile?.slaSurfaces?.length),
        kpi:Boolean(profile&&DEPARTMENT_KPI_MAP[code]?.length),
        dashboard:Boolean(profile && ORGANIZATION_COMMON_SURFACES.dashboard.length),
        queue:Boolean(profile?.queueSurfaces?.length),
        evidence:Boolean(profile&&ORGANIZATION_COMMON_SURFACES.evidence.length),
        events:true,audit:true,escalation:true,executiveRollup:true
      };
      const missing=ORGANIZATION_COVERAGE_FIELDS.filter(k=>!coverage[k]);
      const status=!departmentTypeKnown?'INVALID_DEPARTMENT_TYPE':!profile?'UNMAPPED_DEPARTMENT':!row.active?'INACTIVE_DEPARTMENT':missing.length?'PARTIALLY_PROVISIONED':'SOURCE_INTEGRATION_COMPLETE';
      return {
        id:row.id,code,name:row.name,departmentType:row.department_type,parentId:row.parent_id,
        hierarchyPath:hierarchyPath(row),active:row.active,departmentTypeKnown,
        profile:profile?{
          roles:profile.roles,permissionsByRole:Object.fromEntries(profile.roles.map(role=>[role,permissionsForRole(role)])),kpiIds:DEPARTMENT_KPI_MAP[code]||[],
          workflowSurfaces:profile.workflowSurfaces,slaSurfaces:profile.slaSurfaces,
          kpiSurface:'/v1/operations/department-kpis/'+code,
          dashboardSurfaces:ORGANIZATION_COMMON_SURFACES.dashboard,queueSurfaces:profile.queueSurfaces,
          ...ORGANIZATION_COMMON_SURFACES
        }:null,
        authorityPositions:positionRows.rows
          .filter(position=>String(position.department_id)===String(row.id))
          .map(position=>({
            id:position.id,
            title:position.title,
            authorityLevel:Number(position.authority_level),
            managerPositionId:position.manager_position_id,
            active:Boolean(position.active),
            validFrom:position.valid_from,
            validTo:position.valid_to,
            ...(exposePositionIdentity
              ? { userId:position.user_id, identityRedacted:false }
              : { identityRedacted:true }),
            authorityPath:buildAuthorityPath(position,positionById,{includeUserId:exposePositionIdentity})
          })),
        provisioning:{
          totalPositions:Number(p.total_positions||0),
          activePositions:Number(p.active_positions||0),
          activeScopeGrants:Number(sc.active_scope_grants||0)
        },
        coverage,missing,status
      };
    });
    return {
      schema:'fiberos.organization-operating-model.v1',
      enterpriseDepartmentTypes:ENTERPRISE_DEPARTMENT_TYPES,
      sourceAuthority:'REPOSITORY_DEPARTMENT_CONTRACTS_PLUS_TENANT_ORGANIZATION_STATE',
      syntheticData:false,runtimeVerification:'UNVERIFIED',
      departmentCount:organization.length,canonicalDepartmentCount:KPI_DEPARTMENTS.length,
      summary:{
        sourceIntegrationComplete:organization.filter(x=>x.status==='SOURCE_INTEGRATION_COMPLETE').length,
        partiallyProvisioned:organization.filter(x=>x.status==='PARTIALLY_PROVISIONED').length,
        unmappedDepartments:organization.filter(x=>x.status==='UNMAPPED_DEPARTMENT').length,
        invalidDepartmentTypes:organization.filter(x=>x.status==='INVALID_DEPARTMENT_TYPE').length,
        hierarchyCycles:organization.filter(x=>x.hierarchyPath.includes('[CYCLE_DETECTED]') || x.authorityPositions.some(p=>p.authorityPath.includes('[CYCLE_DETECTED]'))).length
      },
      coverageFields:ORGANIZATION_COVERAGE_FIELDS,organization,
      limitations:[
        'SOURCE_INTEGRATION_COMPLETE is a source/provisioning state, not provider or runtime certification.',
        'Missing tenant departments or scope grants are reported, never invented.',
        'ENGINEERING has no dedicated queue surface in the shipped source contract.'
      ]
    };
  });
}

async function auditEvents(db, principal, req) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const n = limit(req, 100, 250);
    const result = await client.query(
      'select id,"timestamp",actor_id,action,ref_id,detail,prev_hash,event_hash_chain,correlation_id,request_hash from audit_log where tenant_id=$1 order by id desc limit $2',
      [t, n]
    );
    return {
      events: result.rows,
      authority: 'DATABASE_BACKED_APPEND_ONLY_AUDIT_LOG',
      immutableSource: true,
      syntheticData: false
    };
  });
}

async function notificationCenter(db, principal, req) {
  dbRequired(db);
  const requested = String(
    new URL(req.url || '/', 'http://fiberos.local').searchParams.get('status') || ''
  ).trim();
  if (requested && !['pending', 'published', 'failed', 'dead_letter'].includes(requested)) {
    return { errorStatus: 400, body: { ok: false, error: 'NOTIFICATION_STATUS_INVALID' } };
  }

  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const n = limit(req, 50, 200);
    const params = [t, n];
    const statusSql = requested ? ' and o.publish_status=$3' : '';
    if (requested) params.push(requested);
    const result = await client.query(
      `select o.event_id,o.aggregate_type,o.aggregate_id,o.event_type,o.publish_status,o.attempts,o.last_error,o.created_at,o.published_at,
        case
          when coalesce(o.payload->>'recipient','')='' then null
          when length(o.payload->>'recipient')<=4 then '***'
          else repeat('*',greatest(length(o.payload->>'recipient')-4,0))||right(o.payload->>'recipient',4)
        end recipient_masked,
        o.payload->>'channel' channel,o.payload->>'template' template
        from outbox_events o
        where o.tenant_id=$1 and o.aggregate_type='communication'${statusSql}
        order by o.created_at desc,o.event_id desc limit $2`,
      params
    );
    return {
      notifications: result.rows,
      authority: 'DATABASE_BACKED_OUTBOX_REQUESTS',
      deliveryAuthority: 'EXTERNAL_PROVIDER_WORKER_ONLY',
      syntheticData: false,
      limitations: [
        'Queued requests are not delivery receipts.',
        'Recipients are masked in this management read model.',
        'Provider delivery is never inferred from queue state.'
      ]
    };
  });
}

async function migrationCenter(db, principal) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const summary = await client.query(
      `select workflow_type,status,count(*)::int count
       from installation_jobs
       where tenant_id=$1
       group by workflow_type,status
       order by workflow_type,status`,
      [t]
    );
    const deadlines = await client.query(
      `select
        count(*) filter(where migration_completion_deadline_at is not null and migration_completion_deadline_at<now() and status not in ('COMPLETED','REJECTED','CANCELLED'))::int overdue,
        count(*) filter(where migration_completion_deadline_at is not null and migration_completion_deadline_at>=now() and migration_completion_deadline_at<=now()+interval '24 hours' and status not in ('COMPLETED','REJECTED','CANCELLED'))::int due_within_24h,
        count(*) filter(where workflow_type='MIGRATION')::int total_migrations
       from installation_jobs
       where tenant_id=$1`,
      [t]
    );
    return {
      workflow: 'MIGRATION_CENTER',
      sourceOfTruth: 'INSTALLATION_JOBS',
      summary: summary.rows,
      deadlines: deadlines.rows[0],
      syntheticData: false
    };
  });
}

async function workflowsOverview(db, principal) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const [tickets, installations] = await Promise.all([
      client.query(
        'select status,count(*)::int count from tickets where tenant_id=$1 group by status order by status',
        [t]
      ),
      client.query(
        'select workflow_type,status,count(*)::int count from installation_jobs where tenant_id=$1 group by workflow_type,status order by workflow_type,status',
        [t]
      )
    ]);
    return {
      workflowEngine: {
        ticketLifecycle: tickets.rows,
        installationWorkflows: installations.rows
      },
      authority: 'DATABASE_BACKED_WORKFLOW_STATE_READ_MODEL',
      syntheticData: false,
      limitations: [
        'This is a read model over authoritative workflow state.',
        'State transitions remain governed by existing database lifecycle authorities.'
      ]
    };
  });
}

async function workloadBalance(db, principal) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const result = await client.query(
      `select
        t.id,t.name,t.zone,t.is_active,t.battery_status,
        (t.current_gps is not null) as tracked,
        count(tk.id) filter(where tk.status in ('pending','in_progress','awaiting_evidence','manager_review'))::int open_tickets,
        count(tk.id) filter(where tk.created_at>=now()-interval '24 hours')::int tickets_24h,
        min(tk.created_at) filter(where tk.status in ('pending','in_progress','awaiting_evidence','manager_review')) oldest_open_at
       from technicians t
       left join tickets tk on tk.technician_id=t.id and tk.tenant_id=t.tenant_id
       where t.tenant_id=$1 and t.is_active=true
       group by t.id,t.name,t.zone,t.is_active,t.battery_status,t.current_gps
       order by open_tickets desc,oldest_open_at asc nulls last,t.id`,
      [t]
    );

    const workers = result.rows.map((row) => {
      const open = Number(row.open_tickets || 0);
      return {
        ...row,
        workloadIndex: open,
        loadBand: open >= 8 ? 'HIGH' : open >= 4 ? 'MEDIUM' : 'LOW'
      };
    });

    const distribution = workers.reduce((acc, row) => {
      acc[row.loadBand] = (acc[row.loadBand] || 0) + 1;
      return acc;
    }, { LOW: 0, MEDIUM: 0, HIGH: 0 });

    return {
      workers,
      distribution,
      authority: 'DATABASE_BACKED_TECHNICIAN_WORKLOAD_READ_MODEL',
      assignmentMutation: false,
      syntheticData: false,
      limitations: [
        'Workload is derived from persisted open-ticket assignments.',
        'This surface recommends no automatic reassignment; dispatch authority remains separate.'
      ]
    };
  });
}

async function rbacEffective(db, principal) {
  dbRequired(db);
  if (!isUuid(principal && principal.sub)) {
    return {
      errorStatus: 400,
      body: { ok: false, error: 'PRINCIPAL_SUB_UUID_REQUIRED' }
    };
  }

  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const result = await client.query(
      `select
        ep.id position_id,ep.title,ep.authority_level,
        ed.code department_code,ed.name department_name,
        coalesce(
          jsonb_agg(
            distinct jsonb_build_object(
              'scopeType',sg.scope_type,
              'scopeId',sg.scope_id,
              'capabilities',sg.capabilities,
              'validFrom',sg.valid_from,
              'validTo',sg.valid_to
            )
          ) filter(where sg.id is not null),
          '[]'::jsonb
        ) scopes
       from enterprise_positions ep
       join enterprise_departments ed
         on ed.id=ep.department_id and ed.tenant_id=ep.tenant_id
       left join enterprise_scope_grants sg
         on sg.position_id=ep.id
        and sg.tenant_id=ep.tenant_id
        and (sg.valid_to is null or sg.valid_to>now())
       where ep.tenant_id=$1
         and ep.user_id=$2::uuid
         and ep.active=true
         and (ep.valid_to is null or ep.valid_to>now())
       group by ep.id,ep.title,ep.authority_level,ed.code,ed.name
       order by ep.authority_level desc,ep.id`,
      [t, principal.sub]
    );

    return {
      principal: principal.sub,
      positions: result.rows,
      authority: 'DATABASE_BACKED_ENTERPRISE_SCOPE_MODEL',
      clientTenantAuthorityAccepted: false,
      syntheticData: false
    };
  });
}

async function subcontractorsOverview(db, principal) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const [status, tiers, qualifications, measurements] = await Promise.all([
      client.query(
        'select status,count(*)::int count from contractor_entities where tenant_id=$1 group by status order by status',
        [t]
      ),
      client.query(
        'select tier,count(*)::int count from contractor_entities where tenant_id=$1 group by tier order by tier',
        [t]
      ),
      client.query(
        'select status,count(*)::int count from contractor_qualifications where tenant_id=$1 group by status order by status',
        [t]
      ),
      client.query(
        'select status,count(*)::int count from contractor_work_measurements where tenant_id=$1 group by status order by status',
        [t]
      )
    ]);

    return {
      contractors: {
        byStatus: status.rows,
        byTier: tiers.rows
      },
      qualifications: qualifications.rows,
      workMeasurements: measurements.rows,
      authority: 'DATABASE_BACKED_CONTRACTOR_SUPPLY_CHAIN',
      syntheticData: false
    };
  });
}

async function smartInventoryOverview(db, principal) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const [items, warehouses, reservations, transfers, reorderItems] = await Promise.all([
      client.query(
        'select count(*)::int items,coalesce(sum(quantity_on_hand),0)::numeric quantity_on_hand,count(*) filter(where quantity_on_hand<=reorder_point)::int reorder_alerts from inventory_items where tenant_id=$1',
        [t]
      ),
      client.query(
        "select count(*)::int total,count(*) filter(where status='ACTIVE')::int active from warehouses where tenant_id=$1",
        [t]
      ),
      client.query(
        "select count(*)::int active from inventory_reservations where tenant_id=$1 and status='RESERVED'",
        [t]
      ),
      client.query(
        "select count(*)::int pending from warehouse_transfers where tenant_id=$1 and status='REQUESTED'",
        [t]
      ),
      client.query(
        'select sku,description,quantity_on_hand,reorder_point,unit from inventory_items where tenant_id=$1 and quantity_on_hand<=reorder_point order by (reorder_point-quantity_on_hand) desc,sku limit 50',
        [t]
      )
    ]);

    return {
      inventory: items.rows[0],
      warehouses: warehouses.rows[0],
      activeReservations: Number(reservations.rows[0].active || 0),
      pendingTransfers: Number(transfers.rows[0].pending || 0),
      reorderItems: reorderItems.rows,
      authority: 'DATABASE_BACKED_INVENTORY_LEDGER',
      syntheticData: false
    };
  });
}

async function assetDna(db, principal, assetId) {
  dbRequired(db);
  if (!isUuid(assetId)) {
    return { errorStatus: 400, body: { ok: false, error: 'ASSET_ID_INVALID' } };
  }

  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const result = await client.query(
      `select
        a.id,a.asset_code,a.asset_type,a.name,a.status,a.updated_at,
        dna.dna_version,dna.identity_kind,dna.evidence_class,
        dna.canonical_payload,dna.payload_sha256,dna.created_at dna_created_at
       from network_assets a
       left join lateral (
         select dna_version,identity_kind,evidence_class,canonical_payload,payload_sha256,created_at
         from fiberos_asset_dna
         where tenant_id=$1 and asset_id=a.id
         order by dna_version desc
         limit 1
       ) dna on true
       where a.tenant_id=$1 and a.id=$2::uuid
       limit 1`,
      [t, assetId]
    );

    if (!result.rows[0]) {
      return { errorStatus: 404, body: { ok: false, error: 'ASSET_NOT_FOUND' } };
    }

    const row = result.rows[0];
    return {
      asset: {
        id: row.id,
        code: row.asset_code,
        type: row.asset_type,
        name: row.name,
        status: row.status,
        updatedAt: row.updated_at
      },
      dna: row.dna_version == null
        ? null
        : {
            version: row.dna_version,
            identityKind: row.identity_kind,
            evidenceClass: row.evidence_class,
            canonicalPayload: row.canonical_payload,
            payloadSha256: row.payload_sha256,
            createdAt: row.dna_created_at
          },
      authority: 'DATABASE_GENERATED_ASSET_DNA',
      clientCannotAuthorCanonicalPayload: true,
      syntheticData: false,
      limitations: row.dna_version == null
        ? ['No DNA snapshot exists for this asset yet.']
        : []
    };
  });
}

async function operationsTimeline(db, principal, req) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const n = limit(req, 100, 250);
    const result = await client.query(
      'select event_id,aggregate_type,aggregate_id,event_type,publish_status,attempts,created_at,published_at from outbox_events where tenant_id=$1 order by created_at desc,id desc limit $2',
      [t, n]
    );
    return {
      entries: result.rows,
      source: 'OUTBOX_EVENT_JOURNAL',
      authority: 'DATABASE_BACKED_OPERATIONAL_EVENT_TIMELINE',
      notAuditLog: true,
      syntheticData: false
    };
  });
}

async function cxHeatmap(db, principal, req) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const n = limit(req, 250, 500);
    const result = await client.query(
      `select
        round(ST_Y(location_coordinates::geometry)::numeric,2) as lat_cell,
        round(ST_X(location_coordinates::geometry)::numeric,2) as lon_cell,
        count(*)::int ticket_count,
        count(*) filter(where status not in ('completed','cancelled','rejected'))::int open_count,
        count(*) filter(where status='completed')::int completed_count
       from tickets
       where tenant_id=$1 and location_coordinates is not null
       group by 1,2
       order by ticket_count desc,lat_cell,lon_cell
       limit $2`,
      [t, n]
    );
    return {
      cells: result.rows,
      gridPrecisionDegrees: 0.01,
      authority: 'DATABASE_BACKED_CUSTOMER_EXPERIENCE_TICKET_HEATMAP',
      syntheticData: false,
      privacyBoundary: 'AGGREGATED_SPATIAL_CELLS_ONLY',
      exactCustomerCoordinatesExcluded: true
    };
  });
}

async function selfDiagnostic(db, principal, reference) {
  dbRequired(db);
  const ref = String(reference || '').trim();
  if (!ref || ref.length > 128) {
    return { errorStatus: 400, body: { ok: false, error: 'CUSTOMER_REFERENCE_INVALID' } };
  }

  return withPrincipal(db, principal, async (client) => {
    const account = await client.query(
      `select id,tenant_id,customer_ref
       from customer_accounts
       where user_id=auth.uid() and customer_ref=$1
       limit 1`,
      [ref]
    );
    if (!account.rows[0]) {
      return { errorStatus: 404, body: { ok: false, error: 'CUSTOMER_ACCOUNT_NOT_FOUND' } };
    }

    const t = account.rows[0].tenant_id;
    const services = await client.query(
      'select id,customer_ref from services where tenant_id=$1 and customer_ref=$2 order by id',
      [t, ref]
    );
    const ids = services.rows.map((row) => row.id);

    const [tickets, invoices] = await Promise.all([
      ids.length
        ? client.query(
            `select status,count(*)::int count,min(created_at) oldest_open
             from tickets
             where tenant_id=$1 and service_id=any($2::uuid[])
             group by status
             order by status`,
            [t, ids]
          )
        : Promise.resolve({ rows: [] }),
      client.query(
        `select status,count(*)::int count,coalesce(sum(amount_minor),0)::bigint amount_minor
         from invoices
         where tenant_id=$1 and customer_ref=$2
         group by status
         order by status`,
        [t, ref]
      )
    ]);

    return {
      customer: {
        customerRef: ref,
        serviceCount: services.rows.length
      },
      services: services.rows.map((row) => row.id),
      tickets: tickets.rows,
      invoices: invoices.rows,
      authority: 'DATABASE_BACKED_CUSTOMER_SELF_DIAGNOSTIC',
      syntheticData: false,
      diagnosisAuthority: 'NONE',
      limitations: [
        'This surface summarizes persisted service/ticket/billing state and does not infer a physical fault.',
        'Physical optical/NMS/telemetry diagnosis requires corresponding evidence and integration data.'
      ]
    };
  });
}

async function memoryQuery(db, principal, req) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const url = new URL(req.url || '/', 'http://fiberos.local');
    const t = await tenant(client);
    const n = limit(req, 100, 250);
    const subjectType = url.searchParams.get('subjectType');
    const subjectId = url.searchParams.get('subjectId');
    const state = url.searchParams.get('state');
    const source = url.searchParams.get('source');

    const where = ['tenant_id=$1'];
    const params = [t];
    let paramIndex = 2;

    for (const [value, column] of [
      [subjectType, 'subject_type'],
      [subjectId, 'subject_id'],
      [state, 'state'],
      [source, 'source']
    ]) {
      if (value) {
        if (String(value).length > 128) {
          return {
            errorStatus: 400,
            body: { ok: false, error: 'MEMORY_QUERY_PARAMETER_TOO_LONG' }
          };
        }
        where.push(column + '=$' + paramIndex);
        params.push(String(value));
        paramIndex += 1;
      }
    }

    params.push(n);
    const result = await client.query(
      `select id,subject_type,subject_id,attribute,value,unit,source,observed_at,confidence,state,provenance,created_by
       from truth_facts
       where ${where.join(' and ')}
       order by observed_at desc,id desc
       limit $${paramIndex}`,
      params
    );

    return {
      facts: result.rows,
      query: {
        subjectType,
        subjectId,
        state,
        source,
        limit: n
      },
      authority: 'DATABASE_BACKED_TRUTH_FABRIC',
      syntheticData: false,
      limitations: [
        'Fact state and confidence are preserved exactly; this endpoint does not rewrite or promote facts.'
      ]
    };
  });
}

async function executiveRadar(db, principal) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const [operations, finance, incidents, inventory] = await Promise.all([
      client.query(
        `select
          count(*) filter(where status not in ('completed','cancelled','rejected'))::int open_tickets,
          count(*) filter(where status not in ('completed','cancelled','rejected') and technician_id is null)::int unassigned_tickets,
          count(*) filter(where sla_deadline is not null and sla_deadline<now() and status not in ('completed','cancelled','rejected'))::int overdue_sla
         from tickets
         where tenant_id=$1`,
        [t]
      ),
      client.query(
        `select
          count(*) filter(where status='issued')::int issued_invoices,
          coalesce(sum(amount_minor) filter(where status in ('issued','overdue','partially_paid')),0)::bigint open_amount_minor,
          count(*) filter(where status='overdue')::int overdue_invoices
         from invoices
         where tenant_id=$1`,
        [t]
      ),
      client.query(
        `select
          count(*) filter(where state not in ('resolved','closed'))::int active_incidents,
          count(*) filter(where state not in ('resolved','closed') and severity='P1')::int p1_incidents,
          coalesce(sum(affected_customers) filter(where state not in ('resolved','closed')),0)::bigint affected_customers
         from incidents
         where tenant_id=$1`,
        [t]
      ),
      client.query(
        `select
          count(*)::int reorder_alerts,
          coalesce(sum(quantity_on_hand),0)::numeric quantity_on_hand
         from inventory_items
         where tenant_id=$1 and quantity_on_hand<=reorder_point`,
        [t]
      )
    ]);

    return {
      radar: {
        operations: operations.rows[0],
        finance: finance.rows[0],
        incidents: incidents.rows[0],
        inventory: inventory.rows[0]
      },
      authority: 'DATABASE_BACKED_EXECUTIVE_RADAR_READ_MODEL',
      syntheticData: false,
      autonomousDecision: false,
      limitations: [
        'Reports persisted facts only; no future incident or financial outcome is predicted.',
        'Priority ordering remains an authorized human decision.'
      ]
    };
  });
}

async function executiveReport(req, res, db, principal) {
  dbRequired(db);
  const out = await executiveRadar(db, principal);
  const format = String(
    new URL(req.url || '/', 'http://fiberos.local').searchParams.get('format') || 'json'
  ).toLowerCase();

  if (format !== 'json' && format !== 'csv') {
    return {
      errorStatus: 400,
      body: { ok: false, error: 'REPORT_FORMAT_INVALID' }
    };
  }

  if (format === 'json') {
    return {
      ...out,
      reportFormat: 'json',
      generatedFrom: 'DATABASE_BACKED_EXECUTIVE_RADAR_READ_MODEL'
    };
  }

  const rows = [
    ['section', 'metric', 'value'],
    ['operations', 'open_tickets', out.radar.operations.open_tickets],
    ['operations', 'unassigned_tickets', out.radar.operations.unassigned_tickets],
    ['operations', 'overdue_sla', out.radar.operations.overdue_sla],
    ['finance', 'issued_invoices', out.radar.finance.issued_invoices],
    ['finance', 'open_amount_minor', out.radar.finance.open_amount_minor],
    ['finance', 'overdue_invoices', out.radar.finance.overdue_invoices],
    ['incidents', 'active_incidents', out.radar.incidents.active_incidents],
    ['incidents', 'p1_incidents', out.radar.incidents.p1_incidents],
    ['incidents', 'affected_customers', out.radar.incidents.affected_customers],
    ['inventory', 'reorder_alerts', out.radar.inventory.reorder_alerts],
    ['inventory', 'quantity_on_hand', out.radar.inventory.quantity_on_hand]
  ];

  const csv = rows
    .map((row) => row
      .map((value) => {
        const s = String(value ?? '');
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      })
      .join(','))
    .join('\\n') + '\\n';

  applySecurityHeaders(res, process.env);
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': 'attachment; filename="fiberos-executive-radar.csv"',
    'Content-Length': Buffer.byteLength(csv),
    'X-FiberOS-Authority': 'server'
  });
  res.end(csv);
  return { handled: true };
}

async function companyMemory(db, principal, req) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const n = limit(req, 100, 250);
    const [facts, conflicts] = await Promise.all([
      client.query(
        `select id,subject_type,subject_id,attribute,value,unit,source,observed_at,confidence,state,provenance,created_by
         from truth_facts
         where tenant_id=$1
         order by observed_at desc,id desc
         limit $2`,
        [t, n]
      ),
      client.query(
        `select id,conflict_key,severity,fact_ids,sources,status,rationale,resolution_evidence_ids,detected_at,resolved_at
         from data_conflicts
         where tenant_id=$1
         order by detected_at desc,id desc
         limit $2`,
        [t, Math.min(n, 100)]
      )
    ]);

    return {
      memory: {
        facts: facts.rows,
        conflicts: conflicts.rows
      },
      authority: 'DATABASE_BACKED_TRUTH_FABRIC',
      syntheticData: false,
      autonomousMemory: false,
      limitations: [
        'This is an evidence/truth read model, not an autonomous memory agent.',
        'CONFLICTED/STALE/UNVERIFIED facts remain labelled and are never promoted to known truth.'
      ]
    };
  });
}

async function trustOverview(db, principal, req) {
  dbRequired(db);
  return withPrincipal(db, principal, async (client) => {
    const t = await tenant(client);
    const n = limit(req, 50, 200);
    const [evidence, decisions, executions] = await Promise.all([
      client.query(
        'select status,count(*)::int count from evidence_chain_certificates where tenant_id=$1 group by status order by status',
        [t]
      ),
      client.query(
        'select classification,approval_status,count(*)::int count from decision_certificates where tenant_id=$1 group by classification,approval_status order by classification,approval_status',
        [t]
      ),
      client.query(
        'select status,count(*)::int count from decision_executions where tenant_id=$1 group by status order by status',
        [t]
      )
    ]);

    return {
      trust: {
        evidenceCertificates: evidence.rows,
        decisionCertificates: decisions.rows,
        decisionExecutions: executions.rows
      },
      authority: 'DATABASE_BACKED_DECISION_AND_EVIDENCE_TRUST_READ_MODEL',
      syntheticData: false,
      executionAuthority: 'DATABASE_CONTROLLED_COMMAND_PATH',
      limitations: [
        'Certificate presence does not prove production key custody.',
        'Persistent signing/KMS/HSM and buyer-runtime verification remain separate evidence requirements.'
      ]
    };
  });
}

function runtimeContracts() {
  const summary = require('../../../../packages/interface-contracts/src/index').summary();
  return {
    contracts: summary,
    authority: 'SHIPPED_INTERFACE_CONTRACT_CATALOG',
    syntheticData: false,
    productionClaim: 'PROHIBITED_UNTIL_MATRIX_EVIDENCE',
    limitations: ['Contract catalog exposure does not attest buyer-runtime interoperability.']
  };
}

async function companyOperatingSystem(db, principal) {
  const [radar, memory, trust] = await Promise.all([
    executiveRadar(db, principal),
    companyMemory(db, principal, { url: '/v1/memory/recent?limit=10' }),
    trustOverview(db, principal, { url: '/v1/security/trust/overview?limit=10' })
  ]);

  return {
    operatingSystem: {
      radar: radar.radar,
      memory: memory.memory,
      trust: trust.trust
    },
    authority: 'DATABASE_BACKED_COMPANY_OPERATING_SYSTEM_READ_MODEL',
    syntheticData: false,
    autonomousExecution: false,
    limitations: [
      'Composes authoritative read models and does not autonomously change business state.',
      'Runtime/provider evidence remains required for production certification.'
    ]
  };
}

function zeroTrustReadiness(principal) {
  return {
    posture: 'FAIL_CLOSED_BY_DEFAULT',
    enforcedBoundaries: [
      'central-route-authorization-policy',
      'verified-identity-before-protected-runtime-access',
      'tenant-derived-from-server-session',
      'database-RLS-and-FORCE-RLS',
      'append-only-audit-authority',
      'replay-defense-for-protected-mutations',
      'external-provider-attestation-and-fail-closed-errors'
    ],
    productionEvidenceStillRequired: [
      'exact-head runtime database/RLS execution',
      'buyer OIDC/JWKS validation',
      'runtime container security execution',
      'provider/device/object-storage evidence where applicable'
    ],
    authority: 'SOURCE_SECURITY_CONTRACT_READ_MODEL',
    authenticatedPrincipal: Boolean(principal && principal.authenticated),
    syntheticData: false
  };
}

async function handleManagementSurfaces(req, res, ctx) {
  const { method, path, principal, db, send } = ctx;
  if (method !== 'GET') return null;

  const routes = [
    ['/v1/organization/operating-model', ROLES.organization, () => organizationOperatingModel(db, principal)],
    ['/v1/audit/events', ROLES.audit, () => auditEvents(db, principal, req)],
    ['/v1/notifications/center', ROLES.communications, () => notificationCenter(db, principal, req)],
    ['/v1/migration-center/overview', ROLES.management, () => migrationCenter(db, principal)],
    ['/v1/workflows/overview', ROLES.management, () => workflowsOverview(db, principal)],
    ['/v1/operations/workload-balance', ROLES.management, () => workloadBalance(db, principal)],
    ['/v1/security/rbac/effective', ROLES.rbac, () => rbacEffective(db, principal)],
    ['/v1/subcontractors/overview', ROLES.contractor, () => subcontractorsOverview(db, principal)],
    ['/v1/smart-inventory/overview', ROLES.inventory, () => smartInventoryOverview(db, principal)],
    ['/v1/operations/timeline', ROLES.management, () => operationsTimeline(db, principal, req)],
    ['/v1/security/zero-trust/readiness', ROLES.rbac, () => zeroTrustReadiness(principal)],
    ['/v1/executive/radar', ROLES.management, () => executiveRadar(db, principal)],
    ['/v1/executive/radar/report', ROLES.management, () => executiveReport(req, res, db, principal)],
    ['/v1/cx/heatmap', ROLES.management, () => cxHeatmap(db, principal, req)],
    ['/v1/memory/recent', ROLES.management, () => companyMemory(db, principal, req)],
    ['/v1/memory/query', ROLES.management, () => memoryQuery(db, principal, req)],
    ['/v1/security/trust/overview', ROLES.rbac, () => trustOverview(db, principal, req)],
    ['/v1/contracts/runtime', ROLES.management, () => runtimeContracts()],
    ['/v1/company/operating-system', ROLES.management, () => companyOperatingSystem(db, principal)]
  ];

  for (const [route, roles, operation] of routes) {
    if (path !== route) continue;

    const authorization = auth(principal, roles);
    if (!authorization.ok) return send(res, authorization.status, authorization.body);

    try {
      const out = await operation();
      if (out && out.handled) return out;
      if (resultError(out)) return send(res, out.errorStatus, out.body);
      return send(res, 200, { ok: true, ...out });
    } catch (error) {
      return send(
        res,
        Number(error && error.statusCode) || 500,
        { ok: false, error: error && error.code || 'DB_ERROR' }
      );
    }
  }

  const diagPrefix = '/v1/customer/self-diagnostic/';
  if (path.startsWith(diagPrefix)) {
    const verified = requireVerifiedPrincipal(principal, process.env);
    if (!verified.ok) return send(res, verified.status, verified.body);
    try {
      const out = await selfDiagnostic(db, principal, path.slice(diagPrefix.length));
      if (resultError(out)) return send(res, out.errorStatus, out.body);
      return send(res, 200, { ok: true, ...out });
    } catch (error) {
      return send(
        res,
        Number(error && error.statusCode) || 500,
        { ok: false, error: error && error.code || 'DB_ERROR' }
      );
    }
  }

  const dnaPrefix = '/v1/enterprise/fiber-dna/';
  if (path.startsWith(dnaPrefix)) {
    const authorization = auth(principal, ROLES.dna);
    if (!authorization.ok) return send(res, authorization.status, authorization.body);

    const assetId = path.slice(dnaPrefix.length);
    if (!isUuid(assetId)) {
      return send(res, 400, { ok: false, error: 'ASSET_ID_INVALID' });
    }

    try {
      const out = await assetDna(db, principal, assetId);
      if (resultError(out)) return send(res, out.errorStatus, out.body);
      return send(res, 200, { ok: true, ...out });
    } catch (error) {
      return send(
        res,
        Number(error && error.statusCode) || 500,
        { ok: false, error: error && error.code || 'DB_ERROR' }
      );
    }
  }

  return null;
}

module.exports = Object.freeze({
  handleManagementSurfaces,
  auditEvents,
  notificationCenter,
  migrationCenter,
  workflowsOverview,
  workloadBalance,
  rbacEffective,
  subcontractorsOverview,
  smartInventoryOverview,
  assetDna,
  operationsTimeline,
  executiveRadar,
  executiveReport,
  companyMemory,
  memoryQuery,
  trustOverview,
  runtimeContracts,
  companyOperatingSystem,
  cxHeatmap,
  selfDiagnostic,
  zeroTrustReadiness,
  organizationOperatingModel,
  ORGANIZATION_DEPARTMENT_PROFILES,
  ENTERPRISE_DEPARTMENT_TYPES,
  ORGANIZATION_COVERAGE_FIELDS,
  buildAuthorityPath
});
