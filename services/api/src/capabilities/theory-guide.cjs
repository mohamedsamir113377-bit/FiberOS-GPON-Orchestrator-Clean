'use strict';
const KINDS = ['tested', 'theoretical'];

function validateClaims(claims) {
  if (!Array.isArray(claims)) throw new TypeError('claims must be an array');
  const errors = [];
  claims.forEach((c, i) => {
    const ref = (c && typeof c.id === 'string' && c.id) || ('#' + i);
    if (!c || typeof c !== 'object' || Array.isArray(c)) { errors.push(ref + ': not an object'); return; }
    if (typeof c.id !== 'string' || c.id.trim() === '') errors.push(ref + ': missing id');
    if (typeof c.claim !== 'string' || c.claim.trim().length < 10) errors.push(ref + ': claim too short to be a spec');
    if (!KINDS.includes(c.kind)) errors.push(ref + ': kind must be one of ' + KINDS.join('|'));
    if (c.kind === 'tested' && (typeof c.test !== 'string' || c.test.trim() === '')) errors.push(ref + ': a tested claim must name its test');
    if (c.kind === 'theoretical' && (typeof c.rationale !== 'string' || c.rationale.trim().length < 10)) errors.push(ref + ': a theoretical claim must carry a rationale');
  });
  const ids = claims.map((c) => c && c.id).filter(Boolean);
  ids.forEach((id, i) => { if (ids.indexOf(id) !== i) errors.push('duplicate id ' + id); });
  return {
    ok: errors.length === 0, errors, total: claims.length,
    tested: claims.filter((c) => c && c.kind === 'tested').length,
    theoretical: claims.filter((c) => c && c.kind === 'theoretical').length,
  };
}
// A claim with no test is only allowed if it is explicitly labelled theoretical.
function assertNoUnbackedClaims(claims) {
  const r = validateClaims(claims);
  if (!r.ok) throw new Error('invalid claims: ' + r.errors.join('; '));
  return r;
}
module.exports = { validateClaims, assertNoUnbackedClaims, KINDS };
