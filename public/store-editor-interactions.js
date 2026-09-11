// Reconcile editor-owned markup without resetting images, focus or open details.
export function reconcileElement(current, next) {
  if (current.nodeType !== next.nodeType || current.nodeName !== next.nodeName) {
    current.replaceWith(next);
    return next;
  }
  if (current.nodeType === 3) {
    if (current.nodeValue !== next.nodeValue) current.nodeValue = next.nodeValue;
    return current;
  }
  if (current.nodeType !== 1) return current;
  const preserved = name => name.startsWith('data-store-editor-') || (name === 'open' && current.tagName === 'DETAILS');
  for (const attribute of [...current.attributes]) {
    if (!next.hasAttribute(attribute.name) && !preserved(attribute.name)) current.removeAttribute(attribute.name);
  }
  for (const attribute of next.attributes) {
    if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
  }
  const newChildren = [...next.childNodes];
  const compatible = (a,b) => a.nodeType===b.nodeType && a.nodeName===b.nodeName && (a.nodeType!==1 || a.className===b.className);
  newChildren.forEach((child, index) => {
    let existing=current.childNodes[index];
    if (existing && !compatible(existing,child)) {
      const match=[...current.childNodes].slice(index+1).find(node=>compatible(node,child));
      if (match) {current.insertBefore(match,existing);existing=match;}
      else {current.insertBefore(child,existing);return;}
    }
    if (existing) reconcileElement(existing, child);
    else current.append(child);
  });
  [...current.childNodes].slice(newChildren.length).forEach(child => child.remove());
  return current;
}

const named = (...names) => names.map(name => `[name="${name}"]`).join(',');
const field = (...names) => names.map(name => `[data-section-field="${name}"]`).join(',');
const coreBlocks = {
  announcement: [
    { key:'message', label:'Text', fields:named('announcementMessage'), preview:'.store-announcement > span', icon:'type' },
    { key:'link', label:'Link', fields:named('announcementLinkText','announcementLinkUrl'), preview:'.store-announcement > a', icon:'link' },
  ],
  header: [{ key:'menu', label:'Menu', fields:'#store-menu-links,#store-menu-add,#store-menu-empty,.store-field-group-title,.store-field-hint', preview:'.store-site-header nav', icon:'menu' }],
  banner: [
    { key:'image', label:'Image', fields:'[name="bannerImage"]', preview:'.store-home-banner', icon:'image' },
    { key:'heading', label:'Heading', fields:named('bannerHeading','heroAccent','heroEyebrow'), preview:'.store-home-hero-copy h1', icon:'type' },
    { key:'text', label:'Text', fields:named('bannerSubheading'), preview:'.store-home-hero-copy p', icon:'align-left' },
    { key:'button', label:'Button', fields:named('buttonText','buttonTargetType','buttonProductId','buttonPageId','buttonTargetUrl','heroSecondaryText','heroSecondaryUrl'), preview:'.hero-cta', icon:'mouse-pointer-2' },
    { key:'highlights', label:'Highlights', fields:named('heroBadges'), preview:'.hero-badges', icon:'list-checks' },
  ],
  featured: [
    { key:'heading', label:'Heading', fields:named('sectionHeading'), preview:'h2', icon:'type' },
    { key:'products', label:'Products', fields:'.store-product-choices', preview:'.featured-grid', icon:'package' },
  ],
  footer: [
    { key:'contact', label:'Contact information', fields:named('footerContact'), preview:'#contact', icon:'align-left' },
    { key:'products', label:'Product links', fields:named('footerShowProducts'), preview:'nav[aria-label="Products"]', icon:'menu' },
    { key:'policies', label:'Store policies', fields:'#store-policy-connections', preview:'nav[aria-label="Policies"]', icon:'shield-check' },
  ],
};

