'use strict';
const fs = require('fs');
const path = require('path');
const { createRegistry } = require('../../../../packages/assurance/src');
const interfaceContracts = require('../../../../packages/interface-contracts/src/index');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname,'../../../../config/html-feature-parity.json'),'utf8'));
const registry = createRegistry(catalog.capabilities);
const { requireVerifiedPrincipal, requireAnyRole } = require('../requireAuth');
function handleAssurance(req,res,ctx){
  const {method,path:route,principal,send}=ctx;
  if(method!=='GET'||route!=='/v1/assurance/capabilities') return null;
  const auth=requireVerifiedPrincipal(principal,process.env); if(!auth.ok)return send(res,auth.status,auth.body);
  const g=requireAnyRole(principal,['ops_manager','area_supervisor','exec','sysadmin','dispatcher','call_center','technician']); if(!g.ok)return send(res,g.status,g.body);
  return send(res,200,{ok:true,source:catalog.source,sourceAuthority:catalog.sourceAuthority,summary:registry.summary(),capabilities:registry.list(),interfaceContracts:interfaceContracts.summary(),productionClaim:'PROHIBITED_UNTIL_MATRIX_EVIDENCE'});
}
module.exports={handleAssurance};
