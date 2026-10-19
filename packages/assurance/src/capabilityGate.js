'use strict';
const NON_OPERATIONAL = new Set(['UNIMPLEMENTED','VISION']);
function normalizePath(p){ return String(p || '/').split('?')[0].replace(/\/+$/, '') || '/'; }
function buildRouteStatusIndex(entries){
  const index = new Map();
  for(const entry of entries || []){
    const status = String(entry && entry.status || 'UNIMPLEMENTED');
    for(const surface of (entry && entry.serverSurfaces) || []){
      const m=String(surface).match(/^(GET|POST|PUT|PATCH|DELETE|OPTIONS)\s+(\S+)$/i);
      if(!m) continue;
      index.set(`${m[1].toUpperCase()} ${normalizePath(m[2])}`, {id:String(entry.id),name:String(entry.name),status});
    }
  }
  return index;
}
function checkCapabilityRoute(index, method, path){
  const hit=index.get(`${String(method||'GET').toUpperCase()} ${normalizePath(path)}`);
  if(hit && NON_OPERATIONAL.has(hit.status)) return {ok:false,status:501,body:{ok:false,error:'NOT_IMPLEMENTED',status:hit.status,capabilityId:hit.id,capability:hit.name,authority:'CAPABILITY_STATUS_GATE'}};
  return {ok:true};
}
module.exports={NON_OPERATIONAL,buildRouteStatusIndex,checkCapabilityRoute};
