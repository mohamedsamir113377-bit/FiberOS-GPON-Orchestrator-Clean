export const READ_ONLY_OPERATIONS=Object.freeze(['getDeviceIdentity','getCapabilities','pollOpticalMeasurement','getInventory','getPortStatus']);
export function validateAdapterContract(a){
  if(!a||typeof a!=='object')throw new Error('ADAPTER_REQUIRED');
  for(const k of ['vendor','device','model','firmware','protocol','capabilities'])if(typeof a[k]!=='string'||!a[k].trim())throw new Error(`ADAPTER_${k.toUpperCase()}_REQUIRED`);
  if(!Array.isArray(a.readOperations)||a.readOperations.some(x=>!READ_ONLY_OPERATIONS.includes(x)))throw new Error('UNSUPPORTED_OR_MUTATING_OPERATION');
  if(Array.isArray(a.writeOperations)&&a.writeOperations.length)throw new Error('READ_ONLY_PHASE_WRITE_OPERATION_FORBIDDEN');
  return true;
}
export function attestMeasurement(r){if(!r||r.source!=='southbound_adapter')throw new Error('SOUTHBOND_SOURCE_REQUIRED');if(!r.adapterReceipt||!r.observedAt||!r.deviceIdentity||!r.instrumentId)throw new Error('SOUTHBOND_ATTESTATION_REQUIRED');return {...r,classification:'measured'};}

export {
  PON_TELEMETRY_SIGNAL_TYPES,
  PON_TECHNOLOGIES,
  validatePonAdapterDeclaration,
  normalizePonTelemetrySample,
  normalizePonTelemetryBatch,
  correlationKeysFromObservation
} from './ponTelemetryBoundary.js';
