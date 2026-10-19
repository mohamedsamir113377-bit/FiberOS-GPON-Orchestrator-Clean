'use strict';

const crypto = require('crypto');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');

function fail(code,status=400){ const e=new Error(code); e.statusCode=status; e.code=code; throw e; }
function dbRequired(db){ if(!db || !db.configured) fail('DATABASE_REQUIRED',503); }
function auth(principal,roles){
  const a=requireVerifiedPrincipal(principal,process.env);
  if(!a.ok) return a;
  return requireAnyRole(principal,roles);
}
function text(v,max=500){ const s=String(v ?? '').trim(); return s.length>smax(max) ? s.slice(0,max) : s; }
function smax(n){ return n; }


/** Required evidence types by workflow — business contract, not cosmetic. */
function requiredEvidenceTypes(workflowType){
  if(workflowType==='ROUTER_INSTALLATION'){
    return ['ROUTER_LABEL_SCAN','ROUTER_INSTALLATION_VIDEO','OPTICAL_POWER'];
  }
  return ['DROP_CABLE_VIDEO','OPTICAL_POWER'];
}
function normalizeEvidenceType(type){
  const x=String(type||'').toUpperCase();
  if(x==='INSTALLATION_VIDEO') return 'DROP_CABLE_VIDEO';
  if(x==='ROUTER_VIDEO') return 'ROUTER_INSTALLATION_VIDEO';
  return x;
}
function allowClientHashCompletion(){
  return String(process.env.NODE_ENV||'').trim().toLowerCase()!=='production' &&
    String(process.env.FIBEROS_ALLOW_CLIENT_HASH_COMPLETION||'').trim()==='true';
}
function evidenceCountsTowardCompletion(storageStatus){
  if(storageStatus==='STORAGE_VERIFIED') return true;
  if(allowClientHashCompletion() && (storageStatus==='CLIENT_HASH_ONLY' || storageStatus==='STORAGE_UNVERIFIED')) return true;
  return false;
}
function assertCompletionEvidence(rows, workflowType){
  const need=requiredEvidenceTypes(workflowType);
  const have=new Set();
  for(const row of rows||[]){
    if(!evidenceCountsTowardCompletion(row.storage_status||row.storageStatus||'CLIENT_HASH_ONLY')) continue;
    have.add(normalizeEvidenceType(row.evidence_type||row.evidenceType));
  }
  const missing=need.filter(x=>!have.has(x));
  if(missing.length){
    const e=new Error('COMPLETION_EVIDENCE_INCOMPLETE');
    e.statusCode=409;
    e.code='COMPLETION_EVIDENCE_INCOMPLETE';
    e.missing=missing;
    e.required=need;
    e.durableRequired=!allowClientHashCompletion();
    throw e;
  }
}
function requiredEvidenceSatisfied(rows, workflowType){
  try{ assertCompletionEvidence(rows, workflowType); return true; }
  catch(err){ if(err.code==='COMPLETION_EVIDENCE_INCOMPLETE') return false; throw err; }
}
function resolveStorageStatus(storageRef){
  // Client cannot claim STORAGE_VERIFIED — only provider/backend verification can
  if(storageRef && String(storageRef).trim()) return 'STORAGE_UNVERIFIED';
  return 'CLIENT_HASH_ONLY';
}
const ALLOWED_ACCEPTANCE_METHODS=new Set([
  'CALL_CENTER_OPERATOR_CONFIRMED',
  'UNVERIFIED_OPERATOR_ATTESTATION'
]);
// Server-side only claims (not accepted from client as proof): OTP_VERIFIED, PROVIDER_VERIFIED, CUSTOMER_PORTAL_CONFIRMED


function requireHexSha256(v, code){
  const s=String(v ?? '').trim().toLowerCase();
  if(!/^[0-9a-f]{64}$/.test(s)) fail(code || 'SHA256_INVALID');
  return s;
}
function assertStatus(job, allowed, code){
  if(!allowed.includes(job.status)) fail(code || 'INVALID_JOB_STATUS', 409);
}
function effectiveDeadline(job){
  if(job.workflow_type==='MIGRATION' && job.migration_completion_deadline_at){
    const m=new Date(job.migration_completion_deadline_at);
    const s=job.sla_deadline_at?new Date(job.sla_deadline_at):null;
    if(s && !Number.isNaN(s.getTime()) && s.getTime()<m.getTime()) return s;
    return m;
  }
  return job.sla_deadline_at?new Date(job.sla_deadline_at):null;
}
function applySlaBreach(client, job, id){
  const dl=effectiveDeadline(job);
  if(dl && !Number.isNaN(dl.getTime()) && Date.now()>dl.getTime() && job.status!=='COMPLETED' && job.status!=='CANCELLED' && job.status!=='REJECTED'){
    return client.query(`update installation_jobs set status=case when status in ('COMPLETED','CANCELLED','REJECTED') then status else 'SLA_BREACHED' end,
      central_penalty_status=case when central_penalty_status='RECORDED' then central_penalty_status else 'ELIGIBLE' end,
      updated_at=now() where id=$1 and status not in ('COMPLETED','CANCELLED','REJECTED') returning id,status,central_penalty_status`,[id]);
  }
  return null;
}

