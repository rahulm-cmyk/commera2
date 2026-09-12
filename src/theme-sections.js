import { renderSection } from '../public/store-section-renderer.js';
import sanitizeHtml from 'sanitize-html';
const clean = value => String(value ?? '').trim();

export const customSectionTypes = ['rich-text','image-with-text','benefits','testimonials','faq','image-grid','comparison'];
export const coreSectionIds = ['banner','featured'];

export const sectionTypeLabels = {
  'rich-text':'Rich text',
  'image-with-text':'Image with text',
  benefits:'Benefits',
  testimonials:'Testimonials',
  faq:'Collapsible content',
  'image-grid':'Image gallery',
  comparison:'Comparison table',
};

const short = (value,label,max=120) => {
  const output=clean(value);
  if(output.length>max)throw Error(`${label} must be ${max} characters or fewer`);
  return output;
};
const text = (value,label,max=1200) => short(value,label,max);
const bool = (value,fallback=false) => value===undefined?fallback:Boolean(value);
const choice = (value,allowed,fallback) => allowed.includes(clean(value))?clean(value):fallback;
const color = (value,label) => {
  const output=clean(value);
  if(output&&!/^#[0-9a-f]{6}$/i.test(output))throw Error(`${label} must be a six-digit color`);
  return output.toLowerCase();
};
const optionalNumber = (value,label,min,max,integer=false) => {
  if(value===undefined||value===null||String(value).trim()==='')return '';
  const output=Number(value);
  if(!Number.isFinite(output)||output<min||output>max||(integer&&!Number.isInteger(output)))throw Error(`${label} is invalid`);
  return integer?output:Math.round(output*10)/10;
};
const richText = (value,label,inline=false) => {
  const input=String(value??'');
  const max=inline?3000:12000;
  if(input.length>max)throw Error(`${label} formatting is too long`);
  return sanitizeHtml(input,{
    allowedTags:inline?['b','strong','i','em','u','s','a']:['p','br','b','strong','i','em','u','s','a','ul','ol','li','blockquote'],
    allowedAttributes:{a:['href','title']},
    allowedSchemes:['http','https','mailto','tel'],
    allowProtocolRelative:false,
    disallowedTagsMode:'discard',
  }).trim();
};
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
  if(type==='comparison')return items.map(item=>({heading:short(item?.heading,'Feature',80),text:text(item?.text,'Your product',300),other:text(item?.other,'Other product',300)}));
  return [];
}

