import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { CampaignService, buildCampaign } from '../src/campaign-service.js';
import { parseCampaignCsv, campaignCsv } from '../public/campaigns.js';

const input = {name:'summer sale',platform:'facebook',campaignId:'00012345678901234567890',baseUrl:'https://example.com/item?size=large&utm_source=old#buy'};
test('Campaign APIs require a merchant session and a valid CSRF token', async t => {
  const app = createApp({db:createDatabase(':memory:'),port:0,merchantAuth:true,domainSyncIntervalMs:0});
  const store = app.service.createStore({name:'Secure',slug:'secure'});
  await app.start('127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`, path = `/api/stores/${store.id}/campaigns`;
  assert.equal((await fetch(base+path)).status,401);
  const registered = await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Owner',email:'campaign-owner@example.com',password:'test-only-pass123'})});
  const cookie = registered.headers.get('set-cookie').split(';')[0], session = await registered.json();
  assert.equal((await fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json'},body:JSON.stringify(input)})).status,403);
  assert.equal((await fetch(base+path,{method:'POST',headers:{cookie,'content-type':'application/json','x-csrf-token':session.csrfToken},body:JSON.stringify(input)})).status,201);
});
test('Campaign URLs replace tags, retain queries and anchors, and preserve long text IDs', () => {
  const result = buildCampaign(input), url = new URL(result.finalUrl);
  assert.equal(url.searchParams.get('utm_id'), input.campaignId);
  assert.equal(url.searchParams.get('size'),'large');
  assert.equal(url.searchParams.getAll('utm_source').length,1);
  assert.equal(url.searchParams.get('utm_campaign'),'summer sale');
  assert.equal(url.hash,'#buy');
  for (const baseUrl of ['javascript:alert(1)','https://user:pass@example.com','not a url']) assert.throws(() => buildCampaign({...input,baseUrl}));
  assert.throws(() => buildCampaign({...input,campaignId:123}));
  assert.throws(() => buildCampaign({...input,platform:'affiliate',source:''}));
});
test('CSV parser handles quoting, BOM, IDs and malformed rows; exports escape formulas', () => {
  const rows = parseCampaignCsv('\uFEFFdate,order_id,revenue,utm_id\r\n2026-09-11,"order,one",12.50,00012345678901234567890\r\n');
  assert.equal(rows[0].order_id,'order,one');
  assert.equal(rows[0].utm_id,input.campaignId);
  assert.throws(() => parseCampaignCsv('date,order_id,revenue,utm_id\n"unfinished'));
  assert.throws(() => parseCampaignCsv('date,order_id,revenue,utm_id\nx,y'));
  assert.match(campaignCsv([{name:'=1+1'}],['name']), /'=1\+1/);
});
test('Store-scoped campaign CRUD and atomic imports persist and match exact IDs', async t => {
  const db = createDatabase(':memory:'), app = createApp({db,port:0,domainSyncIntervalMs:0});
  await app.start('127.0.0.1'); t.after(() => app.stop());
  const call = async (path,method='GET',data) => {
    const res = await fetch(`http://127.0.0.1:${app.port}${path}`,{method,headers:{'content-type':'application/json'},body:data ? JSON.stringify(data) : undefined});
    return {status:res.status,body:await res.json()};
  };
  const a = (await call('/api/stores','POST',{name:'A',slug:'a'})).body.id;
  const b = (await call('/api/stores','POST',{name:'B',slug:'b'})).body.id;
  const path = `/api/stores/${a}/campaigns`;
  const created = await call(path,'POST',input);
  assert.equal(created.status,201);
  assert.equal((await call(path)).body[0].campaignId,input.campaignId);
  assert.equal((await call(path,'POST',input)).status,400);
  assert.equal((await call(`/api/stores/${b}/campaigns/${created.body.id}`,'PUT',input)).status,404);
  assert.deepEqual((await call(`/api/stores/${b}/campaigns`)).body,[]);
  const row = {date:'2026-09-11',order_id:'000001',revenue:'12.50',utm_id:input.campaignId};
  assert.equal((await call(path+'/orders','POST',{rows:[row]})).status,200);
  assert.equal((await call(path+'/orders','POST',{rows:[row]})).status,200);
  const report = (await call(path+'/orders')).body;
  assert.equal(report.length,1); assert.equal(report[0].campaign,'summer sale'); assert.equal(report[0].revenue,12.5);
  assert.equal((await call(path+'/orders','POST',{rows:[{...row,order_id:'second'},{...row,date:'2026-02-30'}]})).status,400);
  assert.equal((await call(path+'/orders')).body.length,1);
  const freshService = new CampaignService(db);
  assert.equal(freshService.list(a).length,1);
  await call(path+'/'+created.body.id,'DELETE');
  assert.equal((await call(path+'/orders')).body[0].campaign,'');
});

test('Campaign sheet import accepts custom headers and updates by campaign ID', async t => {
  const db = createDatabase(':memory:'), app = createApp({db,port:0,domainSyncIntervalMs:0});
  await app.start('127.0.0.1'); t.after(() => app.stop());
  const call = async (path,method='GET',data) => {
    const res = await fetch(`http://127.0.0.1:${app.port}${path}`,{method,headers:{'content-type':'application/json'},body:data ? JSON.stringify(data) : undefined});
    const body = await res.json();
    return {status:res.status,body};
  };

  const store = (await call('/api/stores','POST',{name:'C',slug:'c'})).body;
  const importPath = `/api/stores/${store.id}/campaigns/import`;
  const first = await call(importPath,'POST',{
    rows: [
      { 'Campaign Name': 'Summer sale', 'Campaign ID': 'utm-001', Platform: 'facebook', 'Landing URL':'https://example.com/one', Status:'Live' },
      { campaign: 'Retarget', id: 'utm-002', channel: 'google', url:'https://example.com/two?x=1' },
    ],
  });
  assert.equal(first.status,200);
  assert.equal(first.body.imported,2);

  const campaigns = (await call(`/api/stores/${store.id}/campaigns`)).body;
  assert.equal(campaigns.length,2);
  assert.equal(campaigns.some(item => item.campaignId === 'utm-001'),true);

  const update = await call(importPath,'POST',{
    rows: [{ 'Campaign Name':'Summer sale v2','Campaign ID':'utm-001',Platform:'facebook',base_url:'https://example.com/one?coupon=1',Source:'facebook',Medium:'paid_social'}],
  });
  assert.equal(update.status,200);
  assert.equal(update.body.imported,1);
  const refreshed = (await call(`/api/stores/${store.id}/campaigns`)).body;
  assert.equal(refreshed.find(item => item.campaignId === 'utm-001').name,'Summer sale v2');
});

test('Checkout attribution respects consent and joins completed orders without changing order data', async t => {
  const db = createDatabase(':memory:'), app = createApp({db,port:0,domainSyncIntervalMs:0});
  await app.start('127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (path,method='GET',body,referer) => {
    const res = await fetch(base+path,{method,headers:{'content-type':'application/json',...(referer ? {referer} : {})},body:body ? JSON.stringify(body) : undefined});
    const result = await res.json(); assert.ok(res.ok,JSON.stringify(result)); return result;
  };
  const store = await call('/api/stores','POST',{name:'Tagged store',slug:'tagged'});
  const product = await call(`/api/stores/${store.id}/products`,'POST',{name:'Oil',slug:'oil',pricePaise:50000,stock:10});
  const page = await call(`/api/stores/${store.id}/pages`,'POST',{productId:product.id,title:'Offer',slug:'offer',body:'Offer'});
  await call(`/api/stores/${store.id}/pages/${page.id}/publish`,'POST',{});
  await call(`/api/stores/${store.id}/campaigns`,'POST',input);
  const reference = `${base}/s/tagged/offer?utm_id=${input.campaignId}&utm_source=facebook`;
  const denied = await call('/api/public/tagged/offer/checkouts','POST',{intent:'open',analyticsConsentGranted:false},reference);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM checkout_attribution WHERE checkout_id=?').get(denied.id).n,0);
  const checkout = await call('/api/public/tagged/offer/checkouts','POST',{quantity:1,name:'Riya Sharma',phone:'9876543210',address:'12 Green Park Main Road',city:'Delhi',state:'Delhi',country:'India',pincode:'110001',termsAccepted:true,paymentMethod:'cod',intent:'submit',analyticsConsentGranted:true},reference);
  assert.equal(db.prepare('SELECT campaign_key FROM checkout_attribution WHERE checkout_id=?').get(checkout.id).campaign_key,input.campaignId);
  await call(`/api/public/checkouts/${checkout.id}/order`,'POST',{storeId:store.id});
  const report = await call(`/api/stores/${store.id}/campaigns/attribution`);
  assert.equal(report.length,1); assert.equal(report[0].campaign,'summer sale'); assert.equal(report[0].revenue,500);
});
