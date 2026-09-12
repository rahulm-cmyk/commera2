// Shared by the saved storefront and live editor so both render the same content.
export function sectionImageSource(image) {
  return image?.dataUrl || (image?.data && image?.type ? `data:${image.type};base64,${image.data}` : '');
}

export function renderSection(section, escape) {
  const e=value=>escape(String(value??''));
  const image=(asset,alt)=>sectionImageSource(asset)?`<img src="${e(sectionImageSource(asset))}" alt="${e(alt)}" loading="lazy" decoding="async">`:'<div class="theme-image-placeholder" aria-hidden="true"></div>';
  const tag=section.type==='image-with-text'?'theme-image-text':`theme-${section.type}`;
  const fonts={sans:'Arial,Helvetica,sans-serif',geometric:'Trebuchet MS,Arial,sans-serif',serif:'Georgia,Times New Roman,serif',classic:'Times New Roman,Times,serif',mono:'Consolas,Courier New,monospace'};
  const headingSizes={small:'32px',medium:'44px',large:'56px'},textSizes={small:'13px',medium:'16px',large:'20px'};
  const typographyClasses=[
    fonts[section.headingFont]&&'has-heading-font',headingSizes[section.headingSize]&&'has-heading-size',/^#[0-9a-f]{6}$/i.test(section.headingColor||'')&&'has-heading-color',section.headingBold&&'section-heading-bold',section.headingItalic&&'section-heading-italic',section.headingUnderline&&'section-heading-underline',
    fonts[section.textFont]&&'has-text-font',textSizes[section.textSize]&&'has-text-size',/^#[0-9a-f]{6}$/i.test(section.textColor||'')&&'has-text-color',section.textBold&&'section-text-bold',section.textItalic&&'section-text-italic',section.textUnderline&&'section-text-underline',
  ].filter(Boolean).join(' ');
  const typographyStyle=[fonts[section.headingFont]&&`--section-heading-font:${fonts[section.headingFont]}`,headingSizes[section.headingSize]&&`--section-heading-size:${headingSizes[section.headingSize]}`,/^#[0-9a-f]{6}$/i.test(section.headingColor||'')&&`--section-heading-color:${section.headingColor}`,fonts[section.textFont]&&`--section-text-font:${fonts[section.textFont]}`,textSizes[section.textSize]&&`--section-text-size:${textSizes[section.textSize]}`,/^#[0-9a-f]{6}$/i.test(section.textColor||'')&&`--section-text-color:${section.textColor}`].filter(Boolean).join(';');
  const classes=`theme-custom-section ${tag}${section.fullWidth?' is-full-width':''} theme-${e(section.colorScheme)} align-${e(section.alignment)} layout-${e(section.layout||'cards')}${section.type==='image-with-text'?` image-${e(section.imagePosition)}`:''}${typographyClasses?` ${typographyClasses}`:''}`;
  const eyebrow=section.eyebrow?`<span class="theme-eyebrow">${e(section.eyebrow)}</span>`:'';
  const heading=`${eyebrow}${section.heading?`<h2>${e(section.heading)}</h2>`:''}`;
  const intro=section.text?`<p class="theme-section-intro">${e(section.text)}</p>`:'';
  const button=section.buttonText&&section.buttonUrl?`<a class="theme-section-button" href="${e(section.buttonUrl)}">${e(section.buttonText)}</a>`:'';
  const items=section.blocks||[];
  let content='';
  if(section.type==='rich-text')content=`${heading}${intro}${button}`;
  if(section.type==='image-with-text')content=`${image(section.image,section.heading)}<div class="theme-section-copy">${heading}${intro}${button}</div>`;
  if(section.type==='benefits')content=`${heading}${intro}<div class="theme-benefit-grid" style="--section-columns:${Math.min(items.length||1,4)}">${items.map((item,index)=>`<article><span class="theme-benefit-number" aria-hidden="true">${section.layout==='numbered'||section.layout==='timeline'?String(index+1).padStart(2,'0'):'&#10003;'}</span><h3>${e(item.heading)}</h3>${item.text?`<p>${e(item.text)}</p>`:''}</article>`).join('')}</div>`;
  if(section.type==='image-grid')content=`${heading}${intro}<div class="theme-image-grid" style="--section-columns:${Math.min(items.length||1,4)}">${items.map(item=>`<article>${image(item.image,item.heading)}<div><h3>${e(item.heading)}</h3><p>${e(item.text)}</p></div></article>`).join('')}</div>`;
  if(section.type==='testimonials')content=`${heading}<div class="theme-testimonial-grid">${items.map(item=>`<figure><blockquote>${e(item.quote)}</blockquote><figcaption>${e(item.name)}</figcaption></figure>`).join('')}</div>`;
  if(section.type==='faq')content=`${heading}${intro}<div class="theme-faq-list">${items.map(item=>`<details><summary>${e(item.question)}</summary><p>${e(item.answer)}</p></details>`).join('')}</div>`;
  if(section.type==='comparison')content=`${heading}${intro}<div class="theme-comparison-wrap"><table class="theme-comparison"><thead><tr><th scope="col">Feature</th><th scope="col">${e(section.columnHeading||'Our product')}</th><th scope="col">${e(section.otherHeading||'Other products')}</th></tr></thead><tbody>${items.map(item=>`<tr><th scope="row">${e(item.heading)}</th><td>${e(item.text)}</td><td>${e(item.other)}</td></tr>`).join('')}</tbody></table></div>`;
  return `<section id="${e(section.id)}" class="${classes}"${typographyStyle?` style="${e(typographyStyle)}"`:''} data-store-editor-section="${e(section.id)}"${section.visible?'':' hidden'}><div class="theme-section-inner">${content}</div></section>`;
}

export function botanicalHeroExtras(settings, escape) {
  const e=value=>escape(String(value??''));
  const secondary=settings.heroSecondaryText&&settings.heroSecondaryUrl?`<a class="hero-secondary" href="${e(settings.heroSecondaryUrl)}">${e(settings.heroSecondaryText)}</a>`:'';
  return `${secondary}${settings.heroBadges?.length?`<ul class="hero-badges">${settings.heroBadges.map(text=>`<li>${e(text)}</li>`).join('')}</ul>`:''}`;
}

export function renderFeaturedProducts(products, store, escape) {
  const e=value=>escape(String(value??''));
  return products.filter(item=>item&&item.active!==0&&item.productPageStatus==='published').map(item=>{
    const href=`/s/${encodeURIComponent(store.slug)}/products/${encodeURIComponent(item.slug)}`;
    const price=new Intl.NumberFormat('en-IN',{style:'currency',currency:store.currency||'INR'}).format((item.pricePaise||0)/100);
    const source=sectionImageSource(item.mainImage);
    return `<article class="featured-product-card" data-product-id="${Number(item.id)}"><a href="${href}">${source?`<img src="${e(source)}" alt="${e(item.name)}" loading="lazy">`:''}<div><h3>${e(item.name)}</h3>${item.ratingCount?`<small>${Number(item.ratingAverage).toFixed(1)} / 5 · ${Number(item.ratingCount)} reviews</small>`:''}<p>${e(price)}</p>${item.stock===0?'<small class="product-availability">Sold out</small>':''}<span>View product</span></div></a></article>`;
  }).join('')||'<p>No featured products are published yet.</p>';
}
