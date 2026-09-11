import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";
import { DomainService } from '../src/domain-service.js';
import { request } from 'node:http';
async function call(base, path, method = "GET", data) {
  const response = await fetch(base + path, {
      method,
      headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    }),
    type = response.headers.get("content-type") || "";
  return {
    response,
    body: type.includes("json") ? await response.json() : await response.text(),
  };
}
const png = {
  name: "product.png",
  type: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
};
const gif = {
  name: "demo.gif",
  type: "image/gif",
  data: "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
};

test('homepage drafts save incomplete products and directly published pages work without a second publication', async (t) => {
  const db = createDatabase(':memory:');
  const app = createApp({ db, port: 0, domainSyncIntervalMs: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product, page } = await setup(base, 'draft-regression');
  const path = `/api/stores/${store.id}/storefront`;
  await call(base, `${path}/branding`, 'PATCH', { logo: png });
  let r = await call(base, `${path}/home`, 'PATCH', { bannerImage: png, featuredProductIds: [], buttonTarget: { type: 'product', id: 0 } });
  assert.equal(r.response.status, 200);
  assert.equal(r.body.status, 'draft');
  r = await call(base, `${path}/home`, 'PATCH', { featuredProductIds: [product.id], bannerHeading: 'Saved draft', buttonText: 'Shop', buttonTarget: { type: 'product', id: product.id } });
  assert.equal(r.response.status, 200);
  assert.equal(r.body.featuredProducts[0].productPageStatus, 'published');
  r = await call(base, `${path}/home/publish`, 'POST', {});
  assert.equal(r.response.status, 200, JSON.stringify(r.body));
  r = await call(base, `/s/${store.slug}/products/${product.slug}`);
  assert.equal(r.response.status, 200);
  const domains = new DomainService(db, { cnameTarget: 'edge.example.com' });
  const domain = domains.addDomain(store.id, { domainName: 'qa.example' });
  db.prepare("UPDATE custom_domains SET overall_status='ACTIVE' WHERE id=?").run(domain.id);
  const custom = await new Promise((resolve, reject) => {
    const req = request(`${base}/products/${product.slug}`, { headers: { host: 'qa.example' } }, res => {
      res.resume(); res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject); req.end();
  });
  assert.equal(custom, 200, 'custom domains must resolve the same published product page');
  domains.disconnect(store.id, domain.id);

  const draftProduct = (await call(base, `/api/stores/${store.id}/products`, 'POST', { name: 'Draft Only', slug: 'draft-only', pricePaise: 10000, stock: 2 })).body;
  r = await call(base, `${path}/home`, 'PATCH', { featuredProductIds: [draftProduct.id], bannerHeading: 'Unpublished changes' });
  assert.equal(r.response.status, 200);
  r = await call(base, `${path}/home`, 'PATCH', { bannerSubheading: 'Partial update keeps selection' });
  assert.equal(r.body.featuredProducts[0].id, draftProduct.id);
  r = await call(base, `${path}/home/publish`, 'POST', {});
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /Draft Only/);
  assert.match(r.body.error, /draft is saved/);
  r = await call(base, `/s/${store.slug}`);
  assert.match(r.body, /Saved draft/);
  assert.doesNotMatch(r.body, /Unpublished changes/);

  const other = await setup(base, 'foreign-regression');
  r = await call(base, `${path}/home`, 'PATCH', { featuredProductIds: [other.product.id] });
  assert.equal(r.response.status, 400);
  // An explicit draft connection must not silently select another public page.
  db.prepare("INSERT INTO product_storefronts (store_id,product_id,page_id,status,description_html,button_text) VALUES (?,?,?,'draft','','Buy Now')").run(store.id, product.id, page.id);
  r = await call(base, `${path}/home`, 'PATCH', { featuredProductIds: [product.id] });
  assert.equal(r.body.featuredProducts[0].productPageStatus, 'draft');
  r = await call(base, `${path}/products/${product.id}/page`, 'PATCH', { pageId: page.id });
  assert.equal(r.response.status, 200);
  assert.equal(r.body.status, 'published');
  r = await call(base, `${path}/home/publish`, 'POST', {});
  assert.equal(r.response.status, 200, JSON.stringify(r.body));
});
async function setup(base, slug = "nivkara") {
  let r = await call(base, "/api/stores", "POST", {
      name: slug === "nivkara" ? "Nivkara" : "Other Store",
      slug,
    }),
    store = r.body;
  r = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock: 10,
  });
  const product = r.body;
  r = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Hair Ritual",
    slug: "ritual",
    body: "Daily hair ritual",
  });
  const page = r.body;
  await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  return { store, product, page };
}

