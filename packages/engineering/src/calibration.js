'use strict';

function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function positive(x,n){const v=finite(x,n);if(v<=0)throw new RangeError(`${n} must be > 0`);return v;}

/**
 * Validates an empirical parameter declaration. The engine does not invent
 * coefficients; every non-universal parameter must carry provenance,
 * units, validity domain and uncertainty metadata before being admitted.
 */
function validateParameter(p){
  if(!p||typeof p!=='object')throw new TypeError('parameter object required');
  if(typeof p.name!=='string'||!p.name)throw new TypeError('name required');
  if(typeof p.units!=='string'||!p.units)throw new TypeError('units required');
  if(typeof p.sourceRef!=='string'||!p.sourceRef)throw new TypeError('sourceRef required');
  if(typeof p.provenance!=='string'||!p.provenance)throw new TypeError('provenance required');
  const value=finite(p.value,'value');
  if(p.stdUncertainty!=null)positive(p.stdUncertainty,'stdUncertainty');
  if(p.validRange){
    if(!Array.isArray(p.validRange)||p.validRange.length!==2)throw new TypeError('validRange must be [min,max]');
    const lo=finite(p.validRange[0],'validRange[0]'),hi=finite(p.validRange[1],'validRange[1]');
    if(lo>hi)throw new RangeError('validRange min > max');
    if(value<lo||value>hi)throw new RangeError('value outside validRange');
  }
  return Object.freeze({...p,value});
}
function validateSet(parameters){
  if(!Array.isArray(parameters))throw new TypeError('parameters must be an array');
  return Object.freeze(parameters.map(validateParameter));
}
module.exports={validateParameter,validateSet};
