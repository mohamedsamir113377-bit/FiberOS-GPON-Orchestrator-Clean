'use strict';
/**
 * FiberOS Alpha 15 — Data & Experiment Reproducibility
 *
 * Design rule:
 *   A scientific/engineering result is admissible only when the inputs,
 *   transformation lineage, split assignment, parameter/model fingerprints,
 *   code identity, environment and deterministic seed can be reconstructed.
 *
 * This module does NOT manufacture a dataset, acceptance threshold, model score,
 * or provenance claim. It records and verifies supplied facts.
 */
const crypto = require('crypto');
const fs = require('fs');

function requireString(v, n) {
  if (typeof v !== 'string' || !v.trim()) throw new TypeError(`${n} must be a non-empty string`);
  return v;
}
function requireObject(v, n) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new TypeError(`${n} must be an object`);
  return v;
}
function requireArray(v, n) {
  if (!Array.isArray(v) || !v.length) throw new RangeError(`${n} required`);
  return v;
}
function stable(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(stable);
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = stable(value[key]);
  return out;
}
function canonicalJson(value) { return JSON.stringify(stable(value)); }
function sha256(value) {
  const buf = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : canonicalJson(value));
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function fileSha256(path) {
  requireString(path, 'path');
  return sha256(fs.readFileSync(path));
}
function normalizeIdList(xs, n) {
  requireArray(xs, n);
  const out = xs.map((x, i) => requireString(String(x), `${n}[${i}]`));
  if (new Set(out).size !== out.length) throw new RangeError(`${n} contains duplicates`);
  return out;
}
function frozen(obj) { return Object.freeze(obj); }

function datasetManifest({datasetId, version, schemaVersion, records, sourceRefs = [], transformations = [], contentHash = null, description = null}) {
  requireString(datasetId, 'datasetId');
  requireString(version, 'version');
  requireString(schemaVersion, 'schemaVersion');
  requireArray(records, 'records');
  const ids = records.map((r, i) => {
    requireObject(r, `records[${i}]`);
    return requireString(String(r.id ?? ''), `records[${i}].id`);
  });
  if (new Set(ids).size !== ids.length) throw new RangeError('record ids must be unique');
  const manifest = {
    kind: 'fiberos.dataset-manifest',
    version: 1,
    datasetId, version: String(version), schemaVersion,
    recordCount: records.length,
    recordIdsSha256: sha256(ids.slice().sort()),
    sourceRefs: sourceRefs.map((x, i) => {
      requireObject(x, `sourceRefs[${i}]`);
      return stable(x);
    }),
    transformations: transformations.map((x, i) => {
      requireObject(x, `transformations[${i}]`);
      if (!x.name || !x.version) throw new TypeError(`transformations[${i}] requires name and version`);
      return stable(x);
    }),
    contentHash: contentHash == null ? null : requireString(contentHash, 'contentHash'),
    description: description == null ? null : String(description)
  };
  manifest.manifestHash = sha256(manifest);
  return frozen(manifest);
}

function splitManifest({datasetManifestHash, splitMethod, seed, assignments, groupKey = null, parentDatasetHash = null}) {
  requireString(datasetManifestHash, 'datasetManifestHash');
  requireString(splitMethod, 'splitMethod');
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  requireObject(assignments, 'assignments');
  const normalized = {};
  const seen = new Set();
  for (const name of Object.keys(assignments).sort()) {
    const ids = normalizeIdList(assignments[name], `assignments.${name}`);
    for (const id of ids) {
      if (seen.has(id)) throw new RangeError(`record ${id} appears in multiple splits`);
      seen.add(id);
    }
    normalized[name] = ids.slice().sort();
  }
  if (Object.keys(normalized).length < 2) throw new RangeError('at least two splits are required');
  const result = {kind:'fiberos.split-manifest',version:1,datasetManifestHash,splitMethod,seed,groupKey:groupKey==null?null:String(groupKey),parentDatasetHash:parentDatasetHash==null?null:String(parentDatasetHash),assignments:normalized};
  result.assignmentHash = sha256(normalized);
  result.manifestHash = sha256(result);
  return frozen(result);
}