test("merchant publishes a branded store home and canonical product page connected to COD checkout", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    main = await setup(base),
    other = await setup(base, "other");
  let r = await call(base, `/s/${main.store.slug}`);
  assert.equal(r.response.status, 404);
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/branding`,
    "PATCH",
    {
      storeName: "Nivkara Naturals",
      logo: png,
      favicon: { ...png, name: "favicon.png" },
      logoAlt: "Nivkara hair care",
      primaryColor: "#123456",
      secondaryColor: "#f1eadf",
      headingFont: "Georgia",
      bodyFont: "Arial",
    },
  );
  assert.equal(r.response.status, 200);
  assert.equal(r.body.logo.alt, "Nivkara hair care");
  assert.equal(r.body.store.name, "Nivkara Naturals");
  assert.equal(r.body.branding.primaryColor, "#123456");
  assert.equal(r.body.favicon.name, "favicon.png");
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/products/${main.product.id}`,
    "PATCH",
    {
      mainImage: png,
      additionalImages: [{ ...png, name: "side.png" }],
      productGif: gif,
      description:
        "<h2>Strong roots</h2><p>Ayurvedic daily hair nourishment.</p><ul><li>Easy COD ordering</li></ul><script>alert(1)</script>",
      buttonText: "Buy Now",
      buttonAction: "checkout",
      publish: true,
    },
  );
  assert.equal(r.response.status, 200);
  assert.equal(r.body.status, "published");
  assert.equal(r.body.media.additional.length, 1);
  assert.equal(r.body.media.gif.type, "image/gif");
  assert.doesNotMatch(r.body.description, /script/i);
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/home`,
    "PATCH",
    {
      bannerImage: { ...png, name: "banner.png" },
      bannerHeading: "Summer Offer",
      bannerSubheading: "Up to 50% Off",
      buttonText: "Shop Now",
      buttonTarget: { type: "product", id: main.product.id },
      announcementEnabled: true,
      announcementMessage: "Free COD delivery today",
      announcementLinkText: "Shop now",
      announcementLinkUrl: "#products",
      announcementBackground: "#123456",
      announcementTextColor: "#ffffff",
      headerSticky: true,
      headerLinks: [
        { label: "Home", url: "/s/nivkara" },
        { label: "Products", url: "#products" },
      ],
      footerContact: "support@nivkara.example",
      footerShowProducts: true,
      sectionHeading: "Featured Products",
      featuredProductIds: [main.product.id],
    },
  );
  assert.equal(r.response.status, 200);
  assert.equal(r.body.status, "draft");
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/preview`,
  );
  assert.equal(r.response.status, 200);
  assert.match(r.body, /Summer Offer/);
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/home/publish`,
    "POST",
    {},
  );
  assert.equal(r.body.status, "published");
  await call(base, `/api/stores/${main.store.id}/policies/written/shipping`, "PATCH", {
    title: "Shipping Policy", content: "<p>Test delivery information.</p>",
  });
  await call(base, `/api/stores/${main.store.id}/policies/written/shipping/publish`, "POST", {});
  r = await call(base, `/s/${main.store.slug}`);
  assert.equal(r.response.status, 200);
  for (const text of [
    "Nivkara hair care",
    "Summer Offer",
    "Up to 50% Off",
    "Shop Now",
    "Featured Products",
    "Hair Oil",
    "Free COD delivery today",
    "support@nivkara.example",
  ])
    assert.match(r.body, new RegExp(text));
  assert.match(r.body, /class="store-site-header is-sticky"/);
  assert.match(r.body, /rel="icon"/);
  assert.match(r.body, /--store-primary:#123456/);
  assert.match(r.body, /aria-label="Store navigation"/);
  assert.match(r.body, /href="\/s\/nivkara\/products\/hair-oil"/);
  const homeChrome = {
    header: r.body.match(/<header class="store-site-header[\s\S]*?<\/header>/)?.[0],
    announcement: r.body.match(/<aside class="store-announcement[\s\S]*?<\/aside>/)?.[0],
    footer: r.body.match(/<footer class="store-policy-footer[\s\S]*?<\/footer>/)?.[0],
  };
  assert.match(homeChrome.header, /href="\/s\/nivkara#products"/);
  assert.match(homeChrome.announcement, /href="\/s\/nivkara#products"/);
  const assertSharedChrome = (html) => {
    assert.ok(html.includes(homeChrome.header), "page must use the same store navigation");
    assert.ok(html.includes(homeChrome.announcement), "page must use the same store announcement");
    assert.ok(html.includes(homeChrome.footer), "page must use the same store footer");
    assert.equal((html.match(/<header class="store-site-header/g) || []).length, 1);
  };
  r = await call(base, `/s/${main.store.slug}/products/${main.product.slug}`);
  assert.equal(r.response.status, 200);
  assertSharedChrome(r.body);
  assert.match(r.body, /store-logo/);
  assert.match(r.body, /product-gallery/);
  assert.match(r.body, /demo\.gif/);
  assert.match(r.body, /<h2>Strong roots<\/h2>/);
  assert.doesNotMatch(r.body, /alert\(1\)/);
  assert.match(r.body, />Buy Now<\/a>/);
  assert.doesNotMatch(r.body, /id="cod-form"/);
  assert.match(r.body, /data-direct-checkout="true"/);
  assert.match(r.body, /rel="icon"/);
  assert.match(r.body, /--page-accent:#123456/);
  assert.match(r.body, /PAGE='ritual'/);
  r = await call(base, "/s/nivkara/ritual");
  assertSharedChrome(r.body);
  r = await call(base, "/s/nivkara/policies/shipping");
  assert.equal(r.response.status, 200);
  assertSharedChrome(r.body);
  r = await call(base, "/api/public/nivkara/ritual/checkouts", "POST", {
    intent: "open",
    quantity: 1,
  });
  assert.equal(r.response.status, 201);
  r = await call(base, `/s/nivkara/checkout/${r.body.id}`);
  assertSharedChrome(r.body);
  assert.match(r.body, /id="cod-form"/);
  assert.match(r.body, /checkout-summary/);
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/products/${other.product.id}`,
    "PATCH",
    {
      mainImage: png,
      description: "<p>Wrong store.</p>",
      buttonText: "Buy",
      buttonAction: "checkout",
      publish: true,
    },
  );
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /current store/i);
  r = await call(base, `/api/stores/${other.store.id}/storefront`);
  assert.equal(r.body.store.name, "Other Store");
  assert.equal(r.body.branding.primaryColor, "#0f5132");
  r = await call(base, `/api/stores/${main.store.id}/storefront/branding`, "PATCH", { storeName: "Updated Nivkara" });
  assert.ok(r.body.logo.dataUrl, "editing store identity must preserve the saved logo");
  await call(base, `/api/stores/${main.store.id}/storefront/home/publish`, "POST", {});
  r = await call(base, "/s/nivkara/products/hair-oil");
  assert.match(r.body, /Updated Nivkara/);
  assert.match(r.body, /support@nivkara.example/);
});

