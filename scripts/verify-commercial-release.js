#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const failures = [];
const notes = [];

function read(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    failures.push('MISSING:' + rel);
    return '';
  }
  return fs.readFileSync(file, 'utf8');
}

function assert(condition, message) {
  if (!condition) failures.push(message);
}

const manifest = JSON.parse(read('SALES_PACKAGE_MANIFEST.json'));
const envExample = read('.env.example');
assert(/PRODUCTION_HOLD=true/.test(envExample), '.env.example must keep PRODUCTION_HOLD=true');
assert(/FIBEROS_PRODUCTION_VERIFIED=false/.test(envExample), '.env.example must keep FIBEROS_PRODUCTION_VERIFIED=false');
const credentialPatterns = [
  /github_pat_[A-Za-z0-9_\-]+/i,
  /\bghp_[A-Za-z0-9_]+\b/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/
];
for (const re of credentialPatterns) assert(!re.test(envExample), 'credential-like material detected in .env.example: ' + re);
assert(!/postgres:\/\/[^:]+:(?!REPLACE_ME@)[^@]+@/i.test(envExample), 'non-placeholder database credential detected in .env.example');

const hold = read('packages/core/src/productionHold.js');
assert(/PRODUCTION_HOLD/.test(hold) && /!== 'false'/.test(hold), 'productionHold must default fail-closed');
assert(/FIBEROS_PRODUCTION_VERIFIED/.test(hold), 'productionHold must require explicit verification flag');
assert(/evidenceMode !== 'live'/.test(hold), 'productionHold must reject non-live attestation evidence');
assert(/PRODUCTION_ATTESTATION_STALE/.test(hold), 'productionHold must reject stale attestations');

assert((hold.match(/'[^']+'/g) || []).some(x => x.includes('databaseConnectivity')), 'productionHold required checks missing');
for (const check of ['databaseConnectivity','rlsTenantIsolation','identityOidcJwks','tlsIngress','secretsBoundary','backupRestore','rateLimitBoundary','externalAdapters']) {
  assert(hold.includes(`'${check}'`), 'productionHold missing required check: ' + check);
}

const middleware = read('services/api/src/authorizationMiddleware.js');
assert(/permissionsForRole/.test(middleware), 'canonical authorization policy is not imported by HTTP middleware');
assert(/APPLICATION_ROLE_NOT_AUTHORIZED/.test(middleware), 'HTTP middleware must fail closed on unknown roles');
const hardening = read('packages/security/src/httpHardening.js');
assert(/PROCESS_LOCAL_RATE_LIMIT_UNSAFE_FOR_MULTI_INSTANCE/.test(hardening), 'rate limiter must fail closed for unsafe production multi-instance configuration');
assert(/RATE_LIMIT_BACKEND_UNSUPPORTED/.test(hardening), 'rate limiter must reject unknown backends');

const server = read('services/api/src/server.js');
assert(server.includes("require('./authorizationMiddleware')"), 'API server must import authorizationMiddleware');
assert(server.includes('authorizeHttpRequest'), 'API server must execute authorizationMiddleware');

const migrations = fs.readdirSync(path.join(ROOT, 'sql/migrations'))
  .filter(f => /^\d{3}_.+\.sql$/.test(f) && f !== '000_local_auth_stubs.sql')
  .sort();
const list = read('sql/migrations/PRODUCTION_MIGRATIONS.txt').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
assert(migrations.length >= 128, 'expected production migration chain tip >= 128, found ' + migrations.length);
const migrationTipNum = Number(String(migrations[migrations.length-1]||'').slice(0,3));
assert(Number.isFinite(migrationTipNum) && migrationTipNum === migrations.length, 'migration list length must match tip number');

assert(list.length === migrations.length && list.every((x, i) => x === migrations[i]), 'PRODUCTION_MIGRATIONS.txt drifted from migration files');
const requiredMigrationSequence = [
  '121_tenant_containment_closure.sql',
  '122_sync_ingest_execute_privilege_closure.sql',
  '123_future_function_execute_closure.sql',
  '124_ftth_audit_tenant_rls_semantics.sql',
  '125_installation_command_workflows.sql',
  '126_installation_evidence_integrity_and_acceptance.sql',
  '127_installation_lifecycle_db_authority.sql',
  '128_public_tracking_rls_bridge.sql'
];
const sequenceStart = migrations.indexOf(requiredMigrationSequence[0]);
const migrationSequenceAligned =
  sequenceStart >= 0 &&
  migrations.slice(sequenceStart, sequenceStart + requiredMigrationSequence.length).every((name, i) => name === requiredMigrationSequence[i]);
assert(
  migrationSequenceAligned,
  'required migration sequence 121-128 is missing or out of order: ' + migrations.slice(Math.max(0, sequenceStart), sequenceStart + requiredMigrationSequence.length).join(', ')
);

const legacyChecksumText = read('sql/migrations/PRODUCTION_MIGRATIONS.sha256');
const extensionChecksumText = read('sql/migrations/PRODUCTION_MIGRATIONS.extra.sha256');
for (const f of migrations) {
  const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'sql/migrations', f))).digest('hex');
  const text = Number(f.slice(0, 3)) <= 116 ? legacyChecksumText : extensionChecksumText;
  const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rx = new RegExp('^' + actual + '\\s+' + escaped + '$', 'm');
  assert(rx.test(text), 'migration checksum mismatch or missing: ' + f);
}

