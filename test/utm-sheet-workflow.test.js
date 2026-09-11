import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { CommerceService } from '../src/commerce-service.js';
import { SettingsService } from '../src/settings-service.js';
import { UtmSheetService } from '../src/utm-sheet-service.js';

function setup(t) {
  const db=createDatabase(':memory:'),service=new CommerceService(db),settings=new SettingsService(db);
  t.after(()=>db.close());
  const store=service.createStore({name:'Sheet workflow',slug:'sheet-workflow'});
  const product=service.createProduct(store.id,{name:'Bottle',slug:'bottle',pricePaise:50000,stock:20});
  const extra=service.createProduct(store.id,{name:'Gift box',slug:'box',pricePaise:10000,stock:10});
  const page=service.createProductPage(store.id,{productId:product.id,title:'Bottle',slug:'bottle',body:'Bottle'});service.publishPage(store.id,page.id);
  const tabs={},calls=[];
  const sheets=new UtmSheetService(db,{env:{GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',APP_BASE_URL:'https://example.com',GOOGLE_SHEETS_CREDENTIALS_SECRET:'test-only'},clientFactory:()=>({setCredentials(){}}),request:async(_client,options)=>{
    calls.push(options);
    if(options.url==='https://sheets.googleapis.com/v4/spreadsheets') {
      for(const sheet of options.data.sheets) tabs[sheet.properties.title]=[sheet.data[0].rowData[0].values.map(v=>v.userEnteredValue.stringValue)];
      return {spreadsheetId:'created-sheet'};
    }
    if(options.url.includes('?fields='))return {properties:{title:'Created sheet'},sheets:Object.keys(tabs).map(title=>({properties:{title}}))};
    if(options.url.endsWith('/values:batchUpdate')) {
      assert.equal(options.data.valueInputOption,'RAW');
      for(const change of options.data.data){const [,tab,letters,row]=change.range.match(/^'(.+)'!([A-Z]+)(\d+)$/);let column=0;for(const c of letters)column=column*26+c.charCodeAt(0)-64;tabs[tab][Number(row)-1][column-1]=change.values[0][0];}
      return {};
    }
    const range=decodeURIComponent(options.url.split('/values/')[1].split(':append')[0]),tab=range.match(/^'([^']+)'/)[1];
    if(options.method==='POST') {assert.match(options.url,/valueInputOption=RAW/);tabs[tab].push(...options.data.values);return {};}
    return {values:structuredClone(range.includes('!1:1')?[tabs[tab][0]]:tabs[tab])};
  }});
  db.prepare('INSERT INTO utm_sheet_connections(store_id,credentials,email) VALUES(?,?,?)').run(store.id,sheets.seal({refresh_token:'test-token'}),'test@example.com');
  const input={pageId:page.id,productId:product.id,quantity:1,name:'Test Person',phone:'9876543210',address:'12 Green Park Road',city:'Delhi',state:'Delhi',country:'India',pincode:'110001',termsAccepted:true};
  return {db,service,settings,store,product,extra,page,sheets,tabs,calls,input};
}

test('create sheet validates before writing and creates order and abandoned tabs with selected headers',async t=>{
  const {sheets,store,tabs,calls}=setup(t);
  await assert.rejects(sheets.createSheet(store.id,{fields:['order_id'],rowMode:'bad'}),/row/);assert.equal(calls.length,0);
  const status=await sheets.createSheet(store.id,{title:'My orders',fields:['order_id','product','utm_source','customer_phone'],includeAbandoned:true});
  assert.equal(status.enabled,true);assert.equal(status.abandonedTab,'Abandoned checkouts');
  assert.deepEqual(tabs.Orders[0],['Order ID','Product','UTM source','Customer phone']);
  assert.deepEqual(tabs['Abandoned checkouts'][0],tabs.Orders[0]);
});

