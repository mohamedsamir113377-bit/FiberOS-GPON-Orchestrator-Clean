export const EVIDENCE_CLASSES=Object.freeze(['observed','measured','derived','client_declared','simulated','unverified']);
export function classifyEvidence(e, options={}){
  if(!e || typeof e!=='object') return 'unverified';
  if(e.sourceTrust==='client') return 'client_declared';
  if(e.sourceTrust==='device' && e.measurement===true && e.receipt && e.observedAt && e.deviceIdentity &&
     typeof options.verifyDeviceReceipt==='function' && options.verifyDeviceReceipt(e)===true) return 'measured';
  if(e.method && e.inputs) return 'derived';
  if(e.simulation===true) return 'simulated';
  if(e.source) return 'observed';
  return 'unverified';
}
export function assertEvidenceClass(e,allowed,options){const c=classifyEvidence(e,options);if(!allowed.includes(c))throw new Error('EVIDENCE_CLASS_NOT_ALLOWED');return c;}
export function promoteEvidence(e,requested,options){const c=classifyEvidence(e,options);if(c==='client_declared'&&requested!=='client_declared')throw new Error('CLIENT_DATA_CANNOT_SELF_PROMOTE');if(c==='simulated'&&requested!=='simulated')throw new Error('SIMULATION_CANNOT_SELF_PROMOTE');if(c==='unverified')throw new Error('UNVERIFIED_EVIDENCE_CANNOT_PROMOTE');if(c!==requested)throw new Error('EVIDENCE_RECLASSIFICATION_REQUIRES_PROOF');return {...e,classification:requested};}
export function truthGate({evidence,requiredClasses=[],verification}){const c=classifyEvidence(evidence,verification);return requiredClasses.includes(c)?{allowed:true,classification:c}:{allowed:false,reason:'EVIDENCE_CLASS_NOT_ACCEPTED',classification:c};}
