import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { createApp } from '../src/server.js';

function setup(){
  const db=createDatabase(':memory:'),service=new CommerceService(db);
  const store=service.createStore({name:'Nivkara',slug:'nivkara'});
  const product=service.createProduct(store.id,{name:'Hair Oil',slug:'hair-oil',pricePaise:79900,stock:20});
  const page=service.createProductPage(store.id,{productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'});service.publishPage(store.id,page.id);
  return{db,service,store,product,page};
}
function draft(ctx,overrides={}){return ctx.service.saveCheckoutDraft(ctx.store.id,{pageId:ctx.page.id,productId:ctx.product.id,quantity:1,paymentMethod:'cod',name:'Riya Sharma',phone:'9876543210',address:'12 Satellite Main Road',city:'Ahmedabad',state:'Gujarat',country:'India',pincode:'380015',termsAccepted:true,...overrides});}

test('final COD validation trims names, accepts two letters, and rejects numeric/fake customer data',()=>{
  let ctx=setup(),checkout=draft(ctx,{name:'   Om   ',phone:'9876543210'}),order=ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id});
  assert.ok(order.id);assert.equal(ctx.service.listCustomers(ctx.store.id)[0].name,'Om');

  ctx=setup();checkout=draft(ctx,{name:'12'});assert.throws(()=>ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}),/valid customer name/i);
  ctx=setup();checkout=draft(ctx,{phone:'9999999999'});assert.throws(()=>ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}),/fake mobile number/i);
});

test('final COD validation rejects meaningless addresses and inactive products',()=>{
  for(const address of ['test','abc','123']){const ctx=setup(),checkout=draft(ctx,{address});assert.throws(()=>ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}),/enter your delivery address/i);}
  const ctx=setup(),checkout=draft(ctx);ctx.db.prepare('UPDATE products SET active=0 WHERE store_id=? AND id=?').run(ctx.store.id,ctx.product.id);assert.throws(()=>ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}),/product is not active/i);
});

test('locality and landmark addresses do not require a house number', t => {
  const ctx=setup();
  t.after(()=>ctx.db.close());
  const checkout=draft(ctx,{address:'siratram nagar naer bas ,stabd'});
  assert.ok(ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}).id);
});

test('recent duplicate protection checks same phone or same address for the same product',()=>{
  let ctx=setup();ctx.service.placeCodOrder(ctx.store.id,{sessionId:draft(ctx).id});let checkout=draft(ctx,{address:'88 Different Delivery Road'});assert.throws(()=>ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}),/duplicate order/i);
  ctx=setup();ctx.service.placeCodOrder(ctx.store.id,{sessionId:draft(ctx).id});checkout=draft(ctx,{phone:'9123456789'});assert.throws(()=>ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}),/duplicate order/i);
});

test('black-order protection can match a blocked delivery identity without exposing controls in dashboard',()=>{
  const ctx=setup();ctx.service.blockCodPhone(ctx.store.id,{phone:'9000000001',address:'12 Satellite Main Road',name:'Riya Sharma',reason:'Confirmed black order'});
  const checkout=draft(ctx,{phone:'9123456789'});
  assert.throws(()=>ctx.service.placeCodOrder(ctx.store.id,{sessionId:checkout.id}),/blocked for COD orders/i);
});

test('dedicated COD checkout performs browser validation before requesting order creation',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});await app.start();t.after(()=>app.stop());const base=`http://127.0.0.1:${app.port}`;
  let r=await fetch(base+'/api/stores',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Nivkara',slug:'nivkara'})}),store=await r.json();r=await fetch(base+`/api/stores/${store.id}/products`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Hair Oil',slug:'hair-oil',pricePaise:79900,stock:5})});const product=await r.json();r=await fetch(base+`/api/stores/${store.id}/pages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'})});const page=await r.json();await fetch(base+`/api/stores/${store.id}/pages/${page.id}/publish`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});r=await fetch(base+'/api/public/nivkara/ritual/checkouts',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({intent:'open',quantity:1})});const opened=await r.json();const html=await(await fetch(base+`/s/nivkara/checkout/${opened.id}`)).text();
  assert.match(html,/name="name"[^>]*minlength="2"/);
  assert.match(html,/name="phone"[^>]*pattern="\[6-9\]/);
  assert.match(html,/name="address"[^>]*minlength="10"/);
  assert.ok(html.indexOf('form.reportValidity()')<html.indexOf("await save('submit')"));
});