export function editorBlocks(id, form) {
  if (coreBlocks[id]) return coreBlocks[id];
  const panel = form.querySelector(`[data-theme-section-id="${id}"]`);
  if (!panel) return [];
  const blocks = [{key:'heading',label:'Heading',fields:field('heading','eyebrow'),preview:'h2',icon:'type'}];
  const type = panel.dataset.themeSectionType;
  if (['rich-text','image-with-text'].includes(type)) {
    blocks.push({key:'text',label:'Text',fields:field('text'),preview:'.theme-section-inner > p,.theme-section-copy > p',icon:'align-left'});
    blocks.push({key:'button',label:'Button',fields:`${field('buttonText','buttonUrl')},[data-section-destination]`,preview:'.theme-section-button',icon:'mouse-pointer-2'});
  }
  if (type === 'image-with-text') blocks.unshift({key:'image',label:'Image',fields:'[data-section-image]',preview:'.theme-section-inner > img',icon:'image'});
  [...panel.querySelectorAll('[data-theme-block]')].forEach((row,index) => {
    const label = row.querySelector('[data-section-field="question"],[data-section-field="heading"],[data-section-field="name"]')?.value;
    const selector = type === 'faq' ? '.theme-faq-list > details' : type === 'benefits' ? '.theme-benefit-grid > article' : type==='image-grid'?'.theme-image-grid > article':type==='comparison'?'.theme-comparison tbody > tr':'.theme-testimonial-grid > figure';
    blocks.push({key:`block-${index}`,label:label || `Block ${index+1}`,row,index,preview:selector,icon:type==='faq'?'list-collapse':type==='testimonials'?'quote':'circle-check'});
  });
  return blocks;
}

export function showEditorBlock(panel, block) {
  if (!panel) return;
  panel.querySelectorAll('.editor-context-hidden').forEach(element => element.classList.remove('editor-context-hidden'));
  if (!block) return;
  for (const child of panel.children) {
    const match = block.row ? child.contains(block.row) : child.matches(block.fields) || [...child.querySelectorAll(block.fields)].some(control=>!control.closest('[data-theme-block]'));
    child.classList.toggle('editor-context-hidden', !match);
  }
  panel.querySelectorAll('.botanical-banner-controls > .field').forEach(child=>child.classList.toggle('editor-context-hidden',!child.querySelector(block.fields)));
  if (block.row) panel.querySelectorAll('[data-theme-block]').forEach(row => row.classList.toggle('editor-context-hidden',row!==block.row));
}

export function annotateEditorPreview(doc, form) {
  doc.querySelectorAll('[data-store-editor-block]').forEach(node => node.removeAttribute('data-store-editor-block'));
  doc.querySelectorAll('[data-store-editor-section]').forEach(section => {
    for (const block of editorBlocks(section.dataset.storeEditorSection,form)) {
      const node = block.index === undefined ? section.querySelector(block.preview) : section.querySelectorAll(block.preview)[block.index];
      if (node) node.dataset.storeEditorBlock = block.key;
    }
  });
}

