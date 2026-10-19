'use strict';

const crypto = require('crypto');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { simulateFailure } = require('../../../../packages/digital-twin-gis/src/simulationEngine');
const { normalizeProfile, weightedObservedRate, compareToObserved } = require('../../../../packages/engineering/src/costCalibration');

const EXTENSION_REGISTRY = require('../../../../config/extensions-registry.json');

const MANAGEMENT_ROLES = ['ops_manager','area_supervisor','exec','sysadmin'];
const COST_READ_ROLES = ['cfo','exec','ops_manager','area_supervisor','sysadmin'];
const MAX_REPORT_ROWS = 10000;

function assertDb(db) {
  if (!db || !db.configured || !db.pool) {
    throw Object.assign(new Error('DATABASE_REQUIRED'), { statusCode: 503, code: 'DATABASE_REQUIRED' });
  }
}

function auth(principal, roles) {
  const a = requireVerifiedPrincipal(principal, process.env);
  if (!a.ok) return a;
  return requireAnyRole(principal, roles);
}

async function tenant(client) {
  const r = await client.query('select tenant_id from user_preferences where user_id=auth.uid() limit 1');
  if (!r.rows[0]?.tenant_id) {
    throw Object.assign(new Error('TENANT_CONTEXT_REQUIRED'), { statusCode: 403, code: 'TENANT_CONTEXT_REQUIRED' });
  }
  return r.rows[0].tenant_id;
}

function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(stable(value)).digest('hex');
}

function utcNow() {
  return new Date().toISOString();
}

