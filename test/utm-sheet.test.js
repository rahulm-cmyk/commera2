import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { UtmSheetService, mapSheetHeaders, sheetIdFromUrl } from '../src/utm-sheet-service.js';

const env = { GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret', APP_BASE_URL: 'https://example.com', GOOGLE_SHEETS_CREDENTIALS_SECRET: 'test-only-encryption-key' };
const sheetUrl = 'https://docs.google.com/spreadsheets/d/test-sheet/edit';
test('Sheet links and column aliases are validated', () => {
  assert.equal(sheetIdFromUrl(sheetUrl), 'test-sheet');
  for (const value of ['https://evil.example/spreadsheets/d/test', 'file:///tmp/test', 'not a URL']) assert.throws(() => sheetIdFromUrl(value));
  assert.deepEqual(mapSheetHeaders(['Order ID', 'Order Total', 'UTM Source', 'Notes']), ['order_id', 'revenue', 'utm_source', '']);
});

test('Sheet exports preserve IDs, retry uncertain appends without duplicating, pause and detect changed headers', async t => {
  const db = createDatabase(':memory:'), app = createApp({ db, port: 0, domainSyncIntervalMs: 0 });
  t.after(() => db.close());
  const store = app.service.createStore({ name: 'Sheet test', slug: 'sheet-test' });
  const other = app.service.createStore({ name: 'Other', slug: 'other' });
  const product = app.service.createProduct(store.id, { name: 'Oil', slug: 'oil', pricePaise: 50000, stock: 20 });
  const page = app.service.createProductPage(store.id, { productId: product.id, title: 'Oil', slug: 'oil', body: 'Oil' });
  app.service.publishPage(store.id, page.id);
  let sequence = 0;
  const order = () => {
    const checkout = app.service.saveCheckoutDraft(store.id, { pageId: page.id, productId: product.id, quantity: 1, name: 'Test Person', phone: `987654321${sequence++}`, address: `${sequence} Green Park Road`, city: 'Delhi', state: 'Delhi', country: 'India', pincode: '110001', termsAccepted: true });
    db.prepare('INSERT INTO checkout_attribution (checkout_id,store_id,campaign_key,data_json) VALUES (?,?,?,?)').run(checkout.id, store.id, '', JSON.stringify({ utm_source: '=untrusted()', utm_id: '0001234567890123456789' }));
    return app.service.placeCodOrder(store.id, { sessionId: checkout.id });
  };
  order();
  const rows = [['Order ID', 'Order Total', 'utm_source', 'utm_id', 'Notes']];
  let uncertain = true, writes = 0;
  const sheets = new UtmSheetService(db, { env, clientFactory: () => ({ setCredentials() {} }), request: async (_client, options) => {
    if (options.method === 'POST') {
      assert.match(options.url, /valueInputOption=RAW&insertDataOption=INSERT_ROWS/);
      rows.push(...options.data.values); writes++;
      if (uncertain) { uncertain = false; throw Error('Response lost after append'); }
      return {};
    }
    if (options.url.includes('?fields=')) return { properties: { title: 'My UTM sheet' }, sheets: [{ properties: { title: 'Orders' } }] };
    return { values: options.url.includes('1%3A1') ? [rows[0]] : rows };
  } });
  db.prepare('INSERT INTO utm_sheet_connections (store_id,credentials,email) VALUES (?,?,?)').run(store.id, sheets.seal({ refresh_token: 'fake-token' }), 'owner@example.com');
  assert.equal(JSON.stringify(sheets.status(store.id)).includes('fake-token'), false);
  assert.equal(db.prepare('SELECT credentials FROM utm_sheet_connections WHERE store_id=?').get(store.id).credentials.includes('fake-token'), false);
  await assert.rejects(sheets.inspect(other.id, sheetUrl), /Connect/);
  await assert.rejects(sheets.save(store.id, { url: sheetUrl, mapping: ['', 'revenue', '', '', ''] }), /Order ID/);
  await sheets.save(store.id, { url: sheetUrl });
  await sheets.sync(); assert.equal(writes, 0, 'historical order is excluded');
  order();
  await sheets.sync(); assert.match(sheets.status(store.id).error, /Export failed/);
  await sheets.sync(); assert.equal(writes, 1, 'uncertain append is reconciled');
  assert.equal(rows[1][2], '=untrusted()'); assert.equal(rows[1][3], '0001234567890123456789'); assert.equal(rows[1][4], '');
  assert.equal(sheets.status(store.id).error, '');
  sheets.pause(store.id); order(); await sheets.sync(); assert.equal(writes, 1);
  await sheets.save(store.id, { url: sheetUrl }); await sheets.sync(); assert.equal(writes, 2);
  order(); rows[0][1] = 'Changed'; await sheets.sync(); assert.match(sheets.status(store.id).error, /columns changed/); assert.equal(writes, 2);
  sheets.disconnect(store.id); assert.equal(sheets.status(store.id).connected, false);
});

test('Sheet API requires authentication, store access and CSRF', async t => {
  const app = createApp({ db: createDatabase(':memory:'), port: 0, merchantAuth: true, domainSyncIntervalMs: 0 });
  await app.start('127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  assert.equal((await fetch(`${base}/api/stores/1/utm-sheet`)).status, 401);
  const registered = await fetch(base + '/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: 'Owner', email: 'sheet@example.com', password: 'test-only-pass123' }) });
  const cookie = registered.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(`${base}/api/stores/1/utm-sheet/pause`, { method: 'POST', headers: { cookie } })).status, 403);
  const response = await fetch(`${base}/api/integrations/google-sheets/callback?state=invalid&code=fake`, { headers: { cookie }, redirect: 'manual' });
  assert.match(response.headers.get('location'), /^\/campaigns\?sheetConnection=failed&reason=/);
});

test('Google Sheets callback accepts the same signed-in browser and rejects a changed state', async t => {
  let tokenExchanges=0;
  const app=createApp({db:createDatabase(':memory:'),port:0,merchantAuth:true,domainSyncIntervalMs:0,utmSheetOptions:{env,clientFactory:()=>({
    generateCodeVerifierAsync:async()=>({codeVerifier:'test-verifier',codeChallenge:'test-challenge'}),
    generateAuthUrl:options=>`https://accounts.google.com/o/oauth2/v2/auth?state=${options.state}`,
    getToken:async options=>{assert.equal(options.codeVerifier,'test-verifier');tokenExchanges++;return {tokens:{refresh_token:'test-refresh',id_token:'test-id'}};},
    verifyIdToken:async()=>({getPayload:()=>({email:'connected@example.com'})})
  })}});
  await app.start('127.0.0.1');t.after(()=>app.stop());const base=`http://127.0.0.1:${app.port}`;
  const registered=await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Owner',email:'callback@example.com',password:'test-only-pass123'})});
  const sessionCookie=registered.headers.getSetCookie()[0].split(';')[0],account=await registered.json();
  const headers={'content-type':'application/json',cookie:sessionCookie,'x-csrf-token':account.csrfToken};
  const created=await fetch(base+'/api/stores',{method:'POST',headers,body:JSON.stringify({name:'OAuth test',slug:'oauth-test'})});
  const store=await created.json();assert.equal(created.status,201);
  const start=await fetch(`${base}/api/stores/${store.id}/utm-sheet/connect`,{method:'POST',headers});
  assert.equal(start.status,200);const cookieHeaders=start.headers.getSetCookie();assert.ok(cookieHeaders.every(c=>c.includes('SameSite=Lax')));
  const oauthCookie=cookieHeaders.find(c=>c.startsWith('commera2_sheets_oauth=')).split(';')[0],state=new URL((await start.json()).url).searchParams.get('state');
  const cookie=`${sessionCookie}; ${oauthCookie}`;
  const bad=await fetch(`${base}/api/integrations/google-sheets/callback?state=wrong&code=test-code`,{headers:{cookie},redirect:'manual'});
  assert.match(decodeURIComponent(bad.headers.get('location')),/no longer current/);assert.equal(tokenExchanges,0);
  const result=await fetch(`${base}/api/integrations/google-sheets/callback?state=${state}&code=test-code`,{headers:{cookie},redirect:'manual'});
  assert.equal(result.headers.get('location'),'/campaigns?sheetConnection=connected');assert.equal(tokenExchanges,1);
  const status=await (await fetch(`${base}/api/stores/${store.id}/utm-sheet`,{headers})).json();assert.equal(status.connected,true);assert.equal(status.email,'connected@example.com');
  assert.equal(JSON.stringify(status).includes('test-refresh'),false);
});
