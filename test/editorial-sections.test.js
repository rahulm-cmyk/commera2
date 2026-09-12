import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeThemeSections,normalizeThemeSettings,renderCustomSection} from '../src/theme-sections.js';
import {clientSectionMarkup,newThemeSection,themeSectionCatalog,themeSectionLabel} from '../public/store-theme-sections.js';
import {createDatabase} from '../src/database.js';
import {createApp} from '../src/server.js';
const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const png={name:'test.png',type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='};
const gallery={id:'section-gallery-001',type:'image-grid',visible:true,heading:'The collection',eyebrow:'A closer look',blocks:[{heading:'Cotton',text:'Carefully selected',image:png}]};
const comparison={id:'section-compare-001',type:'comparison',visible:true,heading:'Compare',columnHeading:'Our product',otherHeading:'Other products',blocks:[{heading:'Format',text:'Pod',other:'Powder'}]};

test('section library templates are unique, valid and keep their intended layouts',()=>{
  assert.ok(themeSectionCatalog.length>=30,'The Add section library should include the complete practical template set');
  assert.equal(new Set(themeSectionCatalog.map(item=>item.id)).size,themeSectionCatalog.length);
  assert.equal(themeSectionLabel('image-grid'),'Image gallery');
  for(const template of themeSectionCatalog) {
    const section=newThemeSection(template.type,template.preset);
    const [normalized]=normalizeThemeSections([section]);
    assert.equal(normalized.type,template.type,template.label);
    assert.equal(normalized.heading,template.preset?.heading??themeSectionLabel(template.type),template.label);
    assert.equal(normalized.layout,template.preset?.layout??'cards',template.label);
  }
});

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
  assert.throws(()=>normalizeThemeSections([{...gallery,headingColor:'red'}]),/six-digit color/);
  assert.equal(normalizeThemeSettings({design:'unknown'}).design,'classic');
  assert.equal(normalizeThemeSettings({design:'botanical',heroAccent:'Fresh every day'}).heroAccent,'Fresh every day');
});
test('section typography is validated and rendered without accepting arbitrary CSS',()=>{
  const [styled]=normalizeThemeSections([{...comparison,headingHtml:'<strong>Compare</strong><script>alert(1)</script>',textHtml:'<p>Clear <em>details</em>.</p><ul><li>First</li></ul><a href="javascript:alert(1)">Bad</a><a href="/safe">Safe</a>',headingFont:'garamond',headingSize:'large',headingSizePx:'62',headingWeight:'600',headingLineHeight:'1.2',headingLetterSpacing:'0.5',headingCase:'uppercase',headingColor:'#A12B3C',headingBackground:'#F8F0DD',headingItalic:true,headingUnderline:true,headingStrike:true,textFont:'mono',textSize:'small',textSizePx:'17',textWeight:'500',textLineHeight:'1.8',textLetterSpacing:'0.2',textCase:'capitalize',textColor:'#123456',textBackground:'#ffffff',textBold:true}]);
  assert.equal(styled.headingColor,'#a12b3c');
  assert.equal(styled.headingSizePx,62);
  assert.equal(styled.textLineHeight,1.8);
  assert.match(styled.headingHtml,/<strong>Compare<\/strong>/);
  assert.doesNotMatch(styled.headingHtml,/script|alert/);
  assert.match(styled.textHtml,/<ul><li>First<\/li><\/ul>/);
  assert.doesNotMatch(styled.textHtml,/javascript:/);
  assert.match(styled.textHtml,/href="\/safe"/);
  const html=renderCustomSection(styled,escape);
  assert.match(html,/has-heading-font/);
  assert.match(html,/section-heading-italic/);
  assert.match(html,/section-heading-underline/);
  assert.match(html,/section-heading-strike/);
  assert.match(html,/section-text-bold/);
  assert.match(html,/--section-heading-font:Garamond/);
  assert.match(html,/--section-heading-size:62px/);
  assert.match(html,/--section-heading-weight:600/);
  assert.match(html,/--section-heading-line-height:1.2/);
  assert.match(html,/--section-heading-letter-spacing:0.5px/);
  assert.match(html,/--section-heading-background:#f8f0dd/);
  assert.match(html,/--section-text-color:#123456/);
  assert.match(html,/<strong>Compare<\/strong>/);
  assert.match(html,/class="theme-section-intro theme-rich-content"/);
  assert.throws(()=>normalizeThemeSections([{...comparison,headingSizePx:121}]),/Exact heading size is invalid/);
  assert.throws(()=>normalizeThemeSections([{...comparison,textLineHeight:.7}]),/Body text line height is invalid/);
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