function csvValue(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

async function buildNoc3dScene(db, principal) {
  assertDb(db);
  return withPrincipal(db, principal, async client => {
    const t = await tenant(client);
    const capturedAt = utcNow();

    const [assets, edges, incidents, technicians, services, tickets] = await Promise.all([
      client.query(
        'select a.id,a.asset_code,a.asset_type,a.name,a.region,a.status,a.total_ports,' +
        'ST_X(a.gps::geometry)::float8 as lon,ST_Y(a.gps::geometry)::float8 as lat,' +
        'coalesce(c.used_ports,0)::int used_ports,coalesce(c.provisioned_ports,0)::int provisioned_ports,' +
        'coalesce(c.over_capacity,false) over_capacity ' +
        'from network_assets a left join network_asset_capacity c on c.asset_id=a.id ' +
        'where a.tenant_id=$1 order by a.asset_type,a.asset_code,a.id limit ' + MAX_REPORT_ROWS, [t]
      ),
      client.query(
        'select from_asset_id,to_asset_id,relation,capacity,weight,shared_risk_group,direction ' +
        'from physical_topology_edges where tenant_id=$1 and active=true ' +
        'order by from_asset_id,to_asset_id,relation limit 40000', [t]
      ),
      client.query(
        'select primary_asset_id,count(*)::int incident_count,' +
        'count(*) filter(where severity=\'P1\')::int p1_count ' +
        'from incidents where tenant_id=$1 and state not in (\'resolved\',\'closed\') ' +
        'group by primary_asset_id', [t]
      ),
      client.query(
        'select id,name,zone,skills,is_active,current_gps_captured_at as captured_at,' +
        'ST_X(current_gps::geometry)::float8 as lon,ST_Y(current_gps::geometry)::float8 as lat,' +
        'accuracy_meters,heading_degrees,speed_mps from technicians ' +
        'where tenant_id=$1 and is_active=true and current_gps is not null ' +
        'order by name,id limit 5000', [t]
      ),
      client.query(
        'select count(*)::int total,count(*) filter(where is_active=true)::int active ' +
        'from services where tenant_id=$1', [t]
      ),
      client.query(
        'select count(*) filter(where status not in (\'completed\',\'cancelled\',\'rejected\'))::int open,' +
        'count(*) filter(where status not in (\'completed\',\'cancelled\',\'rejected\') and technician_id is null)::int unassigned ' +
        'from tickets where tenant_id=$1', [t]
      )
    ]);

    const incidentMap = new Map(incidents.rows.map(x => [String(x.primary_asset_id), x]));
    const typeTier = Object.freeze({ OLT:0, MDF:1, FDT:2, PFP:3, FAT:4, SPLITTER:5, ONT:6 });

    const sceneAssets = assets.rows.map(row => {
      const inc = incidentMap.get(String(row.id));
      return {
        id: row.id, code: row.asset_code, type: row.asset_type, name: row.name, region: row.region,
        status: row.status, lon: row.lon, lat: row.lat,
        semanticZ: typeTier[String(row.asset_type)] ?? 0,
        semanticZMeaning: 'asset-hierarchy-tier',
        capacity: {
          totalPorts: row.total_ports == null ? null : Number(row.total_ports),
          usedPorts: Number(row.used_ports || 0),
          provisionedPorts: Number(row.provisioned_ports || 0),
          overCapacity: Boolean(row.over_capacity)
        },
        activeIncidents: Number(inc?.incident_count || 0),
        p1Incidents: Number(inc?.p1_count || 0)
      };
    });

    const spatialAssets = sceneAssets.filter(a => Number.isFinite(a.lon) && Number.isFinite(a.lat));
    return {
      ok: true,
      sceneVersion: '1.0.0',
      generatedAt: capturedAt,
      coordinateReferenceSystem: 'EPSG:4326',
      verticalSemantics: 'semantic asset hierarchy tier; physical altitude is not inferred',
      scene: {
        assets: spatialAssets,
        links: edges.rows,
        technicians: technicians.rows,
        services: services.rows[0] || { total:0, active:0 },
        tickets: tickets.rows[0] || { open:0, unassigned:0 }
      },
      counts: {
        assetsTotal: sceneAssets.length,
        geolocatedAssets: spatialAssets.length,
        nonGeolocatedAssets: sceneAssets.length - spatialAssets.length,
        links: edges.rows.length,
        activeTechniciansTracked: technicians.rows.length,
        activeServices: Number(services.rows[0]?.active || 0),
        openTickets: Number(tickets.rows[0]?.open || 0),
        unassignedTickets: Number(tickets.rows[0]?.unassigned || 0),
        activeIncidentAssets: incidents.rows.length
      },
      sourceSnapshot: {
        capturedAt, tenantScoped: true,
        tables: ['network_assets','network_asset_capacity','physical_topology_edges','technicians','services','tickets','incidents']
      },
      authority: 'DATABASE_BACKED_NOC_3D_READ_ONLY',
      readOnly: true, syntheticData: false, autonomousMutation: false,
      sceneHash: sha256({
        assets: sceneAssets, edges: edges.rows, technicians: technicians.rows,
        services: services.rows, tickets: tickets.rows, incidents: incidents.rows
      })
    };
  });
}

async function loadSimulationSnapshot(client, tenantId) {
  const [assets, edges, ports, services] = await Promise.all([
    client.query(
      'select id,asset_type,parent_asset_id,asset_code,status,total_ports from network_assets ' +
      'where tenant_id=$1 order by asset_code,id limit 20000', [tenantId]
    ),
    client.query(
      'select from_asset_id,to_asset_id,relation,capacity,weight,shared_risk_group,direction,active ' +
      'from physical_topology_edges where tenant_id=$1 order by from_asset_id,to_asset_id,relation limit 40000', [tenantId]
    ),
    client.query(
      'select asset_id,status,count(*)::int count from network_ports where tenant_id=$1 group by asset_id,status', [tenantId]
    ),
    client.query(
      'select id,customer_ref,asset_path from services where tenant_id=$1 and is_active=true order by id limit 20000', [tenantId]
    )
  ]);

  const portsByAsset = {};
  for (const row of ports.rows) {
    (portsByAsset[row.asset_id] ||= []);
    for (let i = 0; i < Number(row.count || 0); i += 1) portsByAsset[row.asset_id].push({ status: row.status });
  }

  return {
    nodes: assets.rows.map(r => ({
      id:r.id, assetType:r.asset_type, parentId:r.parent_asset_id,
      code:r.asset_code, status:r.status, totalPorts:r.total_ports
    })),
    edges: edges.rows,
    portsByAsset,
    services: services.rows
  };
}

async function databaseSimulation(db, principal, body) {
  assertDb(db);
  return withPrincipal(db, principal, async client => {
    const t = await tenant(client);
    const snapshot = await loadSimulationSnapshot(client, t);
    const result = simulateFailure({
      failedAssetIds: body?.failedAssetIds ?? body?.failedAssetId,
      nodes: snapshot.nodes,
      edges: snapshot.edges,
      portsByAsset: snapshot.portsByAsset,
      services: snapshot.services
    });
    return {
      ...result,
      sourceSnapshot: {
        capturedAt: utcNow(), tenantScoped:true,
        nodes:snapshot.nodes.length, edges:snapshot.edges.length, serviceRows:snapshot.services.length,
        tables:['network_assets','physical_topology_edges','network_ports','services']
      },
      authority:'DATABASE_BACKED_DETERMINISTIC_SIMULATION',
      dataSource:'SERVER_DATABASE_SNAPSHOT',
      noProductionWrite:true
    };
  });
}

function provenanceFromProfile(p) {
  return {
    ...(p.provenance || {}),
    profileVersion:p.modelVersion, workType:p.workType, unit:p.unit, currency:p.currency,
    validFrom:p.validFrom, validTo:p.validTo,
    basis:'VERIFIED_CONTRACTOR_WORK_MEASUREMENTS'
  };
}

async function costObserved(client, tenantId, workType, unit, currency) {
  const r = await client.query(
    'select cwm.quantity,cwm.rate_minor,cwm.currency,cwm.status,wp.work_type ' +
    'from contractor_work_measurements cwm join ftth_work_packages wp ' +
    'on wp.id=cwm.work_package_id and wp.tenant_id=cwm.tenant_id ' +
    'where cwm.tenant_id=$1 and wp.work_type=$2 and cwm.unit=$3 and cwm.currency=$4 ' +
    'and cwm.status in (\'verified\',\'approved\',\'invoiced\',\'paid\') ' +
    'order by cwm.measured_at,cwm.id', [tenantId,workType,unit,currency]
  );
  return r.rows;
}

async function costCalibrationRead(db, principal) {
  assertDb(db);
  return withPrincipal(db, principal, async client => {
    const t = await tenant(client);
    const observedRows = await client.query(
      'select wp.work_type,cwm.unit,cwm.currency,sum(cwm.quantity)::numeric quantity,' +
      'sum(cwm.quantity*cwm.rate_minor)::numeric amount_minor,count(*)::int observations ' +
      'from contractor_work_measurements cwm join ftth_work_packages wp ' +
      'on wp.id=cwm.work_package_id and wp.tenant_id=cwm.tenant_id ' +
      'where cwm.tenant_id=$1 and cwm.status in (\'verified\',\'approved\',\'invoiced\',\'paid\') ' +
      'group by wp.work_type,cwm.unit,cwm.currency order by wp.work_type,cwm.unit,cwm.currency', [t]
    );

    const approvedRows = await client.query(
      'select id,model_key,model_version,parameter_key,value,units,std_uncertainty,valid_min,valid_max,' +
      'source_ref,provenance,approved_by,approved_at,created_at ' +
      'from engineering_calibrations where tenant_id=$1 and model_key=\'commercial.cost\' and status=\'APPROVED\' ' +
      'order by parameter_key,created_at desc', [t]
    );

    const observed = observedRows.rows.map(row => {
      const quantity = Number(row.quantity || 0);
      const amountMinor = Number(row.amount_minor || 0);
      const rate = quantity > 0 ? amountMinor / quantity : 0;
      const agg = weightedObservedRate([{ quantity: Math.max(quantity, 0.0000001), rateMinor: rate }]);
      return {
        workType:row.work_type, unit:row.unit, currency:row.currency,
        quantity, amountMinor, observations:Number(row.observations || 0),
        weightedRateMinor:agg.weightedRateMinor, dataAvailable:agg.dataAvailable
      };
    });

    const profiles = [];
    for (const row of approvedRows.rows) {
      try {
        const pv = row.provenance || {};
        const parts = String(row.parameter_key || '').split(':');
        const profile = normalizeProfile({
          workType:pv.workType || parts[1],
          unit:pv.unit || parts[2] || row.units,
          currency:pv.currency || parts[parts.length - 1],
          modelVersion:row.model_version,
          profileKey:row.parameter_key,
          valueMinor:Number(row.value),
          stdUncertainty:row.std_uncertainty == null ? null : Number(row.std_uncertainty),
          validMin:row.valid_min == null ? null : Number(row.valid_min),
          validMax:row.valid_max == null ? null : Number(row.valid_max),
          validFrom:pv.validFrom || null,
          validTo:pv.validTo || null,
          sourceRef:row.source_ref,
          provenance:pv
        });
        const match=observed.find(x => x.workType===profile.workType && x.unit===profile.unit && x.currency===profile.currency);
        profiles.push({
          ...profile, calibrationId:row.id, approvedBy:row.approved_by, approvedAt:row.approved_at,
          comparison:compareToObserved(profile,match||{dataAvailable:false,weightedRateMinor:null})
        });
      } catch (error) {
        profiles.push({
          calibrationId:row.id, modelKey:row.model_key, modelVersion:row.model_version, parameterKey:row.parameter_key,
          status:'INVALID_STORED_PROFILE', error:String(error && error.code || error && error.message || error), failClosed:true
        });
      }
    }

    return {
      ok:true, model:'commercial.cost', observed, approvedProfiles:profiles, dataAvailable:observed.length>0,
      sourceSnapshot:{capturedAt:utcNow(),tenantScoped:true,tables:['contractor_work_measurements','ftth_work_packages','engineering_calibrations']},
      authority:'DATABASE_BACKED_REAL_COST_CALIBRATION', syntheticData:false, autonomousPriceDecision:false,
      limitations:[
        'Observed rates are weighted from persisted contractor work measurements whose status is verified/approved/invoiced/paid.',
        'Calibration profile validity windows and provenance are stored in engineering_calibrations.provenance.',
        'Approval records are append-only; no production cost is changed by this surface.'
      ]
    };
  });
}

function validateUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
}