function required(v,code,max=500){ const s=String(v ?? '').trim(); if(!s) fail(code); if(s.length>max) fail(code+'_TOO_LONG'); return s; }
function coordinate(v,name,min,max){
  const n=Number(v); if(!Number.isFinite(n)||n<min||n>max) fail(name+'_INVALID'); return n;
}
function piiKey(){
  const raw=String(process.env.FIBEROS_PII_KEY||'').trim();
  if(!raw) fail('FIBEROS_PII_KEY_REQUIRED',503);
  return crypto.createHash('sha256').update(raw,'utf8').digest();
}
function encryptText(value){
  const iv=crypto.randomBytes(12);
  const c=crypto.createCipheriv('aes-256-gcm',piiKey(),iv);
  const data=Buffer.concat([c.update(String(value),'utf8'),c.final()]);
  const tag=c.getAuthTag();
  return ['v1',iv.toString('base64url'),tag.toString('base64url'),data.toString('base64url')].join('.');
}
function decryptText(value){
  const raw=String(value||'').split('.');
  if(raw.length!==4 || raw[0]!=='v1') fail('PII_CIPHERTEXT_INVALID',500);
  const iv=Buffer.from(raw[1],'base64url'),tag=Buffer.from(raw[2],'base64url'),data=Buffer.from(raw[3],'base64url');
  const d=crypto.createDecipheriv('aes-256-gcm',piiKey(),iv);d.setAuthTag(tag);
  return Buffer.concat([d.update(data),d.final()]).toString('utf8');
}
function sha256Base64(value){
  return crypto.createHash('sha256').update(Buffer.from(value,'base64')).digest('hex');
}
function validateImageData(data,maxBytes=2_000_000){
  if(typeof data!=='string') fail('IMAGE_DATA_REQUIRED');
  const m=data.match(/^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/);
  if(!m) fail('IMAGE_DATA_FORMAT_INVALID');
  const bytes=Buffer.from(m[2],'base64');
  if(bytes.length<128 || bytes.length>maxBytes) fail('IMAGE_DATA_SIZE_INVALID');
  return {mimeType:m[1],base64:m[2],bytes};
}
function parsePath(path){
  const m=String(path).match(/^\/v1\/installations\/([^/]+)(?:\/(.*))?$/);
  if(!m) return null;
  return {id:decodeURIComponent(m[1]),action:m[2]||''};
}
function actor(principal){ return principal && (principal.sub || principal.userId || principal.id) || null; }
function trackingTokenHash(token){ return crypto.createHash('sha256').update(String(token),'utf8').digest('hex'); }

async function withJob(db,principal,id,fn){
  return withPrincipal(db,principal,async client=>{
    const r=await client.query('select * from installation_jobs where id=$1::uuid limit 1',[id]);
    if(!r.rows[0]) fail('INSTALLATION_JOB_NOT_FOUND',404);
    return fn(client,r.rows[0]);
  });
}

