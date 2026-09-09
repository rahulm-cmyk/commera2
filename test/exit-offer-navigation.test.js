import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/exit-offer.js',import.meta.url),'utf8');
function harness({eligible=true,fail=false,handled=false,state=null}={}) {
  const elements=new Map(),listeners={},calls=[],timers=[],storage=new Map();
  if(handled)storage.set('commera2-exit-dismissed-1-2','1');
  const config={id:2,storeId:1,pageId:3,productId:4,pageSlug:'oil',storeSlug:'test',context:'checkout',checkoutSessionId:'checkout-test',triggerExitIntent:true,triggerMouseLeave:true,triggerInactivity:true,triggerBack:true};
  for(const id of ['exit-offer-config','exit-offer-dialog','exit-offer-claim','exit-offer-reject','exit-offer-close','exit-offer-status','exit-confirm-dialog','exit-confirm-stay','exit-confirm-leave','exit-offer-applied-note']){
    elements.set('#'+id,{textContent:id==='exit-offer-config'?JSON.stringify(config):'',open:false,listeners:{},addEventListener(name,fn){this.listeners[name]=fn},showModal(){this.open=true},close(){this.open=false},removeAttribute(){this.open=false},setAttribute(){this.open=true},focus(){}});
  }
  const history={state,pushes:0,backs:0,pushState(value){this.state=value;this.pushes++},back(){this.backs++}};
  const context={
    document:{querySelector:selector=>elements.get(selector),body:{classList:{add(){},remove(){}}}},
    sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},
    crypto:{randomUUID:()=> 'test-session-123'},VISITOR_TOKEN:'test-token',
    location:{pathname:'/s/test/checkout/checkout-test',href:'http://test/s/test/checkout/checkout-test'},
    history,addEventListener:(name,fn)=>{listeners[name]=fn},
    setTimeout:fn=>{timers.push(fn)},clearTimeout(){},
    fetch:async(url,options)=>{
      calls.push({url,payload:JSON.parse(options.body)});
      if(fail)throw Error('offline');
      return {ok:true,json:async()=>({eligible,checkout:{totalPaise:85000}})};
    },
    CustomEvent:class{constructor(name,options){this.type=name;this.detail=options.detail}},
  };
  context.window={commera2VisitorSessionId:'test-session-123',dispatchEvent(){}};
  vm.runInNewContext(source,context);
  return {elements,listeners,calls,timers,history,
    async click(id){await elements.get('#'+id).listeners.click();await new Promise(resolve=>setImmediate(resolve));},
    back(){history.state=null;listeners.popstate?.({state:null});},
    open:id=>elements.get('#'+id).open,
  };
}

test('mouse movement and inactivity cannot show an offer even with legacy flags',()=>{
  const h=harness();
  assert.deepEqual(Object.keys(h.listeners),['popstate']);
  assert.equal(h.timers.length,0);
  assert.equal(h.calls.length,0);
  assert.equal(h.open('exit-offer-dialog'),false);
});
test('Back asks first; Stay does not count an impression and rearms Back',async()=>{
  const h=harness();h.back();
  assert.ok(h.open('exit-confirm-dialog'));
  assert.equal(h.open('exit-offer-dialog'),false);
  assert.equal(h.calls.length,0);
  await h.click('exit-confirm-stay');
  assert.equal(h.open('exit-confirm-dialog'),false);
  assert.equal(h.calls.length,0);
  h.back();assert.ok(h.open('exit-confirm-dialog'));
});
test('confirming leave shows the offer; rejecting continues Back',async()=>{
  const h=harness();h.back();await h.click('exit-confirm-leave');
  assert.equal(h.open('exit-confirm-dialog'),false);
  assert.ok(h.open('exit-offer-dialog'));
  assert.equal(h.calls[0].payload.reason,'back_attempt');
  await h.click('exit-offer-reject');
  assert.equal(h.open('exit-offer-dialog'),false);
  h.timers.forEach(fn=>fn());assert.equal(h.history.backs,1);
  assert.ok(h.calls[1].url.endsWith('/reject'));
});
test('unavailable or ineligible offers let the customer leave',async()=>{
  for(const options of [{eligible:false},{fail:true}]){
    const h=harness(options);h.back();await h.click('exit-confirm-leave');
    assert.equal(h.open('exit-offer-dialog'),false);
    h.timers.forEach(fn=>fn());assert.equal(h.history.backs,1);
  }
});
test('claiming the offer on checkout stays and never creates an order',async()=>{
  const h=harness();h.back();await h.click('exit-confirm-leave');await h.click('exit-offer-claim');
  assert.equal(h.open('exit-offer-dialog'),false);
  assert.equal(h.history.backs,0);
  assert.ok(h.calls[1].url.endsWith('/claim'));
  assert.equal(h.calls.length,2);
});
test('refreshing a guard entry does not add another history entry; dismissed offers add none',()=>{
  assert.equal(harness({state:{commera2ExitGuard:'/s/test/checkout/checkout-test:2'}}).history.pushes,0);
  assert.equal(harness({handled:true}).history.pushes,0);
});