async function proposeCostCalibration(db, principal, body) {
  assertDb(db);
  return withPrincipal(db, principal, async client => {
    const t=await tenant(client);
    const workType=String(body?.workType||'').trim().toLowerCase();
    const unit=String(body?.unit||'').trim();
    const currency=String(body?.currency||'').trim().toUpperCase();
    const modelVersion=String(body?.modelVersion||'').trim();
    const sourceRef=String(body?.sourceRef||'').trim();
    if(!workType||!unit||!/^[A-Z]{3}$/.test(currency)||!modelVersion||!sourceRef||body?.valueMinor==null){
      throw Object.assign(new Error('COST_CALIBRATION_PROPOSAL_INVALID'),{statusCode:400,code:'COST_CALIBRATION_PROPOSAL_INVALID'});
    }

    const rows=await costObserved(client,t,workType,unit,currency);
    const observed=weightedObservedRate(rows.map(row=>({quantity:row.quantity,rateMinor:row.rate_minor})));
    if(!observed.dataAvailable) throw Object.assign(new Error('COST_CALIBRATION_NO_OBSERVED_BASIS'),{statusCode:422,code:'COST_CALIBRATION_NO_OBSERVED_BASIS'});

    const profile=normalizeProfile({
      modelKey:'commercial.cost',modelVersion,workType,unit,currency,
      valueMinor:body.valueMinor,stdUncertainty:body.stdUncertainty,
      validMin:body.validMin,validMax:body.validMax,validFrom:body.validFrom,validTo:body.validTo,
      profileKey:body.profileKey||('unit_rate:'+workType+':'+unit+':'+currency),
      sourceRef,
      provenance:provenanceFromProfile({
        modelVersion,workType,unit,currency,validFrom:body.validFrom||null,validTo:body.validTo||null,provenance:body.provenance||{}
      })
    });

    const finalProvenance={
      ...profile.provenance,proposedBy:principal.sub,proposedAt:utcNow(),
      observedQuantity:observed.quantity,observedAmountMinor:observed.amountMinor,
      observedWeightedRateMinor:observed.weightedRateMinor,evidenceClass:'measured'
    };

    const r=await client.query(
      'insert into engineering_calibrations(' +
      'tenant_id,model_key,model_version,parameter_key,value,units,std_uncertainty,valid_min,valid_max,source_ref,provenance,status) ' +
      'values($1,\'commercial.cost\',$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,\'PROPOSED\') ' +
      'returning id,model_key,model_version,parameter_key,status,created_at',
      [t,profile.modelVersion,profile.profileKey,profile.valueMinor,profile.unit,profile.stdUncertainty,
       profile.validMin,profile.validMax,profile.sourceRef,JSON.stringify(finalProvenance)]
    );

    return {
      ok:true,proposal:r.rows[0],observedBasis:observed,
      authority:'DATABASE_BACKED_COST_CALIBRATION_PROPOSAL',syntheticData:false,requiresIndependentApproval:true
    };
  });
}

