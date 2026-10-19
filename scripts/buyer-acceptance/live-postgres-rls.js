'use strict';
const assert=require('node:assert/strict');
const {createPool}=require('../../packages/db/src');
const {withPrincipal}=require('../../packages/db/src/session');
const {verifyRuntimeGate}=require('../../packages/db/src/runtimeGate');
const {handleTicketTransition}=require('../../services/api/src/routes/tickets');
const {handleFieldClose}=require('../../services/api/src/routes/fieldClose');
const {handleEvidenceSubmit}=require('../../services/api/src/routes/evidence');
const {handleLifecycleStep}=require('../../services/api/src/routes/lifecycle');
const {openReworkCase,closeReworkCase}=require('../../services/api/src/operationsIntelligence');
const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const UA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',UB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TA='33333333-3333-4333-8333-333333333333',TB='44444444-4444-4444-8444-444444444444';const CALLB='aaaaaaaa-aaaa-4aaa-8aaa-000000000007',ASSETB='aaaaaaaa-aaaa-4aaa-8aaa-000000000008';
const INCA='aaaaaaaa-aaaa-4aaa-8aaa-000000000005';
const CCA='10111111-1111-4111-8111-111111111111',CCB='20222222-2222-4222-8222-222222222222';
const CC_MSG_A='30333333-3333-4333-8333-333333333333',CC_MSG_B='40444444-4444-4444-8444-444444444444',CC_MSG_INSERT_B='50555555-5555-4555-8555-555555555555';const TKA='55555555-5555-4555-8555-555555555555',TKB='66666666-6666-4666-8666-666666666666',TKC='88888888-8888-4888-8888-888888888888',TKD='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',TKE='aaaaaaaa-aaaa-4aaa-8aaa-000000000002',TKF='aaaaaaaa-aaaa-4aaa-8aaa-000000000003',TKH='aaaaaaaa-aaaa-4aaa-8aaa-000000000004';const PIA='99999999-9999-4999-8999-999999999999',PIB='aaaaaaaa-1111-4111-8111-111111111112';
async function db(url){const p=createPool({...process.env,DATABASE_URL:url});if(!p.configured)throw Error(p.reason||'DB_NOT_CONFIGURED');return p}
async function adminInsertWithClaims(sql,params,sub,role){
 const p=await db(process.env.RUNTIME_ADMIN_DATABASE_URL);const c=await p.pool.connect();
 try{await c.query('begin');await c.query('set local row_security = off');await c.query('set local session_replication_role = replica');const claims=JSON.stringify({sub,role:'authenticated',app_metadata:{role}});await c.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)",[sub,'authenticated',claims]);const result=await c.query(sql,params||[]);await c.query('set local session_replication_role = origin');await c.query('commit');return result}
 catch(e){try{await c.query('rollback')}catch(_){}throw e}
 finally{c.release();await p.end()}
}
async function adminSeed(){const p=await db(process.env.RUNTIME_ADMIN_DATABASE_URL);const c=await p.pool.connect();try{await c.query('begin');await c.query('set local row_security = off');await c.query('set local session_replication_role = replica');await c.query('create schema if not exists auth');await c.query("create table if not exists auth.users(id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}'::jsonb,raw_user_meta_data jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now())");await c.query('insert into auth.users(id,email) values ($1,$2),($3,$4) on conflict(id) do nothing',[UA,'runtime-a@example.invalid',UB,'runtime-b@example.invalid']);await c.query('insert into public.tenants(id,name,slug) values ($1,\'Runtime Tenant A\',\'runtime-a\'),($2,\'Runtime Tenant B\',\'runtime-b\') on conflict(id) do nothing',[A,B]);await c.query('insert into public.user_preferences(user_id,tenant_id,preferred_locale) values ($1,$2,\'en\'),($3,$4,\'en\') on conflict(user_id) do update set tenant_id=excluded.tenant_id',[UA,A,UB,B]);await c.query("insert into public.technicians(id,user_id,tenant_id,name,skills,current_gps,is_active) values ($1,$2,$3,'Runtime Tech A',array['fiber'],ST_SetSRID(ST_MakePoint(31.2357,30.0444),4326)::geography,true),($4,$5,$6,'Runtime Tech B',array['fiber'],ST_SetSRID(ST_MakePoint(31.2457,30.0544),4326)::geography,true) on conflict(id) do nothing",[TA,UA,A,TB,UB,B]);await c.query("insert into public.tickets(id,tenant_id,status,type,technician_id,location_coordinates) values ($1,$2,'pending','runtime-isolation',$3,ST_SetSRID(ST_MakePoint(31.2357,30.0444),4326)::geography),($4,$5,'pending','runtime-isolation',$6,ST_SetSRID(ST_MakePoint(31.2457,30.0544),4326)::geography) on conflict(id) do nothing",[TKA,A,TA,TKB,B,TB]);await c.query("insert into public.network_assets(id,tenant_id,asset_code,asset_type,name) values ($1,$2,'runtime-cross-tenant-b','OLT','Runtime Cross Tenant B') on conflict(id) do nothing",[ASSETB,B]);await c.query("insert into public.call_sessions(id,tenant_id,provider,direction,external_call_id,caller_number,status,ivr_state) values ($1,$2,'runtime','inbound','runtime-cross-tenant-call','+201000000007','queued','welcome') on conflict(id) do nothing",[CALLB,B]);
await c.query("insert into public.contact_center_conversations(id,tenant_id,channel,created_by,language_code,locale,language_source,adapter_mode,correlation_id,idempotency_key) values ($1,$2,'CHAT',$3,'en','en-US','REQUESTED','LOCAL_SOVEREIGN','runtime-cc-a','runtime-cc-a'),($4,$5,'CHAT',$3,'en','en-US','REQUESTED','LOCAL_SOVEREIGN','runtime-cc-b','runtime-cc-b') on conflict(id) do nothing",[CCA,A,UA,CCB,B]);
await c.query("insert into public.contact_center_conversation_messages(id,tenant_id,conversation_id,direction,message_type,content,content_sha256,idempotency_key,actor_id) values ($1,$2,$3,'CUSTOMER_TO_SYSTEM','TEXT','tenant A valid message',repeat('a',64),'runtime-cc-msg-a',$4),($5,$2,$6,'CUSTOMER_TO_SYSTEM','TEXT','tenant A message linked to tenant B conversation',repeat('b',64),'runtime-cc-msg-b',$4) on conflict(id) do nothing",[CC_MSG_A,A,CCA,UA,CC_MSG_B,CCB]);await c.query("delete from public.payment_cycle_events where payment_cycle_id in (select id from public.payment_cycles where invoice_id in ($1,$2))",[PIA,PIB]);await c.query("delete from public.payment_cycles where invoice_id in ($1,$2)",[PIA,PIB]);await c.query("insert into public.invoices(id,tenant_id,customer_ref,currency,amount_minor,status) values ($1,$2,'runtime-payment-a','USD',1000,'draft'),($3,$4,'runtime-payment-b','USD',2000,'draft') on conflict(id) do update set tenant_id=excluded.tenant_id,customer_ref=excluded.customer_ref,currency=excluded.currency,amount_minor=excluded.amount_minor,status='draft',updated_at=now()",[PIA,A,PIB,B]);await c.query('set local session_replication_role = origin');await c.query('commit');}catch(e){try{await c.query('rollback')}catch(_){}throw e;}finally{c.release();await p.end()}}
async function asUser(sub,role,fn){const p=await db(process.env.RUNTIME_APP_DATABASE_URL);try{return await withPrincipal(p,{sub,role},fn)}finally{await p.end()}}
async function asAuthenticatedCustomer(sub, fn, disableTriggers = false) {
 const p = await db(process.env.RUNTIME_ADMIN_DATABASE_URL);
 const client = await p.pool.connect();
 try {
  await client.query('begin');
  const claims = JSON.stringify({sub, role:'authenticated', app_metadata:{role:'customer'}});
  await client.query("select set_config('request.jwt.claim.sub',$1,true), set_config('request.jwt.claim.role',$2,true), set_config('request.jwt.claims',$3,true)", [sub, 'authenticated', claims]);
  // Isolated CI probe only: bypass triggers to test the RLS WITH CHECK policy
  // directly rather than allowing the separate tenant-FK trigger to reject first.
  if (disableTriggers) await client.query('set local session_replication_role = replica');
  await client.query('set local role authenticated');
  return await fn(client);
 } finally {
  try { await client.query('rollback'); } catch (_) {}
  client.release();
  await p.end();
 }
}
async function contactCenterTenantPolicyAudit() {
 const visible = await asAuthenticatedCustomer(UA, c => c.query(
  'select id from public.contact_center_conversation_messages where id = any($1::uuid[]) order by id',
  [[CC_MSG_A, CC_MSG_B]]
 ));
 assert.deepEqual(visible.rows.map(r => r.id), [CC_MSG_A],
   'customer must see its same-tenant message and must not see a message linked to another tenant conversation');
 let crossTenantInsertBlocked = false;
 let observedError = null;
 try {
  await asAuthenticatedCustomer(UA, c => c.query(
   "insert into public.contact_center_conversation_messages(id,tenant_id,conversation_id,direction,message_type,content,content_sha256,idempotency_key,actor_id) values ($1,$2,$3,'CUSTOMER_TO_SYSTEM','TEXT','cross-tenant insertion attempt',repeat('c',64),'runtime-cc-insert-b',$4)",
   [CC_MSG_INSERT_B, A, CCB, UA]
  ), true);
 } catch (e) {
  observedError = { code: e && e.code || null, message: String(e && e.message || e) };
  crossTenantInsertBlocked = Boolean(e && e.code === '42501') || /row-level security|permission denied/i.test(String(e && e.message || e));
 }
 assert.equal(crossTenantInsertBlocked, true,
   'customer INSERT policy must block an A-tenant message linked to a B-tenant conversation: ' + JSON.stringify(observedError));
 return {
  sameTenantMessageVisible: visible.rows.some(r => r.id === CC_MSG_A),
  crossTenantLinkedMessageHidden: !visible.rows.some(r => r.id === CC_MSG_B),
  crossTenantInsertBlocked,
  deniedErrorCode: observedError && observedError.code
 };
}
async function adminInsert(id){const p=await db(process.env.RUNTIME_ADMIN_DATABASE_URL);const q=await p.pool.connect();try{await q.query('begin');await q.query('set local row_security = off');await q.query('set local session_replication_role = replica');await q.query("insert into public.tickets(id,tenant_id,status,type,technician_id,location_coordinates) values ($1,$2,'pending','concurrency',$3,ST_SetSRID(ST_MakePoint(31.2357,30.0444),4326)::geography) on conflict(id) do nothing",[id,A,TA]);await q.query('commit');}catch(e){try{await q.query('rollback')}catch(_){}throw e;}finally{q.release();await p.end()}}
async function adminQuery(sql,params){const p=await db(process.env.RUNTIME_ADMIN_DATABASE_URL);const c=await p.pool.connect();try{await c.query('begin');await c.query('set local row_security = off');const result=await c.query(sql,params||[]);await c.query('commit');return result}catch(e){try{await c.query('rollback')}catch(_){}throw e;}finally{c.release();await p.end()}}
async function asOwnerWithClaims(sub,role,fn){
 const p=await db(process.env.RUNTIME_ADMIN_DATABASE_URL);const client=await p.pool.connect();
 try{
  await client.query('begin');
  const claims=JSON.stringify({sub:sub||null,role:'authenticated',app_metadata:{role:role||null}});
  await client.query(`select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claim.role',$2,true),set_config('request.jwt.claims',$3,true)`,[sub,role,claims]);
  await client.query('set local role fiberos_owner');
  return await fn(client);
 }finally{try{await client.query('rollback')}catch(e){}client.release();await p.end()}
}

