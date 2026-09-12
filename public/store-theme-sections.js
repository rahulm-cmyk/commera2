import {renderSection} from './store-section-renderer.js';
const blocks = (count, make) => Array.from({length:count},(_,index)=>make(index));
export const themeSectionCatalog=[
  {id:'featured-collection',type:'image-grid',label:'Featured collection',description:'Show a hand-picked collection.',icon:'layout-grid',preset:{heading:'Featured collection',blocks:blocks(3,index=>({heading:`Collection item ${index+1}`,text:'Add a short description.',image:null}))}},
  {id:'featured-product',type:'image-with-text',label:'Featured product',description:'Spotlight one product and link its page.',icon:'package',preset:{heading:'Featured product',text:'Introduce the product and why customers choose it.',buttonText:'View product'}},
  {id:'collection-list',type:'image-grid',label:'Collection list',description:'Help customers browse product groups.',icon:'layout-grid',preset:{heading:'Shop by collection',blocks:blocks(3,index=>({heading:`Collection ${index+1}`,text:'Describe this collection.',image:null}))}},
  {id:'rich-text',type:'rich-text',label:'Rich text',description:'Heading, text and a button.',icon:'file-text'},
  {id:'image-with-text',type:'image-with-text',label:'Image with text',description:'An image alongside your story.',icon:'panels-top-left'},
  {id:'image-banner',type:'image-with-text',label:'Image banner',description:'A wide promotional image and action.',icon:'image',preset:{heading:'Image banner',text:'Add a clear campaign message.',fullWidth:true,buttonText:'Shop now'}},
  {id:'collage',type:'image-grid',label:'Collage',description:'Mix several images in one section.',icon:'images',preset:{heading:'Collage',layout:'collage',blocks:blocks(4,index=>({heading:`Image ${index+1}`,text:'',image:null}))}},
  {id:'multicolumn',type:'benefits',label:'Multicolumn',description:'Explain benefits in clear columns.',icon:'columns-2',preset:{heading:'Why customers choose us',blocks:blocks(3,index=>({heading:`Benefit ${index+1}`,text:'Explain this benefit.'}))}},
  {id:'multirow',type:'image-grid',label:'Multirow',description:'Tell a longer story in repeated rows.',icon:'rows-3',preset:{heading:'Our story',layout:'rows',blocks:blocks(3,index=>({heading:`Story ${index+1}`,text:'Add the details for this row.',image:null}))}},
  {id:'collapsible-content',type:'faq',label:'Collapsible content',description:'Questions and answers customers can expand.',icon:'menu'},
  {id:'email-signup',type:'rich-text',label:'Email signup',description:'Invite visitors to join your list.',icon:'mail',preset:{heading:'Join our list',text:'Share new products, useful tips and store updates.',buttonText:'Sign up',buttonUrl:'#contact'}},
  {id:'contact-form',type:'rich-text',label:'Contact information',description:'Give customers a clear way to contact you.',icon:'message-square',preset:{heading:'Contact us',text:'Add your support email, hours and response time.',buttonText:'Contact us',buttonUrl:'#contact'}},
  {id:'video',type:'image-with-text',label:'Video',description:'Present a video thumbnail with a watch link.',icon:'play',preset:{heading:'Watch our story',text:'Add a thumbnail and link to your video.',buttonText:'Watch video'}},
  {id:'blog-posts',type:'image-grid',label:'Blog posts',description:'Feature articles, guides or updates.',icon:'newspaper',preset:{heading:'From the journal',blocks:blocks(3,index=>({heading:`Article ${index+1}`,text:'Add a short article summary.',image:null}))}},
  {id:'custom-content',type:'rich-text',label:'Custom content',description:'Build a flexible text and action section.',icon:'code-xml',preset:{heading:'Custom section',text:'Add your custom content here.'}},
  {id:'page',type:'rich-text',label:'Page content',description:'Introduce a policy, story or information page.',icon:'file',preset:{heading:'Page content',text:'Add the information customers need.'}},
  {id:'announcement-bar',type:'benefits',label:'Announcement bar',description:'Highlight short store messages.',icon:'megaphone',preset:{heading:'',layout:'strip',fullWidth:true,colorScheme:'contrast',blocks:blocks(3,index=>({heading:['Free shipping','Cash on delivery','Easy support'][index],text:''}))}},
  {id:'before-after',type:'comparison',label:'Before & after',description:'Compare two states without unsupported claims.',icon:'columns-2',preset:{heading:'Before and after',columnHeading:'Before',otherHeading:'After',blocks:blocks(3,index=>({heading:`Detail ${index+1}`,text:'Before detail',other:'After detail'}))}},
  {id:'comparison',type:'comparison',label:'Comparison table',description:'Compare product features.',icon:'columns-2'},
  {id:'countdown',type:'benefits',label:'Countdown layout',description:'Show a dated campaign as clear steps.',icon:'timer',preset:{heading:'Offer ends soon',layout:'numbered',colorScheme:'contrast',blocks:[{heading:'Days',text:'00'},{heading:'Hours',text:'00'},{heading:'Minutes',text:'00'},{heading:'Seconds',text:'00'}]}},
  {id:'feature-blocks',type:'benefits',label:'Feature blocks',description:'Show key product or service features.',icon:'circle-check'},
  {id:'image-comparison',type:'image-grid',label:'Image comparison',description:'Place two labelled images side by side.',icon:'images',preset:{heading:'Compare the details',blocks:[{heading:'First view',text:'Add a label.',image:null},{heading:'Second view',text:'Add a label.',image:null}]}},
  {id:'scrolling-text',type:'benefits',label:'Scrolling text',description:'Create a compact promotional message strip.',icon:'move-horizontal',preset:{heading:'',layout:'strip',fullWidth:true,colorScheme:'contrast',blocks:blocks(4,index=>({heading:['New arrival','Free shipping','Cash on delivery','Shop now'][index],text:''}))}},
  {id:'tabs',type:'faq',label:'Tabs',description:'Organize product details into expandable topics.',icon:'panel-top',preset:{heading:'Product details',blocks:blocks(3,index=>({question:['Details','How to use','Shipping'][index],answer:'Add clear information here.'}))}},
  {id:'testimonial',type:'testimonials',label:'Testimonial',description:'Show one genuine customer quote.',icon:'quote',preset:{heading:'Customer story',blocks:[{quote:'Add a genuine customer quote.',name:'Customer name'}]}},
  {id:'testimonial-slider',type:'testimonials',label:'Testimonial slider',description:'Show several genuine customer quotes in a swipeable row.',icon:'star',preset:{heading:'From our customers',layout:'slider',blocks:blocks(3,index=>({quote:`Add genuine customer quote ${index+1}.`,name:'Customer name'}))}},
  {id:'video-with-text',type:'image-with-text',label:'Video with text',description:'Pair a video thumbnail with supporting copy.',icon:'play',preset:{heading:'See it in action',text:'Add a thumbnail, explanation and video link.',buttonText:'Watch video'}},
  {id:'logo-list',type:'image-grid',label:'Logo list',description:'Display brands, partners or certifications.',icon:'badge-check',preset:{heading:'Trusted by',layout:'logos',blocks:blocks(4,index=>({heading:`Logo ${index+1}`,text:'',image:null}))}},
  {id:'gallery',type:'image-grid',label:'Gallery',description:'Build a swipeable visual gallery.',icon:'gallery-horizontal',preset:{heading:'Gallery',layout:'slider',blocks:blocks(4,index=>({heading:`Gallery image ${index+1}`,text:'',image:null}))}},
  {id:'promo-slider',type:'benefits',label:'Promo slider',description:'Present several promotions in a swipeable row.',icon:'gallery-horizontal',preset:{heading:'Current offers',layout:'slider',blocks:blocks(3,index=>({heading:`Offer ${index+1}`,text:'Add the offer details.'}))}},
];
const themeSectionTypeLabels={'rich-text':'Rich text','image-with-text':'Image with text',benefits:'Benefits','image-grid':'Image gallery',comparison:'Comparison table',testimonials:'Testimonials',faq:'Collapsible content'};
export const themeSectionLabel=type=>themeSectionTypeLabels[type]||'Section';
const field=(name,label,value='',kind='input')=>`<label class="field">${label}${kind==='textarea'?`<textarea data-section-field="${name}" rows="4">${value}</textarea>`:`<input data-section-field="${name}" value="${value}">`}</label>`;
const option=(value,label,selected)=>`<option value="${value}" ${selected===value?'selected':''}>${label}</option>`;
const blockTypes=['benefits','testimonials','faq','image-grid','comparison'];
const fontChoices=[['theme','Theme font'],['sans','Modern sans'],['geometric','Geometric sans'],['serif','Editorial serif'],['classic','Classic serif'],['mono','Monospace']];
const sizeChoices=[['theme','Theme size'],['small','Small'],['medium','Medium'],['large','Large']];

