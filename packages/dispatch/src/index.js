'use strict';
/** Deterministic dispatch helpers: distance + workload + SLA urgency + skill match. */
const lifecycle = require('../../domain/src/ticketLifecycle');
const { createAdapterRegistry, NullVendorAdapter } = require('../../adapters/src/registry');

function finite(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function haversineMeters(job, tech) {
  const lat1 = finite(job.latitude, NaN), lon1 = finite(job.longitude, NaN);
  const lat2 = finite(tech.latitude, NaN), lon2 = finite(tech.longitude, NaN);
  if (![lat1,lon1,lat2,lon2].every(Number.isFinite)) return Infinity;
  const R=6371000, p1=lat1*Math.PI/180, p2=lat2*Math.PI/180;
  const dLat=(lat2-lat1)*Math.PI/180, dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dLon/2)**2;
  return R*2*Math.atan2(Math.sqrt(Math.min(1,Math.max(0,a))),Math.sqrt(Math.max(0,1-a)));
}
function skillMatch(job, tech) {
  const wanted = job.skill || job.requiredSkill;
  const skills = Array.isArray(tech.skills) ? tech.skills.map(String) : [];
  if (!wanted) return { match: true, penalty: 0 };
  const match = skills.includes(String(wanted));
  return { match, penalty: match ? 0 : 100 };
}
function scoreAssignment(job, tech, traffic, nowMs) {
  traffic = Math.max(0.1, finite(traffic, 1));
  nowMs = finite(nowMs, Date.now());
  const distanceMeters = haversineMeters(job, tech);
  if (!Number.isFinite(distanceMeters)) return { score: 0, distanceMeters: null, eligible: false, authority:'ADVISORY_SCORE_ONLY', reasons:{invalidLocation:true} };
  const distancePenalty = Math.min(distanceMeters / 50000, 1) * 40;
  const workloadPenalty = Math.min(Math.max(0, finite(tech.activeJobs, tech.currentWorkload || 0)) / 10, 1) * 25;
  const speedMps = Math.max(1, finite(tech.vehicleSpeedMps, 11.111111));
  const travelMinutes = (distanceMeters / speedMps) * traffic / 60;
  const sla = job.slaDeadlineTimestamp != null ? finite(job.slaDeadlineTimestamp, NaN) : NaN;
  const remainingMinutes = Number.isFinite(sla) ? (sla - nowMs) / 60000 : Infinity;
  const slaUrgency = Number.isFinite(remainingMinutes) ? Math.max(0, Math.min(1, 1 - remainingMinutes / 120)) : 0;
  const slaPenalty = slaUrgency * 30;
  const skill = skillMatch(job, tech);
  const availabilityPenalty = tech.status === 'ACTIVE_MIDAN' || tech.status === 'AVAILABLE' || tech.active !== false ? 0 : 100;
  const score = Math.max(0, 100 - distancePenalty - workloadPenalty - slaPenalty - availabilityPenalty - skill.penalty);
  return {
    score: Number(score.toFixed(2)), distanceMeters:Number(distanceMeters.toFixed(1)), travelMinutes:Number(travelMinutes.toFixed(2)),
    eligible: skill.match && availabilityPenalty === 0, authority:'ADVISORY_SCORE_ONLY',
    reasons:{ distancePenalty:Number(distancePenalty.toFixed(2)), workloadPenalty:Number(workloadPenalty.toFixed(2)), slaPenalty:Number(slaPenalty.toFixed(2)), skillMatch:skill.match, trafficMultiplier:traffic }
  };
}

function rankAssignments(job, technicians, options) {
  options = options || {};
  const nowMs = finite(options.nowMs, Date.now());
  const ranked = (technicians || []).map(t => ({ technicianId:t.id || t.technicianId, ...scoreAssignment(job,t,options.trafficMultiplier,nowMs), technician:t }))
    .filter(x => x.eligible)
    .sort((a,b) => b.score-a.score || a.distanceMeters-b.distanceMeters || String(a.technicianId).localeCompare(String(b.technicianId)));
  return ranked;
}

module.exports = { lifecycle, scoreAssignment, rankAssignments, createAdapterRegistry, NullVendorAdapter };
