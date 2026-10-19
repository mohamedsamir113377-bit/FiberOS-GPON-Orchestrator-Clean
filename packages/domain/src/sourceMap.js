'use strict';
/** optical_measurements.source ↔ evidence.source */
const TO_EVIDENCE = Object.freeze({
  field_reading: 'field',
  nms_poll: 'nms',
  ai_simulated: 'ai_simulated'
});
const TO_OPTICAL = Object.freeze({
  field: 'field_reading',
  nms: 'nms_poll',
  ai_simulated: 'ai_simulated',
  system: 'field_reading'
});
function toEvidenceSource(s) {
  return TO_EVIDENCE[s] || (s === 'field' || s === 'nms' ? s : null);
}
function toOpticalSource(s) {
  return TO_OPTICAL[s] || (['field_reading', 'nms_poll', 'ai_simulated'].indexOf(s) >= 0 ? s : null);
}
module.exports = { TO_EVIDENCE, TO_OPTICAL, toEvidenceSource, toOpticalSource };
