'use strict';

/**
 * FTTH Advisory routes (A–F session surfaces)
 * All responses are CALCULATED_ADVISORY. No auto work-orders, no invented OTDR numbers.
 */

const domain = require('../../../../packages/domain/src');
const { processOtdrBuffer, listRegisteredVendors, STANDARDS_NOTE } =
  require('../../../../packages/adapters/src/global/otdrVendorRegistry');
const { publicError } = require('../../../../packages/security/src/errorBoundary');

function run(fn, body) {
  try {
    return {
      status: 200,
      body: {
        ok: true,
        authority: 'CALCULATED_ADVISORY',
        result: fn(body || {})
      }
    };
  } catch (e) {
    const client = e instanceof TypeError || e instanceof RangeError || (e && e.code);
    return publicError(
      Object.assign(e, { statusCode: client ? 400 : 500 }),
      client ? 'INVALID_FTTH_ADVISORY_INPUT' : 'FTTH_ADVISORY_FAILED'
    );
  }
}

const handlers = Object.freeze({
  linkBudgetCompare: (body) => domain.linkBudgetComparison.compareLinkBudget(body),
  pathPlausibility: (body) => domain.geometricPlausibility.assessPathPlausibility(body),
  exceptionBoard: (body) => domain.exceptionBoardSignals.rankExceptionBoard(body.tickets || body, body.ctx),
  assetFingerprint: (body) => domain.assetFingerprint.createAssetFingerprint(body.asset || body),
  constructionCost: (body) => domain.constructionCostEstimator.estimateConstructionCost(body),
  otdrStandards: () => ({ ...STANDARDS_NOTE, registeredVendors: listRegisteredVendors() }),
  otdrProcess: (body) => {
    if (!body || !body.fileBase64) {
      throw Object.assign(new TypeError('fileBase64 required (base64-encoded .SOR)'), { code: 'FILE_REQUIRED' });
    }
    const buf = Buffer.from(body.fileBase64, 'base64');
    return processOtdrBuffer(buf, body.declaredVendor || null);
  }
});

function handleFtthAdvisory(path, body) {
  const key = path
    .replace(/^\/v1\/ftth-advisory\//, '')
    .replace(/^\/v1\/ftth\//, '')
    .replace(/-/g, '');
  const map = {
    linkbudgetcompare: 'linkBudgetCompare',
    pathplausibility: 'pathPlausibility',
    exceptionboard: 'exceptionBoard',
    assetfingerprint: 'assetFingerprint',
    constructioncost: 'constructionCost',
    otdrstandards: 'otdrStandards',
    otdrprocess: 'otdrProcess'
  };
  const handler = handlers[map[key]];
  if (!handler) {
    return { status: 404, body: { ok: false, error: 'FTTH_ADVISORY_ENDPOINT_NOT_FOUND' } };
  }
  return run(handler, body);
}

module.exports = { handleFtthAdvisory, handlers };
