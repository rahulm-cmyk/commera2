import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';
import { createDatabase } from '../src/database.js';
import { SettingsService } from '../src/settings-service.js';

test('concurrent and completed order retries return the existing receipt without stock or customer changes', async t => {
  const db = createDatabase(':memory:');
  const app = createApp({ db, port: 0, merchantAuth: false, domainSyncIntervalMs: 0, googleAuthProvider: null, otpProviders: {},
    pincodeOptions: { lookup:async()=>({city:'Ahmedabad',state:'Gujarat',country:'India'}) },
  });
  await app.start(); t.after(() => app.stop());
  const store = app.service.createStore({name:'Recovery',slug:'recovery'});
  const other = app.service.createStore({name:'Other',slug:'other'});
  new SettingsService(db).update(store.id,'codForm',{protection:{botTraffic:false}});
  const product = app.service.createProduct(store.id,{name:'Product',slug:'product',pricePaise:50000,stock:10});
  const page = app.service.createProductPage(store.id,{productId:product.id,title:'Product',slug:'product',body:'Product'});
  app.service.publishPage(store.id,page.id);
  const checkout = app.service.saveCheckoutDraft(store.id,{pageId:page.id,productId:product.id,name:'Test Person',phone:'9876543210',address:'12 Green Park Road',pincode:'380015',city:'Ahmedabad',state:'Gujarat',country:'India',quantity:1,termsAccepted:true});
  const base = `http://127.0.0.1:${app.port}/api/public/checkouts/${checkout.id}`;
  const call = async (path, method='POST', data={storeId:store.id}) => {
    const response = await fetch(base+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(data)});
    return {status:response.status,body:await response.json()};
  };
  const results = await Promise.all([call('/order'),call('/order')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);
  const receipt = `/s/recovery/thank-you/${checkout.id}`;
  assert.ok(results.every(r=>r.body.thankYouUrl === receipt));
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(product.id);
  assert.equal((await call('/order')).body.nextUrl,receipt);
  const patch = await call('','PATCH',{storeId:store.id,name:'Changed Name'});
  assert.equal(patch.status,409); assert.equal(patch.body.completed,true); assert.equal(patch.body.nextUrl,receipt);
  assert.equal(db.prepare('SELECT name FROM checkout_sessions WHERE id=?').get(checkout.id).name,'Test Person');
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(product.id).stock,9);
  assert.equal(app.service.listOrders(store.id).length,1);
  assert.equal((await call('/order','POST',{storeId:other.id})).status,404);
  assert.equal((await call('','PATCH',{storeId:other.id,name:'Wrong Store'})).status,404);
});
