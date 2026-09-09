import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase} from '../src/database.js';
import {CommerceService} from '../src/commerce-service.js';
import {backfillLegacyOrderSubtotals} from '../src/order-migrations.js';

function setup(){
  const db=createDatabase(':memory:'),service=new CommerceService(db),store=service.createStore({name:'Audit',slug:'audit'});
  const product=service.createProduct(store.id,{name:'Product',slug:'product',pricePaise:10000,stock:10});
  service.createProductPage(store.id,{productId:product.id,title:'Page',slug:'page',body:'Test'});
  const input={customerName:'Audit Buyer',customerPhone:'9876543210',items:[{productId:product.id,quantity:1}]};
  return{db,service,store,product,input};
}
test('manual drafts reject fractional quantities and invalid money without creating records',()=>{
  const {db,service,store,input}=setup();
  for(const bad of [{...input,items:[{...input.items[0],quantity:1.5}]},{...input,discountPaise:10001},{...input,shippingPaise:Infinity},{...input,discountPaise:-1}]){
    assert.throws(()=>service.createDraftOrder(store.id,bad),/whole number|discount|shipping/i);
  }
  assert.equal(db.prepare('SELECT COUNT(*) count FROM draft_orders').get().count,0);
});
test('manual conversion cannot sell a product deactivated after the draft was saved',()=>{
  const {db,service,store,product,input}=setup(),draft=service.createDraftOrder(store.id,input);
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(product.id);
  assert.throws(()=>service.convertDraftOrder(store.id,draft.id),/not active/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders').get().count,0);
  assert.equal(service.getProduct(store.id,product.id).stock,10);
});
test('legacy subtotal repair is evidence-based and leaves charged totals and stock unchanged',()=>{
  const {db,service,store,product,input}=setup();
  const draft=service.createDraftOrder(store.id,input),order=service.convertDraftOrder(store.id,draft.id);
  db.prepare('UPDATE orders SET subtotal_paise=0 WHERE id=?').run(order.id);
  backfillLegacyOrderSubtotals(db);backfillLegacyOrderSubtotals(db);
  assert.equal(db.prepare('SELECT subtotal_paise FROM orders WHERE id=?').get(order.id).subtotal_paise,10000);
  assert.equal(service.getOrder(store.id,order.id).totalPaise,10000);
  assert.equal(service.getProduct(store.id,product.id).stock,9);
  db.prepare('UPDATE orders SET subtotal_paise=0,total_paise=9999 WHERE id=?').run(order.id);
  backfillLegacyOrderSubtotals(db);
  assert.equal(db.prepare('SELECT subtotal_paise FROM orders WHERE id=?').get(order.id).subtotal_paise,0);
});
