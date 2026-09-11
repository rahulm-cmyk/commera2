import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThemeSections,normalizeThemeSettings,renderCustomSection} from '../src/theme-sections.js';
import {clientSectionMarkup} from '../public/store-theme-sections.js';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const png={name:'test.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
const gallery={id:'section-gallery-001',type:'image-grid',visible:true,heading:'The collection',eyebrow:'A closer look',blocks:[{heading:'Cotton',text:'Carefully selected',image:png}]};
const comparison={id:'section-compare-001',type:'comparison',visible:true,heading:'Compare',columnHeading:'Our product',otherHeading:'Other products',blocks:[{heading:'Format',text:'Pod',other:'Powder'}]};

test('editorial sections share markup between the editor and saved storefront',()=>{
  for(const section of normalizeThemeSections([gallery,comparison,{id:'section-steps-001',type:'benefits',heading:'Routine',layout:'timeline',blocks:[{heading:'Start',text:'First step'}]},{id:'section-rich-001',type:'rich-text',heading:'Hello <script>',buttonText:'Shop',buttonUrl:'#products'}])){
    assert.equal(clientSectionMarkup(section,escape),renderCustomSection(section,escape));
    assert.doesNotMatch(renderCustomSection(section,escape),/<script>/);
    assert.match(renderCustomSection(section,escape),new RegExp(`id="${section.id}"`));
  }
});
test('new section inputs validate limits, IDs and links',()=>{
  assert.throws(()=>normalizeThemeSections([{...gallery,blocks:Array(9).fill(gallery.blocks[0])}]),/8 blocks/);
  assert.throws(()=>normalizeThemeSections([{...comparison,blocks:[{heading:'x'.repeat(81)}]}]),/80 characters/);
  assert.throws(()=>normalizeThemeSections(Array.from({length:21},(_,i)=>({...comparison,id:`section-example-${i}`}))),/20 custom/);
  assert.throws(()=>normalizeThemeSettings({heroSecondaryUrl:'javascript:alert(1)'}),/Section links/);
  assert.equal(normalizeThemeSettings({design:'unknown'}).design,'classic');
  assert.equal(normalizeThemeSettings({design:'botanical',heroAccent:'Fresh every day'}).heroAccent,'Fresh every day');
});
test('gallery images and editorial settings survive save, partial update and publication without changing the live draft boundary',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0,merchantAuth:false,domainSyncIntervalMs:0,otpProviders:{},googleAuthProvider:null,accountEmailProvider:null});
  await app.start('127.0.0.1');t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`;
  const call=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const result=await response.json();return {status:response.status,body:result};};
  const store=(await call('/api/stores','POST',{name:'Editorial Store',slug:'editorial'})).body;
  const path=`/api/stores/${store.id}/storefront`;
  await call(`${path}/branding`,'PATCH',{logo:png});
  let result=await call(`${path}/home`,'PATCH',{bannerVisible:false,featuredVisible:false,customSections:[gallery,comparison],themeSettings:{design:'botanical',heroAccent:'A simpler day'}});
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.match(result.body.customSections[0].blocks[0].image.dataUrl,/^data:image\/png/);
  result=await call(`${path}/home/publish`,'POST',{});assert.equal(result.status,200,JSON.stringify(result.body));
  const saved=(await call(path)).body.home.customSections;
  result=await call(`${path}/home`,'PATCH',{customSections:saved.map(section=>({...section,heading:'Draft only'}))});assert.equal(result.status,200);
  assert.equal(result.body.themeSettings.design,'botanical');
  assert.match(await (await fetch(base+'/s/editorial')).text(),/The collection/);
  assert.doesNotMatch(await (await fetch(base+'/s/editorial')).text(),/Draft only/);
  assert.match(await (await fetch(base+path+'/preview')).text(),/Draft only/);
  result=await call(`${path}/home`,'PATCH',{customSections:[{...gallery,blocks:[{...gallery.blocks[0],image:{name:'injected.svg',type:'image/svg+xml',dataUrl:'data:image/svg+xml;base64,PHN2Zz4='}}]}]});
  assert.equal(result.status,400);
});
