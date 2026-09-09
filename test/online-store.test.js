import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { StorefrontService } from '../src/storefront-service.js';
import { OnlineStoreService } from '../src/online-store-service.js';
import { renderOnlineStore } from '../public/online-store.js';

test('Themes uses an inert storefront thumbnail and preserves editing links and drafts',async()=>{
  const root={innerHTML:'',querySelectorAll:()=>[]};
  await renderOnlineStore({root,route:{onlineTab:'themes'},storeId:7,
    data:{store:{name:'Test Store',slug:'test-store'},storefront:{home:{status:'published',banner:{dataUrl:'raw-banner'}}},pages:[{id:12,title:'Existing draft',status:'draft'}]},
    esc:value=>String(value),navigate:()=>{},api:()=>{throw Error('Thumbnail must not submit API actions');}});
  assert.match(root.innerHTML,/class="online-themes"/);
  assert.match(root.innerHTML,/src="\/api\/stores\/7\/storefront\/preview" sandbox="" tabindex="-1"/);
  assert.match(root.innerHTML,/class="online-preview-viewport" inert/);
  assert.doesNotMatch(root.innerHTML,/raw-banner/);
  assert.match(root.innerHTML,/data-online-go="\/online-store\/themes\/current\/edit"/);
  assert.match(root.innerHTML,/Existing draft/);
  assert.match(root.innerHTML,/data-online-go="\/product-pages\/12\/edit"/);
  assert.match(root.innerHTML,/1 product-page draft</);
});

const png={name:'test.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
async function setup(t) {
  const db=createDatabase(':memory:'),app=createApp({db,port:0});await app.start();t.after(()=>app.stop());
  const store=app.service.createStore({name:'Online Test',slug:'online-test'}),product=app.service.createProduct(store.id,{name:'Test Product',slug:'test-product',pricePaise:50000,stock:8});
  const page=app.service.createProductPage(store.id,{productId:product.id,title:'Test Product Page',slug:'test-page',body:'Test product'});
  app.service.publishPage(store.id,page.id);
  const storefront=new StorefrontService(db),online=new OnlineStoreService(db);
  storefront.saveBranding(store.id,{logo:png});
  storefront.saveProduct(store.id,product.id,{mainImage:png,description:'<p>Test product</p>',buttonText:'Buy now',buttonAction:'checkout',publish:true},page.id);
  storefront.saveHome(store.id,{bannerImage:png,bannerHeading:'Published heading',buttonText:'Shop',buttonTarget:{type:'product',id:product.id},featuredProductIds:[product.id]});
  storefront.publishHome(store.id);
  return{db,app,store,product,page,storefront,online,base:`http://127.0.0.1:${app.port}`};
}
test('Online Store routes and modules are refreshable; unauthenticated writes are rejected',async t=>{
  const {base}=await setup(t);
  for(const path of ['/online-store','/online-store/themes','/online-store/themes/current/edit','/online-store/pages','/online-store/pages/new','/online-store/preferences']) {
    const response=await fetch(base+path);assert.equal(response.status,200,path);assert.match(await response.text(),/Online Store/);
  }
  for(const asset of ['/online-store.js','/online-store.css'])assert.equal((await fetch(base+asset)).status,200);
  const protectedApp=createApp({db:createDatabase(':memory:'),port:0,merchantAuth:true});await protectedApp.start();t.after(()=>protectedApp.stop());
  for(const path of ['pages','preferences'])assert.equal((await fetch(`http://127.0.0.1:${protectedApp.port}/api/stores/1/online-store/${path}`,{method:'POST'})).status,401);
});
test('content pages save privately, publish, retain live revisions and remain store isolated',async t=>{
  const {base,online,store,app}=await setup(t);
  const other=app.service.createStore({name:'Other Online',slug:'other-online'});
  const path=`/api/stores/${store.id}/online-store/pages`;
  let response=await fetch(base+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({title:'About us',slug:'about',content:'<h2>Original content</h2><script>bad()</script>'})});
  assert.equal(response.status,201);const page=await response.json();assert.doesNotMatch(page.content,/<script>/);
  assert.equal((await fetch(base+'/s/online-test/pages/about')).status,404);
  assert.match(await (await fetch(base+path+'/'+page.id+'/preview')).text(),/Original content/);
  await fetch(base+path+'/'+page.id+'/publish',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
  online.save(store.id,page.id,{slug:'our-story',content:'<p>Revised content</p>'});
  assert.match(await (await fetch(base+'/s/online-test/pages/about')).text(),/Original content/);
  assert.equal((await fetch(base+'/s/online-test/pages/our-story')).status,404);
  assert.throws(()=>online.get(other.id,page.id),/not found/);
  assert.throws(()=>online.publish(other.id,page.id),/not found/);
  assert.throws(()=>online.save(store.id,null,{title:'Collision',slug:'about'}),/already in use/);
  online.publish(store.id,page.id);
  assert.match(await (await fetch(base+'/s/online-test/pages/our-story')).text(),/Revised content/);
  online.unpublish(store.id,page.id);
  assert.equal((await fetch(base+'/s/online-test/pages/our-story')).status,404);
});
test('homepage and branding drafts preserve published storefront, live pricing and explicit publication',async t=>{
  const {base,storefront,store,product,db}=await setup(t);
  storefront.saveHome(store.id,{bannerHeading:'Private heading',featuredProductIds:[product.id]});
  storefront.saveBranding(store.id,{primaryColor:'#994411'});
  const live=await fetch(base+'/s/online-test');assert.equal(live.status,200);const html=await live.text();
  assert.match(html,/Published heading/);assert.doesNotMatch(html,/Private heading|#994411/);
  assert.match(await (await fetch(base+`/api/stores/${store.id}/storefront/preview`)).text(),/Private heading/);
  assert.deepEqual(storefront.publicationStatus(store.id),{live:true,hasUnpublishedChanges:true});
  db.prepare('UPDATE products SET price_paise=65000,stock=3 WHERE id=?').run(product.id);
  assert.equal(storefront.getPublic(store.id).home.featuredProducts[0].pricePaise,65000);
  assert.equal(storefront.getPublic(store.id).home.featuredProducts[0].stock,3);
  storefront.publishHome(store.id);
  assert.match(await (await fetch(base+'/s/online-test')).text(),/Private heading/);
  assert.deepEqual(storefront.publicationStatus(store.id),{live:true,hasUnpublishedChanges:false});
});
test('preferences persist, are escaped in homepage metadata and do not create orders',async t=>{
  const {base,store,db}=await setup(t);
  const response=await fetch(base+`/api/stores/${store.id}/online-store/preferences`,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title:'My <Store>',description:'A "special" store'})});
  assert.equal(response.status,200);
  const html=await (await fetch(base+'/s/online-test')).text();assert.match(html,/<title>My &lt;Store&gt;<\/title>/);assert.match(html,/name="description" content="A &quot;special&quot; store"/);
  assert.equal(db.prepare('SELECT COUNT(*) count FROM orders').get().count,0);
});
