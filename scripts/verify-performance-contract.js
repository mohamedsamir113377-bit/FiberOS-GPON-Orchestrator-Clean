#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,'config/performance-contract.v1.json'),'utf8'));
const failures=[];
for(const [key,value] of Object.entries(cfg.limits||{}))if(!Number.isInteger(value)||value<=0)failures.push(key+': must be a positive integer');
for(const key of ['operationsTraceMaxNodes','operationsTraceMaxLinks','operationsTraceMaxPaths','operationsTraceMaxDepth','gisReconciliationMaxRecords','offlineQueueMaxAttempts'])if(!(key in cfg.limits))failures.push('missing limit: '+key);
const checks=[['packages/operations-trace/src/index.js',/MAX_NODES=1000[\s\S]*MAX_LINKS=4000[\s\S]*MAX_PATHS=32[\s\S]*MAX_DEPTH=64/],['packages/gis-reconciliation/src/index.js',/MAX_RECORDS=5000/],['packages/offline-field-queue/src/index.js',/maxAttempts = 5/],['packages/unified-intelligence-graph/src/index.js',/MAX_DEPTH = 32[\s\S]*MAX_NEIGHBORS = 50[\s\S]*MAX_ASSESSMENTS = 20/]];
for(const [rel,re] of checks){const p=path.join(ROOT,rel);if(!fs.existsSync(p))failures.push('missing source: '+rel);else if(!re.test(fs.readFileSync(p,'utf8')))failures.push('resource ceiling drift: '+rel);}
if(failures.length){console.error('PERFORMANCE_CONTRACT_FAIL');for(const f of failures)console.error(' - '+f);process.exit(1);}
console.log('PERFORMANCE_CONTRACT_PASS: bounded source resource ceilings match the declared static contract; no runtime SLO is inferred.');
