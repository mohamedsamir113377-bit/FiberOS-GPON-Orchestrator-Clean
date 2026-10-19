'use strict';

const crypto = require('node:crypto');

function object(v, name) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${name} must be an object`);
  return v;
}
function text(v, name, max = 256) {
  const s = String(v ?? '').trim();
  if (!s) throw new Error(`${name}_REQUIRED`);
  if (s.length > max) throw new Error(`${name}_TOO_LONG`);
  return s;
}
function iso(v, name) {
  const d = new Date(v);
  if (!Number.isFinite(d.getTime())) throw new Error(`${name}_INVALID`);
  return d.toISOString();
}
function finite(v, name) {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`);
  return n;
}
function canonical(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  return Object.keys(v).sort().reduce((out, k) => { out[k] = canonical(v[k]); return out; }, {});
}
function sha256(v) {
  return crypto.createHash('sha256').update(Buffer.from(JSON.stringify(canonical(v)), 'utf8')).digest('hex');
}

const SEVERITIES = new Set(['INFO', 'WARN', 'MAJOR', 'CRITICAL']);
const SOURCE_TYPES = new Set(['nms', 'operator', 'system', 'field']);

function normalizeAlarmSignal(input) {
  object(input, 'input');
  const alarmId = text(input.alarmId || input.id, 'ALARM_ID', 128);
  const assetId = text(input.assetId, 'ASSET_ID', 128);
  const code = text(input.code || input.alarmCode, 'ALARM_CODE', 128);
  const observedAt = iso(input.observedAt || input.occurredAt, 'OBSERVED_AT');
  const severity = String(input.severity || 'WARN').toUpperCase();
  if (!SEVERITIES.has(severity)) throw new Error('ALARM_SEVERITY_INVALID');
  const source = String(input.source || 'operator').toLowerCase();
  if (!SOURCE_TYPES.has(source)) throw new Error('ALARM_SOURCE_INVALID');
  return Object.freeze({
    alarmId, assetId, code, severity, source, observedAt,
    clearedAt: input.clearedAt ? iso(input.clearedAt, 'CLEARED_AT') : null,
    correlationKey: input.correlationKey ? text(input.correlationKey, 'CORRELATION_KEY', 128) : null,
    metadata: input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata) ? canonical(input.metadata) : {}
  });
}

function buildAdjacency(edges) {
  const graph = new Map();
  const add = (a, b) => {
    if (!a || !b) return;
    if (!graph.has(a)) graph.set(a, new Set());
    if (!graph.has(b)) graph.set(b, new Set());
    graph.get(a).add(b);
    graph.get(b).add(a);
  };
  for (const edge of Array.isArray(edges) ? edges : []) {
    add(edge.fromAssetId || edge.from_asset_id, edge.toAssetId || edge.to_asset_id);
  }
  return graph;
}

