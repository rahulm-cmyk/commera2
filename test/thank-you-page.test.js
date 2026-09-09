import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

async function request(base,path,method='GET',data) {
  const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)});
  const type=response.headers.get('content-type')||'';
  return {response,body:type.includes('json')?await response.json():await response.text()};
}

async function completedOrder(base,storeSlug='nivkara') {
  let result=await request(base,'/api/stores','POST',{name:'Nivkara',slug:storeSlug});const store=result.body;
  await request(base,`/api/stores/${store.id}/policies/written/privacy`,'PATCH',{title:'Privacy Policy',content:'<p>We protect customer information.</p>'});
  await request(base,`/api/stores/${store.id}/policies/written/privacy/publish`,'POST',{});
  result=await request(base,`/api/stores/${store.id}/products`,'POST',{name:'Hair Oil',slug:'hair-oil',pricePaise:79900,stock:5});const product=result.body;
  result=await request(base,`/api/stores/${store.id}/pages`,'POST',{productId:product.id,title:'Bedtime Ritual',slug:'ritual',body:'A simple ritual.'});const page=result.body;
  await request(base,`/api/stores/${store.id}/pages/${page.id}`,'PATCH',{thankYou:{headline:'Your ritual is on its way!',body:'We will call before dispatch.',ctaText:'Back to Nivkara'}});
  await request(base,`/api/stores/${store.id}/pages/${page.id}/publish`,'POST',{});
  result=await request(base,`/api/public/${storeSlug}/ritual/checkouts`,'POST',{quantity:1,name:'Meera Sharma',phone:'9876543210',address:'12 MG Road Bengaluru',city:'Bengaluru',state:'Karnataka',pincode:'560001',termsAccepted:true});const draft=result.body;
  result=await request(base,`/api/public/checkouts/${draft.id}/order`,'POST',{storeId:store.id});
  return {store,product,page,draft,orderResult:result};
}

test('completed COD order redirects to a dedicated customized Thank You Page',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});await app.start();t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  const {orderResult}=await completedOrder(base);
  assert.equal(orderResult.response.status,201);
  assert.match(orderResult.body.thankYouUrl,/^\/s\/nivkara\/thank-you\/[0-9a-f-]+$/);

  const result=await request(base,orderResult.body.thankYouUrl);
  assert.equal(result.response.status,200);
  assert.match(result.body,/Your ritual is on its way!/);
  assert.match(result.body,/We will call before dispatch\./);
  assert.match(result.body,/Back to Nivkara/);
  assert.match(result.body,new RegExp(orderResult.body.orderNumber));
  assert.match(result.body,/Hair Oil/);
  assert.match(result.body,/₹799/);
  assert.match(result.body,/Cash on Delivery/);
  assert.match(result.body,/<strong>Phone:<\/strong> 9876543210/);
  assert.match(result.body,/<strong>Deliver to:<\/strong> 12 MG Road Bengaluru, Bengaluru, Karnataka, 560001/);
  assert.match(result.body,/href="\/s\/nivkara\/policies\/privacy"/);
  assert.doesNotMatch(result.body,/name="phone"|id="cod-form"/);

  const completedCheckoutUrl=`/s/nivkara/checkout/${orderResult.body.thankYouUrl.split('/').pop()}`;
  const redirect=await fetch(base+completedCheckoutUrl,{redirect:'manual'});
  assert.equal(redirect.status,303);
  assert.equal(redirect.headers.get('location'),orderResult.body.finalThankYouUrl);
  const checkoutPage=await request(base,completedCheckoutUrl);
  assert.equal(checkoutPage.response.status,200);
  assert.match(checkoutPage.body,/Your ritual is on its way!/);
  assert.match(checkoutPage.body,new RegExp(orderResult.body.orderNumber));
  assert.doesNotMatch(checkoutPage.body,/id="cod-form"/);
  const storefront=await request(base,'/s/nivkara/ritual');
  assert.doesNotMatch(storefront.body,/id="cod-form"/);
  assert.match(storefront.body,/data-direct-checkout="true"/);
});

test('Thank You Page rejects unknown and cross-store order sessions',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});await app.start();t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  const {draft}=await completedOrder(base,'nivkara');
  await request(base,'/api/stores','POST',{name:'Other Store',slug:'other-store'});

  let result=await request(base,`/s/other-store/thank-you/${draft.id}`);
  assert.equal(result.response.status,404);
  result=await request(base,`/s/other-store/checkout/${draft.id}`);
  assert.equal(result.response.status,404);
  result=await request(base,'/s/nivkara/thank-you/00000000-0000-0000-0000-000000000000');
  assert.equal(result.response.status,404);
});