async function createIntake(db,principal,body,send,res){
  const a=auth(principal,['call_center','ops_manager','area_supervisor','dispatcher','sysadmin']);
  if(!a.ok) return send(res,a.status,a.body);
  dbRequired(db); body=body||{};
  const type=String(body.workflowType||'').toUpperCase();
  if(!['NEW_INSTALLATION','MIGRATION','ROUTER_INSTALLATION'].includes(type)) fail('WORKFLOW_TYPE_INVALID');
  const lat=coordinate(body.lat,'LAT',-90,90), lon=coordinate(body.lon,'LON',-180,180);
  const id=crypto.randomUUID();
  const code='INS-'+type.slice(0,3)+'-'+id.slice(0,8).toUpperCase();
  const identityType=body.identityType ? String(body.identityType).toUpperCase() : null;
  if(identityType && !['NATIONAL_ID','PASSPORT','DRIVING_LICENSE'].includes(identityType)) fail('IDENTITY_TYPE_INVALID');
  const identityNumber=body.identityNumber ? required(body.identityNumber,'IDENTITY_NUMBER_REQUIRED',100) : null;
  const slaHours=body.slaDurationHours==null ? null : Number(body.slaDurationHours);
  if(slaHours!=null && (!Number.isFinite(slaHours)||slaHours<=0||slaHours>720)) fail('SLA_DURATION_INVALID');
  const migrationDate=type==='MIGRATION' ? required(body.migrationWorkOrderDate,'MIGRATION_WORK_ORDER_DATE_REQUIRED',80) : null;
  const deadline=body.slaDeadlineAt ? new Date(body.slaDeadlineAt) : (slaHours ? new Date(Date.now()+slaHours*3600000) : null);
  if(deadline && Number.isNaN(deadline.getTime())) fail('SLA_DEADLINE_INVALID');
  const docs=Array.isArray(body.documents)?body.documents.slice(0,4):[];
  for(const d of docs) validateImageData(d.imageData);
  const result=await withPrincipal(db,principal,async client=>{
    await client.query('BEGIN');
    try{
      await client.query(
        `insert into installation_jobs
        (id,tenant_id,job_code,workflow_type,status,service_number,landline_number,customer_name,internet_provider_name,company_name,landline_company_name,followup_mobile_1,followup_mobile_2,
         identity_type,identity_number_ciphertext,identity_number_last4,address_region,address_street,address_building_number,address_floor,address_apartment,cabinet_code,box_code,
         site_location,call_center_verified,router_data_verified,sla_duration_hours,sla_deadline_at,migration_work_order_date,migration_completion_deadline_at,created_by)
        values($1,(select tenant_id from user_preferences where user_id=auth.uid()),$2,$3,'INTAKE',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               ST_SetSRID(ST_MakePoint($22,$23),4326)::geography,false,false,$24,$25,$26,$27,$28,$29)`,
        [id,code,type,required(body.serviceNumber,'SERVICE_NUMBER_REQUIRED',100),required(body.landlineNumber,'LANDLINE_NUMBER_REQUIRED',100),required(body.customerName,'CUSTOMER_NAME_REQUIRED',200),
         text(body.internetProviderName,200)||null,text(body.companyName,200)||null,text(body.landlineCompanyName,200)||null,text(body.followupMobile1,50)||null,text(body.followupMobile2,50)||null,
         identityType,identityNumber?encryptText(identityNumber):null,identityNumber?identityNumber.slice(-4):null,required(body.addressRegion,'ADDRESS_REGION_REQUIRED',200),required(body.addressStreet,'ADDRESS_STREET_REQUIRED',300),
         required(body.addressBuildingNumber,'ADDRESS_BUILDING_REQUIRED',80),text(body.addressFloor,40)||null,text(body.addressApartment,80)||null,text(body.cabinetCode,100)||null,text(body.boxCode,100)||null,
         lon,lat,slaHours,deadline, migrationDate, type==='MIGRATION' ? (body.migrationCompletionDeadlineAt||null) : null,actor(principal)]
      );
      for(const d of docs){
        const image=validateImageData(d.imageData);
        const sha=crypto.createHash('sha256').update(image.bytes).digest('hex');
        const ocr=d.ocrText?encryptText(String(d.ocrText).slice(0,10000)):null;
        await client.query(
          `insert into installation_documents(tenant_id,job_id,document_type,mime_type,sha256,content_ciphertext,ocr_text_ciphertext,captured_at,actor_id)
           values((select tenant_id from installation_jobs where id=$1),$1,$2,$3,$4,$5,$6,$7,$8)
           on conflict do nothing`,
          [id,String(d.documentType||'OTHER').toUpperCase(),image.mimeType,sha,encryptText(image.base64),ocr,d.capturedAt?new Date(d.capturedAt):new Date(),actor(principal)]
        );
      }
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id,metadata)
        values((select tenant_id from installation_jobs where id=$1),$1,'INTAKE_CREATED',$2,$3::jsonb)`,[id,actor(principal),JSON.stringify({documentCount:docs.length,workflowType:type})]);
      await client.query('COMMIT');
      return {id,jobCode:code,workflowType:type,status:'INTAKE',slaDeadlineAt:deadline?deadline.toISOString():null};
    }catch(e){await client.query('ROLLBACK');throw e;}
  });
  return send(res,201,{ok:true,job:result,syntheticData:false,authority:'DATABASE_BACKED_INSTALLATION_INTAKE'});
}

async function updateJob(db,principal,id,action,body,send,res){
  const roles = ['evidence','accept','complete','start'].includes(action)
    ? ['technician','fiber_technician','team_lead','qc','ops_manager','area_supervisor','sysadmin']
    : ['call_center','dispatcher','ops_manager','area_supervisor','sysadmin'];
  if(action==='feedback'){
    // feedback is customer-confirmation path operated by call center
  }
  const a=auth(principal,roles); if(!a.ok) return send(res,a.status,a.body); dbRequired(db); body=body||{};
  const result=await withJob(db,principal,id,async(client,job)=>{
    const me=actor(principal);
    // Opportunistic SLA breach before mutation (open jobs past effective deadline)
    await applySlaBreach(client, job, id);
    const refreshed=await client.query('select * from installation_jobs where id=$1 for update',[id]);
    job=refreshed.rows[0]||job;

    if(['accept','evidence','complete','start'].includes(action) && job.technician_id) {
      const mine=await client.query('select id from technicians where id=$1::uuid and user_id=auth.uid() limit 1',[job.technician_id]);
      const elevated=['ops_manager','area_supervisor','sysadmin'].includes(String(principal?.role||''));
      if(!mine.rows[0] && !elevated) fail('TECHNICIAN_SCOPE_MISMATCH',403);
    }

    if(action==='verify'){
      assertStatus(job, ['INTAKE','CALL_CENTER_REVIEW'], 'VERIFY_REQUIRES_INTAKE_OR_REVIEW');
      if(body.confirmed!==true) fail('CALL_CENTER_CONFIRMATION_REQUIRED');
      if(body.confirmedSite!==true) fail('CALL_CENTER_SITE_CONFIRMATION_REQUIRED');
      let routerVerified=job.router_data_verified;
      if(job.workflow_type==='ROUTER_INSTALLATION'){
        if(body.confirmedRouter!==true && body.confirmed!==true) fail('ROUTER_CONFIRMATION_REQUIRED');
        routerVerified=true;
        await client.query(`insert into router_installation_details(tenant_id,job_id,router_serial,router_model,router_mac,verified_by_call_center)
          values($1,$2,coalesce($3,''),coalesce($4,''),coalesce($5,''),true)
          on conflict (job_id) do update set verified_by_call_center=true,updated_at=now()`,
          [job.tenant_id,id,text(body.routerSerial,120),text(body.routerModel,120),text(body.routerMac,64)]);
      }
      const q=await client.query(`update installation_jobs set call_center_verified=true,router_data_verified=$2,status='CALL_CENTER_REVIEW',updated_at=now()
        where id=$1 returning id,status,workflow_type,call_center_verified,router_data_verified`,[id,routerVerified]);
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id,metadata)
        values($1,$2,'CALL_CENTER_VERIFIED',$3,$4::jsonb)`,[job.tenant_id,id,me,JSON.stringify({confirmed:true,confirmedSite:true})]);
      return q.rows[0];
    }

    if(action==='schedule'){
      assertStatus(job, ['CALL_CENTER_REVIEW'], 'SCHEDULE_REQUIRES_CALL_CENTER_REVIEW');
      if(!job.call_center_verified) fail('CALL_CENTER_VERIFICATION_REQUIRED',409);
      const at=new Date(body.visitScheduledAt); if(Number.isNaN(at.getTime())) fail('VISIT_TIME_INVALID');
      const q=await client.query(`update installation_jobs set visit_scheduled_at=$2,status='SCHEDULED',updated_at=now()
        where id=$1 and status='CALL_CENTER_REVIEW'
        returning id,status,visit_scheduled_at,sla_deadline_at,migration_work_order_date,migration_completion_deadline_at`,[id,at]);
      if(!q.rows[0]) fail('SCHEDULE_STATUS_CONFLICT',409);
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id,metadata)
        values($1,$2,'VISIT_SCHEDULED',$3,$4::jsonb)`,[job.tenant_id,id,me,JSON.stringify({visitScheduledAt:at.toISOString()})]);
      return q.rows[0];
    }

    if(action==='dispatch'){
      assertStatus(job, ['SCHEDULED'], 'DISPATCH_REQUIRES_SCHEDULED');
      if(!job.call_center_verified) fail('CALL_CENTER_VERIFICATION_REQUIRED',409);
      // Atomic: lock candidate technician row; exclude technicians already reserved on open jobs
      const r=await client.query(`
        with candidate as (
          select t.id as technician_id,t.name,t.skills,t.current_gps,t.current_gps_captured_at,
            ST_Distance(t.current_gps,j.site_location) as distance_m
          from technicians t
          join fiberos_current_technician_gis v on v.id=t.id
          join installation_jobs j on j.id=$1
          where j.status='SCHEDULED'
            and t.is_active=true and t.current_gps is not null
            and t.tenant_id=j.tenant_id
            and t.current_gps_captured_at>=now()-interval '15 minutes'
            and not exists (
              select 1 from installation_jobs oj
              where oj.technician_id=t.id
                and oj.status in ('DISPATCHED','TECHNICIAN_ACCEPTED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION')
            )
            and not exists (
              select 1 from fault_jobs fj
              where fj.technician_id=t.id
                and fj.status in ('DISPATCHED','TECHNICIAN_ACCEPTED','IN_PROGRESS','AWAITING_CUSTOMER_CONFIRMATION')
            )
            and exists (
              select 1 from user_preferences up
              where up.user_id=t.user_id and up.tenant_id=j.tenant_id
            )
            and ST_DWithin(t.current_gps,j.site_location,50000)
          order by t.current_gps <-> j.site_location,t.id asc
          for update of t skip locked
          limit 1
        )
        select * from candidate
      `,[id]);
      if(!r.rows[0]) fail('NO_AVAILABLE_TECHNICIAN_IN_SCOPE',409);
      const tech=r.rows[0];
      const trackingToken=crypto.randomBytes(32).toString('base64url');
      const trackingExpires=new Date(Date.now()+48*3600000);
      const trackingHash=trackingTokenHash(trackingToken);
      const q=await client.query(`update installation_jobs set technician_id=$2,status='DISPATCHED',
        customer_tracking_token_hash=$3,customer_tracking_token_ciphertext=$5,customer_tracking_expires_at=$4,
        customer_tracking_revoked=false,updated_at=now()
        where id=$1 and status='SCHEDULED'
        returning id,status,technician_id`,[id,tech.technician_id,trackingHash,trackingExpires,encryptText(trackingToken)]);
      if(!q.rows[0]) fail('DISPATCH_STATUS_CONFLICT',409);
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id,metadata)
        values($1,$2,'TECHNICIAN_DISPATCHED',$3,$4::jsonb)`,[job.tenant_id,id,me,JSON.stringify({technicianId:tech.technician_id,distanceMeters:Number(tech.distance_m)})]);
      return {jobId:id,technician:tech,trackingApiPath:'/v1/public/installations/tracking/'+trackingToken,trackingPagePath:'/customer-tracking.html?token='+encodeURIComponent(trackingToken),trackingExpiresAt:trackingExpires.toISOString(),customerNotificationStatus:'UNVERIFIED_PROVIDER'};
    }

