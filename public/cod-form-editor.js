import { animateCheckout } from './checkout-motion.js';

export function mountCodFormEditor({ form, config, esc, products = [] }) {
  const pane = form.querySelector('[data-cod-pane="fields"]');
  const original = [...pane.querySelectorAll('.cod-field-card')];
  const order = config.fieldOrder || Object.keys(config.fields);
  const custom = structuredClone(config.customFields || []);
  const addons = structuredClone(config.addons || []);
  const style = { background:'#ffffff',text:'#17252a',button:'#00838b',buttonText:'#ffffff',radius:6,...config.style };
  const icon = name => `<img src="/icons/${name}.svg" width="16" height="16" alt="">`;
  pane.innerHTML = `<div class="cod-editor-layout"><div class="cod-editor-controls"><div class="cod-editor-title"><h2>Customer fields</h2><button type="button" id="cod-add-custom" class="secondary">${icon('plus')} Add field</button></div><div id="cod-edit-fields"></div><div id="cod-custom-fields"></div><h3>Form appearance</h3><div class="cod-colors">${[['background','Background'],['text','Text'],['button','Button'],['buttonText','Button text']].map(([key,label])=>`<label>${label}<input type="color" name="cod-style-${key}" value="${style[key]}"></label>`).join('')}</div><label class="field">Corner radius<input type="range" name="cod-style-radius" min="0" max="24" value="${style.radius}"></label></div><aside class="cod-editor-preview"><div class="cod-editor-title"><h3>Form preview</h3><span>Unsaved changes</span></div><div id="cod-live-preview"></div></aside></div>`;
  const motion = document.createElement('div');
  motion.className = 'cod-motion-controls';
  motion.innerHTML = `<label class="field">Checkout animation<select name="cod-animation" aria-label="Checkout animation">${[['none','Off'],['fade','Fade'],['slide','Slide']].map(([value,label])=>`<option value="${value}" ${value === (config.animation || 'none') ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button type="button" class="secondary" title="Preview checkout animation" aria-label="Preview checkout animation">${icon('play')} Preview</button>`;
  pane.querySelector('.cod-editor-controls').append(motion);
  motion.querySelector('button').onclick = () => {
    const node = pane.querySelector('#cod-live-preview');
    node.scrollTop = 0;
    node.scrollIntoView({ block: 'nearest' });
    animateCheckout(node, form.elements['cod-animation'].value);
  };
  motion.querySelector('select').addEventListener('change', () => animateCheckout(pane.querySelector('#cod-live-preview'), form.elements['cod-animation'].value));
  const host = pane.querySelector('#cod-edit-fields');
  order.forEach(key => {
    const article = original.find(node => node.querySelector(`[name="field-${key}-label"]`));
    if (!article) return;
    const row = document.createElement('details'); row.className = 'cod-field-row'; row.dataset.fieldKey = key;
    row.innerHTML = `<summary><span>${esc(config.fields[key].label)}</span><span class="cod-field-tools"><button type="button" data-move="-1" title="Move up" aria-label="Move ${esc(config.fields[key].label)} up">${icon('chevron-up')}</button><button type="button" data-move="1" title="Move down" aria-label="Move ${esc(config.fields[key].label)} down">${icon('chevron-down')}</button>${icon('pencil')}</span></summary>`;
    article.querySelector('.cod-field-card-head')?.remove();
    article.querySelector('.cod-field-lock-note')?.remove(); row.append(article); host.append(row);
  });
  host.addEventListener('click',event => {
    const button = event.target.closest('[data-move]'); if (!button) return;
    event.preventDefault(); const row = button.closest('[data-field-key]');
    if (button.dataset.move === '-1' && row.previousElementSibling) host.insertBefore(row,row.previousElementSibling);
    if (button.dataset.move === '1' && row.nextElementSibling) host.insertBefore(row.nextElementSibling,row);
    preview();
  });
  function drawCustom() {
    const target = pane.querySelector('#cod-custom-fields');
    target.innerHTML = custom.map((field,index)=>`<details class="cod-field-row" open><summary><span>${esc(field.label)}</span><button type="button" data-remove-custom="${index}" title="Remove field" aria-label="Remove ${esc(field.label)}">${icon('trash-2')}</button></summary><div class="cod-field-card"><label class="field">Label<input data-custom-index="${index}" data-custom-key="label" value="${esc(field.label)}" maxlength="100" required></label><label class="field">Type<select data-custom-index="${index}" data-custom-key="type">${['text','textarea','select','checkbox'].map(type=>`<option value="${type}" ${field.type===type?'selected':''}>${{text:'Short answer',textarea:'Long answer',select:'Dropdown',checkbox:'Checkbox'}[type]}</option>`).join('')}</select></label><label class="field">Placeholder<input data-custom-index="${index}" data-custom-key="placeholder" value="${esc(field.placeholder||'')}"></label><label class="field" ${field.type==='select'?'':'hidden'}>Choices (one per line)<textarea data-custom-index="${index}" data-custom-key="options">${esc((field.options||[]).join('\n'))}</textarea></label><label><input type="checkbox" data-custom-index="${index}" data-custom-key="required" ${field.required?'checked':''}> Required</label></div></details>`).join('');
    target.querySelectorAll('[data-remove-custom]').forEach(button=>button.onclick=()=>{custom.splice(Number(button.dataset.removeCustom),1);drawCustom();preview();});
    target.oninput = event => {
      const control=event.target, field=custom[Number(control.dataset.customIndex)], key=control.dataset.customKey;
      if (!field || !key) return;
      field[key]=key==='required'?control.checked:key==='options'?control.value.split('\n'):control.value;
      if(key==='label')control.closest('details').querySelector('summary > span').textContent=field.label;
      if(key==='type') drawCustom(); preview();
    };
  }
  pane.querySelector('#cod-add-custom').onclick=()=>{
    if(custom.length>=30)return;
    custom.push({id:`field_${crypto.randomUUID().replaceAll('-','').slice(0,16)}`,label:'Additional information',type:'text',required:false,placeholder:'',options:[]});drawCustom();preview();
  };
  const addonPane = document.createElement('section'); addonPane.className = 'panel cod-settings-pane'; addonPane.dataset.codPane = 'addons';
  addonPane.innerHTML = `<div class="panel-head"><h2>Optional extras</h2><button type="button" class="secondary" id="cod-add-addon">${icon('plus')} Add product</button></div><div id="cod-addon-list"></div>`;
  form.append(addonPane);
  function drawAddons() {
    const list = addonPane.querySelector('#cod-addon-list');
    list.innerHTML = addons.length ? addons.map((a,i)=>`<div class="cod-field-row"><div class="cod-field-card"><label class="field">Product<select data-addon-index="${i}" data-addon-key="productId" required><option value="">Select a product</option>${products.filter(p=>p.active || p.id===a.productId).map(p=>`<option value="${p.id}" ${p.id===a.productId?'selected':''}>${esc(p.name)}</option>`).join('')}</select></label><div class="form-grid"><label class="field">Label<input data-addon-index="${i}" data-addon-key="title" value="${esc(a.title)}" maxlength="100" required></label><label class="field">Add-on price<input type="number" min="0" step="0.01" data-addon-index="${i}" data-addon-key="pricePaise" value="${a.pricePaise/100}" required></label></div><button type="button" class="secondary" data-remove-addon="${i}" title="Remove add-on">${icon('trash-2')} Remove</button></div></div>`).join('') : '<p class="muted">No optional extras added.</p>';
    list.querySelectorAll('[data-remove-addon]').forEach(button=>button.onclick=()=>{addons.splice(Number(button.dataset.removeAddon),1);drawAddons();});
    list.oninput=event=>{
      const el=event.target, a=addons[Number(el.dataset.addonIndex)], key=el.dataset.addonKey;
      if(!a||!key)return;
      a[key]=key==='productId'?Number(el.value):key==='pricePaise'?Math.round(Number(el.value)*100):el.value;
      if(key==='productId') {const p=products.find(p=>p.id===a.productId); if(p){a.title=p.name;a.pricePaise=p.pricePaise;}drawAddons();}
    };
    addonPane.querySelector('#cod-add-addon').disabled=addons.length>=10;
  }
  addonPane.querySelector('#cod-add-addon').onclick=()=>{addons.push({productId:0,title:'',pricePaise:0});drawAddons();};
  drawAddons();
  const read = () => ({animation:form.elements['cod-animation'].value,addons:structuredClone(addons),fieldOrder:[...host.querySelectorAll('[data-field-key]')].map(row=>row.dataset.fieldKey),customFields:structuredClone(custom),style:Object.fromEntries([...pane.querySelectorAll('[name^="cod-style-"]')].map(input=>[input.name.slice(10),input.type==='range'?Number(input.value):input.value]))});
  function preview() {
    const draft=read(), node=pane.querySelector('#cod-live-preview');
    node.style.background=draft.style.background;node.style.color=draft.style.text;node.style.borderRadius=`${draft.style.radius}px`;
    const fields=draft.fieldOrder.filter(key=>form.elements[`field-${key}-show`].checked).map(key=>({label:form.elements[`field-${key}-label`].value,placeholder:form.elements[`field-${key}-placeholder`].value}));
    for(const row of host.querySelectorAll('[data-field-key]')) row.querySelector('summary > span').textContent=form.elements[`field-${row.dataset.fieldKey}-label`].value;
    node.innerHTML=`<h3>${esc(form.elements.heading.value)}</h3><p>${esc(form.elements.subheading.value)}</p>${[...fields,...custom].map(f=>`<label class="field">${esc(f.label)}${f.type==='select'?`<select tabindex="-1">${(f.options||[]).map(v=>`<option>${esc(v)}</option>`).join('')}</select>`:f.type==='textarea'?'<textarea tabindex="-1"></textarea>':`<input tabindex="-1" type="${f.type==='checkbox'?'checkbox':'text'}" placeholder="${esc(f.placeholder||'')}">`}</label>`).join('')}<button type="button" tabindex="-1" style="background:${draft.style.button};color:${draft.style.buttonText};border-radius:${draft.style.radius}px">${esc(form.elements.submitButtonText.value)}</button>`;
    node.inert=true;
  }
  form.addEventListener('invalid',event=>{
    const section=event.target.closest('[data-cod-pane]');
    if(section) document.querySelector(`[data-cod-section="${section.dataset.codPane}"]`)?.click();
    const details=event.target.closest('details');if(details)details.open=true;
  },true);
  form.addEventListener('input',preview);drawCustom();preview();return { read };
}
