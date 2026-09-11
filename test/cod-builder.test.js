import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { SettingsService } from '../src/settings-service.js';
import { customCheckoutValues, renderCodBuilder } from '../src/cod-builder.js';

function setup(t) {
  const db=createDatabase(':memory:'),app=createApp({db,port:0,domainSyncIntervalMs:0}),service=app.service,settings=new SettingsService(db);
  t.after(()=>db.close());
  const store=service.createStore({name:'Builder test',slug:'builder-test'});
  const product=service.createProduct(store.id,{name:'Main product',slug:'main',pricePaise:50000,stock:20});
  const extra=service.createProduct(store.id,{name:'Gift box',slug:'gift',pricePaise:10000,stock:5});
  const page=service.createProductPage(store.id,{productId:product.id,title:'Main product',slug:'main',body:'A product'});
  service.publishPage(store.id,page.id);
  const input={pageId:page.id,productId:product.id,quantity:1,name:'Test Person',phone:'9876543210',address:'12 Green Park Road',city:'Delhi',state:'Delhi',country:'India',pincode:'110001',termsAccepted:true};
  return {db,service,store,product,extra,page,input,settings};
}

test('custom checkout fields validate, persist and cannot inject script markup',t=>{
  const {db,service,store,input,settings}=setup(t);
  settings.update(store.id,'codForm',{customFields:[{id:'slot',label:'Delivery slot',type:'select',options:['Morning','Evening'],required:true},{id:'note',label:'Gift note',type:'text'}]});
  const draft=service.saveCheckoutDraft(store.id,input);
  assert.throws(()=>service.placeCodOrder(store.id,{sessionId:draft.id}),/Delivery slot is required/);
  assert.throws(()=>service.saveCheckoutDraft(store.id,{...input,sessionId:draft.id,custom_slot:'Tomorrow'}),/Choose a valid/);
  const saved=service.saveCheckoutDraft(store.id,{...input,sessionId:draft.id,custom_slot:'Morning',custom_note:'</script><script>alert(1)</script>',intent:'submit'});
  assert.equal(saved.customFields.slot,'Morning');
  assert.equal(customCheckoutValues(db,store.id,draft.id).note,'</script><script>alert(1)</script>');
  const html=renderCodBuilder(settings.get(store.id).codForm,saved);
  assert.doesNotMatch(html,/<\/script><script>alert/);assert.match(html,/\\u003c\/script>/);
  const order=service.placeCodOrder(store.id,{sessionId:draft.id});assert.equal(service.getOrderDetails(store.id,order.id).items.length,1);
});

