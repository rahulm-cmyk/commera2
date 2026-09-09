import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { createApp } from '../src/server.js';

async function request(base,path,method='GET',data) {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const type=response.headers.get('content-type')||'';
  return{response,body:type.includes('json')?await response.json():await response.text()};
}

function setupProduct() {
  const service = new CommerceService(createDatabase(':memory:'));
  const store = service.createStore({ name: 'Nivkara', slug: 'nivkara' });
  const product = service.createProduct(store.id, {
    name: 'Hair Oil', slug: 'hair-oil', pricePaise: 99900, stock: 20
  });
  const page = service.createProductPage(store.id, {
    productId: product.id, title: 'Hair Oil Ritual', slug: 'ritual', body: 'Daily ritual'
  });
  service.publishPage(store.id, page.id);
  return { service, store, product, page };
}

test('merchant product bundle controls checkout quantity and price', () => {
  const { service, store, product, page } = setupProduct();
  const bundle = service.createBundle(store.id, {
    productId: product.id,
    name: 'Pack of 3',
    quantity: 3,
    pricePaise: 249900
  });

  assert.equal(service.listBundles(store.id, product.id).length, 1);
  assert.equal(bundle.quantity, 3);
  assert.equal(bundle.pricePaise, 249900);

  const draft = service.saveCheckoutDraft(store.id, {
    pageId: page.id,
    productId: product.id,
    bundleId: bundle.id,
    name: 'Meera',
    phone: '9876543210',
    address: '12 MG Road Bengaluru', city:'Bengaluru', state:'Karnataka', pincode:'560001', termsAccepted:true
  });

  assert.equal(draft.bundleId, bundle.id);
  assert.equal(draft.quantity, 3);
  assert.equal(draft.subtotalPaise, 249900);
  assert.equal(draft.totalPaise, 249900);

  const order = service.placeCodOrder(store.id, { sessionId: draft.id });
  assert.equal(order.totalPaise, 249900);
  assert.equal(order.bundleId, bundle.id);
  assert.equal(service.getProduct(store.id, product.id).stock, 17);
});

test('discount coupon code reduces checkout total and records one use', () => {
  const { service, store, product, page } = setupProduct();
  const coupon = service.createCoupon(store.id, {
    code: 'WELCOME10',
    discountType: 'percent',
    value: 10,
    minimumOrderPaise: 100000,
    usageLimit: 1
  });

  assert.equal(coupon.code, 'WELCOME10');
  assert.equal(service.listCoupons(store.id).length, 1);

  const draft = service.saveCheckoutDraft(store.id, {
    pageId: page.id,
    productId: product.id,
    quantity: 2,
    couponCode: 'welcome10',
    name: 'Meera',
    phone: '9876543210',
    address: '12 MG Road Bengaluru', city:'Bengaluru', state:'Karnataka', pincode:'560001', termsAccepted:true
  });

  assert.equal(draft.subtotalPaise, 199800);
  assert.equal(draft.discountPaise, 19980);
  assert.equal(draft.totalPaise, 179820);
  assert.equal(draft.couponCode, 'WELCOME10');

  const order = service.placeCodOrder(store.id, { sessionId: draft.id });
  assert.equal(order.totalPaise, 179820);
  assert.equal(order.discountPaise, 19980);
  assert.equal(order.couponCode, 'WELCOME10');
  assert.equal(service.listCoupons(store.id)[0].usedCount, 1);

  assert.throws(
    () => service.saveCheckoutDraft(store.id, {
      pageId: page.id,
      productId: product.id,
      quantity: 1,
      couponCode: 'WELCOME10'
    }),
    /usage limit/i
  );
});

test('merchant APIs expose bundles and coupon codes to the live storefront checkout', async t => {
  const app=createApp({db:createDatabase(':memory:'),port:0});
  await app.start();
  t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;

  let result=await request(base,'/api/stores','POST',{name:'Nivkara',slug:'nivkara'});
  const store=result.body;
  result=await request(base,`/api/stores/${store.id}/products`,'POST',{name:'Hair Oil',slug:'hair-oil',pricePaise:99900,stock:20});
  const product=result.body;
  result=await request(base,`/api/stores/${store.id}/pages`,'POST',{productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'});
  const page=result.body;

  result=await request(base,`/api/stores/${store.id}/bundles`,'POST',{productId:product.id,name:'Pack of 3',quantity:3,pricePaise:249900});
  assert.equal(result.response.status,201);
  const bundle=result.body;
  result=await request(base,`/api/stores/${store.id}/coupons`,'POST',{code:'SAVE10',discountType:'percent',value:10});
  assert.equal(result.response.status,201);

  result=await request(base,`/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.bundles[0].name,'Pack of 3');
  assert.equal(result.body.coupons[0].code,'SAVE10');
  result=await request(base,'/app.js');
  assert.match(result.body,/Create bundle/);
  assert.match(result.body,/Create coupon code/);

  await request(base,`/api/stores/${store.id}/pages/${page.id}/publish`,'POST',{});
  result=await request(base,'/s/nivkara/ritual');
  assert.match(result.body,/Pack of 3/);
  assert.doesNotMatch(result.body,/id="cod-form"/);
  let opened=await request(base,'/api/public/nivkara/ritual/checkouts','POST',{
    intent:'open',bundleId:bundle.id
  });
  assert.equal(opened.response.status,201);
  const checkoutPage=await request(base,`/s/nivkara/checkout/${opened.body.id}`);
  assert.match(checkoutPage.body,/Coupon code/);
  assert.match(checkoutPage.body,/Pack of 3/);

  result=await request(base,'/api/public/nivkara/ritual/checkouts','POST',{
    bundleId:bundle.id,
    couponCode:'SAVE10',
    name:'Meera',
    phone:'9876543210',
    address:'12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true
  });
  assert.equal(result.response.status,201);
  assert.equal(result.body.totalPaise,224910);
  const draft=result.body;
  result=await request(base,`/api/public/checkouts/${draft.id}/order`,'POST',{storeId:store.id});
  assert.equal(result.response.status,201);
  assert.equal(result.body.totalPaise,224910);
});
