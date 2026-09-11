import {renderSection} from './store-section-renderer.js';
export const themeSectionCatalog=[
  {type:'rich-text',label:'Rich text',description:'Heading, text and a button.',icon:'file-text'},
  {type:'image-with-text',label:'Image with text',description:'An image alongside your story.',icon:'panels-top-left'},
  {type:'benefits',label:'Benefits',description:'Benefits, steps or a timeline.',icon:'circle-check'},
  {type:'image-grid',label:'Image gallery',description:'Ingredients, collections or a visual story.',icon:'image'},
  {type:'comparison',label:'Comparison table',description:'Compare product features.',icon:'columns-2'},
  {type:'testimonials',label:'Testimonials',description:'Genuine customer feedback.',icon:'star'},
  {type:'faq',label:'Collapsible content',description:'Questions and answers.',icon:'menu'},
];
export const themeSectionLabel=type=>themeSectionCatalog.find(item=>item.type===type)?.label||'Section';
const field=(name,label,value='',kind='input')=>`<label class="field">${label}${kind==='textarea'?`<textarea data-section-field="${name}" rows="4">${value}</textarea>`:`<input data-section-field="${name}" value="${value}">`}</label>`;
const option=(value,label,selected)=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`;
const blockTypes=['benefits','testimonials','faq','image-grid','comparison'];

export function newThemeSection(type) {
  const common={id:`section-${crypto.randomUUID().toLowerCase()}`,type,visible:true,heading:themeSectionLabel(type),text:'',eyebrow:'',alignment:'left',colorScheme:'default',fullWidth:false,layout:'cards'};
  if(type==='rich-text')return {...common,buttonText:'',buttonUrl:''};
  if(type==='image-with-text')return {...common,image:null,imagePosition:'left',buttonText:'',buttonUrl:''};
  if(type==='benefits'||type==='image-grid')return {...common,blocks:[{heading:'Benefit',text:'Explain why this matters to your customer.',...(type==='image-grid'?{image:null}:{})}]};
  if(type==='testimonials')return {...common,blocks:[{quote:'Add a genuine customer quote.',name:'Customer name'}]};
  if(type==='comparison')return {...common,columnHeading:'Our product',otherHeading:'Other products',blocks:[{heading:'Feature',text:'',other:''}]};
  return {...common,blocks:[{question:'Common question',answer:'Add a clear answer.'}]};
}

function imageControls(image,esc) {
  return `<div class="store-banner-media" data-theme-image-holder data-theme-image='${esc(JSON.stringify(image||null))}'><div class="store-banner-image theme-section-image">${image?.dataUrl?`<img src="${esc(image.dataUrl)}" alt="Selected image" data-section-image-preview>`:'<span data-section-image-placeholder>Add an image</span>'}</div><label class="field store-media-upload">Choose image<input data-section-image type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="secondary" data-section-image-remove ${image?'':'hidden'}>Remove image</button></div>`;
}

export function themeSectionBlock(type,block,esc,icon) {
  let content='';
  if(type==='benefits'||type==='image-grid')content=`${type==='image-grid'?imageControls(block.image,esc):''}${field('heading','Heading',esc(block.heading))}${field('text','Text',esc(block.text),'textarea')}`;
  if(type==='comparison')content=`${field('heading','Feature',esc(block.heading))}${field('text','Your product',esc(block.text))}${field('other','Other product',esc(block.other))}`;
  if(type==='testimonials')content=`${field('quote','Quote',esc(block.quote),'textarea')}${field('name','Customer name',esc(block.name))}`;
  if(type==='faq')content=`${field('question','Question',esc(block.question))}${field('answer','Answer',esc(block.answer),'textarea')}`;
  return `<article class="theme-block-row" data-theme-block draggable="true"><div class="theme-block-title"><span>${icon('grip-vertical')} <span data-theme-block-number>Block</span></span><div><button type="button" class="icon-button" data-theme-block-move="up" title="Move block up" aria-label="Move block up">${icon('chevron-up')}</button><button type="button" class="icon-button" data-theme-block-move="down" title="Move block down" aria-label="Move block down">${icon('chevron-down')}</button><button type="button" class="icon-button" data-theme-block-remove title="Remove block" aria-label="Remove block">${icon('trash-2')}</button></div></div>${content}</article>`;
}

export function themeSectionPanel(section,esc,icon) {
  const common=`<label class="toggle-row store-section-visibility"><span><strong>Show section</strong></span><input data-section-field="visible" type="checkbox" role="switch" ${section.visible?'checked':''}></label>${field('eyebrow','Small heading',esc(section.eyebrow||''))}${field('heading','Heading',esc(section.heading))}${section.type!=='testimonials'?field('text','Text',esc(section.text),'textarea'):''}<div class="form-columns"><label class="field">Text alignment<select data-section-field="alignment">${option('left','Left',section.alignment)}${option('center','Center',section.alignment)}</select></label><label class="field">Color scheme<select data-section-field="colorScheme">${option('default','Default',section.colorScheme)}${option('accent','Accent',section.colorScheme)}${option('contrast','Contrast',section.colorScheme)}</select></label></div><label class="toggle-row"><span><strong>Full width</strong></span><input data-section-field="fullWidth" type="checkbox" role="switch" ${section.fullWidth?'checked':''}></label>`;
  const layout=section.type==='benefits'?`<label class="field">Layout<select data-section-field="layout">${[['cards','Cards'],['numbered','Numbered steps'],['strip','Trust strip'],['timeline','Timeline']].map(([value,label])=>option(value,label,section.layout||'cards')).join('')}</select></label>`:'';
  const media=section.type==='image-with-text'?`${imageControls(section.image,esc)}<label class="field">Image position<select data-section-field="imagePosition">${option('left','Left',section.imagePosition)}${option('right','Right',section.imagePosition)}</select></label>`:'';
  const button=['rich-text','image-with-text'].includes(section.type)?`${field('buttonText','Button text',esc(section.buttonText))}<label class="field">Button destination<select data-section-destination></select></label><div data-section-custom-link>${field('buttonUrl','Web address',esc(section.buttonUrl))}</div>`:'';
  const columns=section.type==='comparison'?`${field('columnHeading','Your column heading',esc(section.columnHeading||''))}${field('otherHeading','Other column heading',esc(section.otherHeading||''))}`:'';
  const blockList=blockTypes.includes(section.type)?`<div class="theme-block-list" data-theme-block-list>${(section.blocks||[]).map(block=>themeSectionBlock(section.type,block,esc,icon)).join('')}</div><button type="button" class="secondary store-add-link" data-theme-block-add>${icon('plus')}<span>Add block</span></button>`:'';
  return `<fieldset class="store-editor-fieldset theme-custom-editor" data-store-section-panel="${esc(section.id)}" data-theme-section-id="${esc(section.id)}" data-theme-section-type="${esc(section.type)}" hidden>${common}${layout}${media}${button}${columns}${blockList}<div class="theme-section-actions"><button type="button" class="secondary" data-theme-section-duplicate>${icon('copy')}<span>Duplicate</span></button><button type="button" class="secondary danger-text" data-theme-section-remove>${icon('trash-2')}<span>Remove section</span></button></div></fieldset>`;
}

const readImage=holder=>{try{return JSON.parse(holder?.dataset.themeImage||'null');}catch{return null;}};
export function readThemeSectionState(form) {
  return [...form.querySelectorAll('[data-theme-section-id]')].map(panel=>{
    const control=name=>panel.querySelector(`[data-section-field="${name}"]`),read=name=>control(name)?.value||'',type=panel.dataset.themeSectionType;
    const section={id:panel.dataset.themeSectionId,type,visible:control('visible').checked,heading:read('heading'),text:read('text'),eyebrow:read('eyebrow'),alignment:read('alignment'),colorScheme:read('colorScheme'),fullWidth:control('fullWidth').checked,layout:read('layout')||'cards'};
    if(type==='image-with-text')Object.assign(section,{image:readImage(panel.querySelector('[data-theme-image-holder]')),imagePosition:read('imagePosition')});
    if(['rich-text','image-with-text'].includes(type))Object.assign(section,{buttonText:read('buttonText'),buttonUrl:read('buttonUrl')});
    if(type==='comparison')Object.assign(section,{columnHeading:read('columnHeading'),otherHeading:read('otherHeading')});
    if(blockTypes.includes(type))section.blocks=[...panel.querySelectorAll('[data-theme-block]')].map(row=>{
      const get=name=>row.querySelector(`[data-section-field="${name}"]`)?.value||'';
      if(type==='faq')return {question:get('question'),answer:get('answer')};
      if(type==='testimonials')return {quote:get('quote'),name:get('name')};
      return {heading:get('heading'),text:get('text'),...(type==='comparison'?{other:get('other')}:{}) ,...(type==='image-grid'?{image:readImage(row.querySelector('[data-theme-image-holder]'))}:{})};
    });
    return section;
  });
}

export async function readThemeSections(form,asset) {
  const sections=readThemeSectionState(form),panels=[...form.querySelectorAll('[data-theme-section-id]')];
  const upload=async(image,holder)=>{
    const file=holder?.querySelector('[data-section-image]')?.files[0];
    if(file)return asset(file);
    if(image?.dataUrl)return {name:image.name,type:image.type,data:image.dataUrl.slice(image.dataUrl.indexOf(',')+1)};
    return image;
  };
  for(let index=0;index<sections.length;index++) {
    const section=sections[index],panel=panels[index];
    if(section.type==='image-with-text')section.image=await upload(section.image,panel.querySelector('[data-theme-image-holder]'));
    if(section.type==='image-grid')for(let i=0;i<section.blocks.length;i++)section.blocks[i].image=await upload(section.blocks[i].image,panel.querySelectorAll('[data-theme-image-holder]')[i]);
  }
  return sections;
}
export const clientSectionMarkup=renderSection;

export function refreshSectionDestinations(form,products,storeSlug) {
  const sections=readThemeSectionState(form);
  for(const select of form.querySelectorAll('[data-section-destination]')) {
    const panel=select.closest('[data-theme-section-id]'),input=panel.querySelector('[data-section-field="buttonUrl"]'),previous=select.value;
    const choices=[['','None'],['#products','Products'],...products.map(product=>[`/s/${encodeURIComponent(storeSlug)}/products/${encodeURIComponent(product.slug)}`,product.name]),...sections.filter(section=>section.id!==panel.dataset.themeSectionId&&section.heading).map(section=>[`#${section.id}`,section.heading]),['custom','Web address']];
    select.replaceChildren(...choices.map(([value,label])=>new Option(label,value)));
    select.value=choices.some(([value])=>value===input.value)?input.value:'custom';
    if(!input.value&&previous==='custom')select.value='custom';
    panel.querySelector('[data-section-custom-link]').hidden=select.value!=='custom';
    select.onchange=()=>{panel.querySelector('[data-section-custom-link]').hidden=select.value!=='custom';if(select.value!=='custom')input.value=select.value;form.dispatchEvent(new Event('input',{bubbles:true}));};
  }
}