export function newThemeSection(type,preset={}) {
  const common={id:`section-${crypto.randomUUID().toLowerCase()}`,type,visible:true,heading:themeSectionLabel(type),text:'',eyebrow:'',alignment:'left',colorScheme:'default',fullWidth:false,layout:'cards',headingFont:'theme',headingSize:'theme',headingColor:'',headingBold:false,headingItalic:false,headingUnderline:false,textFont:'theme',textSize:'theme',textColor:'',textBold:false,textItalic:false,textUnderline:false};
  let section;
  if(type==='rich-text')section={...common,buttonText:'',buttonUrl:''};
  else if(type==='image-with-text')section={...common,image:null,imagePosition:'left',buttonText:'',buttonUrl:''};
  else if(type==='benefits'||type==='image-grid')section={...common,blocks:[{heading:'Benefit',text:'Explain why this matters to your customer.',...(type==='image-grid'?{image:null}:{})}]};
  else if(type==='testimonials')section={...common,blocks:[{quote:'Add a genuine customer quote.',name:'Customer name'}]};
  else if(type==='comparison')section={...common,columnHeading:'Our product',otherHeading:'Other products',blocks:[{heading:'Feature',text:'',other:''}]};
  else section={...common,blocks:[{question:'Common question',answer:'Add a clear answer.'}]};
  return {...section,...structuredClone(preset),id:common.id,type};
}

