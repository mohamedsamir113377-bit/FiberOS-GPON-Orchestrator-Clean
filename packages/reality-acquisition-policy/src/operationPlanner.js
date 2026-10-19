'use strict';
const P=require('./index');

const REQUIREMENTS=Object.freeze({
  fault_diagnosis:[
    ['topology','topology',false],['service_path','service_path',false],['optical_rx','rx_power_numeric',false,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],
    ['optical_otdr','otdr_trace',false,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],['radio_signal','radio_signal_numeric',false,['wireless_backhaul']]
  ],
  maintenance_closure:[
    ['service_path','service_path',true],['field_identity','site_identity',true],['field_presence','gps_presence',true],['physical_condition','physical_condition',true],
    ['measured_rx','rx_power_numeric',false,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],
    ['measured_otdr','otdr_trace',false,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],
    ['radio_signal','radio_signal_numeric',false,['wireless_backhaul']]
  ],
  installation_acceptance:[
    ['field_identity','site_identity',true],['field_presence','gps_presence',true],['physical_condition','physical_condition',true],
    ['optical_rx','rx_power_numeric',false,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],
    ['optical_otdr','otdr_trace',false,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],
    ['radio_signal','radio_signal_numeric',false,['wireless_backhaul']]
  ],
  commercial_reconciliation:[['commercial_support','commercial_support',true],['measurement','rx_power_numeric',false],['field_evidence','physical_condition',false]],
  incident_command:[['topology','topology',false],['service_path','service_path',false],['site_identity','site_identity',false],['physical_condition','physical_condition',false]],
  optical_assurance:[
    ['topology','topology',true],['service_path','service_path',true],['optical_rx','rx_power_numeric',true,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],
    ['optical_otdr','otdr_trace',true,['gpon','xgs_pon','active_ethernet','p2p_fiber','mixed_fttx','enterprise_fiber']],['radio_signal','radio_signal_numeric',true,['wireless_backhaul']]
  ],
  network_inventory_reconciliation:[['topology','topology',true],['site_identity','site_identity',true],['physical_condition','physical_condition',false]]
});

const ALTERNATIVES=Object.freeze([
  {key:'DIRECT_SYSTEM_ASSURANCE',access:['DIRECT_READ_ONLY','HYBRID'],authoritative:true,proofOnly:false,weight:100},
  {key:'FIELD_MEASURED_ASSURANCE',access:['FIELD_ONLY','HYBRID','OFFLINE_FIELD'],authoritative:true,proofOnly:false,weight:80},
  {key:'FIELD_PROOF_ENVELOPE',access:['FIELD_ONLY','HYBRID','OFFLINE_FIELD'],authoritative:false,proofOnly:true,weight:40},
  {key:'MANUAL_ADVISORY',access:['MANUAL_DECLARED'],authoritative:false,proofOnly:true,weight:10}
]);

function planOperation(input){
  const x=input||{},op=String(x.operationType||'').trim().toLowerCase(),nf=String(x.networkFamily||'unknown').trim().toLowerCase();
  if(!REQUIREMENTS[op])throw Object.assign(new Error('OPERATION_TYPE_INVALID'),{code:'OPERATION_TYPE_INVALID'});
  if(!P.NETWORK_FAMILIES.includes(nf))throw Object.assign(new Error('NETWORK_FAMILY_INVALID'),{code:'NETWORK_FAMILY_INVALID'});
  const policy=P.normalizePolicy(x.policy||P.presetPolicy('READ_ONLY_HYBRID',nf));
  const available=x.availableSources==null?null:Array.from(new Set(x.availableSources.map(String)));
  const reqs=REQUIREMENTS[op];
  const alternatives=[];
  for(const alt of ALTERNATIVES){
    if(!alt.access.includes(policy.accessMode))continue;
    let blocked=false,candidate=false,authority=true,proof=alt.proofOnly,requirements=[];
    for(const [key,cap,mandatory,networks] of reqs){
      if(networks&&!networks.includes(nf))continue;
      const d=P.resolveAcquisition({policy,capability:cap,networkFamily:nf,availableSources:available,requireAuthoritative:alt.authoritative,instrumentProvenancePresent:x.instrumentProvenancePresent===true});
      if(d.decisionStatus==='blocked'&&mandatory)blocked=true;
      if(d.decisionStatus==='candidate')candidate=true;
      if(alt.authoritative&&(!d.authoritative||d.decisionStatus==='fallback_required'||d.decisionStatus==='blocked'))authority=false;
      if(d.proofOnly||d.decisionStatus==='fallback_required')proof=true;
      requirements.push({key,capability:cap,mandatory,decisionStatus:d.decisionStatus,selectedSource:d.selectedSource||null,authorityClass:d.authorityClass||null,authoritative:Boolean(d.authoritative&&!d.proofOnly),runtimeVerified:false,candidates:d.candidates||[],fallbackChain:d.fallbackChain||[]});
    }
    if(blocked)continue;
    const selectedSources=[...new Set(requirements.map(r=>r.selectedSource).filter(Boolean))];
    const status=proof?'fallback_required':candidate?'candidate':authority?'selected':'partial';
    alternatives.push({key:alt.key,weight:alt.weight,requirements,selectedSources,proofOnly:proof,authoritativeEvidenceReady:Boolean(authority&&!proof),recommendationStatus:status,runtimeVerified:false,requiresExternalConnection:selectedSources.some(s=>P.SOURCE_CATALOG.find(c=>c.sourceKey===s)?.requiresExternalConnection===true)});
  }
  alternatives.sort((a,b)=>b.weight-a.weight||a.key.localeCompare(b.key));
  if(!alternatives.length)return Object.freeze({ok:false,operationType:op,networkFamily:nf,recommendedAlternativeKey:null,recommendationStatus:'blocked',runtimeVerified:false,truthBoundary:'NO_ELIGIBLE_POLICY_ALTERNATIVE'});
  const selected=alternatives[0];
  return Object.freeze({ok:true,operationType:op,networkFamily:nf,policyProfileKey:policy.profileKey,recommendedAlternativeKey:selected.key,recommendationStatus:selected.recommendationStatus,alternatives,selectedSources:selected.selectedSources,authoritativeEvidenceReady:selected.authoritativeEvidenceReady,runtimeVerified:false,requiresExternalConnection:selected.requiresExternalConnection,truthBoundary:selected.proofOnly?'PROOF_ONLY_CANNOT_GRANT_FINAL_CLOSURE':'POLICY_SELECTION_IS_NOT_RUNTIME_VERIFICATION'});
}
module.exports={REQUIREMENTS,ALTERNATIVES,planOperation};