export function createPreviewInspector(frame, { enabled, select, addSection, label }) {
  let doc, selectedId='', selectedKey='', hovered=null, overlay, selectedBox, hoverBox, insertion, observer;
  let scheduled=0;
  const targetFor = (id,key) => {
    const section=doc?.querySelector(`[data-store-editor-section="${id}"]`);
    return key ? section?.querySelector(`[data-store-editor-block="${key}"]`) || section : section;
  };
  const place = (box,target,text) => {
    const rect=target?.getBoundingClientRect();
    box.hidden=!enabled() || !rect || !rect.width || !rect.height || rect.bottom<0 || rect.top>doc.documentElement.clientHeight;
    if (box.hidden) return;
    Object.assign(box.style,{left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`});
    box.firstChild.textContent=text;
    box.firstChild.style.top=rect.top<24?'0':'-24px';
  };
  const draw = () => {
    scheduled=0;
    if (!frame.isConnected || !overlay?.isConnected) {observer?.disconnect();return;}
    place(selectedBox,targetFor(selectedId,selectedKey),label(selectedId,selectedKey));
    const section=hovered?.closest('[data-store-editor-section]');
    place(hoverBox,hovered,section?label(section.dataset.storeEditorSection,hovered.dataset.storeEditorBlock):'');
    const selected=targetFor(selectedId,'');
    const insertAfter=section?.parentElement?.classList.contains('storefront-home-content')?section:selected;
    const rect=insertAfter?.getBoundingClientRect();
    insertion.hidden=!enabled() || !rect || !insertAfter.parentElement.classList.contains('storefront-home-content') || rect.bottom<16 || rect.bottom>doc.documentElement.clientHeight-16;
    if (!insertion.hidden) {
      insertion.dataset.afterSection=insertAfter.dataset.storeEditorSection;
      insertion.style.left=`${rect.left+rect.width/2-14}px`;
      insertion.style.top=`${rect.bottom-14}px`;
    }
  };
  const refresh = () => { if (frame.isConnected && doc?.defaultView && !scheduled) scheduled=doc.defaultView.requestAnimationFrame(draw); };
  const mount = () => {
    const nextDoc=frame.contentDocument;
    if (!nextDoc?.body || nextDoc === doc) return;
    observer?.disconnect();
    if (scheduled) doc?.defaultView?.cancelAnimationFrame(scheduled);
    scheduled=0;doc=nextDoc;hovered=null;
    const style=doc.createElement('style');
    style.textContent='#commera-preview-overlay{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font:12px/24px Arial,sans-serif;color:white}#commera-preview-overlay [hidden]{display:none!important}.commera-preview-outline{position:absolute;box-sizing:border-box;border:1px solid #3559d6;pointer-events:none}.commera-preview-outline.selected{border-width:2px}.commera-preview-outline>span{position:absolute;left:-1px;max-width:260px;height:24px;padding:0 7px;border-radius:3px 3px 0 0;background:#3559d6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.commera-preview-insert{position:absolute;width:28px;height:28px;min-height:0;padding:0;border:2px solid white;border-radius:50%;background:#3559d6;color:white;font:22px/22px Arial;cursor:pointer;pointer-events:auto}';
    doc.head.append(style);
    overlay=doc.createElement('div');overlay.id='commera-preview-overlay';
    overlay.innerHTML='<div class="commera-preview-outline selected" hidden><span></span></div><div class="commera-preview-outline hover" hidden><span></span></div><button class="commera-preview-insert" type="button" title="Add section here" aria-label="Add section here" hidden>+</button>';
    doc.body.append(overlay);[selectedBox,hoverBox,insertion]=overlay.children;
    doc.addEventListener('pointermove',event=>{
      if (overlay.contains(event.target)) return;
      hovered=event.target.closest?.('[data-store-editor-block],[data-store-editor-section]');refresh();
    });
    doc.addEventListener('pointerleave',()=>{hovered=null;refresh();});
    doc.addEventListener('submit',event=>{event.preventDefault();event.stopImmediatePropagation();},true);
    doc.addEventListener('click',event=>{
      if (event.target.closest('.commera-preview-insert')) {
        event.preventDefault();event.stopImmediatePropagation();
        const rect=insertion.getBoundingClientRect(),frameRect=frame.getBoundingClientRect(),scale=frameRect.width/frame.offsetWidth;
        addSection(insertion.dataset.afterSection,{left:frameRect.left+rect.left*scale,top:frameRect.top+rect.bottom*scale});return;
      }
      // Never let an editor preview navigate into checkout or away from its origin.
      if (enabled() || event.target.closest?.('a,button')) { event.preventDefault();event.stopImmediatePropagation(); }
      if (!enabled()) return;
      const section=event.target.closest?.('[data-store-editor-section]');
      if (section) select(section.dataset.storeEditorSection,event.target.closest('[data-store-editor-block]')?.dataset.storeEditorBlock||'');
    },true);
    doc.addEventListener('scroll',refresh,true);
    doc.defaultView.addEventListener('resize',refresh);
    observer=new doc.defaultView.ResizeObserver(refresh);observer.observe(doc.body);
    refresh();
  };
  return {
    mount,refresh,
    select(id,key='',scroll=false) {
      selectedId=id;selectedKey=key;hovered=null;
      if (scroll) targetFor(id,key)?.scrollIntoView({block:'nearest',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
      refresh();
    },
  };
}

export function createSectionPicker(host, {catalog,icon,escape,choose}) {
  const dialog=document.createElement('dialog');
  dialog.className='store-section-popover';dialog.setAttribute('aria-label','Add section');
  dialog.innerHTML=`<div class="section-picker-search">${icon('search')}<input type="search" placeholder="Search sections" aria-label="Search sections"><button type="button" class="icon-button" aria-label="Close section picker" title="Close">${icon('x')}</button></div><div class="section-picker-body"><div class="section-picker-list">${catalog.map(item=>`<button type="button" data-add-theme-section="${item.type}">${icon(item.icon)}<span>${escape(item.label)}</span></button>`).join('')}<p hidden>No sections found</p></div><div class="section-picker-sample" aria-hidden="true"></div></div>`;
  host.append(dialog);
  const search=dialog.querySelector('input'),buttons=[...dialog.querySelectorAll('[data-add-theme-section]')],sample=dialog.querySelector('.section-picker-sample');
  let after='',opener;
  const samples={
    'rich-text':'<h3>A story worth sharing</h3><p>Introduce your brand and what makes it special.</p><span class="sample-cta">Discover more</span>',
    'image-with-text':'<div class="sample-image">'+icon('image')+'</div><div><h3>Made for every day</h3><p>Your image, your story.</p></div>',
    benefits:'<h3>The little extras</h3><div class="sample-columns"><div>'+icon('package')+'<b>Thoughtfully made</b></div><div>'+icon('truck')+'<b>Delivered with care</b></div></div>',
    testimonials:'<h3>From our customers</h3><blockquote>A lovely addition to my daily routine.<small>Customer name</small></blockquote>',
    faq:'<h3>Common questions</h3><p class="sample-question">When will my order arrive? <span>+</span></p><p class="sample-question">How do I get in touch? <span>+</span></p>',
    'image-grid':'<h3>The details that matter</h3><div class="sample-columns"><div>'+icon('image')+'<b>Your first image</b></div><div>'+icon('image')+'<b>Your second image</b></div></div>',
    comparison:'<h3>A closer look</h3><p class="sample-question">Feature <span>Your product</span></p><p class="sample-question">Materials <span>Details</span></p>',
  };
  const preview=button=>{buttons.forEach(item=>item.classList.toggle('active',item===button));sample.dataset.type=button.dataset.addThemeSection;sample.innerHTML=samples[button.dataset.addThemeSection];};
  buttons.forEach(button=>{
    button.addEventListener('pointerenter',()=>preview(button));button.addEventListener('focus',()=>preview(button));
    button.onclick=()=>{dialog.close();choose(button.dataset.addThemeSection,after);};
  });
  search.oninput=()=>{
    const query=search.value.trim().toLowerCase();
    buttons.forEach(button=>button.hidden=!button.textContent.toLowerCase().includes(query));
    const first=buttons.find(button=>!button.hidden);dialog.querySelector('.section-picker-list > p').hidden=Boolean(first);
    sample.hidden=!first;if(first)preview(first);
  };
  search.onkeydown=event=>{if(event.key==='ArrowDown'){event.preventDefault();buttons.find(button=>!button.hidden)?.focus();}};
  dialog.querySelector('.section-picker-search button').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  dialog.addEventListener('close',()=>opener?.isConnected&&opener.focus({preventScroll:true}));
  return (afterId='',anchor) => {
    after=afterId;opener=document.activeElement;search.value='';search.oninput();
    const rect=anchor||opener?.getBoundingClientRect?.()||{left:20,bottom:80};
    dialog.showModal();
    dialog.style.left=`${Math.max(12,Math.min(rect.left,innerWidth-dialog.offsetWidth-12))}px`;
    dialog.style.top=`${Math.max(68,Math.min(rect.bottom??rect.top,innerHeight-dialog.offsetHeight-12))}px`;
    search.focus();
  };
}