if(action==='accept'){
      assertStatus(job, ['DISPATCHED'], 'ACCEPT_REQUIRES_DISPATCHED');
      const q=await client.query(`update installation_jobs set status='TECHNICIAN_ACCEPTED',technician_accepted_at=now(),updated_at=now()
        where id=$1 and status='DISPATCHED'
        returning id,status,technician_id,visit_scheduled_at,sla_deadline_at,migration_work_order_date,migration_completion_deadline_at`,[id]);
      if(!q.rows[0]) fail('ACCEPT_STATUS_CONFLICT',409);
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id) values($1,$2,'TECHNICIAN_ACCEPTED',$3)`,[job.tenant_id,id,me]);
      // Message payload stores opaque reference only — no bearer tracking token
      const recipients=[job.followup_mobile_1,job.followup_mobile_2].map(x=>String(x||'').trim()).filter(Boolean);
      const unique=[...new Set(recipients)];
      for(const recipient of unique){
        await client.query(`insert into installation_messages(tenant_id,job_id,channel,recipient,template_key,payload,status)
          values($1,$2,'WHATSAPP',$3,'CUSTOMER_TECHNICIAN_TRACKING_LINK',$4::jsonb,'UNVERIFIED')`,
          [job.tenant_id,id,recipient,JSON.stringify({jobId:id,messageRef:crypto.createHash('sha256').update(id+':'+recipient).digest('hex').slice(0,16),expiresAt:job.customer_tracking_expires_at||null,tokenMaterial:'RECONSTRUCT_AT_PROVIDER_DISPATCH_ONLY'})]);
      }
      return Object.assign({},q.rows[0],{customerNotificationStatus:'UNVERIFIED_PROVIDER',notifiedRecipients:unique.length});
    }

    if(action==='start'){
      assertStatus(job, ['TECHNICIAN_ACCEPTED'], 'START_REQUIRES_TECHNICIAN_ACCEPTED');
      const q=await client.query(`update installation_jobs set status='IN_PROGRESS',started_at=coalesce(started_at,now()),updated_at=now()
        where id=$1 and status='TECHNICIAN_ACCEPTED' returning id,status,started_at`,[id]);
      if(!q.rows[0]) fail('START_STATUS_CONFLICT',409);
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id) values($1,$2,'WORK_STARTED',$3)`,[job.tenant_id,id,me]);
      return q.rows[0];
    }

    if(action==='evidence'){
      assertStatus(job, ['IN_PROGRESS'], 'EVIDENCE_REQUIRES_IN_PROGRESS');
      const evidenceType=normalizeEvidenceType(required(body.evidenceType,'EVIDENCE_TYPE',64));
      const contentSha=requireHexSha256(body.contentSha256,'EVIDENCE_SHA256_INVALID');
      const lat=body.lat!=null?coordinate(body.lat,'LAT',-90,90):null;
      const lon=body.lon!=null?coordinate(body.lon,'LON',-180,180):null;
      const storageRef=body.storageReference!=null?text(body.storageReference,500):null;
      // Never trust client claims of STORAGE_VERIFIED
      if(body.storageStatus==='STORAGE_VERIFIED' || body.storage_status==='STORAGE_VERIFIED'){
        fail('STORAGE_VERIFIED_CLIENT_CLAIM_FORBIDDEN',400);
      }
      const storageStatus=resolveStorageStatus(storageRef);
      const meta=Object.assign({}, body.metadata||{}, {
        clientReportedStorage:Boolean(storageRef),
        contentBytesNotReceived:true,
        integrityNote:'CLIENT_HASH_ONLY_UNTIL_PROVIDER_VERIFIED'
      });
      await client.query(`insert into installation_evidence(tenant_id,job_id,evidence_type,captured_at,gps,content_sha256,storage_reference,storage_status,metadata,actor_id)
        values($1,$2,$3,now(),case when $4::float8 is null then null else ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326)::geography end,$6,$7,$8,$9::jsonb,$10)`,
        [job.tenant_id,id,evidenceType,lat,lon,contentSha,storageRef,storageStatus,JSON.stringify(meta),me]);
      const allEv=await client.query(`select evidence_type,storage_status from installation_evidence where job_id=$1`,[id]);
      let nextStatus='IN_PROGRESS';
      if(requiredEvidenceSatisfied(allEv.rows, job.workflow_type)){
        nextStatus='AWAITING_CUSTOMER_CONFIRMATION';
        await client.query(`update installation_jobs set status=$2,updated_at=now() where id=$1 and status='IN_PROGRESS'`,[id,nextStatus]);
      }
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id,metadata)
        values($1,$2,'EVIDENCE_RECORDED',$3,$4::jsonb)`,[job.tenant_id,id,me,JSON.stringify({
          evidenceType,contentSha256:contentSha,storageReference:storageRef,storageStatus,nextStatus,
          requiredEvidence:requiredEvidenceTypes(job.workflow_type)
        })]);
      return {
        jobId:id,
        evidenceType,
        contentSha256:contentSha,
        status:nextStatus,
        storageStatus,
        storageDurable:false,
        storageVerified:storageStatus==='STORAGE_VERIFIED',
        clientHashOnly:storageStatus==='CLIENT_HASH_ONLY',
        syntheticData:false
      };
    }

if(action==='feedback'){
      assertStatus(job, ['AWAITING_CUSTOMER_CONFIRMATION'], 'FEEDBACK_REQUIRES_AWAITING_CUSTOMER_CONFIRMATION');
      if(body.accepted!==true) fail('CUSTOMER_ACCEPTANCE_REQUIRED',400);
      const rating=body.rating==null?null:Number(body.rating);
      if(rating!=null && (!Number.isInteger(rating) || rating<1 || rating>5)) fail('RATING_INVALID');
      const feedbackText=body.feedback!=null?text(body.feedback,2000):null;
      let method=text(body.verificationMethod||'CALL_CENTER_OPERATOR_CONFIRMED',80);
      if(!ALLOWED_ACCEPTANCE_METHODS.has(method)){
        // Client may not claim OTP/PROVIDER proof
        fail('ACCEPTANCE_VERIFICATION_METHOD_NOT_SERVER_PROVEN',400);
      }
      const q=await client.query(`update installation_jobs set
        customer_acceptance=true,
        customer_satisfaction_rating=coalesce($2,customer_satisfaction_rating),
        customer_feedback=coalesce($3,customer_feedback),
        acceptance_verification_method=$4,
        updated_at=now()
        where id=$1 and status='AWAITING_CUSTOMER_CONFIRMATION'
        returning id,status,customer_acceptance,customer_satisfaction_rating,customer_feedback,acceptance_verification_method`,
        [id,rating,feedbackText,method]);
      if(!q.rows[0]) fail('FEEDBACK_STATUS_CONFLICT',409);
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id,metadata)
        values($1,$2,'CUSTOMER_ACCEPTANCE_ATTESTATION',$3,$4::jsonb)`,
        [job.tenant_id,id,me,JSON.stringify({
          accepted:true,
          rating:rating,
          feedbackPersisted:feedbackText!=null,
          verificationMethod:method,
          proofLevel:'OPERATOR_ATTESTATION_NOT_CRYPTOGRAPHIC',
          contentSha256:null,
          binaryEvidence:false
        })]);
      return Object.assign({},q.rows[0],{
        attestation:'CUSTOMER_ACCEPTANCE_ATTESTATION',
        syntheticData:false,
        binaryEvidence:false
      });
    }

