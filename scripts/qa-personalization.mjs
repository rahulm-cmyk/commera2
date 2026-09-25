import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { SettingsService } from '../src/settings-service.js';

const { chromium } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_PATH || 'playwright');
const db = createDatabase(':memory:');
let calls = 0;
const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0,
  personalizationClient: { async systemOne() { calls++; return { answers: { variant: { choice: 'value' }, bundle: { choice: 'none' } } }; } },
});
const store = app.service.createStore({ name: 'Jev Preview', slug: 'jev-preview' });
const product = app.service.createProduct(store.id, { name: 'Everyday Pods', slug: 'pods', pricePaise: 39900, stock: 20 });
const item = app.service.createProductPage(store.id, { productId: product.id, title: 'Everyday Pods', slug: 'pods' });
const content = { hero: { headline: 'Everyday Pods', subheadline: 'Original description' }, pageSettings: { jevEnabled: true, jev_value_headline: 'Everyday care, in one pack', jev_value_description: 'Approved product description', jev_value_button: 'Choose your pack' }, sections: [] };
db.prepare('UPDATE product_pages SET content_json=? WHERE id=?').run(JSON.stringify(content), item.id);
app.service.publishPage(store.id, item.id);
new SettingsService(db).update(store.id, 'privacy', { analyticsTracking: true, requireAnalyticsConsent: true });
await app.start('127.0.0.1');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await mkdir('data/personalization-qa', { recursive: true });
try {
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 850 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(({ storeId }) => {
      localStorage.setItem(`commera2_tracking_consent_${storeId}`, 'accepted');
      sessionStorage.setItem(`commera2-live-visitor-${storeId}`, 'visitor-0');
    }, { storeId: store.id });
    await page.clock.install();
    await page.goto(`http://127.0.0.1:${app.port}/s/jev-preview/pods`);
    await page.clock.runFor(16_000);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('.product-purchase h1').textContent(), 'Everyday Pods');
    await page.evaluate(() => {
      const spacer = document.createElement('div');
      spacer.style.height = '1800px';
      document.body.append(spacer);
      scrollTo(0, document.documentElement.scrollHeight);
    });
    await page.clock.runFor(1000);
    await page.waitForFunction(() => document.querySelector('.product-purchase h1').textContent === 'Everyday care, in one pack');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({ path: `data/personalization-qa/storefront-${width}.png` });
    assert.equal(await page.locator('#hero-price').textContent(), '\u20b9399.00');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.evaluate(({ storeId }) => localStorage.setItem(`commera2_tracking_consent_${storeId}`, 'rejected'), { storeId: store.id });
    await page.clock.runFor(1000);
    assert.equal(await page.locator('.product-purchase h1').textContent(), 'Everyday Pods');
    assert.deepEqual(errors, []);
    await page.close();
  }
  assert.ok(calls >= 1);
  const merchant = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await merchant.goto(`http://127.0.0.1:${app.port}/product-pages/${item.id}/edit`);
  await merchant.locator('#builder-page-settings').click();
  await merchant.getByText('Jev personalization', { exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await merchant.locator('[data-vb-page="jevEnabled"]').isChecked(), true);
  await merchant.getByText('Value variation', { exact: true }).click();
  await merchant.locator('[data-vb-page="jev_value_headline"]').fill('Updated approved headline');
  await merchant.screenshot({ path: 'data/personalization-qa/editor.png' });
  await merchant.locator('#save-page-editor').click();
  await merchant.waitForFunction(() => !document.querySelector('#save-page-editor')?.disabled);
  await merchant.reload();
  await merchant.locator('#builder-page-settings').click();
  await merchant.getByText('Value variation', { exact: true }).click();
  assert.equal(await merchant.locator('[data-vb-page="jev_value_headline"]').inputValue(), 'Updated approved headline');
  const live = await (await fetch(`http://127.0.0.1:${app.port}/s/jev-preview/pods`)).text();
  assert.equal(live.includes('Updated approved headline'), false);
  console.log('Desktop/mobile adaptation, consent withdrawal, stable price and merchant controls passed.');
} finally { await browser.close(); await app.stop(); }