function topologyComponent(assetId, adjacency, maxDepth = 8) {
  const root = String(assetId);
  const seen = new Set([root]);
  const queue = [{ id: root, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift();
    if (depth >= maxDepth) continue;
    for (const next of adjacency.get(id) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push({ id: next, depth: depth + 1 });
    }
  }
  return seen;
}

function correlateAlarmSignals(signals, edges, options = {}) {
  const normalized = (signals || []).map(normalizeAlarmSignal);
  const windowMinutes = Math.max(1, Math.min(1440, Number(options.windowMinutes || 60)));
  const windowMs = windowMinutes * 60 * 1000;
  const adjacency = buildAdjacency(edges);
  const clusters = [];

  for (const signal of normalized) {
    const t = Date.parse(signal.observedAt);
    let target = null;
    for (const cluster of clusters) {
      if (Math.abs(t - cluster.anchorMs) > windowMs) continue;
      if (cluster.assets.has(signal.assetId) || cluster.component.has(signal.assetId) || (signal.correlationKey && cluster.correlationKeys.has(signal.correlationKey))) {
        target = cluster;
        break;
      }
    }
    if (!target) {
      target = {
        anchorMs: t,
        assets: new Set(),
        component: topologyComponent(signal.assetId, adjacency, Number(options.maxDepth || 8)),
        correlationKeys: new Set(),
        signals: []
      };
      clusters.push(target);
    }
    target.signals.push(signal);
    target.assets.add(signal.assetId);
    if (signal.correlationKey) target.correlationKeys.add(signal.correlationKey);
    for (const a of topologyComponent(signal.assetId, adjacency, Number(options.maxDepth || 8))) target.component.add(a);
  }

  return clusters
    .filter(c => c.signals.length >= Number(options.minSignals || 2))
    .map((cluster, index) => {
      const counts = new Map();
      for (const s of cluster.signals) counts.set(s.assetId, (counts.get(s.assetId) || 0) + 1);
      const directedOut = new Map();
      for (const edge of Array.isArray(edges) ? edges : []) {
        const from = edge.fromAssetId || edge.from_asset_id;
        const to = edge.toAssetId || edge.to_asset_id;
        if (!from || !to) continue;
        if (!directedOut.has(String(from))) directedOut.set(String(from), new Set());
        directedOut.get(String(from)).add(String(to));
      }
      const observedAssets = new Set(cluster.signals.map(s => s.assetId));
      function downstreamObservedCount(assetId) {
        const seen = new Set([assetId]);
        const queue = [assetId];
        let found = 0;
        while (queue.length) {
          const current = queue.shift();
          for (const next of directedOut.get(current) || []) {
            if (seen.has(next)) continue;
            seen.add(next);
            if (observedAssets.has(next)) found += 1;
            queue.push(next);
          }
        }
        return found;
      }
      const candidates = [...counts.entries()]
        .map(([assetId, count]) => {
          const downstreamObservedSignalCount = downstreamObservedCount(assetId);
          return { assetId, signalCount: count, downstreamObservedSignalCount, supportScore: count + downstreamObservedSignalCount };
        })
        .sort((a, b) => b.supportScore - a.supportScore || b.signalCount - a.signalCount || a.assetId.localeCompare(b.assetId));
      return Object.freeze({
        clusterId: `alarm-cluster-${index + 1}`,
        signalCount: cluster.signals.length,
        assets: [...cluster.assets].sort(),
        rootCauseCandidates: candidates,
        signals: cluster.signals,
        authority: 'DETERMINISTIC_TOPOLOGY_TIME_CORRELATION_ADVISORY',
        autonomousAction: false,
        prediction: false
      });
    });
}

function opticalHealthFingerprint(samples, options = {}) {
  if (!Array.isArray(samples) || samples.length < 2) throw new RangeError('AT_LEAST_TWO_OPTICAL_SAMPLES_REQUIRED');
  const xs = samples.map((s, i) => {
    const item = object(s, `sample_${i}`);
    return { time: Date.parse(iso(item.measuredAt || item.measured_at, 'MEASURED_AT')), value: finite(item.value ?? item.valueNumeric ?? item.value_numeric, `value_${i}`) };
  }).sort((a, b) => a.time - b.time);
  const n = xs.length;
  const meanT = xs.reduce((a, x) => a + x.time, 0) / n;
  const meanV = xs.reduce((a, x) => a + x.value, 0) / n;
  const denom = xs.reduce((a, x) => a + (x.time - meanT) ** 2, 0);
  const slopePerMs = denom === 0 ? 0 : xs.reduce((a, x) => a + (x.time - meanT) * (x.value - meanV), 0) / denom;
  const slopePerDay = slopePerMs * 86400000;
  const latest = xs[n - 1].value;
  const first = xs[0].value;
  const change = latest - first;
  const deteriorationDirection = options.lowerIsWorse === false ? 'higher' : 'lower';
  const threshold = options.degradationRatePerDay == null ? null : Math.abs(finite(options.degradationRatePerDay, 'degradationRatePerDay'));
  const degradationObserved = threshold === null ? null : (deteriorationDirection === 'lower' ? slopePerDay < -threshold : slopePerDay > threshold);
  return Object.freeze({
    sampleCount: n,
    firstValue: first,
    latestValue: latest,
    change: Number(change.toFixed(6)),
    slopePerDay: Number(slopePerDay.toFixed(9)),
    deteriorationDirection,
    degradationObserved,
    thresholdPerDay: threshold,
    basis: 'observed measurements only; linear least-squares trend; no forecasting'
  });
}

const CHAIN_TYPES = Object.freeze(['ticket', 'technician', 'gps', 'asset', 'card', 'port', 'splice', 'rx', 'otdr', 'photo', 'timestamp', 'closure']);

function buildEvidenceChain(entries, options = {}) {
  if (!Array.isArray(entries)) throw new TypeError('entries must be an array');
  const normalized = entries.map((entry, i) => {
    object(entry, `entry_${i}`);
    const type = text(entry.type, 'CHAIN_ENTRY_TYPE', 32).toLowerCase();
    if (!CHAIN_TYPES.includes(type)) throw new Error(`CHAIN_ENTRY_TYPE_INVALID:${type}`);
    const reference = entry.reference == null ? null : text(entry.reference, 'CHAIN_ENTRY_REFERENCE', 512);
    return Object.freeze({ type, reference, observedAt: entry.observedAt ? iso(entry.observedAt, 'CHAIN_ENTRY_TIME') : null, source: entry.source ? text(entry.source, 'CHAIN_ENTRY_SOURCE', 64) : null, contentHash: entry.contentHash ? text(entry.contentHash, 'CHAIN_ENTRY_HASH', 128) : null });
  });
  const required = Array.isArray(options.requiredTypes) && options.requiredTypes.length ? options.requiredTypes.map(x => String(x).toLowerCase()) : ['ticket', 'technician', 'gps', 'asset', 'timestamp', 'closure'];
  const present = new Set(normalized.map(x => x.type));
  const missing = required.filter(type => !present.has(type));
  const order = normalized.map(x => CHAIN_TYPES.indexOf(x.type));
  const orderValid = order.every((v, i) => i === 0 || v >= order[i - 1]);
  const certificate = {
    schemaVersion: '1.0',
    requiredTypes: required,
    entries: normalized,
    completeness: { requiredCount: required.length, presentCount: required.length - missing.length, missingTypes: missing, orderValid },
    authority: 'DETERMINISTIC_EVIDENCE_CHAIN_CERTIFICATE',
    autonomousVerification: false
  };
  const chainHash = sha256(certificate);
  return Object.freeze({ ...certificate, chainHash, certificateId: `evidence-chain:${chainHash}` });
}

function capacityIntelligence(row) {
  object(row, 'row');
  const total = Number(row.totalPorts);
  const used = Number(row.usedPorts || 0);
  const reserved = Number(row.reservedPorts || 0);
  const provisioned = Number(row.provisionedPorts || 0);
  if (!Number.isFinite(total) || total < 0) throw new TypeError('totalPorts must be non-negative');
  for (const [name, value] of [['usedPorts', used], ['reservedPorts', reserved], ['provisionedPorts', provisioned]]) {
    if (!Number.isFinite(value) || value < 0) throw new TypeError(`${name} must be non-negative`);
  }
  const allocated = used + reserved;
  const free = Math.max(0, total - allocated);
  const overCapacity = allocated > total;
  const utilizationPct = total === 0 ? 0 : (allocated / total) * 100;
  let status = 'AVAILABLE';
  if (overCapacity) status = 'OVER_CAPACITY';
  else if (total > 0 && utilizationPct >= Number(row.criticalUtilizationPct ?? 95)) status = 'CRITICAL_HEADROOM';
  else if (total > 0 && utilizationPct >= Number(row.warningUtilizationPct ?? 85)) status = 'LOW_HEADROOM';
  return Object.freeze({
    totalPorts: total,
    provisionedPorts: provisioned,
    usedPorts: used,
    reservedPorts: reserved,
    allocatedPorts: allocated,
    freePorts: free,
    utilizationPct: Number(utilizationPct.toFixed(2)),
    overCapacity,
    status,
    basis: 'database-derived port state; no manually asserted capacity'
  });
}

module.exports = Object.freeze({
  normalizeAlarmSignal,
  correlateAlarmSignals,
  opticalHealthFingerprint,
  buildEvidenceChain,
  capacityIntelligence,
  sha256
});