async function paymentRuntimeCheck(){
 const { startPaymentCycle, transitionPaymentCycle } = require('../../services/api/src/operationsIntelligence');
 const runtimeDb = await db(process.env.RUNTIME_APP_DATABASE_URL);
 const cfo = { sub: UA, role: 'cfo' };
 const fieldTech = { sub: UA, role: 'field_tech' };
 try{
  let unauthorized=false;
  try{await startPaymentCycle(runtimeDb,fieldTech,{invoiceId:PIA})}
  catch(e){unauthorized=/PAYMENT_AUTHORITY_FORBIDDEN/i.test(String(e&&(e.code||e.message)))}
  assert.equal(unauthorized,true,'non-payment role must not start a payment cycle');

  let crossTenantBlocked=false;
  try{await startPaymentCycle(runtimeDb,cfo,{invoiceId:PIB})}
  catch(e){crossTenantBlocked=/INVOICE_NOT_FOUND|PAYMENT_AUTHORITY_FORBIDDEN|TENANT/i.test(String(e&&(e.code||e.message)))}
  assert.equal(crossTenantBlocked,true,'tenant A operator must not start tenant B payment cycle');

  const cfoContext=await asUser(UA,'cfo',async c=>{
    const r=await c.query(
      `select current_user,
              auth.uid() as auth_uid,
              auth.jwt()->'app_metadata'->>'role' as jwt_role,
              public.fiberos_current_tenant_id() as tenant_id,
              (select count(*)::int from invoices where id=$1::uuid and tenant_id=$2::uuid) as invoice_visible,
              has_table_privilege(current_user,'public.invoices','SELECT') as invoice_select_privilege`,
      [PIA,A]
    );
    return r.rows[0];
  });
  console.log(JSON.stringify({cfoContext},null,2));
  const ownerContext=await asOwnerWithClaims(UA,'cfo',async c=>{
    const r=await c.query(
      `select current_user,
              auth.uid() as auth_uid,
              auth.jwt()->'app_metadata'->>'role' as jwt_role,
              public.fiberos_session_tenant_id() as session_tenant,
              (select count(*)::int from user_preferences where user_id=auth.uid()) as user_pref_visible,
              (select count(*)::int from invoices where id=$1::uuid and tenant_id=$2::uuid) as invoice_visible,
              has_table_privilege(current_user,'public.invoices','SELECT') as invoice_select_privilege,
              (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='invoices') as invoice_rls_enabled,
              (select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='invoices') as invoice_rls_forced`,
      [PIA,A]
    );
    return r.rows[0];
  });
  console.log(JSON.stringify({ownerContext},null,2));
  assert.equal(cfoContext.jwt_role,'cfo','CFO principal role must reach the database JWT claims');
  assert.equal(cfoContext.tenant_id,A,'CFO tenant context must resolve to tenant A');
  assert.equal(cfoContext.invoice_visible,1,'CFO must be able to see its tenant invoice through RLS');
  assert.equal(cfoContext.invoice_select_privilege,true,'CFO session must retain invoice SELECT privilege');
  const concurrent=await Promise.allSettled([
   startPaymentCycle(runtimeDb,cfo,{invoiceId:PIA}),
   startPaymentCycle(runtimeDb,cfo,{invoiceId:PIA})
  ]);
  const successfulStarts=concurrent.filter(x=>x.status==='fulfilled');
  const rejectedStarts=concurrent.filter(x=>x.status==='rejected');
  const rejectionDetails=rejectedStarts.map(x=>({
    name:x.reason&&x.reason.name||null,
    code:x.reason&&x.reason.code||null,
    message:x.reason&&x.reason.message||String(x.reason)
  }));
  assert.equal(successfulStarts.length,1,`exactly one concurrent payment start must succeed; rejections=${JSON.stringify(rejectionDetails)}`);
  assert.equal(rejectedStarts.length,1,`duplicate concurrent payment start must be rejected; rejections=${JSON.stringify(rejectionDetails)}`);

  const cycle=successfulStarts[0].value;
  assert.ok(cycle&&cycle.id,'successful payment start must return a cycle id');
  assert.equal(cycle.state,'submitted','payment cycle must start in submitted state');

  const approved=await transitionPaymentCycle(runtimeDb,cfo,cycle.id,{toState:'approved'});
  assert.equal(approved.toState,'approved','payment cycle must approve from submitted');

  const paid=await transitionPaymentCycle(runtimeDb,cfo,cycle.id,{toState:'paid',evidenceReference:'runtime-payment-evidence-001'});
  assert.equal(paid.toState,'paid','payment cycle must reach paid only with evidence');

  const state=await adminQuery('select pc.state as cycle_state,i.status as invoice_status,count(pce.id)::int as event_count from payment_cycles pc join invoices i on i.id=pc.invoice_id left join payment_cycle_events pce on pce.payment_cycle_id=pc.id where pc.id=$1 group by pc.id,i.id',[cycle.id]);
  assert.equal(state.rows[0].cycle_state,'paid','database payment cycle state must be paid');
  assert.equal(state.rows[0].invoice_status,'paid','database invoice state must be paid');
  assert.equal(state.rows[0].event_count,3,'payment lifecycle must record submitted, approved, and paid events');
  return {paymentAuthorityRejectedForNonPaymentRole:unauthorized,crossTenantPaymentBlocked:crossTenantBlocked,concurrentStart:{successes:successfulStarts.length,failures:rejectedStarts.length},finalState:state.rows[0]};
 }finally{await runtimeDb.end()}
}
async function apiAuthorityRuntimeCheck(){
  const apiDb=await db(process.env.RUNTIME_APP_DATABASE_URL);
  try{
    await adminInsert(TKD);
    const unverifiedTransition=await handleTicketTransition({ticketId:TKD,to:'in_progress'},{sub:UA,role:'field_tech'},apiDb);
    assert.equal(unverifiedTransition.status,401,'unverified principal must receive an authentication response, not DB_ERROR');
    const ticketRace=await Promise.allSettled([
      handleTicketTransition({ticketId:TKD,to:'in_progress',fromStatus:'completed'},{sub:UA,role:'field_tech',authenticated:true,verified:true},apiDb),
      handleTicketTransition({ticketId:TKD,to:'in_progress',fromStatus:'completed'},{sub:UA,role:'field_tech',authenticated:true,verified:true},apiDb)
    ]);
    const ticketSuccesses=ticketRace.filter(x=>x.status==='fulfilled'&&x.value.status===200);
    const ticketRejects=ticketRace.filter(x=>x.status==='fulfilled'&&x.value.status===409);
    assert.equal(ticketSuccesses.length,1,'API ticket transition: exactly one concurrent request must succeed');
    assert.equal(ticketRejects.length,1,'API ticket transition: exactly one concurrent request must be rejected');
    assert.equal(ticketSuccesses[0].value.body.authority,'DB_AUTHORITATIVE','API ticket transition must report DB authority');
    assert.equal(ticketSuccesses[0].value.body.clientFromIgnored.actual,'pending','API must ignore spoofed fromStatus and report DB current state');
    const ticketState=await adminQuery('select status,tenant_id from public.tickets where id=$1',[TKD]);
    assert.equal(ticketState.rows[0].status,'in_progress','API ticket transition must persist final state');

    await adminInsert(TKE);
    const lifecycleResult=await handleLifecycleStep({ticketId:TKE,to:'in_progress',fromStatus:'completed'},{sub:UA,role:'field_tech',authenticated:true,verified:true},apiDb);
    assert.equal(lifecycleResult.status,200,'lifecycle API route must succeed from DB state despite spoofed fromStatus');
    assert.equal(lifecycleResult.body.authority,'DB_AUTHORITATIVE','lifecycle API must report DB authority');
    assert.equal(lifecycleResult.body.clientFromIgnored.actual,'pending','lifecycle API must ignore spoofed fromStatus');
    const lifecycleState=await adminQuery('select status from public.tickets where id=$1',[TKE]);
    assert.equal(lifecycleState.rows[0].status,'in_progress','lifecycle API transition must persist final state');

    await adminInsert(TKH);
    const fieldTechPrincipal={sub:UA,role:'field_tech',authenticated:true,verified:true};
    const fieldStart=await handleTicketTransition({ticketId:TKH,to:'in_progress',fromStatus:'pending'},fieldTechPrincipal,apiDb);
    assert.equal(fieldStart.status,200,'fieldClose runtime ticket setup transition must succeed');
    const forgedFieldCloseNms=await handleFieldClose({
      ticketId:TKH,
      fromStatus:'pending',
      toStatus:'awaiting_evidence',
      deviceGps:{lat:30.0444,lng:31.2357},
      photo:{contentHash:'runtime-field-close-photo-nms-001',storageRef:'runtime://photo/nms-001',capturedAt:new Date(Date.now()-1000).toISOString()},
      rxDbm:-18,
      opticalSource:'nms_poll'
    },fieldTechPrincipal,apiDb,{realityGateMaxMeters:50,photoMaxAgeSeconds:900});
    assert.equal(forgedFieldCloseNms.status,403,'fieldClose must reject client-declared NMS provenance');
    assert.equal(forgedFieldCloseNms.body.error,'NMS_PROVENANCE_ATTESTATION_REQUIRED','NMS provenance must require a trusted adapter');

    const forgedFieldClosePolicy=await handleFieldClose({
      ticketId:TKH,
      fromStatus:'pending',
      toStatus:'awaiting_evidence',
      deviceGps:{lat:30.0444,lng:31.2357},
      photo:{contentHash:'runtime-field-close-photo-policy-001',storageRef:'runtime://photo/policy-001',capturedAt:new Date(Date.now()-1000).toISOString()},
      rxDbm:-18,
      opticalSource:'ai_simulated',
      policy:{requireFieldOrNms:false}
    },fieldTechPrincipal,apiDb,{realityGateMaxMeters:50,photoMaxAgeSeconds:900});
    assert.equal(forgedFieldClosePolicy.status,422,'fieldClose must ignore client policy overrides and reject simulated-only evidence');
    assert.equal(forgedFieldClosePolicy.body.error,'FIELD_CLOSE_VALIDATION_FAILED','simulated-only evidence must remain blocked despite client policy override');
    const capturedAt=new Date(Date.now()-1000).toISOString();
    const closeResult=await handleFieldClose({
      ticketId:TKH,
      fromStatus:'pending',
      toStatus:'awaiting_evidence',
      jobGps:{lat:30.0444,lng:31.2357},
      deviceGps:{lat:30.0444,lng:31.2357},
      photo:{contentHash:'runtime-field-close-photo-001',storageRef:'runtime://photo/001',capturedAt},
      rxDbm:-18,
      opticalSource:'field_reading',
      idempotencyKey:'runtime-field-close-idem-001'
    },fieldTechPrincipal,apiDb,{realityGateMaxMeters:50,photoMaxAgeSeconds:900});
    assert.equal(closeResult.status,200,'fieldClose API must persist');
    assert.equal(closeResult.body.authority,'DB_AUTHORITATIVE','fieldClose API must report DB authority');
    assert.equal(closeResult.body.persisted,true,'fieldClose API must persist to the database');
    const ledgerProbe=await asUser(UA,'field_tech',async c=>{
      const head=(await c.query('select fiberos_hash_ledger_head() as head')).rows[0].head;
      const nextHash='abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd';
      const nextIndex=(await c.query(
        'select fiberos_append_hash_ledger($1::char(64),$2::char(64),$3::bigint,$4::text,$5::text,$6::jsonb) as block_index',
        [head,nextHash,Date.now(),'RUNTIME_LEDGER_AUTHORITY',UA,JSON.stringify({runtime:true})]
      )).rows[0].block_index;
      return {head,nextHash,nextIndex};
    });
    assert.equal(typeof ledgerProbe.head,'string','ledger head authority must return a hash');
    assert.equal(ledgerProbe.head.length,64,'ledger head authority must return 64-char hash');
    const ledgerProbeRow=await adminQuery('select block_index,previous_hash,block_hash,actor_id,event_type from public.hash_ledger where block_index=$1',[ledgerProbe.nextIndex]);
    assert.equal(ledgerProbeRow.rows.length,1,'ledger authority append must persist exactly one row');
    assert.equal(ledgerProbeRow.rows[0].previous_hash,ledgerProbe.head,'ledger append must chain from DB-owned head');
    assert.equal(ledgerProbeRow.rows[0].block_hash,ledgerProbe.nextHash,'ledger append must persist supplied block hash');
    assert.equal(ledgerProbeRow.rows[0].actor_id,UA,'ledger append actor must match authenticated DB identity');

    const evidencePrincipal={sub:UA,role:'field_tech',authenticated:true,verified:true};
    const forgedNms=await handleEvidenceSubmit({ticketId:TKA,source:'nms',payload:{runtime:true}},evidencePrincipal,apiDb,{});
    assert.equal(forgedNms.status,403,'user evidence endpoint must reject self-asserted NMS provenance');
    assert.equal(forgedNms.body.error,'EVIDENCE_SOURCE_ATTESTATION_REQUIRED','NMS provenance must require a trusted ingestion path');
    const evidenceResult=await handleEvidenceSubmit({ticketId:TKA,source:'field',payload:{runtime:true}},evidencePrincipal,apiDb,{});
    if (evidenceResult.status !== 200) {
      const detail = evidenceResult.body && (evidenceResult.body.detail || evidenceResult.body.error);
      assert.equal(evidenceResult.status, 200, 'field evidence submit must persist: ' + String(detail));
    }
    const evidenceRow=await adminQuery('select actor_id,source from public.evidence where id=$1',[evidenceResult.body.evidence.id]);
    assert.equal(evidenceRow.rows[0].actor_id,UA,'evidence actor must come from authenticated DB identity');
    assert.equal(evidenceRow.rows[0].source,'field','field evidence must persist its declared non-attested source');

    const fieldCloseState=await adminQuery('select status,rx_power,tenant_id from public.tickets where id=$1',[TKH]);
    assert.equal(fieldCloseState.rows[0].status,'awaiting_evidence','fieldClose API must persist the requested lifecycle state');
    assert.equal(Number(fieldCloseState.rows[0].rx_power),-18,'fieldClose API must persist RX power');
    assert.equal(fieldCloseState.rows[0].tenant_id,A,'fieldClose API must preserve tenant scope');
    await openReworkCase(apiDb,{sub:UA,role:'qc'},{caseId:'runtime-api-rework',ticketId:TKA,rootCauseCategory:'hardware',evidenceReference:'runtime-api-rework-evidence'});
    const reworkRace=await Promise.allSettled([
      closeReworkCase(apiDb,{sub:UA,role:'qc'},'runtime-api-rework',{evidenceReference:'runtime-close-a',resolutionAction:'replace'}),
      closeReworkCase(apiDb,{sub:UA,role:'qc'},'runtime-api-rework',{evidenceReference:'runtime-close-b',resolutionAction:'replace'})
    ]);
    const reworkSuccesses=reworkRace.filter(x=>x.status==='fulfilled');
    const reworkFailures=reworkRace.filter(x=>x.status==='rejected');
    assert.equal(reworkSuccesses.length,1,'rework API helper: exactly one concurrent close must succeed');
    assert.equal(reworkFailures.length,1,'rework API helper: exactly one concurrent close must be rejected');
    assert.equal(String(reworkFailures[0].reason.code||reworkFailures[0].reason.message),'OPEN_REWORK_CASE_NOT_FOUND','second concurrent rework close must observe closed state');
    const reworkState=await adminQuery('select status from public.rework_cases where tenant_id=$1 and case_id=$2',[A,'runtime-api-rework']);
    assert.equal(reworkState.rows[0].status,'closed','rework close must persist closed state');

    return {
      ticketApiConcurrency:{successes:ticketSuccesses.length,rejections:ticketRejects.length,finalState:ticketState.rows[0]},
      lifecycleApi:{status:lifecycleResult.status,authority:lifecycleResult.body.authority,finalState:lifecycleState.rows[0]},
      reworkApiConcurrency:{successes:reworkSuccesses.length,rejections:reworkFailures.length,finalState:reworkState.rows[0]}
    };
  }finally{await apiDb.end()}
}

