#!/usr/bin/env node
'use strict';
const http = require('node:http');

function get(url, timeoutMs) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ url, status: res.statusCode, body }));
    });
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('HEALTH_TIMEOUT')); });
    req.on('error', (error) => resolve({ url, status: 0, error: String(error.message || error) }));
  });
}

async function main() {
  const timeoutMs = Math.min(10000, Math.max(250, Number(process.env.HEALTH_TIMEOUT_MS || 3000)));
  const targets = [
    ['api', process.env.API_URL || 'http://127.0.0.1:8080/health'],
    ['ai', process.env.AI_URL || 'http://127.0.0.1:8081/health'],
    ...(process.env.GIS_URL ? [['gis', process.env.GIS_URL]] : [])
  ];
  const checks = Object.fromEntries(await Promise.all(targets.map(async ([name, url]) => [name, await get(url, timeoutMs)])));
  const ok = Object.values(checks).every((check) => check.status === 200);
  console.log(JSON.stringify({ ok, timeoutMs, checks }, null, 2));
  if (!ok) process.exitCode = 1;
}
main();
