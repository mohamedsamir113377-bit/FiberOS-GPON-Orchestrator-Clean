#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SITE = path.join(ROOT, '.netlify', 'site');
const PORT = Number(process.env.WEBSITE_PERF_PORT || 4181);

const ROUTES = [
  { name: 'buyer', path: '/' },
  { name: 'ops', path: '/ops/' },
  { name: 'enterprise', path: '/enterprise-command.html' },
  { name: 'field', path: '/field/' },
];

const BUDGET = Object.freeze({
  domContentLoadedMs: 1800,
  loadMs: 3200,
  totalJsBytes: 260 * 1024,
  totalCssBytes: 140 * 1024,
  largestJsBytes: 90 * 1024,
  largestCssBytes: 120 * 1024,
  longTasksOver50ms: 4,
});

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const requestPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const relative = requestPath.replace(/^[/\\]+/, '');
    let target = path.resolve(SITE, relative);
    const siteRoot = path.resolve(SITE);
    if (target !== siteRoot && !target.startsWith(siteRoot + path.sep)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, 'index.html');
    }
    if (!fs.existsSync(target)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
      return;
    }
    try {
      const body = fs.readFileSync(target);
      res.writeHead(200, {
        'content-type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
        'content-length': body.length,
      });
      res.end(body);
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(error));
    }
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

async function main() {
  if (!fs.existsSync(SITE)) {
    console.error('missing built site: run npm run website:build');
    process.exitCode = 1;
    return;
  }

  const server = await startServer();
  const browser = await chromium.launch();
  const failures = [];
  const rows = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });

    for (const route of ROUTES) {
      const page = await context.newPage();
      const pageErrors = [];
      page.on('pageerror', error => pageErrors.push(String(error?.message || error)));

      let response = null;
      try {
        response = await page.goto('http://127.0.0.1:' + PORT + route.path, {
          waitUntil: 'load',
          timeout: 30000,
        });
        await page.waitForTimeout(250);
      } catch (error) {
        failures.push(route.name + ': navigation failed — ' + error.message);
        await page.close();
        continue;
      }

      const metrics = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource');
        const scripts = resources
          .filter(entry => new URL(entry.name).pathname.endsWith('.js'))
          .map(entry => ({ url: entry.name, bytes: entry.transferSize || entry.decodedBodySize || 0 }));
        const styles = resources
          .filter(entry => new URL(entry.name).pathname.endsWith('.css'))
          .map(entry => ({ url: entry.name, bytes: entry.transferSize || entry.decodedBodySize || 0 }));
        const navigation = performance.getEntriesByType('navigation')[0];
        const longTasks = performance.getEntriesByType('longtask')
          .filter(entry => entry.duration > 50).length;

        return {
          dcl: navigation?.domContentLoadedEventEnd || 0,
          load: navigation?.loadEventEnd || 0,
          jsBytes: scripts.reduce((sum, item) => sum + item.bytes, 0),
          cssBytes: styles.reduce((sum, item) => sum + item.bytes, 0),
          largestJs: Math.max(0, ...scripts.map(item => item.bytes)),
          largestCss: Math.max(0, ...styles.map(item => item.bytes)),
          longTasks,
        };
      });

      const kb = bytes => (bytes / 1024).toFixed(1) + 'KB';
      rows.push({
        route: route.name,
        status: response?.status() || 0,
        dcl: Math.round(metrics.dcl),
        load: Math.round(metrics.load),
        js: kb(metrics.jsBytes),
        css: kb(metrics.cssBytes),
        maxJs: kb(metrics.largestJs),
        maxCss: kb(metrics.largestCss),
        long: metrics.longTasks,
      });

      if (response?.status() !== 200) failures.push(route.name + ': HTTP ' + (response?.status() || 0));
      if (metrics.dcl > BUDGET.domContentLoadedMs) failures.push(route.name + ': DOMContentLoaded ' + Math.round(metrics.dcl) + 'ms > ' + BUDGET.domContentLoadedMs + 'ms');
      if (metrics.load > BUDGET.loadMs) failures.push(route.name + ': load ' + Math.round(metrics.load) + 'ms > ' + BUDGET.loadMs + 'ms');
      if (metrics.jsBytes > BUDGET.totalJsBytes) failures.push(route.name + ': JS ' + kb(metrics.jsBytes) + ' > ' + kb(BUDGET.totalJsBytes));
      if (metrics.cssBytes > BUDGET.totalCssBytes) failures.push(route.name + ': CSS ' + kb(metrics.cssBytes) + ' > ' + kb(BUDGET.totalCssBytes));
      if (metrics.largestJs > BUDGET.largestJsBytes) failures.push(route.name + ': largest JS ' + kb(metrics.largestJs) + ' > ' + kb(BUDGET.largestJsBytes));
      if (metrics.largestCss > BUDGET.largestCssBytes) failures.push(route.name + ': largest CSS ' + kb(metrics.largestCss) + ' > ' + kb(BUDGET.largestCssBytes));
      if (metrics.longTasks > BUDGET.longTasksOver50ms) failures.push(route.name + ': ' + metrics.longTasks + ' long tasks > 50ms');
      if (pageErrors.length) failures.push(route.name + ': uncaught JS error — ' + pageErrors[0]);

      await page.close();
    }

    await context.close();
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }

  console.log('route       status dcl(ms) load(ms) JS      CSS     maxJS   maxCSS  long');
  for (const row of rows) {
    console.log(
      row.route.padEnd(10) + ' ' + String(row.status).padEnd(6) + ' ' +
      String(row.dcl).padEnd(7) + ' ' + String(row.load).padEnd(8) + ' ' +
      row.js.padEnd(8) + ' ' + row.css.padEnd(8) + ' ' +
      row.maxJs.padEnd(8) + ' ' + row.maxCss.padEnd(8) + ' ' + row.long
    );
  }

  if (failures.length) {
    console.error('\nWEBSITE PERFORMANCE FAILURES (' + failures.length + '):');
    for (const failure of failures) console.error(' - ' + failure);
    process.exitCode = 1;
    return;
  }

  console.log('\nWebsite performance gate passed.');
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