function modelFingerprint({name, version, codeIdentity, hyperparameters = {}, featureSchema = [], trainingManifestHash, calibrationManifestHash = null}) {
  requireString(name, 'name'); requireString(version, 'version'); requireString(codeIdentity, 'codeIdentity'); requireString(trainingManifestHash, 'trainingManifestHash');
  if (!Array.isArray(featureSchema)) throw new TypeError('featureSchema must be an array');
  const payload = {kind:'fiberos.model-fingerprint',version:1,name,modelVersion:version,codeIdentity,hyperparameters:stable(hyperparameters),featureSchema:stable(featureSchema),trainingManifestHash,calibrationManifestHash:calibrationManifestHash==null?null:String(calibrationManifestHash)};
  return frozen({ ...payload, fingerprint: sha256(payload) });
}

function parameterFingerprint({registryVersion, approvedParameterIds, calibrationManifestHashes = []}) {
  requireString(registryVersion, 'registryVersion');
  const ids = normalizeIdList(approvedParameterIds, 'approvedParameterIds').sort();
  const hashes = calibrationManifestHashes.map((x, i) => requireString(String(x), `calibrationManifestHashes[${i}]`)).sort();
  const payload = {kind:'fiberos.parameter-fingerprint',version:1,registryVersion,approvedParameterIds:ids,calibrationManifestHashes:hashes};
  return frozen({ ...payload, fingerprint: sha256(payload) });
}

function experimentManifest({experimentId, codeRevision, dataset, split, model, parameters, evaluationDatasetHash, environment = {}, command = null, seed}) {
  requireString(experimentId, 'experimentId'); requireString(codeRevision, 'codeRevision'); requireString(evaluationDatasetHash, 'evaluationDatasetHash');
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  [dataset, split, model, parameters].forEach((x, i) => requireObject(x, ['dataset','split','model','parameters'][i]));
  const payload = {
    kind:'fiberos.experiment-manifest',version:1,experimentId,codeRevision,seed,
    datasetManifestHash: dataset.manifestHash,
    splitManifestHash: split.manifestHash,
    modelFingerprint: model.fingerprint,
    parameterFingerprint: parameters.fingerprint,
    evaluationDatasetHash,
    environment: stable(environment),
    command: command == null ? null : String(command)
  };
  return frozen({ ...payload, experimentHash: sha256(payload) });
}

function verifyExperiment(experiment, {datasetManifest, splitManifest, modelFingerprint, parameterFingerprint, expectedEvaluationDatasetHash = null} = {}) {
  requireObject(experiment, 'experiment');
  const errors = [];
  const checks = [];
  function check(name, ok, detail) { checks.push({name,ok:!!ok,detail:detail||''}); if(!ok) errors.push(name); }
  check('experiment_hash', sha256(Object.fromEntries(Object.entries(experiment).filter(([k])=>k!=='experimentHash'))) === experiment.experimentHash, 'recomputed experiment hash');
  if (datasetManifest) check('dataset_manifest_match', experiment.datasetManifestHash === datasetManifest.manifestHash, 'dataset manifest hash');
  if (splitManifest) check('split_manifest_match', experiment.splitManifestHash === splitManifest.manifestHash, 'split manifest hash');
  if (modelFingerprint) check('model_fingerprint_match', experiment.modelFingerprint === modelFingerprint.fingerprint, 'model fingerprint');
  if (parameterFingerprint) check('parameter_fingerprint_match', experiment.parameterFingerprint === parameterFingerprint.fingerprint, 'parameter fingerprint');
  if (expectedEvaluationDatasetHash != null) check('evaluation_dataset_match', experiment.evaluationDatasetHash === expectedEvaluationDatasetHash, 'evaluation dataset hash');
  return frozen({valid:errors.length===0,errors,checks});
}

function createSeededRng(seed) {
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer');
  let s = seed >>> 0;
  return function random() { s = (1664525 * s + 1013904223) >>> 0; return s / 4294967296; };
}

function datasetLineage({inputs, output, operation, operationVersion, codeIdentity, parameters = {}}) {
  requireArray(inputs, 'inputs'); requireString(output, 'output'); requireString(operation, 'operation'); requireString(operationVersion, 'operationVersion'); requireString(codeIdentity, 'codeIdentity');
  const inputHashes = inputs.map((x,i)=>requireString(String(x),`inputs[${i}]`)).sort();
  const payload={kind:'fiberos.dataset-lineage',version:1,inputHashes,output,operation,operationVersion,codeIdentity,parameters:stable(parameters)};
  return frozen({...payload,lineageHash:sha256(payload)});
}

module.exports={canonicalJson,sha256,fileSha256,datasetManifest,splitManifest,modelFingerprint,parameterFingerprint,experimentManifest,verifyExperiment,createSeededRng,datasetLineage};
