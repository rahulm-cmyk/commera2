import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

test('clearing a compare-at price persists while omitted values remain unchanged', async t => {
  const app = createApp({
    db: createDatabase(':memory:'), port: 0, merchantAuth: false,
    domainSyncIntervalMs: 0, otpProviders: {}, googleAuthProvider: null,
    accountEmailProvider: null,
  });
  await app.start('127.0.0.1');
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (path, method = 'GET', body) => {
    const response = await fetch(base + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result;
  };
  const store = await call('/api/stores', 'POST', { name: 'Pricing test', slug: 'pricing-test' });
  const root = `/api/stores/${store.id}/products`;
  const product = await call(root, 'POST', {
    name: 'Hair oil', slug: 'hair-oil', pricePaise: 49900,
    comparePricePaise: 69900, stock: 4, status: 'draft',
  });
  const path = `${root}/${product.id}`;
  assert.equal((await call(path, 'PATCH', { name: 'Herbal hair oil' })).comparePricePaise, 69900);
  assert.equal((await call(path, 'PATCH', { comparePricePaise: null })).comparePricePaise, null);
  assert.equal((await call(path)).comparePricePaise, null);
  await call(path, 'PATCH', { comparePricePaise: 79900 });
  const cleared = await call(path, 'PATCH', { comparePricePaise: '' });
  assert.equal(cleared.comparePricePaise, null);
  assert.equal(cleared.pricePaise, 49900);
  assert.equal(cleared.stock, 4);
  assert.equal(cleared.active, 0);
});
