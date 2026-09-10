import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createDatabase } from '../src/database.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const db = createDatabase(':memory:');
const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0, otpProviders: {} });
const store = app.service.createStore({ name: 'Checkout QA', slug: 'checkout-qa' });
const product = app.service.createProduct(store.id, { name: 'QA product', slug: 'qa-product', pricePaise: 10000, stock: 10 });
const productPage = app.service.createProductPage(store.id, { productId: product.id, title: 'QA product', slug: 'qa-product', body: 'Isolated test product' });
app.service.publishPage(store.id, productPage.id);
await app.start('127.0.0.1');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    const checkout = app.service.saveCheckoutDraft(store.id, { productId: product.id, pageId: productPage.id, quantity: 1, checkoutTokenValid: true });
    const page = await browser.newPage({ viewport: { width, height: 960 } });
    const failures = [];
    page.on('pageerror', error => failures.push(error.message));
    page.on('response', async response => {
      if (response.url().includes('/api/public/checkouts/') && !response.ok()) console.log('Checkout rejected:', (await response.json()).error);
    });
    // Exercise the real browser flow using the timestamp format returned by PostgreSQL.
    await page.route('**/api/public/checkouts/**', async route => {
      db.prepare('UPDATE checkout_sessions SET updated_at=? WHERE id=?').run(new Date().toISOString().replace('T', ' ').replace('Z', '+00'), checkout.id);
      await route.continue();
    });
    await page.goto(`http://127.0.0.1:${app.port}/s/${store.slug}/checkout/${checkout.id}`);
    await page.locator('[name="name"]').fill('Riya Sharma');
    await page.locator('[name="phone"]').fill(width === 1440 ? '9876543210' : '9876543211');
    await page.locator('[name="address"]').fill(width === 1440 ? '12 Green Park Main Road' : '24 Lake View Main Road');
    await page.locator('[name="pincode"]').fill('110001');
    await page.locator('.place-order-button:enabled').waitFor();
    await page.locator('.place-order-button').click();
    try { await page.waitForURL('**/thank-you/**'); }
    catch (error) {
      console.log('Checkout status:', await page.locator('#status').textContent());
      console.log('Invalid fields:', await page.locator(':invalid').evaluateAll(elements => elements.map(el => el.name || el.tagName)));
      await page.screenshot({ path: `qa-checkout-timestamp-failure-${width}.png`, fullPage: true });
      throw error;
    }
    assert.equal(app.service.getCheckout(store.id, checkout.id).status, 'completed');
    assert.deepEqual(failures, []);
    await page.screenshot({ path: `qa-checkout-timestamp-${width}.png`, fullPage: true });
    await page.reload();
    assert.ok(page.url().includes('/thank-you/'));
    await page.close();
    console.log(`PostgreSQL-format checkout reached order confirmation at ${width}px`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 2);
} finally {
  await browser.close();
  await app.stop();
}
