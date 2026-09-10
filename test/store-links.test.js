import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { renderOnlineStore } from '../public/online-store.js';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('const activeStoreDomain ='), source.indexOf('const ratingStars ='));
const esc = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

async function render(domains, { live = true, tab = 'themes' } = {}) {
  const data = { store: { slug: 'test-store', name: 'Test Store' },
    domainOverview: { customDomains: domains }, storefrontPublication: { live }, pages: [] };
  const context = vm.createContext({ data });
  vm.runInContext(helpers + ';globalThis.storeUrl = storeUrl;', context);
  const root = { innerHTML: '', querySelectorAll: () => [] };
  const previousLocation = globalThis.location;
  globalThis.location = { pathname: '/online-store/' + tab };
  try {
    await renderOnlineStore({ root, data, storeId: 7, route: { onlineTab: tab, path: globalThis.location.pathname }, esc,
      storeUrl: context.storeUrl, api: async () => [{title:'About',status:'published',liveSlug:'about',id:1}] });
  } finally {
    if (previousLocation === undefined) delete globalThis.location;
    else globalThis.location = previousLocation;
  }
  return { html: root.innerHTML, storeUrl: context.storeUrl };
}

test('live store links select the active primary domain while draft preview stays private', async () => {
  const { html, storeUrl } = await render([
    { overallStatus: 'ACTIVE', openUrl: 'https://secondary.example/' },
    { overallStatus: 'ACTIVE', primaryDomain: true, openUrl: 'https://shop.example/' },
  ]);
  assert.equal(storeUrl(), 'https://shop.example');
  assert.equal(storeUrl('products/test'), 'https://shop.example/products/test');
  assert.match(html, /href="https:\/\/shop.example"[^>]*>View your store/);
  assert.match(html, /href="https:\/\/shop.example"[^>]*>View live store/);
  assert.match(html, /href="\/api\/stores\/7\/storefront\/preview"[^>]*>Preview saved draft/);
  assert.doesNotMatch(html, /href="\/s\/test-store"/);
  assert.match(source, /renderOnlineStore\(\{root:content,route,data,storeId,api,esc,storeUrl,/);
});

test('pending and disconnected domains never replace the built-in live link', async () => {
  for (const overallStatus of ['PENDING', 'VERIFYING_DOMAIN', 'DISCONNECTED']) {
    const { html } = await render([{ overallStatus, primaryDomain: true, openUrl: 'https://pending.example' }]);
    assert.match(html, /href="\/s\/test-store"[^>]*>View live store/);
    assert.doesNotMatch(html, /pending.example/);
  }
});

test('an unpublished store offers only an explicitly labelled saved draft preview', async () => {
  const { html } = await render([{overallStatus:'ACTIVE',openUrl:'https://shop.example'}], {live:false});
  assert.doesNotMatch(html, />View (?:your|live) store/);
  assert.match(html, />Preview saved draft/);
});

test('published content-page links use the same custom domain', async () => {
  const { html } = await render([{status:'active',openUrl:'https://shop.example/'}], {tab:'pages'});
  assert.match(html, /href="https:\/\/shop.example\/pages\/about"/);
});