async function approveCostCalibration(db, principal, body) {
  assertDb(db);
  if(!validateUuid(body?.calibrationId)) throw Object.assign(new Error('CALIBRATION_ID_INVALID'),{statusCode:400,code:'CALIBRATION_ID_INVALID'});
  return withPrincipal(db,principal,async client=>{
    const t=await tenant(client);
    const r=await client.query(
      'select id,model_key,model_version,parameter_key,value,units,std_uncertainty,valid_min,valid_max,source_ref,provenance ' +
      'from engineering_calibrations where id=$1::uuid and tenant_id=$2 and status=\'PROPOSED\'', [body.calibrationId,t]
    );
    if(!r.rows[0]) throw Object.assign(new Error('COST_CALIBRATION_PROPOSAL_NOT_FOUND'),{statusCode:404,code:'COST_CALIBRATION_PROPOSAL_NOT_FOUND'});
    const row=r.rows[0],pv=row.provenance||{};
    const validFrom=pv.validFrom?new Date(pv.validFrom):null;
    const validTo=pv.validTo?new Date(pv.validTo):null;
    if(validFrom&&Number.isNaN(validFrom.getTime())) throw Object.assign(new Error('COST_CALIBRATION_VALID_FROM_INVALID'),{statusCode:422,code:'COST_CALIBRATION_VALID_FROM_INVALID'});
    if(validTo&&Number.isNaN(validTo.getTime())) throw Object.assign(new Error('COST_CALIBRATION_VALID_TO_INVALID'),{statusCode:422,code:'COST_CALIBRATION_VALID_TO_INVALID'});
    if(validFrom&&validTo&&validFrom>=validTo) throw Object.assign(new Error('COST_CALIBRATION_VALIDITY_WINDOW_INVALID'),{statusCode:422,code:'COST_CALIBRATION_VALIDITY_WINDOW_INVALID'});

    const existing=await client.query(
      'select parameter_key,provenance from engineering_calibrations ' +
      'where tenant_id=$1 and model_key=\'commercial.cost\' and model_version=$2 and parameter_key=$3 and status=\'APPROVED\' ',
      [t,row.model_version,row.parameter_key]
    );
    for(const current of existing.rows){
      const cp=current.provenance||{};
      const cFrom=cp.validFrom?new Date(cp.validFrom):new Date('1970-01-01T00:00:00Z');
      const cTo=cp.validTo?new Date(cp.validTo):new Date('9999-12-31T23:59:59Z');
      const pFrom=validFrom||new Date('1970-01-01T00:00:00Z');
      const pTo=validTo||new Date('9999-12-31T23:59:59Z');
      if(Number.isNaN(cFrom.getTime())||Number.isNaN(cTo.getTime())) continue;
      if(pFrom<cTo&&cFrom<pTo) throw Object.assign(new Error('COST_CALIBRATION_VALIDITY_OVERLAP'),{statusCode:409,code:'COST_CALIBRATION_VALIDITY_OVERLAP'});
    }

    const now=utcNow();
    const approvedProv={...pv,approvedBy:principal.sub,approvedAt:now,evidenceClass:'governed_calibration'};
    const insert=await client.query(
      'insert into engineering_calibrations(' +
      'tenant_id,model_key,model_version,parameter_key,value,units,std_uncertainty,valid_min,valid_max,source_ref,provenance,status,approved_by,approved_at) ' +
      'values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,\'APPROVED\',$12::uuid,$13::timestamptz) ' +
      'returning id,status,model_key,model_version,parameter_key,approved_by,approved_at,created_at',
      [t,row.model_key,row.model_version,row.parameter_key,row.value,row.units,row.std_uncertainty,
       row.valid_min,row.valid_max,row.source_ref,JSON.stringify(approvedProv),principal.sub,now]
    );
    return {
      ok:true,proposalId:row.id,approvedProfile:insert.rows[0],
      authority:'DATABASE_BACKED_COST_CALIBRATION_APPROVAL',syntheticData:false,independentApproval:true
    };
  });
}

