import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { createApp } from '../src/server.js';

function setup() {
  const service=new CommerceService(createDatabase(':memory:'));
  const store=service.createStore({name:'Nivkara',slug:'nivkara'});
  const product=service.createProduct(store.id,{name:'Hair Oil',slug:'hair-oil',pricePaise:79900,stock:10});
  const page=service.createProductPage(store.id,{productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'});
  service.publishPage(store.id,page.id);
  return{service,store,product,page};
}

async function request(base,path,method='GET',data) {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const type=response.headers.get('content-type')||'';
  return{response,body:type.includes('json')?await response.json():await response.text()};
}

test('checkout and order persist COD as the initial payment method',()=>{
  const {service,store,product,page}=setup();
  const draft=service.saveCheckoutDraft(store.id,{
    pageId:page.id,
    productId:product.id,
    quantity:1,
    paymentMethod:'cod',
    name:'Meera Sharma',
    phone:'9876543210',
    address:'12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true
  });
  assert.equal(draft.paymentMethod,'cod');

  const order=service.placeCodOrder(store.id,{sessionId:draft.id});
  assert.equal(order.paymentMethod,'cod');
  assert.equal(order.paymentStatus,'pending');
});

test('unsupported payment methods are rejected until a future update enables them',()=>{
  const {service,store,product,page}=setup();
  assert.throws(()=>service.saveCheckoutDraft(store.id,{
    pageId:page.id,
    productId:product.id,
    quantity:1,
    paymentMethod:'upi'
  }),/only cash on delivery.*available/i);
});

test('public checkout clearly presents COD and future-payment messaging',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});
  await app.start();
  t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  let result=await request(base,'/api/stores','POST',{name:'Nivkara',slug:'nivkara'});
  const store=result.body;
  result=await request(base,`/api/stores/${store.id}/products`,'POST',{name:'Hair Oil',slug:'hair-oil',pricePaise:79900,stock:10});
  const product=result.body;
  result=await request(base,`/api/stores/${store.id}/pages`,'POST',{productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'});
  const page=result.body;
  await request(base,`/api/stores/${store.id}/pages/${page.id}/publish`,'POST',{});

  result=await request(base,'/api/public/nivkara/ritual/checkouts','POST',{intent:'open',quantity:1});
  assert.equal(result.response.status,201);
  result=await request(base,`/s/nivkara/checkout/${result.body.id}`);
  assert.match(result.body,/Cash on Delivery \(COD\)/);
  assert.match(result.body,/Pay when your order reaches you/);
  assert.match(result.body,/name="paymentMethod" value="cod"/);
});
