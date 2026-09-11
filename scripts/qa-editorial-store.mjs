import {createRequire} from 'node:module';
import {mkdir,readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createApp} from '../src/server.js';
import {createDatabase} from '../src/database.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.QA_PLAYWRIGHT_PATH||'playwright');
const app=createApp({db:createDatabase(':memory:'),port:0,merchantAuth:false,domainSyncIntervalMs:0,otpProviders:{},googleAuthProvider:null,accountEmailProvider:null});
await app.start('127.0.0.1');const base=`http://127.0.0.1:${app.port}`;
const output='data/editorial-qa';await mkdir(output,{recursive:true});
const image={name:'laundry.jpg',type:'image/jpeg',data:(await readFile('public/theme-media/laundry-lifestyle.jpg')).toString('base64')};
const call=async(path,method='GET',body)=>{const res=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await res.json();assert.ok(res.ok,JSON.stringify(result));return result;};
const store=await call('/api/stores','POST',{name:'Everyday Store',slug:'everyday-store'}),root=`/api/stores/${store.id}`;
const product=await call(`${root}/products`,'POST',{name:'Laundry PowerPods',slug:'laundry-pods',pricePaise:39900,stock:8});
const productPage=await call(`${root}/pages`,'POST',{productId:product.id,title:'Laundry PowerPods',slug:'powerpods',body:'A compact everyday essential.'});
await call(`${root}/pages/${productPage.id}/publish`,'POST',{});
await call(`${root}/storefront/branding`,'PATCH',{logo:image,headingFont:'Georgia'});
const sections=[
  {id:'section-intro-test',type:'rich-text',visible:true,heading:'A simpler routine',eyebrow:'Every day',text:'A thoughtfully considered routine.',buttonText:'Explore',buttonUrl:'#products',alignment:'center'},
  {id:'section-image-test',type:'image-grid',visible:true,heading:'A closer look',blocks:[{heading:'Freshly washed',text:'Cotton towels',image},{heading:'Ready for the day',text:'Everyday clothing',image}]},
  {id:'section-compare-test',type:'comparison',visible:true,heading:'Compare formats',columnHeading:'Pods',otherHeading:'Powder',blocks:[{heading:'Dose',text:'Pre-portioned',other:'Measured'}]},
  {id:'section-faq-test',type:'faq',visible:true,heading:'Questions answered',blocks:[{question:'How do I order?',answer:'Open the product page.'}]},
];
await call(`${root}/storefront/home`,'PATCH',{bannerHeading:'Everyday laundry.',bannerImage:image,buttonText:'Shop PowerPods',buttonTarget:{type:'product',id:product.id},featuredProductIds:[],customSections:sections,themeSettings:{design:'botanical',heroAccent:'A simpler ritual.',heroSecondaryText:'Our approach',heroSecondaryUrl:'#section-intro-test',heroBadges:['Cash on delivery']},headerSticky:false,headerLinks:[{label:'Our approach',url:'#section-intro-test'}]});
const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[];
page.on('pageerror',err=>errors.push(err.message));page.on('response',res=>{if(res.status()>=400)errors.push(`${res.status()} ${res.url()}`);});
const frame=()=>page.locator('#store-website-preview').contentFrame();
const panel=id=>page.locator(`[data-theme-section-id="${id}"]`);
try {
  await page.goto(base+'/online-store/themes/current/edit',{waitUntil:'networkidle'});
  await frame().locator('.store-home-hero h1').waitFor();
  assert.equal(await frame().locator('body').getAttribute('data-store-design'),'botanical');
  await page.getByRole('button',{name:'Featured products',exact:true}).click();
  await page.locator(`[name="featuredProductIds"][value="${product.id}"]`).check();
  await frame().locator(`[data-product-id="${product.id}"]`).waitFor();
  assert.equal(await frame().locator(`[data-product-id="${product.id}"] h3`).textContent(),'Laundry PowerPods','Newly selected products appear without reload');
  await page.locator(`[name="featuredProductIds"][value="${product.id}"]`).uncheck();
  assert.equal(await frame().locator(`[data-product-id="${product.id}"]`).count(),0);
  await page.locator(`[name="featuredProductIds"][value="${product.id}"]`).check();
  await page.locator('[data-store-section="section-intro-test"]').click();
  await panel('section-intro-test').locator('[data-section-destination]').selectOption(`/s/${store.slug}/products/${product.slug}`);
  assert.equal(await frame().locator('#section-intro-test .theme-section-button').getAttribute('href'),`/s/${store.slug}/products/${product.slug}`);
  await page.locator('[data-store-section="section-image-test"]').click();
  await page.locator('[data-block-section="section-image-test"][data-store-block="block-0"]').click();
  const first=panel('section-image-test').locator('[data-theme-block]').first();
  await first.locator('[data-section-field="heading"]').fill('Fresh cotton');
  assert.equal(await frame().locator('#section-image-test h3').first().textContent(),'Fresh cotton');
  await first.getByRole('button',{name:'Remove image',exact:true}).click();
  assert.equal(await frame().locator('#section-image-test img').count(),1);
  await page.getByRole('button',{name:'Undo',exact:true}).click();
  assert.equal(await frame().locator('#section-image-test img').count(),2,'Undo restores the image');
  await page.locator('[data-store-section="section-image-test"]').click();
  await panel('section-image-test').getByRole('button',{name:'Duplicate',exact:true}).click();
  const copy=await page.locator('[data-theme-section-id]:not([hidden])').getAttribute('data-theme-section-id');
  assert.equal(await frame().locator(`[data-store-editor-section="${copy}"] img`).count(),2);
  await page.locator('[data-store-section="section-compare-test"]').click();
  await page.locator('[data-block-section="section-compare-test"][data-store-block="block-0"]').click();
  await panel('section-compare-test').locator('[data-section-field="other"]').fill('Measure each wash');
  assert.equal(await frame().locator('#section-compare-test tbody td').last().textContent(),'Measure each wash');
  await page.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByText('Draft saved',{exact:true}).waitFor();
  await page.reload({waitUntil:'networkidle'});
  assert.equal(await frame().locator(`[data-store-editor-section="${copy}"] img`).count(),2,'Gallery copies survive save and reload');
  assert.equal(await frame().locator('#section-compare-test tbody td').last().textContent(),'Measure each wash');
  assert.equal(await frame().locator('body').getAttribute('data-store-design'),'botanical');
  await page.screenshot({path:`${output}/editor.png`});
  await page.goto(`${base}${root}/storefront/preview`,{waitUntil:'networkidle'});
  await page.getByRole('link',{name:'Our approach'}).first().click();
  assert.ok(page.url().includes('/storefront/preview#section-intro-test'),'Preview section links must not navigate to the live homepage');
  await page.locator('#section-faq-test summary').click();
  assert.ok(await page.locator('#section-faq-test details').getAttribute('open')!==null);
  for(const width of [1440,1024,390,320]){
    await page.setViewportSize({width,height:width<500?844:1000});
    await page.evaluate(()=>scrollTo(0,0));
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,`Overflow at ${width}`);
    if(width<500){const primary=await page.locator('.hero-cta').boundingBox(),secondary=await page.locator('.hero-secondary').boundingBox();assert.ok(Math.abs(primary.y-secondary.y)<=1,'Banner actions must align in one row on phones');assert.ok(Math.abs(primary.height-secondary.height)<=1,'Banner actions must have matching heights');assert.ok(primary.x+primary.width<=secondary.x,'Banner buttons must not overlap');}
    if(width<500){await page.getByLabel('Open store menu').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)<=1,'Open mobile menu must fit');await page.getByRole('navigation',{name:'Mobile store navigation'}).getByRole('link',{name:'Our approach'}).click();assert.equal(await page.locator('.store-mobile-menu').getAttribute('open'),null);}
    await page.screenshot({path:`${output}/home-${width}.png`});
  }
  await page.locator('.hero-cta').click();
  assert.ok(page.url().includes(`/products/${product.slug}`),'Shop opens the connected product, not the reference website');
  assert.equal(await page.locator('body').evaluate(el=>el.innerText.includes('Laundry PowerPods')),true);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,checks:['editorial rendering','new featured product preview','product destination picker','gallery edit and undo','image gallery duplication and persistence','comparison editing','save reload','draft anchor navigation','mobile menu open and close','responsive layouts','connected product CTA'],screenshots:output},null,2));
}finally{await browser.close();await app.stop();}
