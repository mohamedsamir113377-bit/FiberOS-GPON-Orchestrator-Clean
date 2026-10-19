'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { twinVerification: twin } = require('../src');

function trustedTestSigner(keyId = 'test-key-1') {
  const pair = crypto.generateKeyPairSync('ed25519');
  return {
    privateKey: pair.privateKey,
    resolvePublicKey: (requested) => requested === keyId ? pair.publicKey : undefined,
    keyId,
  };
}

test('topology verification accepts a finite DAG and rejects cycles', () => {
  const input = { nodes: ['OLT', 'FDT', 'ONT'], edges: [{ from: 'OLT', to: 'FDT' }, { from: 'FDT', to: 'ONT' }], roots: ['OLT'] };
  assert.equal(twin.verifyTopologyDag(input).status, 'PASS');
  assert.throws(() => twin.verifyTopologyDag({ ...input, edges: [...input.edges, { from: 'ONT', to: 'OLT' }] }), /TOPOLOGY_CYCLE/);
});

test('optical parity blocks drift beyond the declared tolerance', () => {
  assert.equal(twin.validateOpticalParity({ expected: 12, measured: 12.0005, toleranceDb: 0.001 }).status, 'PASS');
  assert.equal(twin.validateOpticalParity({ expected: 12, measured: 12.002, toleranceDb: 0.001 }).status, 'BLOCKED');
});

test('spatial plausibility and reality evidence fail closed', () => {
  assert.equal(twin.validateSpatialAsset({ lengthMeters: 6000, vertexCount: 2 }).status, 'BLOCKED');
  assert.equal(twin.validateRealityEvidence({ expectedFingerprint: 'a', observedFingerprint: 'b', geo: { passed: true }, optical: { status: 'PASS' } }).status, 'BLOCKED');
  assert.equal(twin.validateRealityEvidence({ expectedFingerprint: 'a', observedFingerprint: 'a', geo: { passed: true }, optical: { status: 'PASS' } }).status, 'PASS');
});

test('twin seal is deterministic, tenant-bound, and detects state mutation', () => {
  const seal = twin.sealTwinState({ tenantId: 'tenant-a', sequence: 4, state: { assets: ['a'], status: 'active' } });
  assert.equal(twin.verifyTwinSeal(seal, { assets: ['a'], status: 'active' }).status, 'PASS');
  assert.equal(twin.verifyTwinSeal(seal, { assets: ['b'], status: 'active' }).status, 'BLOCKED');
  assert.notEqual(seal.stateHash, twin.sealTwinState({ tenantId: 'tenant-b', sequence: 4, state: { assets: ['a'], status: 'active' } }).stateHash);
});

test('twin seal supports required Ed25519 signatures and rejects untrusted or tampered seals', () => {
  const signer = trustedTestSigner();
  const state = { assets: ['a'], status: 'active' };
  const seal = twin.sealTwinState({ tenantId: 'tenant-a', sequence: 5, state, signingKey: signer.privateKey, keyId: signer.keyId });
  assert.equal(twin.verifyTwinSeal(seal, state, { resolvePublicKey: signer.resolvePublicKey, requireSignature: true }).status, 'PASS');
  assert.equal(twin.verifyTwinSeal(seal, state, { requireSignature: true }).reason, 'TWIN_SIGNATURE_UNVERIFIED');
  assert.equal(twin.verifyTwinSeal({ ...seal, signature: { ...seal.signature, value: Buffer.from('tampered').toString('base64') } }, state, { resolvePublicKey: signer.resolvePublicKey, requireSignature: true }).status, 'BLOCKED');
  assert.equal(twin.verifyTwinSeal(seal, { assets: ['changed'] }, { resolvePublicKey: signer.resolvePublicKey, requireSignature: true }).status, 'BLOCKED');
});

test('RSA-SHA256 and ECDSA-SHA256 signatures verify with the declared key types', () => {
  const cases = [
    { algorithm: 'RSA-SHA256', pair: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }) },
    { algorithm: 'ECDSA-SHA256', pair: crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' }) },
  ];
  for (const { algorithm, pair } of cases) {
    const keyId = `key-${algorithm}`;
    const evidence = twin.signEvidencePayload({ fingerprint: 'fp-1', passed: true }, { privateKey: pair.privateKey, keyId, algorithm });
    assert.equal(twin.verifyEvidenceSignature(evidence, (requested) => requested === keyId ? pair.publicKey : undefined).verified, true);
    const state = { version: 1 };
    const seal = twin.sealTwinState({ tenantId: 'tenant-a', sequence: 1, state, signingKey: pair.privateKey, keyId, signatureAlgorithm: algorithm });
    assert.equal(twin.verifyTwinSeal(seal, state, { resolvePublicKey: (requested) => requested === keyId ? pair.publicKey : undefined, requireSignature: true }).status, 'PASS');
  }
});

