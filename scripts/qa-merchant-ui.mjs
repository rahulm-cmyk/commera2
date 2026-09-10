import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createDatabase } from '../src/database.js';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const base = 'http://127.0.0.1:4188';
const errors = [], results = [];
try {
  for (const width of [1440, 1024, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 950 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => errors.push(error.message));
    for (const route of ['overview', 'products', 'orders', 'online-store/themes', 'settings/domain', 'product-pages', 'reviews', 'customers', 'settings/cod-form']) {
      await page.goto(`${base}/${route}`);
      await page.locator('#store-select option').first().waitFor({state:'attached'});
      await page.waitForFunction(() => !document.querySelector('#content')?.hasAttribute('aria-busy') && document.querySelector('#content')?.textContent.trim().length > 30);
      await page.locator('#workspace-store-name').filter({hasText:'Northline'}).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
        errors: [...document.querySelectorAll('.load-error, #content > [role=alert]')].map(el => el.textContent),
        images: [...document.querySelectorAll('img')].filter(el => el.getClientRects().length && el.complete && !el.naturalWidth).map(el => el.src),
        searchHidden: !document.querySelector('#workspace-search').open,
      }));
      assert.equal(state.overflow, false, `Horizontal overflow on ${route} at ${width}`);
      assert.deepEqual(state.errors, [], `${route} render errors`);
      assert.deepEqual(state.images, [], `${route} broken icons`);
      assert.equal(state.searchHidden, true);
      await page.screenshot({path:`qa-ui-${route.replaceAll('/','-')}-${width}.png`,fullPage:true});
      results.push({width,route,ok:true});
    }
    await page.goto(`${base}/overview`);
    await page.getByRole('button',{name:'Find a page',exact:true}).click();
    await page.getByRole('searchbox',{name:'Search workspace pages'}).fill('products');
    await page.getByRole('searchbox',{name:'Search workspace pages'}).press('Enter');
    await page.waitForURL('**/products');
    const search = page.getByRole('searchbox',{name:'Search products',exact:true});
    await search.fill('not-existing');
    await page.getByText('No matching products. Try a different name.').waitFor();
    await search.fill('Everyday');
    await page.locator('.product-name-action:visible').first().click();
    await page.locator('#product-editor').waitFor();
    await page.getByRole('button',{name:width === 1440 ? 'Save Product' : 'Cancel',exact:true}).click();
    await page.waitForURL('**/products');
    await page.goto(`${base}/orders`);
    await page.getByRole('searchbox',{name:/Search orders/i}).waitFor({state:'visible'});
    if (width < 1024) {
      await page.getByRole('button',{name:'Open navigation',exact:true}).click();
      await page.locator('#app-sidebar').getByRole('button',{name:'Home',exact:true}).click();
      await page.waitForURL('**/overview');
      assert.equal(await page.locator('#mobile-menu').getAttribute('aria-expanded'),'false');
    }
    await page.close();
  }
  // Security screens use a real local test session, not the no-login demo server.
  const authApp = createApp({db:createDatabase(':memory:'),port:0,merchantAuth:true,domainSyncIntervalMs:0,googleAuthProvider:null,accountEmailProvider:null});
  authApp.service.createStore({name:'Account preview',slug:'account-preview'});
  await authApp.start('127.0.0.1');
  try {
    const context = await browser.newContext({reducedMotion:'reduce'});
    const origin = `http://127.0.0.1:${authApp.port}`;
    const registered = await context.request.post(origin+'/api/auth/register',{data:{displayName:'UI Test Owner',email:'ui-test@example.com',password:'LocalPreviewTest123'}});
    assert.equal(registered.status(),201);
    const page = await context.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    for (const width of [1440,390,320]) {
      await page.setViewportSize({width,height:950});
      await page.goto(origin+'/account');
      await page.locator('#content form').first().waitFor();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1),false);
      await page.screenshot({path:`qa-ui-account-${width}.png`,fullPage:true});
      results.push({width,route:'account',ok:true});
    }
    await context.clearCookies();
    await page.goto(origin+'/overview');
    await page.locator('#auth-form').waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth+1),false);
    await page.screenshot({path:'qa-ui-login-320.png',fullPage:true});
    await context.close();
  } finally { await authApp.stop(); }
  assert.deepEqual(errors, [], 'Browser JavaScript errors');
  console.log(JSON.stringify({results,errors},null,2));
} finally { await browser.close(); }
