'use strict';

const E = require('../../../../packages/engineering/src');
const OpticalMath = require('../../../../packages/ftth-measurements/src/opticalEngineering');
const { publicError } = require('../../../../packages/security/src/errorBoundary');

function run(fn, body) {
  try {
    return { status: 200, body: { ok: true, authority: 'CALCULATED_ADVISORY', result: fn(body || {}) } };
  } catch (e) {
    const client = e instanceof TypeError || e instanceof RangeError;
    return publicError(Object.assign(e, { statusCode: client ? 400 : 500 }), client ? 'INVALID_ENGINEERING_INPUT' : 'ENGINEERING_COMPUTATION_FAILED');
  }
}

const handlers = Object.freeze({
  opticalBudget: body => E.opticalPhysics.linkBudget(body),
  otdrDistance: body => OpticalMath.distanceFromRoundTripTimeSeconds(body.roundTripSeconds, body.groupIndex),
  otdrDistanceUncertainty: body => OpticalMath.distanceUncertaintyFromRoundTripTime(body),
  otdrBackscatterAttenuation: body => OpticalMath.attenuationDbPerKmFromBackscatterPoints(body.point1, body.point2),
  otdrBackscatterUncertainty: body => OpticalMath.attenuationUncertaintyFromBackscatterPoints(body.point1, body.point2),
  otdrTraceFit: body => OpticalMath.fitBackscatterTrace(body.points),
  otdrEventLoss: body => OpticalMath.eventLossDb(body.powerBeforeDbm, body.powerAfterDbm),
  otdrReflectance: body => OpticalMath.reflectanceDbFromDbm(body.reflectedDbm, body.incidentDbm),
  otdrReflectanceUncertainty: body => OpticalMath.reflectanceUncertaintyFromDbm(body),
  rxPowerFromBudget: body => OpticalMath.receivedPowerDbm(body),
  rxPowerMargin: body => OpticalMath.rxPowerMarginDb(body.rxPowerDbm, body.sensitivityDbm),
  residual: body => E.opticalPhysics.residualAnalysis(body),
  reliability: body => E.reliability.weibull(body),
  proportionalHazard: body => E.reliability.proportionalHazard(body),
  diagnosis: body => E.bayesianDiagnosis.posterior(body),
  gaussianFusion: body => E.bayesianDiagnosis.gaussianInformationFusion(body.observations),
  correlatedGaussianFusion: body => E.bayesianDiagnosis.correlatedGaussianFusion(body.values, body.covariance),
  correlatedOpticalMargin: body => E.opticalAdvanced.correlatedLinkMargin(body),
  weibullMle: body => E.reliabilityAdvanced.weibullMLE(body),
  maxFlow: body => E.networkResilience.maxFlow(body),
  edgeDisjointPaths: body => E.networkResilience.edgeDisjointPathCount(body),
  cvarLoss: body => E.risk.cvarLoss(body),
  riskAdjustedUtility: body => E.risk.riskAdjustedRanking(body),
  validateCalibration: body => E.calibration.validateSet(body.parameters),
  blastRadius: body => E.networkAnalysis.blastRadius(body),
  shortestPath: body => E.networkAnalysis.shortestPath(body.edges, body.start, body.target, body.weightKey),
  expectedUtility: body => E.decisionScience.expectedUtility(body),
  uncertaintyBudget: body => E.decisionScience.uncertaintyBudget(body.components, body.weights),
  mahalanobis: body => E.drift.mahalanobisSquared(body.delta, body.covarianceInverse),
  drift: body => E.drift.driftDecision(body.distanceSquared, body.threshold),
  multivariateDiagnosis: body => E.multivariateDiagnosis.gaussianClassifier(body),
  robustZ: body => E.robustStatistics.robustZ(body.value, body.values, body.consistency),
  huberLocation: body => E.robustStatistics.huberLocation(body.values, body.options),
  freshness: body => E.quality.freshness(body.ageSeconds, body.halfLifeSeconds),
  truthQuality: body => E.quality.truthQuality(body),
  twinImpact: body => E.twin.nodeImpact(body),
  twinReverseClosure: body => E.twin.reverseClosure(body),
  sharedRiskAvailability: body => E.twin.effectiveEdgeAvailability(body.edges, body.failedEdgeIds),
  vendorProfileResolve: body => E.vendorProfiles.resolve(body),
  opticalPath: body => E.opticalPath.propagatePath(body),
  opticalPathUncertainty: body => E.opticalPath.propagateWithCorrelatedInputs(body),
  enumeratePaths: body => E.resilienceAdvanced.enumerateSimplePaths(body),
  pathReliability: body => E.resilienceAdvanced.independentPathReliability(body),
  sharedRiskGroups: body => E.resilienceAdvanced.sharedRiskGroups(body.edges),
  negotiateCapabilities: body => E.capabilityNegotiation.negotiate(body),
  standardCompatibility: body => E.standardsProfiles.compatible({profileId:'required',standardRefs:body.required||[]},{profileId:'available',standardRefs:body.available||[]}),
  governedOptical: body => E.governedOptical.evaluate(body),
  conformance: body => E.conformance.evaluate(body),
  conformanceCompatibility: body => E.conformance.compatibility(body.required, body.available),
  // A–F advisory surfaces (session extensions) — all CALCULATED_ADVISORY
  opticalHypothesisRank: body => E.opticalHypothesisRanker.rankOpticalHypotheses(body),
  calibratedDiagnosis: body => {
    const packMod = E.calibratedLikelihoodPack;
    if (!body || !body.pack) {
      const e = new TypeError('CALIBRATED_PACK_REQUIRED');
      e.code = 'CALIBRATED_PACK_REQUIRED';
      throw e;
    }
    return packMod.diagnoseWithPack(body.pack, body.observation || body);
  },
  // Section 20 shared-risk scenario + service-path hop bridge (advisory only)
  sharedRiskExposure: body => E.resilienceAdvanced.analyseSharedRiskExposure(body),
  whatIfResourceFails: body => E.resilienceAdvanced.whatIfResourceFails(body),
  criticalConcentration: body => E.resilienceAdvanced.rankCriticalConcentration(body),
  servicePathDependencies: body => E.resilienceAdvanced.dependenciesFromServicePathHops(body),
  sharedRiskFromServicePaths: body => E.resilienceAdvanced.analyseSharedRiskFromServicePaths(body),
  servicePathsFromTrace: body => E.resilienceAdvanced.servicePathsFromTraceNodes(body),
  sharedRiskFromTraceNodes: body => E.resilienceAdvanced.analyseSharedRiskFromTraceNodes(body)
});

