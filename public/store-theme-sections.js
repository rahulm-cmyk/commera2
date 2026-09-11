export const themeSectionCatalog=[
  {type:'rich-text',label:'Rich text',description:'Heading, text and an optional button.',icon:'file-text'},
  {type:'image-with-text',label:'Image with text',description:'Pair an image with a clear story or offer.',icon:'panels-top-left'},
  {type:'benefits',label:'Benefits',description:'Show up to eight product or service advantages.',icon:'circle-check'},
  {type:'testimonials',label:'Testimonials',description:'Add quotes from real customers.',icon:'star'},
  {type:'faq',label:'Collapsible content',description:'Answer common questions in expandable rows.',icon:'menu'},
];
export const themeSectionLabel=type=>themeSectionCatalog.find(item=>item.type===type)?.label||'Section';
const field=(name,label,value='',kind='input')=>`<label class="field">${label}${kind==='textarea'?`<textarea data-section-field="${name}" rows="4">${value}</textarea>`:`<input data-section-field="${name}" value="${value}">`}</label>`;
const option=(value,label,selected)=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`;

export function newThemeSection(type) {
  const id=`section-${crypto.randomUUID().toLowerCase()}`;
  const common={id,type,visible:true,heading:themeSectionLabel(type),text:'',alignment:'left',colorScheme:'default',fullWidth:false};
  if(type==='rich-text')return {...common,buttonText:'',buttonUrl:''};
  if(type==='image-with-text')return {...common,image:null,imagePosition:'left',buttonText:'',buttonUrl:''};
  if(type==='benefits')return {...common,blocks:[{heading:'Benefit',text:'Explain why this matters to your customer.'}]};
  if(type==='testimonials')return {...common,blocks:[{quote:'Add a genuine customer quote.',name:'Customer name'}]};
  return {...common,blocks:[{question:'Common question',answer:'Add a clear answer.'}]};
}

function blockMarkup(type,block,esc) {
  if(type==='benefits')return `${field('heading','Heading',esc(block.heading))}${field('text','Text',esc(block.text),'textarea')}`;
  if(type==='testimonials')return `${field('quote','Quote',esc(block.quote),'textarea')}${field('name','Customer name',esc(block.name))}`;
  return `${field('question','Question',esc(block.question))}${field('answer','Answer',esc(block.answer),'textarea')}`;
}

export function themeSectionBlock(type,block,esc,icon) {
  return `<article class="theme-block-row" data-theme-block draggable="true"><div class="theme-block-title"><span>${icon('grip-vertical')} <span data-theme-block-number>Block</span></span><div><button type="button" class="icon-button" data-theme-block-move="up" title="Move block up" aria-label="Move block up">${icon('chevron-up')}</button><button type="button" class="icon-button" data-theme-block-move="down" title="Move block down" aria-label="Move block down">${icon('chevron-down')}</button><button type="button" class="icon-button" data-theme-block-remove title="Remove block" aria-label="Remove block">${icon('trash-2')}</button></div></div>${blockMarkup(type,block,esc)}</article>`;
}

export function themeSectionPanel(section,esc,icon) {
  const label=themeSectionLabel(section.type),blocks=['benefits','testimonials','faq'].includes(section.type);
  const common=`<label class="toggle-row store-section-visibility"><span><strong>Show section</strong><small>Display this section on the homepage.</small></span><input data-section-field="visible" type="checkbox" role="switch" ${section.visible?'checked':''}></label>${field('heading','Heading',esc(section.heading))}${section.type!=='testimonials'?field('text','Text',esc(section.text),'textarea'):''}<div class="form-columns"><label class="field">Text alignment<select data-section-field="alignment">${option('left','Left',section.alignment)}${option('center','Center',section.alignment)}</select></label><label class="field">Color scheme<select data-section-field="colorScheme">${option('default','Default',section.colorScheme)}${option('accent','Accent',section.colorScheme)}${option('contrast','Contrast',section.colorScheme)}</select></label></div><label class="toggle-row"><span><strong>Full width</strong><small>Stretch the background across the browser.</small></span><input data-section-field="fullWidth" type="checkbox" role="switch" ${section.fullWidth?'checked':''}></label>`;
  const image=section.type==='image-with-text'?`<div class="store-banner-media"><div class="store-field-group-title"><strong>Image</strong><small>PNG, JPG or WebP, up to 2 MB.</small></div><div class="store-banner-image theme-section-image">${section.image?.dataUrl?`<img src="${esc(section.image.dataUrl)}" alt="${esc(section.heading)}" data-section-image-preview>`:'<span data-section-image-placeholder>Add an image</span>'}</div><label class="field store-media-upload">Choose image<input data-section-image type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="secondary" data-section-image-remove ${section.image?'':'hidden'}>Remove image</button></div><label class="field">Image position<select data-section-field="imagePosition">${option('left','Left',section.imagePosition)}${option('right','Right',section.imagePosition)}</select></label>`:'';
  const button=['rich-text','image-with-text'].includes(section.type)?`<div class="form-columns">${field('buttonText','Button text',esc(section.buttonText))}${field('buttonUrl','Button link',esc(section.buttonUrl))}</div>`:'';
  const blockList=blocks?`<div class="store-field-group-title"><strong>${section.type==='faq'?'Questions':section.type==='testimonials'?'Testimonials':'Benefits'}</strong><small>Drag or use arrows to change the order.</small></div><div class="theme-block-list" data-theme-block-list>${(section.blocks||[]).map(block=>themeSectionBlock(section.type,block,esc,icon)).join('')}</div><button type="button" class="secondary store-add-link" data-theme-block-add>${icon('plus')}<span>Add block</span></button>`:'';
  return `<fieldset class="store-editor-fieldset theme-custom-editor" data-store-section-panel="${esc(section.id)}" data-theme-section-id="${esc(section.id)}" data-theme-section-type="${esc(section.type)}" data-theme-section-image='${esc(JSON.stringify(section.image||null))}' hidden>${common}${image}${button}${blockList}<div class="theme-section-actions"><button type="button" class="secondary" data-theme-section-duplicate>${icon('copy')}<span>Duplicate</span></button><button type="button" class="secondary danger-text" data-theme-section-remove>${icon('trash-2')}<span>Remove section</span></button></div></fieldset>`;
}

function readBlock(type,row) {
  const read=name=>row.querySelector(`[data-section-field="${name}"]`)?.value||'';
  if(type==='benefits')return {heading:read('heading'),text:read('text')};
  if(type==='testimonials')return {quote:read('quote'),name:read('name')};
  return {question:read('question'),answer:read('answer')};
}

export function readThemeSectionState(form) {
  const result=[];
  for(const panel of form.querySelectorAll('[data-theme-section-id]')) {
    const read=name=>panel.querySelector(`[data-section-field="${name}"]`),type=panel.dataset.themeSectionType;
    const section={id:panel.dataset.themeSectionId,type,visible:read('visible').checked,heading:read('heading').value,text:read('text')?.value||'',alignment:read('alignment').value,colorScheme:read('colorScheme').value,fullWidth:read('fullWidth').checked};
    if(type==='image-with-text') {
      if(panel.dataset.themeSectionImageRemoved==='true')section.image=null;
      else try { section.image=JSON.parse(panel.dataset.themeSectionImage||'null'); } catch { section.image=null; }
      Object.assign(section,{imagePosition:read('imagePosition').value,buttonText:read('buttonText').value,buttonUrl:read('buttonUrl').value});
    }
    if(type==='rich-text')Object.assign(section,{buttonText:read('buttonText').value,buttonUrl:read('buttonUrl').value});
    if(['benefits','testimonials','faq'].includes(type))section.blocks=[...panel.querySelectorAll('[data-theme-block]')].map(row=>readBlock(type,row));
    result.push(section);
  }
  return result;
}

export async function readThemeSections(form,asset) {
  const sections=readThemeSectionState(form),panels=[...form.querySelectorAll('[data-theme-section-id]')];
  for(let index=0;index<sections.length;index+=1) {
    if(sections[index].type!=='image-with-text')continue;
    const file=panels[index].querySelector('[data-section-image]').files[0];
    if(file)sections[index].image=await asset(file);
    else if(sections[index].image?.dataUrl) {
      const {name,type,dataUrl}=sections[index].image;
      sections[index].image={name,type,data:dataUrl.slice(dataUrl.indexOf(',')+1)};
    }
  }
  return sections;
}

export function clientSectionMarkup(section,esc) {
  const hidden=section.visible?'':' hidden',wide=section.fullWidth?' is-full-width':'',scheme=` theme-${esc(section.colorScheme)}`,align=` align-${esc(section.alignment)}`,button=section.buttonText&&section.buttonUrl?`<a class="theme-section-button" href="${esc(section.buttonUrl)}">${esc(section.buttonText)}</a>`:'';
  if(section.type==='rich-text')return `<section class="theme-custom-section theme-rich-text${wide}${scheme}${align}" data-store-editor-section="${esc(section.id)}"${hidden}><div class="theme-section-inner"><h2>${esc(section.heading)}</h2>${section.text?`<p>${esc(section.text)}</p>`:''}${button}</div></section>`;
  if(section.type==='image-with-text') { const src=section.image?.dataUrl||(section.image?.data&&section.image?.type?`data:${section.image.type};base64,${section.image.data}`:'');return `<section class="theme-custom-section theme-image-text${wide}${scheme} image-${esc(section.imagePosition)}" data-store-editor-section="${esc(section.id)}"${hidden}><div class="theme-section-inner">${src?`<img src="${esc(src)}" alt="${esc(section.heading)}">`:'<div class="theme-image-placeholder"></div>'}<div class="theme-section-copy"><h2>${esc(section.heading)}</h2>${section.text?`<p>${esc(section.text)}</p>`:''}${button}</div></div></section>`; }
  if(section.type==='benefits')return `<section class="theme-custom-section theme-benefits${wide}${scheme}${align}" data-store-editor-section="${esc(section.id)}"${hidden}><div class="theme-section-inner"><h2>${esc(section.heading)}</h2>${section.text?`<p class="theme-section-intro">${esc(section.text)}</p>`:''}<div class="theme-benefit-grid">${section.blocks.map(block=>`<article><span aria-hidden="true">✓</span><h3>${esc(block.heading)}</h3><p>${esc(block.text)}</p></article>`).join('')}</div></div></section>`;
  if(section.type==='testimonials')return `<section class="theme-custom-section theme-testimonials${wide}${scheme}${align}" data-store-editor-section="${esc(section.id)}"${hidden}><div class="theme-section-inner"><h2>${esc(section.heading)}</h2><div class="theme-testimonial-grid">${section.blocks.map(block=>`<figure><blockquote>${esc(block.quote)}</blockquote><figcaption>${esc(block.name)}</figcaption></figure>`).join('')}</div></div></section>`;
  return `<section class="theme-custom-section theme-faq${wide}${scheme}" data-store-editor-section="${esc(section.id)}"${hidden}><div class="theme-section-inner"><h2>${esc(section.heading)}</h2>${section.text?`<p class="theme-section-intro">${esc(section.text)}</p>`:''}<div class="theme-faq-list">${section.blocks.map(block=>`<details><summary>${esc(block.question)}</summary><p>${esc(block.answer)}</p></details>`).join('')}</div></div></section>`;
}
