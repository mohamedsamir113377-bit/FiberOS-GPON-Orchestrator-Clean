#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');
const PKG_DIR = path.join(ROOT, 'packages');
const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, {withFileTypes:true})) {
    const full=path.join(dir,entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|cjs|mjs)$/.test(entry.name)) files.push(full);
  }
}
walk(PKG_DIR);
const packages=[...new Set(files.map(f=>path.relative(PKG_DIR,f).split(path.sep)[0]))].sort();
const edges=new Map(packages.map(p=>[p,new Set()]));
const requireRe=/\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)|\bfrom\s+['"`]([^'"`]+)['"`]/g;
for (const file of files) {
  const owner=path.relative(PKG_DIR,file).split(path.sep)[0];
  const text=fs.readFileSync(file,'utf8');
  for (const m of text.matchAll(requireRe)) {
    const spec=m[1] || m[2];
    if (spec.startsWith('@fiberos/')) edges.get(owner)?.add(spec.replace('@fiberos/','').split('/')[0]);
    const rel=spec.match(/^(?:\.\.\/)+(?:\.\.\/)*([^/]+)/);
    if (rel && edges.has(rel[1]) && rel[1]!==owner) edges.get(owner).add(rel[1]);
  }
}
const graph=Object.fromEntries(packages.map(p=>[p,[...edges.get(p)].filter(x=>edges.has(x)).sort()]));
const rootRules={packagesCannotImportAppsOrServices:true,servicesMayDependOnPackages:true,appsConsumeThroughHttpContracts:true,engineeringMathIsPureAndWorkerOffloadable:true};
const mapFile=path.join(ROOT,'ARCHITECTURE_MAP.json');
let generatedAt=new Date().toISOString();
try {
  const previous=JSON.parse(fs.readFileSync(mapFile,'utf8'));
  if (JSON.stringify({packages:previous.packages,edges:previous.edges,rootRules:previous.rootRules}) === JSON.stringify({packages,edges:graph,rootRules})) generatedAt=previous.generatedAt;
} catch (_err) {}
const output={schema:'fiberos.r14.1.architecture-map.v1',generatedAt,packages,edges:graph,rootRules};
fs.writeFileSync(mapFile,JSON.stringify(output,null,2)+'\n');
console.log(`Generated ARCHITECTURE_MAP.json (${packages.length} packages).`);
