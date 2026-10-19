#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const read=rel=>fs.readFileSync(path.join(ROOT,rel),'utf8');
const pkg=JSON.parse(read('package.json'));const manifest=JSON.parse(read('SALES_PACKAGE_MANIFEST.json'));const final=read('FINAL_VERIFICATION_STATUS.md');const spec=read('docs/commercial/ENGINEERING_TECHNICAL_SPECIFICATION.md');const coverage=read('docs/MASTER_OPERATING_STATEMENT_COVERAGE_2026-10-07.md');const webTruth=JSON.parse(read('apps/ops-web/public/web-truth.json'));const failures=[];
if(manifest.packageVersion!==pkg.version)failures.push('manifest packageVersion differs from package.json');
if(!/FINAL HANDOFF CANDIDATE/.test(final)||!/NOT PRODUCTION READY/.test(final))failures.push('final verification status banner drifted');
if(/offline field sync مصنف.*SPEC_ONLY/.test(spec))failures.push('engineering spec still contains stale offline SPEC_ONLY claim');
if(!/offline field sync.*SOURCE[_ ]IMPLEMENTED/i.test(spec))failures.push('engineering spec does not record offline source implementation');
if(!/Acceptance Tests 01–16/.test(coverage))failures.push('master coverage matrix missing Acceptance Tests 01–16');


const parity=JSON.parse(read('config/html-feature-parity.json'));const expected=parity.capabilities.map(x=>({id:x.id,status:x.status}));if(JSON.stringify(webTruth.features)!==JSON.stringify(expected)||webTruth.total!==expected.length)failures.push('derived web-truth capability list differs from parity');if(failures.length){console.error('COMMERCIAL_CONSISTENCY_FAIL');for(const f of failures)console.error(' - '+f);process.exit(1);}
console.log('COMMERCIAL_CONSISTENCY_PASS: release truth, buyer surfaces and derived provenance are aligned at source level.');
   