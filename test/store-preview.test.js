import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createStorePreviewTokens } from '../src/store-preview-token.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { DomainService } from '../src/domain-service.js';
import { StorefrontService } from '../src/storefront-service.js';

test('preview tokens expire and cannot be forged, moved to another store, or used on another host', () => {
  let now = 1000;
  const tokens = createStorePreviewTokens({ now: () => now });
  const token = tokens.issue(1, 'store.example');
  assert.equal(tokens.verify(token, 1, 'store.example'), true);
  for (const invalid of ['', null, token + '.extra', token.slice(0, -1), 'x'.repeat(3000)])
    assert.equal(tokens.verify(invalid, 1, 'store.example'), false);
  assert.equal(tokens.verify(token, 2, 'store.example'), false);
  assert.equal(tokens.verify(token, 1, 'other.example'), false);
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({...JSON.parse(Buffer.from(payload,'base64url')),storeId:2})).toString('base64url');
  assert.equal(tokens.verify(`${forged}.${signature}`, 2, 'store.example'), false);
  now += 10 * 60_000;
  assert.equal(tokens.verify(token, 1, 'store.example'), false);
});

function custom(base, path, host) {
  return new Promise((resolve, reject) => {
    const req = request(base + path, {headers:{host}}, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({status:res.statusCode,headers:res.headers,body}));
    });
    req.on('error', reject); req.end();
  });
}

test('authenticated preview opens the saved draft on its domain without exposing merchant APIs or publishing', async t => {
  const db = createDatabase(':memory:');
  const app = createApp({db,port:0,merchantAuth:true,domainSyncIntervalMs:0});
  const store = app.service.createStore({name:'Preview store',slug:'preview-store'});
  const domains = new DomainService(db,{cnameTarget:'edge.example'});
  const domain = domains.addDomain(store.id,{domainName:'preview.example'});
  db.prepare("UPDATE custom_domains SET overall_status='ACTIVE' WHERE id=?").run(domain.id);
  const storefront = new StorefrontService(db);
  const png = {name:'qa.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
  storefront.saveHome(store.id,{bannerImage:png,bannerHeading:'Private saved draft'});
  await app.start(); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const endpoint = `/api/stores/${store.id}/storefront/preview/open`;
  assert.equal((await fetch(base + endpoint,{redirect:'manual'})).status,401);
  const register = async email => {
    const r = await fetch(base+'/api/auth/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({displayName:'Preview Owner',email,password:'securepass123'})});
    assert.equal(r.status,201);
    return r.headers.get('set-cookie').split(';')[0];
  };
  const cookie = await register('owner@example.com');
  const other = await register('other@example.com');
  assert.equal((await fetch(base+endpoint,{headers:{cookie:other},redirect:'manual'})).status,403);
  const r = await fetch(base+endpoint,{headers:{cookie},redirect:'manual'});
  assert.equal(r.status,303);
  assert.match(r.headers.get('cache-control'),/no-store/);
  const destination = new URL(r.headers.get('location'));
  assert.equal(destination.origin,'https://preview.example');
  assert.equal(destination.pathname,'/_preview/store');
  const preview = await custom(base,destination.pathname+destination.search,'preview.example');
  assert.equal(preview.status,200);
  assert.match(preview.body,/Private saved draft/);
  assert.match(preview.headers['cache-control'],/no-store/);
  assert.equal(preview.headers['referrer-policy'],'no-referrer');
  assert.match(preview.headers['x-robots-tag'],/noindex/);
  assert.equal(preview.headers['set-cookie'],undefined);
  assert.equal((await custom(base,'/_preview/store','preview.example')).status,403);
  assert.equal((await custom(base,destination.pathname+destination.search,'other.example')).status,403);
  assert.equal((await custom(base,`/api/stores/${store.id}/dashboard${destination.search}`,'preview.example')).status,401);
  const publicPage = await custom(base,'/','preview.example');
  assert.doesNotMatch(publicPage.body,/Private saved draft/);
  assert.notEqual(storefront.get(store.id).home.status,'published');
  domains.disconnect(store.id,domain.id);
  assert.equal((await custom(base,destination.pathname+destination.search,'preview.example')).status,403);
  const fallback = await fetch(base+endpoint,{headers:{cookie},redirect:'manual'});
  assert.equal(fallback.headers.get('location'),`/api/stores/${store.id}/storefront/preview`);
});
