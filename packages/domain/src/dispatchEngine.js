'use strict';

const { haversineMeters } = require('./geo');

class DispatchError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'DispatchError';
    this.code = code;
  }
}

/**
 * @param {object} params
 * @param {{lat:number, lon:number}} params.targetLocation  — the FAT box / asset the ticket is for
 * @param {string} params.orgId                              — tenant scope: never dispatch across companies
 * @param {Array}  params.technicians  — [{ employeeId, orgId, currentStatus, lastKnownLat, lastKnownLon }]
 *
 * Real rules, none of them silent:
 *  1. Only technicians in the SAME organization are candidates — this is the
 *     tenant boundary from 0002, dispatch must never cross it.
 *  2. Only currentStatus === 'AVAILABLE' — ACTIVE_FIELD (already on a job),
 *     BREAK, and OFFLINE are all correctly excluded, not treated as available.
 *  3. A technician with no last-known location is excluded, not assumed to
 *     be at distance 0 or any other fabricated position.
 *  4. Ranked by real Haversine distance (server/geo.js — already tested).
 *  5. If nobody qualifies, this returns an explicit "no candidate" result —
 *     it never force-assigns the least-bad option and never throws for a
 *     normal "nobody's free right now" business situation.
 *  6. Ties (identical distance) are broken deterministically by employeeId
 *     so the same input always produces the same output — no hidden randomness.
 */
function findBestTechnician({ targetLocation, orgId, technicians }) {
  if (!targetLocation || typeof targetLocation.lat !== 'number' || typeof targetLocation.lon !== 'number') {
    throw new DispatchError('ERR_INVALID_TARGET_LOCATION', 'INVALID_INPUT');
  }
  if (!orgId) {
    throw new DispatchError('ERR_ORG_ID_REQUIRED', 'INVALID_INPUT');
  }

  const candidates = technicians
    .filter((t) => t.orgId === orgId)
    .filter((t) => t.currentStatus === 'AVAILABLE')
    .filter((t) => typeof t.lastKnownLat === 'number' && typeof t.lastKnownLon === 'number')
    .map((t) => ({
      ...t,
      distanceMeters: haversineMeters(targetLocation.lat, targetLocation.lon, t.lastKnownLat, t.lastKnownLon),
    }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.employeeId.localeCompare(b.employeeId));

  if (candidates.length === 0) {
    return {
      assigned: false,
      reason: 'NO_AVAILABLE_TECHNICIAN_IN_SCOPE',
      candidateEmployeeId: null,
      distanceMeters: null,
    };
  }

  const winner = candidates[0];
  return {
    assigned: true,
    reason: 'NEAREST_AVAILABLE',
    candidateEmployeeId: winner.employeeId,
    distanceMeters: Number(winner.distanceMeters.toFixed(2)),
    consideredCandidateCount: candidates.length,
  };
}

module.exports = { findBestTechnician, DispatchError };
