import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { saveShippingRate,saveShippingWeights,quoteShipping,listShippingRates,migrateShippingRules } from '../src/shipping-rules.js';

function setup(t){
  const db=createDatabase(':memory:'),service=new CommerceService(db);t.after(()=>db.close());
  const store=service.createStore({name:'Shipping test',slug:'shipping-test'}),product=service.createProduct(store.id,{name:'Oil',slug:'oil',pricePaise:50000,stock:20});
  const extra=service.createProduct(store.id,{name:'Comb',slug:'comb',pricePaise:10000,stock:20});
  const page=service.createProductPage(store.id,{productId:product.id,title:'Oil',slug:'oil',body:'Oil'});service.publishPage(store.id,page.id);
  const input={pageId:page.id,productId:product.id,quantity:1,name:'Test Person',phone:'9876543210',address:'12 Green Park Road',city:'Delhi',state:'Delhi',country:'India',pincode:'110001',termsAccepted:true};
  return {db,service,store,product,extra,input};
}

test('price, weight, address and product restrictions all apply including exact boundaries',t=>{
  const {db,store,product,extra}=setup(t);
  const rate=saveShippingRate(db,store.id,null,{name:'Express',chargePaise:5000,rules:{minOrderPaise:50000,maxOrderPaise:100000,minWeightGrams:200,maxWeightGrams:500,states:['Delhi'],countries:['India'],includeProducts:[product.id,extra.id]}});
  const quote=(subtotal=50000,state='Delhi',country='India',items=[{productId:product.id,quantity:1}])=>quoteShipping(db,store.id,subtotal,state,rate.id,country,items);
  assert.equal(quote().shippingUnavailable,true,'unknown weights cannot qualify');
  saveShippingWeights(db,store.id,[{productId:product.id,grams:200},{productId:extra.id,grams:100}]);
  saveShippingRate(db,store.id,rate.id,{chargePaise:5000});
  assert.equal(listShippingRates(db,store.id).rates[0].rules.minWeightGrams,200,'price-only edits preserve restrictions');
  assert.equal(quote().shippingPaise,5000);assert.equal(quote(100000).shippingUnavailable,false);
  for(const value of [49999,100001])assert.equal(quote(value).shippingUnavailable,true);
  assert.equal(quote(50000,'Delhi','USA').shippingUnavailable,true);assert.equal(quote(50000,'Gujarat').shippingUnavailable,true);
  assert.equal(quote(50000,' delhi ','india').shippingUnavailable,false);
  assert.equal(quote(50000,'Delhi','India',[{productId:product.id,quantity:2},{productId:extra.id,quantity:1}]).shippingUnavailable,false);
  assert.equal(quote(50000,'Delhi','India',[{productId:product.id,quantity:3}]).shippingUnavailable,true);
  saveShippingRate(db,store.id,rate.id,{rules:{excludeProducts:[extra.id]}});
  assert.equal(quote(50000,'Delhi','India',[{productId:product.id,quantity:1},{productId:extra.id,quantity:1}]).shippingUnavailable,true);
});

test('checkout exposes eligible methods, charges selected rate and rechecks changes before ordering',t=>{
  const {db,service,store,input}=setup(t);
  const standard=saveShippingRate(db,store.id,null,{name:'Standard',chargePaise:2000}),express=saveShippingRate(db,store.id,null,{name:'Express',chargePaise:5000});
  let draft=service.saveCheckoutDraft(store.id,{...input,shippingMethodId:express.id});
  assert.equal(draft.shippingMethods.length,2);assert.equal(draft.totalPaise,55000);
  saveShippingRate(db,store.id,express.id,{chargePaise:6000});
  assert.throws(()=>service.placeCodOrder(store.id,{sessionId:draft.id}),/Shipping rates changed/);
  draft=service.saveCheckoutDraft(store.id,{...input,sessionId:draft.id,shippingMethodId:standard.id});
  const order=service.placeCodOrder(store.id,{sessionId:draft.id});assert.equal(order.totalPaise,52000);assert.equal(order.shippingMethodId,standard.id);
});

test('no matching or all-disabled rates preserve the draft but block order placement',t=>{
  const {db,service,store,input}=setup(t);
  const rate=saveShippingRate(db,store.id,null,{name:'Local only',chargePaise:0,rules:{states:['Gujarat']}});
  let draft=service.saveCheckoutDraft(store.id,input);assert.equal(draft.shippingUnavailable,true);
  assert.throws(()=>service.placeCodOrder(store.id,{sessionId:draft.id}),/Delivery is not available/);
  saveShippingRate(db,store.id,rate.id,{enabled:false,rules:{}});
  draft=service.saveCheckoutDraft(store.id,{...input,sessionId:draft.id});assert.equal(draft.shippingUnavailable,true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n,0);
  assert.equal(service.getCheckout(store.id,draft.id).status,'draft');
});

test('rules and weights reject invalid values and foreign products without partial writes',t=>{
  const {db,service,store,product}=setup(t),other=service.createStore({name:'Other',slug:'other'}),foreign=service.createProduct(other.id,{name:'Foreign',slug:'foreign',pricePaise:100,stock:1});
  for(const rules of [{minWeightGrams:501,maxWeightGrams:500},{minOrderPaise:-1},{includeProducts:[foreign.id]},{includeProducts:[product.id],excludeProducts:[product.id]}])assert.throws(()=>saveShippingRate(db,store.id,null,{name:'Bad',chargePaise:0,rules}));
  assert.equal(listShippingRates(db,store.id).rates.length,0);
  assert.throws(()=>saveShippingWeights(db,store.id,[{productId:product.id,grams:200},{productId:foreign.id,grams:20}]));
  assert.equal(listShippingRates(db,store.id).weights.length,0);
  saveShippingWeights(db,store.id,[{productId:product.id,grams:0}]);assert.equal(listShippingRates(db,store.id).weights[0].grams,0);
  migrateShippingRules(db);assert.equal(listShippingRates(db,store.id).weights[0].grams,0);
});
