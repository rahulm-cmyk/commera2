import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

async function request(base, path, method = 'GET', payload) {
  const response = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload)
  });
  const body = (response.headers.get('content-type') || '').includes('json')
    ? await response.json()
    : await response.text();
  return { response, body };
}

test('published product page and dedicated checkout emit executable scripts', async t => {
  const app = createApp({ db: createDatabase(':memory:'), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const store = (await request(base, '/api/stores', 'POST', { name: 'Script Store', slug: 'script-store' })).body;
  const product = (await request(base, `/api/stores/${store.id}/products`, 'POST', { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 10 })).body;
  const page = (await request(base, `/api/stores/${store.id}/pages`, 'POST', { productId: product.id, title: 'Offer', slug: 'offer', body: 'Offer' })).body;
  await request(base, `/api/stores/${store.id}/pages/${page.id}/publish`, 'POST', {});
  const published = await request(base, '/s/script-store/offer');
  assert.equal(published.response.status, 200);
  assert.doesNotMatch(published.body, /id="cod-form"/);
  assert.match(published.body, /data-direct-checkout="true"/);
  const scripts = [...published.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.ok(scripts.length > 0);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
  const opened = await request(base, '/api/public/script-store/offer/checkouts', 'POST', { intent: 'open', quantity: 1 });
  assert.equal(opened.response.status, 201);
  const checkout = await request(base, `/s/script-store/checkout/${opened.body.id}`);
  assert.match(checkout.body, /id="cod-form"/);
  const checkoutScripts = [...checkout.body.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  for (const script of checkoutScripts) assert.doesNotThrow(() => new Function(script));
});

test('published page data cannot terminate an inline script', async t => {
  const app = createApp({ db: createDatabase(':memory:'), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const store = (await request(base, '/api/stores', 'POST', { name: 'Safe Script Store', slug: 'safe-script-store' })).body;
  const product = (await request(base, `/api/stores/${store.id}/products`, 'POST', { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 10 })).body;
  const payload = '</script><img src=x onerror=alert(1)>';
  const page = (await request(base, `/api/stores/${store.id}/pages`, 'POST', {
    productId: product.id,
    title: 'Safe Offer',
    slug: 'safe-offer',
    body: 'Offer',
    ctaText: payload,
  })).body;
  await request(base, `/api/stores/${store.id}/pages/${page.id}/publish`, 'POST', {});
  const published = await request(base, '/s/safe-script-store/safe-offer');
  assert.equal(published.response.status, 200);
  assert.doesNotMatch(published.body, /<\/script><img src=x onerror=alert\(1\)>/);
  assert.match(published.body, /\\u003c\/script\\u003e\\u003cimg/);
});