function validateExtensionManifest(input) {
  const errors=[];
  const p=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  const reqString=(key,max=256)=>{
    const value=String(p[key]??'').trim();
    if(!value) errors.push(key+'_REQUIRED'); else if(value.length>max) errors.push(key+'_TOO_LONG');
  };
  reqString('packageName');reqString('packageVersion');reqString('tenantScope');
  for(const key of ['capabilities','permissions','dependencies']) if(!Array.isArray(p[key])) errors.push(key+'_ARRAY_REQUIRED');
  if(!p.provenance||typeof p.provenance!=='object'||Array.isArray(p.provenance)) errors.push('provenance_REQUIRED');
  if(p.signature!==null&&typeof p.signature!=='object') errors.push('signature_MUST_BE_OBJECT_OR_NULL');
  if(Array.isArray(p.capabilities)&&p.capabilities.some(x=>typeof x!=='string'||!x.trim())) errors.push('capabilities_CONTAIN_INVALID_ENTRY');
  if(Array.isArray(p.permissions)&&p.permissions.some(x=>typeof x!=='string'||!x.trim())) errors.push('permissions_CONTAIN_INVALID_ENTRY');
  if(Array.isArray(p.dependencies)&&p.dependencies.some(x=>!x||typeof x!=='object'||!String(x.packageName||'').trim()||!String(x.versionRange||'').trim())) errors.push('dependencies_CONTAIN_INVALID_ENTRY');
  return {
    valid:errors.length===0,errors,
    package:{packageName:p.packageName||null,packageVersion:p.packageVersion||null,tenantScope:p.tenantScope||null},
    signatureState:p.signature?'PRESENT_BUT_NOT_VERIFIED_BY_REGISTRY_ENDPOINT':'UNSIGNED',
    productionInstallAllowed:false,registryMutation:false,authority:'EXTENSION_CONTRACT_VALIDATOR',
    limitations:['Validation checks contract shape only; cryptographic signature verification, dependency installation and runtime execution remain out of scope.']
  };
}