const docs = ['README.md','BUYER_QUICKSTART.md','docs/commercial/SELLER_README.md','SECURITY.md','deploy/README.md','docs/runbooks/SOURCE_PROVENANCE.md','docs/runbooks/BUYER_GO_LIVE_ACCEPTANCE.md','docs/runbooks/PRODUCTION_DEPLOYMENT_CHECKLIST.md','docs/commercial/SALES_RELEASE_NOTES.md','docs/commercial/RESELLER_COMMERCIAL_PACKAGE.md','docs/commercial/SALES_AGREEMENT_TEMPLATE.md','docs/commercial/COMMERCIAL_PACKAGE_NOTICE.txt','docs/commercial/COMMERCIAL_DELIVERY_CHECKLIST.md','docs/commercial/COMMERCIAL_RELEASE_STATUS.md','docs/commercial/COMMERCIAL_RELEASE_RECEIPT.md','docs/commercial/ENGINEERING_TECHNICAL_SPECIFICATION.md'];
const currentMigration = migrations.at(-1).slice(0, 3);
const migrationRangePattern = /001[\u2013-](\d{3})/g;
for (const rel of docs) {
 const d = read(rel);
 for (const line of d.split(/\r?\n/)) {
  migrationRangePattern.lastIndex = 0;
  for (const m of line.matchAll(migrationRangePattern)) {
   const n = m[1] === '187' && /COMMERCIAL_RELEASE_(?:STATUS|RECEIPT)\.md$/.test(rel) && /Neon production|observed Neon production ledger/i.test(line);
   assert(m[1] === currentMigration || n, 'stale migration range claim in ' + rel + ': ' + m[1]);
  }
 }
 assert(!/USD 800\b|USD 9,500\b/.test(d), 'stale commercial price in ' + rel);
 assert(!/\b(?:three|3) months?\b|1\.0\.0-alpha\./i.test(d), 'stale commercial term in ' + rel);
}

