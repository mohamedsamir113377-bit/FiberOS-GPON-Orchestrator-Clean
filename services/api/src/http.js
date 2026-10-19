'use strict';
const { URL } = require('url');
const { applySecurityHeaders } = require('../../../packages/security/src/httpHardening');

function readBodyRaw(req, limit) {
  // M-4: same default as readBody / SECURITY_MAX_BODY_BYTES
  const configured = Number(process.env.SECURITY_MAX_BODY_BYTES || 1048576);
  limit = limit || (Number.isFinite(configured) && configured > 0 ? configured : 1048576);
  return new Promise(function (resolve, reject) {
    var chunks = []; var size = 0;
    let settled = false;
    req.on('data', function (c) {
      if (settled) return;
      size += c.length;
      if (size > limit) { settled = true; reject(Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', function () { if (settled) return; settled = true; var raw = Buffer.concat(chunks).toString('utf8'); resolve(raw); });
    req.on('error', function (err) { if (!settled) { settled = true; reject(err); } });
  });
}

function assertJsonComplexity(value, maxDepth, maxNodes) {
  const seen = new Set(); let nodes = 0;
  function walk(v, depth) {
    if (++nodes > maxNodes) throw Object.assign(new Error('JSON_NODE_LIMIT_EXCEEDED'), { statusCode: 413, code: 'JSON_NODE_LIMIT_EXCEEDED' });
    if (depth > maxDepth) throw Object.assign(new Error('JSON_DEPTH_EXCEEDED'), { statusCode: 413, code: 'JSON_DEPTH_EXCEEDED' });
    if (!v || typeof v !== 'object') return;
    if (seen.has(v)) return; seen.add(v);
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); }
    else { for (const x of Object.values(v)) walk(x, depth + 1); }
  }
  walk(value, 0);
  return value;
}

function readBody(req, limit) {
  const configuredLimit = Number(process.env.SECURITY_MAX_BODY_BYTES || 1048576);
  limit = Number.isInteger(limit) && limit > 0
    ? limit
    : (Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1048576);
  if (limit > 50 * 1024 * 1024) throw Object.assign(new Error('BODY_LIMIT_CONFIG_INVALID'), { statusCode: 500, code: 'BODY_LIMIT_CONFIG_INVALID' });
  const maxDepth = Number(process.env.SECURITY_MAX_JSON_DEPTH || 32);
  const maxNodes = Number(process.env.SECURITY_MAX_JSON_NODES || 10000);
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 256) throw Object.assign(new Error('JSON_DEPTH_CONFIG_INVALID'), { statusCode: 500 });
  if (!Number.isInteger(maxNodes) || maxNodes < 100 || maxNodes > 1000000) throw Object.assign(new Error('JSON_NODE_CONFIG_INVALID'), { statusCode: 500 });
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    let settled = false;
    req.on('data', function (c) {
      if (settled) return;
      size += c.length;
      if (size > limit) {
        settled = true;
        reject(Object.assign(new Error('BODY_TOO_LARGE'), { statusCode: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', function () {
      if (settled) return;
      settled = true;
      var raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve(null);
      try {
        const parsed = JSON.parse(raw);
        resolve(assertJsonComplexity(parsed, maxDepth, maxNodes));
      } catch (e) {
        if (e && (e.code === 'JSON_DEPTH_EXCEEDED' || e.code === 'JSON_NODE_LIMIT_EXCEEDED')) return reject(e);
        reject(Object.assign(new Error('INVALID_JSON'), { statusCode: 400 }));
      }
    });
    req.on('error', function (err) { if (!settled) { settled = true; reject(err); } });
  });
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  applySecurityHeaders(res, process.env);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-FiberOS-Authority': 'server'
  });
  res.end(body);
}

function notFound(res) {
  send(res, 404, { ok: false, error: 'NOT_FOUND' });
}

function parseUrl(req) {
  return new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
}

module.exports = { readBody, readBodyRaw, send, notFound, parseUrl };