function imageControls(image,esc) {
  return `<div class="store-banner-media" data-theme-image-holder data-theme-image='${esc(JSON.stringify(image||null))}'><div class="store-banner-image theme-section-image">${image?.dataUrl?`<img src="${esc(image.dataUrl)}" alt="Selected image" data-section-image-preview>`:'<span data-section-image-placeholder>Add an image</span>'}</div><label class="field store-media-upload">Choose image<input data-section-image type="file" accept="image/png,image/jpeg,image/webp"></label><button type="button" class="secondary" data-section-image-remove ${image?'':'hidden'}>Remove image</button></div>`;
}

function typographyGroup(section,prefix,label,esc,icon) {
  const enabled=name=>section[`${prefix}${name}`]?'true':'false';
  const toggle=(name,title,iconName)=>`<button type="button" class="theme-style-button" data-section-style-toggle="${prefix}${name}" aria-label="${title} ${label.toLowerCase()}" title="${title}" aria-pressed="${enabled(name)}">${icon(iconName)}</button><input type="checkbox" data-section-field="${prefix}${name}" ${section[`${prefix}${name}`]?'checked':''} hidden>`;
  const color=section[`${prefix}Color`]||'';
  return `<div class="theme-typography-group" data-section-typography-group><strong>${label}</strong><div class="theme-typography-selects"><label class="field">Font<select data-section-field="${prefix}Font">${fontChoices.map(([value,name])=>option(value,name,section[`${prefix}Font`]||'theme')).join('')}</select></label><label class="field">Size<select data-section-field="${prefix}Size">${sizeChoices.map(([value,name])=>option(value,name,section[`${prefix}Size`]||'theme')).join('')}</select></label></div><div class="theme-typography-tools" role="group" aria-label="${label} formatting">${toggle('Bold','Bold','bold')}${toggle('Italic','Italic','italic')}${toggle('Underline','Underline','underline')}<div class="theme-color-control ${color?'is-custom':''}" data-section-color-control><label title="${label} color"><span>Color</span><input type="color" data-section-color-picker aria-label="${label} color" value="${esc(color||'#17211d')}"></label><input type="hidden" data-section-field="${prefix}Color" value="${esc(color)}"><button type="button" class="theme-color-reset" data-section-color-reset aria-label="Use theme color for ${label.toLowerCase()}" title="Use theme color" ${color?'':'disabled'}>${icon('rotate-ccw')}</button></div></div></div>`;
}

