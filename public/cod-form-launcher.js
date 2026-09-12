(() => {
  const config=JSON.parse(document.querySelector('#cod-launch-settings').textContent);
  const popup=config.mode==='popup', host=document.createElement(popup?'dialog':'section');
  host.className=popup?'cod-popup-form':'cod-embedded-form';host.setAttribute('aria-label','Cash on delivery form');
  const message=document.createElement('p');message.setAttribute('role','status');host.append(message);
  const frame=document.createElement('iframe');frame.hidden=true;frame.title='Cash on delivery checkout';frame.style.cssText='width:100%;height:75vh;min-height:360px;border:0;background:white';
  host.append(frame);
  const style=document.createElement('style');style.textContent='.cod-popup-form{padding:42px 0 0;width:min(1060px,95vw);max-width:95vw;border:0;border-radius:8px;max-height:92vh}.cod-popup-form::backdrop{background:#0008}.cod-popup-form>button{position:absolute;right:10px;top:8px;width:30px;height:30px;background:#fff;border:1px solid #ccd6dc;border-radius:4px}.cod-embedded-form{max-width:1100px;margin:28px auto}.cod-popup-form>p,.cod-embedded-form>p{margin:10px 20px}';document.head.append(style);
  let loading=false,loaded=false,selection='',trigger=null;
  if(popup){const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Close checkout');close.title='Close checkout';const icon=document.createElement('img');icon.src='/icons/x.svg';icon.alt='';icon.width=18;icon.height=18;close.append(icon);close.style.cssText='display:grid;place-items:center;min-height:30px;padding:0;color:#17252a';close.onclick=()=>host.close();host.append(close);document.body.append(host);host.addEventListener('close',()=>trigger?.focus());}
  else (document.querySelector('main.landing')||document.body).append(host);
  frame.addEventListener('load',()=>{
    if(!loaded)return;
    try{
      const doc=frame.contentDocument, path=frame.contentWindow.location.pathname;
      if(!path.includes('/checkout/')) {location.assign(frame.contentWindow.location.href);return;}
      const css=doc.createElement('style');css.textContent='.store-site-header,.store-site-footer,.store-announcement,.checkout-header,.checkout-progress{display:none!important}.checkout-shell{padding:16px!important;margin:0 auto!important}.checkout-page .dedicated-checkout-form.checkout-wrap{padding-top:0}.checkout-page .checkout-summary-toggle,.checkout-page .checkout-summary-toggle span,.checkout-page .checkout-summary-toggle strong{color:#17252a!important}';doc.head.append(css);
    }catch{message.textContent='Open checkout in a new page to continue.';}
  });
  async function show(button,scroll=true){
    trigger=button||trigger;if(popup&&!host.open)host.showModal();
    const selected=document.querySelector('[name="heroBundleId"]:checked'), quantity=document.querySelector('#hero-quantity');
    const payload={intent:'open',quantity:Number(selected?.dataset.quantity||quantity?.value||1),bundleId:selected?.value?Number(selected.value):null,
      visitorSessionId:window.commera2VisitorSessionId||null,checkoutToken:typeof VISITOR_TOKEN==='undefined'?null:VISITOR_TOKEN,
      deviceId:storageGet('local','commera2-device-id')||'',analyticsConsentGranted:window.commera2AnalyticsConsent?.()??false,consentGranted:window.commera2TrackingConsent?.()??false,
      behavior:{timeOnPageMs:Math.round(performance.now()),source:'product_page'}};
    const key=JSON.stringify([payload.quantity,payload.bundleId]);
    if(loading||loaded&&selection===key){if(!popup&&scroll)host.scrollIntoView({behavior:'smooth'});return;}
    loading=true;message.textContent='Opening checkout...';
    try{const response=await fetch(`/api/public/${encodeURIComponent(config.store)}/${encodeURIComponent(config.page)}/checkouts`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}),out=await response.json();if(!response.ok)throw Error(out.error||'Could not open checkout');selection=key;loaded=true;frame.src=`/s/${encodeURIComponent(config.store)}/checkout/${encodeURIComponent(out.id)}`;frame.hidden=false;message.textContent='';if(!popup&&scroll)host.scrollIntoView({behavior:'smooth'});}catch(error){message.textContent=error.message;}finally{loading=false;}
  }
  document.addEventListener('click',event=>{const button=event.target.closest('[data-direct-checkout]');if(!button)return;event.preventDefault();event.stopImmediatePropagation();show(button);},true);
  if(!popup){const button=document.createElement('button');button.type='button';button.className='hero-cta';button.textContent='Open delivery form';button.onclick=()=>{show(button);};host.prepend(button);const observer=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){observer.disconnect();show(null,false);}});observer.observe(host);}
})();
