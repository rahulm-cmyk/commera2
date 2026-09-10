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
app.service.createCoupon(store.id, { code: 'SAVE10', discountType: 'percent', value: 10 });
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
    await page.locator('[name="address"]').fill('testtesttest');
    await page.locator('[name="pincode"]').fill('110001');
    await page.locator('.place-order-button:enabled').waitFor();
    await page.locator('.place-order-button').click();
    await page.locator('#error-address').filter({ hasText: 'Please enter your delivery address.' }).waitFor();
    const address = page.locator('[name="address"]');
    assert.equal(await address.evaluate(el => el.validity.customError), true);
    await address.fill(width === 1440 ? 'siratram nagar naer bas ,stabd' : '24 Lake View Main Road');
    assert.equal(await address.evaluate(el => el.validity.valid), true, 'Corrected address retains stale error');
    assert.equal(await page.locator('#error-address').textContent(), '');
    assert.equal(await page.locator('.checkout-summary .stock').count(), 0, 'Raw inventory count appears in checkout');
    if (width < 1024) await page.locator('#checkout-summary-toggle').click();
    await page.getByText('Have a coupon?', { exact: true }).click();
    for (const code of ['SAVE999', 'SAVE10', 'SAVE999', 'SAVE10']) {
      await page.locator('#checkout-coupon-code').fill(code);
      await page.locator('#apply-coupon').click();
      const valid = code === 'SAVE10';
      await page.locator(`#coupon-status[data-state="${valid ? 'success' : 'error'}"]`).waitFor();
      assert.equal(await page.locator('#coupon-status').evaluate(el => getComputedStyle(el).color), valid ? 'rgb(24, 115, 78)' : 'rgb(180, 35, 24)');
      assert.equal(await page.locator('#checkout-coupon-code').getAttribute('aria-invalid'), String(!valid));
      await page.screenshot({ path: `qa-checkout-feedback-${width}-${valid ? 'valid' : 'invalid'}.png`, fullPage: true });
    }
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
    console.log(`Coupon states, corrected address and PostgreSQL-format checkout passed at ${width}px`);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 2);
} finally {
  await browser.close();
  await app.stop();
}
