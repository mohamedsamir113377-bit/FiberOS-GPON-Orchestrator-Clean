'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../public/session-auth.js'),'utf8');
function load(fetchImpl){
  const listeners={}; const status={textContent:'',dataset:{}};
  const window={location:{origin:'https://ops.example',href:'https://ops.example/',pathname:'/index.html',assign(url){this.assigned=url;}},document:{addEventListener(n,f){listeners[n]=f;},getElementById(id){return id==='sessionAuthStatus'?status:null;}},localStorage:{getItem(){return null}},FiberOSApiOrigin:{normalizeApiBase:()=> 'https://api.example',resolveAuthUrl:(_,p)=>'https://api.example'+p},fetch:fetchImpl};
  vm.runInNewContext(source,{window}); return {window,listeners,status};
}

test('OIDC session refresh loads principal and CSRF token without persisting a JWT',async()=>{
  const out=load(async()=>({ok:true,json:async()=>({authenticated:true,principal:{sub:'u1',email:'ops@example.com'},csrfToken:'csrf-1'})}));
  await out.window.FiberOSSessionAuth.refresh();
  assert.equal(out.window.FiberOSSessionAuth.getSession().sub,'u1');
  assert.equal(out.window.FiberOSSessionAuth.getCsrfToken(),'csrf-1');
  assert.equal(out.status.dataset.connected,'true');
});

test('login redirects to the OIDC endpoint',()=>{
  const out=load(async()=>({ok:false})); out.window.FiberOSSessionAuth.login('/dashboard'); assert.match(out.window.location.assigned,/auth\/oidc\/login\?returnTo=%2Fdashboard/); 
});

test('logout sends CSRF header and includes credentials',async()=>{
  const calls=[]; const out=load(async(url,opt)=>{calls.push({url,opt}); return {ok:true,json:async()=>({authenticated:true,principal:{sub:'u1'},csrfToken:'csrf-1'})};});
  await new Promise(r=>setImmediate(r)); await out.window.FiberOSSessionAuth.logout();
  assert.equal(calls.some(x=>x.opt&&x.opt.method==='POST'&&x.opt.credentials==='include'&&x.opt.headers['X-FiberOS-CSRF']==='csrf-1'),true);
});