if(action==='complete'){
      assertStatus(job, ['AWAITING_CUSTOMER_CONFIRMATION'], 'COMPLETE_REQUIRES_AWAITING_CUSTOMER_CONFIRMATION');
      if(job.customer_acceptance!==true){
        fail('CUSTOMER_ACCEPTANCE_REQUIRED',409);
      }
      const evidence=await client.query(`select evidence_type,storage_status from installation_evidence where job_id=$1`,[id]);
      assertCompletionEvidence(evidence.rows, job.workflow_type);
      const dl=effectiveDeadline(job);
      const breached=dl && !Number.isNaN(dl.getTime()) && Date.now()>dl.getTime();
      const q=await client.query(`update installation_jobs set status='COMPLETED',completed_at=now(),updated_at=now(),
        central_penalty_status=case when $2 then 'ELIGIBLE' else central_penalty_status end
        where id=$1 and status='AWAITING_CUSTOMER_CONFIRMATION' and customer_acceptance=true
        returning id,status,completed_at,sla_deadline_at,migration_completion_deadline_at,central_penalty_status,workflow_type,customer_acceptance,customer_satisfaction_rating`,[id,breached]);
      if(!q.rows[0]) fail('COMPLETE_STATUS_CONFLICT',409);
      await client.query(`insert into installation_events(tenant_id,job_id,event_type,actor_id,metadata)
        values($1,$2,'COMPLETED',$3,$4::jsonb)`,[job.tenant_id,id,me,JSON.stringify({
          breached:!!breached,
          effectiveDeadline:dl?dl.toISOString():null,
          evidence:evidence.rows,
          requiredEvidence:requiredEvidenceTypes(job.workflow_type),
          customerAcceptance:true,
          clientHashCompletionAllowed:allowClientHashCompletion()
        })]);
      return q.rows[0];
    }

