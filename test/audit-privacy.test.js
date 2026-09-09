import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
import {SettingsService} from '../src/settings-service.js';
import {PolicyService} from '../src/policy-service.js';

test('browser consent is store scoped and rejection blocks tracking even when opt-in is optional',async t=>{
  const db=createDatabase(':memory:'),app=createApp({db,port:0});await app.start();t.after(()=>app.stop());
  const settings=new SettingsService(db),saved=new Map([['commera2_tracking_consent_1','accepted']]);
  for(const suffix of ['one','two']){
    const store=app.service.createStore({name:suffix,slug:suffix}),product=app.service.createProduct(store.id,{name:'Product',slug:'product',pricePaise:10000,stock:3});
    const page=app.service.createProductPage(store.id,{productId:product.id,title:'Page',slug:'page',body:'Test'});app.service.publishPage(store.id,page.id);
    settings.update(store.id,'privacy',{cookieBannerEnabled:true,requireMarketingConsent:true});
    const html=await fetch(`http://127.0.0.1:${app.port}/s/${suffix}/page`).then(r=>r.text());
    assert.match(html,new RegExp(`setItem\\('commera2_tracking_consent_${store.id}'`));
    const functions=['analyticsConsent','pixelConsent'].map(name=>html.match(new RegExp(`function ${name}\\(\\)\\{[^}]+\\}`))?.[0]).join('\n');
    const context={PIXEL_STORE:store.id,PIXEL_REQUIRE_CONSENT:true,localStorage:{getItem:key=>saved.get(key)}};
    vm.createContext(context);vm.runInContext(functions,context);
    assert.equal(context.pixelConsent(),store.id===1);
    saved.set('commera2_tracking_consent_'+store.id,'rejected');context.PIXEL_REQUIRE_CONSENT=false;
    assert.equal(context.pixelConsent(),false);
  }
});

test('analytics opt-in and disabled analytics are enforced by tracking and visitor APIs',async t=>{
  const db=createDatabase(':memory:'),app=createApp({db,port:0});await app.start();t.after(()=>app.stop());
  const store=app.service.createStore({name:'Privacy',slug:'privacy'}),product=app.service.createProduct(store.id,{name:'Product',slug:'product',pricePaise:10000,stock:3});
  const page=app.service.createProductPage(store.id,{productId:product.id,title:'Page',slug:'page',body:'Test'});app.service.publishPage(store.id,page.id);
  const settings=new SettingsService(db);settings.update(store.id,'privacy',{requireAnalyticsConsent:true});
  const base=`http://127.0.0.1:${app.port}`,html=await fetch(base+'/s/privacy/page').then(r=>r.text());
  const token=JSON.parse(html.match(/VISITOR_TOKEN=("[^"]+")/)[1]);
  const payload={eventName:'product_page_view',eventId:'AUDIT-PRIVACY-1',sessionId:'audit-private-session',pageSlug:'page',productId:product.id,pageId:page.id,visitorToken:token};
  const send=async(path,input)=>{const response=await fetch(base+`/api/public/stores/${store.id}/`+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});assert.ok(response.ok);return response.json();};
  await send('visitor-events',payload);await send('tracking-events',payload);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM live_visitor_sessions').get().count,0);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM tracking_events').get().count,0);
  await send('tracking-events',{...payload,analyticsConsentGranted:true});
  assert.equal(db.prepare('SELECT COUNT(*) count FROM live_visitor_sessions').get().count,1);
  settings.update(store.id,'privacy',{analyticsTracking:false});
  await send('tracking-events',{...payload,eventId:'AUDIT-PRIVACY-2',analyticsConsentGranted:true});
  assert.equal(db.prepare('SELECT COUNT(*) count FROM tracking_events').get().count,1);
});

test('checkout preserves an explicit analytics rejection without preventing an order',async t=>{
  const db=createDatabase(':memory:'),app=createApp({db,port:0,pincodeOptions:{lookup:async()=>({city:'Bengaluru',state:'Karnataka',country:'India'})}});
  await app.start();t.after(()=>app.stop());
  const store=app.service.createStore({name:'Consent',slug:'consent'}),product=app.service.createProduct(store.id,{name:'Product',slug:'product',pricePaise:10000,stock:3});
  const page=app.service.createProductPage(store.id,{productId:product.id,title:'Page',slug:'page',body:'Test'});app.service.publishPage(store.id,page.id);
  const base=`http://127.0.0.1:${app.port}`;
  const send=async(path,input,method='POST')=>{
    const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:JSON.stringify({...input,analyticsConsentGranted:false,consentGranted:false})});
    const out=await response.json();assert.ok(response.ok,JSON.stringify(out));return out;
  };
  const checkout=await send('/api/public/consent/page/checkouts',{quantity:1,name:'Audit Buyer'});
  await send(`/api/public/checkouts/${checkout.id}`,{storeId:store.id,phone:'9876543210',address:'12 Audit Road',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true},'PATCH');
  const order=await send(`/api/public/checkouts/${checkout.id}/order`,{storeId:store.id});
  assert.equal(order.totalPaise,10000);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders').get().count,1);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM tracking_events').get().count,0);
});

test('cookie banner links only to a published built-in privacy policy and preserves custom links',async t=>{
  const db=createDatabase(':memory:'),app=createApp({db,port:0});await app.start();t.after(()=>app.stop());
  const store=app.service.createStore({name:'Policy audit',slug:'policy-audit'}),product=app.service.createProduct(store.id,{name:'Product',slug:'product',pricePaise:10000,stock:3});
  const page=app.service.createProductPage(store.id,{productId:product.id,title:'Page',slug:'page',body:'Test'});app.service.publishPage(store.id,page.id);
  const settings=new SettingsService(db),policies=new PolicyService(db),base=`http://127.0.0.1:${app.port}`;
  settings.update(store.id,'privacy',{cookieBannerEnabled:true});
  const banner=async()=>{const html=await fetch(base+'/s/policy-audit/page').then(r=>r.text());return html.match(/<aside id="cookie-banner"[\s\S]*?<\/aside>/)[0];};
  assert.doesNotMatch(await banner(),/<a /);
  policies.saveWritten(store.id,'privacy',{title:'Audit Privacy',content:'<p>Audit fixture only.</p>'});policies.publishWritten(store.id,'privacy');
  assert.match(await banner(),/href="\/s\/policy-audit\/policies\/privacy"/);
  assert.equal((await fetch(base+'/s/policy-audit/policies/privacy')).status,200);
  settings.update(store.id,'privacy',{privacyPolicyLink:'/s/policy-audit/policies/privacy'});
  policies.unpublishWritten(store.id,'privacy');assert.doesNotMatch(await banner(),/<a /);
  settings.update(store.id,'privacy',{privacyPolicyLink:'https://example.com/privacy'});
  assert.match(await banner(),/href="https:\/\/example.com\/privacy"/);
});
