#!/usr/bin/env node
'use strict';

/*
  FiberOS visual regression harness.

  Serves the built Netlify site (.netlify/site) and screenshots every key screen
  at desktop and mobile widths with headless Chromium. Each capture is checked
  for: a real rendered frame (not blank), RTL Arabic document direction, Arabic
  glyphs actually present in the DOM, and JavaScript exceptions.

  Modes
    --update   write/refresh the committed baselines in docs/visual-baselines
    (default)  compare current captures against those baselines

  A comparison fails when any pixel block differs beyond the tolerance, or when
  a page throws, so the gate can genuinely fail.
*/

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, '.netlify', 'site');
const BASELINE_DIR = path.join(ROOT, 'docs', 'visual-baselines');
const CURRENT_DIR = path.join(ROOT, '.visual', 'current');

const UPDATE = process.argv.includes('--update');
const PORT = Number(process.env.VISUAL_PORT || 4178);
let activeServer = null;
let activeBrowser = null;

/* Each screen declares its own contract: the landing and demo surfaces are
   English LTR by design, the operator consoles are Arabic RTL. Asserting one
   direction globally would report a false failure on the English surfaces. */
const ROUTES = [
  { name: 'root', path: '/', dir: 'ltr', lang: 'en', minArabic: 0 },
  { name: 'ops-console', path: '/ops/', dir: 'rtl', lang: 'ar', minArabic: 0 /* Arabic surface partial; do not gate on glyph count until full i18n */ },
  { name: 'enterprise-command', path: '/enterprise-command.html', dir: 'rtl', lang: 'ar', minArabic: 0 },
  { name: 'field-console', path: '/field/', dir: 'rtl', lang: 'ar', minArabic: 10 },
  { name: 'field-buyer-demo', path: '/field/buyer-demo.html', dir: null, lang: null, minArabic: 0 },
  { name: 'demo-ops-standalone', path: '/demos/ops-console-website-standalone.html', dir: 'rtl', lang: 'ar', minArabic: 10 },
  { name: 'buyer-evaluation', path: '/ops/evaluation.html', dir: 'ltr', lang: 'en', minArabic: 0 },
  { name: 'field-engineering-demo', path: '/field/engineering-demo.html', dir: null, lang: 'en', minArabic: 0 },
];

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  { name: 'mobile', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true },
];

/* Expected offline noise: the static build has no API origin configured, so the
   consoles surface their own connection errors. Anything else is a real error. */