fail('UNKNOWN_INSTALLATION_ACTION',404);
  });
  return send(res,200,{ok:true,result});
}

async function readJob(db,principal,id,send,res){
  const a=auth(principal,['call_center','dispatcher','technician','fiber_technician','team_lead','qc','ops_manager','area_supervisor','exec','sysadmin']);
  if(!a.ok) return send(res,a.status,a.body); dbRequired(db);
  const result=await withJob(db,principal,id,async(client,job)=>{
    const [events,evidence,messages,router]=await Promise.all([
      client.query('select event_type,actor_id,occurred_at,ST_Y(gps::geometry) lat,ST_X(gps::geometry) lon,metadata from installation_events where job_id=$1 order by occurred_at',[id]),
      client.query('select evidence_type,captured_at,ST_Y(gps::geometry) lat,ST_X(gps::geometry) lon,content_sha256,storage_reference,metadata from installation_evidence where job_id=$1 order by created_at',[id]),
      client.query('select channel,recipient,template_key,status,provider_message_id,queued_at,sent_at,delivered_at from installation_messages where job_id=$1 order by queued_at desc',[id]),
      client.query('select router_serial,router_model,router_mac,router_label_scan_sha256,installation_video_sha256,verified_by_call_center from router_installation_details where job_id=$1',[id])
    ]);
    return {job,events:events.rows,evidence:evidence.rows,messages:messages.rows,router:router.rows[0]||null};
  });
  return send(res,200,{ok:true,result,syntheticData:false,authority:'DATABASE_BACKED_INSTALLATION_STATUS'});
}

