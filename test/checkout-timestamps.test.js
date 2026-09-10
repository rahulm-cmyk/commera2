import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { OtpService } from '../src/otp-service.js';

const pgTime = milliseconds => new Date(milliseconds).toISOString().replace('T', ' ').replace('Z', '+00');
const buyer = { name: 'Riya Sharma', phone: '9876543210', address: '12 Green Park Main Road', city: 'Delhi', state: 'Delhi', country: 'India', pincode: '110001', termsAccepted: true };
const settings = { enabled: true, provider: 'test', length: 6, expiryMinutes: 5, resendDelaySeconds: 30, maxAttempts: 5, maxResends: 3 };

function fixture(t) {
  const db = createDatabase(':memory:');
  t.after(() => db.close());
  const service = new CommerceService(db);
  const store = service.createStore({ name: 'Timestamp fixture', slug: 'timestamp-fixture' });
  const product = service.createProduct(store.id, { name: 'Test product', slug: 'test-product', pricePaise: 10000, stock: 10 });
  const page = service.createProductPage(store.id, { productId: product.id, title: 'Test product', slug: 'test-product', body: 'Fixture' });
  service.publishPage(store.id, page.id);
  const checkout = service.saveCheckoutDraft(store.id, { pageId: page.id, productId: product.id, quantity: 1, ...buyer });
  const setTime = value => db.prepare('UPDATE checkout_sessions SET updated_at=? WHERE id=?').run(value, checkout.id);
  return { db, service, store, product, checkout, setTime };
}

test('Fresh PostgreSQL checkout timestamps allow draft updates and order submission', t => {
  const { service, store, checkout, setTime } = fixture(t);
  setTime(pgTime(Date.now()));
  assert.doesNotThrow(() => service.saveCheckoutDraft(store.id, { sessionId: checkout.id, name: buyer.name }));
  setTime(pgTime(Date.now()));
  assert.ok(service.placeCodOrder(store.id, { sessionId: checkout.id }).id);
  assert.throws(() => service.placeCodOrder(store.id, { sessionId: checkout.id }), /already submitted/);
});

test('Fresh PostgreSQL checkout timestamps allow OTP send and verification', async t => {
  const { db, store, checkout, setTime } = fixture(t);
  let code;
  const otp = new OtpService(db, { providers: { test: { async send({ otp }) { code = otp; return { delivered: true }; } } } });
  const input = { checkoutSessionId: checkout.id, phone: buyer.phone };
  setTime(pgTime(Date.now()));
  assert.equal((await otp.send(store.id, input, settings)).status, 'OTP_SENT');
  setTime(pgTime(Date.now()));
  assert.equal((await otp.verify(store.id, { ...input, otp: code }, settings)).status, 'VERIFIED');
});

test('Expired and malformed timestamps still reject draft updates, orders and OTP', async t => {
  const { db, service, store, checkout, setTime } = fixture(t);
  let sends = 0;
  const otp = new OtpService(db, { providers: { test: { async send() { sends++; return { delivered: true }; } } } });
  for (const timestamp of [pgTime(Date.now() - 121 * 60_000), 'invalid', '']) {
    setTime(timestamp);
    assert.throws(() => service.saveCheckoutDraft(store.id, { sessionId: checkout.id }), /session has expired/);
    assert.throws(() => service.placeCodOrder(store.id, { sessionId: checkout.id }), /session has expired/);
    await assert.rejects(otp.send(store.id, { checkoutSessionId: checkout.id, phone: buyer.phone }, settings), /session has expired/);
  }
  assert.equal(sends, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 0);
});