test('per-item exports include every extra and later upsells without changing merchant notes',async t=>{
  const {sheets,service,settings,store,product,extra,tabs,input,db}=setup(t);
  await sheets.createSheet(store.id,{fields:['order_id','item_id','product','revenue','quantity','line_total'],rowMode:'item'});
  tabs.Orders[0].push('Notes');await sheets.save(store.id,{url:sheets.status(store.id).url,rowMode:'item'});
  settings.update(store.id,'codForm',{addons:[{productId:extra.id,title:'Gift box',pricePaise:2500}]});
  service.createUpsell(store.id,{productId:product.id,upsellProductId:product.id,triggerType:'any_product',allowExistingProduct:true,name:'Another bottle',headline:'Another bottle',pricePaise:40000,quantity:1,status:'active'});
  const draft=service.saveCheckoutDraft(store.id,{...input,addonsSubmitted:true,[`addon_${extra.id}`]:true});
  const order=service.placeCodOrder(store.id,{sessionId:draft.id});
  await sheets.sync();assert.equal(sheets.status(store.id).error,'');assert.equal(tabs.Orders.length,3);
  assert.deepEqual(new Set(tabs.Orders.slice(1).map(r=>r[2])),new Set(['Bottle','Gift box']));
  tabs.Orders[1][6]='=MY_MANUAL_FORMULA()';
  const offer=order.postPurchaseUpsell;service.acceptOrderUpsell(store.slug,draft.id,offer.id,offer.token);
  await sheets.sync();assert.equal(sheets.status(store.id).error,'');assert.equal(tabs.Orders.length,4);
  assert.equal(new Set(tabs.Orders.slice(1).map(r=>r[1])).size,3);
  assert.equal(tabs.Orders[1][6],'=MY_MANUAL_FORMULA()');
  assert.ok(tabs.Orders.slice(1).every(r=>r[3]===925));
  await sheets.sync();assert.equal(tabs.Orders.length,4);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM utm_sheet_exports').get().n,1);
});

test('one-row export aggregates all product names and custom answers',async t=>{
  const {sheets,service,settings,store,extra,tabs,input}=setup(t);
  settings.update(store.id,'codForm',{customFields:[{id:'gift',label:'Gift message',type:'text'}],addons:[{productId:extra.id,title:'Gift box',pricePaise:2500}]});
  await sheets.createSheet(store.id,{fields:['order_id','product','quantity','custom_gift']});
  const draft=service.saveCheckoutDraft(store.id,{...input,custom_gift:'=NOT_A_FORMULA()',addonsSubmitted:true,[`addon_${extra.id}`]:'on'});service.placeCodOrder(store.id,{sessionId:draft.id});
  await sheets.sync();assert.equal(sheets.status(store.id).error,'');assert.equal(tabs.Orders.length,2);
  assert.match(tabs.Orders[1][1],/Gift box/);assert.match(tabs.Orders[1][1],/Bottle/);assert.equal(tabs.Orders[1][2],2);assert.equal(tabs.Orders[1][3],'=NOT_A_FORMULA()');
});

test('abandoned export honors inactivity, privacy and deduplicates checkout IDs',async t=>{
  const {sheets,service,settings,store,tabs,input,db}=setup(t);
  await sheets.createSheet(store.id,{fields:['order_id','checkout_id','checkout_status','customer_phone'],includeAbandoned:true});
  db.prepare("UPDATE utm_sheet_options SET abandoned_after='2000-01-01T00:00:00Z' WHERE store_id=?").run(store.id);
  const draft=service.saveCheckoutDraft(store.id,input);
  await sheets.sync();assert.equal(tabs['Abandoned checkouts'].length,1);
  db.prepare("UPDATE checkout_sessions SET updated_at=datetime('now','-45 minutes') WHERE id=?").run(draft.id);
  settings.update(store.id,'privacy',{allowAbandonedCheckoutData:false});await sheets.sync();assert.equal(tabs['Abandoned checkouts'].length,1);
  settings.update(store.id,'privacy',{allowAbandonedCheckoutData:true});await sheets.sync();assert.equal(sheets.status(store.id).error,'');assert.equal(tabs['Abandoned checkouts'].length,2);
  assert.equal(tabs['Abandoned checkouts'][1][1],draft.id);assert.equal(tabs['Abandoned checkouts'][1][2],'abandoned');
  await sheets.sync();assert.equal(tabs['Abandoned checkouts'].length,2);
});

test('expired coupons do not block abandoned exports or invent a current total',async t=>{
  const {sheets,service,settings,store,extra,tabs,input,db}=setup(t);
  settings.update(store.id,'codForm',{addons:[{productId:extra.id,title:'Gift box',pricePaise:2500}]});
  await sheets.createSheet(store.id,{fields:['order_id','customer_phone','revenue','coupon','product','quantity'],includeAbandoned:true});
  db.prepare("UPDATE utm_sheet_options SET abandoned_after='2000-01-01T00:00:00Z' WHERE store_id=?").run(store.id);
  service.createCoupon(store.id,{code:'SAVE10',discountType:'percent',value:10});
  const draft=service.saveCheckoutDraft(store.id,{...input,couponCode:'SAVE10',addonsSubmitted:true,[`addon_${extra.id}`]:true});
  db.prepare("UPDATE discount_coupons SET expires_at='2000-01-01T00:00:00Z' WHERE store_id=?").run(store.id);
  db.prepare("UPDATE checkout_sessions SET updated_at=datetime('now','-45 minutes') WHERE id=?").run(draft.id);
  await sheets.sync();assert.equal(sheets.status(store.id).error,'');
  assert.deepEqual(tabs['Abandoned checkouts'][1],[draft.id,input.phone,'','SAVE10','Bottle | Gift box',2]);
});
