import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { createApp } from '../src/server.js';

const customer={name:'Meera Sharma',phone:'9876543210',address:'12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true};

function setup() {
  const service=new CommerceService(createDatabase(':memory:'));
  const store=service.createStore({name:'Nivkara',slug:'nivkara'});
  const product=service.createProduct(store.id,{name:'Hair Oil 200 ml',slug:'hair-oil-200',pricePaise:79900,stock:10});
  const alternative=service.createProduct(store.id,{name:'Hair Oil 100 ml',slug:'hair-oil-100',pricePaise:49900,stock:7});
  const page=service.createProductPage(store.id,{productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'});
  service.publishPage(store.id,page.id);
  return {service,store,product,alternative,page};
}

async function request(base,path,method='GET',data) {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const type=response.headers.get('content-type')||'';
  return {response,body:type.includes('json')?await response.json():await response.text()};
}

test('selected COD downsell replaces the main item, total, and inventory deduction',()=>{
  const {service,store,product,alternative,page}=setup();
  const downsell=service.createDownsell(store.id,{productId:product.id,downsellProductId:alternative.id,title:'Prefer a smaller starter size?',pricePaise:44900});
  const draft=service.saveCheckoutDraft(store.id,{pageId:page.id,productId:product.id,downsellId:downsell.id,...customer});

  assert.equal(draft.downsellId,downsell.id);
  assert.equal(draft.totalPaise,44900);
  const order=service.placeCodOrder(store.id,{sessionId:draft.id});
  const listed=service.listOrders(store.id)[0];
  assert.equal(order.totalPaise,44900);
  assert.equal(listed.itemCount,1);
  assert.match(listed.itemSummary,/Hair Oil 100 ml/);
  assert.equal(service.getProduct(store.id,product.id).stock,10);
  assert.equal(service.getProduct(store.id,alternative.id).stock,6);
});

test('merchant API and storefront expose a selectable COD downsell',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});
  await app.start();
  t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  let result=await request(base,'/api/stores','POST',{name:'Nivkara',slug:'nivkara'});const store=result.body;
  result=await request(base,`/api/stores/${store.id}/products`,'POST',{name:'Hair Oil 200 ml',slug:'oil-200',pricePaise:79900,stock:10});const product=result.body;
  result=await request(base,`/api/stores/${store.id}/products`,'POST',{name:'Hair Oil 100 ml',slug:'oil-100',pricePaise:49900,stock:7});const alternative=result.body;
  result=await request(base,`/api/stores/${store.id}/pages`,'POST',{productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'});const page=result.body;
  result=await request(base,`/api/stores/${store.id}/downsells`,'POST',{productId:product.id,downsellProductId:alternative.id,title:'Prefer a smaller starter size?',pricePaise:44900});
  assert.equal(result.response.status,201);const downsell=result.body;

  result=await request(base,`/api/stores/${store.id}/dashboard`);
  assert.equal(result.body.downsells[0].title,'Prefer a smaller starter size?');
  result=await request(base,'/app.js');
  assert.match(result.body,/COD Downsells/);
  assert.match(result.body,/Create downsell/);

  await request(base,`/api/stores/${store.id}/pages/${page.id}/publish`,'POST',{});
  result=await request(base,'/s/nivkara/ritual');
  assert.doesNotMatch(result.body,/name="downsellId"/);
  result=await request(base,'/api/public/nivkara/ritual/checkouts','POST',{intent:'open',quantity:1});
  assert.equal(result.response.status,201);
  result=await request(base,`/s/nivkara/checkout/${result.body.id}`);
  assert.match(result.body,/Prefer a smaller starter size\?/);
  assert.match(result.body,new RegExp(`name="downsellId" value="${downsell.id}"`));
  assert.match(result.body,/₹449/);
});
