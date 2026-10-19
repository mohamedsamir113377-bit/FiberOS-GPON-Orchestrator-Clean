#!/usr/bin/env node
'use strict';

const { info: logInfo, error: logError } = require('../../../packages/observability/src/logger');
const { loadServerConfig } = require('../../../packages/core/src/config');
const { createWorkerPool } = require('../../../packages/db/src/index');
const { loadDeliveryAdapter, deliver } = require('./outboxDelivery');
const { nextPortalRunAt, renderPortalReportCsv, renderPortalReportEmail, portalSha256 } = require('../../../packages/productization/src');

const cfg=loadServerConfig(process.env);
const db=createWorkerPool(process.env);
const MAX_ATTEMPTS=Number(process.env.OUTBOX_MAX_ATTEMPTS||8);
const LEASE_MS=Number(process.env.OUTBOX_LEASE_MS||30000);
if(!Number.isInteger(LEASE_MS)||LEASE_MS<1000) throw new Error('OUTBOX_LEASE_MS_INVALID');
const BATCH_SIZE=Number(process.env.OUTBOX_BATCH_SIZE||25);
const BASE_BACKOFF_MS=Number(process.env.OUTBOX_BASE_BACKOFF_MS||1000);
const MAX_BACKOFF_MS=Number(process.env.OUTBOX_MAX_BACKOFF_MS||300000);
const WORKER_ID=process.env.WORKER_ID||require('crypto').randomUUID();

let adapter=null;
function backoffMs(attempts){return Math.min(MAX_BACKOFF_MS,BASE_BACKOFF_MS*Math.pow(2,Math.max(0,attempts-1)));}

async function withWorkerTransaction(fn){
  if(!db||!db.configured||!db.pool)throw new Error(db&&db.reason?db.reason:'DB_NOT_CONFIGURED');
  const client=await db.pool.connect();
  try{
    await client.query('begin');
    await client.query('set local role fiberos_worker');
    const result=await fn(client);
    await client.query('commit');
    return result;
  }catch(e){
    try{await client.query('rollback');}catch(e2){logError('db_rollback_failed',{worker:WORKER_ID,error:String(e2&&e2.message||e2)});}
    throw e;
  }finally{client.release();}
}

function portalPreviousPeriod(cadence, end) {
  const d = new Date(end);
  if (cadence === 'weekly') return new Date(d.getTime() - 7 * 86400000);
  if (cadence === 'yearly') { const out = new Date(d); out.setUTCFullYear(out.getUTCFullYear() - 1); return out; }
  const out = new Date(d); out.setUTCMonth(out.getUTCMonth() - 1); return out;
}

function portalScheduleShape(row) {
  return { cadence: row.cadence, weekday: row.weekday == null ? null : Number(row.weekday),
    dayOfMonth: row.day_of_month == null ? null : Number(row.day_of_month),
    monthOfYear: row.month_of_year == null ? null : Number(row.month_of_year),
    hour: Number(row.hour), minute: Number(row.minute), timezone: row.timezone };
}

