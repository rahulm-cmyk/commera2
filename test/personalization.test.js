import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createPersonalizer, behaviorSummary, personalizationConfig } from '../src/personalization.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { SettingsService } from '../src/settings-service.js';

const content = { hero: { headline: 'Original' }, pageSettings: { jevEnabled: true, jevBundles: true, jev_value_headline: 'Approved value headline', jev_value_description: 'Approved description', jev_value_button: 'Choose your pack' } };
const page = { id: 1, storeId: 1, contentJson: JSON.stringify(content) };
const product = { name: 'Pods', stock: 10, pricePaise: 10000 };
const session = (control = false, storeId = 1, pageId = 1) => {
  for (let n = 0; ; n++) {
    const id = `visitor-${n}`;
    if ((createHash('sha256').update(`${storeId}:${pageId}:${id}`).digest()[0] < 26) === control) return id;
  }
};

test('Jev chooses only approved copy and in-stock bundles; caches cohorts and omits identifiers', async () => {
  let calls = 0;
  const choose = createPersonalizer({ client: { async systemOne(input) {
    calls++;
    assert.deepEqual(input.state.behavior, { engaged: true, explored: false, viewedReviews: false, comparedBundles: false, returning: false });
    assert.equal(JSON.stringify(input).includes('secret@email.com'), false);
    return { answers: { variant: { choice: 'value' }, bundle: { choice: '2' } } };
  } } });
  const input = { page, product, sessionId: session(), signals: { activeSeconds: 30, email: 'secret@email.com' }, bundles: [{ id: 2, name: 'Too many', quantity: 11, active: true }] };
  const result = await choose(input);
  assert.equal(result.copy.headline, 'Approved value headline');
  assert.equal(result.bundleId, null);
  await choose(input);
  assert.equal(calls, 1);
  assert.equal((await choose({ ...input, sessionId: session(true) })).control, true);
  assert.equal(calls, 1);
});

test('disabled, unavailable and invalid model answers preserve original content', async () => {
  const input = { page, product, sessionId: session() };
  assert.equal((await createPersonalizer()(input)).variant, 'original');
  assert.equal(personalizationConfig({ pageSettings: { jevEnabled: true } }).enabled, false);
  assert.equal(behaviorSummary({ viewedReviews: 'yes', activeSeconds: 'nonsense' }).viewedReviews, false);
  for (const response of [null, { answers: { variant: { choice: '<script>bad</script>' } } }]) {
    const choose = createPersonalizer({ client: { async systemOne() { return response; } } });
    assert.equal((await choose(input)).variant, 'original');
  }
  const fail = createPersonalizer({ client: { async systemOne() { throw Error('offline'); } } });
  assert.equal((await fail(input)).variant, 'original');
});

test('public personalization requires scoped token, consent and published settings', async t => {
  const db = createDatabase(':memory:');
  let calls = 0;
  const app = createApp({ db, port: 0, domainSyncIntervalMs: 0, personalizationClient: { async systemOne() {
    calls++;
    return { answers: { variant: { choice: 'value' }, bundle: { choice: 'none' } } };
  } } });
  const store = app.service.createStore({ name: 'Jev test', slug: 'jev-test' });
  const item = app.service.createProduct(store.id, { name: 'Pods', slug: 'pods', pricePaise: 10000, stock: 20 });
  const p = app.service.createProductPage(store.id, { productId: item.id, title: 'Original', slug: 'pods' });
  db.prepare('UPDATE product_pages SET content_json=? WHERE id=?').run(JSON.stringify(content), p.id);
  app.service.publishPage(store.id, p.id);
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const html = await (await fetch(base + '/s/jev-test/pods')).text();
  const config = JSON.parse(html.match(/id="jev-config">([^<]+)<\/script>/)[1]);
  assert.equal((await fetch(base + '/personalization.js')).status, 200);
  const payload = { pageSlug: p.slug, visitorToken: config.token, sessionId: session(false, store.id, p.id), analyticsConsentGranted: true, signals: { activeSeconds: 25 } };
  const post = data => fetch(base + `/api/public/stores/${store.id}/personalization`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
  assert.notEqual((await post({ ...payload, visitorToken: 'bad' })).status, 200);
  assert.notEqual((await post({ ...payload, pageSlug: 'other' })).status, 200);
  assert.equal((await (await post({ ...payload, analyticsConsentGranted: false })).json()).variant, 'original');
  assert.equal(calls, 0);
  const result = await (await post(payload)).json();
  assert.equal(result.copy.headline, 'Approved value headline');
  assert.equal(calls, 1);
  new SettingsService(db).update(store.id, 'privacy', { analyticsTracking: false });
  assert.equal((await (await post(payload)).json()).variant, 'original');
  assert.equal(calls, 1);
  new SettingsService(db).update(store.id, 'privacy', { analyticsTracking: true });
  db.prepare('UPDATE product_pages SET draft_json=? WHERE id=?').run(JSON.stringify({ contentJson: JSON.stringify({ ...content, pageSettings: { ...content.pageSettings, jev_value_headline: 'Unpublished' } }) }), p.id);
  assert.equal((await (await post(payload)).json()).copy.headline, 'Approved value headline');
  db.prepare("UPDATE product_pages SET status='draft' WHERE id=?").run(p.id);
  assert.notEqual((await post(payload)).status, 200);
});
