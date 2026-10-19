'use strict';

const { authorizeHttpRequest } = require('../../api/src/authorizationMiddleware');
const { canonicalAiPath } = require('./httpContract');

function authorizeAiRequest(principal, env, requestPath = '/v1/ai/advise') {
  const path = canonicalAiPath(requestPath);
  if (!path) return { ok: false, status: 404, body: { ok: false, error: 'AI_ROUTE_NOT_FOUND' } };
  return authorizeHttpRequest(principal, {
    path,
    method: 'POST',
    env: env || process.env
  });
}

module.exports = { authorizeAiRequest };
