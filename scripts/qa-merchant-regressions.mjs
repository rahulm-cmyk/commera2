import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createDatabase } from '../src/database.js';
import { StorefrontService } from '../src/storefront-service.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = 'http://127.0.0.1:4188';
const errors = [];
const widths = [1440, 1280, 1024, 820, 768, 767, 390, 320];

async function checkPage(page) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    errors: [...document.querySelectorAll('.load-error, #content > [role=alert]')].filter(el => el.getClientRects().length).map(el => el.textContent),
    brokenImages: [...document.querySelectorAll('#content img')].filter(el => el.getClientRects().length && el.complete && !el.naturalWidth).map(el => el.outerHTML),
  }));
  assert.equal(layout.overflow, false, `${page.url()} page overflow`);
  assert.deepEqual(layout.errors, []);
  assert.deepEqual(layout.brokenImages, []);
}

try {
  for (const width of widths) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/orders');
    await page.locator('.order-open-detail:visible').first().waitFor();
    await checkPage(page);
    const reference = page.locator('.order-number-link:visible').first();
    const resting = await reference.boundingBox();
    await reference.hover();
    const hovered = await reference.boundingBox();
    assert.equal(hovered.width, resting.width, 'Order control changes width on hover');
    assert.equal(hovered.height, resting.height, 'Order control changes height on hover');
    assert.ok(resting.width >= 106 && resting.height <= 44, `Order control sizing at ${width}`);
    assert.equal(await reference.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
    assert.equal(await reference.locator('img').evaluate(el => el.offsetWidth), 14);
    await reference.focus();
    assert.equal(await reference.evaluate(el => getComputedStyle(el).outlineStyle), 'solid');
    assert.equal(await reference.getAttribute('aria-label'), 'Open order #000003');
    if (width >= 768) {
      const numbers = await page.locator('.order-number-link:visible').evaluateAll(elements => elements.map(el => {
        const text = el.querySelector('strong');
        const range = document.createRange();
        range.selectNodeContents(text);
        return { height: el.offsetHeight, lines: range.getClientRects().length, whiteSpace: getComputedStyle(text).whiteSpace };
      }));
      assert.ok(numbers.length > 0);
      for (const number of numbers) {
        assert.equal(number.lines, 1, `Order number wraps at ${width}`);
        assert.ok(number.height <= 44, `Order link too tall at ${width}`);
        assert.equal(number.whiteSpace, 'nowrap');
      }
      assert.ok(await page.locator('.order-items-cell').first().evaluate(el => el.offsetWidth >= 160));
      assert.ok(await page.locator('.order-customer-cell').first().evaluate(el => el.offsetWidth >= 160));
    }
    const search = page.getByRole('searchbox', { name: /Search orders/i });
    assert.equal(await search.evaluate(el => getComputedStyle(el).borderTopWidth), '0px', 'Search has two borders');
    const filterBounds = await page.locator('.order-filter-field:visible select').evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect();
      return { top: rect.top, height: rect.height, right: rect.right };
    }));
    assert.equal(filterBounds.length, width >= 768 ? 5 : 2);
    assert.ok(filterBounds.every(rect => rect.top === filterBounds[0].top && rect.height === 40 && rect.right <= width), `Filter alignment at ${width}`);
    assert.equal(await page.locator('#hide-archived').evaluate(el => el.offsetWidth), 16);
    if (width === 1440) {
      await page.locator('.columns-menu summary').click();
      await page.locator('[data-toggle-order-column]').first().waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await search.fill('no-matching-order-fixture');
      await page.getByText('No orders match these filters.', { exact: true }).waitFor();
      await page.locator('#order-search').fill('');
      await page.locator('.order-open-detail:visible').first().waitFor();
    }
    await page.screenshot({ path: `qa-ui-regression-orders-${width}.png`, fullPage: true });
    await page.locator('.order-open-detail:visible').first().click();
    await page.locator('.order-detail-grid aside').waitFor();
    await checkPage(page);
    const sidebar = await page.locator('.order-detail-grid aside').evaluate(el => ({ background: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color }));
    assert.equal(sidebar.background, 'rgba(0, 0, 0, 0)', 'Order detail inherited navigation background');
    assert.equal(sidebar.color, 'rgb(32, 43, 50)');
    await page.screenshot({ path: `qa-ui-regression-order-detail-${width}.png`, fullPage: true });

    await page.goto(base + '/online-store/themes/current/edit');
    await page.locator('.store-editor-toolbar').waitFor();
    if (width === 1440) {
      await page.getByRole('button', { name: 'Banner', exact: true }).click();
      await page.locator('[name="bannerHeading"]').fill('Unsaved connection test');
    }
    if (await page.getByRole('button', { name: 'Open store tools panel', exact: true }).isVisible()) await page.getByRole('button', { name: 'Open store tools panel', exact: true }).click();
    else await page.getByRole('tab', { name: 'Sections', exact: true }).click();
    await page.locator('[data-store-section="connections"]:visible').click();
    const row = page.locator('.store-connection-row').first();
    await row.waitFor();
    await checkPage(page);
    const geometry = await row.evaluate(el => {
      const container = document.querySelector('.store-settings-area').getBoundingClientRect();
      const bounds = el.getBoundingClientRect();
      const controls = [...el.querySelectorAll('.store-connection-actions > *')].map(button => {
        const rect = button.getBoundingClientRect();
        return { x: rect.x, right: rect.right, y: rect.y, height: rect.height, width: rect.width };
      });
      const icon = el.querySelector('.store-connection-identity img');
      return { padding: bounds.x - container.x, controls, right: bounds.right, iconContentWidth: icon.clientWidth - parseFloat(getComputedStyle(icon).paddingLeft) - parseFloat(getComputedStyle(icon).paddingRight) };
    });
    assert.ok(geometry.padding >= 18, `Connection content touches panel edge at ${width}`);
    assert.ok(geometry.iconContentWidth >= 18, 'Product icon collapsed');
    for (let index = 0; index < geometry.controls.length; index++) {
      const control = geometry.controls[index];
      assert.ok(control.height >= 38 && control.height <= 44, `Connection control wraps at ${width}`);
      assert.ok(control.right <= geometry.right + 1, `Connection control escapes at ${width}`);
      if (index) { const previous = geometry.controls[index - 1]; assert.ok(control.x >= previous.right + 4 || control.y >= previous.y + previous.height + 4, 'Connection actions overlap'); }
    }
    // Save the existing connection on fixture data; do not publish or change live data.
    if (width === 1440) {
      await row.getByRole('button', { name: 'Save page', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Product page connection saved' }).waitFor();
      await page.locator('#store-connections').waitFor({ state: 'visible' });
      assert.equal(await page.locator('[name="bannerHeading"]').inputValue(), 'Unsaved connection test', 'Saving a product connection discarded unsaved home changes');
    }
    await page.screenshot({ path: `qa-ui-regression-connections-${width}.png`, fullPage: true });
    await page.locator('[data-store-product-data]').first().click();
    if (width === 1440) await page.locator('#discard-changes').click();
    await page.locator('#product-editor').waitFor();

    if (width < 1024) await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.locator('#store-switcher-current').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#store-switcher-trigger').isVisible(), false, 'One store must not show a redundant dropdown');
    assert.equal(await page.locator('#store-switcher-current strong').textContent(), 'Northline - UI Preview');
    await page.close();
    console.log(`Orders, order details, page connections and single-store identity passed at ${width}px`);
  }

  // Multi-store selection, keyboard handling and unsaved-edit protection use an isolated DB.
  const db = createDatabase(':memory:');
  const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0, googleAuthProvider: null, accountEmailProvider: null });
  const first = app.service.createStore({ name: 'A long store name that must remain readable', slug: 'first-ui-fixture' });
  const second = app.service.createStore({ name: 'Second store <literal text>', slug: 'second-ui-fixture' });
  const product = app.service.createProduct(first.id, { name: 'Published fixture', slug: 'published-fixture', pricePaise: 10000, stock: 2 });
  const productPage = app.service.createProductPage(first.id, { productId: product.id, title: 'Published fixture', slug: 'published-fixture', body: 'Fixture' });
  app.service.publishPage(first.id, productPage.id);
  const storefront = new StorefrontService(db);
  const png = { name: 'fixture.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
  storefront.saveBranding(first.id, { logo: png });
  storefront.saveProduct(first.id, product.id, { mainImage: png, description: '<p>Fixture</p>', buttonText: 'Buy now', buttonAction: 'checkout', publish: true }, productPage.id);
  storefront.saveHome(first.id, { bannerImage: png, bannerHeading: 'Fixture', buttonText: 'Shop', buttonTarget: { type: 'product', id: product.id }, featuredProductIds: [product.id] });
  storefront.publishHome(first.id);
  await app.start('127.0.0.1');
  try {
    for (const width of widths) {
      const headerPage = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: 'reduce' });
      await headerPage.goto(`http://127.0.0.1:${app.port}/overview`);
      const link = headerPage.locator('#workspace-store-link');
      await link.waitFor({ state: 'visible' });
      assert.ok((await link.getAttribute('href')).endsWith('/s/first-ui-fixture'));
      const geometry = await link.evaluate(el => {
        const range = document.createRange();
        range.selectNode(el.firstChild);
        return { lines: range.getClientRects().length, height: el.offsetHeight, decoration: getComputedStyle(el).textDecorationLine, right: el.getBoundingClientRect().right };
      });
      assert.equal(geometry.lines, 1, `View store wraps at ${width}`);
      assert.ok(geometry.height <= 44 && geometry.right <= width);
      await link.hover();
      assert.equal(await link.evaluate(el => getComputedStyle(el).textDecorationLine), 'none');
      await checkPage(headerPage);
      await headerPage.screenshot({ path: `qa-ui-regression-published-header-${width}.png` });
      await headerPage.close();
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${app.port}/overview`);
    const trigger = page.locator('#store-switcher-trigger');
    await trigger.waitFor();
    await trigger.click();
    await page.locator('#store-switcher-options button').first().press('End');
    await page.keyboard.press('Enter');
    await page.locator('#workspace-store-name').filter({ hasText: second.name }).waitFor();
    assert.equal(await page.locator('#store-select').inputValue(), String(second.id));
    await trigger.click();
    await page.keyboard.press('Escape');
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(await trigger.evaluate(el => document.activeElement === el), true);
    await page.reload();
    await page.locator('#workspace-store-name').filter({ hasText: second.name }).waitFor();

    await page.goto(`http://127.0.0.1:${app.port}/online-store/themes/current/edit`);
    await page.getByRole('button', { name: 'Banner', exact: true }).click();
    await page.locator('[name="bannerHeading"]').fill('Unsaved draft');
    await page.getByRole('button', { name: 'Exit editor', exact: true }).click();
    await page.locator('#continue-editing').click();
    assert.equal(await page.locator('#store-select').inputValue(), String(second.id));
    assert.equal(await trigger.locator('strong').textContent(), second.name);
    assert.equal(await page.locator('[name="bannerHeading"]').inputValue(), 'Unsaved draft');
    await page.getByRole('button', { name: 'Exit editor', exact: true }).click();
    await page.locator('#discard-changes').click();
    await page.waitForURL('**/online-store/themes');
    await trigger.click();
    await page.locator('#store-switcher-options button').first().click();
    await page.locator('#workspace-store-name').filter({ hasText: first.name }).waitFor();
    await page.waitForURL('**/online-store/themes');
    assert.equal(await page.locator('#store-select').inputValue(), String(first.id));
    await trigger.click();
    await page.screenshot({ path: 'qa-ui-regression-store-switcher-1440.png', fullPage: true });
    await checkPage(page);
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 320, height: 960 });
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await trigger.click();
    await page.locator('#store-switcher-options button').last().click();
    await page.locator('#workspace-store-name').filter({ hasText: second.name }).waitFor();
    await checkPage(page);
    await page.close();
    console.log('Multi-store selection, keyboard, persistence and unsaved-draft cancellation passed');
  } finally { await app.stop(); }
  assert.deepEqual(errors, [], 'Browser errors');
} finally { await browser.close(); }
