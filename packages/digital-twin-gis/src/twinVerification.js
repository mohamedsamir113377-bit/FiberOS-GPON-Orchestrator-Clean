'use strict';

const crypto = require('node:crypto');
const { build, effectiveEdgeAvailability } = require('../../engineering/src/twin');
const { maxFlow } = require('../../engineering/src/networkResilience');
const { assessPathPlausibility } = require('../../domain/src/geometricPlausibility');
const { linkBudget } = require('../../engineering/src/opticalPhysics');

const SIGNATURE_DIGESTS = Object.freeze({
  'RSA-SHA256': 'sha256',
  'ECDSA-SHA256': 'sha256',
  Ed25519: null,
});

function stable(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function finite(value, name) { const n = Number(value); if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`); return n; }
function signatureDigest(algorithm) {
  const digest = SIGNATURE_DIGESTS[algorithm];
  if (digest === undefined) throw new TypeError(`UNSUPPORTED_SIGNATURE_ALGORITHM:${algorithm}`);
  return digest;
}
function canonicalBytes(value) { return Buffer.from(stable(value), 'utf8'); }
function evidenceSigningBytes({ keyId, algorithm, type, payload }) {
  return canonicalBytes({ domain: 'fiberos.reality-evidence.v1', keyId, algorithm, type, payload });
}
function sealSigningBytes({ keyId, algorithm, canonical }) {
  return canonicalBytes({ domain: 'fiberos.digital-twin-seal.v1', keyId, algorithm, canonical });
}

/**
 * Sign a canonical JSON-compatible evidence payload. Private keys are supplied
 * by the caller and are never generated, stored, or embedded by this package.
 * Production callers should keep signing keys in an HSM/KMS-backed adapter.
 */
function signEvidencePayload(payload, { privateKey, keyId, algorithm = 'Ed25519', type = 'generic' } = {}) {
  assert(privateKey, 'SIGNING_PRIVATE_KEY_REQUIRED');
  assert(typeof keyId === 'string' && keyId.trim(), 'SIGNING_KEY_ID_REQUIRED');
  assert(typeof type === 'string' && type.trim(), 'EVIDENCE_TYPE_REQUIRED');
  const digest = signatureDigest(algorithm);
  const signature = crypto.sign(digest, evidenceSigningBytes({ keyId, algorithm, type, payload }), privateKey).toString('base64');
  return Object.freeze({ keyId, algorithm, type, payload, signature });
}

/**
 * Resolve public keys only from verifier-controlled trust configuration. A key
 * included by the evidence producer is deliberately never trusted by itself.
 */
function verifyEvidenceSignature(envelope, resolvePublicKey, { expectedType } = {}) {
  if (!envelope || typeof envelope !== 'object' || typeof resolvePublicKey !== 'function') return Object.freeze({ verified: false, reason: 'TRUSTED_KEY_RESOLVER_REQUIRED' });
  if (typeof envelope.keyId !== 'string' || !envelope.keyId || typeof envelope.type !== 'string' || !envelope.type || typeof envelope.signature !== 'string') return Object.freeze({ verified: false, reason: 'SIGNATURE_ENVELOPE_INVALID' });
  if (expectedType && envelope.type !== expectedType) return Object.freeze({ verified: false, reason: 'EVIDENCE_TYPE_MISMATCH' });
  try {
    const digest = signatureDigest(envelope.algorithm);
    const publicKey = resolvePublicKey(envelope.keyId, envelope.type);
    if (!publicKey) return Object.freeze({ verified: false, reason: 'UNTRUSTED_SIGNING_KEY' });
    const signature = Buffer.from(envelope.signature, 'base64');
    if (!signature.length || signature.toString('base64') !== envelope.signature) return Object.freeze({ verified: false, reason: 'SIGNATURE_ENCODING_INVALID' });
    const verified = crypto.verify(digest, evidenceSigningBytes(envelope), publicKey, signature);
    return Object.freeze({ verified, reason: verified ? null : 'SIGNATURE_INVALID', keyId: envelope.keyId, payload: envelope.payload });
  } catch (error) {
    return Object.freeze({ verified: false, reason: error && error.message === `UNSUPPORTED_SIGNATURE_ALGORITHM:${envelope.algorithm}` ? error.message : 'SIGNATURE_VERIFICATION_ERROR' });
  }
}

function verifyTopologyDag({ nodes = [], edges = [], roots = [] } = {}) {
  const graph = build(nodes, edges);
  const ids = new Set(graph.nodes);
  const adjacency = new Map(graph.nodes.map((id) => [id, []]));
  for (const edge of graph.edges) {
    assert(ids.has(edge.from) && ids.has(edge.to), `TOPOLOGY_DANGLING_EDGE:${edge.id}`);
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.to);
  }
  const color = new Map();
  const visit = (node) => {
    const state = color.get(node) || 0;
    if (state === 1) throw new Error(`TOPOLOGY_CYCLE:${node}`);
    if (state === 2) return;
    color.set(node, 1);
    for (const next of adjacency.get(node) || []) visit(next);
    color.set(node, 2);
  };
  // A single cycle anywhere makes the topology non-DAG, so every node is traversed
  // even when it is unreachable from the supplied roots (isolated components).
  const entryNodes = new Set(graph.nodes.map((node) => String(node)));
  for (const root of (roots.length ? roots : graph.nodes)) {
    const id = String(root);
    assert(ids.has(id), `TOPOLOGY_UNKNOWN_ROOT:${id}`);
    entryNodes.add(id);
  }
  for (const node of entryNodes) visit(node);
  return Object.freeze({ status: 'PASS', nodeCount: graph.nodes.length, edgeCount: graph.edges.length, rootCount: roots.length || graph.nodes.length, traversedCount: entryNodes.size, proofBoundary: 'finite supplied topology (all components, not only roots); database update atomicity and PostGIS truth require runtime acceptance' });
}

function validateOpticalParity({ expected, measured, toleranceDb = 0.001 } = {}) {
  const tolerance = finite(toleranceDb, 'toleranceDb');
  if (tolerance < 0) throw new RangeError('toleranceDb must be >= 0');
  const e = finite(expected, 'expected');
  const m = finite(measured, 'measured');
  const driftDb = Math.abs(e - m);
  return Object.freeze({ status: driftDb <= tolerance ? 'PASS' : 'BLOCKED', expected: e, measured: m, driftDb, toleranceDb: tolerance, reason: driftDb <= tolerance ? null : 'OPTICAL_PARITY_DRIFT_EXCEEDED' });
}

function validateSpatialAsset(input = {}) {
  const plausibility = assessPathPlausibility(input);
  if (!plausibility.plausible) return Object.freeze({ status: 'BLOCKED', plausibility });
  return Object.freeze({ status: 'PASS', plausibility });
}

function validateRealityEvidence({ expectedFingerprint, observedFingerprint, geo = {}, optical = {}, provenance = {}, requireProvenance = false, resolvePublicKey } = {}) {
  const fingerprintMatch = String(expectedFingerprint || '') !== '' && String(expectedFingerprint) === String(observedFingerprint || '');
  const geoSignature = verifyEvidenceSignature(geo.evidence, resolvePublicKey, { expectedType: 'geo' });
  const opticalSignature = verifyEvidenceSignature(optical.evidence, resolvePublicKey, { expectedType: 'optical' });
  const provenanceSignature = verifyEvidenceSignature(provenance.evidence, resolvePublicKey, { expectedType: 'provenance' });
  const geoSignatureVerified = geoSignature.verified === true && geoSignature.payload.fingerprint === String(expectedFingerprint || '');
  const opticalSignatureVerified = opticalSignature.verified === true && opticalSignature.payload.fingerprint === String(expectedFingerprint || '');
  const provenanceVerified = provenanceSignature.verified === true && provenanceSignature.payload.fingerprint === String(expectedFingerprint || '') && provenanceSignature.payload.verified === true;
  // Legacy, advisory mode consumes declared flags but never reports them as
  // cryptographically verified. Strict mode derives pass states from signed data.
  const geoPassed = requireProvenance ? geoSignatureVerified && geoSignature.payload.passed === true : geo.passed === true;
  const opticalPassed = requireProvenance
    ? opticalSignatureVerified && (opticalSignature.payload.status === 'PASS' || opticalSignature.payload.passed === true)
    : optical.status === 'PASS' || optical.passed === true;
  const provenanceSatisfied = geoSignatureVerified && opticalSignatureVerified && provenanceVerified;
  const evidencePassed = fingerprintMatch && geoPassed && opticalPassed;
  const passed = evidencePassed && (!requireProvenance || provenanceSatisfied);
  let reason = null;
  if (!evidencePassed) reason = 'REALITY_EVIDENCE_MISMATCH';
  else if (!passed) reason = 'REALITY_EVIDENCE_PROVENANCE_UNVERIFIED';
  return Object.freeze({
    status: passed ? 'PASS' : 'BLOCKED',
    fingerprintMatch,
    geoPassed,
    opticalPassed,
    reason,
    provenance: Object.freeze({ required: requireProvenance, satisfied: provenanceSatisfied, geoSignatureVerified, opticalSignatureVerified, provenanceVerified, sourceVerified: provenanceSatisfied }),
  });
}

function sealTwinState({ tenantId, sequence, state, previousHash = '', signingKey, keyId, signatureAlgorithm = 'Ed25519' } = {}) {
  assert(String(tenantId || '').length > 0, 'TENANT_ID_REQUIRED');
  const seq = Number(sequence);
  if (!Number.isSafeInteger(seq) || seq < 0) throw new RangeError('sequence must be a non-negative safe integer');
  const canonical = stable({ tenantId: String(tenantId), sequence: seq, previousHash: String(previousHash || ''), state });
  const hash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  const seal = { tenantId: String(tenantId), sequence: seq, previousHash: String(previousHash || ''), stateHash: hash, canonical };
  if (signingKey) {
    assert(typeof keyId === 'string' && keyId.trim(), 'SIGNING_KEY_ID_REQUIRED');
    const digest = signatureDigest(signatureAlgorithm);
    seal.signature = Object.freeze({ algorithm: signatureAlgorithm, keyId, value: crypto.sign(digest, sealSigningBytes({ keyId, algorithm: signatureAlgorithm, canonical }), signingKey).toString('base64') });
  }
  return Object.freeze(seal);
}

function verifyTwinSeal(seal, state, { resolvePublicKey, requireSignature = false } = {}) {
  const expected = sealTwinState({ tenantId: seal && seal.tenantId, sequence: seal && seal.sequence, previousHash: seal && seal.previousHash, state });
  const actualHash = seal && seal.stateHash;
  const hashMatches = typeof actualHash === 'string' && /^[a-f0-9]{64}$/i.test(actualHash)
    && crypto.timingSafeEqual(Buffer.from(expected.stateHash, 'hex'), Buffer.from(actualHash, 'hex'));
  let signatureStatus = 'MISSING';
  let signatureVerified = false;
  if (seal && seal.signature) {
    if (typeof resolvePublicKey !== 'function') signatureStatus = 'NOT_CHECKED';
    else {
      try {
        const digest = signatureDigest(seal.signature.algorithm);
        const publicKey = resolvePublicKey(seal.signature.keyId);
        const sig = Buffer.from(seal.signature.value || '', 'base64');
        signatureVerified = !!publicKey && sig.length > 0 && sig.toString('base64') === seal.signature.value
          && crypto.verify(digest, sealSigningBytes({ keyId: seal.signature.keyId, algorithm: seal.signature.algorithm, canonical: expected.canonical }), publicKey, sig);
        signatureStatus = signatureVerified ? 'VERIFIED' : 'INVALID';
      } catch (_) {
        signatureStatus = 'INVALID';
      }
    }
  }
  const signatureSatisfied = !requireSignature || signatureVerified;
  const passed = hashMatches && signatureSatisfied;
  let reason = null;
  if (!hashMatches) reason = 'TWIN_SEAL_MISMATCH';
  else if (!signatureSatisfied) reason = seal && seal.signature ? 'TWIN_SIGNATURE_UNVERIFIED' : 'TWIN_SIGNATURE_REQUIRED';
  return Object.freeze({ status: passed ? 'PASS' : 'BLOCKED', expectedHash: expected.stateHash, actualHash: actualHash || null, signatureStatus, signatureVerified, reason });
}

function simulateFailure({ edges = [], source, target, failedEdgeIds = [], requiredDisjointPaths = 1 } = {}) {
  const baseline = maxFlow({ edges: edges.map((edge) => ({ ...edge, capacity: 1 })), source, target }).maxFlow;
  const active = effectiveEdgeAvailability(edges, failedEdgeIds).filter((edge) => edge.available).map((edge) => ({ ...edge, capacity: 1 }));
  const after = maxFlow({ edges: active, source, target }).maxFlow;
  const required = finite(requiredDisjointPaths, 'requiredDisjointPaths');
  return Object.freeze({ baselinePaths: Math.floor(baseline + 1e-12), postFailurePaths: Math.floor(after + 1e-12), requiredDisjointPaths: required, passes: after + 1e-12 >= required, failedEdgeIds: [...failedEdgeIds], model: 'unit-capacity deterministic failure simulation' });
}

function buildVerifiedTwinSnapshot({ tenantId, sequence, state, nodes, edges, roots, seal, reality, signingKey, resolvePublicKey, keyId, signatureAlgorithm, requireSignature = false } = {}) {
  const topology = verifyTopologyDag({ nodes, edges, roots });
  const twinSeal = seal || sealTwinState({ tenantId, sequence, state, signingKey, keyId, signatureAlgorithm });
  const sealCheck = verifyTwinSeal(twinSeal, state, { resolvePublicKey, requireSignature });
  const realityCheck = reality || { status: 'NOT_PROVIDED', reason: 'LIVE_REALITY_EVIDENCE_REQUIRED' };
  if (topology.status !== 'PASS' || sealCheck.status !== 'PASS' || realityCheck.status === 'BLOCKED') {
    return Object.freeze({ status: 'BLOCKED', topology, seal: sealCheck, reality: realityCheck });
  }
  return Object.freeze({ status: 'PASS', topology, seal: twinSeal, sealCheck, reality: realityCheck, state });
}

module.exports = Object.freeze({ verifyTopologyDag, validateOpticalParity, validateSpatialAsset, validateRealityEvidence, signEvidencePayload, verifyEvidenceSignature, sealTwinState, verifyTwinSeal, simulateFailure, buildVerifiedTwinSnapshot, stable });
