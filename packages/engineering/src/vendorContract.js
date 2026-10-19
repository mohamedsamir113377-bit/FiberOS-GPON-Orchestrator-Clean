'use strict';

/* Stable cross-vendor boundary. Adapters may translate vendor dialects into this
 * contract; they cannot redefine the physical meaning of a field. */
const REQUIRED=['sourceSystem','vendor','deviceModel','deviceSerial','capturedAt','measurementType','value','unit'];
function text(x,n){if(typeof x!=='string'||!x.trim())throw new TypeError(`${n} must be a non-empty string`);return x.trim();}
function finite(x,n){const v=Number(x);if(!Number.isFinite(v))throw new TypeError(`${n} must be finite`);return v;}
function normalize(m){m=m||{};for(const k of REQUIRED)if(m[k]==null)throw new TypeError(`${k} required`);const t=Date.parse(m.capturedAt);if(!Number.isFinite(t))throw new RangeError('capturedAt must be an ISO-compatible timestamp');const value=finite(m.value,'value');return Object.freeze({sourceSystem:text(m.sourceSystem,'sourceSystem'),vendor:text(m.vendor,'vendor'),deviceModel:text(m.deviceModel,'deviceModel'),deviceSerial:text(m.deviceSerial,'deviceSerial'),capturedAt:new Date(t).toISOString(),measurementType:text(m.measurementType,'measurementType'),value,unit:text(m.unit,'unit'),wavelengthNm:m.wavelengthNm==null?undefined:finite(m.wavelengthNm,'wavelengthNm'),uncertainty:m.uncertainty==null?undefined:Math.max(0,finite(m.uncertainty,'uncertainty')),rawReference:m.rawReference==null?undefined:text(m.rawReference,'rawReference')});}
function assertCompatible(a,b){const x=normalize(a),y=normalize(b);if(x.measurementType!==y.measurementType||x.unit!==y.unit)throw new RangeError('measurements are not semantically compatible');if(x.wavelengthNm!=null&&y.wavelengthNm!=null&&Math.abs(x.wavelengthNm-y.wavelengthNm)>1e-9)throw new RangeError('measurements use different wavelengths');return true;}
module.exports={normalize,assertCompatible};
