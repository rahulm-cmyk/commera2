import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function call(base, path, method = "GET", data) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") || "";
  return {
    response,
    body: type.includes("json") ? await response.json() : await response.text(),
  };
}
async function setup(base) {
  let result = await call(base, "/api/stores", "POST", {
    name: "Nivkara",
    slug: "nivkara",
  });
  const store = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Hair Growth Oil",
    slug: "hair-growth-oil",
    pricePaise: 89900,
    stock: 20,
  });
  return { store, product: result.body };
}

test("uploaded HTML file is processed, previewed, connected, configured for COD, saved, and published live", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);
  const source =
      '<!doctype html><html><head><title>Imported Hair Ritual</title><style>.ritual{color:teal}.reveal{opacity:0;transform:translateY(40px)}.reveal.is-visible{opacity:1;transform:none} @import url(https://bad.example/style.css);</style><script>alert(1)</script></head><body><main class="ritual reveal"><h1 onclick="bad()">Imported Hair Ritual</h1><p>Real imported content.</p><img src="C:/Users/Test/hero.png" alt="Local hero"><a class="buy-btn" href="#buy">Buy now</a><a href="javascript:bad()">Bad link</a><form><input></form></main></body></html>',
    fileContentBase64 = Buffer.from(source).toString("base64");
  let result = await call(
    base,
    `/api/stores/${store.id}/page-imports/preview`,
    "POST",
    { fileName: "ritual.html", mimeType: "text/html", fileContentBase64 },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.fileName, "ritual.html");
  assert.match(result.body.previewHtml, /Imported Hair Ritual/);
  assert.match(result.body.previewHtml, /\.ritual\{color:teal\}/);
  assert.match(result.body.previewHtml, /data-commera-import-static/);
  assert.match(result.body.previewHtml, /\.reveal,.reveal-scale/);
  assert.equal(result.body.warnings.length, 1);
  assert.match(result.body.warnings[0], /local computer/i);
  assert.doesNotMatch(result.body.previewHtml, /@import|bad\.example|<title/i);
  assert.doesNotMatch(
    result.body.previewHtml,
    /script|onclick|javascript:|<form/i,
  );
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "upload",
    pageName: "Imported Hair Ritual",
    title: "Imported Hair Ritual",
    slug: "imported-ritual",
    productId: product.id,
    status: "draft",
    fileName: "ritual.html",
    mimeType: "text/html",
    fileContentBase64,
    ctaText: "Order Hair Oil",
    codEnabled: true,
  });
  assert.equal(result.response.status, 201);
  const page = result.body;
  assert.equal(page.productId, product.id);
  assert.equal(page.status, "draft");
  assert.equal(page.creationMethod, "upload");
  const content = JSON.parse(page.contentJson);
  assert.equal(content.ctaText, "Order Hair Oil");
  assert.equal(content.codEnabled, true);
  result = await call(base, `/api/stores/${store.id}/pages/${page.id}/preview`);
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Real imported content/);
  assert.match(result.body, /Order Hair Oil/);
  assert.match(result.body, /class="landing imported-page"/);
  assert.doesNotMatch(result.body, /class="landing-hero/);
  assert.doesNotMatch(result.body, /SHOP THE PRODUCT|Customer Reviews/);
  assert.match(result.body, /\.imported-safe a\[href="#buy"\]/);
  assert.doesNotMatch(result.body, /id="cod-form"/);
  result = await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  assert.equal(result.body.status, "published");
  result = await call(base, "/s/nivkara/imported-ritual");
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Real imported content/);
  assert.match(result.body, /Order Hair Oil/);
  assert.match(result.body, /dataset\.directCheckout='true'/);
  assert.doesNotMatch(result.body, /class="landing-hero/);
  assert.doesNotMatch(result.body, /id="cod-form"/);
  assert.doesNotMatch(result.body, /onclick|javascript:bad|<form><input/i);
});

test("supported import is required and cross-store preview is rejected", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);
  const other = (
    await call(base, "/api/stores", "POST", { name: "Other", slug: "other" })
  ).body;
  let result = await call(
    base,
    `/api/stores/${store.id}/page-imports/preview`,
    "POST",
    {
      fileName: "page.exe",
      fileContentBase64: Buffer.from("bad").toString("base64"),
    },
  );
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /supported.*html/i);
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "upload",
    title: "Missing file",
    slug: "missing",
    productId: product.id,
    status: "draft",
  });
  assert.equal(result.response.status, 400);
  assert.equal(
    (await call(base, `/api/stores/${store.id}/projects`)).body.length,
    0,
  );
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "blank",
    title: "Bad Status",
    slug: "bad-status",
    productId: product.id,
    status: "deleted",
    body: "Invalid",
  });
  assert.equal(result.response.status, 400);
  assert.equal(
    (await call(base, `/api/stores/${store.id}/pages`)).body.length,
    0,
  );
  const content = Buffer.from("<h1>Safe page</h1>").toString("base64");
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "upload",
    title: "Safe",
    slug: "safe",
    productId: product.id,
    status: "draft",
    fileName: "safe.htm",
    fileContentBase64: content,
    codEnabled: true,
  });
  const page = result.body;
  result = await call(base, `/api/stores/${other.id}/pages/${page.id}/preview`);
  assert.equal(result.response.status, 404);
});

