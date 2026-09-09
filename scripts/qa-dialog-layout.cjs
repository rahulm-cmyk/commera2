const { chromium } = require(process.env.QA_PLAYWRIGHT_PATH || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('http://127.0.0.1:4188/');
      await page.locator('#store-select option').first().waitFor({ state: 'attached' }).catch(() => {});
      for (const view of ['newStore', 'domainsView']) {
        if (width < 1024 && await page.locator('#mobile-menu').getAttribute('aria-expanded') !== 'true') await page.locator('#mobile-menu').click();
        if (view === 'newStore') await page.locator('#new-store').click();
        else {
          await page.locator('[data-view="settings"]').click();
          await page.locator('[data-settings-tab="domain"]').click();
          const address = await page.locator('.domain-summary').innerText();
          assert.ok(!address.includes('127.0.0.1'));
          assert.ok(!address.includes('Store address'));
          assert.ok(!address.includes('shops.commera2.app'));
          await page.locator('#add-domain').click();
        }
        const dialog = page.locator('dialog[open]');
        await dialog.waitFor();
        const dimensions = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
        console.log(JSON.stringify({ viewport: width, view, ...dimensions }));
        assert.ok(dimensions.scroll <= dimensions.width + 1, `${view} overflows at ${width}`);
        await dialog.screenshot({ path: `qa-${view}-${width}.png` });
        if (view === 'domainsView') {
          await dialog.locator('[name="domainName"]').fill(`qa-${width}.example.com`);
          await dialog.getByRole('button', { name: 'Continue', exact: true }).click();
          await dialog.getByRole('heading', { name: 'Configure DNS', exact: true }).waitFor();
          const dnsLayout = await dialog.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth,
            records: [...el.querySelectorAll('.domain-dns-record')].map(record => ({ width: record.clientWidth, scroll: record.scrollWidth })) }));
          assert.ok(dnsLayout.scroll <= dnsLayout.width + 1);
          assert.ok(dnsLayout.records.length >= 2);
          assert.ok(dnsLayout.records.every(record => record.scroll <= record.width + 1));
          await dialog.screenshot({ path: `qa-dns-${width}.png` });
          await dialog.getByRole('button', { name: 'Finish Later', exact: true }).scrollIntoViewIfNeeded();
          console.log(JSON.stringify({ viewport: width, dnsLayout }));
        }
        await dialog.locator('.close').click();
        await assert.doesNotReject(() => page.waitForFunction(() => !document.querySelector('dialog[open]')));
      }
      const views = await page.locator('#app-sidebar [data-view]').evaluateAll(els => els.map(el => el.dataset.view));
      for (const view of views) {
        if (width < 1024 && await page.locator('#mobile-menu').getAttribute('aria-expanded') !== 'true') await page.locator('#mobile-menu').click();
        await page.locator(`#app-sidebar [data-view="${view}"]`).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        console.log(JSON.stringify({ viewport: width, screen: view, overflow }));
        assert.ok(overflow <= 1, `${view} page overflows at ${width}`);
      }
      const tabs = await page.locator('[data-settings-tab]').evaluateAll(els => els.map(el => el.dataset.settingsTab));
      for (const tab of tabs) {
        await page.locator(`[data-settings-tab="${tab}"]`).click();
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        assert.ok(overflow <= 1, `${tab} settings overflows at ${width}`);
      }
      console.log(JSON.stringify({ viewport: width, settingsTabsChecked: tabs.length }));
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
