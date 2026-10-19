#!/usr/bin/env node
'use strict';
/* Independent verification of the committed delivery-evidence bundle. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const CHECKSUM_REL = 'docs/PACKAGE_CONTENTS_SHA256SUMS.txt';
const MANIFEST_REL = 'SALES_PACKAGE_MANIFEST.json';
const SBOM_REL = 'SBOM.cdx.json';
const EXPECTED_DELIVERABLES = Object.freeze([
  'LICENSE','SECURITY.md','BUYER_QUICKSTART.md','SBOM.cdx.json','ARCHITECTURE_MAP.json',
  'SALES_PACKAGE_MANIFEST.schema.json','config/commercial-release-contract.v1.json',
  'docs/commercial/COMMERCIAL_RELEASE_STATUS.md','docs/commercial/COMMERCIAL_RELEASE_RECEIPT.md',
  'docs/commercial/ONLINE_COMMERCIAL_LICENSE.md','docs/commercial/SALES_AGREEMENT_TEMPLATE.md',
  'docs/commercial/ENGINEERING_TECHNICAL_SPECIFICATION.md','i18n/manifest.json','i18n/source.json'
]);
function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }
function safeRelativePath(rel) {
  return typeof rel === 'string' && rel.length > 0 && !path.isAbsolute(rel) &&
    !/^[A-Za-z]:/.test(rel) && !rel.includes('\\') && !rel.includes('\0') &&
    !rel.split('/').some(p => p === '' || p === '.' || p === '..');
}
/* Reject symlinks in every path segment, not just the leaf file. */
function regularFile(rootReal, rel) {
  if (!safeRelativePath(rel)) throw new Error('EVIDENCE_PATH_UNSAFE:' + rel);
  let current = rootReal;
  const parts = rel.split('/');
  for (let i=0;i<parts.length;i+=1) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (e) {
      if (e && e.code === 'ENOENT') throw new Error('EVIDENCE_FILE_MISSING:' + rel);
      throw new Error('EVIDENCE_PATH_UNAVAILABLE:' + rel);
    }
    if (stat.isSymbolicLink()) throw new Error('EVIDENCE_PATH_SYMLINK:' + rel);
    const leaf = i === parts.length - 1;
    if (!leaf && !stat.isDirectory()) throw new Error('EVIDENCE_PARENT_NOT_DIRECTORY:' + rel);
    if (leaf && !stat.isFile()) throw new Error('EVIDENCE_FILE_NOT_REGULAR:' + rel);
  }
  const resolved = fs.realpathSync(current);
  const relative = path.relative(rootReal, resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw new Error('EVIDENCE_PATH_ESCAPES_ROOT:' + rel);
  }
  return resolved;
}
function parseChecksumFile(text) {
  const entries=[], seen=new Set();
  for (const raw of String(text).split(/\r?\n/)) {
    const line=raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m=line.match(/^([a-f0-9]{64})\s{2}(.+)$/i);
    if (!m) throw new Error('CHECKSUM_LINE_INVALID');
    const digest=m[1].toLowerCase(), rel=m[2].trim();
    if (!safeRelativePath(rel)) throw new Error('CHECKSUM_PATH_UNSAFE:' + rel);
    if (rel===MANIFEST_REL || rel===CHECKSUM_REL) throw new Error('CHECKSUM_SELF_REFERENCE_FORBIDDEN:' + rel);
    if (seen.has(rel)) throw new Error('CHECKSUM_PATH_DUPLICATE:' + rel);
    seen.add(rel); entries.push({digest,rel});
  }
  if (!entries.length) throw new Error('CHECKSUM_FILE_EMPTY');
  return entries;
}
function compareDeliverableSet(entries) {
  const expected=EXPECTED_DELIVERABLES.slice().sort(), actual=entries.map(e=>e.rel).sort();
  if (JSON.stringify(actual)!==JSON.stringify(expected)) throw new Error('CHECKSUM_DELIVERABLE_SET_MISMATCH');
}
function verifyBundle(options={}) {
  const root=path.resolve(options.root||ROOT);
  let rootReal;
  try { rootReal=fs.realpathSync(root); } catch (_) { throw new Error('EVIDENCE_ROOT_UNAVAILABLE'); }
  const read=rel=>fs.readFileSync(regularFile(rootReal,rel));
  let entries,manifest,sbom,packageJson;
  try {
    entries=parseChecksumFile(read(CHECKSUM_REL).toString('utf8'));
    manifest=JSON.parse(read(MANIFEST_REL).toString('utf8'));
    sbom=JSON.parse(read(SBOM_REL).toString('utf8'));
    packageJson=JSON.parse(read('package.json').toString('utf8'));
  } catch(error) { throw new Error('EVIDENCE_BUNDLE_INVALID:'+(error.code||error.message)); }
  compareDeliverableSet(entries);
  if (!manifest || !Number.isSafeInteger(manifest.fileCount) || manifest.fileCount<1 ||
      !Number.isSafeInteger(manifest.bytes) || manifest.bytes<0) throw new Error('MANIFEST_COUNTERS_INVALID');
  if (sbom.bomFormat!=='CycloneDX'||String(sbom.specVersion)!=='1.6') throw new Error('SBOM_FORMAT_INVALID');
  const component=sbom.metadata&&sbom.metadata.component;
  if (!component||component.name!==packageJson.name||component.version!==packageJson.version) throw new Error('SBOM_PACKAGE_IDENTITY_MISMATCH');
  if (!Array.isArray(sbom.components)||sbom.components.length===0) throw new Error('SBOM_COMPONENTS_MISSING');
  const hashes=manifest.sha256ByFile;
  if (!hashes||typeof hashes!=='object'||Array.isArray(hashes)||hashes[MANIFEST_REL]!=='SELF_REFERENTIAL_NOT_HASHED') throw new Error('MANIFEST_SELF_HASH_POLICY_INVALID');
  for (const entry of entries) {
    if (sha256(read(entry.rel))!==entry.digest) throw new Error('EVIDENCE_SHA256_MISMATCH:'+entry.rel);
    if (hashes[entry.rel]!==entry.digest) throw new Error('MANIFEST_EVIDENCE_HASH_MISMATCH:'+entry.rel);
  }
  return Object.freeze({ok:true,checkedEntries:entries.length,sbomComponents:sbom.components.length,packageVersion:packageJson.version,manifestFileCount:manifest.fileCount,manifestBytes:manifest.bytes});
}
if (require.main===module) {
  try { console.log('Evidence bundle integrity passed:',JSON.stringify(verifyBundle())); }
  catch(error) { console.error('Evidence bundle integrity FAILED:',error&&error.message?error.message:String(error));process.exitCode=1; }
}
module.exports={ROOT,CHECKSUM_REL,MANIFEST_REL,SBOM_REL,EXPECTED_DELIVERABLES,safeRelativePath,parseChecksumFile,verifyBundle};