async function processPortalScheduledReports(limit = 10) {
  return withWorkerTransaction(async client => {
    const due = await client.query(`select id,tenant_id,name,report_type,report_format,cadence,weekday,day_of_month,month_of_year,
      hour,minute,timezone,recipients,next_run_at,consecutive_failures from portal_report_schedules
      where active=true and next_run_at <= now() order by next_run_at asc,id asc for update skip locked limit $1`,
      [Math.max(1, Math.min(50, Number(limit) || 10))]);
    let generated=0, failed=0; const results=[];
    for (const schedule of due.rows) {
      const runAt=new Date(schedule.next_run_at), periodEnd=runAt, periodStart=portalPreviousPeriod(schedule.cadence,periodEnd);
      const reportId=require('node:crypto').randomUUID(), idempotencyKey='schedule:'+schedule.id+':'+runAt.toISOString();
      try {
        const result=await client.query(`select fiberos_portal_worker_report($1::uuid,$2::text,$3::timestamptz,$4::timestamptz) as report`,
          [schedule.tenant_id,schedule.report_type,periodStart.toISOString(),periodEnd.toISOString()]);
        const report=result.rows[0]?.report; if(!report) throw new Error('PORTAL_REPORT_EMPTY');
        const renderedCsv=renderPortalReportCsv(report);
        const contentHash=portalSha256({reportType:schedule.report_type,periodStart:periodStart.toISOString(),periodEnd:periodEnd.toISOString(),report});
        const tenantName=report.tenant?.tenantName||report.tenant?.tenant_name||'FiberOS tenant';
        const bodyText=renderPortalReportEmail({tenantName,reportType:schedule.report_type,generatedAt:new Date().toISOString(),periodStart:periodStart.toISOString(),periodEnd:periodEnd.toISOString(),report});
        const event=await client.query(`insert into outbox_events(tenant_id,aggregate_type,aggregate_id,event_type,payload,publish_status)
          values($1::uuid,'portal_report',$2::text,'portal.report.email',$3::jsonb,'pending') returning event_id,created_at`,
          [schedule.tenant_id,reportId,JSON.stringify({channel:'email',recipients:Array.isArray(schedule.recipients)?schedule.recipients:[],
            subject:'[FiberOS] '+String(schedule.name||'Scheduled report')+' — '+String(schedule.report_type),bodyText,csv:renderedCsv,
            attachmentFilename:'fiberos-'+String(schedule.report_type)+'-'+runAt.toISOString().slice(0,10)+'.csv',reportId,reportType:schedule.report_type,
            periodStart:periodStart.toISOString(),periodEnd:periodEnd.toISOString(),contentSha256:contentHash,deliveryContract:'FIBEROS_PORTAL_EMAIL_V1'})]);
        await client.query(`insert into portal_report_runs(id,tenant_id,requested_by,schedule_id,report_type,report_format,status,period_start,period_end,generated_at,source_snapshot,report_payload,rendered_csv,content_sha256,outbox_event_id,idempotency_key)
          values($1::uuid,$2::uuid,null,$3::uuid,$4,$5,'generated',$6,$7,now(),$8::jsonb,$9::jsonb,$10,$11,$12::uuid,$13)`,
          [reportId,schedule.tenant_id,schedule.id,schedule.report_type,schedule.report_format,periodStart.toISOString(),periodEnd.toISOString(),
            JSON.stringify(report.sourceSnapshot||{}),JSON.stringify(report),schedule.report_format==='csv'?renderedCsv:null,contentHash,event.rows[0].event_id,idempotencyKey]);
        const nextRun=nextPortalRunAt(portalScheduleShape(schedule),new Date());
        await client.query(`update portal_report_schedules set last_run_at=$1,next_run_at=$2,last_error=null,consecutive_failures=0,updated_at=now()
          where id=$3 and tenant_id=$4`,[new Date().toISOString(),nextRun.toISOString(),schedule.id,schedule.tenant_id]);
        generated++; results.push({scheduleId:schedule.id,reportId,queuedEmail:true,nextRunAt:nextRun.toISOString()});
      } catch(error) {
        const retryMinutes=Math.min(60,5*Math.pow(2,Math.min(4,Number(schedule.consecutive_failures||0)))),retryAt=new Date(Date.now()+retryMinutes*60000);
        await client.query(`update portal_report_schedules set next_run_at=$1,last_error=$2,consecutive_failures=consecutive_failures+1,updated_at=now()
          where id=$3 and tenant_id=$4`,[retryAt.toISOString(),String(error?.message||error).slice(0,500),schedule.id,schedule.tenant_id]);
        failed++; results.push({scheduleId:schedule.id,queuedEmail:false,retryAt:retryAt.toISOString(),error:String(error?.message||error)});
      }
    }
    return {processed:due.rows.length,generated,failed,results};
  });
}

async function processSyncBatch(limit){
  const r=await withWorkerTransaction(client=>client.query('select fiberos_process_sync_batch($1::integer) as result',[limit]));
  return r.rows[0]&&r.rows[0].result?r.rows[0].result:{processed:0,rejected:0,conflicts:0,results:[]};
}

