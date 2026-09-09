import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function call(base, path, method = "GET", payload) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const type = response.headers.get("content-type") || "";
  return {
    response,
    body: type.includes("json") ? await response.json() : await response.text(),
  };
}

test("Product Pages complete CRUD lifecycle is validated, isolated, and immediately queryable", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;

  let result = await call(base, "/api/stores", "POST", {
    name: "Universal Store",
    slug: "universal-store",
    currency: "USD",
  });
  const store = result.body;
  result = await call(base, "/api/stores", "POST", {
    name: "Other Store",
    slug: "other-store",
  });
  const otherStore = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Portable Charger",
    slug: "portable-charger",
    description: "Compact charging for daily travel.",
    pricePaise: 1999,
    stock: 12,
  });
  const product = result.body;

  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "h",
    slug: "valid-page",
    creationMethod: "blank",
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /3 meaningful characters/i);

  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Portable Charger Page",
    slug: "u",
    creationMethod: "blank",
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /at least 3 characters/i);

  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Portable Charger Page",
    slug: "portable-charger-page",
    creationMethod: "blank",
  });
  assert.equal(result.response.status, 201);
  const page = result.body;
  assert.equal(page.status, "draft");

  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Another Charger Page",
    slug: "portable-charger-page",
    creationMethod: "blank",
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /URL is already being used/i);

  result = await call(
    base,
    `/api/stores/${store.id}/pages?productId=${product.id}`,
  );
  assert.equal(result.body.length, 1);
  assert.equal(result.body[0].productId, product.id);

  result = await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}`,
    "PATCH",
    {
      title: "Portable Power Page",
      slug: "portable-power-page",
      hero: { headline: "Power your day without slowing down" },
    },
  );
  const updatedPage = result.body;
  assert.equal(result.body.id, page.id);
  assert.equal(result.body.title, "Portable Power Page");
  assert.equal(result.body.slug, "portable-power-page");

  result = await call(base, `/api/stores/${store.id}/pages/${page.id}/preview`);
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Portable Charger/);
  assert.match(result.body, /<h1>Power your day without slowing down<\/h1>/);
  assert.match(result.body, /class="product-name">Portable Charger<\/p>/);

  await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  result = await call(base, "/s/universal-store/portable-power-page");
  assert.equal(result.response.status, 200);
  assert.match(result.body, /\$19\.99/);

  result = await call(
    base,
    `/api/stores/${store.id}/products/${product.id}`,
    "PATCH",
    {
      pricePaise: 2499,
    },
  );
  assert.equal(result.response.status, 200);
  result = await call(base, "/s/universal-store/portable-power-page");
  assert.match(result.body, /\$24\.99/);

  result = await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/duplicate`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 201);
  const duplicate = result.body;
  assert.notEqual(duplicate.id, page.id);
  assert.notEqual(duplicate.slug, page.slug);
  assert.equal(duplicate.status, "draft");
  assert.equal(duplicate.productId, product.id);
  assert.equal(duplicate.contentJson, updatedPage.contentJson);

  result = await call(
    base,
    `/api/stores/${otherStore.id}/pages/${page.id}`,
    "DELETE",
  );
  assert.equal(result.response.status, 404);
  assert.match(result.body.error, /not found/i);

  await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/unpublish`,
    "POST",
    {},
  );
  result = await call(base, "/s/universal-store/portable-power-page");
  assert.equal(result.response.status, 404);

  result = await call(
    base,
    `/api/stores/${store.id}/pages/${duplicate.id}`,
    "DELETE",
  );
  assert.deepEqual(result.body, { id: duplicate.id, deleted: true });
  result = await call(base, `/api/stores/${store.id}/pages`);
  assert.equal(
    result.body.some((item) => item.id === duplicate.id),
    false,
  );
  result = await call(
    base,
    `/api/stores/${store.id}/pages/${duplicate.id}/preview`,
  );
  assert.equal(result.response.status, 404);
  result = await call(base, `/api/stores/${store.id}/products/${product.id}`);
  assert.equal(result.body.id, product.id);
  assert.equal(result.body.pricePaise, 2499);
});

test("Product media can be managed from Products without requiring a published page", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  let result = await call(base, "/api/stores", "POST", {
    name: "Media Store",
    slug: "media-store",
  });
  const store = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Universal Product",
    slug: "universal-product",
    description: "A product with reusable connected media.",
    pricePaise: 99900,
    stock: 5,
  });
  const product = result.body;

  result = await call(
    base,
    `/api/stores/${store.id}/products/${product.id}/media`,
    "PATCH",
    {
      mainImage: {
        name: "main.png",
        type: "image/png",
        data: "YQ==",
      },
      productGif: { name: "motion.gif", type: "image/gif", data: "Yg==" },
      productVideos: [{ name: "demo.mp4", type: "video/mp4", data: "Yw==" }],
    },
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.media.main.name, "main.png");
  assert.equal(result.body.media.gif.name, "motion.gif");
  assert.equal(result.body.media.videos[0].name, "demo.mp4");

  result = await call(
    base,
    `/api/stores/${store.id}/products/${product.id}/media`,
    "PATCH",
    { clear: true },
  );
  assert.equal(result.body.media.main, null);
  assert.equal(result.body.media.videos.length, 0);
});