for (const rel of ['docs/commercial/RESELLER_COMMERCIAL_PACKAGE.md','docs/runbooks/SUPPORT_POLICY.md','docs/commercial/WHITE_LABELING_GUIDE.md','docs/commercial/FIVE_MINUTE_BUYER_DEMO_SCRIPT.md','docs/commercial/COMMERCIAL_DELIVERY_CHECKLIST.md','docs/commercial/COMMERCIAL_RELEASE_STATUS.md','docs/commercial/COMMERCIAL_LICENSE_NOTICE.md']) {
  assert(fs.existsSync(path.join(ROOT, rel)), 'commercial delivery document missing: ' + rel);
}
const fieldWeb = read('apps/field-web/public/index.html');
const fieldClient = read('apps/field-web/public/field.js');
const opsWeb = read('apps/ops-web/public/enterprise-command.html');
const opsClient = read('apps/ops-web/public/enterprise-command.js');
const opsPolicy = read('apps/ops-web/public/api-origin.js');
const opsSessionAuth = read('apps/ops-web/public/session-auth.js');
assert(fieldWeb.length > 0, 'field web entrypoint missing');
assert(opsWeb.length > 0, 'operations web entrypoint missing');
assert(/Authorization/.test(fieldClient) && /Bearer/.test(fieldClient) && /resolveApiUrl/.test(fieldClient), 'field web client must preserve its validated bearer authorization boundary');
assert(/enterprise-command\.js/.test(opsWeb), 'operations web entrypoint must load its external application client');
assert(/FiberOSSessionAuth\.getCsrfToken/.test(opsClient) && /credentials:\s*'include'/.test(opsClient) && /X-FiberOS-CSRF/.test(opsClient) && /FiberOSApiOrigin\.resolveApiUrl/.test(opsClient) && !/Authorization/.test(opsClient) && /API_ORIGIN_NOT_ALLOWED/.test(opsPolicy) && /\/auth\/oidc\/session/.test(opsSessionAuth) && /credentials:\s*'include'/.test(opsSessionAuth) && /getCsrfToken/.test(opsSessionAuth), 'operations web client must preserve its validated OIDC-session, CSRF, and API-origin security boundary');
assert(!/703 files|103\/103|migrations 101–107|migrations 090–107|migrations 009–108|USD 800/.test(fieldWeb + opsWeb), 'web surfaces contain stale release claims');



const finalVerificationStatus = read('FINAL_VERIFICATION_STATUS.md');
const currentTestMatch = finalVerificationStatus.match(/executed \*\*(\d+) tests: (\d+) passed, (\d+) failed, (\d+) skipped\*\*/);
assert(currentTestMatch, 'FINAL_VERIFICATION_STATUS.md must contain a current test evidence summary');
if (currentTestMatch) {
  const currentTestSummary = `${currentTestMatch[1]} tests: ${currentTestMatch[2]} passed, ${currentTestMatch[3]} failed, ${currentTestMatch[4]} skipped`;
  const manifestTestEvidence = manifest && manifest.truthBoundary && manifest.truthBoundary.tests;
  assert(
    typeof manifestTestEvidence === 'string' && manifestTestEvidence.includes(currentTestSummary),
    'SALES_PACKAGE_MANIFEST.json test evidence drifted from FINAL_VERIFICATION_STATUS.md'
  );
  const receipt = read('docs/commercial/COMMERCIAL_RELEASE_RECEIPT.md');
  assert(
    receipt.includes(currentTestSummary),
    'COMMERCIAL_RELEASE_RECEIPT.md test evidence drifted from FINAL_VERIFICATION_STATUS.md'
  );
}

const commercialContract = JSON.parse(read('config/commercial-release-contract.v1.json'));
const pkgForContract = JSON.parse(read('package.json'));
assert(commercialContract.releaseVersion === pkgForContract.version, 'commercial release contract version drift');
assert(commercialContract.releaseStatus === 'COMMERCIAL_RELEASE_CANDIDATE', 'unexpected commercial release status');
assert(commercialContract.referenceListPriceUSD === 3500, 'unexpected commercial reference list price');
assert(commercialContract.onlineSalePriceUSD === 3000, 'unexpected current online sale price');
assert(commercialContract.campaignDiscountUSD === 500, 'unexpected campaign discount');
assert(commercialContract.supportDays === 14, 'unexpected commercial support term');
const expectedRange = '001-' + String(migrations.length).padStart(3,'0');
assert(commercialContract.migrationRange === expectedRange, 'commercial release contract migration range drift: expected ' + expectedRange + ' got ' + commercialContract.migrationRange);

