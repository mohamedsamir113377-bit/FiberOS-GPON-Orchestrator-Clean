'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {verifyBundle,parseChecksumFile}=require('../verify-evidence-bundle-integrity');
const ROOT=path.resolve(__dirname,'..','..');
const checksumText=fs.readFileSync(path.join(ROOT,'docs/PACKAGE_CONTENTS_SHA256SUMS.txt'),'utf8');
const entries=parseChecksumFile(checksumText);
function fixture() {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiberos-evidence-'));
 for(const rel of ['docs/PACKAGE_CONTENTS_SHA256SUMS.txt','SALES_PACKAGE_MANIFEST.json','SBOM.cdx.json','package.json',...entries.map(e=>e.rel)]) {
  const target=path.join(dir,rel);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,rel),target);
 }
 return dir;
}
test('independent evidence verifier accepts the committed bundle',()=>{
 const result=verifyBundle();assert.equal(result.ok,true);assert.equal(result.checkedEntries,14);assert.ok(result.sbomComponents>0);
});
test('independent evidence verifier rejects a tampered deliverable',()=>{
 const dir=fixture();try{fs.appendFileSync(path.join(dir,entries[0].rel),'\nTAMPERED\n');assert.throws(()=>verifyBundle({root:dir}),/EVIDENCE_SHA256_MISMATCH/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('independent evidence verifier rejects a missing deliverable',()=>{
 const dir=fixture();try{fs.rmSync(path.join(dir,entries[0].rel));assert.throws(()=>verifyBundle({root:dir}),/EVIDENCE_FILE_MISSING/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('checksum parser rejects unsafe and duplicate paths',()=>{
 assert.throws(()=>parseChecksumFile(''.padEnd(64,'a')+'  ../escape'),/CHECKSUM_PATH_UNSAFE/);
 const line=''.padEnd(64,'a')+'  package.json';assert.throws(()=>parseChecksumFile(line+'\n'+line),/CHECKSUM_PATH_DUPLICATE/);
});
test('checksum verifier rejects a missing required deliverable entry',()=>{
 const dir=fixture();try{
  const file=path.join(dir,'docs/PACKAGE_CONTENTS_SHA256SUMS.txt');
  const lines=fs.readFileSync(file,'utf8').split(/\r?\n/), first=entries[0];
  fs.writeFileSync(file,lines.filter(line=>!line.includes('  '+first.rel)).join('\n'));
  assert.throws(()=>verifyBundle({root:dir}),/CHECKSUM_DELIVERABLE_SET_MISMATCH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('verifier rejects a symlink in a parent directory before reading bytes',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fiberos-evidence-root-')),outside=fs.mkdtempSync(path.join(os.tmpdir(),'fiberos-evidence-outside-'));
 try{fs.writeFileSync(path.join(outside,'PACKAGE_CONTENTS_SHA256SUMS.txt'),checksumText);fs.symlinkSync(outside,path.join(dir,'docs'),'dir');assert.throws(()=>verifyBundle({root:dir}),/EVIDENCE_PATH_SYMLINK:docs\/PACKAGE_CONTENTS_SHA256SUMS.txt/);}
 finally{fs.rmSync(dir,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true});}
});