test('merchant editor exposes Thank You Page customization controls',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});await app.start();t.after(()=>app.stop());
  const result=await request(`http://127.0.0.1:${app.port}`,'/app.js');
  assert.match(result.body,/Thank You Page headline/);
  assert.match(result.body,/Thank You Page message/);
  assert.match(result.body,/Thank You Page button/);
  assert.match(result.body,/thankYou/);
  assert.match(result.body,/Confirmation Animation/);
  assert.match(result.body,/Preview Animation/);
  assert.match(result.body,/Checkmark \+ Confetti/);
  for (const [file,type] of [['confirmation-animation.js','javascript'],['confirmation-animation.css','css']]) {
    const asset=await request(`http://127.0.0.1:${app.port}`,'/'+file);
    assert.equal(asset.response.status,200);
    assert.ok(asset.response.headers.get('content-type').includes(type));
  }
});

test('saved states determine confirmation, payment labels and success effects', async t => {
  const db=createDatabase(':memory:');
  const app=createApp({db,port:0});await app.start();t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  const {draft,orderResult}=await completedOrder(base);
  for (const [method,status,success,message] of [
    ['cod','pending',true,'Order confirmed. Pay on delivery.'],
    ['prepaid','pending',false,'We’re checking your payment.'],
    ['prepaid','paid',true,'Order confirmed. Payment received.'],
    ['prepaid','failed',false,'Your payment could not be confirmed.'],
    ['prepaid','refunded',false,'Your payment was refunded.'],
  ]) {
    db.prepare('UPDATE orders SET payment_method=?,payment_status=? WHERE checkout_session_id=?').run(method,status,draft.id);
    const {body}=await request(base,orderResult.body.finalThankYouUrl);
    assert.ok(body.includes(message));
    assert.ok(body.includes(`data-confirmation="${success?'success':'other'}"`));
    assert.match(body,/Order summary/);
    assert.match(body,/12 MG Road Bengaluru/);
    if (!success) {
      assert.doesNotMatch(body,/class="confirmation-icon"|Your ritual is on its way!|trackCommerceEvent|fbq\(/);
    }
    if (method==='prepaid') assert.doesNotMatch(body,/<strong>Payment:<\/strong> Cash on Delivery/);
  }
});

test('settings persist and sample preview is read-only, isolated and untracked', async t => {
  const db=createDatabase(':memory:');
  const app=createApp({db,port:0});await app.start();t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  const {store,page,orderResult}=await completedOrder(base);
  const path=`/api/stores/${store.id}/pages/${page.id}`;
  await request(base,path,'PATCH',{thankYou:{animation:{enabled:false,style:'confetti'}}});
  // A text-only update must not reset the saved animation preference.
  await request(base,path,'PATCH',{thankYou:{headline:'Thank you, friend!'}});
  const liveBeforePublish = await request(base,orderResult.body.finalThankYouUrl);
  assert.match(liveBeforePublish.body,/data-animation-enabled="true"/);
  await request(base,path+'/publish','POST',{});
  let result=await request(base,orderResult.body.finalThankYouUrl);
  assert.match(result.body,/data-animation-enabled="false"/);
  assert.match(result.body,/data-animation-style="confetti"/);
  const beforeOrders=db.prepare('SELECT * FROM orders').all();
  const beforeSessions=db.prepare('SELECT * FROM checkout_sessions').all();
  const beforePage=db.prepare('SELECT content_json FROM product_pages WHERE id=?').get(page.id);
  for (let replay=0;replay<2;replay++) {
    result=await request(base,path+'/thank-you/preview','POST',{thankYou:{headline:'Preview <script>unsafe</script>',animation:{enabled:true,style:'confetti'}}});
    assert.equal(result.response.status,200);
    const html=result.body.html;
    assert.match(html,/SAMPLE-1001|Sample product/);
    assert.match(html,/data-confirmation-preview="true"/);
    assert.match(html,/data-animation-enabled="true"/);
    assert.match(html,/Preview &lt;script&gt;unsafe&lt;\/script&gt;/);
    assert.doesNotMatch(html,/Meera Sharma|9876543210|fbq\(|gtag\(|trackCommerceEvent|\/order"|<script>unsafe/);
    assert.match(html,/type="button" disabled/);
  }
  assert.deepEqual(db.prepare('SELECT * FROM orders').all(),beforeOrders);
  assert.deepEqual(db.prepare('SELECT * FROM checkout_sessions').all(),beforeSessions);
  assert.deepEqual(db.prepare('SELECT content_json FROM product_pages WHERE id=?').get(page.id),beforePage);
});
