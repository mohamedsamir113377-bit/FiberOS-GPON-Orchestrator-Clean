#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const violations=[];
const sourceDirs=[path.join(ROOT,'packages'),path.join(ROOT,'services'),path.join(ROOT,'apps')];
function walk(dir, cb){if(!fs.existsSync(dir))return;for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())walk(f,cb);else if(/\.(js|cjs|mjs)$/.test(e.name))cb(f);}}
const importRe=/(?:require|from)\s*[('"`]([^'"`]+)['"`]/g;
walk(path.join(ROOT,'packages'),(file)=>{
 const rel=path.relative(ROOT,file);
 const text=fs.readFileSync(file,'utf8');
 for(const m of text.matchAll(importRe)){
  const spec=m[1];
  if(/^\.?\.?\/?(services|apps)(?:\/|$)/.test(spec) || /^@fiberos\/(?:api|worker|ai|gis)(?:\/|$)/.test(spec)) {
   violations.push({rule:'PACKAGE_MUST_NOT_IMPORT_APP_OR_SERVICE',file:rel,spec});
  }
 }
});
walk(path.join(ROOT,'services'),(file)=>{
 const rel=path.relative(ROOT,file); const text=fs.readFileSync(file,'utf8');
 for(const m of text.matchAll(importRe)){
  const spec=m[1];
  if(/^\.?\.?\/?apps(?:\/|$)/.test(spec)) violations.push({rule:'SERVICE_MUST_NOT_IMPORT_APP',file:rel,spec});
 }
});
const report={schema:'fiberos.r14.1.architecture-boundary-gate.v1',pass:violations.length===0,violations};
fs.writeFileSync(path.join(ROOT,'ARCHITECTURE_BOUNDARY_REPORT.json'),JSON.stringify(report,null,2)+'\n');
if(violations.length){console.error(`ARCHITECTURE BOUNDARY FAIL: ${violations.length}`);for(const v of violations)console.error(`- [${v.rule}] ${v.file} -> ${v.spec}`);process.exitCode=1;} else console.log('ARCHITECTURE BOUNDARY PASS');
