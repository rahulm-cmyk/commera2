import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { applyStorePackage, validateStorePackage } from '../public/store-package.js';
const png = { name: 'test.png', type: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' };
const pack = { format: 'commera-store-package', version: 1, name: 'Botanical store', primaryProductSlug: 'oil', branding: { logo: png }, home: { bannerHeading: 'Botanical store', bannerImage: png, buttonText: 'Shop', headerLinks: [{ label: 'Home', url: '{{store}}' }], customSections: [{ id: 'section-story-one', type: 'rich-text', heading: 'Our story', buttonText: 'Shop', buttonUrl: '{{store}}/products/oil', visible: true }] }, products: [{ name: 'Oil', slug: 'oil', pricePaise: 49900, stock: null, description: 'Hair oil.', mainImage: png }, { name: 'Shampoo', slug: 'shampoo', pricePaise: 69900, stock: 0, description: 'Hair shampoo.', mainImage: png }, { name: 'Serum', slug: 'serum', pricePaise: 159900, stock: 0, description: 'Hair serum.', mainImage: png }], bundles: [{ name: 'Two bottles', productSlug: 'oil', quantity: 2, pricePaise: 79900 }], upsells: [{ name: 'Add shampoo', title: 'Add shampoo', productSlug: 'oil', offerProductSlug: 'shampoo', pricePaise: 69900, status: 'draft' }], downsells: [{ title: 'Try oil', productSlug: 'serum', offerProductSlug: 'oil', pricePaise: 49900 }] };

test('store package validates product references and requires a backup before any write', async () => {
  assert.throws(() => validateStorePackage({ ...pack, products: [...pack.products, pack.products[0]] }), /unique/);
  assert.throws(() => validateStorePackage({ ...pack, bundles: [{ productSlug: 'missing' }] }), /bundle/);
  let writes = 0;
  await assert.rejects(applyStorePackage(pack, {id:1}, async (path, options) => { if(options.method !== 'GET') writes++; return []; }), /backup destination/);
  assert.equal(writes, 0);
});

test('store package connects three pages, preserves inventory, keeps unavailable items sold out and retries without duplicates', async t => {
  const app = createApp({ db: createDatabase(':memory:'), port: 0, merchantAuth: false, domainSyncIntervalMs: 0, otpProviders: {}, googleAuthProvider: null, accountEmailProvider: null });
  await app.start('127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const api = async (path, options = {}) => {
    const response = await fetch(base + path, { ...options, headers: { 'content-type': 'application/json' } });
    const result = await response.json();
    if (!response.ok) throw Error(`${path}: ${result.error}`);
    return result;
  };
  const store = await api('/api/stores', { method: 'POST', body: JSON.stringify({name:'Original',slug:'original'}) });
  const root = `/api/stores/${store.id}`;
  await api(root+'/products', {method:'POST',body:JSON.stringify({name:'Oil',slug:'oil',pricePaise:45000,stock:10})});
  await api(root+'/products', {method:'POST',body:JSON.stringify({name:'Old test',slug:'old-test',pricePaise:10000,stock:3})});
  const backups = [];
  const withExitOffer = { ...pack, exitOffers: [{ name: 'Review offer', productSlug: 'oil', status: 'draft', discountType: 'fixed', discountValue: 19900 }] };
  for (let i=0; i<2; i++) await applyStorePackage(withExitOffer, store, api, { backup: data => backups.push(data), hideOtherProducts: true });
  assert.equal(backups.length,2);
  assert.equal(backups[0].storefront.store.name,'Original');
  const products = await api(root+'/products');
  assert.equal(products.length,4);
  assert.equal(products.find(p=>p.slug==='old-test').active,0);
  assert.equal(products.find(p=>p.slug==='oil').stock,10);
  assert.equal(products.find(p=>p.slug==='shampoo').stock,0);
  assert.equal((await api(root+'/pages')).length,3);
  assert.equal((await api(root+'/bundles')).length,1);
  assert.equal((await api(root+'/upsells')).length,1);
  assert.equal((await api(root+'/downsells')).length,1);
  const exitOffers = await api(root+'/exit-offers');
  assert.equal(exitOffers.length,1);
  assert.equal(exitOffers[0].status,'draft');
  assert.equal(exitOffers[0].targetType,'specific_product');
  await api(root+'/storefront/home/publish',{method:'POST',body:'{}'});
  const home = await (await fetch(base+'/s/original')).text();
  assert.equal((home.match(/class="featured-product-card"/g)||[]).length,3);
  assert.match(home,/href="\/s\/original\/products\/oil"/);
  assert.doesNotMatch(home,/\{\{store\}\}/);
  const soldOut = await (await fetch(base+'/s/original/products/shampoo')).text();
  assert.match(soldOut,/<button type="button" class="hero-cta" disabled>Sold out<\/button>/);
  assert.doesNotMatch(soldOut,/<a[^>]+data-direct-checkout=/);
});
