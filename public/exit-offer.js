(()=>{const readDismissed=key=>{try{return sessionStorage.getItem(key)==='1'}catch{return false}},remember=()=>{try{sessionStorage.setItem(dismissedKey,'1')}catch{}};const CONFIG=JSON.parse(document.querySelector("#exit-offer-config").textContent),dialog=document.querySelector('#exit-offer-dialog'),claim=document.querySelector('#exit-offer-claim'),reject=document.querySelector('#exit-offer-reject'),close=document.querySelector('#exit-offer-close'),offerStatus=document.querySelector('#exit-offer-status'),dismissedKey='commera2-exit-dismissed-'+CONFIG.storeId+'-'+CONFIG.id,sessionKey=window.commera2VisitorSessionId||(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));let handled=readDismissed(dismissedKey),opening=false,backPending=false,inactivityTimer=null,guardActive=false;const payload=extra=>({sessionKey,visitorSessionId:window.commera2VisitorSessionId||sessionKey,visitorToken:VISITOR_TOKEN,pageSlug:CONFIG.pageSlug,productId:CONFIG.productId,pageId:CONFIG.pageId,context:CONFIG.context,checkoutSessionId:CONFIG.checkoutSessionId,...extra}),post=async(url,data)=>{const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),keepalive:true}),out=await response.json();if(!response.ok)throw Error(out.error||'Could not apply this offer');return out},continueBack=()=>{if(backPending)setTimeout(()=>history.back(),0)},finish=()=>{handled=true;remember();clearTimeout(inactivityTimer)},hide=()=>{if(dialog.open)dialog.close();else dialog.removeAttribute('open')};async function attempt(reason){if(handled||opening||dialog.open)return;opening=true;try{const out=await post('/api/public/stores/'+CONFIG.storeId+'/exit-offers/'+CONFIG.id+'/shown',payload({reason}));if(handled)return;if(!out.eligible){finish();continueBack();return}remember();if(typeof dialog.showModal==='function')dialog.showModal();else dialog.setAttribute('open','');document.body.classList.add('exit-offer-open');claim.focus()}catch{if(backPending){finish();continueBack()}}finally{opening=false}}async function dismiss(){if(handled)return;finish();hide();document.body.classList.remove('exit-offer-open');post('/api/public/stores/'+CONFIG.storeId+'/exit-offers/'+CONFIG.id+'/reject',payload()).catch(()=>{});continueBack()}async function openCheckout(){const selected=document.querySelector('[name="heroBundleId"]:checked'),quantity=document.querySelector('#hero-quantity'),deviceKey='commera2-device-id';let deviceId=localStorage.getItem(deviceKey);if(!deviceId){deviceId=crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);localStorage.setItem(deviceKey,deviceId)}const checkout=await post('/api/public/'+encodeURIComponent(CONFIG.storeSlug)+'/'+encodeURIComponent(CONFIG.pageSlug)+'/checkouts',{intent:'open',quantity:Number(selected?.dataset.quantity||quantity?.value||1),bundleId:selected?.value?Number(selected.value):null,visitorSessionId:window.commera2VisitorSessionId||null,checkoutToken:VISITOR_TOKEN,deviceId,analyticsConsentGranted:window.commera2AnalyticsConsent?.()??false,consentGranted:window.commera2TrackingConsent?window.commera2TrackingConsent():true,behavior:{timeOnPageMs:Math.round(performance.now()),source:'exit_offer'}});return checkout.id}async function acceptOffer(){if(handled)return;claim.disabled=true;reject.disabled=true;close.disabled=true;offerStatus.textContent='Applying your offer…';try{const checkoutId=CONFIG.checkoutSessionId||await openCheckout(),out=await post('/api/public/checkouts/'+encodeURIComponent(checkoutId)+'/exit-offers/'+CONFIG.id+'/claim',payload({checkoutSessionId:checkoutId}));finish();hide();document.body.classList.remove('exit-offer-open');window.dispatchEvent(new CustomEvent('commera2:exit-offer-claimed',{detail:out}));if(CONFIG.context==='product_page')location.assign((location.pathname.startsWith('/s/')?'/s/'+encodeURIComponent(CONFIG.storeSlug):'')+'/checkout/'+encodeURIComponent(checkoutId));else{offerStatus.textContent=out.message||'Offer applied';const note=document.querySelector('#exit-offer-applied-note');if(note){note.hidden=false;note.textContent=out.message||'Exit offer applied'}}}catch(error){offerStatus.textContent=error.message;claim.disabled=false;reject.disabled=false;close.disabled=false}}claim.addEventListener('click',acceptOffer);reject.addEventListener('click',dismiss);close.addEventListener('click',dismiss);dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss()});
const confirmation=document.querySelector('#exit-confirm-dialog');
const stay=document.querySelector('#exit-confirm-stay');
const leave=document.querySelector('#exit-confirm-leave');
const guardKey=location.pathname+':'+CONFIG.id;
const arm=()=>{
  if(handled)return;
  if(history.state?.commera2ExitGuard!==guardKey)
    history.pushState({...history.state,commera2ExitGuard:guardKey},'',location.href);
  guardActive=true;
};
const closeConfirmation=()=>{if(confirmation.open)confirmation.close();};
const stayHere=()=>{
  closeConfirmation();
  backPending=false;
  document.body.classList.remove('exit-offer-open');
  arm();
};
stay.addEventListener('click',stayHere);
confirmation.addEventListener('cancel',event=>{event.preventDefault();stayHere();});
leave.addEventListener('click',()=>{
  closeConfirmation();
  document.body.classList.remove('exit-offer-open');
  attempt('back_attempt');
});
// Back is the only automatic trigger. Pointer movement and inactivity do nothing.
if(!handled){
  arm();
  addEventListener('popstate',event=>{
    if(!guardActive||handled||event.state?.commera2ExitGuard===guardKey)return;
    if(opening||dialog.open||confirmation.open){
      finish();hide();closeConfirmation();
      document.body.classList.remove('exit-offer-open');
      return;
    }
    backPending=true;
    try{
      confirmation.showModal();
      document.body.classList.add('exit-offer-open');
      stay.focus();
    }catch{finish();continueBack();}
  });
}
})();