function extensionRegistry() {
  return {
    ok:true,schemaVersion:EXTENSION_REGISTRY.schemaVersion,registryVersion:EXTENSION_REGISTRY.registryVersion,
    policy:EXTENSION_REGISTRY.policy,
    extensions:Array.isArray(EXTENSION_REGISTRY.extensions)?EXTENSION_REGISTRY.extensions:[],
    authority:'SHIPPED_EXTENSION_CONTRACT_REGISTRY',syntheticData:false,installAuthority:'DISABLED_IN_THIS_RELEASE'
  };
}

async function executiveCommercialReport(db, principal, format='json') {
  assertDb(db);
  return withPrincipal(db,principal,async client=>{
    const t=await tenant(client),generatedAt=utcNow();
    const [operations,finance,incidents,inventory,contractors,costs,network]=await Promise.all([
      client.query(
        'select count(*) filter(where status not in (\'completed\',\'cancelled\',\'rejected\'))::int open_tickets,' +
        'count(*) filter(where status not in (\'completed\',\'cancelled\',\'rejected\') and technician_id is null)::int unassigned_tickets,' +
        'count(*) filter(where sla_deadline is not null and sla_deadline<now() and status not in (\'completed\',\'cancelled\',\'rejected\'))::int overdue_sla,' +
        'count(*) filter(where status=\'completed\' and created_at>=now()-interval \'24 hours\')::int completed_24h ' +
        'from tickets where tenant_id=$1',[t]
      ),
      client.query(
        'select count(*) filter(where status in (\'issued\',\'overdue\',\'partially_paid\'))::int open_invoices,' +
        'coalesce(sum(amount_minor) filter(where status in (\'issued\',\'overdue\',\'partially_paid\')),0)::numeric open_amount_minor,' +
        'count(*) filter(where status=\'overdue\')::int overdue_invoices from invoices where tenant_id=$1',[t]
      ),
      client.query(
        'select count(*) filter(where state not in (\'resolved\',\'closed\'))::int active_incidents,' +
        'count(*) filter(where state not in (\'resolved\',\'closed\') and severity=\'P1\')::int p1_incidents,' +
        'coalesce(sum(affected_customers) filter(where state not in (\'resolved\',\'closed\')),0)::bigint affected_customers ' +
        'from incidents where tenant_id=$1',[t]
      ),
      client.query(
        'select count(*) filter(where quantity_on_hand<=reorder_point)::int reorder_alerts,' +
        'coalesce(sum(quantity_on_hand),0)::numeric quantity_on_hand from inventory_items where tenant_id=$1',[t]
      ),
      client.query(
        'select count(*) filter(where status=\'active\')::int active_contractors,' +
        'count(*) filter(where status in (\'qualified\',\'active\'))::int qualified_contractors ' +
        'from contractor_entities where tenant_id=$1',[t]
      ),
      client.query(
        'select count(*)::int observations,coalesce(sum(quantity*rate_minor),0)::numeric amount_minor,' +
        'coalesce(sum(quantity),0)::numeric quantity from contractor_work_measurements ' +
        'where tenant_id=$1 and status in (\'verified\',\'approved\',\'invoiced\',\'paid\') ' +
        'and measured_at>=now()-interval \'30 days\'',[t]
      ),
      client.query(
        'select count(*)::int assets,coalesce(sum(provisioned_ports),0)::bigint provisioned_ports,' +
        'coalesce(sum(used_ports),0)::bigint used_ports,' +
        'coalesce(sum(over_capacity::int),0)::int over_capacity_assets ' +
        'from network_asset_capacity c join network_assets a on a.id=c.asset_id where a.tenant_id=$1',[t]
      )
    ]);

    const report={
      operations:operations.rows[0],finance:finance.rows[0],incidents:incidents.rows[0],
      inventory:inventory.rows[0],contractor:contractors.rows[0],
      contractorMeasuredCost30d:costs.rows[0],network:network.rows[0]
    };
    const reportId=sha256({tenantScoped:true,generatedAt,report});
    const result={
      ok:true,reportId,generatedAt,
      sourceSnapshot:{
        capturedAt:generatedAt,tenantScoped:true,queryScope:'CURRENT_DATABASE_STATE_AT_QUERY_TIME',
        tables:['tickets','invoices','incidents','inventory_items','contractor_entities','contractor_work_measurements','network_asset_capacity','network_assets']
      },
      report,authority:'DATABASE_BACKED_EXECUTIVE_COMMERCIAL_REPORT',syntheticData:false,autonomousDecision:false,
      limitations:[
        'The report summarizes persisted operational, financial, SLA, incident, inventory, contractor and network facts.',
        'It does not predict future financial or outage outcomes and does not issue commands.'
      ]
    };
    if(format==='json') return {...result,reportFormat:'json'};
    if(format!=='csv') throw Object.assign(new Error('REPORT_FORMAT_INVALID'),{statusCode:400,code:'REPORT_FORMAT_INVALID'});
    const rows=[['section','metric','value']];
    for(const [section,obj] of Object.entries(report)) for(const [metric,value] of Object.entries(obj||{})) rows.push([section,metric,value]);
    return {...result,reportFormat:'csv',csv:rows.map(row=>row.map(csvValue).join(',')).join('\n')+'\n'};
  });
}

