import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

async function request(base, path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = (response.headers.get('content-type') || '').includes('json') ? await response.json() : await response.text();
  return { response, body };
}

test('HTTP API exposes a real merchant-to-public COD flow', async t => {
  const app = createApp({ db: createDatabase(':memory:'), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;

  let result = await request(base, '/api/stores', { method: 'POST', body: JSON.stringify({ name: 'Nivkara', slug: 'nivkara' }) });
  assert.equal(result.response.status, 201);
  const store = result.body;

  result = await request(base, `/api/stores/${store.id}/products`, { method: 'POST', body: JSON.stringify({ name: 'Hair Oil', slug: 'hair-oil', pricePaise: 79900, stock: 5 }) });
  const product = result.body;
  assert.equal(result.response.status, 201);

  result = await request(base, `/api/stores/${store.id}/pages`, { method: 'POST', body: JSON.stringify({ productId: product.id, title: 'Bedtime Ritual', slug: 'ritual', body: 'A simple bedtime ritual.' }) });
  const page = result.body;
  await request(base, `/api/stores/${store.id}/pages/${page.id}/publish`, { method: 'POST' });

  result = await request(base, '/s/nivkara/ritual');
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Bedtime Ritual/);
  assert.match(result.body, /₹799/);

  result = await request(base, '/api/public/nivkara/ritual/checkouts', { method: 'POST', body: JSON.stringify({ quantity: 1, name: 'Meera' }) });
  const draft = result.body;
  await request(base, `/api/public/checkouts/${draft.id}`, { method: 'PATCH', body: JSON.stringify({ storeId: store.id, phone: '9876543210', address: '12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true }) });
  result = await request(base, `/api/public/checkouts/${draft.id}/order`, { method: 'POST', body: JSON.stringify({ storeId: store.id }) });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.totalPaise, 79900);

  result = await request(base, `/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.metrics.orders, 1);
  assert.equal(result.body.products[0].stock, 4);
});

test('HTTP API returns truthful validation errors', async t => {
  const app = createApp({ db: createDatabase(':memory:'), port: 0 });
  await app.start(); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const result = await request(base, '/api/stores', { method: 'POST', body: JSON.stringify({ name: '', slug: '' }) });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /required/i);
});
