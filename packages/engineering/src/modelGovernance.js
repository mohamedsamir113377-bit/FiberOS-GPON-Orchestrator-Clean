'use strict';

function s(x,n){if(typeof x!=='string'||!x.trim())throw new TypeError(`${n} must be a non-empty string`);return x.trim();}
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function pos(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}
function range(r,n='validRange'){if(!Array.isArray(r)||r.length!==2)throw new TypeError(`${n} must be [min,max]`);const lo=finite(r[0],`${n}[0]`),hi=finite(r[1],`${n}[1]`);if(lo>hi)throw new RangeError(`${n} min > max`);return Object.freeze([lo,hi]);}

const STATUS=Object.freeze(['DRAFT','CALIBRATION','VALIDATION','PROPOSED','APPROVED','SUSPENDED','RETIRED']);
const TRANSITIONS=Object.freeze({DRAFT:['CALIBRATION','RETIRED'],CALIBRATION:['VALIDATION','DRAFT','RETIRED'],VALIDATION:['PROPOSED','CALIBRATION','RETIRED'],PROPOSED:['APPROVED','VALIDATION','RETIRED'],APPROVED:['SUSPENDED','RETIRED'],SUSPENDED:['VALIDATION','APPROVED','RETIRED'],RETIRED:[]});

function parameter(p){
  p=p||{};
  const out={
    parameterKey:s(p.parameterKey,'parameterKey'), units:s(p.units,'units'), value:finite(p.value,'value'),
    sourceRef:s(p.sourceRef,'sourceRef'), provenance:p.provenance&&typeof p.provenance==='object'?Object.freeze({...p.provenance}):null,
    validRange:p.validRange?range(p.validRange):null,
    stdUncertainty:p.stdUncertainty==null?null:pos(p.stdUncertainty,'stdUncertainty'),
    distribution:p.distribution||'normal', correlationGroup:p.correlationGroup==null?null:s(p.correlationGroup,'correlationGroup'),
    effectiveFrom:p.effectiveFrom?s(p.effectiveFrom,'effectiveFrom'):null, effectiveTo:p.effectiveTo?s(p.effectiveTo,'effectiveTo'):null
  };
  if(!out.provenance)throw new TypeError('provenance required');
  if(out.validRange && (out.value<out.validRange[0]||out.value>out.validRange[1]))throw new RangeError('value outside validRange');
  if(!['normal','lognormal','empirical','deterministic'].includes(out.distribution))throw new RangeError('unsupported distribution');
  return Object.freeze(out);
}
function model(m){
  m=m||{};
  const out={modelKey:s(m.modelKey,'modelKey'),version:s(m.version,'version'),equation:s(m.equation,'equation'),domain:m.domain&&typeof m.domain==='object'?Object.freeze({...m.domain}):null,
    parameterKeys:[...(m.parameterKeys||[])].map(x=>s(x,'parameterKey')), sourceRefs:[...(m.sourceRefs||[])].map(x=>s(x,'sourceRef')), status:m.status||'DRAFT', validation:m.validation||null};
  if(!STATUS.includes(out.status))throw new RangeError('invalid model status');
  if(!out.parameterKeys.length)throw new RangeError('at least one parameterKey required');
  return Object.freeze(out);
}
function canTransition(from,to){return STATUS.includes(from)&&TRANSITIONS[from].includes(to);}
function transition(record,to,actor){
  const from=s(record.status,'status');to=s(to,'to');actor=s(actor,'actor');
  if(!canTransition(from,to))throw new Error(`invalid model lifecycle transition ${from} -> ${to}`);
  if(to==='APPROVED' && !['ops_manager','area_supervisor','sysadmin','engineering_authority'].includes(actor))throw new Error('approval authority required');
  return Object.freeze({...record,status:to,changedBy:actor});
}
function requireApproved(bindings){
  if(!Array.isArray(bindings)||!bindings.length)throw new RangeError('approved parameter bindings required');
  for(const b of bindings){if(b.status!=='APPROVED')throw new Error(`parameter ${b.parameterKey||'?'} is not approved`);parameter(b);}
  return true;
}
function calibrationEnvelope({estimate,stdError,confidence=0.95,method,datasetRef}){
  const e=finite(estimate,'estimate'), se=pos(stdError,'stdError'), c=finite(confidence,'confidence');
  if(c<=0||c>=1)throw new RangeError('confidence must be in (0,1)');
  if(!method||!datasetRef)throw new TypeError('method and datasetRef required');
  return Object.freeze({estimate:e,stdError:se,confidence:c,method:s(method,'method'),datasetRef:s(datasetRef,'datasetRef')});
}
module.exports={STATUS,TRANSITIONS,parameter,model,canTransition,transition,requireApproved,calibrationEnvelope};
