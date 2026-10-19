const $=id=>document.getElementById(id);
function base(){try{return window.FiberOSApiOrigin.normalizeApiBase(localStorage.getItem('fiberos_api')||location.origin,location.href,window.__FIBEROS_ALLOWED_API_ORIGINS__||[])}catch(error){return location.origin}}
function authHeaders(method){const h={'Content-Type':'application/json'};try{const csrf=window.FiberOSSessionAuth?window.FiberOSSessionAuth.getCsrfToken():'';if(csrf&&!['GET','HEAD','OPTIONS'].includes(String(method||'GET').toUpperCase()))h['X-FiberOS-CSRF']=csrf}catch(_){}return h}
async function get(p){const target=window.FiberOSApiOrigin.resolveApiUrl(base(),p);const r=await fetch(target,{headers:authHeaders('GET'),credentials:'include',redirect:'error',cache:'no-store'});if(!r.ok)throw Error('HTTP_'+r.status);return r.json()}
function escapeHtml(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')}

function metric(k,v){return '<div class="metric"><span class="muted">'+escapeHtml(k)+'</span><span>'+escapeHtml(v??'—')+'</span></div>'}
function showUnavailable(id,error){const n=$(id);if(n)n.textContent='UNAVAILABLE · '+String(error||'LIVE_DATA_UNAVAILABLE')}
function govStat(id,value){const n=$(id);if(n)n.textContent=(value===null||value===undefined||value==='')?'—':String(value)}
async function refreshGovernance(){
  const jobs=[
    ['audit','/v1/audit/events'],
    ['notifications','/v1/notifications/center'],
    ['migration','/v1/migration-center/overview'],
    ['workflows','/v1/workflows/overview'],
    ['rbac','/v1/security/rbac/effective'],
    ['contractors','/v1/subcontractors/overview'],
    ['inventory','/v1/smart-inventory/overview'],
    ['workload','/v1/operations/workload-balance'],
    ['timeline','/v1/operations/timeline'],
    ['security','/v1/security/zero-trust/readiness'],
    ['organization','/v1/organization/operating-model'],
    ['contactLanguages','/v1/contact-center/languages']
  ];
  const settled=await Promise.allSettled(jobs.map(x=>get(x[1])));
  const data={};
  settled.forEach((result,index)=>{data[jobs[index][0]]=result.status==='fulfilled'?result.value:{error:result.reason&&result.reason.message||'REQUEST_FAILED'}});
  if(data.audit.error){showUnavailable('govAuditCount',data.audit.error);showUnavailable('govAuditMeta',data.audit.error)}
  else {govStat('govAuditCount',(data.audit.events||[]).length);$('govAuditMeta').textContent='Authority: '+String(data.audit.authority||'—')+' · Immutable: '+String(data.audit.immutableSource)}
  if(data.notifications.error){showUnavailable('govNotificationCount',data.notifications.error);showUnavailable('govNotificationMeta',data.notifications.error)}
  else {govStat('govNotificationCount',(data.notifications.notifications||[]).length);$('govNotificationMeta').textContent='Authority: '+String(data.notifications.authority||'—')+' · Delivery: '+String(data.notifications.deliveryAuthority||'—')}
  if(data.migration.error){showUnavailable('govMigrationCount',data.migration.error);showUnavailable('govMigrationMeta',data.migration.error)}
  else {const d=data.migration.deadlines||{};govStat('govMigrationCount',d.total_migrations);$('govMigrationMeta').textContent='Overdue: '+String(d.overdue??'—')+' · Due ≤24h: '+String(d.due_within_24h??'—')}
  if(data.rbac.error){showUnavailable('govRbacCount',data.rbac.error);showUnavailable('govRbacMeta',data.rbac.error)}
  else {govStat('govRbacCount',(data.rbac.positions||[]).length);$('govRbacMeta').textContent='Authority: '+String(data.rbac.authority||'—')}
  if(data.contractors.error){showUnavailable('govContractorCount',data.contractors.error);showUnavailable('govContractorMeta',data.contractors.error)}
  else {const rows=data.contractors.contractors?.byStatus||[];govStat('govContractorCount',rows.reduce((n,x)=>n+Number(x.count||0),0));$('govContractorMeta').textContent='Statuses: '+rows.map(x=>String(x.status)+':'+String(x.count)).join(' · ')}
  if(data.inventory.error){showUnavailable('govInventoryCount',data.inventory.error);showUnavailable('govInventoryMeta',data.inventory.error)}
  else {govStat('govInventoryCount',data.inventory.inventory?.items);$('govInventoryMeta').textContent='Reorder alerts: '+String(data.inventory.inventory?.reorder_alerts??'—')+' · Reservations: '+String(data.inventory.activeReservations??'—')}
  if(data.workload.error){showUnavailable('govWorkloadCount',data.workload.error);showUnavailable('govWorkloadMeta',data.workload.error)}
  else {govStat('govWorkloadCount',(data.workload.workers||[]).length);const dist=data.workload.distribution||{};$('govWorkloadMeta').textContent='LOW: '+String(dist.LOW??0)+' · MEDIUM: '+String(dist.MEDIUM??0)+' · HIGH: '+String(dist.HIGH??0)}
  if(data.security.error){showUnavailable('govSecurityPosture',data.security.error);showUnavailable('govSecurityMeta',data.security.error)}
  else {govStat('govSecurityPosture',data.security.posture);$('govSecurityMeta').textContent='Runtime evidence: '+String((data.security.productionEvidenceStillRequired||[]).length)+' pending class(es)'}
  if(data.organization.error){showUnavailable('govOrgState',data.organization.error);showUnavailable('govOrgMeta',data.organization.error)}
  else {
    const os=data.organization.summary||{};
    govStat('govOrgState',String(os.sourceIntegrationComplete??0)+' / '+String(data.organization.canonicalDepartmentCount??0));
    $('govOrgMeta').textContent='Partial: '+String(os.partiallyProvisioned??0)+' · Unmapped: '+String(os.unmappedDepartments??0)+' · Active tenant departments: '+String(data.organization.departmentCount??0);
  }
  if(data.contactLanguages.error){showUnavailable('govCcLanguages',data.contactLanguages.error);showUnavailable('govCcMeta',data.contactLanguages.error)}
  else {
    govStat('govCcLanguages',data.contactLanguages.languageCount);
    $('govCcMeta').textContent='Dialect: '+String(data.contactLanguages.dialectPolicy||'—')+' · Voice: '+String(data.contactLanguages.voicePolicy||'—')+' · Runtime: '+String(data.contactLanguages.runtimeVerification||'—');
  }
  if(data.timeline.error)showUnavailable('govTimeline',data.timeline.error);
  else if(data.workflows.error)showUnavailable('govTimeline',data.workflows.error);
  else $('govTimeline').textContent=JSON.stringify({
    workflowEngine:data.workflows.workflowEngine||null,
    timeline:data.timeline.entries||[],
    timelineAuthority:data.timeline.authority||null
  },null,2);
  return data;
}

function roomCard(title,data){const rows=Object.entries(data||{}).map(([k,v])=>metric(k,v)).join('');return '<article class="room"><h3>'+escapeHtml(title)+'</h3>'+rows+'</article>'}
function renderRooms(d){
  const r=d.rooms||{},cc=r.contactCenter||{},net=r.network||{},field=r.fieldOperations||{},s=r.supplyChain||{},cr=r.crisisExecutive||{};
  $('ccQueued').textContent=cc.queued??'—';$('ccMeta').textContent='Active: '+(cc.active??'—')+' · Agents available: '+(cc.agents?.available??'—');
  $('mapped').textContent=net.mapped_assets??'—';$('netMeta').textContent='Assets: '+(net.assets??'—')+' · Incidents: '+(net.active_incidents??'—');
  $('warehouses').textContent=s.active_warehouses??'—';$('whMeta').textContent='Bins: '+(s.active_bins??'—')+' · Reservations: '+(s.activeReservations??'—');
  $('unassigned').textContent=field.unassigned_tickets??'—';$('fieldMeta').textContent='Tracked: '+(field.tracked_technicians??'—')+' · Dispatch: '+(field.pending_dispatch??'—');
  $('p1').textContent=cr.p1_incidents??'—';$('crisisMeta').textContent='Affected customers: '+(cr.affected_customers??'—');
  $('rooms').innerHTML=[roomCard('Contact Center',{queued:cc.queued,active:cc.active,abandoned:cc.abandoned,availableAgents:cc.agents?.available}),
    roomCard('Network / GIS',{assets:net.assets,mappedAssets:net.mapped_assets,activeIncidents:net.active_incidents,openTickets:net.open_tickets}),
    roomCard('Field Operations',{technicians:field.technicians,tracked:field.tracked_technicians,unassigned:field.unassigned_tickets,pendingDispatch:field.pending_dispatch}),
    roomCard('Supply Chain',{activeWarehouses:s.active_warehouses,activeBins:s.active_bins,items:s.items,activeReservations:s.activeReservations,pendingTransfers:s.pendingTransfers}),
    roomCard('Crisis / Executive',{activeIncidents:cr.active_incidents,p1Incidents:cr.p1_incidents,affectedCustomers:cr.affected_customers})].join('');
  $('out').textContent=JSON.stringify(d,null,2);
  $('truth').textContent=(d.dataDegraded?'Some room readings are degraded; unavailable data is not shown as zero. ':'')+'Authority: '+d.authority+' · Synthetic data: '+d.syntheticData+' · External runtime connected: '+d.externalRuntimeConnected;
}
function renderMap(d){
  const l=d.layers||{}, pts=[];
  (l.assets||[]).forEach(x=>pts.push({lat:Number(x.latitude),lon:Number(x.longitude),kind:'asset',label:x.asset_code||x.id}));
  (l.technicians||[]).forEach(x=>pts.push({lat:Number(x.latitude),lon:Number(x.longitude),kind:'tech',label:x.name||x.technician_id}));
  (l.tickets||[]).forEach(x=>pts.push({lat:Number(x.latitude),lon:Number(x.longitude),kind:'ticket',label:x.type||x.id}));
  const good=pts.filter(x=>Number.isFinite(x.lat)&&Number.isFinite(x.lon)); if(!good.length){$('map').innerHTML='<svg viewBox="0 0 1200 420"><rect width="1200" height="420" fill="#08131b"/><text x="600" y="210" text-anchor="middle" fill="#91a8b5">No spatial points are currently available</text></svg>';$('mapMeta').textContent='No spatial points returned.';return}
  let minLat=Math.min(...good.map(x=>x.lat)),maxLat=Math.max(...good.map(x=>x.lat)),minLon=Math.min(...good.map(x=>x.lon)),maxLon=Math.max(...good.map(x=>x.lon));
  const padLat=Math.max((maxLat-minLat)*0.08,0.002),padLon=Math.max((maxLon-minLon)*0.08,0.002);minLat-=padLat;maxLat+=padLat;minLon-=padLon;maxLon+=padLon;
  const color={asset:'#56b4e9',tech:'#63e6be',ticket:'#ffcf70'};const circles=good.map(x=>{const px=40+((x.lon-minLon)/(maxLon-minLon))*1120,py=390-((x.lat-minLat)/(maxLat-minLat))*360;return '<circle class="dot" cx="'+px.toFixed(1)+'" cy="'+py.toFixed(1)+'" r="'+(x.kind==='asset'?4:x.kind==='tech'?6:5)+'" fill="'+color[x.kind]+'"><title>'+escapeHtml(x.label)+'</title></circle>'}).join('');
  $('map').innerHTML='<svg viewBox="0 0 1200 420" aria-label="FiberOS operational spatial view"><rect width="1200" height="420" fill="#08131b"/><path d="M40 390H1160M40 210H1160M40 30H1160" stroke="#18303b" stroke-width="1"/><path d="M40 30V390M320 30V390M600 30V390M880 30V390M1160 30V390" stroke="#18303b" stroke-width="1"/>'+circles+'</svg>';
  $('mapMeta').textContent='Spatial points: '+good.length+' · assets '+(l.assets?.length||0)+' · technicians '+(l.technicians?.length||0)+' · tickets '+(l.tickets?.length||0)+' · source '+d.authority;
}
async function refreshAll(){
  try{
    const [rooms,map]=await Promise.all([get('/v1/command/rooms/overview'),get('/v1/gis/fusion/layers')]);
    renderRooms(rooms);renderMap(map);
    const c=rooms.rooms?.contactCenter||{},s=rooms.rooms?.supplyChain||{},n=rooms.rooms?.network||{},f=rooms.rooms?.fieldOperations||{};
    $('call').innerHTML=metric('Queue',c.queued)+metric('Active calls',c.active)+metric('Abandoned 24h',c.abandoned)+metric('Agents available',c.agents?.available);
    $('supply').innerHTML=metric('Active warehouses',s.active_warehouses)+metric('Active bins',s.active_bins)+metric('Items',s.items)+metric('Reservations',s.activeReservations)+metric('Transfers pending',s.pendingTransfers);
    $('network').innerHTML=metric('Mapped assets',n.mapped_assets)+metric('Active incidents',n.active_incidents)+metric('Open tickets',n.open_tickets);
    $('field').innerHTML=metric('Technicians',f.technicians)+metric('Tracked',f.tracked_technicians)+metric('Unassigned',f.unassigned_tickets)+metric('Pending dispatch',f.pending_dispatch);
  }catch(e){$('out').textContent='LIVE_DATA_UNAVAILABLE: '+e.message}
  try{await refreshGovernance()}catch(e){$('out').textContent='GOVERNANCE_DATA_UNAVAILABLE: '+e.message}
}
async function apiHealth(){try{$('out').textContent=JSON.stringify(await get('/health'),null,2)}catch(e){$('out').textContent='HEALTH_UNAVAILABLE: '+e.message}}
refreshAll();
window.refreshGovernance=refreshGovernance;

document.addEventListener('click',event=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;if(!['refreshAll','refreshGovernance','apiHealth'].includes(action)||typeof window[action]!=='function')return;Promise.resolve(window[action]()).catch(error=>{$('out').textContent='ACTION_FAILED: '+String(error&&error.message||error)})});
