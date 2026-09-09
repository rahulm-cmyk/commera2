import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { ProductOperationsService } from '../src/product-operations-service.js';

function setup(stock=10) {
  const db=createDatabase(':memory:'); const commerce=new CommerceService(db);
  const store=commerce.createStore({name:'Nivkara',slug:'nivkara'});
  const product=commerce.createProduct(store.id,{name:'Hair Oil',slug:'hair-oil',pricePaise:99900,stock});
  const operations=new ProductOperationsService(db);
  operations.initializeProduct(store.id,product.id,stock);
  return {db,commerce,operations,store,product};
}

test('collections persist real product membership and store isolation', () => {
  const {commerce,operations,store,product}=setup();
  const collection=operations.createCollection(store.id,{name:'Hair Care',slug:'hair-care'});
  operations.addProductToCollection(store.id,collection.id,product.id);
  assert.deepEqual(operations.listCollections(store.id)[0].products.map(p=>p.name),['Hair Oil']);
  operations.removeProductFromCollection(store.id,collection.id,product.id);
  assert.equal(operations.listCollections(store.id)[0].products.length,0);

  const second=commerce.createStore({name:'Second',slug:'second'});
  assert.throws(()=>operations.addProductToCollection(second.id,collection.id,product.id),/not found/i);
});

test('receiving a purchase order increases actual inventory once', () => {
  const {commerce,operations,store,product}=setup(5);
  const po=operations.createPurchaseOrder(store.id,{vendor:'Herbal Supplier',items:[{productId:product.id,quantity:12,unitCostPaise:40000}]});
  assert.equal(po.status,'ordered');
  assert.equal(commerce.getProduct(store.id,product.id).stock,5);

  const received=operations.receivePurchaseOrder(store.id,po.id);
  assert.equal(received.status,'received');
  assert.equal(commerce.getProduct(store.id,product.id).stock,17);
  assert.equal(operations.listInventory(store.id)[0].quantity,17);
  assert.throws(()=>operations.receivePurchaseOrder(store.id,po.id),/already received/i);
  assert.equal(commerce.getProduct(store.id,product.id).stock,17);
});

test('transfer moves location inventory without changing total stock', () => {
  const {commerce,operations,store,product}=setup(10);
  const locations=operations.listLocations(store.id);
  const source=locations.find(l=>l.isDefault===1);
  const destination=operations.createLocation(store.id,{name:'Delhi Warehouse'});
  const transfer=operations.createTransfer(store.id,{sourceLocationId:source.id,destinationLocationId:destination.id,items:[{productId:product.id,quantity:3}]});
  assert.equal(transfer.status,'in_transit');
  assert.equal(operations.getLocationStock(store.id,source.id,product.id),7);
  assert.equal(operations.getLocationStock(store.id,destination.id,product.id),0);

  operations.receiveTransfer(store.id,transfer.id);
  assert.equal(operations.getLocationStock(store.id,destination.id,product.id),3);
  assert.equal(commerce.getProduct(store.id,product.id).stock,10);
  assert.throws(()=>operations.receiveTransfer(store.id,transfer.id),/already received/i);
});

test('inventory history records opening, purchase order, and transfer movements', () => {
  const {operations,store,product}=setup(2);
  const source=operations.listLocations(store.id)[0];
  const destination=operations.createLocation(store.id,{name:'Mumbai Warehouse'});
  const po=operations.createPurchaseOrder(store.id,{vendor:'Vendor',items:[{productId:product.id,quantity:5,unitCostPaise:20000}]});
  operations.receivePurchaseOrder(store.id,po.id);
  const transfer=operations.createTransfer(store.id,{sourceLocationId:source.id,destinationLocationId:destination.id,items:[{productId:product.id,quantity:1}]});
  operations.receiveTransfer(store.id,transfer.id);
  const reasons=operations.listInventoryMovements(store.id).map(m=>m.reason);
  assert.ok(reasons.includes('opening_stock'));
  assert.ok(reasons.includes('purchase_order_received'));
  assert.ok(reasons.includes('transfer_sent'));
  assert.ok(reasons.includes('transfer_received'));
});

test('COD orders reduce both aggregate and primary-location inventory', () => {
  const {commerce,operations,store,product}=setup(6);
  const page=commerce.createProductPage(store.id,{productId:product.id,title:'Oil',slug:'oil',body:'Oil'});
  const draft=commerce.saveCheckoutDraft(store.id,{pageId:page.id,productId:product.id,quantity:2,name:'Meera',phone:'9876543210',address:'12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true});
  commerce.placeCodOrder(store.id,{sessionId:draft.id});
  assert.equal(commerce.getProduct(store.id,product.id).stock,4);
  assert.equal(operations.listInventory(store.id)[0].quantity,4);
  assert.equal(operations.listInventoryMovements(store.id)[0].reason,'order_placed');
});

test('gift cards can be issued and disabled with persistent balances', () => {
  const {operations,store}=setup();
  const card=operations.issueGiftCard(store.id,{code:'NIVKARA1000',initialBalancePaise:100000,note:'Customer recovery'});
  assert.equal(card.status,'active');
  assert.equal(card.balancePaise,100000);
  operations.disableGiftCard(store.id,card.id);
  assert.equal(operations.listGiftCards(store.id)[0].status,'disabled');
  assert.throws(()=>operations.issueGiftCard(store.id,{code:'NIVKARA1000',initialBalancePaise:100000}),/already exists/i);
});