async function tracking(db,principal,id,send,res){
  const a=auth(principal,['call_center','dispatcher','technician','fiber_technician','team_lead','qc','ops_manager','area_supervisor','exec','sysadmin']);
  if(!a.ok) return send(res,a.status,a.body); dbRequired(db);
  const result=await withJob(db,principal,id,async(client,job)=>{
    if(!job.technician_id){
      return {jobId:id,status:job.status,visitScheduledAt:job.visit_scheduled_at,technician:null,
      migrationWorkOrderDate:job.migration_work_order_date,migrationCompletionDeadlineAt:job.migration_completion_deadline_at,
      slaDeadlineAt:job.sla_deadline_at,authority:'DATABASE_BACKED_LIVE_POSITION',syntheticData:false};
    }
    const r=await client.query(`select t.id,t.name,t.is_active,
      ST_Y(tp.position::geometry) lat,ST_X(tp.position::geometry) lon,tp.captured_at,tp.accuracy_meters,tp.heading_degrees,tp.speed_mps
      from technicians t
      left join lateral(select * from technician_positions p where p.technician_id=t.id order by p.captured_at desc,p.id desc limit 1) tp on true
      where t.id=$1::uuid and t.is_active=true
      limit 1`,[job.technician_id]);
    const tech=r.rows[0]||null;
    return {jobId:id,status:job.status,visitScheduledAt:job.visit_scheduled_at,
      technician:tech?{id:tech.id,name:tech.name,active:tech.is_active===true,lat:tech.lat,lon:tech.lon,capturedAt:tech.captured_at,accuracyMeters:tech.accuracy_meters,headingDegrees:tech.heading_degrees,speedMps:tech.speed_mps}:null,
      migrationWorkOrderDate:job.migration_work_order_date,migrationCompletionDeadlineAt:job.migration_completion_deadline_at,
      slaDeadlineAt:job.sla_deadline_at,authority:'DATABASE_BACKED_LIVE_POSITION',syntheticData:false};
  });
  return send(res,200,{ok:true,result});
}


