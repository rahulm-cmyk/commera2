import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

async function call(base,path,method='GET',data){const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});const body=await response.json();assert.ok(response.ok,body.error);return body}

test('product operations HTTP flow updates persistent inventory',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});await app.start();t.after(()=>app.stop());const base=`http://127.0.0.1:${app.port}`;
  const store=await call(base,'/api/stores','POST',{name:'Nivkara',slug:'nivkara'});
  const product=await call(base,`/api/stores/${store.id}/products`,'POST',{name:'Hair Oil',slug:'oil',pricePaise:99900,stock:10});
  const collection=await call(base,`/api/stores/${store.id}/collections`,'POST',{name:'Hair Care',slug:'hair-care'});
  await call(base,`/api/stores/${store.id}/collections/${collection.id}/products/${product.id}`,'POST',{});
  const warehouse=await call(base,`/api/stores/${store.id}/locations`,'POST',{name:'Delhi Warehouse'});
  let state=await call(base,`/api/stores/${store.id}/product-operations`);
  const primary=state.locations.find(location=>location.isDefault===1);
  const po=await call(base,`/api/stores/${store.id}/purchase-orders`,'POST',{vendor:'Supplier',items:[{productId:product.id,quantity:5,unitCostPaise:30000}]});
  await call(base,`/api/stores/${store.id}/purchase-orders/${po.id}/receive`,'POST',{});
  const transfer=await call(base,`/api/stores/${store.id}/transfers`,'POST',{sourceLocationId:primary.id,destinationLocationId:warehouse.id,items:[{productId:product.id,quantity:4}]});
  await call(base,`/api/stores/${store.id}/transfers/${transfer.id}/receive`,'POST',{});
  const card=await call(base,`/api/stores/${store.id}/gift-cards`,'POST',{code:'WELCOME500',initialBalancePaise:50000,note:'Welcome credit'});

  state=await call(base,`/api/stores/${store.id}/product-operations`);
  assert.equal(state.collections[0].products[0].name,'Hair Oil');
  assert.equal(state.purchaseOrders[0].status,'received');
  assert.equal(state.transfers[0].status,'received');
  assert.equal(state.giftCards[0].id,card.id);
  assert.equal(state.inventory.reduce((sum,level)=>sum+level.quantity,0),15);
  assert.ok(state.movements.some(m=>m.reason==='purchase_order_received'));
  assert.ok(state.movements.some(m=>m.reason==='transfer_received'));
});