test('optional extras use merchant prices, create all items and reserve stock atomically',t=>{
  const {db,service,store,input,settings,extra}=setup(t);
  settings.update(store.id,'codForm',{addons:[{productId:extra.id,title:'Add a gift box',pricePaise:2500}]});
  const draft=service.saveCheckoutDraft(store.id,{...input,addonsSubmitted:true,[`addon_${extra.id}`]:true,pricePaise:1});
  assert.equal(draft.totalPaise,52500);
  assert.equal(draft.subtotalPaise,52500);
  const placed=service.placeCodOrder(store.id,{sessionId:draft.id}),order=service.getOrderDetails(store.id,placed.id);
  assert.equal(order.totalPaise,52500);assert.equal(order.items.length,2);
  assert.equal(order.items.find(i=>i.productId===extra.id).unitPricePaise,2500);
  assert.equal(service.getProduct(store.id,extra.id).stock,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders WHERE store_id=?').get(store.id).n,1);
});

test('unavailable extras can be removed; direct order attempts still reject them',t=>{
  const {db,service,store,input,settings,extra}=setup(t);
  settings.update(store.id,'codForm',{addons:[{productId:extra.id,title:'Gift box',pricePaise:2500}]});
  const draft=service.saveCheckoutDraft(store.id,{...input,addonsSubmitted:true,[`addon_${extra.id}`]:'on'});
  db.prepare('UPDATE products SET stock=0 WHERE id=?').run(extra.id);
  assert.doesNotThrow(()=>service.getCheckout(store.id,draft.id));
  assert.throws(()=>service.placeCodOrder(store.id,{sessionId:draft.id}),/unavailable/);
  const removed=service.saveCheckoutDraft(store.id,{...input,sessionId:draft.id,addonsSubmitted:true});
  assert.equal(removed.addons.length,0);assert.equal(removed.totalPaise,50000);
  const order=service.placeCodOrder(store.id,{sessionId:draft.id});assert.equal(service.getOrderDetails(store.id,order.id).items.length,1);
});

test('extras reject cross-store products and cannot oversell the main product',t=>{
  const {db,service,store,product,input,settings}=setup(t);
  const other=service.createStore({name:'Other',slug:'other'}),foreign=service.createProduct(other.id,{name:'Foreign',slug:'foreign',pricePaise:100,stock:10});
  assert.throws(()=>settings.update(store.id,'codForm',{addons:[{productId:foreign.id,title:'Other',pricePaise:1}]}),/from this store/);
  assert.throws(()=>service.saveCheckoutDraft(store.id,{...input,addonsSubmitted:true,[`addon_${foreign.id}`]:true}),/unavailable/);
  settings.update(store.id,'codForm',{addons:[{productId:product.id,title:'Second one',pricePaise:10000}]});
  db.prepare('UPDATE products SET stock=1 WHERE id=?').run(product.id);
  const draft=service.saveCheckoutDraft(store.id,{...input,addonsSubmitted:true,[`addon_${product.id}`]:true});
  assert.throws(()=>service.placeCodOrder(store.id,{sessionId:draft.id}),/stock/);
  assert.equal(service.getProduct(store.id,product.id).stock,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders WHERE store_id=?').get(store.id).n,0);
});

test('builder configuration rejects invalid appearance, duplicate fields and malformed choices',t=>{
  const {store,settings}=setup(t);
  for(const patch of [{displayMode:'bad'},{style:{button:'red;display:none'}},{style:{radius:-1}},{fieldOrder:['phone']},{customFields:[{id:'x',label:'X',type:'select',options:[]}]}]) assert.throws(()=>settings.update(store.id,'codForm',patch));
  assert.equal(settings.get(store.id).codForm.otp.enabled,false);
});

test('post-purchase offers advance on accept or decline, retry safely and stop at five',t=>{
  const {db,service,store,product,input,settings}=setup(t);
  settings.update(store.id,'codForm',{postPurchaseLimit:5});
  for(let i=1;i<=6;i++)service.createUpsell(store.id,{productId:product.id,upsellProductId:product.id,triggerType:'any_product',allowExistingProduct:true,name:`Offer ${i}`,headline:`Offer ${i}`,pricePaise:1000,quantity:1,status:'active'});
  const draft=service.saveCheckoutDraft(store.id,input),order=service.placeCodOrder(store.id,{sessionId:draft.id});
  let offer=order.postPurchaseUpsell;
  for(let i=0;i<5;i++) {
    assert.ok(offer);
    const action=i%2===0?'acceptOrderUpsell':'rejectOrderUpsell';
    const result=service[action](store.slug,draft.id,offer.id,offer.token);
    const retry=service[action](store.slug,draft.id,offer.id,offer.token);
    assert.deepEqual(retry.nextOffer,result.nextOffer);
    if(result.nextOffer) assert.doesNotThrow(()=>service.getPublicOrderUpsell(store.slug,draft.id,result.nextOffer.id,result.nextOffer.token));
    offer=result.nextOffer;
  }
  assert.equal(offer,null);assert.equal(db.prepare('SELECT COUNT(*) n FROM order_upsell_events WHERE order_id=?').get(order.id).n,5);
  assert.equal(service.getOrder(store.id,order.id).totalPaise,53000);
  assert.equal(service.getOrderDetails(store.id,order.id).items.length,4);
});

test('optional extras count toward the free-shipping minimum',t=>{
  const {db,service,store,input,settings,extra}=setup(t);
  db.prepare('INSERT INTO shipping_methods(store_id,name,charge_paise,enabled) VALUES(?,?,?,1)').run(store.id,'Standard',5000);
  settings.update(store.id,'shipping',{freeShippingEnabled:true,freeShippingMinimumPaise:52000});
  settings.update(store.id,'codForm',{addons:[{productId:extra.id,title:'Gift box',pricePaise:2500}]});
  const draft=service.saveCheckoutDraft(store.id,input);assert.equal(draft.shippingPaise,5000);
  const selected=service.saveCheckoutDraft(store.id,{...input,sessionId:draft.id,addonsSubmitted:true,[`addon_${extra.id}`]:true});assert.equal(selected.shippingPaise,0);assert.equal(selected.totalPaise,52500);
});
