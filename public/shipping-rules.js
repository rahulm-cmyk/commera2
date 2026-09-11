export async function mountShippingRules({root,storeId,products,api,esc,openForm,reload,toast,currency}) {
  const marker=root.querySelector('#add-shipping-method'),endpoint=`/api/stores/${storeId}/shipping-rates`,data=await api(endpoint);
  if(!marker?.isConnected||!root.contains(marker))return;
  const list=value=>(value||[]).join(', '),number=value=>value??'';
  const choices=(name,selected)=>`<div class="shipping-product-choices">${products.map(p=>`<label><input type="checkbox" name="${name}_${p.id}" ${selected?.includes(p.id)?'checked':''}>${esc(p.name)}</label>`).join('')}</div>`;
  function edit(rate) {
    const r=rate?.rules||{};
    openForm(rate?'Edit shipping rate':'Add Shipping Method',`<label class="field">Method Name<input name="name" value="${esc(rate?.name||'')}" maxlength="100" required></label><label class="field">Shipping Charge (${esc(currency)})<input type="number" name="charge" min="0" step="0.01" value="${(rate?.chargePaise||0)/100}" required></label><label class="field">Delivery description<input name="description" maxlength="180" value="${esc(r.description||'')}"></label><label class="field checkbox"><input type="checkbox" name="enabled" ${rate?.enabled!==false?'checked':''}><span>Enabled</span></label><details class="shipping-rate-conditions" ${Object.values(r).some(v=>Array.isArray(v)?v.length:v!==null&&v!=='')?'open':''}><summary>Conditions</summary><div class="form-columns"><label class="field">Minimum order (${esc(currency)})<input name="minOrder" type="number" step="0.01" min="0" value="${r.minOrderPaise==null?'':r.minOrderPaise/100}"></label><label class="field">Maximum order (${esc(currency)})<input name="maxOrder" type="number" step="0.01" min="0" value="${r.maxOrderPaise==null?'':r.maxOrderPaise/100}"></label></div><div class="form-columns"><label class="field">Minimum weight (g)<input name="minWeight" type="number" min="0" step="1" value="${number(r.minWeightGrams)}"></label><label class="field">Maximum weight (g)<input name="maxWeight" type="number" min="0" step="1" value="${number(r.maxWeightGrams)}"></label></div><label class="field">Countries<input name="countries" placeholder="Any country" value="${esc(list(r.countries))}"></label><label class="field">States / regions<input name="states" placeholder="Any state" value="${esc(list(r.states))}"></label><details><summary>Only these products</summary>${choices('include',r.includeProducts)}</details><details><summary>Exclude these products</summary>${choices('exclude',r.excludeProducts)}</details></details>`,'Save',v=>{
      const numeric=(name,multiplier=1)=>v[name]===''?null:Math.round(Number(v[name])*multiplier);
      const ids=prefix=>Object.keys(v).filter(key=>key.startsWith(prefix+'_')&&v[key]==='on').map(key=>Number(key.split('_')[1]));
      return api(endpoint+(rate?`/${rate.id}`:''),{method:rate?'PATCH':'POST',body:JSON.stringify({name:v.name,chargePaise:Math.round(Number(v.charge)*100),enabled:v.enabled==='on',rules:{description:v.description,minOrderPaise:numeric('minOrder',100),maxOrderPaise:numeric('maxOrder',100),minWeightGrams:numeric('minWeight'),maxWeightGrams:numeric('maxWeight'),countries:v.countries.split(',').map(s=>s.trim()).filter(Boolean),states:v.states.split(',').map(s=>s.trim()).filter(Boolean),includeProducts:ids('include'),excludeProducts:ids('exclude')}})});
    });
  }
  root.querySelector('#add-shipping-method').onclick=()=>edit(null);
  root.querySelectorAll('.toggle-method').forEach(button=>{
    const rate=data.rates.find(r=>r.id===Number(button.dataset.id)),editButton=document.createElement('button');
    editButton.className='secondary';editButton.type='button';editButton.title='Edit shipping rate';editButton.setAttribute('aria-label',`Edit ${rate.name}`);editButton.innerHTML='<img src="/icons/pencil.svg" width="16" height="16" alt="">';editButton.onclick=()=>edit(rate);button.before(editButton);
  });
  const section=document.createElement('section');section.className='panel';section.innerHTML=`<details><summary>Product shipping weights</summary><form id="shipping-weights"><div class="shipping-weight-grid">${products.map(p=>`<label class="field">${esc(p.name)} (g)<input type="number" min="0" step="1" data-weight-id="${p.id}" value="${data.weights.find(w=>w.productId===p.id)?.grams??''}" placeholder="Not set"></label>`).join('')}</div><button class="primary" type="submit">Save weights</button></form></details>`;
  root.querySelector('#shipping-general').before(section);
  section.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const button=section.querySelector('button');button.disabled=true;
    try{const weights=[...section.querySelectorAll('[data-weight-id]')].map(el=>({productId:Number(el.dataset.weightId),grams:el.value===''?null:Number(el.value)}));await api(endpoint+'/weights',{method:'PUT',body:JSON.stringify({weights})});toast('Shipping weights saved');await reload();}catch(error){toast(error.message);}finally{button.disabled=false;}
  };
}