async function hierarchyScopeCheck(){
 const SUB='aaaaaaaa-aaaa-4aaa-8aaa-000000000009',OUT='aaaaaaaa-aaaa-4aaa-8aaa-000000000010';
 const US='aaaaaaaa-aaaa-4aaa-8aaa-000000000011',UO='aaaaaaaa-aaaa-4aaa-8aaa-000000000012';
 await adminQuery('insert into auth.users(id,email) values($1,$2),($3,$4) on conflict(id) do nothing',[US,'runtime-subordinate@example.invalid',UO,'runtime-outsider@example.invalid']);
 await adminQuery("insert into public.technicians(id,user_id,tenant_id,name,skills,current_gps,is_active) values($1,$2,$3,'Runtime Subordinate',array['fiber'],ST_SetSRID(ST_MakePoint(31.2557,30.0644),4326)::geography,true),($4,$5,$6,'Runtime Same-Tenant Outsider',array['fiber'],ST_SetSRID(ST_MakePoint(31.2657,30.0744),4326)::geography,true) on conflict(id) do update set user_id=excluded.user_id,tenant_id=excluded.tenant_id,name=excluded.name,is_active=true",[SUB,US,A,OUT,UO,A]);
 await adminInsertWithClaims("insert into public.technician_subordinates(tenant_id,supervisor_technician_id,subordinate_technician_id,source,is_active) values($1,$2,$3,'explicit_assignment',true) on conflict(tenant_id,supervisor_technician_id,subordinate_technician_id) do update set is_active=true,source='explicit_assignment'",[A,TA,SUB],UA,'ops_manager');
 const TKS='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',TKO='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee02';
 const EVS='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee03',EVO='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee04';
 const INCOUT='eeeeeeee-eeee-4eee-8eee-eeeeeeeeee06';
 await adminInsertWithClaims("insert into public.tickets(id,tenant_id,status,type,technician_id,location_coordinates) values($1,$2,'pending','runtime-supervisor-scope',$3,ST_SetSRID(ST_MakePoint(31.2557,30.0644),4326)::geography),($4,$2,'pending','runtime-supervisor-outsider',$5,ST_SetSRID(ST_MakePoint(31.2657,30.0744),4326)::geography) on conflict(id) do update set tenant_id=excluded.tenant_id,type=excluded.type,technician_id=excluded.technician_id",[TKS,A,SUB,TKO,OUT],UA,'ops_manager');
 await adminInsertWithClaims("insert into public.evidence(id,ticket_id,kind,payload,source,tenant_id,actor_id) values($1,$2,'photo','{}'::jsonb,'field',$3,$4),($5,$6,'photo','{}'::jsonb,'field',$3,$7) on conflict(id) do update set ticket_id=excluded.ticket_id,tenant_id=excluded.tenant_id,actor_id=excluded.actor_id",[EVS,TKS,A,US,EVO,TKO,UO],UA,'ops_manager');
 await adminInsertWithClaims("insert into public.incidents(id,tenant_id,incident_key,title,severity,state,affected_customers) values($1,$2,'runtime-supervisor-scope','Runtime Supervisor Scope','P2','open',1),($3,$2,'runtime-supervisor-outsider','Runtime Supervisor Outsider','P2','open',1) on conflict(id) do update set tenant_id=excluded.tenant_id,incident_key=excluded.incident_key,title=excluded.title,state='open',affected_customers=1",[INCA,A,INCOUT],UA,'ops_manager');
 await adminInsertWithClaims("insert into public.incident_command_links(tenant_id,incident_id,entity_type,entity_id,link_role,created_by) values($1,$2,'ticket',$3,'supporting',$4),($1,$5,'ticket',$6,'supporting',$4) on conflict(tenant_id,incident_id,entity_type,entity_id,link_role) do update set created_by=excluded.created_by",[A,INCA,TKS,UA,INCOUT,TKO],UA,'ops_manager');
 const visible=await asUser(UA,'field_tech',async c=>(await c.query('select id from public.technicians where id=any($1::uuid[]) order by id',[[SUB,OUT]])).rows.map(row=>row.id));
 assert.deepEqual(visible,[],'field_tech must not inherit the supervisor role or enumerate a same-tenant subordinate');

 const supervisorTechnicians=await asUser(UA,'area_supervisor',async c=>(await c.query('select id from public.technicians where id=any($1::uuid[]) order by id',[[SUB,OUT]])).rows.map(row=>row.id));
 assert.deepEqual(supervisorTechnicians,[SUB],'area_supervisor must not enumerate same-tenant technicians outside its explicit scope');
 const supervisorTickets=await asUser(UA,'area_supervisor',async c=>(await c.query('select id from public.tickets where id=any($1::uuid[]) order by id',[[TKS,TKO]])).rows.map(row=>row.id));
 assert.deepEqual(supervisorTickets,[TKS],'area_supervisor must read only tickets linked to an assigned technician');
 const supervisorEvidence=await asUser(UA,'area_supervisor',async c=>(await c.query('select id from public.evidence where id=any($1::uuid[]) order by id',[[EVS,EVO]])).rows.map(row=>row.id));
 assert.deepEqual(supervisorEvidence,[EVS],'area_supervisor must read evidence only through an in-scope ticket');
 const supervisorIncidents=await asUser(UA,'area_supervisor',async c=>(await c.query('select id from public.incidents where id=any($1::uuid[]) order by id',[[INCA,INCOUT]])).rows.map(row=>row.id));
 assert.deepEqual(supervisorIncidents,[INCA],'area_supervisor incident access must be anchored to a trusted in-scope ticket link');
 let supervisorLinkBlocked=false;
 try { await asUser(UA,'area_supervisor',c=>c.query("insert into public.incident_command_links(tenant_id,incident_id,entity_type,entity_id,link_role,created_by) values($1,$2,'ticket',$3,'supporting',$4)",[A,INCA,TKO,UA])); }
 catch(e) { supervisorLinkBlocked=/row-level security|policy|TENANT_MISMATCH_INCIDENT_COMMAND_ENTITY/i.test(String(e.message)); }
 assert.equal(supervisorLinkBlocked,true,'area_supervisor must not self-expand an incident by linking an out-of-scope ticket');
 const boundary=(await adminQuery("select r.rolcanlogin,r.rolsuper,r.rolbypassrls,has_schema_privilege('fiberos_policy_reader','public','CREATE') as schema_create,has_table_privilege('fiberos_policy_reader','public.technicians','SELECT') as technician_select,has_table_privilege('fiberos_policy_reader','public.technicians','UPDATE') as technician_update,pg_get_userbyid(p.proowner) as function_owner,p.prosecdef from pg_roles r cross join pg_proc p where r.rolname='fiberos_policy_reader' and p.oid='public.fiberos_field_technician_scope(uuid)'::regprocedure")).rows[0];
 assert.equal(boundary.rolcanlogin,false,'policy reader must not be able to log in');
 assert.equal(boundary.rolsuper,false,'policy reader must not be superuser');
 assert.equal(boundary.rolbypassrls,true,'policy reader must bypass RLS only within its definer helper');
 assert.equal(boundary.schema_create,false,'temporary schema CREATE must be revoked after migrations');
 assert.equal(boundary.technician_select,true,'policy reader requires SELECT for the predicate');
 assert.equal(boundary.technician_update,false,'policy reader must not mutate technician data');
 assert.equal(boundary.function_owner,'fiberos_policy_reader','predicate must be owned by the restricted reader role');
 assert.equal(boundary.prosecdef,true,'scope predicate must be SECURITY DEFINER');
 return {visibleSubordinate:visible.length,supervisorVisibleTechnicians:supervisorTechnicians.length,supervisorVisibleTickets:supervisorTickets.length,supervisorVisibleEvidence:supervisorEvidence.length,supervisorVisibleIncidents:supervisorIncidents.length,supervisorCannotSelfExpandIncident:supervisorLinkBlocked,hiddenSameTenantOutsider:!visible.includes(OUT),policyReader:{login:boundary.rolcanlogin,superuser:boundary.rolsuper,bypassRls:boundary.rolbypassrls,schemaCreate:boundary.schema_create,selectOnly:boundary.technician_select&&!boundary.technician_update,functionOwner:boundary.function_owner}};
}

