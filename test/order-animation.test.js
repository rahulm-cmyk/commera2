import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER_ANIMATIONS, normalizeOrderAnimation } from '../public/order-animation-options.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { SettingsService } from '../src/settings-service.js';
import { renderCodBuilder } from '../src/cod-builder.js';

test('ten distinct confirmation styles persist with bounded durations and render to checkout', t => {
  const db = createDatabase(':memory:'); t.after(() => db.close());
  const app = createApp({ db, port: 0, domainSyncIntervalMs: 0 });
  const store = app.service.createStore({ name: 'Animation test', slug: 'animation-test' });
  const settings = new SettingsService(db);
  assert.equal(ORDER_ANIMATIONS.length, 10);
  assert.equal(new Set(ORDER_ANIMATIONS.map(item => item.id)).size, 10);
  assert.deepEqual(normalizeOrderAnimation(undefined), { style: 'none', durationMs: 3500 });
  for (const style of ['none', ...ORDER_ANIMATIONS.map(item => item.id)]) {
    const next = settings.update(store.id, 'codForm', { orderAnimation: { style, durationMs: 2500 } });
    assert.deepEqual(next.orderAnimation, { style, durationMs: 2500 });
    assert.equal(settings.get(store.id).codForm.orderAnimation.style, style);
    const html = renderCodBuilder(next, {});
    assert.match(html, /order-animation.css/);
    const config = JSON.parse(html.match(/id="cod-builder-settings">(.*?)<\/script>/)[1]);
    assert.deepEqual(config.orderAnimation, next.orderAnimation);
  }
  for (const option of [null, [], 'scooter', { style: '</script>', durationMs: 3000 }, { style: 'van', durationMs: -1 }, { style: 'van', durationMs: 5001 }, { style: 'van', durationMs: '3500' }, { style: 'van', durationMs: 2000.2 }]) {
    assert.throws(() => settings.update(store.id, 'codForm', { orderAnimation: option }));
  }
  assert.equal(settings.get(store.id).codForm.orderAnimation.style, 'celebration');
});

test('old stores have no surprise animation and unknown client configuration fails closed', () => {
  for (const value of [null, {}, { style: 'bad' }, { style: '__proto__' }]) assert.equal(normalizeOrderAnimation(value).style, 'none');
  assert.equal(normalizeOrderAnimation({ style: 'scooter', durationMs: 60000 }).durationMs, 3500);
  const html = renderCodBuilder({ fields: {} }, {});
  assert.match(html, /"orderAnimation":\{"style":"none","durationMs":3500\}/);
});
