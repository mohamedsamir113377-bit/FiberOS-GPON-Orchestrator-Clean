'use strict';

const { withPrincipal } = require('../../../../packages/db/src/session');
const { readBody } = require('../http');
const { otdrChainToMapQuery } = require('../../../../packages/sovereign-gis/src/linearMeasurePolicy');
const { readMvt, readSpatialImpact } = require('../../../../packages/sovereign-gis/src/db');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');

const GIS_ROLES=['call_center','dispatcher','qc','ops_manager','area_supervisor','exec','sysadmin'];

function bad(code,status=400){const e=new Error(code);e.code=code;e.statusCode=status;throw e;}
function dbRequired(db){if(!db||!db.configured)bad('DATABASE_REQUIRED',503);}
function bboxValue(v,name,min,max){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)bad(name+'_INVALID');return n;}
function validateBbox(url){
  const minLon=bboxValue(url.searchParams.get('minLon'),'MIN_LON',-180,180);
  const minLat=bboxValue(url.searchParams.get('minLat'),'MIN_LAT',-90,90);
  const maxLon=bboxValue(url.searchParams.get('maxLon'),'MAX_LON',-180,180);
  const maxLat=bboxValue(url.searchParams.get('maxLat'),'MAX_LAT',-90,90);
  if(minLon>=maxLon||minLat>=maxLat)bad('GIS_BBOX_INVALID');
  if((maxLon-minLon)*(maxLat-minLat)>400)bad('GIS_BBOX_TOO_LARGE',413);
  return {minLon,minLat,maxLon,maxLat};
}
function pointRow(r,kind){if(r.lat==null||r.lon==null)return null;const properties={...r};delete properties.lat;delete properties.lon;return {type:'Feature',id:r.id,properties:{...properties,kind},geometry:{type:'Point',coordinates:[Number(r.lon),Number(r.lat)]}};}
function lineRow(r,kind){if(!r.geometry)return null;const properties={...r};delete properties.geometry;return {type:'Feature',id:r.id,properties:{...properties,kind},geometry:r.geometry};}
async function vectorTile(db,principal,layer,z,x,y){
  dbRequired(db);
  const allowed=new Set(['network_asset','fiber_cable','duct','evidence','technician_position','technician','fault','installation','ticket_location']);
  if(!allowed.has(String(layer||'').toLowerCase()))bad('GIS_LAYER_NOT_ALLOWED');
  const n=[z,x,y].map(Number);
  if(n.some(v=>!Number.isInteger(v)||v<0)||n[0]>24||n[1]>=2**n[0]||n[2]>=2**n[0])bad('GIS_TILE_COORDINATE_INVALID');
  return withPrincipal(db,principal,client=>readMvt(client,{layer:String(layer).toLowerCase(),z:n[0],x:n[1],y:n[2]}));
}
async function technicianTrack(db,principal,url){
 dbRequired(db);
 const technicianId=String(url.searchParams.get('technicianId')||'');
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(technicianId))bad('TECHNICIAN_ID_INVALID');
 const rawMaxPoints=Number(url.searchParams.get('maxPoints')||2000);if(!Number.isInteger(rawMaxPoints))bad('MAX_POINTS_INVALID');const maxPoints=Math.min(5000,Math.max(2,rawMaxPoints));
 const toRaw=url.searchParams.get('to'),fromRaw=url.searchParams.get('from');
 const to=toRaw?new Date(toRaw):new Date(),from=fromRaw?new Date(fromRaw):new Date(to.getTime()-24*3600000);
 if(Number.isNaN(from.getTime())||Number.isNaN(to.getTime())||from>=to)bad('TRACK_TIME_RANGE_INVALID');
 if(to.getTime()-from.getTime()>31*24*3600000)bad('TRACK_RANGE_TOO_LARGE',413);
 return withPrincipal(db,principal,async client=>{
  const r=await client.query(`select p.id,p.captured_at,p.accuracy_meters,p.heading_degrees,p.speed_mps,p.source,ST_X(p.position::geometry) lon,ST_Y(p.position::geometry) lat
    from technician_positions p join technicians t on t.id=p.technician_id
    where p.technician_id=$1 and p.captured_at between $2 and $3 and p.position is not null
      and t.is_active=true
    order by p.captured_at,p.id
    limit $4`,[technicianId,from,to,maxPoints]);
  const coords=r.rows.filter(x=>x.lon!=null&&x.lat!=null).map(x=>[Number(x.lon),Number(x.lat)]);
  return {ok:true,technicianId,from:from.toISOString(),to:to.toISOString(),pointCount:coords.length,
    track:coords.length>=2?{type:'Feature',properties:{kind:'TECHNICIAN_TRACK',pointCount:coords.length},geometry:{type:'LineString',coordinates:coords}}:null,
    points:r.rows,syntheticData:false,authority:'DATABASE_BACKED_TECHNICIAN_HISTORY'};
 });
}
async function deepSnapshot(db,principal,url){
  dbRequired(db);const box=validateBbox(url);
  return withPrincipal(db,principal,async client=>{
    const row=(await client.query('select tenant_id from user_preferences where user_id=auth.uid() limit 1')).rows[0];
    if(!row?.tenant_id)bad('TENANT_CONTEXT_REQUIRED',403);
    const v=[box.minLon,box.minLat,box.maxLon,box.maxLat,row.tenant_id];
    const env='ST_MakeEnvelope($1,$2,$3,$4,4326)';
    const [tech,inst,fault,assets,fiber,duct,evidence]=await Promise.all([
      client.query('select count(*)::bigint count from fiberos_current_technician_gis t where t.tenant_id=$5 and t.position && '+env+'::geography',v),
      client.query("select count(*)::bigint count from installation_jobs where tenant_id=$5 and site_location && "+env+"::geography and status not in ('COMPLETED','CANCELLED','REJECTED')",v),
      client.query("select count(*)::bigint count from fault_jobs where tenant_id=$5 and site_location && "+env+"::geography and status not in ('RESOLVED','CANCELLED','REJECTED')",v),
      client.query('select count(*)::bigint count from network_assets where tenant_id=$5 and gps is not null and gps && '+env+'::geography',v),
      client.query('select count(*)::bigint count from ftth_cable_segments where tenant_id=$5 and geometry is not null and geometry && '+env,v),
      client.query('select count(*)::bigint count from ftth_duct_segments where tenant_id=$5 and geometry is not null and geometry && '+env,v),
      client.query('select count(*)::bigint count from ftth_construction_evidence where tenant_id=$5 and gps is not null and gps && '+env+'::geography',v)
    ]);
    const counts={
      technicians:Number(tech.rows[0]?.count||0),
      installations:Number(inst.rows[0]?.count||0),
      faults:Number(fault.rows[0]?.count||0),
      assets:Number(assets.rows[0]?.count||0),
      fiber:Number(fiber.rows[0]?.count||0),
      duct:Number(duct.rows[0]?.count||0),
      evidence:Number(evidence.rows[0]?.count||0)
    };
    return {ok:true,generatedAt:new Date().toISOString(),bbox:box,counts,syntheticData:false,authority:'DATABASE_BACKED_DEEP_GIS',limitedToTenant:true};
  });
}
async function handleDeepGis(req,res,ctx){
 const {method,path,principal,db,send}=ctx;

 if(method==='POST' && path==='/v1/gis/otdr-chain-to-map'){
  const a=requireVerifiedPrincipal(principal,process.env);if(!a.ok)return send(res,a.status,a.body);
  const g=requireAnyRole(principal,[...GIS_ROLES,'technician','team_lead','fiber_splicer','welder','cable_worker']);if(!g.ok)return send(res,g.status,g.body);
  try{
   dbRequired(db);
   const body=await readBody(req);
   const query=otdrChainToMapQuery(body||{});
   return await withPrincipal(db,principal,async client=>{
    const result=await client.query(query.text,query.values);
    const row=result.rows&&result.rows[0];
    if(!row)return send(res,503,{ok:false,error:'OTDR_CHAIN_RESULT_UNAVAILABLE',authority:'DATABASE_BACKED_OTDR_CHAIN_MEASURE'});
    const located=row.status==='LOCATED'&&Number.isFinite(Number(row.lat))&&Number.isFinite(Number(row.lon));
    return send(res,located?200:422,{ok:located,authority:'DATABASE_BACKED_OTDR_CHAIN_MEASURE',syntheticData:false,calibrationBoundary:'REQUIRES_REVIEWED_AS_BUILT_CHAIN',...row,metadata:query.meta});
   });
  }catch(e){
   const status=Number.isInteger(e.statusCode)?e.statusCode:500;
   return send(res,status,{ok:false,error:status<500?(e.code||e.message||'OTDR_CHAIN_INPUT_INVALID'):'OTDR_CHAIN_MAP_FAILED',authority:'DATABASE_BACKED_OTDR_CHAIN_MEASURE'});
  }
 }
 if(method==='GET'){const tm=String(path).match(/^\/v1\/gis\/tiles\/([a-z_]+)\/(\d+)\/(\d+)\/(\d+)\.pbf$/);if(tm){const a=requireVerifiedPrincipal(principal,process.env);if(!a.ok)return send(res,a.status,a.body);const g=requireAnyRole(principal,GIS_ROLES);if(!g.ok)return send(res,g.status,g.body);try{const tile=await vectorTile(db,principal,tm[1],Number(tm[2]),Number(tm[3]),Number(tm[4]));res.writeHead(200,{'content-type':'application/vnd.mapbox-vector-tile','cache-control':'private, no-store','content-encoding':'identity'});return res.end(tile)}catch(e){return send(res,e.statusCode||400,{ok:false,error:e.code||e.message||'GIS_TILE_ERROR',authority:'DATABASE_BACKED_GIS'})}}
  if(path==='/v1/gis/technician-track'){const a=requireVerifiedPrincipal(principal,process.env);if(!a.ok)return send(res,a.status,a.body);const g=requireAnyRole(principal,GIS_ROLES);if(!g.ok)return send(res,g.status,g.body);try{return send(res,200,await technicianTrack(db,principal,new URL(req.url,'http://localhost')))}catch(e){return send(res,e.statusCode||400,{ok:false,error:e.code||e.message||'TECHNICIAN_TRACK_ERROR',authority:'DATABASE_BACKED_GIS'})}}
 }
 if(method!=='GET'||path!=='/v1/gis/deep-snapshot')return null;
 const a=requireVerifiedPrincipal(principal,process.env);if(!a.ok)return send(res,a.status,a.body);
 const g=requireAnyRole(principal,GIS_ROLES);if(!g.ok)return send(res,g.status,g.body);
 try{return send(res,200,await deepSnapshot(db,principal,new URL(req.url,'http://localhost')))}catch(e){return send(res,e.statusCode||400,{ok:false,error:e.code||e.message||'DEEP_GIS_ERROR',authority:'DATABASE_BACKED_DEEP_GIS'})}
}
module.exports={handleDeepGis,validateBbox};