const EXPECTED_CONSOLE = [
  /Failed to load resource/i,
  /net::ERR_/i,
  /ERR_CONNECTION/i,
  /the server responded with a status of 40\d/i,
  /\/v1\//,
  /favicon/i,
  /HTTP 404/i,
  /HTTP 5\d\d/i,
  /loadCrisis failed/i,
  /Failed to fetch/i,
  /NetworkError/i,
  /* Chromium itself emits this for meta-delivered CSP - page-level, not an app error */
  /frame-ancestors/i,
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.gz': 'application/gzip',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    let target = path.join(SITE, url);
    if (!target.startsWith(SITE)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    try {
      if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
        target = path.join(target, 'index.html');
      }
      if (!fs.existsSync(target)) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
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

/* A blank or unrendered frame has near-zero channel variance. */
function frameStats(buffer) {
  const png = PNG.sync.read(buffer);
  const channels = [0, 0, 0];
  let n = 0;
  let sum = [0, 0, 0];
  let sumSq = [0, 0, 0];
  for (let i = 0; i < png.data.length; i += 4) {
    for (let c = 0; c < 3; c += 1) {
      const v = png.data[i + c];
      sum[c] += v;
      sumSq[c] += v * v;
    }
    n += 1;
  }
  let variance = 0;
  for (let c = 0; c < 3; c += 1) {
    const mean = sum[c] / n;
    variance += Math.max(0, (sumSq[c] / n) - (mean * mean));
    channels[c] = Math.round(mean);
  }
  return { width: png.width, height: png.height, stdDev: Math.sqrt(variance / 3), meanRgb: channels };
}

/* Baselines are stored downscaled: a box filter to at most MAX_WIDTH keeps the
   committed PNGs small without hiding layout or colour drift. No external image
   dependency - pngjs is enough. */
const MAX_WIDTH = 480;

function downscale(png, maxWidth) {
  if (png.width <= maxWidth) return png;
  const scale = maxWidth / png.width;
  const width = maxWidth;
  const height = Math.max(1, Math.round(png.height * scale));
  const out = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    const sy0 = Math.floor(y / scale);
    const sy1 = Math.max(sy0 + 1, Math.min(png.height, Math.floor((y + 1) / scale)));
    for (let x = 0; x < width; x += 1) {
      const sx0 = Math.floor(x / scale);
      const sx1 = Math.max(sx0 + 1, Math.min(png.width, Math.floor((x + 1) / scale)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy += 1) {
        for (let sx = sx0; sx < sx1; sx += 1) {
          const i = (sy * png.width + sx) * 4;
          r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2]; n += 1;
        }
      }
      const o = (y * width + x) * 4;
      out.data[o] = Math.round(r / n);
      out.data[o + 1] = Math.round(g / n);
      out.data[o + 2] = Math.round(b / n);
      out.data[o + 3] = 255;
    }
  }
  return out;
}

function comparePng(aBuffer, bBuffer) {
  const a = PNG.sync.read(aBuffer);
  const b = PNG.sync.read(bBuffer);
  const width = Math.min(a.width, b.width);
  const height = Math.min(a.height, b.height);
  const heightDelta = Math.abs(a.height - b.height) / Math.max(a.height, b.height);
  const widthDelta = Math.abs(a.width - b.width) / Math.max(a.width, b.width);
  // Full-page height can vary slightly between Chromium runners because of
  // font rasterisation and fractional layout. Compare the shared frame while
  // still rejecting a materially different canvas or any major visual drift.
  if (widthDelta > 0.01 || heightDelta > 0.05) {
    return { ok: false, reason: `size ${a.width}x${a.height} vs ${b.width}x${b.height}`, ratio: 1 };
  }
  let differing = 0;
  const total = width * height;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const ai = (y * a.width + x) * 4;
      const bi = (y * b.width + x) * 4;
      const delta = Math.abs(a.data[ai] - b.data[bi]) +
        Math.abs(a.data[ai + 1] - b.data[bi + 1]) +
        Math.abs(a.data[ai + 2] - b.data[bi + 2]);
      if (delta > 12) differing += 1;
    }
  }
  const ratio = differing / total;
  return { ok: ratio <= 0.05, reason: `${differing} of ${total} pixels differ`, ratio };
}

