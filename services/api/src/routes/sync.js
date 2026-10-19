'use strict';
const {createEnvelope,validateEnvelope}=require('../../../../packages/sync/src');
const {withPrincipal}=require('../../../../packages/db/src/session');

async function handleSyncBatch(body,principal,db){
 const ops=Array.isArray(body&&body.operations)?body.operations:[];
 if(!ops.length)return {status:400,body:{ok:false,error:'OPERATIONS_REQUIRED'}};
 if(ops.length>100)return {status:413,body:{ok:false,error:'BATCH_TOO_LARGE',max:100}};

 const envelopes=[];
 for(const op of ops){
  try{
   if(!op || !op.requestHash) return {status:422,body:{ok:false,error:'SYNC_REQUEST_HASH_REQUIRED'}};
   const e=createEnvelope(op);
   const supplied=String(op.requestHash).toLowerCase();
   if(supplied!==e.requestHash)return {status:409,body:{ok:false,error:'SYNC_REQUEST_HASH_MISMATCH'}};
   const v=validateEnvelope(e);
   if(!v.ok)return {status:422,body:{ok:false,error:'SYNC_ENVELOPE_INVALID',detail:v}};
   envelopes.push(e);
  }catch(e){
   return {status:422,body:{ok:false,error:'SYNC_ENVELOPE_INVALID'}};
  }
 }

 if(!db||!db.configured){
  return {status:503,body:{ok:false,error:'DATABASE_REQUIRED_FOR_SYNC_EXECUTION',authority:'NO_DB_NO_SYNC_ACK',accepted:false}};
 }

 try{
  const result=await withPrincipal(db,principal,async function(client){
   return client.query('select fiberos_ingest_sync_batch($1::jsonb,$2::jsonb) as result',[JSON.stringify(envelopes),JSON.stringify({sub:principal.sub,role:principal.role})]);
  });
  const resultBody=result.rows[0]&&result.rows[0].result;
  return {status:200,body:{ok:true,persisted:true,authority:'DB_AUTHORITATIVE',result:resultBody||null}};
 }catch(e){
  if(e.code==='TENANT_CONTEXT_REQUIRED'||e.message==='TENANT_CONTEXT_REQUIRED')return {status:403,body:{ok:false,error:'TENANT_CONTEXT_REQUIRED'}};
  return {status:500,body:{ok:false,error:'SYNC_PERSISTENCE_FAILED'}};
 }
}
module.exports={handleSyncBatch};