async function claimBatch(limit){
 return withWorkerTransaction(client=>client.query(`with claimed as (
   select id from outbox_events
   where publish_status='pending'
     and (next_attempt_at is null or next_attempt_at <= now())
     and (locked_until is null or locked_until < now())
   order by created_at asc for update skip locked limit $1
 ) update outbox_events o set locked_by=$2,locked_until=now()+($3::text||' milliseconds')::interval,attempts=o.attempts+1
 from claimed c where o.id=c.id
 returning o.id,o.event_id,o.aggregate_type,o.aggregate_id,o.event_type,o.payload,o.attempts`,[limit,WORKER_ID,LEASE_MS]));
}

async function mark(id,status,error,nextAttemptAt=null){
 return withWorkerTransaction(client=>client.query(`update outbox_events set publish_status=$2,last_error=$3,
   published_at=case when $2='published' then now() else published_at end,
   next_attempt_at=$5,locked_by=null,locked_until=null
   where id=$1 and locked_by=$4`,[id,status,error||null,WORKER_ID,nextAttemptAt]));
}

async function drainOnce(){
 if(!db.configured)return {ok:false,reason:db.reason||'DB_NOT_CONFIGURED',drained:0,failed:0,syncProcessed:0};

 let scheduledReports={processed:0,generated:0,failed:0,results:[]};
 try{scheduledReports=await processPortalScheduledReports(Number(process.env.PORTAL_REPORT_SCHEDULE_BATCH_SIZE||10));}
 catch(e){scheduledReports={processed:0,generated:0,failed:1,results:[{error:String(e.message||e)}]};}

 let sync;
 try{sync=await processSyncBatch(BATCH_SIZE);}
 catch(e){return {ok:false,reason:'SYNC_PROCESSOR_FAILED',detail:String(e.message||e),drained:null,failed:null,syncProcessed:0};}

 let rows;
 try{rows=(await claimBatch(BATCH_SIZE)).rows;}
 catch(e){return {ok:false,reason:String(e.message||e),drained:null,failed:null,syncProcessed:Number(sync.processed||0)};}

 if(rows.length && !adapter){
   try{adapter=loadDeliveryAdapter(process.env);}
   catch(e){return {ok:false,reason:e.message,drained:0,failed:rows.length,syncProcessed:Number(sync.processed||0),syncRejected:Number(sync.rejected||0)};}
 }

 let done=0,failed=0,deadLettered=0;
 for(const row of rows){
   try{
     if(Number(row.attempts)>MAX_ATTEMPTS){await mark(row.id,'dead_letter','MAX_ATTEMPTS_EXCEEDED');deadLettered++;continue;}
     await deliver(adapter,row,{workerId:WORKER_ID,attempt:Number(row.attempts),idempotencyKey:String(row.event_id)});
     await mark(row.id,'published',null,null);done++;
   }catch(e){
     const terminal=Number(row.attempts)>=MAX_ATTEMPTS;
     const next=terminal?null:new Date(Date.now()+backoffMs(Number(row.attempts))).toISOString();
     try{await mark(row.id,terminal?'dead_letter':'pending',String(e.message||e),next);}
     catch(markError){logError('outbox_mark_failed',{worker:WORKER_ID,eventId:row.event_id,error:String(markError&&markError.message||markError)});}
     failed++;if(terminal)deadLettered++;
   }
 }
 return {ok:true,drained:done,failed,deadLettered,maxAttempts:MAX_ATTEMPTS,workerId:WORKER_ID,deliveryConfigured:Boolean(adapter),syncProcessed:Number(sync.processed||0),syncRejected:Number(sync.rejected||0),syncConflicts:Number(sync.conflicts||0),scheduledReports};
}

async function main(){
 logInfo('fiberos_worker_started',{workerId:WORKER_ID,intervalMs:cfg.workerIntervalMs,database:db.configured,productionHold:cfg.productionHold,maxAttempts:MAX_ATTEMPTS});
 const r=await drainOnce();logInfo('fiberos_worker_drain',{...r});
 if(process.env.WORKER_ONCE==='1'){await db.end();process.exit(r.ok?0:1);}
 const timer=setInterval(async()=>logInfo('fiberos_worker_drain',{...(await drainOnce())}),cfg.workerIntervalMs);
 function shutdown(){clearInterval(timer);Promise.resolve(db.end()).finally(()=>process.exit(0));}
 process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
main().catch(e=>{logError('fiberos_worker_fatal',{error:String(e&&e.message||e)});process.exit(1);});
