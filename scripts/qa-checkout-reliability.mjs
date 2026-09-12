import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { SettingsService } from '../src/settings-service.js';

const { chromium } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_PATH || 'playwright');
const db = createDatabase(':memory:');
const locations = {
  '110001': { city: 'New Delhi', state: 'Delhi', country: 'India' },
  '380015': { city: 'Ahmedabad', state: 'Gujarat', country: 'India' },
};
const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0, googleAuthProvider: null, accountEmailProvider: null, otpProviders: {},
  pincodeOptions: { lookup: async code => locations[code] || null, serviceability: async () => true },
});
const store = app.service.createStore({ name: 'Checkout Audit', slug: 'checkout-audit' });
const product = app.service.createProduct(store.id, { name: 'Everyday essentials', slug: 'essentials', pricePaise: 50000, stock: 25 });
const productPage = app.service.createProductPage(store.id, { productId: product.id, title: product.name, slug: 'essentials', body: 'Everyday essentials for your home.' });
app.service.publishPage(store.id, productPage.id);
const settings = new SettingsService(db);
settings.update(store.id, 'codForm', { protection: { botTraffic: false }, animation: 'none' });
await app.start('127.0.0.1');
const base = `http://127.0.0.1:${app.port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], output = 'data/checkout-audit';
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/settings/cod-form');
  await page.getByRole('tab', { name: 'Customer Fields', exact: true }).click();
  try { await page.getByLabel('Checkout animation', { exact: true }).selectOption('slide', { timeout: 5000 }); }
  catch (error) { await page.screenshot({ path: `${output}/editor-failure.png` }); console.log({ errors, text: (await page.locator('#content').innerText()).slice(0, 2500) }); throw error; }
  await page.getByRole('button', { name: 'Preview checkout animation' }).click();
  assert.ok(await page.locator('#cod-live-preview').evaluate(node => node.getAnimations().length > 0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Preview checkout animation' }).click();
  assert.equal(await page.locator('#cod-live-preview').evaluate(node => node.getAnimations().length), 0);
  await page.getByLabel('Checkout animation', { exact: true }).selectOption('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Preview checkout animation' }).click();
  assert.equal(await page.locator('#cod-live-preview').evaluate(node => node.getAnimations().length), 0);
  await page.getByLabel('Checkout animation', { exact: true }).selectOption('fade');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('COD Form settings saved', { exact: true }).waitFor();
  assert.equal(settings.get(store.id).codForm.animation, 'fade');
  await page.reload();
  await page.getByRole('tab', { name: 'Customer Fields', exact: true }).click();
  assert.equal(await page.getByLabel('Checkout animation', { exact: true }).inputValue(), 'fade');
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.getByLabel('Checkout animation', { exact: true }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Motion editor overflow at ${width}`);
    await page.screenshot({ path: `${output}/animation-editor-${width}.png` });
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => {
    for (const key of ['localStorage', 'sessionStorage']) Object.defineProperty(window, key, { get() { throw new DOMException('Storage blocked', 'SecurityError'); } });
  });
  const customer = await context.newPage();
  customer.on('pageerror', error => errors.push(error.message));
  await customer.goto(base + '/s/checkout-audit/essentials');
  await customer.locator('#hero-quantity').fill('3');
  await customer.locator('[data-direct-checkout]').first().click();
  await customer.waitForURL(/checkout\//);
  assert.equal(await customer.evaluate(() => commera2AnalyticsConsent()), false);
  assert.ok(await customer.locator('[name="deviceId"]').inputValue());
  assert.match(await customer.locator('#summary-product-price').textContent(), /1,500/);
  assert.equal(await customer.evaluate(() => JSON.parse(document.querySelector('#cod-builder-settings').textContent).animation), 'fade');

  let firstLookup;
  const lookupStarted = new Promise(resolve => { firstLookup = resolve; });
  await customer.route('**/pincodes/110001', async route => {
    firstLookup();
    await new Promise(resolve => setTimeout(resolve, 450));
    await route.fulfill({ json: { pincode: '110001', ...locations['110001'], serviceable: true } }).catch(() => {});
  });
  await customer.locator('[name="pincode"]').fill('110001');
  await lookupStarted;
  await customer.locator('[name="pincode"]').fill('380015');
  await customer.waitForFunction(() => document.querySelector('[name="city"]').value === 'Ahmedabad');
  await customer.waitForFunction(() => document.querySelector('#pincode-status').dataset.state === 'success');
  await customer.locator('[name="phone"]').fill('9876543210');
  await customer.locator('[name="address"]').fill('12 Green Park Road');
  let activeSaves = 0, peakSaves = 0, firstSave, held = false;
  const saveStarted = new Promise(resolve => { firstSave = resolve; });
  await customer.route('**/api/public/checkouts/*', async route => {
    if (route.request().method() !== 'PATCH') return route.continue();
    activeSaves++; peakSaves = Math.max(peakSaves, activeSaves);
    if (route.request().postDataJSON().name === 'Earlier Name' && !held) {
      held = true; firstSave(); await new Promise(resolve => setTimeout(resolve, 800));
    }
    const response = await route.fetch();
    activeSaves--; await route.fulfill({ response });
  });
  await customer.locator('[name="name"]').fill('Earlier Name');
  await saveStarted;
  await customer.locator('[name="name"]').fill('Latest Name');
  await customer.waitForFunction(() => typeof lastSaved !== 'undefined' && lastSaved?.name === 'Latest Name');
  assert.equal(peakSaves, 1, 'Autosaves overlap');
  assert.equal(await customer.locator('[name="city"]').inputValue(), 'Ahmedabad', 'Old lookup overwrote current address');
  const checkoutId = await customer.evaluate(() => SESSION_ID);
  let orderRequests = 0;
  await customer.route('**/api/public/checkouts/*/order', async route => {
    orderRequests++;
    if (orderRequests === 1) {
      await new Promise(resolve => setTimeout(resolve, 300));
      return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Temporarily unavailable</h1>' });
    }
    if (orderRequests === 2) {
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      return route.fulfill({ status: 503, contentType: 'text/html', body: '<h1>Confirmation response lost</h1>' });
    }
    await route.continue();
  });
  await customer.evaluate(() => {
    const form = document.querySelector('#cod-form');
    for (let i = 0; i < 3; i++) form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await customer.getByRole('button', { name: 'Placing order...' }).waitFor();
  assert.equal(await customer.locator('#cod-form').getAttribute('aria-busy'), 'true');
  await customer.getByText('Could not confirm order. Please try again.', { exact: true }).waitFor();
  assert.equal(orderRequests, 1);
  assert.equal(await customer.locator('.place-order-button').isEnabled(), true);
  assert.equal(await customer.locator('[name="name"]').inputValue(), 'Latest Name');
  assert.equal(await customer.locator('[name="name"]').evaluate(node => node.inert), false);
  for (const width of [1440, 768, 390, 320]) {
    await customer.setViewportSize({ width, height: 900 });
    await customer.evaluate(() => scrollTo(0, 0));
    assert.ok(await customer.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Checkout overflow at ${width}`);
    await customer.screenshot({ path: `${output}/checkout-${width}.png`, fullPage: true });
  }
  await customer.getByRole('button', { name: 'Place COD Order', exact: true }).click();
  await customer.getByText('Could not confirm order. Please try again.', { exact: true }).waitFor();
  assert.equal(app.service.listOrders(store.id).length, 1);
  await customer.getByRole('button', { name: 'Place COD Order', exact: true }).click();
  await customer.waitForURL(/thank-you/);
  assert.equal(orderRequests, 2);
  assert.equal(app.service.listOrders(store.id).length, 1);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock, 22);
  const order = app.service.listOrders(store.id)[0];
  assert.equal(order.totalPaise, 150000);
  assert.equal(db.prepare('SELECT name FROM checkout_sessions WHERE id=?').get(checkoutId).name, 'Latest Name');
  assert.deepEqual(errors, []);
  console.log('PASS: motion save/reload/preview/off/reduced-motion; blocked storage; quantity subtotal; out-of-order pincode; serialized autosave; duplicate submit; non-JSON failure and retry; one order and correct stock; 320/390/768/1440 layouts.');
} finally { await browser.close(); await app.stop(); }
