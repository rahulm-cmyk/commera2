import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { SettingsService } from '../src/settings-service.js';
import { ORDER_ANIMATIONS } from '../public/order-animation-options.js';

const { chromium } = createRequire(import.meta.url)(process.env.QA_PLAYWRIGHT_PATH || 'playwright');
const db = createDatabase(':memory:');
const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0, googleAuthProvider: null, accountEmailProvider: null, otpProviders: {},
  pincodeOptions: { lookup: async () => ({ city: 'Ahmedabad', state: 'Gujarat', country: 'India' }), serviceability: async () => true },
});
const store = app.service.createStore({ name: 'Motion Studio', slug: 'motion-studio' });
const product = app.service.createProduct(store.id, { name: 'Everyday essentials', slug: 'essentials', pricePaise: 50000, stock: 40 });
const productPage = app.service.createProductPage(store.id, { productId: product.id, title: product.name, slug: 'essentials', body: 'Everyday essentials.' });
app.service.publishPage(store.id, productPage.id);
const settings = new SettingsService(db);
settings.update(store.id, 'codForm', { protection: { botTraffic: false, duplicateOrders: false, multipleFakeOrders: false }, orderAnimation: { style: 'scooter', durationMs: 3500 } });
await app.start('127.0.0.1');
const base = `http://127.0.0.1:${app.port}`, output = 'data/order-animation-qa';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
let serial = 0;
async function checkout(style, extra = {}) {
  settings.update(store.id, 'codForm', { orderAnimation: { style, durationMs: 2000 } });
  const draft = app.service.saveCheckoutDraft(store.id, { pageId: productPage.id, productId: product.id, quantity: 1, name: 'Demo Customer', phone: `987654${String(++serial).padStart(4, '0')}`, address: '12 Green Park Road', city: 'Ahmedabad', state: 'Gujarat', country: 'India', pincode: '380015', termsAccepted: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, ...extra });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/s/motion-studio/checkout/${draft.id}`);
  await page.waitForFunction(() => document.querySelector('#pincode-status').dataset.state === 'success');
  return { page, draft };
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base + '/settings/cod-form');
  await page.getByRole('tab', { name: 'Order animation', exact: true }).click();
  assert.equal(await page.locator('.oa-option').count(), 10);
  const fingerprints = new Set();
  for (const option of ORDER_ANIMATIONS) {
    await page.locator(`[name="order-animation-style"][value="${option.id}"]`).check();
    const bytes = await page.locator('#order-animation-canvas').screenshot();
    fingerprints.add(createHash('sha256').update(bytes).digest('hex'));
    await page.getByRole('button', { name: 'Play preview', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const canvas = dialog.locator('canvas');
    const firstFrame = await canvas.screenshot();
    await page.waitForFunction(() => Number(document.querySelector('.oa-playback i')?.style.transform.match(/[\d.]+/)?.[0]) > .4);
    const nextFrame = await canvas.screenshot();
    assert.notDeepEqual(firstFrame, nextFrame, `${option.id} does not move`);
    const pixels = await canvas.evaluate(el => {
      const data = el.getContext('2d').getImageData(0, 0, el.width, el.height).data;
      let visible = 0; for (let i = 3; i < data.length; i += 4) if (data[i] > 0) visible++;
      return visible;
    });
    assert.ok(pixels > 2000, `${option.id} canvas is blank`);
    await page.screenshot({ path: `${output}/${option.id}.png` });
    await dialog.getByRole('button', { name: 'Close preview', exact: true }).click();
  }
  assert.equal(fingerprints.size, 10, 'Options reuse identical artwork');
  assert.equal(app.service.listOrders(store.id).length, 0, 'Preview created an order');
  await page.locator('[name="order-animation-style"][value="scooter"]').check();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('COD Form settings saved', { exact: true }).waitFor();
  await page.reload();
  await page.getByRole('tab', { name: 'Order animation', exact: true }).click();
  assert.equal(await page.locator('[name="order-animation-style"]:checked').inputValue(), 'scooter');
  for (const [width, height] of [[1440,1000], [768,1000], [390,844], [320,700], [667,375]]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Editor overflow ${width}`);
    await page.screenshot({ path: `${output}/editor-${width}.png`, fullPage: true, animations: 'disabled' });
    await page.getByRole('button', { name: 'Play preview', exact: true }).click();
    await page.waitForFunction(() => Number(document.querySelector('.oa-playback i')?.style.transform.match(/[\d.]+/)?.[0]) > .45);
    assert.ok(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth + 1), `Dialog overflow ${width}`);
    const box = await page.getByRole('dialog').boundingBox();
    assert.equal(Math.round(box.width), width, 'Preview is not full width');
    assert.equal(Math.round(box.height), height, 'Preview is not full height');
    await page.screenshot({ path: `${output}/preview-${width}.png` });
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.oa-playback i')?.style.transform === 'scaleX(1)');
  const still = await page.getByRole('dialog').locator('canvas').screenshot();
  await page.getByRole('button', { name: 'Replay order animation' }).click();
  assert.deepEqual(await page.getByRole('dialog').locator('canvas').screenshot(), still);
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('button', { name: 'Play preview', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelector('.oa-playback i')?.style.transform === 'scaleX(1)');
  await page.keyboard.press('Escape');
  await page.locator('[name="order-animation-style"][value="none"]').check();
  assert.equal(await page.getByRole('button', { name: 'Play preview', exact: true }).isEnabled(), false);

  const { page: customer } = await checkout('scooter');
  let attempts = 0, release;
  const gate = new Promise(resolve => { release = resolve; });
  await customer.route('**/api/public/checkouts/*/order', async route => {
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: { error: 'Please try again.' } });
    await gate; await route.continue();
  });
  await customer.getByRole('button', { name: 'Place COD Order', exact: true }).click();
  await customer.locator('#status').filter({ hasText: 'Please try again.' }).waitFor();
  assert.equal(await customer.getByRole('dialog').count(), 0, 'Failure displayed success');
  assert.equal(app.service.listOrders(store.id).length, 0);
  await customer.getByRole('button', { name: 'Place COD Order', exact: true }).click();
  await customer.getByRole('button', { name: 'Placing order...' }).waitFor();
  assert.equal(await customer.getByRole('dialog').count(), 0, 'Pending request displayed success');
  release();
  await customer.getByRole('dialog').waitFor();
  assert.equal(app.service.listOrders(store.id).length, 1);
  await customer.evaluate(() => {
    for (let n = 0; n < 3; n++) document.querySelector('#cod-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await customer.getByRole('button', { name: 'Continue', exact: true }).click();
  await customer.waitForURL(/thank-you/);
  assert.equal(attempts, 2); assert.equal(app.service.listOrders(store.id).length, 1);
  await customer.close();

  for (const mode of ['auto', 'off', 'reduced', 'module-failure', 'css-failure', 'canvas-failure']) {
    const { page: next } = await checkout(mode === 'off' ? 'none' : 'van', mode === 'reduced' ? { reducedMotion: 'reduce' } : {});
    if (mode === 'module-failure') { await next.route('**/order-animation.js', route => route.abort()); await next.reload(); }
    if (mode === 'css-failure') { await next.route('**/order-animation.css', route => route.abort()); await next.reload(); }
    if (mode === 'canvas-failure') await next.evaluate(() => { HTMLCanvasElement.prototype.getContext = () => null; });
    await next.getByRole('button', { name: 'Place COD Order', exact: true }).click();
    await next.waitForURL(/thank-you/, { timeout: 9000 });
    await next.close();
  }
  for (const displayMode of ['popup', 'embedded']) {
    settings.update(store.id, 'codForm', { displayMode, orderAnimation: { style: 'scooter', durationMs: 3500 } });
    const parent = await browser.newPage({ viewport: { width: 390, height: 844 } });
    parent.on('pageerror', error => errors.push(error.message));
    await parent.goto(base + '/s/motion-studio/essentials');
    await parent.locator('[data-direct-checkout]').first().click();
    const frame = parent.frameLocator('iframe[title="Cash on delivery checkout"]');
    await frame.locator('[name="name"]').fill('Demo Customer');
    await frame.locator('[name="phone"]').fill(`987654${String(++serial).padStart(4, '0')}`);
    await frame.locator('[name="address"]').fill('12 Green Park Road');
    await frame.locator('[name="pincode"]').fill('380015');
    await frame.locator('#pincode-status[data-state="success"]').waitFor();
    await frame.getByRole('button', { name: 'Place COD Order', exact: true }).click();
    await frame.getByRole('dialog').waitFor();
    await parent.screenshot({ path: `${output}/${displayMode}-checkout.png` });
    await frame.getByRole('button', { name: 'Continue', exact: true }).click();
    await parent.waitForURL(/thank-you/);
    await parent.close();
  }
  settings.update(store.id, 'codForm', { displayMode: 'page' });
  const upsell = app.service.createUpsell(store.id, { productId: product.id, upsellProductId: product.id, triggerType: 'any_product', allowExistingProduct: true, name: 'A second one', headline: 'Add one more', pricePaise: 35000, quantity: 1, status: 'active' });
  assert.ok(upsell.id);
  const { page: offerPage } = await checkout('gift');
  await offerPage.getByRole('button', { name: 'Place COD Order', exact: true }).click();
  await offerPage.getByRole('dialog').waitFor();
  await offerPage.keyboard.press('Escape');
  await offerPage.waitForURL(/upsell/);
  await offerPage.close();
  assert.equal(app.service.listOrders(store.id).length, 10);
  assert.equal(app.service.getProduct(store.id, product.id).stock, 30);
  assert.deepEqual(errors, []);
  console.log('PASS: 10 distinct moving nonblank scenes; previews create no orders; save/reload; five viewports; reduced motion and changes; failure/pending never report success; duplicate-submit lock; automatic and skipped navigation; disabled/missing assets/canvas fallback; popup/embedded checkout; original upsell destination; exact stock.');
} finally { await browser.close(); await app.stop(); }