const canonicalRegistry = JSON.parse(read('config/html-feature-parity.json'));
const expectedCapabilityCounts = Object.fromEntries(Object.keys(canonicalRegistry.statusDefinitions || {}).map(status => [status, 0]));
for (const capability of canonicalRegistry.capabilities || []) expectedCapabilityCounts[capability.status] = Number(expectedCapabilityCounts[capability.status] || 0) + 1;
assert(commercialContract.featureRegistry.total === canonicalRegistry.capabilities.length, 'commercial feature registry total drifted from canonical registry');
for (const [status, count] of Object.entries(expectedCapabilityCounts)) {
  assert(commercialContract.featureRegistry.statusCounts[status] === count, 'commercial feature status count drifted for ' + status + ': expected ' + count + ' got ' + commercialContract.featureRegistry.statusCounts[status]);
}
const localeManifest = JSON.parse(read('i18n/manifest-114.generated.json'));
const officialSalesPack = JSON.parse(read('i18n/official-84.json'));
const fullLocaleCounts = {};
for (const locale of localeManifest.locales || []) fullLocaleCounts[locale.status] = Number(fullLocaleCounts[locale.status] || 0) + 1;
const subsetCounts = {};
for (const locale of officialSalesPack.locales || []) subsetCounts[locale.catalogStatus] = Number(subsetCounts[locale.catalogStatus] || 0) + 1;
assert(commercialContract.languageScope.includedCatalogs === officialSalesPack.includedLocaleCount, 'commercial locale subset count drifted from official-84');
assert(commercialContract.languageScope.existingManifestVerifiedStatus === Number(subsetCounts.verified || 0), 'commercial verified-locale count drifted from official-84');
assert(commercialContract.languageScope.machineDraftCatalogs === Number(subsetCounts['machine-draft'] || 0), 'commercial machine-draft count drifted from official-84');
assert(commercialContract.languageScope.excludedFromSalesSubsetCatalogs === Number(officialSalesPack.exclusions.count || 0), 'commercial excluded-from-subset count drifted from official-84');
assert(commercialContract.languageScope.excludedUntranslatedCatalogs === Number(fullLocaleCounts.untranslated || 0), 'commercial untranslated count drifted from full locale manifest');
assert(commercialContract.languageScope.humanCertifiedCatalogs === Number(localeManifest.officialAdoption.humanCertifiedLocaleCount || 0), 'commercial human-certification count drifted from locale manifest');
assert(commercialContract.languageScope.fullPackStatusTally && typeof commercialContract.languageScope.fullPackStatusTally === 'object', 'commercial contract must disclose the complete 114-catalog status tally');
for (const status of ['verified', 'machine-draft', 'untranslated']) {
  assert(commercialContract.languageScope.fullPackStatusTally[status] === Number(fullLocaleCounts[status] || 0), 'commercial full locale status tally drifted for ' + status);
}

assert(/Commercial Release Candidate/i.test(read('docs/commercial/COMMERCIAL_RELEASE_STATUS.md')), 'commercial release status missing candidate status');
assert(/buyer.*production|production.*buyer/i.test(read('docs/commercial/COMMERCIAL_RELEASE_STATUS.md')), 'commercial release status must preserve buyer-production boundary');

const pkg = JSON.parse(read('package.json'));
pkg.scripts = pkg.scripts || {};
assert(pkg.scripts['verify:commercial'] === 'node scripts/verify-commercial-release.js', 'package.json verify:commercial script missing');
assert(/PostgreSQL 18\.6\+/.test(read('BUYER_QUICKSTART.md')), 'buyer quickstart must disclose PostgreSQL 18.6+');
assert(/PostGIS 3\.6\.x/.test(read('BUYER_QUICKSTART.md')), 'buyer quickstart must disclose PostGIS 3.6.x');

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures, notes }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, checks: {
    envTemplateSafe: true,
    productionHoldFailClosed: true,
    authorizationMiddlewareActive: true,
    migrationChain: '001-' + migrations.at(-1).slice(0, 3),
    commercialDocs: docs.length,
    webSurfacesAuthorizationBoundary: true,
    canonicalVerifyIncludesCommercialGate: pkg.scripts.verify.includes('npm run verify:commercial')
  }}, null, 2));
}
                                                                  