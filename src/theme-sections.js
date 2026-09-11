const clean = value => String(value ?? '').trim();

export const customSectionTypes = ['rich-text','image-with-text','benefits','testimonials','faq'];
export const coreSectionIds = ['banner','featured'];

export const sectionTypeLabels = {
  'rich-text':'Rich text',
  'image-with-text':'Image with text',
  benefits:'Benefits',
  testimonials:'Testimonials',
  faq:'Collapsible content',
};

const short = (value,label,max=120) => {
  const output=clean(value);
  if(output.length>max)throw Error(`${label} must be ${max} characters or fewer`);
  return output;
};
const text = (value,label,max=1200) => short(value,label,max);
const bool = (value,fallback=false) => value===undefined?fallback:Boolean(value);
const choice = (value,allowed,fallback) => allowed.includes(clean(value))?clean(value):fallback;
const link = value => {
  const output=clean(value);
  if(output&&!/^(?:https?:\/\/|\/|#)/i.test(output))throw Error('Section links must use HTTPS, HTTP, or a store-relative path');
  return output;
};

function blocks(value,type) {
  const items=Array.isArray(value)?value:[];
  if(items.length>8)throw Error('A section can contain at most 8 blocks');
  if(type==='benefits')return items.map(item=>({heading:short(item?.heading,'Benefit heading',80),text:text(item?.text,'Benefit text',300)}));
  if(type==='testimonials')return items.map(item=>({quote:text(item?.quote,'Testimonial',500),name:short(item?.name,'Customer name',80)}));
  if(type==='faq')return items.map(item=>({question:short(item?.question,'Question',160),answer:text(item?.answer,'Answer',1000)}));
  return [];
}

export function normalizeThemeSections(value,current=[],normalizeImage) {
  if(!Array.isArray(value))throw Error('Homepage sections must be a list');
  if(value.length>12)throw Error('Use at most 12 custom homepage sections');
  const ids=new Set(),currentById=new Map(current.map(section=>[section.id,section]));
  return value.map((input,index)=>{
    const type=clean(input?.type);
    if(!customSectionTypes.includes(type))throw Error('Choose a supported homepage section');
    const id=clean(input?.id);
    if(!/^section-[a-z0-9-]{6,72}$/.test(id)||ids.has(id))throw Error('Homepage section ID is invalid');
    ids.add(id);
    const previous=currentById.get(id),section={
      id,type,
      visible:bool(input.visible,true),
      heading:short(input.heading,`${sectionTypeLabels[type]} heading`,160),
      text:text(input.text,`${sectionTypeLabels[type]} text`,1600),
      alignment:choice(input.alignment,['left','center'],'left'),
      colorScheme:choice(input.colorScheme,['default','accent','contrast'],'default'),
      fullWidth:bool(input.fullWidth,false),
    };
    if(type==='rich-text')Object.assign(section,{buttonText:short(input.buttonText,'Button text',60),buttonUrl:link(input.buttonUrl)});
    if(type==='image-with-text') {
      const image=input.image===undefined?previous?.image||null:normalizeImage?normalizeImage(input.image,`Image with text ${index+1}`,previous?.image||null):input.image;
      Object.assign(section,{image:image||null,imagePosition:choice(input.imagePosition,['left','right'],'left'),buttonText:short(input.buttonText,'Button text',60),buttonUrl:link(input.buttonUrl)});
    }
    if(['benefits','testimonials','faq'].includes(type))section.blocks=blocks(input.blocks,type);
    return section;
  });
}

export function normalizeThemeSettings(value={}) {
  const integer=(key,min,max,fallback)=>{
    const candidate=Number(value[key]??fallback);
    if(!Number.isInteger(candidate)||candidate<min||candidate>max)throw Error(`Theme ${key} is invalid`);
    return candidate;
  };
  return {
    pageWidth:integer('pageWidth',900,1600,1200),
    sectionSpacing:integer('sectionSpacing',24,120,64),
    buttonRadius:integer('buttonRadius',0,40,8),
    cardRadius:integer('cardRadius',0,40,8),
    productColumns:integer('productColumns',2,4,3),
    animations:bool(value.animations,true),
  };
}

export function normalizeSectionOrder(value,customSections=[]) {
  if(!Array.isArray(value))throw Error('Homepage section order must be a list');
  const expected=[...coreSectionIds,...customSections.map(section=>section.id)],order=value.map(clean);
  if(order.length!==expected.length||new Set(order).size!==expected.length||order.some(id=>!expected.includes(id)))throw Error('Homepage section order is invalid');
  return order;
}

export function renderCustomSection(section,escape) {
  const e=value=>escape(String(value??'')),hidden=section.visible?'':' hidden',wide=section.fullWidth?' is-full-width':'',scheme=` theme-${e(section.colorScheme)}`,align=` align-${e(section.alignment)}`;
  const button=section.buttonText&&section.buttonUrl?`<a class="theme-section-button" href="${e(section.buttonUrl)}">${e(section.buttonText)}</a>`:'';
  if(section.type==='rich-text')return `<section class="theme-custom-section theme-rich-text${wide}${scheme}${align}" data-store-editor-section="${e(section.id)}"${hidden}><div class="theme-section-inner"><h2>${e(section.heading)}</h2>${section.text?`<p>${e(section.text)}</p>`:''}${button}</div></section>`;
  if(section.type==='image-with-text')return `<section class="theme-custom-section theme-image-text${wide}${scheme} image-${e(section.imagePosition)}" data-store-editor-section="${e(section.id)}"${hidden}><div class="theme-section-inner">${section.image?.dataUrl?`<img src="${e(section.image.dataUrl)}" alt="${e(section.heading)}">`:'<div class="theme-image-placeholder" aria-hidden="true"></div>'}<div class="theme-section-copy"><h2>${e(section.heading)}</h2>${section.text?`<p>${e(section.text)}</p>`:''}${button}</div></div></section>`;
  if(section.type==='benefits')return `<section class="theme-custom-section theme-benefits${wide}${scheme}${align}" data-store-editor-section="${e(section.id)}"${hidden}><div class="theme-section-inner"><h2>${e(section.heading)}</h2>${section.text?`<p class="theme-section-intro">${e(section.text)}</p>`:''}<div class="theme-benefit-grid">${(section.blocks||[]).map(item=>`<article><span aria-hidden="true">✓</span><h3>${e(item.heading)}</h3><p>${e(item.text)}</p></article>`).join('')}</div></div></section>`;
  if(section.type==='testimonials')return `<section class="theme-custom-section theme-testimonials${wide}${scheme}${align}" data-store-editor-section="${e(section.id)}"${hidden}><div class="theme-section-inner"><h2>${e(section.heading)}</h2><div class="theme-testimonial-grid">${(section.blocks||[]).map(item=>`<figure><blockquote>${e(item.quote)}</blockquote><figcaption>${e(item.name)}</figcaption></figure>`).join('')}</div></div></section>`;
  return `<section class="theme-custom-section theme-faq${wide}${scheme}" data-store-editor-section="${e(section.id)}"${hidden}><div class="theme-section-inner"><h2>${e(section.heading)}</h2>${section.text?`<p class="theme-section-intro">${e(section.text)}</p>`:''}<div class="theme-faq-list">${(section.blocks||[]).map(item=>`<details><summary>${e(item.question)}</summary><p>${e(item.answer)}</p></details>`).join('')}</div></div></section>`;
}
