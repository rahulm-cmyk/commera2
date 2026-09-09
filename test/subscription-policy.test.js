import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { PolicyService } from '../src/policy-service.js';
import { migrateSubscriptionPolicy } from '../src/policy-migrations.js';

test('six default policy types stay separate from existing contact information', () => {
  const db = createDatabase(':memory:');
  try {
    const app = createApp({db, port:0});
    const store = app.service.createStore({name:'Policy Test',slug:'policy-test'}), policies = new PolicyService(db);
    policies.saveWritten(store.id,'return-refund',{title:'Existing custom return terms',content:'<p>Existing content</p>'});
    policies.saveWritten(store.id,'contact',{contact:{storeName:'Policy Test',supportEmail:'test@example.com'}});
    const defaults = policies.listWritten(store.id);
    assert.deepEqual(defaults.map(p=>p.label),['Return Policy','Privacy Policy','Terms of Service','Shipping Policy','Legal Notice','Subscription Policy']);
    assert.equal(defaults[0].title,'Existing custom return terms');
    assert.equal(defaults[5].status,'no_policy');
    assert.equal(policies.getWritten(store.id,'contact').contact.supportEmail,'test@example.com');
    assert.equal(policies.listPublished(store.id).length,0);
  } finally { db.close(); }
});

test('subscription policy preview, publish, storefront link and unpublish work without auto-publishing', async t => {
  const db=createDatabase(':memory:'), app=createApp({db,port:0});
  await app.start();t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  const store=app.service.createStore({name:'Subscription Test',slug:'subscription-test'});
  const product=app.service.createProduct(store.id,{name:'Test Product',slug:'test-product',pricePaise:10000,stock:10});
  const page=app.service.createProductPage(store.id,{productId:product.id,title:'Test Page',slug:'test-page',body:'Test'});
  app.service.publishPage(store.id,page.id);
  const path=`/api/stores/${store.id}/policies/written/subscription`, publicPath='/s/subscription-test/policies/subscription';
  let response=await fetch(base+path,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({content:'<p>Subscription fixture content.</p><script>bad()</script>'})});
  assert.equal(response.status,200);assert.equal((await response.json()).status,'draft');
  assert.equal((await fetch(base+publicPath)).status,404);
  const preview=await (await fetch(base+path+'/preview')).text();
  assert.match(preview,/Subscription Policy/);assert.doesNotMatch(preview,/<script>bad/);
  response=await fetch(base+path+'/publish',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal(response.status,200);
  assert.match(await (await fetch(base+publicPath)).text(),/Subscription fixture content/);
  assert.match(await (await fetch(base+'/s/subscription-test/test-page')).text(),/href="\/s\/subscription-test\/policies\/subscription"/);
  await fetch(base+path+'/unpublish',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  assert.equal((await fetch(base+publicPath)).status,404);
});

test('legacy SQLite policy migration preserves rows and indexes and is repeatable', () => {
  const db=new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE stores(id INTEGER PRIMARY KEY);
      INSERT INTO stores VALUES(1);
      CREATE TABLE store_policies(id INTEGER PRIMARY KEY,store_id INTEGER REFERENCES stores(id),policy_type TEXT CHECK(policy_type IN ('return-refund','privacy','terms','shipping','contact','legal')),content_html TEXT,status TEXT,UNIQUE(store_id,policy_type));
      CREATE INDEX idx_store_policies_store ON store_policies(store_id,status,policy_type);
      INSERT INTO store_policies VALUES(4,1,'contact','Existing contact data','published');`);
    const before=db.prepare('SELECT * FROM store_policies').all();
    migrateSubscriptionPolicy(db);migrateSubscriptionPolicy(db);
    assert.deepEqual(db.prepare('SELECT * FROM store_policies').all(),before);
    assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='idx_store_policies_store'").get());
    db.prepare('INSERT INTO store_policies VALUES(?,?,?,?,?)').run(5,1,'subscription','Test subscription','draft');
    assert.equal(db.prepare("SELECT status FROM store_policies WHERE policy_type='subscription'").get().status,'draft');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  } finally {db.close();}
});