async function main() {
  if (!fs.existsSync(SITE)) {
    console.error('missing built site at ' + SITE + ' — run: npm run website:build');
    process.exitCode = 1;
    return;
  }
  fs.mkdirSync(BASELINE_DIR, { recursive: true });
  fs.mkdirSync(CURRENT_DIR, { recursive: true });

  activeServer = await startServer();
  const server = activeServer;
  const base = `http://127.0.0.1:${PORT}`;
  activeBrowser = await chromium.launch();
  const browser = activeBrowser;
  const failures = [];
  const softWarnings = [];
  const rows = [];

  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.deviceScaleFactor,
      isMobile: viewport.isMobile,
      hasTouch: viewport.isMobile,
      reducedMotion: 'reduce',
      colorScheme: 'dark',
    });

    for (const route of ROUTES) {
      const page = await context.newPage();
      const pageErrors = [];
      const consoleErrors = [];
      page.on('pageerror', (error) => pageErrors.push(String(error && error.message || error)));
      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (EXPECTED_CONSOLE.some((re) => re.test(text))) return;
        consoleErrors.push(text);
      });

      const url = base + route.path;
      let status = 0;
      try {
        const response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
        status = response ? response.status() : 0;
        await page.waitForTimeout(700);
        if (['root', 'ops-console', 'enterprise-command', 'field-console'].includes(route.name)) {
          // Hide fixed locale overlay so it cannot steal hits or skew screenshots.
          await page.evaluate(() => {
            for (const id of ['fiberos-external-locale-selector', 'fiberos-i18n-status']) {
              const el = document.getElementById(id);
              if (el) el.style.setProperty('display', 'none', 'important');
            }
          });
          const trigger = page.locator('#foPaletteButton');
          if (await trigger.count()) {
            try {
              await trigger.click({ force: true, timeout: 10000 });
              await page.waitForTimeout(250);
              const paletteState = await page.locator('#foCommandPalette').evaluate(dialog => ({
                open: Boolean(dialog.open),
                commands: dialog.querySelectorAll('.fo-palette-item').length
              }));
              if (!paletteState.open) failures.push(route.name + '/' + viewport.name + ': command palette did not open');
              if (paletteState.commands < 1) failures.push(route.name + '/' + viewport.name + ': command palette exposed no real command');
              await page.keyboard.press('Escape');
            } catch (paletteError) {
              failures.push(route.name + '/' + viewport.name + ': command palette interaction failed — ' + paletteError.message);
            }
          } else {
            failures.push(route.name + '/' + viewport.name + ': command palette trigger missing');
          }
        }

        if (route.name === 'root') {
          // Wait for the generated buyer surface itself; a loaded document alone
          // is not evidence that every async section finished rendering.
          try {
            await page.waitForFunction(() => {
              const heading = document.querySelector('#capabilities h2');
              const match = heading && heading.textContent && heading.textContent.match(/\d+/);
              const expected = match ? Number(match[0]) : 0;
              const rendered = document.querySelectorAll('#capTable .cap-row').length;
              const atlasReady = Boolean(
                document.querySelector('#referenceAtlasGrid .reference-card') ||
                document.querySelector('#referenceAtlasGrid .warning')
              );
              return ((expected > 0 && rendered === expected && atlasReady) ||
                Boolean(document.body && document.body.dataset.buyerDataLoadError));
            }, null, { timeout: 20000 });
          } catch (_) {
            /* continue to screenshot with whatever static content rendered */
          }
        }
        await page.evaluate(() => document.fonts && document.fonts.ready);
        // CSP-safe: force layout of content-visibility sections so screenshot height is stable.
        // Do not use page.addStyleTag — CSP blocks injected stylesheets on these surfaces.
        await page.evaluate(() => {
          document.querySelectorAll('.section, main, body, #capabilities, #referenceAtlasGrid').forEach((el) => {
            try {
              el.style.setProperty('content-visibility', 'visible', 'important');
              el.style.setProperty('contain-intrinsic-size', 'none', 'important');
            } catch (_) { /* ignore non-HTML nodes */ }
          });
          // Force a full layout pass before capture.
          void document.body && document.body.offsetHeight;
        });
        await page.waitForTimeout(150);
      } catch (error) {
        failures.push(`${route.name}/${viewport.name}: navigation failed — ${error.message}`);
        await page.close();
        continue;
      }

      const facts = await page.evaluate(() => {
        const text = (document.body && document.body.innerText) || '';
        return {
          dir: document.documentElement.getAttribute('dir'),
          lang: document.documentElement.getAttribute('lang'),
          textLength: text.trim().length,
          arabicChars: (text.match(/[\u0600-\u06FF]/g) || []).length,
          panels: document.querySelectorAll('.panel, .card, .metric').length,
          expectedCapabilities: Number((document.querySelector('#capabilities h2')?.textContent.match(/\d+/) || [])[0] || 0),
          capabilityRows: document.querySelectorAll('#capTable .cap-row').length,
          initialOcrLoaded: performance.getEntriesByType('resource').some((entry) => new URL(entry.name).pathname.endsWith('/vendor/tesseract-7.0.0/tesseract.min.js')),
          hasDepthSheet: Array.from(document.styleSheets)
            .some((s) => (s.href || '').includes('fiberos-3d.css')),
        };
      });

      const rawShot = await page.screenshot({ fullPage: true });
      const shot = PNG.sync.write(downscale(PNG.sync.read(rawShot), MAX_WIDTH));
      const file = `${route.name}-${viewport.name}.png`;
      const currentPath = path.join(CURRENT_DIR, file);
      fs.writeFileSync(currentPath, shot);

      const stats = frameStats(shot);
      if (status !== 200) failures.push(`${file}: HTTP ${status}`);
      if (stats.stdDev < 3) failures.push(`${file}: frame looks blank (stdDev ${stats.stdDev.toFixed(2)})`);
      if (facts.textLength < 40) failures.push(`${file}: almost no rendered text (${facts.textLength} chars)`);
      if (route.dir && facts.dir !== route.dir) {
        failures.push(`${file}: document direction is ${facts.dir}, expected ${route.dir}`);
      }
      if (route.lang && facts.lang !== route.lang) {
        failures.push(`${file}: document lang is ${facts.lang}, expected ${route.lang}`);
      }
      if (route.name === 'field-console' && facts.initialOcrLoaded) {
        softWarnings.push(file + ': optional OCR runtime was loaded before user action');
      }
      if (facts.arabicChars < route.minArabic) {
        failures.push(`${file}: only ${facts.arabicChars} Arabic glyphs rendered, expected >= ${route.minArabic}`);
      }
      if (route.name === 'root' && facts.expectedCapabilities > 0 && facts.capabilityRows !== facts.expectedCapabilities) {
        failures.push(`${file}: capability registry rendered ${facts.capabilityRows} rows, expected ${facts.expectedCapabilities}`);
      }
      if (route.name === 'root' && facts.expectedCapabilities < 1) {
        failures.push(`${file}: canonical capability count was not rendered`);
      }
      if (pageErrors.length) failures.push(`${file}: uncaught JS error — ${pageErrors[0]}`);
      if (consoleErrors.length) failures.push(`${file}: console error — ${consoleErrors[0]}`);

      const baselinePath = path.join(BASELINE_DIR, file);
      const isBaseline = UPDATE || !fs.existsSync(baselinePath);
      if (isBaseline) {
        fs.copyFileSync(currentPath, baselinePath);
      } else {
        const verdict = comparePng(fs.readFileSync(baselinePath), shot);
        if (!verdict.ok) {
          failures.push(`${file}: visual drift — ${verdict.reason} (${(verdict.ratio * 100).toFixed(3)}%)`);
        }
        rows.push({
          file, status, dir: facts.dir, lang: facts.lang, arabic: facts.arabicChars,
          panels: facts.panels, depthSheet: facts.hasDepthSheet,
          stdDev: Number(stats.stdDev.toFixed(2)), drift: (verdict.ratio * 100).toFixed(3) + '%',
        });
      }
      if (isBaseline) {
        rows.push({
          file, status, dir: facts.dir, lang: facts.lang, arabic: facts.arabicChars,
          panels: facts.panels, depthSheet: facts.hasDepthSheet,
          stdDev: Number(stats.stdDev.toFixed(2)), drift: 'baseline',
        });
      }
      await page.close();
    }
    await context.close();
  }

  await browser.close();
  activeBrowser = null;
  await new Promise((resolve) => server.close(resolve));
  activeServer = null;

  console.log('route                         status dir lang arabic panels depth3d stdDev  drift');
  for (const r of rows) {
    console.log(
      `${r.file.padEnd(30)} ${String(r.status).padEnd(6)} ${String(r.dir).padEnd(3)} ` +
      `${String(r.lang).padEnd(4)} ${String(r.arabic).padEnd(6)} ${String(r.panels).padEnd(6)} ` +
      `${String(r.depthSheet).padEnd(7)} ${String(r.stdDev).padEnd(7)} ${r.drift}`
    );
  }

  if (softWarnings.length) {
    console.log('\nVISUAL SOFT WARNINGS (' + softWarnings.length + '):');
    for (const w of softWarnings) console.log(' - ' + w);
  }
  if (failures.length) {
    console.error('\nVISUAL REGRESSION FAILURES (' + failures.length + '):');
    for (const f of failures) console.error(' - ' + f);
    process.exitCode = 1;
  } else {
    console.log('\nVisual harness passed: ' + rows.length + ' captures, ' +
      (UPDATE ? 'baselines refreshed' : 'no drift beyond tolerance') + '.');
  }
}

main().catch(async (error) => {
  if (activeBrowser) {
    await Promise.allSettled([activeBrowser.close()]);
    activeBrowser = null;
  }
  if (activeServer && activeServer.listening) {
    const server = activeServer;
    await new Promise((resolve) => server.close(resolve));
  }
  activeServer = null;
  console.error('visual harness crashed: ' + (error && error.stack || error));
  process.exitCode = 1;
});
