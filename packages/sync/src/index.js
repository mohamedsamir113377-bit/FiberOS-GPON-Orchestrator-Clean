'use strict';
const crypto=require('crypto');
function stable(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(stable).join(',')+']';return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';}
function hash(v){return crypto.createHash('sha256').update(stable(v),'utf8').digest('hex');}
const ALLOWED=['PENDING','SENDING','ACKED','REJECTED','CONFLICT'];
function createEnvelope(input){
 input=input||{}; if(!input.clientId)throw new Error('CLIENT_ID_REQUIRED'); if(!input.operationId)throw new Error('OPERATION_ID_REQUIRED'); if(!input.type)throw new Error('OPERATION_TYPE_REQUIRED');
 const baseVersion = input.baseVersion == null ? null : input.baseVersion;
 if(baseVersion !== null && (!Number.isSafeInteger(baseVersion) || baseVersion < 0)) throw new Error('SYNC_BASE_VERSION_INVALID');
 const payload={schemaVersion:'1',clientId:String(input.clientId),operationId:String(input.operationId),type:String(input.type),aggregateType:input.aggregateType||null,aggregateId:input.aggregateId||null,baseVersion,payload:input.payload||{},createdAt:input.createdAt||new Date().toISOString()};
 return Object.freeze({...payload,requestHash:hash(payload),status:'PENDING'});
}
function hasTenantAuthorityField(v){
 if(v===null||typeof v!=='object')return false;
 if(Array.isArray(v))return v.some(hasTenantAuthorityField);
 return Object.entries(v).some(([k,val])=>k==='tenantId'||k==='tenant_id'||hasTenantAuthorityField(val));
}
function validateEnvelope(e){
 if(!e||typeof e!=='object')return {ok:false,reason:'ENVELOPE_REQUIRED'};
 if(hasTenantAuthorityField(e.payload))return {ok:false,reason:'CLIENT_TENANT_AUTHORITY_FORBIDDEN'};
 if(e.baseVersion != null && (!Number.isSafeInteger(e.baseVersion) || e.baseVersion < 0))return {ok:false,reason:'SYNC_BASE_VERSION_INVALID'};
 if(e.status != null && e.status !== 'PENDING')return {ok:false,reason:'CLIENT_STATUS_FORBIDDEN'};
 if(!e.requestHash)return {ok:false,reason:'REQUEST_HASH_REQUIRED'};
 const copy={...e}; delete copy.requestHash; delete copy.status;
 const calculated=hash(copy); if(calculated!==e.requestHash)return {ok:false,reason:'REQUEST_HASH_MISMATCH',calculated};
 if(!e.clientId||!e.operationId||!e.type)return {ok:false,reason:'IDENTITY_FIELDS_REQUIRED'};
 return {ok:true};
}
function transition(current,next){if(!ALLOWED.includes(next))throw new Error('SYNC_STATUS_INVALID'); const edges={PENDING:['SENDING','REJECTED'],SENDING:['ACKED','REJECTED','CONFLICT'],CONFLICT:['PENDING','REJECTED'],ACKED:[],REJECTED:[]}; if(!edges[current]||!edges[current].includes(next))throw new Error('SYNC_TRANSITION_INVALID'); return next;}
module.exports={stable,hash,ALLOWED,createEnvelope,validateEnvelope,transition,hasTenantAuthorityField};
