'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const R = require('../src/index.js');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SRC = path.join(ROOT, 'i18n', 'source.json');
const cat = (l) => path.join(ROOT, 'i18n', 'catalogs', l + '.json');

function tmpJson(name, obj){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-rt-'));
  const f = path.join(dir, name);
  fs.writeFileSync(f, JSON.stringify(obj), 'utf8');
  return f;
}

test('locale helpers: canonicalisation, language extraction, RTL detection', () => {
  assert.equal(R.normalizeLocale('pt_BR'), 'pt-BR');
  assert.equal(R.languageOf('pt_BR'), 'pt');
  assert.equal(R.isRTL('ar'), true);
  assert.equal(R.isRTL('ar-EG'), true);
  assert.equal(R.isRTL('fa-IR'), true);
  assert.equal(R.isRTL('en'), false);
  assert.equal(R.directionOf('he'), 'rtl');
  assert.equal(R.directionOf('de'), 'ltr');
});

test('substitute: replaces known placeholders, keeps unknown, NFC-normalises', () => {
  assert.equal(R.substitute('Hello {name}', { name: 'Ali' }), 'Hello Ali');
  assert.equal(R.substitute('Hello {name}', {}), 'Hello {name}');
  assert.equal(R.substitute('a {x} b', { x: 0 }), 'a 0 b');
  assert.equal(R.toNFC('cafe' + String.fromCharCode(0x301)), 'caf' + String.fromCharCode(0xE9));
});

test('loadCatalog: real vi catalog is machine-draft with full key coverage', () => {
  const c = R.loadCatalog(cat('vi'));
  assert.equal(c.status, 'machine-draft');
  assert.equal(c.locale, 'vi');
  assert.equal(c.direction, 'ltr');
  assert.ok(c.keyCount >= 100, 'expected >=100 keys, got ' + c.keyCount);
});

test('loadCatalog: real ar catalog is verified and RTL', () => {
  const c = R.loadCatalog(cat('ar'));
  assert.equal(c.status, 'verified');
  assert.equal(c.direction, 'rtl');
  assert.ok(c.keyCount >= 100, 'expected >=100 keys, got ' + c.keyCount);
});

test('translate: real draft catalog resolves a known key, not the key itself', () => {
  const tr = R.createTranslator({ sourcePath: SRC, catalogPath: cat('vi') });
  const v = tr.t('ui.516f0db4cbb4');
  assert.equal(typeof v, 'string');
  assert.notEqual(v, '');
  assert.notEqual(v, 'ui.516f0db4cbb4');
  assert.equal(tr.direction, 'ltr');
  assert.equal(tr.activation, 'draft');
  assert.ok(tr.coverage() >= 0.9, 'coverage ' + tr.coverage());
});

test('translate: unknown key degrades to the key, never throws', () => {
  const tr = R.createTranslator({ sourcePath: SRC, catalogPath: cat('vi') });
  assert.equal(tr.t('ui.this.key.does.not.exist'), 'ui.this.key.does.not.exist');
});

test('fixed (non-translatable) keys always resolve to the source value', () => {
  const s = tmpJson('source.json', { locale: 'source', status: 'verified',
    translations: { 'ui.k1': 'Source one', 'ui.k2': 'GPS' } });
  const tgt = tmpJson('xx.json', { locale: 'xx', status: 'machine-draft',
    translations: { 'ui.k1': 'translated', 'ui.k2': 'translated-two' }, 'ui.k2': { translatable: false } });
  const tr = R.createTranslator({ sourcePath: s, catalogPath: tgt });
  assert.equal(tr.t('ui.k2'), 'GPS');
  assert.equal(tr.t('ui.k1'), 'translated');
});

test('ICU plural selection picks one/other correctly', () => {
  const s = tmpJson('source.json', { locale: 'source', status: 'verified', translations: { 'items': 'items' } });
  const tgt = tmpJson('en.json', { locale: 'en', status: 'machine-draft',
    translations: { 'items.one': 'item', 'items.other': 'items' } });
  const tr = R.createTranslator({ sourcePath: s, catalogPath: tgt });
  assert.equal(tr.t('items', { count: 1 }), 'item');
  assert.equal(tr.t('items', { count: 5 }), 'items');
});

test('placeholder integrity: values with placeholders keep them intact', () => {
  const s = tmpJson('source.json', { locale: 'source', status: 'verified', translations: { 'k.a': 'Hi {name}' } });
  const tgt = tmpJson('yy.json', { locale: 'yy', status: 'machine-draft', translations: { 'k.a': 'Hola {name}' } });
  const tr = R.createTranslator({ sourcePath: s, catalogPath: tgt });
  assert.equal(tr.t('k.a', { name: 'Sara' }), 'Hola Sara');
  assert.equal(tr.t('k.a'), 'Hola {name}');
});
