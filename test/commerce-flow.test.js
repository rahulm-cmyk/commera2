import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { ProductOperationsService } from '../src/product-operations-service.js';

function setup() {
  const db = createDatabase(':memory:');
  return { db, service: new CommerceService(db) };
}

test('complete product-to-COD-order flow persists connected business changes', () => {
  const { service } = setup();
  const store = service.createStore({ name: 'Nivkara', slug: 'nivkara' });
  const product = service.createProduct(store.id, {
    name: '19-Herb Bhringraj Hair Oil', slug: 'hair-oil', pricePaise: 99900, stock: 10
  });
  const page = service.createProductPage(store.id, {
    productId: product.id, title: 'Stronger Hair Ritual', slug: 'ritual', body: 'A bedtime hair-care ritual.'
  });
  service.publishPage(store.id, page.id);

  const draft = service.saveCheckoutDraft(store.id, {
    pageId: page.id, productId: product.id, quantity: 2, name: 'Meera'
  });
  service.saveCheckoutDraft(store.id, { sessionId: draft.id, phone: '9876543210' });
  const updatedDraft = service.saveCheckoutDraft(store.id, {
    sessionId: draft.id, address: '12 MG Road, Bengaluru, Karnataka 560001',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true
  });
  assert.equal(updatedDraft.status, 'draft');
  assert.equal(updatedDraft.phone, '9876543210');

  const order = service.placeCodOrder(store.id, { sessionId: draft.id });
  assert.equal(order.totalPaise, 199800);
  assert.equal(order.paymentStatus, 'pending');
  assert.equal(order.channel, 'product_page');
  assert.equal(service.getProduct(store.id, product.id).stock, 8);
  assert.equal(service.getCheckout(store.id, draft.id).status, 'completed');

  const customers = service.listCustomers(store.id);
  assert.equal(customers.length, 1);
  assert.equal(customers[0].phone, '9876543210');
  assert.equal(service.listOrders(store.id).length, 1);
  assert.deepEqual(service.getStoreMetrics(store.id), {
    totalSalesPaise: 199800, orders: 1, conversionRate: 100
  });
});

test('store isolation prevents cross-store reads and writes', () => {
  const { service } = setup();
  const a = service.createStore({ name: 'Store A', slug: 'store-a' });
  const b = service.createStore({ name: 'Store B', slug: 'store-b' });
  const product = service.createProduct(a.id, { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 4 });

  assert.equal(service.listProducts(a.id).length, 1);
  assert.equal(service.listProducts(b.id).length, 0);
  assert.throws(() => service.getProduct(b.id, product.id), /not found/i);
});

test('invalid COD submission does not create an order', () => {
  const { service } = setup();
  const store = service.createStore({ name: 'Nivkara', slug: 'nivkara' });
  const product = service.createProduct(store.id, { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 1 });
  const page = service.createProductPage(store.id, { productId: product.id, title: 'Oil', slug: 'oil', body: 'Oil' });
  const draft = service.saveCheckoutDraft(store.id, { pageId: page.id, productId: product.id, quantity: 1, name: 'Meera', phone: '123',address:'12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true });

  assert.throws(() => service.placeCodOrder(store.id, { sessionId: draft.id }), /valid.*Indian mobile/i);
  assert.equal(service.listOrders(store.id).length, 0);
  assert.equal(service.getProduct(store.id, product.id).stock, 1);
});

test('gift card credit reduces the COD amount and is debited with the order', () => {
  const { db, service } = setup();
  const operations = new ProductOperationsService(db);
  const store = service.createStore({ name: 'Nivkara', slug: 'nivkara' });
  const product = service.createProduct(store.id, { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 2 });
  const page = service.createProductPage(store.id, { productId: product.id, title: 'Oil', slug: 'oil', body: 'Oil' });
  const card = operations.issueGiftCard(store.id, { code: 'WELCOME500', initialBalancePaise: 20000 });
  const draft = service.saveCheckoutDraft(store.id, {
    pageId: page.id, productId: product.id, quantity: 1, giftCardCode: card.code,
    name: 'Meera', phone: '9876543210', address: '12 MG Road Bengaluru', city: 'Bengaluru',
    state: 'Karnataka', pincode: '560001', termsAccepted: true,
  });

  assert.equal(service.getCheckout(store.id, draft.id).giftCardAppliedPaise, 20000);
  assert.equal(service.getCheckout(store.id, draft.id).totalPaise, 30000);
  const order = service.placeCodOrder(store.id, { sessionId: draft.id });
  assert.equal(order.giftCardCode, 'WELCOME500');
  assert.equal(order.giftCardAppliedPaise, 20000);
  assert.equal(order.totalPaise, 30000);
  assert.equal(operations.listGiftCards(store.id)[0].balancePaise, 0);
});

test('insufficient inventory rejects order atomically', () => {
  const { service } = setup();
  const store = service.createStore({ name: 'Nivkara', slug: 'nivkara' });
  const product = service.createProduct(store.id, { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 1 });
  const page = service.createProductPage(store.id, { productId: product.id, title: 'Oil', slug: 'oil', body: 'Oil' });
  const draft = service.saveCheckoutDraft(store.id, {
    pageId: page.id, productId: product.id, quantity: 2, name: 'Meera', phone: '9876543210', address: 'Bengaluru 560001',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true
  });

  assert.throws(() => service.placeCodOrder(store.id, { sessionId: draft.id }), /stock/i);
  assert.equal(service.listOrders(store.id).length, 0);
  assert.equal(service.getCheckout(store.id, draft.id).status, 'draft');
});

test('only published pages can be loaded publicly', () => {
  const { service } = setup();
  const store = service.createStore({ name: 'Nivkara', slug: 'nivkara' });
  const product = service.createProduct(store.id, { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 2 });
  const page = service.createProductPage(store.id, { productId: product.id, title: 'Oil', slug: 'oil', body: 'Oil' });

  assert.throws(() => service.getPublishedPage('nivkara', 'oil'), /not found/i);
  service.publishPage(store.id, page.id);
  const published = service.getPublishedPage('nivkara', 'oil');
  assert.equal(published.product.name, 'Oil');
  assert.equal(published.page.status, 'published');
});
