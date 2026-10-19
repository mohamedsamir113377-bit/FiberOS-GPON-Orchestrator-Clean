'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const P=require('../src');const {planOperation}=require('../src/operationPlanner');

test('direct access ranks system evidence and remains runtime-unverified',()=>{
 const out=planOperation({operationType:'optical_assurance',networkFamily:'gpon',policy:P.presetPolicy('FULL_READ_ONLY','gpon'),availableSources:['nms_rx','nms_topology','nms_otdr_read_only']});
 assert.equal(out.ok,true);assert.equal(out.recommendedAlternativeKey,'DIRECT_SYSTEM_ASSURANCE');assert.equal(out.runtimeVerified,false);
});
test('restricted field path cannot promote photos to authority',()=>{
 const out=planOperation({operationType:'maintenance_closure',networkFamily:'gpon',policy:P.presetPolicy('FIELD_ONLY','gpon'),availableSources:['field_power_photo','field_gps_photo','field_photo']});
 assert.equal(out.ok,false);assert.equal(out.authoritativeEvidenceReady,undefined);assert.equal(out.recommendationStatus,'blocked');
});
test('wireless excludes optical RX and OTDR requirements',()=>{
 const out=planOperation({operationType:'optical_assurance',networkFamily:'wireless_backhaul',policy:P.presetPolicy('READ_ONLY_HYBRID','wireless_backhaul'),availableSources:['nms_topology','nms_radio_telemetry']});
 const caps=out.alternatives[0].requirements.map(x=>x.capability);assert.ok(caps.includes('radio_signal_numeric'));assert.equal(caps.includes('rx_power_numeric'),false);assert.equal(caps.includes('otdr_trace'),false);
});
test('unknown availability is candidate, never PASS',()=>{
 const out=planOperation({operationType:'fault_diagnosis',networkFamily:'gpon',policy:P.presetPolicy('READ_ONLY_HYBRID','gpon')});
 assert.equal(out.ok,true);assert.equal(out.runtimeVerified,false);assert.equal(out.recommendationStatus,'candidate');
});
