'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../../..');

test('API pins only the OpenTelemetry plugins it uses', () => {
  const api = JSON.parse(fs.readFileSync(path.join(ROOT, 'services/api/package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const sbom = JSON.parse(fs.readFileSync(path.join(ROOT, 'SBOM.cdx.json'), 'utf8'));
  const deps = api.dependencies;
  assert.equal(deps['@opentelemetry/auto-instrumentations-node'], undefined);
  assert.equal(deps['@opentelemetry/instrumentation-http'], '0.223.0');
  assert.equal(deps['@opentelemetry/instrumentation-pg'], '0.75.0');
  assert.equal(deps['@opentelemetry/sdk-node'], '0.223.0');
  const plugins = Object.keys(lock.packages)
    .filter((name) => name.startsWith('node_modules/@opentelemetry/instrumentation-'))
    .sort();
  assert.deepEqual(plugins, [
    'node_modules/@opentelemetry/instrumentation-http',
    'node_modules/@opentelemetry/instrumentation-pg'
  ]);
  const sbomPlugins = sbom.components
    .filter((component) => component.group === '@opentelemetry' && component.name.startsWith('instrumentation-'))
    .map((component) => `${component.group}/${component.name}`)
    .sort();
  assert.deepEqual(sbomPlugins, ['@opentelemetry/instrumentation-http', '@opentelemetry/instrumentation-pg']);
  assert.ok(sbom.components.some((component) => component.name === 'redis'));
});

test('CycloneDX SBOM identity matches the shipped package and lockfile', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const dbPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'packages/db/package.json'), 'utf8'));
  const sbom = JSON.parse(fs.readFileSync(path.join(ROOT, 'SBOM.cdx.json'), 'utf8'));

  assert.equal(dbPackage.dependencies.pg, lock.packages['node_modules/pg'].version, 'packages/db pg pin must match the lockfile');

  assert.equal(lock.name, pkg.name);
  assert.equal(lock.version, pkg.version);

  const component = sbom.metadata && sbom.metadata.component;
  assert.ok(component);
  assert.equal(typeof component.name, 'string');
  assert.ok(component.name.length > 0);
  assert.equal(component.version, pkg.version);
  assert.equal(component['bom-ref'], pkg.name + '@' + pkg.version);
  assert.equal(component.purl, 'pkg:npm/' + pkg.name + '@' + pkg.version);
});

test('CycloneDX npm components match the locked package artifacts', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));
  const sbom = JSON.parse(fs.readFileSync(path.join(ROOT, 'SBOM.cdx.json'), 'utf8'));
  const components = sbom.components || [];
  const packagePaths = components
    .map((component) => (component.properties || []).find((property) => property.name === 'cdx:npm:package:path'))
    .filter(Boolean)
    .map((property) => property.value);
  assert.equal(new Set(packagePaths).size, packagePaths.length, 'SBOM must not contain duplicate npm package paths');
  const bomRefs = components.map((component) => component['bom-ref']).filter(Boolean);
  assert.equal(new Set(bomRefs).size, bomRefs.length, 'SBOM must not contain duplicate component bom-ref values');

  for (const component of components) {
    const pathProperty = (component.properties || []).find((property) => property.name === 'cdx:npm:package:path');
    const packagePath = pathProperty && pathProperty.value;
    if (!packagePath) continue;
    const lockPath = packagePath.startsWith('node_modules/') ? packagePath : `node_modules/${packagePath}`;
    const locked = lock.packages[lockPath];
    assert.ok(locked, `SBOM component path is absent from package-lock.json: ${lockPath}`);
    if (locked.link === true) continue;

    assert.equal(component.version, locked.version, `SBOM version drift for ${lockPath}`);
    const distribution = (component.externalReferences || []).find((reference) => reference.type === 'distribution');
    if (locked.resolved) assert.equal(distribution && distribution.url, locked.resolved, `SBOM tarball URL drift for ${lockPath}`);
    if (locked.integrity) {
      const sha512 = locked.integrity.split(/\s+/).find((value) => value.startsWith('sha512-'));
      if (sha512) {
        const expected = Buffer.from(sha512.slice('sha512-'.length), 'base64').toString('hex');
        assert.ok(
          (distribution && distribution.hashes || []).some((hash) => hash.alg === 'SHA-512' && hash.content === expected),
          `SBOM SHA-512 integrity drift for ${lockPath}`
        );
      }
    }
  }

  assert.ok(!components.some((component) => component.name === 'cluster-key-slot'), 'SBOM must not retain a package removed from the current lockfile');
  for (const dependency of sbom.dependencies || []) {
    assert.ok(!dependency.ref.includes('cluster-key-slot'), 'SBOM dependency root must not retain cluster-key-slot');
    assert.ok(!(dependency.dependsOn || []).some((reference) => reference.includes('cluster-key-slot')), 'SBOM dependency graph must not reference cluster-key-slot');
  }
});

