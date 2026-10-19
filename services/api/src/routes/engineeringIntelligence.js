'use strict';
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
const { withPrincipal } = require('../../../../packages/db/src/session');
const { buildEngineeringIntelligence } = require('../../../../packages/ftth-engineering-intelligence/src');
const ROLES=Object.freeze(['technician','team_lead','dispatcher','call_center','ops_manager','area_supervisor','exec','sysadmin','qc']);
async function handleEngineeringIntelligence(req,res,ctx){
 const {method,path,body,principal,db,send}=ctx;
 if(method!=='POST'||path!=='/v1/intelligence/engineering') return null;
 const auth=requireVerifiedPrincipal(principal,process.env); if(!auth.ok)return send(res,auth.status,auth.body);
 const role=requireAnyRole(principal,ROLES); if(!role.ok)return send(res,role.status,role.body);
 if(!db||!db.configured)return send(res,503,{ok:false,error:'DB_NOT_CONFIGURED',authority:'FIBEROS_DATABASE_RLS'});
 const b=body||{}; const request=b.request||b;
 if(Object.prototype.hasOwnProperty.call(b,'tenantId')||Object.prototype.hasOwnProperty.call(request,'tenantId')) return send(res,400,{ok:false,error:'FTTH_ENGINEERING_TENANT_ID_FORBIDDEN',authority:'POSTGRESQL_RLS_SESSION'});
 try { const result=await withPrincipal(db,principal,client=>buildEngineeringIntelligence(client,request)); return send(res,200,result); }
 catch(e){ const status=/^FTTH_ENGINEERING_/.test(String(e.code||e.message))?400:503; return send(res,status,{ok:false,error:e.code||e.message||'FTTH_ENGINEERING_INTELLIGENCE_FAILED',authority:'FIBEROS_DATABASE_RLS',readOnly:true,advisoryOnly:true,executionAuthorized:false}); }
}
module.exports={handleEngineeringIntelligence};
