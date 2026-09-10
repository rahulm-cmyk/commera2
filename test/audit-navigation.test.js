import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const confirmSource=source.slice(source.indexOf('async function confirmEditorNavigation'),source.indexOf('async function navigateTo'));
const switchSource=source.slice(source.indexOf('select.onchange = async () =>'),source.indexOf('document.querySelectorAll("#app-sidebar nav button")'));
function fixture(choice,saveResult=true){
  const events=[], syncedStores=[];
  const context=vm.createContext({storeId:1,select:{value:'2'},productPageDirty:true,productPageSaveHandler:async()=>{events.push(['save',context.storeId]);return saveResult;},
    unsavedNavigationChoice:async()=>choice,localStorage:{setItem:(...args)=>events.push(args)},selectedStoreKey:'store',closeSidebar:()=>{},
    routeFromPath:()=>({view:'pages',screen:'page-edit'}),viewPaths:{pages:'/product-pages'},history:{replaceState:(_a,_b,path)=>events.push(['route',path])},
    storeSwitcher:{sync:()=>syncedStores.push(context.select.value)},
    load:async()=>events.push(['load',context.storeId]),toast:message=>events.push(['error',message])});
  vm.runInContext(confirmSource+switchSource,context);return{context,events,syncedStores};
}
test('store switching prompts before saving and saves only to the original store',async()=>{
  const {context,events,syncedStores}=fixture('save');await context.select.onchange();
  assert.deepEqual(events,[['save',1],['store','2'],['route','/product-pages'],['load',2]]);
  assert.equal(context.storeId,2);assert.equal(context.productPageDirty,false);assert.equal(context.productPageSaveHandler,null);
  assert.deepEqual(syncedStores,['2']);
});
test('staying or a failed save cancels store switching and preserves editor changes',async()=>{
  for(const [choice,saved] of [['continue',true],['save',false]]){
    const {context,events,syncedStores}=fixture(choice,saved);await context.select.onchange();
    assert.equal(context.storeId,1);assert.equal(context.select.value,'1');assert.equal(context.select.disabled,false);assert.equal(context.productPageDirty,true);
    assert.equal(events.some(([action])=>action==='load'),false);
    assert.deepEqual(syncedStores,['1']);
  }
});
