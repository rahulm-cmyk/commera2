import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

async function call(base,path,method='GET',data){
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const type=response.headers.get('content-type')||'';
  return {response,body:type.includes('json')?await response.json():await response.text()};
}

async function setup(base){
  let result=await call(base,'/api/stores','POST',{name:'Nivkara',slug:'nivkara'});const store=result.body;
  result=await call(base,`/api/stores/${store.id}/products`,'POST',{name:'Hair Oil',slug:'hair-oil',pricePaise:79900,stock:5});const product=result.body;
  result=await call(base,`/api/stores/${store.id}/pages`,'POST',{productId:product.id,title:'Hair Ritual',slug:'ritual',body:'Daily ritual'});const page=result.body;
  await call(base,`/api/stores/${store.id}/pages/${page.id}/publish`,'POST',{});
  return {store,page};
}

const locations={
  '380015':{city:'Ahmedabad',state:'Gujarat',country:'India'},
  '380016':{city:'Ahmedabad',state:'Gujarat',country:'India'}
};

test('pincode lookup auto-fill returns authoritative Indian location and rejects unknown pincode',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0,pincodeOptions:{lookup:async pincode=>locations[pincode]||null,serviceability:async({pincode})=>pincode!=='380016'}});
  await app.start();t.after(()=>app.stop());const base=`http://127.0.0.1:${app.port}`;const {store}=await setup(base);

  let result=await call(base,`/api/public/stores/${store.id}/pincodes/380015`);
  assert.equal(result.response.status,200);
  assert.deepEqual(result.body,{pincode:'380015',city:'Ahmedabad',state:'Gujarat',country:'India',serviceable:true});

  result=await call(base,`/api/public/stores/${store.id}/pincodes/380016`);
  assert.equal(result.response.status,400);
  assert.equal(result.body.error,'Delivery is not available at this pincode');

  result=await call(base,`/api/public/stores/${store.id}/pincodes/999999`);
  assert.equal(result.response.status,400);
  assert.equal(result.body.error,'Please enter a valid pincode');
});

test('Place COD Order revalidates pincode and persists authoritative city/state/country',async t=>{
  let lookups=0;
  const app=createApp({db:createDatabase(':memory:'),port:0,pincodeOptions:{lookup:async pincode=>{lookups++;return locations[pincode]||null},serviceability:async()=>true}});
  await app.start();t.after(()=>app.stop());const base=`http://127.0.0.1:${app.port}`;const {store}=await setup(base);

  let result=await call(base,'/api/public/nivkara/ritual/checkouts','POST',{quantity:1,name:'Riya Sharma',phone:'9876543210',address:'12 Satellite Main Road',pincode:'380015',city:'Ahmedabad West',state:'Delhi',country:'Wrong',termsAccepted:true,paymentMethod:'cod',intent:'submit'});
  assert.equal(result.response.status,201);const draft=result.body;
  result=await call(base,`/api/public/checkouts/${draft.id}/order`,'POST',{storeId:store.id});
  assert.equal(result.response.status,201);
  assert.ok(lookups>=1);

  const dashboard=(await call(base,`/api/stores/${store.id}/dashboard`)).body;
  assert.equal(dashboard.customers[0].city,'Ahmedabad');
  assert.equal(dashboard.customers[0].state,'Gujarat');
  assert.equal(dashboard.customers[0].country,'India');
});

test('dedicated COD checkout fetches pincode and locks authoritative city/state/country',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0,pincodeOptions:{lookup:async pincode=>locations[pincode]||null,serviceability:async()=>true}});
  await app.start();t.after(()=>app.stop());const base=`http://127.0.0.1:${app.port}`;await setup(base);
  let page=await call(base,'/s/nivkara/ritual');
  assert.doesNotMatch(page.body,/id="cod-form"/);
  const opened=await call(base,'/api/public/nivkara/ritual/checkouts','POST',{intent:'open',quantity:1});
  assert.equal(opened.response.status,201);
  page=await call(base,`/s/nivkara/checkout/${opened.body.id}`);
  for(const text of ['name="pincode"','name="city"','name="state"','name="country"','src="/checkout.js"']) assert.ok(page.body.includes(text));
  for(const field of ['city','state','country'])assert.match(page.body,new RegExp(`name="${field}"[^>]*readonly`));
  const script=await(await fetch(base+'/checkout.js')).text();
  assert.match(script,/if \(city\) city.value = ''/);
  assert.match(script,/if \(state\) state.value = ''/);
  assert.match(script,/version !== lookupVersion/);
  assert.match(script,/lookupController\?\.abort/);
});