test('failure simulation reports deterministic post-failure paths', () => {
  const edges = [{ id: 'a', from: 's', to: 'x' }, { id: 'b', from: 'x', to: 't' }, { id: 'c', from: 's', to: 'y', sharedRiskGroup: 'duct-1' }, { id: 'd', from: 'y', to: 't', sharedRiskGroup: 'duct-1' }];
  const result = twin.simulateFailure({ edges, source: 's', target: 't', failedEdgeIds: ['c'], requiredDisjointPaths: 1 });
  assert.equal(result.baselinePaths, 2);
  assert.equal(result.postFailurePaths, 1);
  assert.equal(result.passes, true);
});

test('topology verification detects cycles in components unreachable from the supplied roots', () => {
  const nodes = ['OLT', 'FDT', 'ONT', 'ISO-A', 'ISO-B'];
  const edges = [{ from: 'OLT', to: 'FDT' }, { from: 'FDT', to: 'ONT' }, { from: 'ISO-A', to: 'ISO-B' }, { from: 'ISO-B', to: 'ISO-A' }];
  // cycle lives only in the ISO-A/ISO-B component, which is not reachable from root OLT
  assert.throws(() => twin.verifyTopologyDag({ nodes, edges, roots: ['OLT'] }), /TOPOLOGY_CYCLE/);
  // an acyclic island still passes and is traversed
  const ok = twin.verifyTopologyDag({ nodes: ['OLT', 'ISO-A'], edges: [{ from: 'OLT', to: 'ISO-A' }], roots: ['OLT'] });
  assert.equal(ok.status, 'PASS');
  assert.equal(ok.traversedCount, 2);
});

test('reality evidence strict mode verifies signatures against trusted keys and binds payloads to the snapshot', () => {
  const signer = trustedTestSigner();
  const fingerprint = 'snapshot-fingerprint-1';
  const signed = (type, payload) => twin.signEvidencePayload({ fingerprint, ...payload }, { privateKey: signer.privateKey, keyId: signer.keyId, type });
  const base = {
    expectedFingerprint: fingerprint,
    observedFingerprint: fingerprint,
    requireProvenance: true,
    resolvePublicKey: signer.resolvePublicKey,
    geo: { evidence: signed('geo', { passed: true, source: 'survey-device' }) },
    optical: { evidence: signed('optical', { status: 'PASS', source: 'otdr-device' }) },
    provenance: { evidence: signed('provenance', { verified: true, source: 'evidence-registry' }) },
  };
  const verified = twin.validateRealityEvidence(base);
  assert.equal(verified.status, 'PASS');
  assert.equal(verified.provenance.satisfied, true);
  assert.equal(verified.provenance.sourceVerified, true);
  assert.equal(twin.validateRealityEvidence({ ...base, resolvePublicKey: () => undefined }).status, 'BLOCKED');
  assert.equal(twin.validateRealityEvidence({ ...base, observedFingerprint: 'other-snapshot' }).status, 'BLOCKED');
  assert.equal(twin.verifyEvidenceSignature({ ...base.geo.evidence, keyId: 'untrusted-key' }, signer.resolvePublicKey).verified, false);
  assert.equal(twin.verifyEvidenceSignature({ ...base.geo.evidence, algorithm: 'RSA-SHA256' }, signer.resolvePublicKey).verified, false);
  assert.equal(twin.verifyEvidenceSignature(base.geo.evidence, signer.resolvePublicKey, { expectedType: 'optical' }).verified, false);
  assert.equal(twin.validateRealityEvidence({ ...base, optical: { evidence: { ...base.optical.evidence, payload: { fingerprint, status: 'PASS', source: 'forged' } } } }).status, 'BLOCKED');
});

test('advisory reality mode does not claim caller-provided signature flags are cryptographic proof', () => {
  const base = { expectedFingerprint: 'a', observedFingerprint: 'a', geo: { passed: true, signatureVerified: true }, optical: { status: 'PASS', signatureVerified: true }, provenance: { verified: true } };
  const advisory = twin.validateRealityEvidence(base);
  assert.equal(advisory.status, 'PASS');
  assert.equal(advisory.provenance.satisfied, false);
  assert.equal(advisory.provenance.sourceVerified, false);
  const strict = twin.validateRealityEvidence({ ...base, requireProvenance: true });
  assert.equal(strict.status, 'BLOCKED');
  assert.equal(strict.reason, 'REALITY_EVIDENCE_MISMATCH');
});

test('verified twin snapshot can require a cryptographic seal signature', () => {
  const signer = trustedTestSigner();
  const state = { assets: ['a'], topologyVersion: 1 };
  const base = { tenantId: 'tenant-a', sequence: 1, state, nodes: ['a', 'b'], edges: [{ from: 'a', to: 'b' }], roots: ['a'], signingKey: signer.privateKey, resolvePublicKey: signer.resolvePublicKey, keyId: signer.keyId, requireSignature: true };
  assert.equal(twin.buildVerifiedTwinSnapshot({ ...base, reality: { status: 'PASS' } }).status, 'PASS');
  assert.equal(twin.buildVerifiedTwinSnapshot({ ...base, resolvePublicKey: undefined, reality: { status: 'PASS' } }).status, 'BLOCKED');
  assert.equal(twin.buildVerifiedTwinSnapshot({ ...base, reality: { status: 'BLOCKED' } }).status, 'BLOCKED');
});
