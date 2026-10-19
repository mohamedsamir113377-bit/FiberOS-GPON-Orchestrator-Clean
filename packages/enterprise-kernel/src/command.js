'use strict';
const crypto=require('crypto');
const {canonical}=require('./truthFabric');
function hashCommand(c){return crypto.createHash('sha256').update(JSON.stringify(canonical(c))).digest('hex');}
function createProofCarryingCommand(input){
 input=input||{}; for(const k of ['commandId','decisionId','action','entityId'])if(!input[k])throw new Error('COMMAND_'+k.toUpperCase()+'_REQUIRED');
 if(!Array.isArray(input.evidenceRefs)||!input.evidenceRefs.length)throw new Error('COMMAND_EVIDENCE_REQUIRED');
 if(!input.rollback)throw new Error('COMMAND_ROLLBACK_REQUIRED');
 const invariants=Object.assign({capacityOk:false,noCollateralOutage:false,rollbackPossible:false},input.invariants||{});
 if(Object.values(invariants).some(v=>v!==true))throw new Error('COMMAND_INVARIANTS_FAILED');
 const c={commandId:String(input.commandId),decisionId:String(input.decisionId),action:String(input.action),entityId:String(input.entityId),evidenceRefs:input.evidenceRefs.slice(),invariants,rollback:input.rollback,actor:input.actor||null,createdAt:input.createdAt||new Date().toISOString()};
 return Object.freeze({...c,commandHash:hashCommand(c)});
}
function verifyProofCommand(cmd){
 if(!cmd||typeof cmd!=='object'||typeof cmd.commandHash!=='string') return {ok:false,reason:'COMMAND_HASH_MISSING'};
 const c={...cmd}; delete c.commandHash;
 const h=hashCommand(c);
 const expected=Buffer.from(h,'hex');
 const supplied=Buffer.from(cmd.commandHash,'hex');
 if(supplied.length!==expected.length) return {ok:false,reason:'COMMAND_HASH_INVALID_LENGTH',calculated:h};
 return {ok:crypto.timingSafeEqual(expected,supplied),calculated:h};
}
module.exports={createProofCarryingCommand,verifyProofCommand};
