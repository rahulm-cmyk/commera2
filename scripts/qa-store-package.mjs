import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
const require=createRequire(import.meta.url),{chromium}=require(process.env.QA_PLAYWRIGHT_PATH||'playwright');
const app=createApp({db:createDatabase(':memory:'),port:0,merchantAuth:false,domainSyncIntervalMs:0,otpProviders:{},googleAuthProvider:null,accountEmailProvider:null});
await app.start('127.0.0.1');
const base=`http://127.0.0.1:${app.port}`,output='data/nivkara-store-qa';
await mkdir(output,{recursive:true});
const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const out=await r.json();assert.ok(r.ok,JSON.stringify(out));return out;};
const store=await api('/api/stores','POST',{name:'Saafix test',slug:'saafix-test'}),root=`/api/stores/${store.id}`;
await api(root+'/products','POST',{name:'Existing oil',slug:'ayurvedic-hair-oil',pricePaise:49900,stock:10});
const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'}),errors=[],metrics=[];
page.setDefaultTimeout(15000);
page.on('pageerror',error=>errors.push(error.message));
try {
  await page.goto(base+'/online-store/themes/current/edit',{waitUntil:'networkidle'});
  await page.getByLabel('More actions',{exact:true}).click();
  await page.getByRole('button',{name:'Import store package'}).click();
  await page.locator('.store-package-dialog input[type=file]').setInputFiles(resolve('data/nivkara-store-package/nivkara-store.json'));
  await page.getByRole('button',{name:'Import and save'}).waitFor({state:'visible'});
  const download=page.waitForEvent('download');
  await page.getByRole('button',{name:'Import and save'}).click();
  await (await download).saveAs(output+'/before-import.json');
  await page.locator('.store-package-dialog').waitFor({state:'detached',timeout:60000});
  await page.getByRole('button',{name:'Publish',exact:true}).click();
  await page.locator('#store-editor-status').filter({hasText:'Published'}).waitFor();
  await page.goto(base+'/s/saafix-test',{waitUntil:'networkidle'});
  assert.equal(await page.locator('.featured-product-card').count(),3);
  assert.equal(await page.getByText('No featured products are published yet.').count(),0);
  for(const width of [1440,1920,1024,390,320]) {
    await page.setViewportSize({width,height:width<500?844:1000});
    await page.evaluate(async()=>{for(const image of document.images){image.loading='eager';try{await image.decode();}catch{}}scrollTo(0,0);});
    const metric=await page.evaluate(()=>({width:innerWidth,overflow:document.documentElement.scrollWidth-innerWidth,brokenImages:[...document.images].filter(img=>!img.naturalWidth).map(img=>img.alt)}));
    assert.ok(metric.overflow<=1,JSON.stringify(metric));assert.equal(metric.brokenImages.length,0);metrics.push(metric);
    if(width<500) {
      const primary=await page.locator('.store-home-hero .hero-cta').boundingBox(),secondary=await page.locator('.hero-secondary').boundingBox(),badges=await page.locator('.hero-badges').boundingBox();
      assert.ok(primary.width>100&&secondary.width>100,'Mobile actions remain readable with three badges');
      assert.ok(Math.abs(primary.y-secondary.y)<2,'Mobile actions align');
      assert.ok(badges.y>=primary.y+primary.height,'Badges stay below the actions');
    }
    await page.screenshot({path:`${output}/home-${width}.png`});
    if(width===1440||width===390)await page.screenshot({path:`${output}/full-${width}.png`,fullPage:true});
  }
  await page.locator('.hero-cta').first().click();
  await page.getByRole('heading',{name:'Nivkara 19-Herb Bhringraj Ayurvedic Hair Oil',exact:true}).waitFor();
  await page.locator('[name=heroBundleId]').last().check();
  assert.match(await page.locator('#hero-price').textContent(),/799/);
  await page.locator('.product-purchase [data-direct-checkout]').click();
  await page.waitForURL(/\/s\/saafix-test\/checkout\//,{waitUntil:'domcontentloaded'});
  await page.locator('#cod-form').waitFor();
  assert.match(await page.locator('body').innerText(),/799/);
  await page.goto(base+'/s/saafix-test/products/anti-hairfall-ayurvedic-shampoo',{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Sold out',exact:true}).waitFor();
  assert.ok(await page.getByRole('button',{name:'Sold out',exact:true}).isDisabled());
  assert.equal(await page.locator('.sticky-mobile-buy').count(),0);
  assert.deepEqual(errors,[]);
  await writeFile(output+'/metrics.json',JSON.stringify({passed:true,metrics,errors},null,2));
  console.log(JSON.stringify({passed:true,checks:['package upload','backup download','three connected product pages','published catalogue','desktop and mobile layouts','bundle price','checkout launch','sold-out buttons'],metrics},null,2));
} catch(error) {
  console.error(error.message);
  console.error(await page.locator('.store-package-dialog [role=status]').textContent({timeout:500}).catch(()=>''));
  await page.screenshot({path:output+'/failure.png'}).catch(()=>{});
  throw error;
} finally {await browser.close();await app.stop();}
