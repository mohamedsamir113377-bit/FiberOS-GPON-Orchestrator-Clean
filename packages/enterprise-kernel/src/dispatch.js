'use strict';

function scoreCandidate(candidate, ctx) {
  const distance = Number(candidate.distanceMeters);
  const workload = Number(candidate.activeWorkload || 0);
  const skillPenalty = candidate.skillMatch === true ? 0 : Number(ctx.skillPenalty ?? 100000);
  const availabilityPenalty = candidate.available === false ? Number(ctx.unavailablePenalty ?? 1000000) : 0;
  const materialPenalty = candidate.hasRequiredParts === false ? Number(ctx.missingPartPenalty ?? 50000) : 0;
  const weights = { distance: 1, workload: 250, skill: 1, availability: 1, material: 1, ...(ctx.weights || {}) };
  return distance * weights.distance + workload * weights.workload + skillPenalty * weights.skill + availabilityPenalty * weights.availability + materialPenalty * weights.material;
}

function rankCandidates(candidates, ctx) {
  ctx = ctx || {};
  return (Array.isArray(candidates) ? candidates : []).map((c, i) => ({
    ...c, score: scoreCandidate(c, ctx), _stable: String(c.technicianId || c.id || i)
  })).sort((a,b) => a.score - b.score || a._stable.localeCompare(b._stable)).map(({_stable, ...c}, rank) => ({ ...c, rank: rank + 1 }));
}
module.exports = { scoreCandidate, rankCandidates };