function handleEngineering(path, body) {
  const key = path.replace(/^\/v1\/engineering\//, '').replace(/-/g, '');
  const map = {
    opticalbudget: 'opticalBudget', otdrdistance: 'otdrDistance', otdrdistanceuncertainty: 'otdrDistanceUncertainty', otdrbackscatterattenuation: 'otdrBackscatterAttenuation', otdrbackscatteruncertainty: 'otdrBackscatterUncertainty', otdrtracefit: 'otdrTraceFit', otdreventloss: 'otdrEventLoss', otdrreflectance: 'otdrReflectance', otdrreflectanceuncertainty: 'otdrReflectanceUncertainty', rxpowerfrombudget: 'rxPowerFromBudget', rxpowermargin: 'rxPowerMargin', residual: 'residual', reliability: 'reliability',
    proportionalhazard: 'proportionalHazard', diagnosis: 'diagnosis', gaussianfusion: 'gaussianFusion', correlatedgaussianfusion: 'correlatedGaussianFusion', correlatedopticalmargin: 'correlatedOpticalMargin', weibullmle: 'weibullMle', maxflow: 'maxFlow', edgedisjointpaths: 'edgeDisjointPaths', cvarloss: 'cvarLoss', riskadjustedutility: 'riskAdjustedUtility', validatecalibration: 'validateCalibration',
    blastradius: 'blastRadius', shortestpath: 'shortestPath', expectedutility: 'expectedUtility',
    uncertaintybudget: 'uncertaintyBudget', mahalanobis: 'mahalanobis', drift: 'drift',
    multivariatediagnosis: 'multivariateDiagnosis', robustz: 'robustZ', huberlocation: 'huberLocation', freshness: 'freshness', truthquality: 'truthQuality', twinimpact: 'twinImpact', twinreverseclosure: 'twinReverseClosure', sharedriskavailability: 'sharedRiskAvailability', vendorprofileresolve: 'vendorProfileResolve', opticalpath: 'opticalPath', opticalpathuncertainty: 'opticalPathUncertainty', enumeratepaths: 'enumeratePaths', pathreliability: 'pathReliability', sharedriskgroups: 'sharedRiskGroups', negotiatecapabilities: 'negotiateCapabilities', standardcompatibility: 'standardCompatibility', governedoptical: 'governedOptical', conformance: 'conformance', conformancecompatibility: 'conformanceCompatibility',
    opticalhypothesisrank: 'opticalHypothesisRank', calibrateddiagnosis: 'calibratedDiagnosis',
    sharedriskexposure: 'sharedRiskExposure', whatifresourcefails: 'whatIfResourceFails',
    criticalconcentration: 'criticalConcentration', servicepathdependencies: 'servicePathDependencies',
    sharedriskfromservicepaths: 'sharedRiskFromServicePaths',
    servicepathsfromtrace: 'servicePathsFromTrace',
    sharedriskfromtracenodes: 'sharedRiskFromTraceNodes'
  };
  const handler = handlers[map[key]];
  if (!handler) return { status: 404, body: { ok: false, error: 'ENGINEERING_ENDPOINT_NOT_FOUND' } };
  return run(handler, body);
}

module.exports = { handleEngineering, handlers };
