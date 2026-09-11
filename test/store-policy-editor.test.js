import test from 'node:test';
import assert from 'node:assert/strict';
import { storePolicyConnectionsMarkup, storePolicyEntries } from '../public/store-policy-editor.js';
import { renderStoreChrome } from '../src/store-site-layout.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { DomainService } from '../src/domain-service.js';
import { request } from 'node:http';

const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
test('store policy controls include contact, escape labels and distinguish publishing states',()=>{
  const policies={written:[{type:'shipping',label:'Shipping <test>',status:'draft'},{type:'privacy',label:'Privacy',status:'published'},{type:'terms',label:'Terms',status:'no_policy'}],contact:{type:'contact',label:'Contact',status:'no_policy'}};
  assert.equal(storePolicyEntries(policies).length,4);
  const html=storePolicyConnectionsMarkup(policies,12,escape,()=>'<img alt="">');
  assert.match(html,/Shipping &lt;test&gt;/);
  assert.doesNotMatch(html,/<test>/);
  assert.match(html,/data-store-policy-publish="shipping"/);
  assert.match(html,/data-store-policy-unpublish="privacy"/);
  assert.match(html,/data-store-policy-publish="terms"[^>]+disabled/);
  assert.match(html,/href="\/api\/stores\/12\/policies\/written\/shipping\/preview"/);
  assert.match(html,/data-store-policy-edit="contact"/);
});

test('footer policy links use the current store and published policy labels',()=>{
  const chrome=renderStoreChrome({store:{slug:'my-store',name:'My Store'},home:{}},[{type:'shipping',label:'Shipping & delivery'},{type:'contact',label:'Contact'}]);
  assert.match(chrome.footer,/aria-label="Policies"/);
  assert.match(chrome.footer,/href="\/s\/my-store\/policies\/shipping">Shipping &amp; delivery/);
  assert.match(chrome.header,/href="\/s\/my-store#policies"/);
});

test('policy publication updates saved design previews, live footers and custom-domain links without publishing the design',async t=>{
  const db=createDatabase(':memory:'),app=createApp({db,port:0,merchantAuth:false,domainSyncIntervalMs:0});
  await app.start('127.0.0.1');t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  const call=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:(response.headers.get('content-type')||'').includes('json')?await response.json():await response.text()};};
  const store=app.service.createStore({name:'Policy store',slug:'policy-store'}),other=app.service.createStore({name:'Other store',slug:'other-policy-store'});
  const root=`/api/stores/${store.id}`,policyRoot=`${root}/policies/written`;
  const png={name:'logo.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
  await call(`${root}/storefront/branding`,'PATCH',{logo:png});
  let result=await call(`${root}/storefront/home`,'PATCH',{bannerVisible:false,featuredVisible:false,customSections:[{id:'section-policy-intro',type:'rich-text',visible:true,heading:'Published design',text:'Policy integration fixture'}]});
  assert.equal(result.status,200);
  result=await call(`${root}/storefront/home/publish`,'POST',{});assert.equal(result.status,200,JSON.stringify(result.body));
  await call(`${root}/storefront/home`,'PATCH',{customSections:[{id:'section-policy-intro',type:'rich-text',visible:true,heading:'Draft design',text:'Policy integration fixture'}]});
  await call(`${policyRoot}/shipping`,'PATCH',{title:'Shipping Policy',content:'<p>Shipping fixture.</p>'});
  await call(`/api/stores/${other.id}/policies/written/privacy`,'PATCH',{title:'Other privacy',content:'<p>Other store fixture.</p>'});
  await call(`/api/stores/${other.id}/policies/written/privacy/publish`,'POST',{});
  let html=(await call(`/s/${store.slug}`)).body;
  assert.doesNotMatch(html,/href="[^\"]*\/policies\/shipping"/);
  await call(`${policyRoot}/shipping/publish`,'POST',{});
  html=(await call(`/s/${store.slug}`)).body;
  assert.match(html,/Published design/);assert.doesNotMatch(html,/Draft design/);
  assert.match(html,/href="\/s\/policy-store\/policies\/shipping"/);
  assert.doesNotMatch(html,/href="[^\"]*\/policies\/privacy"/);
  html=(await call(`${root}/storefront/preview`)).body;
  assert.match(html,/Draft design/);assert.match(html,/href="\/s\/policy-store\/policies\/shipping"/);
  const domains=new DomainService(db,{cnameTarget:'edge.example.com'}),domain=domains.addDomain(store.id,{domainName:'policy-test.example'});
  db.prepare("UPDATE custom_domains SET overall_status='ACTIVE' WHERE id=?").run(domain.id);
  const domainHtml=await new Promise((resolve,reject)=>{const req=request(`${base}/`,{headers:{host:'policy-test.example'}},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>resolve(body));});req.on('error',reject);req.end();});
  assert.match(domainHtml,/href="\/policies\/shipping"/);
  assert.doesNotMatch(domainHtml,/href="\/s\/policy-store\/policies/);
  domains.disconnect(store.id,domain.id);
  await call(`${policyRoot}/shipping/unpublish`,'POST',{});
  assert.equal((await call(`/s/${store.slug}/policies/shipping`)).status,404);
  assert.doesNotMatch((await call(`${root}/storefront/preview`)).body,/href="[^\"]*\/policies\/shipping"/);
});