function typographyControls(section,esc,icon) {
  return `<div class="theme-typography"><div class="theme-typography-title"><strong>Text style</strong><small>Choose how this section's text looks.</small></div>${typographyGroup(section,'heading','Heading',esc,icon)}${typographyGroup(section,'text','Body text',esc,icon)}</div>`;
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
  const layouts={
    benefits:[['cards','Cards'],['numbered','Numbered steps'],['strip','Trust strip'],['timeline','Timeline'],['slider','Swipeable row']],
    'image-grid':[['cards','Grid'],['collage','Collage'],['rows','Rows'],['logos','Logo list'],['slider','Swipeable gallery']],
    testimonials:[['cards','Cards'],['slider','Swipeable row']],
  };
  const layout=layouts[section.type]?`<label class="field">Layout<select data-section-field="layout">${layouts[section.type].map(([value,label])=>option(value,label,section.layout||'cards')).join('')}</select></label>`:'';
  const media=section.type==='image-with-text'?`${imageControls(section.image,esc)}<label class="field">Image position<select data-section-field="imagePosition">${option('left','Left',section.imagePosition)}${option('right','Right',section.imagePosition)}</select></label>`:'';
  const button=['rich-text','image-with-text'].includes(section.type)?`${field('buttonText','Button text',esc(section.buttonText))}<label class="field">Button destination<select data-section-destination></select></label><div data-section-custom-link>${field('buttonUrl','Web address',esc(section.buttonUrl))}</div>`:'';
  const columns=section.type==='comparison'?`${field('columnHeading','Your column heading',esc(section.columnHeading||''))}${field('otherHeading','Other column heading',esc(section.otherHeading||''))}`:'';
  const blockList=blockTypes.includes(section.type)?`<div class="theme-block-list" data-theme-block-list>${(section.blocks||[]).map(block=>themeSectionBlock(section.type,block,esc,icon)).join('')}</div><button type="button" class="secondary store-add-link" data-theme-block-add>${icon('plus')}<span>Add block</span></button>`:'';
  return `<fieldset class="store-editor-fieldset theme-custom-editor" data-store-section-panel="${esc(section.id)}" data-theme-section-id="${esc(section.id)}" data-theme-section-type="${esc(section.type)}" hidden>${common}${typographyControls(section,esc,icon)}${layout}${media}${button}${columns}${blockList}<div class="theme-section-actions"><button type="button" class="secondary" data-theme-section-duplicate>${icon('copy')}<span>Duplicate</span></button><button type="button" class="secondary danger-text" data-theme-section-remove>${icon('trash-2')}<span>Remove section</span></button></div></fieldset>`;
}

const readImage=holder=>{try{return JSON.parse(holder?.dataset.themeImage||'null');}catch{return null;}};
export function readThemeSectionState(form) {
  return [...form.querySelectorAll('[data-theme-section-id]')].map(panel=>{
    const control=name=>panel.querySelector(`[data-section-field="${name}"]`),read=name=>control(name)?.value||'',type=panel.dataset.themeSectionType;
    const section={id:panel.dataset.themeSectionId,type,visible:control('visible').checked,heading:read('heading'),text:read('text'),eyebrow:read('eyebrow'),alignment:read('alignment'),colorScheme:read('colorScheme'),fullWidth:control('fullWidth').checked,layout:read('layout')||'cards',headingFont:read('headingFont')||'theme',headingSize:read('headingSize')||'theme',headingColor:read('headingColor'),headingBold:control('headingBold').checked,headingItalic:control('headingItalic').checked,headingUnderline:control('headingUnderline').checked,textFont:read('textFont')||'theme',textSize:read('textSize')||'theme',textColor:read('textColor'),textBold:control('textBold').checked,textItalic:control('textItalic').checked,textUnderline:control('textUnderline').checked};
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
