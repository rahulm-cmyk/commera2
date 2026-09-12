(() => {
  const node = document.querySelector('#cod-builder-settings'), form = document.querySelector('#cod-form');
  if (!node || !form) return;
  const config = JSON.parse(node.textContent), panel = form.querySelector('.checkout-form-panel');
  import('./checkout-motion.js').then(({ animateCheckout }) => animateCheckout(form, config.animation)).catch(() => {});
  if (config.style) {
    const css = document.createElement('style'), s = config.style;
    css.textContent = `.checkout-page .checkout-form-panel{--page-text:${s.text};background:${s.background};color:${s.text};border-radius:${s.radius}px}.place-order-button{background:${s.button}!important;color:${s.buttonText}!important;border-radius:${s.radius}px!important}`;
    document.head.append(css);
  }
  const names = {fullName:'name',address1:'address',address2:'addressLine2'};
  const shipping = document.createElement('fieldset');shipping.className='bundle-options cod-shipping-options';shipping.id='cod-shipping-options';
  panel.querySelector('.checkout-payment').before(shipping);
  function showShipping(out) {
    shipping.replaceChildren();shipping.hidden=!out.shippingMethods?.length&&!out.shippingUnavailable;
    const legend=document.createElement('legend');legend.textContent='Delivery method';shipping.append(legend);
    if(out.shippingUnavailable){const notice=document.createElement('p');notice.textContent='No delivery method available. Check your delivery address.';notice.setAttribute('role','status');shipping.append(notice);}
    for(const rate of out.shippingMethods||[]) {
      const label=document.createElement('label');label.className='bundle-choice';
      const radio=document.createElement('input');radio.type='radio';radio.name='shippingMethodId';radio.value=rate.id;radio.checked=rate.id===out.shippingMethodId;radio.inert=form.getAttribute('aria-busy')==='true';
      const description=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('small');
      title.textContent=`${rate.name} - ${rate.shippingPaise?new Intl.NumberFormat(undefined,{style:'currency',currency:config.currency}).format(rate.shippingPaise/100):'Free'}`;detail.textContent=rate.description;
      description.append(title,detail);label.append(radio,description);shipping.append(label);
    }
  }
  showShipping(config);
  document.addEventListener('DOMContentLoaded',()=>{
    const original=setSummary;setSummary=out=>{original(out);showShipping(out);};
    shipping.addEventListener('change',()=>save('draft').catch(reportCheckoutError));
  });
  if (config.fieldOrder) {
    const target = form.querySelector('.checkout-fields--contact');
    if (target) {
      for (const key of config.fieldOrder) {
        const field = form.querySelector(`[data-field="${names[key] || key}"]`);
        if (field) target.append(field);
      }
      form.querySelector('.checkout-secondary-contact')?.remove();
      form.querySelector('.checkout-fields--delivery')?.closest('.checkout-section')?.remove();
      const heading = form.querySelector('#contact-heading');
      if (heading) heading.textContent = 'Your delivery details';
      const number = form.querySelector('.checkout-payment .checkout-section-heading > span');
      if (number) number.textContent = '2';
    }
  }
  if (config.addons.length) {
    const offers = document.createElement('fieldset'); offers.className = 'bundle-options cod-addon-options';
    const legend = document.createElement('legend'); legend.textContent = 'Optional extras'; offers.append(legend);
    const submitted = document.createElement('input'); submitted.type = 'hidden'; submitted.name = 'addonsSubmitted'; submitted.value = 'true'; offers.append(submitted);
    for (const offer of config.addons) {
      const label = document.createElement('label'); label.className = 'bundle-choice';
      const input = document.createElement('input'); input.type = 'checkbox'; input.name = `addon_${offer.productId}`; input.checked = config.selectedAddons.includes(offer.productId);
      const text = document.createElement('span'); text.textContent = `${offer.title} (+${new Intl.NumberFormat(undefined,{style:'currency',currency:config.currency}).format(offer.pricePaise/100)})`;
      label.append(input,text); offers.append(label);
    }
    panel.querySelector('.checkout-payment').before(offers);
    document.addEventListener('DOMContentLoaded',()=>{
      const originalSummary = setSummary;
      const showExtras = out => {
        const list = document.querySelector('#checkout-summary-body dl');
        list?.querySelectorAll('[data-addon-summary]').forEach(row=>row.remove());
        for(const item of out.addons || []) {
          const row=document.createElement('div');row.dataset.addonSummary='';
          const name=document.createElement('dt'),value=document.createElement('dd');name.textContent=item.title;
          value.textContent=new Intl.NumberFormat(undefined,{style:'currency',currency:config.currency}).format(item.pricePaise/100);
          row.append(name,value);list?.querySelector('.summary-total')?.before(row);
        }
      };
      setSummary = out => { originalSummary(out); showExtras(out); };
      showExtras({addons:config.addons.filter(a=>config.selectedAddons.includes(a.productId))});
      offers.addEventListener('change',()=>save('draft').catch(reportCheckoutError));
    });
  }
  if (!config.customFields.length) return;
  const section = document.createElement('section'); section.className = 'checkout-section cod-custom-fields';
  const heading = document.createElement('h2'); heading.textContent = 'Additional details'; section.append(heading);
  for (const field of config.customFields) {
    const label = document.createElement('label'); label.className = 'checkout-field';
    const caption = document.createElement('span'); caption.textContent = field.label; label.append(caption);
    const control = document.createElement(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input');
    control.name = `custom_${field.id}`; control.required = field.required; control.id = `checkout-${control.name}`;
    control.setAttribute('aria-label',field.label);control.setAttribute('aria-describedby',`error-${control.name}`);
    label.dataset.field = control.name;
    if (field.type === 'checkbox') {
      control.type = 'checkbox'; control.checked = config.values[field.id] === true;
      const hidden = document.createElement('input'); hidden.type = 'hidden'; hidden.name = control.name; hidden.value = 'false'; label.append(hidden);
    } else {
      if (field.type === 'select') for (const choice of ['',...field.options]) { const option = document.createElement('option'); option.value = choice; option.textContent = choice || 'Select an option'; control.append(option); }
      control.value = config.values[field.id] || ''; control.placeholder = field.placeholder; control.maxLength = 1000;
    }
    const error = document.createElement('small');error.id=`error-${control.name}`;error.className='checkout-field-error';error.setAttribute('role','alert');
    label.append(control,error); section.append(label);
  }
  panel.querySelector('.checkout-payment').before(section);
})();