export function normalizeThemeSections(value,current=[],normalizeImage) {
  if(!Array.isArray(value))throw Error('Homepage sections must be a list');
  if(value.length>20)throw Error('Use at most 20 custom homepage sections');
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
      headingHtml:richText(input.headingHtml,`${sectionTypeLabels[type]} heading`,true),
      text:text(input.text,`${sectionTypeLabels[type]} text`,1600),
      textHtml:richText(input.textHtml,`${sectionTypeLabels[type]} text`),
      alignment:choice(input.alignment,['left','center','right'],'left'),
      colorScheme:choice(input.colorScheme,['default','accent','contrast'],'default'),
      fullWidth:bool(input.fullWidth,false),
      eyebrow:short(input.eyebrow,'Small heading',100),
      layout:choice(input.layout,['cards','numbered','strip','timeline','collage','rows','logos','slider'],'cards'),
      headingFont:choice(input.headingFont,['theme','sans','arial','helvetica','geometric','verdana','serif','garamond','classic','palatino','mono'],'theme'),
      headingSize:choice(input.headingSize,['theme','small','medium','large'],'theme'),
      headingSizePx:optionalNumber(input.headingSizePx,'Exact heading size',12,120,true),
      headingWeight:choice(input.headingWeight,['theme','300','400','500','600','700','800'],'theme'),
      headingLineHeight:optionalNumber(input.headingLineHeight,'Heading line height',0.8,3),
      headingLetterSpacing:optionalNumber(input.headingLetterSpacing,'Heading letter spacing',-3,12),
      headingCase:choice(input.headingCase,['theme','uppercase','lowercase','capitalize'],'theme'),
      headingColor:color(input.headingColor,'Heading color'),
      headingBackground:color(input.headingBackground,'Heading background'),
      headingBold:bool(input.headingBold,false),
      headingItalic:bool(input.headingItalic,false),
      headingUnderline:bool(input.headingUnderline,false),
      headingStrike:bool(input.headingStrike,false),
      textFont:choice(input.textFont,['theme','sans','arial','helvetica','geometric','verdana','serif','garamond','classic','palatino','mono'],'theme'),
      textSize:choice(input.textSize,['theme','small','medium','large'],'theme'),
      textSizePx:optionalNumber(input.textSizePx,'Exact body text size',10,48,true),
      textWeight:choice(input.textWeight,['theme','300','400','500','600','700','800'],'theme'),
      textLineHeight:optionalNumber(input.textLineHeight,'Body text line height',0.8,3),
      textLetterSpacing:optionalNumber(input.textLetterSpacing,'Body text letter spacing',-3,12),
      textCase:choice(input.textCase,['theme','uppercase','lowercase','capitalize'],'theme'),
      textColor:color(input.textColor,'Body text color'),
      textBackground:color(input.textBackground,'Body text background'),
      textBold:bool(input.textBold,false),
      textItalic:bool(input.textItalic,false),
      textUnderline:bool(input.textUnderline,false),
      textStrike:bool(input.textStrike,false),
    };
    if(type==='rich-text')Object.assign(section,{buttonText:short(input.buttonText,'Button text',60),buttonUrl:link(input.buttonUrl)});
    if(type==='image-with-text') {
      const image=input.image===undefined?previous?.image||null:normalizeImage?normalizeImage(input.image,`Image with text ${index+1}`,previous?.image||null):input.image;
      Object.assign(section,{image:image||null,imagePosition:choice(input.imagePosition,['left','right'],'left'),buttonText:short(input.buttonText,'Button text',60),buttonUrl:link(input.buttonUrl)});
    }
    if(['benefits','testimonials','faq','comparison'].includes(type))section.blocks=blocks(input.blocks,type);
    if(type==='comparison')Object.assign(section,{columnHeading:short(input.columnHeading,'Your column heading',80),otherHeading:short(input.otherHeading,'Other column heading',80)});
    if(type==='image-grid') {
      const items=Array.isArray(input.blocks)?input.blocks:[];
      if(items.length>8)throw Error('A section can contain at most 8 blocks');
      section.blocks=items.map(item=>{
        const previousImage=previous?.blocks?.find(block=>block.image?.dataUrl===item.image?.dataUrl)?.image||null;
        return {heading:short(item.heading,'Image heading',80),text:text(item.text,'Image text',300),image:item.image?(normalizeImage?normalizeImage(item.image,'Gallery image',previousImage):item.image):null};
      });
    }
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
    design:choice(value.design,['classic','botanical'],'classic'),
    heroEyebrow:short(value.heroEyebrow,'Banner small heading',100),
    heroAccent:short(value.heroAccent,'Banner highlighted heading',100),
    heroSecondaryText:short(value.heroSecondaryText,'Second button text',60),
    heroSecondaryUrl:link(value.heroSecondaryUrl),
    heroBadges:(Array.isArray(value.heroBadges)?value.heroBadges:[]).slice(0,4).map(item=>short(item,'Banner highlight',80)),
  };
}

export function normalizeSectionOrder(value,customSections=[]) {
  if(!Array.isArray(value))throw Error('Homepage section order must be a list');
  const expected=[...coreSectionIds,...customSections.map(section=>section.id)],order=value.map(clean);
  if(order.length!==expected.length||new Set(order).size!==expected.length||order.some(id=>!expected.includes(id)))throw Error('Homepage section order is invalid');
  return order;
}

export function renderCustomSection(section,escape) {
  return renderSection(section,escape);
}
