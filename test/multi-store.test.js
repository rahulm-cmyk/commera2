import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';

test('one account can create and list multiple stores', () => {
  const service=new CommerceService(createDatabase(':memory:'));
  service.createStore({name:'Nivkara India',slug:'nivkara-india'});
  service.createStore({name:'Nivkara UAE',slug:'nivkara-uae'});
  service.createStore({name:'Nivkara UK',slug:'nivkara-uk'});
  assert.deepEqual(service.listStores().map(store=>store.name),['Nivkara India','Nivkara UAE','Nivkara UK']);
});

test('store creation generates a unique public URL from the store name', () => {
  const service = new CommerceService(createDatabase(':memory:'));
  const first = service.createStore({ name: 'Udapbet' });
  const second = service.createStore({ name: 'Udapbet' });
  assert.equal(first.slug, 'udapbet');
  assert.equal(second.slug, 'udapbet-2');
});

test('switching stores returns only that store’s complete commerce data', () => {
  const service=new CommerceService(createDatabase(':memory:'));
  const india=service.createStore({name:'India Store',slug:'india'});
  const uae=service.createStore({name:'UAE Store',slug:'uae'});
  const indiaProduct=service.createProduct(india.id,{name:'India Hair Oil',slug:'oil',pricePaise:99900,stock:10});
  const uaeProduct=service.createProduct(uae.id,{name:'UAE Hair Oil',slug:'oil',pricePaise:129900,stock:20});
  const indiaPage=service.createProductPage(india.id,{productId:indiaProduct.id,title:'India Ritual',slug:'ritual',body:'India page'});
  const uaePage=service.createProductPage(uae.id,{productId:uaeProduct.id,title:'UAE Ritual',slug:'ritual',body:'UAE page'});
  service.publishPage(india.id,indiaPage.id); service.publishPage(uae.id,uaePage.id);
  const draft=service.saveCheckoutDraft(india.id,{pageId:indiaPage.id,productId:indiaProduct.id,quantity:1,name:'Meera',phone:'9876543210',address:'12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true});
  service.placeCodOrder(india.id,{sessionId:draft.id});

  assert.deepEqual(service.listProducts(india.id).map(p=>p.name),['India Hair Oil']);
  assert.deepEqual(service.listProducts(uae.id).map(p=>p.name),['UAE Hair Oil']);
  assert.deepEqual(service.listPages(india.id).map(p=>p.title),['India Ritual']);
  assert.deepEqual(service.listPages(uae.id).map(p=>p.title),['UAE Ritual']);
  assert.equal(service.listOrders(india.id).length,1);
  assert.equal(service.listOrders(uae.id).length,0);
  assert.equal(service.listCustomers(india.id).length,1);
  assert.equal(service.listCustomers(uae.id).length,0);
  assert.equal(service.getStoreMetrics(india.id).totalSalesPaise,99900);
  assert.deepEqual(service.getStoreMetrics(uae.id),{totalSalesPaise:0,orders:0,conversionRate:0});
  assert.equal(service.getProduct(india.id,indiaProduct.id).stock,9);
  assert.equal(service.getProduct(uae.id,uaeProduct.id).stock,20);
});

test('cross-store identifiers cannot be used to read or mutate another store', () => {
  const service=new CommerceService(createDatabase(':memory:'));
  const first=service.createStore({name:'First',slug:'first'}), second=service.createStore({name:'Second',slug:'second'});
  const product=service.createProduct(first.id,{name:'Private Product',slug:'private',pricePaise:10000,stock:2});
  const page=service.createProductPage(first.id,{productId:product.id,title:'Private Page',slug:'private',body:'Private'});
  assert.throws(()=>service.getProduct(second.id,product.id),/not found/i);
  assert.throws(()=>service.getPage(second.id,page.id),/not found/i);
  assert.throws(()=>service.publishPage(second.id,page.id),/not found/i);
});
