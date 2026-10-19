'use strict';

function correlateSignals(signals, topology) {
  const groups = new Map();
  for (const s of signals || []) {
    const key = s.topologyKey || (topology && topology[s.assetId]) || `asset:${s.assetId || 'unknown'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(s);
  }
  return [...groups.entries()].filter(([, list]) => list.length >= 2).map(([topologyKey, list]) => ({
    incidentKey: topologyKey,
    signalCount: list.length,
    assets: [...new Set(list.map(x => x.assetId).filter(Boolean))],
    services: [...new Set(list.map(x => x.serviceId).filter(Boolean))],
    customers: [...new Set(list.map(x => x.customerId).filter(Boolean))],
    sources: [...new Set(list.map(x => x.source).filter(Boolean))],
    openedAt: new Date().toISOString(),
    status: 'OPEN'
  }));
}
module.exports = { correlateSignals };
