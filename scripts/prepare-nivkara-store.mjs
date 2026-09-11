import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require(process.env.QA_SHARP_PATH || 'C:/Users/ADMIN/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/sharp');
const folder = 'data/nivkara-store-package';
await mkdir(folder, { recursive: true });
const response = await fetch('https://nivkara.com/products.json?limit=100');
if (!response.ok) throw Error('Could not read the Nivkara catalogue');
const catalogue = (await response.json()).products;
const handles = ['ayurvedic-hair-oil', 'anti-hairfall-ayurvedic-shampoo', 'hair-growth-serum-redensyl-plant-based'];
const descriptions = [
  'Nivkara hair oil combines Bhringraj with a blend of Ayurvedic botanicals in a 100 ml bottle. Read the ingredients and directions on the pack before use.',
  'An Ayurvedic shampoo for the cleansing step of your hair-care routine. This product is currently unavailable on the reference store.',
  'A plant-based scalp serum for leave-in hair care. This product is currently unavailable on the reference store.',
];
const sources = [];
async function asset(name, url, width = 1200) {
  const res = await fetch(url);
  if (!res.ok) throw Error(`Could not load ${name}: ${res.status}`);
  const bytes = await sharp(Buffer.from(await res.arrayBuffer())).resize({ width, withoutEnlargement: true }).webp({ quality: 84 }).toBuffer();
  await writeFile(`${folder}/${name}.webp`, bytes);
  sources.push({ name, url });
  return { name: `${name}.webp`, type: 'image/webp', data: bytes.toString('base64') };
}
const products = [];
for (let i = 0; i < handles.length; i++) {
  const product = catalogue.find(item => item.handle === handles[i]);
  if (!product || product.variants.length !== 1) throw Error(`Review the variants for ${handles[i]}`);
  const variant = product.variants[0];
  products.push({ name: product.title, slug: product.handle, pricePaise: Math.round(Number(variant.price) * 100), comparePricePaise: variant.compare_at_price ? Math.round(Number(variant.compare_at_price) * 100) : null, stock: variant.available ? null : 0, description: descriptions[i], mainImage: await asset(product.handle, product.images[0].src, 1000) });
}
const cdn = 'https://cdn.shopify.com/s/files/1/0668/2646/9442/files/';
const hero = await asset('nivkara-hero', `${cdn}nivkara-v2-hero-model.png?width=1000`);
const ritual = await asset('nivkara-ritual', `${cdn}nivkara-v2-ritual-hands.png?width=900`);
const story = await asset('nivkara-story', `${cdn}nivkara-v2-mother-daughter.png?width=1400`);
const logo = await asset('nivkara-logo', 'https://nivkara.com/cdn/shop/files/Nivkara_transparent.png?v=1772394494&width=400', 400);
const ingredients = [];
for (const name of ['bhringraj', 'amla', 'neem', 'argan']) ingredients.push({ heading: name === 'argan' ? 'Argan oil' : name[0].toUpperCase() + name.slice(1), text: '', image: await asset(`nivkara-${name}`, `${cdn}nivkara-v2-macro-${name}.png?width=640`, 640) });
const section = (id, type, heading, values = {}) => ({ id: `section-${id}`, type, heading, text: '', visible: true, eyebrow: '', alignment: 'left', colorScheme: 'default', fullWidth: true, ...values });
const productUrl = `{{store}}/products/${products[0].slug}`;
const sections = [
  section('nivkara-trust', 'benefits', '', { layout: 'strip', colorScheme: 'contrast', blocks: [{ heading: 'Ayurvedic botanicals' }, { heading: '100 ml hair oil' }, { heading: 'Cash on delivery' }, { heading: 'Care, at your own pace' }] }),
  section('nivkara-problem', 'benefits', 'A little more care for your everyday hair.', { eyebrow: 'The everyday challenge', layout: 'numbered', blocks: [{ heading: 'Busy days', text: 'Make room for a routine you can return to.' }, { heading: 'City living', text: 'Give your wash-day ritual a moment of attention.' }, { heading: 'Changing routines', text: 'Choose products that fit the way you care for your hair.' }, { heading: 'Daily styling', text: 'Balance the finishing touches with regular care.' }] }),
  section('nivkara-method', 'benefits', 'Botanical ingredients. A considered routine.', { eyebrow: 'The Nivkara approach', colorScheme: 'contrast', layout: 'numbered', text: 'Get to know the ingredients, choose your preferred format, and follow the directions on your product.', blocks: [{ heading: 'Start at the roots', text: 'Bhringraj is part of the oil blend.' }, { heading: 'Care for the scalp', text: 'Explore a formula with amla and neem.' }, { heading: 'Finish with care', text: 'Argan oil completes the botanical story.' }] }),
  section('nivkara-spotlight', 'image-with-text', '19-Herb Bhringraj Hair Oil', { eyebrow: 'The daily essential', image: products[0].mainImage, imagePosition: 'left', text: `100 ml\n${money(products[0].pricePaise)}\n\nExplore the single bottle and the two-bottle pack on the product page.`, buttonText: 'Choose your pack', buttonUrl: productUrl }),
  section('nivkara-ingredients', 'image-grid', 'Meet the botanicals.', { eyebrow: 'Inside the formula', blocks: ingredients }),
  section('nivkara-ritual', 'image-with-text', 'Make a moment for your hair.', { eyebrow: 'Your care ritual', image: ritual, imagePosition: 'left', text: '01  Prepare\nRead the directions and check the ingredients on the pack.\n\n02  Apply\nUse the recommended amount as part of your routine.\n\n03  Repeat\nFollow the product directions and adapt your routine to your hair.', buttonText: 'Explore the oil', buttonUrl: productUrl }),
  section('nivkara-story', 'image-with-text', 'An everyday ritual, shared across generations.', { eyebrow: 'Nivkara', colorScheme: 'contrast', image: story, imagePosition: 'left', text: 'An invitation to slow down and make space for hair care. Discover the collection and build a routine that feels like your own.' }),
  section('nivkara-timeline', 'benefits', 'Care is a routine, not a race.', { eyebrow: 'Keep it personal', layout: 'timeline', blocks: [{ heading: 'Begin thoughtfully', text: 'Check the label and introduce one product at a time.' }, { heading: 'Find your rhythm', text: 'Use the product as directed and notice how your hair feels.' }, { heading: 'Review your routine', text: 'Results and experiences differ. Choose what suits you.' }] }),
  section('nivkara-compare', 'comparison', 'Find the right step for your routine.', { eyebrow: 'The collection, at a glance', alignment: 'center', columnHeading: 'Hair oil', otherHeading: 'Shampoo and serum', blocks: [{ heading: 'Format', text: '100 ml oil', other: 'Cleansing and leave-in formats' }, { heading: 'Product details', text: 'See the product page', other: 'See each product page' }, { heading: 'Availability', text: 'Current stock shown at checkout', other: 'Currently sold out' }, { heading: 'How to use', text: 'Follow the packaging', other: 'Follow the packaging' }] }),
  section('nivkara-faq', 'faq', 'A few things to know.', { eyebrow: 'Before you order', blocks: [{ question: 'Which products can I order?', answer: 'Available products show a Buy now button. Shampoo and serum are currently sold out.' }, { question: 'Is there a larger pack?', answer: 'The hair oil page includes a two-bottle pack. Select it to see the complete price before ordering.' }, { question: 'Can I pay when my order arrives?', answer: 'Cash on delivery is available through the connected order form.' }, { question: 'How do I use the products?', answer: 'Read and follow the directions on the packaging. Check the ingredient list before use.' }, { question: 'Where can I see my final total?', answer: 'The checkout shows the item total, any selected offer, and delivery charges before you confirm.' }, { question: 'Will the product work the same for everyone?', answer: 'Individual experiences vary. This store does not promise a particular result.' }] }),
  section('nivkara-finale', 'image-with-text', 'Discover your next hair-care ritual.', { eyebrow: 'Nivkara', colorScheme: 'contrast', image: products[0].mainImage, imagePosition: 'right', text: 'Explore the oil, choose your pack and review your order before confirming.', buttonText: 'Shop hair oil', buttonUrl: productUrl }),
];
function money(paise) { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100); }
const pack = { format: 'commera-store-package', version: 1, name: 'Nivkara', primaryProductSlug: products[0].slug, products,
  branding: { logo, logoAlt: 'Nivkara', primaryColor: '#173d25', secondaryColor: '#f8f5ed', headingFont: 'Georgia', bodyFont: 'Arial' },
  home: { bannerHeading: 'Nivkara', bannerSubheading: 'Botanical hair care, rooted in a familiar ritual. Discover hair oil, shampoo and serum for your everyday routine.', bannerImage: hero, bannerVisible: true, buttonText: 'Shop hair oil', sectionHeading: 'The Nivkara collection', featuredVisible: true, customSections: sections, sectionOrder: ['banner', ...sections.slice(0,9).map(item => item.id), 'featured', ...sections.slice(9).map(item => item.id)], customCss: await readFile('scripts/nivkara-home.css', 'utf8'), headerSticky: true, headerLinks: [{ label: 'Home', url: '{{store}}' }, { label: 'Shop', url: '#products' }, { label: 'Our approach', url: '#section-nivkara-method' }, { label: 'Our story', url: '#section-nivkara-story' }, { label: 'The ritual', url: '#section-nivkara-ritual' }], announcementEnabled: true, announcementMessage: 'Nivkara  |  Ayurvedic hair care  |  Cash on delivery', announcementBackground: '#173d25', announcementTextColor: '#ffffff', footerShowProducts: true, footerContact: 'Nivkara\nHair care for your everyday ritual.', themeSettings: { design: 'botanical', pageWidth: 1240, sectionSpacing: 104, buttonRadius: 8, cardRadius: 8, productColumns: 3, animations: true, heroEyebrow: 'Ayurvedic hair care', heroAccent: 'A ritual for your roots.', heroSecondaryText: 'The ritual', heroSecondaryUrl: '#section-nivkara-ritual', heroBadges: ['19-herb hair oil', '100 ml', 'Cash on delivery'] } },
  bundles: [{ productSlug: products[0].slug, name: 'Pack of 2 - 200 ml', quantity: 2, pricePaise: 79900 }],
  upsells: [{ productSlug: products[0].slug, offerProductSlug: products[1].slug, name: 'Complete the hair-care routine', title: 'Add the Ayurvedic shampoo', headline: 'Add the Ayurvedic shampoo', pricePaise: products[1].pricePaise, status: 'draft' }],
  downsells: [{ productSlug: products[2].slug, offerProductSlug: products[0].slug, title: 'Start with the hair oil', pricePaise: products[0].pricePaise }],
  exitOffers: [{ name: 'Hair oil offer - review before enabling', productSlug: products[0].slug, status: 'draft', discountType: 'fixed', discountValue: 19900, headline: 'A little extra care', message: 'Review the offer before placing your order.', buttonText: 'Apply offer', rejectText: 'No thanks' }],
};
await writeFile(`${folder}/nivkara-store.json`, JSON.stringify(pack));
await writeFile(`${folder}/sources.json`, JSON.stringify({ catalogue: 'https://nivkara.com/products.json?limit=100', capturedAt: new Date().toISOString(), products: products.map(({name,pricePaise,stock}) => ({name,pricePaise,stock})), bundle: { source: 'https://nivkara.com/', derivation: 'Two singles at 499 minus the displayed 199 saving = 799' }, sources }, null, 2));
console.log(JSON.stringify({ package: `${folder}/nivkara-store.json`, products: products.map(({ name, pricePaise, stock }) => ({ name, pricePaise, stock })) }, null, 2));