async function handleCommercialSurfaces(req,res,ctx) {
  const {method,path,principal,db,send,body}=ctx;
  if(path==='/v1/noc/3d/scene'&&method==='GET'){
    const a=auth(principal,MANAGEMENT_ROLES);if(!a.ok)return send(res,a.status,a.body);
    try{return send(res,200,await buildNoc3dScene(db,principal));}
    catch(e){return send(res,e.statusCode||500,{ok:false,error:e.code||e.message||'NOC_3D_ERROR',authority:'DATABASE_BACKED_NOC_3D_READ_ONLY'});}
  }
  if(path==='/v1/gis/twin/simulate'&&method==='POST'){
    const a=auth(principal,MANAGEMENT_ROLES);if(!a.ok)return send(res,a.status,a.body);
    try{return send(res,200,await databaseSimulation(db,principal,body));}
    catch(e){return send(res,e.statusCode||422,{ok:false,error:e.code||e.message||'DATABASE_SIMULATION_ERROR',authority:'DATABASE_BACKED_DETERMINISTIC_SIMULATION'});}
  }
  if(path==='/v1/commercial/cost-calibration'&&method==='GET'){
    const a=auth(principal,COST_READ_ROLES);if(!a.ok)return send(res,a.status,a.body);
    try{return send(res,200,await costCalibrationRead(db,principal));}
    catch(e){return send(res,e.statusCode||500,{ok:false,error:e.code||e.message||'COST_CALIBRATION_ERROR',authority:'DATABASE_BACKED_REAL_COST_CALIBRATION'});}
  }
  if(path==='/v1/commercial/cost-calibration/propose'&&method==='POST'){
    const a=auth(principal,['ops_manager','area_supervisor','cfo','exec','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return send(res,201,await proposeCostCalibration(db,principal,body));}
    catch(e){return send(res,e.statusCode||422,{ok:false,error:e.code||e.message||'COST_CALIBRATION_PROPOSAL_ERROR',authority:'DATABASE_BACKED_COST_CALIBRATION_PROPOSAL'});}
  }
  if(path==='/v1/commercial/cost-calibration/approve'&&method==='POST'){
    const a=auth(principal,['ops_manager','area_supervisor','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    try{return send(res,201,await approveCostCalibration(db,principal,body));}
    catch(e){return send(res,e.statusCode||422,{ok:false,error:e.code||e.message||'COST_CALIBRATION_APPROVAL_ERROR',authority:'DATABASE_BACKED_COST_CALIBRATION_APPROVAL'});}
  }
  if(path==='/v1/extensions/registry'&&method==='GET'){
    const a=auth(principal,MANAGEMENT_ROLES);if(!a.ok)return send(res,a.status,a.body);
    return send(res,200,extensionRegistry());
  }
  if(path==='/v1/extensions/validate'&&method==='POST'){
    const a=auth(principal,MANAGEMENT_ROLES);if(!a.ok)return send(res,a.status,a.body);
    return send(res,200,validateExtensionManifest(body));
  }
  if(path==='/v1/executive/commercial-report'&&method==='GET'){
    const a=auth(principal,['exec','cfo','ops_manager','area_supervisor','sysadmin']);if(!a.ok)return send(res,a.status,a.body);
    const format=String(new URL(req.url||'/','http://fiberos.local').searchParams.get('format')||'json').toLowerCase();
    try{
      const out=await executiveCommercialReport(db,principal,format);
      if(format==='csv'){
        res.setHeader('content-type','text/csv; charset=utf-8');
        res.setHeader('content-disposition','attachment; filename="fiberos-executive-commercial-report.csv"');
        return res.end(out.csv);
      }
      return send(res,200,out);
    }catch(e){return send(res,e.statusCode||500,{ok:false,error:e.code||e.message||'EXECUTIVE_COMMERCIAL_REPORT_ERROR',authority:'DATABASE_BACKED_EXECUTIVE_COMMERCIAL_REPORT'});}
  }
  return null;
}

module.exports=Object.freeze({
  handleCommercialSurfaces,buildNoc3dScene,databaseSimulation,costCalibrationRead,
  proposeCostCalibration,approveCostCalibration,validateExtensionManifest,extensionRegistry,executiveCommercialReport
});