test("selected product page survives product saves and rejects pages from other products or stores", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const main = await setup(base), other = await setup(base, "another-store");
  let r = await call(base, `/api/stores/${main.store.id}/storefront/products/${main.product.id}`, "PATCH", {
    mainImage: png, description: "<p>Connected product.</p>", publish: true,
  });
  assert.equal(r.response.status, 200);
  r = await call(base, `/api/stores/${main.store.id}/pages`, "POST", {
    productId: main.product.id, title: "New product design", slug: "new-design", body: "Alternate design",
  });
  const alternate = r.body;
  const connectionPath = `/api/stores/${main.store.id}/storefront/products/${main.product.id}/page`;
  r = await call(base, connectionPath, "PATCH", { pageId: alternate.id });
  assert.equal(r.response.status, 400, "draft pages cannot become the live product destination");
  await call(base, `/api/stores/${main.store.id}/pages/${alternate.id}/publish`, "POST", {});
  r = await call(base, connectionPath, "PATCH", { pageId: alternate.id });
  assert.equal(r.response.status, 200);
  assert.equal(r.body.pageId, alternate.id);
  r = await call(base, `/api/stores/${main.store.id}/storefront/products/${main.product.id}`, "PATCH", {
    description: "<p>Updated product copy.</p>", publish: true,
  });
  assert.equal(r.body.pageId, alternate.id, "saving product copy must not switch to the oldest page");
  r = await call(base, "/s/nivkara/products/hair-oil");
  assert.equal(r.response.status, 200);
  assert.match(r.body, /PAGE='new-design'/);
  r = await call(base, connectionPath, "PATCH", { pageId: other.page.id });
  assert.equal(r.response.status, 400);
  r = await call(base, `/api/stores/${main.store.id}/products`, "POST", { name: "Serum", slug: "serum", pricePaise: 49900, stock: 5 });
  const serum = r.body;
  r = await call(base, `/api/stores/${main.store.id}/pages`, "POST", { productId: serum.id, title: "Serum Page", slug: "serum-page", body: "Serum details" });
  const serumPage = r.body;
  await call(base, `/api/stores/${main.store.id}/pages/${serumPage.id}/publish`, "POST", {});
  r = await call(base, connectionPath, "PATCH", { pageId: serumPage.id });
  assert.equal(r.response.status, 400);
  r = await call(base, `/api/stores/${main.store.id}/storefront/products/${main.product.id}`);
  assert.equal(r.body.pageId, alternate.id);
  await call(base, `/api/stores/${main.store.id}/storefront/branding`, "PATCH", { logo: png });
  r = await call(base, `/api/stores/${main.store.id}/storefront/home`, "PATCH", {
    bannerImage: png, featuredProductIds: [main.product.id], buttonText: "Explore",
    buttonTarget: { type: "url", url: "/s/nivkara/products/hair-oil" },
  });
  assert.equal(r.response.status, 200, "a URL target must not require a page ID");
  assert.equal(r.body.buttonTargetUrl, "/s/nivkara/products/hair-oil");
  await call(base, `/api/stores/${main.store.id}/storefront/home/publish`, "POST", {});
  await call(base, `/api/stores/${main.store.id}/pages/${alternate.id}/unpublish`, "POST", {});
  r = await call(base, "/s/nivkara/products/hair-oil");
  assert.equal(r.response.status, 404, "unpublishing the connected page also closes its canonical product route");
  r = await call(base, "/s/nivkara");
  assert.equal(r.response.status, 200);
  assert.doesNotMatch(r.body, /class="featured-product-card"/, "the homepage must not feature an unpublished product page");
});