async function main(){await adminSeed();const contactCenterTenantIsolation=await contactCenterTenantPolicyAudit();const hierarchy=await hierarchyScopeCheck();const policyState=await adminQuery("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='tickets' order by policyname");const appContext=await asUser(UA,'field_tech',async c=>{const r=await c.query("select current_user,session_user,pg_has_role(current_user,'authenticated','member') as authenticated_member,public.fiberos_current_tenant_id() as tenant_id,public.fiberos_ticket_is_owned($1) as owns_tenant_b_ticket,public.fiberos_has_any_role(array['qc','ops_manager','area_supervisor','exec','sysadmin']) as management_role,(select c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='tickets') as rls_enabled,(select c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='tickets') as rls_forced,(select pg_get_userbyid(c.relowner) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='tickets') as table_owner,current_setting('row_security') as row_security,has_table_privilege(current_user,'public.tickets','INSERT') as insert_privilege,(select coalesce(json_agg(json_build_object('name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid)) order by t.tgname),'[]'::json) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='tickets' and not t.tgisinternal) as ticket_triggers",[TB]);return r.rows[0]});console.log(JSON.stringify({ticketPolicies:policyState.rows,appContext},null,2));const v=await asUser(UA,'field_tech',async c=>{const tenant=(await c.query('select public.fiberos_current_tenant_id() as tenant_id')).rows[0].tenant_id;const rows=await c.query('select id,tenant_id from public.tickets order by id');const cross=await c.query('select id from public.tickets where tenant_id=$1',[B]);assert.equal(tenant,A,'current tenant context must resolve to tenant A');assert.equal(rows.rowCount,1,'tenant A must see exactly one ticket');assert.equal(rows.rows[0].tenant_id,A,'visible ticket must belong to tenant A');assert.equal(cross.rowCount,0,'tenant A must not read tenant B tickets');return {visible:rows.rowCount,crossTenant:cross.rowCount}});let blocked=false;let crossInsertResult=null;let crossInsertError=null;try{crossInsertResult=await asUser(UA,'field_tech',c=>c.query("insert into public.tickets(id,tenant_id,status,type,technician_id,location_coordinates) values ('77777777-7777-4777-8777-777777777777',$1,'pending','spoof',$2,ST_SetSRID(ST_MakePoint(31.20,30.02),4326)::geography) returning id,tenant_id,technician_id",[B,TB]))}catch(e){crossInsertError={message:String(e.message),code:e.code||null};blocked=/row-level security|policy|permission denied|TENANT_CONTEXT|TENANT_MISMATCH|TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE|TICKET_TENANT_SCOPE_VIOLATION/i.test(String(e.message))}console.log(JSON.stringify({crossInsertResult:crossInsertResult?crossInsertResult.rows:[],crossInsertError},null,2));assert.equal(blocked,true,`cross-tenant ticket INSERT must be blocked; result=${JSON.stringify(crossInsertResult?crossInsertResult.rows:[])} error=${JSON.stringify(crossInsertError)}`);let updateBlocked=false;try{await asUser(UA,'field_tech',c=>c.query('update public.tickets set tenant_id=$1 where id=$2',[B,TKA]))}catch(e){updateBlocked=/row-level security|policy|permission denied|TENANT_CONTEXT|TENANT_MISMATCH|TENANT_REFERENCE_MISSING_OR_NOT_VISIBLE|TICKET_TENANT_SCOPE_VIOLATION/i.test(String(e.message))}assert.equal(updateBlocked,true,'cross-tenant tenant_id UPDATE must be blocked');let directStatusBlocked=false;try{const result=await asUser(UA,'field_tech',c=>c.query("update public.tickets set status='in_progress' where id=$1 returning status",[TKA]));directStatusBlocked=result.rowCount===0}catch(e){directStatusBlocked=/DB_LIFECYCLE|LIFECYCLE|status|row-level security|policy/i.test(String(e.message))}assert.equal(directStatusBlocked,true,'direct ticket status UPDATE must be blocked');const directStatusAfter=await adminQuery('select status from public.tickets where id=$1',[TKA]);assert.equal(directStatusAfter.rows[0].status,'pending','blocked direct status UPDATE must not persist');
await adminQuery("insert into public.incidents(id,tenant_id,incident_key,title,severity,state,affected_customers) values($1,$2,'runtime-incident-authority','Runtime Incident Authority','P2','open',1) on conflict(id) do update set tenant_id=excluded.tenant_id,title=excluded.title,severity=excluded.severity,state='open',affected_customers=1",[INCA,A]);
let incidentInitialStateBlocked=false;
try{await asUser(UA,'ops_manager',c=>c.query("insert into public.incidents(id,tenant_id,incident_key,title,severity,state,affected_customers) values($1,$2,'runtime-incident-initial-state','Runtime Incident Initial','P2','closed',1)",['aaaaaaaa-aaaa-4aaa-8aaa-000000000006',A]))}catch(e){incidentInitialStateBlocked=/INCIDENT_INITIAL_STATE_REJECTED|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(incidentInitialStateBlocked,true,'incident creation must reject an invalid initial lifecycle state');

let incidentJumpBlocked=false;
try{await asUser(UA,'ops_manager',c=>c.query("update public.incidents set state='closed' where id=$1",[INCA]))}catch(e){incidentJumpBlocked=/INCIDENT_TRANSITION_REJECTED|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(incidentJumpBlocked,true,'direct incident lifecycle jump open->closed must be blocked by DB authority');
let incidentActorBlocked=false;
try{await asUser(UA,'ops_manager',c=>c.query("insert into public.incident_events(tenant_id,incident_id,event_type,payload,actor_id) values($1,$2,'runtime.spoof', '{}'::jsonb,$3)",[A,INCA,UB]))}catch(e){incidentActorBlocked=/INCIDENT_EVENT_ACTOR_MISMATCH|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(incidentActorBlocked,true,'incident audit event must bind actor_id to auth.uid()');

let crossCallTicketBlocked=false;
try{await asUser(UA,'call_center',c=>c.query("insert into public.call_sessions(tenant_id,provider,direction,ticket_id,status,ivr_state) values($1,'runtime','inbound',$2,'ringing','welcome')",[A,TKB]))}catch(e){crossCallTicketBlocked=/TENANT_MISMATCH_CALL_TICKET|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(crossCallTicketBlocked,true,'call session must not reference a ticket from another tenant');

let crossCallEventBlocked=false;
try{await asUser(UA,'call_center',c=>c.query("insert into public.call_events(tenant_id,call_session_id,event_type,payload) values($1,$2,'runtime.cross','{}'::jsonb)",[A,CALLB]))}catch(e){crossCallEventBlocked=/TENANT_MISMATCH_CALL_EVENT_SESSION|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(crossCallEventBlocked,true,'call event must not reference a call session from another tenant');

let crossDispatchBlocked=false;
try{await asUser(UA,'dispatcher',c=>c.query("insert into public.dispatch_requests(tenant_id,ticket_id,required_skill,request_payload,status) values($1,$2,'fiber','{}'::jsonb,'requested')",[A,TKB]))}catch(e){crossDispatchBlocked=/TENANT_MISMATCH_DISPATCH_TICKET|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(crossDispatchBlocked,true,'dispatch request must not reference a ticket from another tenant');

let crossQueueBlocked=false;
try{await asUser(UA,'call_center',c=>c.query("insert into public.call_queue_assignments(tenant_id,call_session_id,agent_id) values($1,$2,$3)",[A,CALLB,TB]))}catch(e){crossQueueBlocked=/TENANT_MISMATCH_QUEUE_SESSION|TENANT_MISMATCH_QUEUE_AGENT|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(crossQueueBlocked,true,'queue assignment must not reference session/agent from another tenant');

let crossIncidentAssetBlocked=false;
try{await asUser(UA,'ops_manager',c=>c.query("insert into public.incidents(tenant_id,incident_key,title,severity,state,affected_customers,primary_asset_id) values($1,'runtime-cross-tenant-asset','Cross Tenant Asset','P2','open',0,$2)",[A,ASSETB]))}catch(e){crossIncidentAssetBlocked=/TENANT_MISMATCH_INCIDENT_ASSET|row-level security|policy|permission denied/i.test(String(e.message))}
assert.equal(crossIncidentAssetBlocked,true,'incident must not reference an asset from another tenant');

const incidentRls=await adminQuery("select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('incidents','incident_events') order by c.relname");
for(const x of incidentRls.rows){assert.equal(x.relrowsecurity,true,x.relname+' RLS disabled');assert.equal(x.relforcerowsecurity,true,x.relname+' FORCE RLS disabled');}await adminInsert(TKF);const ctx=await asUser(UA,'field_tech',async c=>{const r=await c.query('select auth.uid() as uid,auth.jwt()->\'app_metadata\'->>\'role\' as role,public.fiberos_current_tenant_id() as tenant,(select status from tickets where id=$1::uuid) as status,(select tenant_id from tickets where id=$1::uuid) as ticket_tenant',[TKF]);return r.rows[0]});console.log(JSON.stringify({ticketAuthorityPreflight:ctx},null,2));assert.equal(ctx.role,'field_tech');assert.equal(ctx.tenant,A);assert.equal(ctx.status,'pending');assert.equal(ctx.ticket_tenant,A);await adminInsert(TKC);const concurrent=await Promise.allSettled([asUser(UA,'field_tech',c=>c.query('select public.fiberos_transition_ticket($1,$2)',[TKC,'in_progress'])),asUser(UA,'field_tech',c=>c.query('select public.fiberos_transition_ticket($1,$2)',[TKC,'in_progress']))]);const successes=concurrent.filter(x=>x.status==='fulfilled').length;const failures=concurrent.filter(x=>x.status==='rejected').length;assert.equal(successes,1,'exactly one concurrent lifecycle transition must succeed');assert.equal(failures,1,'exactly one concurrent lifecycle transition must be rejected');const post=await adminQuery('select status,tenant_id from public.tickets where id=$1',[TKC]);assert.equal(post.rows[0].status,'in_progress','successful lifecycle transition must persist');assert.equal(post.rows[0].tenant_id,A,'lifecycle transition must retain tenant A');const apiAuthority=await apiAuthorityRuntimeCheck();const payment=await paymentRuntimeCheck();const runtimeDb=await db(process.env.RUNTIME_APP_DATABASE_URL);const runtimeGate=await verifyRuntimeGate(runtimeDb);await runtimeDb.end();assert.equal(runtimeGate.runtimeVerified,true,`application runtime gate must verify: ${JSON.stringify(runtimeGate)}`);const ext=await adminQuery("select extname,extversion from pg_extension where extname in ('postgis','postgis_topology') order by extname");assert.ok(ext.rows.some(x=>x.extname==='postgis'),'PostGIS extension must be installed');const rls=await adminQuery("select c.relname,c.relrowsecurity,c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('tickets','network_assets','network_ports','optical_measurements','engineering_models','engineering_parameters','outbox_events','audit_log') order by c.relname");assert.ok(rls.rows.length>=6,'at least six required operational tables must exist for the RLS coverage assertion');for(const x of rls.rows)assert.equal(x.relrowsecurity,true,x.relname+' RLS disabled');console.log(JSON.stringify({ok:true,evidenceClass:'EPHEMERAL_CI_RUNTIME',productionCertification:false,runtimeGateStatus:runtimeGate.status,runtimeGateRuntimeVerified:runtimeGate.runtimeVerified,visibility:v,crossTenantInsertBlocked:blocked,crossTenantUpdateBlocked:updateBlocked,directStatusUpdateBlocked:directStatusBlocked,concurrentTransition:{successes,failures},paymentRuntime:payment,apiAuthorityRuntime:apiAuthority,postTransition:post.rows[0],postgis:ext.rows,rls:rls.rows,hierarchyScope:hierarchy,contactCenterTenantIsolation},null,2))}
main().catch(e=>{console.error(JSON.stringify({ok:false,error:e.message,code:e.code||null},null,2));process.exitCode=1})