test("Product Page Creation uses one minimal modal and opens the shared visual builder", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const result = await call(base, "/app.js"),
    modalStart = result.body.indexOf("function createProductPageModal"),
    modalEnd = result.body.indexOf("function templateGallery", modalStart),
    modalSource = result.body.slice(modalStart, modalEnd),
    editorStart = result.body.indexOf("function openVisualProductPageBuilder"),
    editorEnd = result.body.indexOf("function newStore", editorStart),
    editorSource = result.body.slice(editorStart, editorEnd);
  assert.ok(modalStart > 0 && modalEnd > modalStart);
  for (const text of [
    "Page Name",
    "Connected Product",
    "Creation Method",
    "URL Slug",
    "/products/",
    "Status",
    "Draft",
    "Published",
    "Cancel",
    "Create Page",
  ])
    assert.match(
      modalSource,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  for (const text of [
    "Default Product Page",
    "Choose Template",
    "Upload Pre-Built Page",
    "Build From Scratch",
    "Create With AI",
  ])
    assert.match(result.body, new RegExp(text));
  for (const removed of [
    "Social Proof Type",
    "Urgency Creation",
    "Urgency Message",
    "Announcement Bar Message",
    "Opening Story",
  ])
    assert.doesNotMatch(modalSource, new RegExp(removed));
  assert.match(result.body, /Manage Pages/);
  assert.match(
    modalSource,
    /id\s*!==\s*['"]ai['"]\s*\|\|\s*aiState\.available/,
  );
  for (const text of [
    "LIVE PAGE CANVAS",
    "Page Settings",
    "Desktop",
    "Mobile",
    "Undo",
    "Redo",
    "Preview",
    "Save",
    "Publish",
    "Save as Template",
    "Add Section",
  ])
    assert.match(
      editorSource,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  for (const text of [
    "Product Media",
    "Product Title & Price",
    "Product Description",
    "Product Options / Bundles",
    "Reviews",
    "Urgency",
    "Announcement Bar",
    "Checkout Button",
    "Footer / Policy",
    "Only approved reviews appear",
    "Limited Stock",
    "Only {stock} items left",
    "Direct Checkout",
    "Add To Cart",
    "Redirect",
  ])
    assert.match(
      result.body,
      new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  assert.doesNotMatch(result.body, /COD Checkout/);
});

test("default product page keeps connected product data live and persists shared editor settings", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);
  let result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "default",
    templateKey: "warm-story",
    title: "Hair Oil Page",
    slug: "hair-oil-page",
    productId: product.id,
    status: "draft",
    ctaText: "BUY NOW",
    ctaAction: "direct",
  });
  assert.equal(result.response.status, 201);
  const page = result.body,
    content = JSON.parse(page.contentJson);
  assert.equal(page.creationMethod, "default");
  assert.deepEqual(
    content.editorSections.map((section) => section.id),
    [
      "header",
      "announcement-bar",
      "product-media",
      "product-information",
      "description",
      "bundle",
      "checkout-button",
      "urgency",
      "reviews",
      "policies-footer",
    ],
  );
  assert.equal(
    content.editorSections.find((section) => section.id === "urgency").visible,
    false,
  );
  assert.equal(
    content.editorSections.find((section) => section.id === "announcement-bar")
      .visible,
    false,
  );
  result = await call(
    base,
    `/api/stores/${store.id}/products/${product.id}`,
    "PATCH",
    {
      name: "Updated Hair Oil",
      slug: "updated-hair-oil",
      description: "Fresh connected product description.",
      pricePaise: 74900,
      comparePricePaise: 99900,
      stock: 18,
      status: "active",
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.name, "Updated Hair Oil");
  result = await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}`,
    "PATCH",
    {
      editorSections: content.editorSections.map((section) => ({
        ...section,
        visible:
          ["urgency", "announcement-bar"].includes(section.id) ||
          !["product-media", "reviews", "bundle"].includes(section.id),
      })),
      reviewSettings: {
        showReviews: false,
        showRating: false,
        showImages: false,
        limit: 3,
      },
      mediaSettings: {
        mainImage: true,
        imageGallery: false,
        gif: false,
        video: false,
      },
      pageSettings: {
        primaryColor: "#173e34",
        backgroundColor: "#f5f3ec",
        maxWidth: 1180,
        headingFont: "Inter",
      },
      sectionSettings: {
        "product-information": {
          desktop: true,
          mobile: true,
          alignment: "center",
          fontSize: 36,
        },
      },
      urgency: {
        enabled: true,
        type: "limited-stock",
        text: "Only {stock} left",
      },
      announcement: "Free shipping across India today",
      sections: [
        {
          id: "custom-proof",
          type: "custom-content",
          title: "Why customers choose us",
          body: "Connected editor content",
          visible: true,
        },
      ],
    },
  );
  assert.equal(result.response.status, 200);
  const updated = JSON.parse(result.body.contentJson);
  assert.equal(updated.reviewSettings.limit, 3);
  assert.equal(
    updated.editorSections.find((section) => section.id === "reviews").visible,
    false,
  );
  assert.equal(updated.urgency.enabled, true);
  assert.equal(updated.announcement, "Free shipping across India today");
  assert.equal(updated.pageSettings.maxWidth, 1180);
  assert.equal(updated.sectionSettings["product-information"].fontSize, 36);
  result = await call(base, `/api/stores/${store.id}/pages/${page.id}/preview`);
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Updated Hair Oil/);
  assert.match(result.body, /Fresh connected product description/);
  assert.match(result.body, /₹749/);
  assert.match(result.body, /₹999/);
  assert.match(result.body, /Only 18 left/);
  assert.match(result.body, /Free shipping across India today/);
  assert.match(result.body, /--page-bg:#f5f3ec/);
  assert.match(result.body, /--page-max-width:1180px/);
  assert.doesNotMatch(result.body, /product-reviews/);
  assert.doesNotMatch(result.body, /section-proof/);
  assert.doesNotMatch(result.body, /<fieldset>/);
  assert.doesNotMatch(result.body, /class="hero-product/);
});
