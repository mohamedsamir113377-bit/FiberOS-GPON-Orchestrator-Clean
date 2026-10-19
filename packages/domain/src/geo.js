'use strict';

/**
 * Real Haversine great-circle distance in meters. No shortcuts, no mocked output.
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => typeof v !== 'number' || Number.isNaN(v))) {
    throw new TypeError('ERR_INVALID_COORDS: all four coordinates must be finite numbers');
  }
  const R = 6371000; // mean Earth radius, meters
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Real geofence check. No hidden bypass, no default-pass on bad input.
 */
function isWithinGeofence(lat1, lon1, lat2, lon2, maxRadiusMeters) {
  const distance = haversineMeters(lat1, lon1, lat2, lon2);
  return { distance, withinFence: distance <= maxRadiusMeters };
}

module.exports = { haversineMeters, isWithinGeofence };
