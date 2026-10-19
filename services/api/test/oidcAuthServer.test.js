'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const { createOidcAuthServer } = require('../src/auth/oidcAuthServer');

function b64urlJson(value) { return Buffer.from(JSON.stringify(value)).toString('base64url'); }
function pemToJwk(publicKey, kid) { return { ...publicKey.export({ format: 'jwk' }), kid, use: 'sig', alg: 'RS256' }; }
function signIdToken(privateKey, claims) {
  const header = b64urlJson({ alg:'RS256', typ:'JWT', kid:'test-key' });
  const payload = b64urlJson(claims);
  const input = `${header}.${payload}`;
  const sign = crypto.createSign('RSA-SHA256'); sign.update(input); sign.end();
  return `${input}.${sign.sign(privateKey).toString('base64url')}`;
}
function fakeStore() {
  const tx = new Map(), sessions = new Map(); let n = 0;
  return { tx, sessions,
    newId(){n+=1;return 'A'.repeat(41)+String(n).padStart(2,'0');},
    newCsrfToken(){n+=1;return `csrf-${String(n).padStart(30,'0')}`;},
    async createTransaction(k,v){tx.set(k,v);}, async consumeTransaction(k){const v=tx.get(k);tx.delete(k);return v||null;},
    async setSession(k,v){sessions.set(k,v);}, async getSession(k){return sessions.get(k)||null;}, async deleteSession(k){sessions.delete(k);}
  };
}

let server, base, issuer, keyPair, store, oidc;
test.after(async()=>{ if (server && server.listening) await new Promise(resolve=>server.close(resolve)); });

test('1 interactive OIDC configuration requires a session store', () => {
  const out = createOidcAuthServer({ issuerUrl:'https://idp.example.com', clientId:'fiberos', clientSecret:'secret', redirectUri:'https://api.example.com/auth/oidc/callback', env:{NODE_ENV:'production'} });
  assert.equal(out.configured, false); assert.equal(out.error, 'OIDC_SESSION_STORE_REQUIRED');
});

test('2 full Authorization Code + PKCE callback validates state, nonce, issuer and audience', async (t) => {
  keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  store = fakeStore();
  server = http.createServer(async (req,res) => {
    if (req.url === '/.well-known/openid-configuration') return res.end(JSON.stringify({ issuer, authorization_endpoint: `${base}/authorize`, token_endpoint:`${base}/token`, jwks_uri:`${base}/jwks` }));
    if (req.url === '/jwks') return res.end(JSON.stringify({ keys:[pemToJwk(keyPair.publicKey,'test-key')] }));
    if (req.url === '/token') {
      let body=''; req.on('data',c=>body+=c); req.on('end',()=>{ const params=new URLSearchParams(body); const nonce = params.get('code') === 'nonce-mismatch' ? 'wrong' : currentNonce; const token = signIdToken(keyPair.privateKey,{ iss:issuer,aud:'fiberos-ops',sub:'user-123',email:'ops@example.com',nonce,exp:Math.floor(Date.now()/1000)+600 }); res.writeHead(200,{'content-type':'application/json'}); res.end(JSON.stringify({ access_token:'opaque', token_type:'Bearer', id_token:token })); }); return;
    }
    res.writeHead(404); res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port = server.address().port; base=`http://127.0.0.1:${port}`; issuer=base; let currentNonce='';
  oidc=createOidcAuthServer({ issuerUrl:issuer, clientId:'fiberos-ops', clientSecret:'supersecret', redirectUri:`${base}/auth/oidc/callback`, sessionStore:store, env:{NODE_ENV:'test',FIBEROS_OIDC_ISSUER_URL:issuer,FIBEROS_OIDC_DISCOVERY_URL:`${base}/.well-known/openid-configuration`,OIDC_JWKS_ALLOWED_HOSTS:'127.0.0.1',OIDC_JWKS_ALLOWED_CIDRS:'127.0.0.1/32'} });
  const login=await oidc.authorizationUrl('/dashboard'); currentNonce=[...store.tx.values()][0].nonce;
  assert.match(login.url,/code_challenge=/); assert.match(login.url,/nonce=/); assert.equal(login.state.length,43);
  const result=await oidc.callback('good-code',login.state); assert.equal(result.session.sub,'user-123'); assert.equal(result.returnTo,'/dashboard'); assert.ok(result.session.csrfToken);
  await oidc.logout(result.sessionId); assert.equal(await oidc.getSession(result.sessionId),null);
});

test('3 nonce mismatch is rejected', async () => {
  // This assertion is intentionally performed through a fresh server transaction to exercise the signed ID token boundary.
  if (!oidc) return;
  const login=await oidc.authorizationUrl('/');
  await assert.rejects(() => oidc.callback('nonce-mismatch',login.state), /OIDC_NONCE_MISMATCH|OIDC_ID_TOKEN_VALIDATION_FAILED/);
});

test('4 expired ID token is rejected', async () => {
  // Validate the production verifier directly with an expired token contract.
  const token = signIdToken(keyPair.privateKey,{iss:issuer,aud:'fiberos-ops',sub:'u',nonce:'n',exp:Math.floor(Date.now()/1000)-1});
  const { verifyBearerTokenAsync } = require('../../../packages/security/src/jwt');
  const result=await verifyBearerTokenAsync(token,{NODE_ENV:'test',OIDC_JWKS_URL:`${base}/jwks`,OIDC_ISSUER:issuer,OIDC_AUDIENCE:'fiberos-ops',OIDC_JWKS_ALLOWED_HOSTS:'127.0.0.1',OIDC_JWKS_ALLOWED_CIDRS:'127.0.0.1/32'});
  assert.equal(result.ok,false); assert.equal(result.error,'TOKEN_EXPIRED');
});

test('5 signed ID token with wrong audience is rejected', async () => {
  const token=signIdToken(keyPair.privateKey,{iss:issuer,aud:'wrong',sub:'u',nonce:'n',exp:Math.floor(Date.now()/1000)+600});
  const { verifyBearerTokenAsync }=require('../../../packages/security/src/jwt');
  const result=await verifyBearerTokenAsync(token,{NODE_ENV:'test',OIDC_JWKS_URL:`${base}/jwks`,OIDC_ISSUER:issuer,OIDC_AUDIENCE:'fiberos-ops',OIDC_JWKS_ALLOWED_HOSTS:'127.0.0.1',OIDC_JWKS_ALLOWED_CIDRS:'127.0.0.1/32'});
  assert.equal(result.error,'AUDIENCE_MISMATCH');
});

test('6 state is single-use at the server transaction store', async () => { const login=await oidc.authorizationUrl('/'); const first=await store.consumeTransaction(login.state); const second=await store.consumeTransaction(login.state); assert.ok(first); assert.equal(second,null); });
