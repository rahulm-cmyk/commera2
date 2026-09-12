import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { Readable } from 'node:stream';
import { readJsonBody, validateJsonObject, mergeSettings } from '../src/request-input.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { SettingsService } from '../src/settings-service.js';
import { AuthService } from '../src/auth-service.js';

test('JSON boundaries reject invalid shapes, unsafe keys, depth and excess bytes', async () => {
  for (const value of [null, [], 42, 'text', true]) assert.throws(() => validateJsonObject(value), /JSON object/);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    assert.throws(() => validateJsonObject(JSON.parse(`{"nested":{"${key}":{}}}`)), /unsupported property/);
  }
  let nested = {};
  for (let i = 0; i < 42; i++) nested = { child: nested };
  assert.throws(() => validateJsonObject(nested), /too deeply/);
  const unicode = Buffer.from('{"name":"\u20ac\u20ac"}');
  await assert.rejects(readJsonBody(Readable.from([unicode]), unicode.length - 1), { status: 413 });
  assert.deepEqual(await readJsonBody(Readable.from([unicode.subarray(0, 11), unicode.subarray(11)])), { name: '\u20ac\u20ac' });
  await assert.rejects(readJsonBody(Readable.from(['{'])), /Invalid JSON/);
  assert.deepEqual(await readJsonBody(Readable.from([])), {});
  assert.throws(() => mergeSettings({ fields: { name: {} } }, { fields: null }), /Invalid fields/);
});

test('bad URLs, cookies and bodies cannot crash the server or write settings', async t => {
  const db = createDatabase(':memory:');
  const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0, googleAuthProvider: null, otpProviders: {} });
  await app.start(); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const malformed = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: app.port, path: '//[' }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(malformed, 400);
  assert.equal((await fetch(base + '/healthz')).status, 200);
  assert.equal((await fetch(base + '/api/auth/me', { headers: { cookie: 'unrelated=%ZZ' } })).status, 200);
  const store = app.service.createStore({ name: 'Audit', slug: 'audit' });
  const settings = new SettingsService(db), before = settings.get(store.id);
  for (const value of ['null', '[]', '{"fields":null}', '{"fields":[]}', '{"fields":{"__proto__":{"show":false}}}']) {
    const result = await fetch(`${base}/api/stores/${store.id}/settings/cod-form`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: value,
    });
    assert.equal(result.status, 400, value);
  }
  assert.throws(() => settings.update(store.id, 'constructor', {}), /Unsupported settings/);
  assert.deepEqual(settings.get(store.id), before);
  for (const patch of [{ animation: 'zoom' }, { addons: [null] }, { customFields: [null] }, { customFields: [{ id:'choice', label:'Choice', type:'select', options: 'not a list' }] }]) {
    assert.throws(() => settings.update(store.id, 'codForm', patch));
    assert.deepEqual(settings.get(store.id), before);
  }
  for (const animation of ['none', 'fade', 'slide']) assert.equal(settings.update(store.id, 'codForm', { animation }).animation, animation);
  assert.equal({}.show, undefined);
  for (const path of ['/s/audit/checkout/missing', '/checkout/missing', '/thank-you/missing', '/s/audit/upsell/missing']) {
    const res = await fetch(base + path);
    assert.match(res.headers.get('cache-control'), /no-store/);
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.match(res.headers.get('x-robots-tag'), /noindex/);
  }
});

test('oversized HTTP bodies receive 413 and password checks reject oversized input', async t => {
  const db = createDatabase(':memory:');
  const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0, googleAuthProvider: null, otpProviders: {} });
  await app.start(); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const response = await fetch(base + '/api/stores', { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ name:'a'.repeat(8_000_001) }) });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, 'Request body is too large');
  assert.equal((await fetch(base + '/healthz')).status, 200);
  const auth = new AuthService(db);
  auth.register({ email:'audit@example.com', displayName:'Audit User', password:'validPassword123' });
  for (const email of ['audit@example.com', 'unknown@example.com']) assert.throws(() => auth.login({email,password:'a'.repeat(10000)}), /Email or password is incorrect/);
  assert.equal(auth.login({email:'audit@example.com',password:'validPassword123'}).email,'audit@example.com');
});
