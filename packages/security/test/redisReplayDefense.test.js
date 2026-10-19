'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRedisReplayDefense, validateNonce, canonicalContext } = require('../src/redisReplayDefense');
function fakeRedis() {
  const map = new Map();
  return {
    async set(key, value, options) { if (options && options.NX && map.has(key)) return null; map.set(key, { value, expiresAt: Date.now() + Number(options.EX || 300) * 1000 }); return 'OK'; },
    async del(key) { return map.delete(key) ? 1 : 0; },
    size() { return map.size; }
  };
}

test('1 invalid nonce too short rejected', () => assert.throws(() => validateNonce('short'), /REPLAY_NONCE_INVALID/));
test('2 invalid nonce characters rejected', () => assert.throws(() => validateNonce('x'.repeat(32) + '!'), /REPLAY_NONCE_INVALID/));
test('3 valid nonce accepted', () => assert.equal(validateNonce('x'.repeat(32)).length, 32));
test('4 canonical context sorts keys', () => assert.equal(canonicalContext({ b: 2, a: 1 }), 'a=1&b=2'));
test('5 first reservation succeeds', async () => { const d=createRedisReplayDefense(fakeRedis()); assert.deepEqual(await d.reserve('a'.repeat(32), 'u1'), { replay:false, seen:false }); });
test('6 duplicate reservation is replay', async () => { const d=createRedisReplayDefense(fakeRedis()); await d.reserve('b'.repeat(32), 'u1'); assert.deepEqual(await d.reserve('b'.repeat(32), 'u1'), { replay:true, seen:true }); });
test('7 different contexts are isolated', async () => { const d=createRedisReplayDefense(fakeRedis()); const n='c'.repeat(32); assert.equal((await d.reserve(n,'u1')).replay,false); assert.equal((await d.reserve(n,'u2')).replay,false); });
test('8 object and equivalent canonical contexts collide', async () => { const d=createRedisReplayDefense(fakeRedis()); const n='d'.repeat(32); await d.reserve(n,{b:2,a:1}); assert.equal((await d.reserve(n,{a:1,b:2})).replay,true); });
test('9 concurrent calls yield one first reservation', async () => { const d=createRedisReplayDefense(fakeRedis()); const n='e'.repeat(32); const out=await Promise.all(Array.from({length:20},()=>d.reserve(n,'same'))); assert.equal(out.filter(x=>!x.replay).length,1); });
test('10 concurrent calls mark all remaining as replay', async () => { const d=createRedisReplayDefense(fakeRedis()); const n='f'.repeat(32); const out=await Promise.all(Array.from({length:10},()=>d.reserve(n,'same'))); assert.equal(out.filter(x=>x.replay).length,9); });
test('11 revoke deletes reservation', async () => { const d=createRedisReplayDefense(fakeRedis()); const n='g'.repeat(32); await d.reserve(n,'ctx'); assert.equal(await d.revoke(n,'ctx'),true); assert.equal((await d.reserve(n,'ctx')).replay,false); });
test('12 checkAndMarkNonce is equivalent to reserve', async () => { const d=createRedisReplayDefense(fakeRedis()); const n='h'.repeat(32); assert.equal((await d.checkAndMarkNonce(n,'ctx')).replay,false); assert.equal((await d.checkAndMarkNonce(n,'ctx')).replay,true); });
test('13 custom prefix is applied and valid', async () => { const r=fakeRedis(); const d=createRedisReplayDefense(r,{prefix:'test:replay',ttlSeconds:300}); await d.reserve('i'.repeat(32),'ctx'); assert.equal(r.size(),1); });
test('14 invalid TTL is rejected', () => assert.throws(() => createRedisReplayDefense(fakeRedis(), { ttlSeconds: 10 }), /REPLAY_TTL_INVALID/));
test('15 redis set failure is fail-closed', async () => { const d=createRedisReplayDefense({ async set(){ throw new Error('down'); }, async del(){ return 0; } }); await assert.rejects(() => d.reserve('j'.repeat(32),'ctx'), /REPLAY_DEFENSE_REDIS_FAILED/); });
