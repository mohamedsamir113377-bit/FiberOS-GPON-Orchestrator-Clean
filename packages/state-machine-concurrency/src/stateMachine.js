
const transitions = new Map([
  ["PROPOSED", new Set(["VERIFIED","CANCELLED"])],
  ["VERIFIED", new Set(["APPROVED","CANCELLED"])],
  ["APPROVED", new Set(["AUTHORIZED","CANCELLED"])],
  ["AUTHORIZED", new Set(["EXECUTING","CANCELLED"])],
  ["EXECUTING", new Set(["COMMITTED","ROLLBACK_PENDING","FAILED"])],
  ["ROLLBACK_PENDING", new Set(["ROLLED_BACK","FAILED"])],
  ["ROLLED_BACK", new Set([])],
  ["COMMITTED", new Set([])],
  ["FAILED", new Set([])],
  ["CANCELLED", new Set([])]
]);

export function canTransition(from,to){
  return transitions.get(from)?.has(to)===true;
}
export function transition(state,to){
  if(!canTransition(state.status,to)) throw new Error("INVALID_STATE_TRANSITION");
  return {...state,status:to,stateVersion:state.stateVersion+1};
}
export function assertMonotonicVersion(base,current){
  if(base!==current) throw new Error("STATE_VERSION_CONFLICT");
}
export function executeOnce(record, operationId){
  if(!record || typeof record !== "object" || !operationId) throw new TypeError("EXECUTION_RECORD_INVALID");
  const prior = record.executions == null ? [] : record.executions instanceof Set ? [...record.executions] : record.executions;
  if(!Array.isArray(prior) || prior.some(id => typeof id !== "string")) throw new TypeError("EXECUTION_RECORD_INVALID");
  const executions=new Set(prior);
  if(executions.has(String(operationId))) throw new Error("DUPLICATE_EXECUTION");
  executions.add(String(operationId));
  return Object.freeze({...record,executions:Object.freeze([...executions])});
}
export function authorizeForState(record){
  if(record.status!=="APPROVED") throw new Error("AUTHORIZATION_REQUIRES_APPROVED");
  if(record.authorizationEpoch!==record.currentEpoch) throw new Error("STALE_AUTHORIZATION");
  if(record.decisionHash!==record.approvalDecisionHash) throw new Error("APPROVAL_DECISION_MISMATCH");
  return true;
}
export function commitWithVersion(store,expectedVersion,mutate){
  if(store.version!==expectedVersion) throw new Error("VERSION_CONFLICT");
  const next=mutate(store);
  return {...next,version:store.version+1};
}
export function recover(store){
  if(store.inFlight){
    return {...store,recoveryRequired:true,status:"RECOVERY_REQUIRED"};
  }
  return {...store,recoveryRequired:false};
}
export function resolveRecovery(store,outcome){
  if(store.status!=="RECOVERY_REQUIRED") throw new Error("NOT_IN_RECOVERY");
  if(!["ROLLED_BACK","COMMITTED","FAILED"].includes(outcome)) throw new Error("INVALID_RECOVERY_OUTCOME");
  return {...store,status:outcome,recoveryRequired:false,version:store.version+1};
}
export function classifyRace({authEpoch,currentEpoch,decisionHash,approvalDecisionHash,stateVersion,expectedStateVersion}){
  if(authEpoch!==currentEpoch) return "BLOCK_STALE_AUTHORIZATION";
  if(decisionHash!==approvalDecisionHash) return "BLOCK_DECISION_MISMATCH";
  if(stateVersion!==expectedStateVersion) return "BLOCK_TOCTOU_STATE_CHANGE";
  return "EXECUTION_ELIGIBLE";
}
