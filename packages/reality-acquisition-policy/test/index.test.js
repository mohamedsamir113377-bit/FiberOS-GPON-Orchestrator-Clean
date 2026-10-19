'use strict';
const {describe,it}=require('node:test');const assert=require('node:assert/strict');const P=require('../src');
describe('reality acquisition policy',()=>{
  it('selects NMS RX when buyer permits read-only access',()=>{const o=P.resolveAcquisition({policy:P.presetPolicy('READ_ONLY_HYBRID','gpon'),capability:'rx_power_numeric',networkFamily:'gpon',availableSources:['nms_rx','field_power_photo']});assert.equal(o.selectedSource,'nms_rx');assert.equal(o.authoritative,true);assert.equal(o.runtimeVerified,false);});
  it('falls back to field meter with instrument provenance',()=>{const o=P.resolveAcquisition({policy:P.presetPolicy('READ_ONLY_HYBRID','gpon'),capability:'rx_power_numeric',networkFamily:'gpon',availableSources:['field_power_meter'],instrumentProvenancePresent:true});assert.equal(o.selectedSource,'field_power_meter');assert.equal(o.authorityClass,'measured');});
  it('does not promote a technician power photo to numeric RX',()=>{const o=P.resolveAcquisition({policy:P.presetPolicy('RESTRICTED_SITE_FIELD_ONLY','gpon'),capability:'rx_power_numeric',networkFamily:'gpon',availableSources:['field_power_photo']});assert.equal(o.decisionStatus,'blocked');});
  it('allows a geo/photo proof capability without numeric authority',()=>{const o=P.resolveAcquisition({policy:P.presetPolicy('RESTRICTED_SITE_FIELD_ONLY','gpon'),capability:'rx_power_field_proof',networkFamily:'gpon',availableSources:['field_power_photo'],requireAuthoritative:false});assert.equal(o.selectedSource,'field_power_photo');assert.equal(o.authoritative,false);});
  it('keeps manual declaration non-authoritative',()=>{const o=P.resolveAcquisition({policy:P.presetPolicy('MANUAL_DECLARED'),capability:'physical_condition',networkFamily:'unknown',availableSources:['manual_declared'],requireAuthoritative:false});assert.equal(o.authoritative,false);});
  it('validates geo/hash metadata without image inspection',()=>{const p=P.validateFieldPhotoProof({latitude:30,longitude:31,contentSha256:'a'.repeat(64),actorId:'u',capturedAt:'2026-10-08T00:00:00Z',siteLatitude:30,siteLongitude:31});assert.equal(p.ok,true);assert.equal(p.siteMatch,true);assert.equal(p.numericAuthority,false);assert.equal(p.imageBytesInspected,false);});

  it('allows declared read-only NMS OTDR and radio telemetry paths',()=>{
    const optical=P.resolveAcquisition({policy:P.presetPolicy('FULL_READ_ONLY','gpon'),capability:'otdr_trace',networkFamily:'gpon',availableSources:['nms_otdr_read_only']});
    assert.equal(optical.decisionStatus,'selected');
    assert.equal(optical.selectedSource,'nms_otdr_read_only');
    const radio=P.resolveAcquisition({policy:P.presetPolicy('READ_ONLY_HYBRID','wireless_backhaul'),capability:'radio_signal_numeric',networkFamily:'wireless_backhaul',availableSources:['nms_radio_telemetry']});
    assert.equal(radio.decisionStatus,'selected');
    assert.equal(radio.selectedSource,'nms_radio_telemetry');
  });
  it('rejects absent or malformed GPS in field-photo proof metadata',()=>{
    const common={contentSha256:'a'.repeat(64),actorId:'u',capturedAt:'2026-10-08T00:00:00Z'};
    const missing=P.validateFieldPhotoProof({...common,latitude:null,longitude:null});
    assert.equal(missing.ok,false);
    assert.ok(missing.errors.includes('GPS_LATITUDE_INVALID'));
    assert.ok(missing.errors.includes('GPS_LONGITUDE_INVALID'));
    const invalidSite=P.validateFieldPhotoProof({...common,latitude:30,longitude:31,siteLatitude:91,siteLongitude:31});
    assert.equal(invalidSite.ok,false);
    assert.ok(invalidSite.errors.includes('SITE_GPS_LATITUDE_INVALID'));
    const partialSite=P.validateFieldPhotoProof({...common,latitude:30,longitude:31,siteLatitude:30});
    assert.equal(partialSite.ok,false);
    assert.ok(partialSite.errors.includes('SITE_GPS_PAIR_REQUIRED'));
  });
});