test("required storefront media and featured product constraints block incomplete publication", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    main = await setup(base);
  let r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/products/${main.product.id}`,
    "PATCH",
    {
      description: "<p>Missing main image.</p>",
      buttonText: "Buy Now",
      buttonAction: "checkout",
      publish: true,
    },
  );
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /Main Product Image is required/);
  await call(
    base,
    `/api/stores/${main.store.id}/storefront/branding`,
    "PATCH",
    { logo: png },
  );
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/home`,
    "PATCH",
    { bannerImage: png, featuredProductIds: [] },
  );
  assert.equal(r.response.status, 200);
  r = await call(base, `/api/stores/${main.store.id}/storefront/home/publish`, "POST", {});
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /Select at least one product/);
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/branding`,
    "PATCH",
    { primaryColor: "red" },
  );
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /six-digit hex/i);
  await call(
    base,
    `/api/stores/${main.store.id}/storefront/products/${main.product.id}`,
    "PATCH",
    {
      mainImage: png,
      description: "<p>Safe product.</p>",
      buttonText: "Buy Now",
      buttonAction: "checkout",
      publish: true,
    },
  );
  r = await call(
    base,
    `/api/stores/${main.store.id}/storefront/home`,
    "PATCH",
    {
      featuredProductIds: [main.product.id],
      headerLinks: [{ label: "Unsafe", url: "javascript:alert(1)" }],
    },
  );
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /HTTPS, HTTP, or a store-relative path/i);
});

test("homepage editor persists section visibility, ordering, and safe custom CSS", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    main = await setup(base, "theme-editor-state"),
    path = `/api/stores/${main.store.id}/storefront`;

  await call(base, `${path}/branding`, "PATCH", { logo: png });
  await call(base, `${path}/products/${main.product.id}`, "PATCH", {
    mainImage: png,
    description: "<p>Published product.</p>",
    publish: true,
  });
  let r = await call(base, `${path}/home`, "PATCH", {
    bannerVisible: false,
    featuredVisible: true,
    sectionOrder: ["featured", "banner"],
    customCss: ".store-home-products { background: #f7faf9; }",
    featuredProductIds: [main.product.id],
  });
  assert.equal(r.response.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.bannerVisible, false);
  assert.equal(r.body.featuredVisible, true);
  assert.deepEqual(r.body.sectionOrder, ["featured", "banner"]);
  assert.match(r.body.customCss, /store-home-products/);

  r = await call(base, `${path}/home/publish`, "POST", {});
  assert.equal(r.response.status, 200, JSON.stringify(r.body));
  r = await call(base, `/s/${main.store.slug}`);
  assert.equal(r.response.status, 200);
  assert.match(r.body, /id="commera-theme-custom-style"/);
  assert.match(r.body, /data-store-editor-section="banner" hidden/);
  assert.ok(r.body.indexOf('data-store-editor-section="featured"') < r.body.indexOf('data-store-editor-section="banner"'));

  r = await call(base, `${path}/home`, "PATCH", {
    bannerVisible: false,
    featuredVisible: false,
  });
  assert.equal(r.response.status, 200);
  r = await call(base, `${path}/home/publish`, "POST", {});
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /at least one homepage section/i);

  r = await call(base, `${path}/home`, "PATCH", { customCss: '@import url("https://example.com/theme.css");' });
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /cannot load external files/i);
  r = await call(base, `${path}/home`, "PATCH", { sectionOrder: ["banner", "banner"] });
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /section order is invalid/i);
});

test('Shopify-style custom sections, blocks and theme settings persist and publish in order',async t=>{
  const app=createApp({db:createDatabase(':memory:'),port:0});await app.start();t.after(()=>app.stop());
  const base=`http://127.0.0.1:${app.port}`,main=await setup(base,'section-builder'),path=`/api/stores/${main.store.id}/storefront`;
  await call(base,`${path}/branding`,'PATCH',{logo:png});
  const sections=[
    {id:'section-richtext-001',type:'rich-text',visible:true,heading:'Our promise',text:'Simple everyday care.',alignment:'center',colorScheme:'accent',fullWidth:true,buttonText:'Learn more',buttonUrl:'#products'},
    {id:'section-benefits-001',type:'benefits',visible:true,heading:'Why choose us',text:'',alignment:'left',colorScheme:'default',fullWidth:false,blocks:[{heading:'Fast delivery',text:'Packed with care.'},{heading:'Easy COD',text:'Pay at your door.'}]},
    {id:'section-faqs-001',type:'faq',visible:true,heading:'Questions',text:'Useful answers.',alignment:'left',colorScheme:'default',fullWidth:false,blocks:[{question:'How long?',answer:'Three to five days.'}]},
  ];
  let r=await call(base,`${path}/home`,'PATCH',{bannerVisible:false,featuredVisible:false,customSections:sections,sectionOrder:['section-richtext-001','banner','section-benefits-001','featured','section-faqs-001'],themeSettings:{pageWidth:1320,sectionSpacing:72,buttonRadius:12,cardRadius:6,productColumns:4,animations:false}});
  assert.equal(r.response.status,200,JSON.stringify(r.body));assert.equal(r.body.customSections.length,3);assert.equal(r.body.themeSettings.pageWidth,1320);
  r=await call(base,`${path}/home/publish`,'POST',{});assert.equal(r.response.status,200,JSON.stringify(r.body));
  r=await call(base,`/s/${main.store.slug}`);assert.equal(r.response.status,200);assert.match(r.body,/Our promise/);assert.match(r.body,/Fast delivery/);assert.match(r.body,/Three to five days/);assert.match(r.body,/--store-page-width:1320px/);assert.match(r.body,/store-motion-disabled/);
  assert.ok(r.body.indexOf('section-richtext-001')<r.body.indexOf('section-benefits-001'));
  r=await call(base,`${path}/home`,'PATCH',{customSections:[sections[0],{...sections[0]}]});assert.equal(r.response.status,400);assert.match(r.body.error,/section ID/i);
  r=await call(base,`${path}/home`,'PATCH',{customSections:[{...sections[0],buttonUrl:'javascript:alert(1)'}]});assert.equal(r.response.status,400);assert.match(r.body.error,/Section links/i);
  r=await call(base,`${path}/home`,'PATCH',{customSections:[{id:'section-image-001',type:'image-with-text',visible:true,heading:'Image',text:'',alignment:'left',colorScheme:'default',fullWidth:false,imagePosition:'left',buttonText:'',buttonUrl:'',image:{name:'fake.svg',type:'image/svg+xml',dataUrl:'data:image/svg+xml;base64,PHN2Zz4='}}]});assert.equal(r.response.status,400);assert.match(r.body.error,/upload is invalid/i);
});

test("universal page uses store currency and never publishes invented media, bundles, or social proof", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  let r = await call(base, "/api/stores", "POST", {
    name: "Universal Goods",
    slug: "universal-goods",
    currency: "USD",
  });
  const store = r.body;
  assert.equal(store.currency, "USD");
  r = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Portable Charger",
    slug: "portable-charger",
    description: "Compact power for everyday devices.",
    pricePaise: 1999,
    stock: 12,
  });
  const product = r.body;
  r = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Portable Charger",
    slug: "portable-charger",
  });
  const page = r.body;
  await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  r = await call(base, "/s/universal-goods/portable-charger");
  assert.equal(r.response.status, 200);
  assert.match(r.body, /Universal Goods/);
  assert.match(r.body, /\$19\.99/);
  assert.doesNotMatch(r.body, /₹/);
  assert.doesNotMatch(r.body, /product-gallery|product-media-placeholder/);
  assert.doesNotMatch(r.body, /hero-bundles/);
  assert.doesNotMatch(r.body, /Social proof|Verified social proof/i);
  assert.equal((r.body.match(/class="product-reviews"/g) || []).length, 1);
  assert.match(r.body, /No reviews yet/);
});