async function publicTracking(req,res,token,db,send){
  dbRequired(db);
  const hash=trackingTokenHash(token);
  const client=await db.connect();
  let result;
  try{
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE fiberos_app');
    await client.query('select set_config(\'fiberos.public_tracking_token_hash\',$1,true)',[hash]);
    result=await client.query(
      `select j.id,j.status,j.visit_scheduled_at,j.customer_tracking_expires_at,
        t.id technician_id,t.name,t.is_active as technician_active,
        ST_Y(tp.position::geometry) lat,ST_X(tp.position::geometry) lon,tp.captured_at,tp.accuracy_meters,tp.heading_degrees,tp.speed_mps
       from installation_jobs j
       left join technicians t on t.id=j.technician_id and t.is_active=true
       left join lateral(select * from technician_positions p where p.technician_id=j.technician_id order by p.captured_at desc,p.id desc limit 1) tp on true
       where j.customer_tracking_token_hash=$1
         and j.customer_tracking_revoked=false
         and j.customer_tracking_expires_at > now()
       limit 1`,
      [hash]
    );
    await client.query('COMMIT');
  }catch(e){try{await client.query('ROLLBACK')}catch(_){};throw e}
  finally{client.release()}
  if(!result.rows[0]) return send(res,404,{ok:false,error:'TRACKING_LINK_INVALID_OR_EXPIRED'});
  const r=result.rows[0];
  return send(res,200,{ok:true,tracking:{
    status:r.status,visitScheduledAt:r.visit_scheduled_at,expiresAt:r.customer_tracking_expires_at,
    technician:r.technician_id?{name:r.name,status:r.technician_active===true?'ACTIVE':'INACTIVE',lat:r.lat,lon:r.lon,capturedAt:r.captured_at,accuracyMeters:r.accuracy_meters,headingDegrees:r.heading_degrees,speedMps:r.speed_mps}:null
  },syntheticData:false,authority:'DATABASE_BACKED_PUBLIC_TRACKING'});
}

async function handleInstallation(req,res,ctx){
  const {method,path,body,principal,db,send}=ctx;
  const publicMatch=String(path).match(/^\/v1\/public\/installations\/tracking\/([^/]+)$/);
  if(method==='GET' && publicMatch) return publicTracking(req,res,publicMatch[1],db,send);
  if(method==='POST' && path==='/v1/installations/intake') return createIntake(db,principal,body,send,res);
  const p=parsePath(path); if(!p) return null;
  if(method==='GET' && p.action==='tracking') return tracking(db,principal,p.id,send,res);
  if(method==='GET' && !p.action) return readJob(db,principal,p.id,send,res);
  if(method==='POST') return updateJob(db,principal,p.id,p.action,body,send,res);
  return null;
}
module.exports={handleInstallation, requiredEvidenceTypes, normalizeEvidenceType, assertCompletionEvidence, requiredEvidenceSatisfied, resolveStorageStatus};
