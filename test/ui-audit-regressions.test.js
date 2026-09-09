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
    name: "Audit Store",
    slug: "audit-store",
  });
  const store = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Audit Product",
    slug: "audit-product",
    description: "A product used to verify the complete published page.",
    pricePaise: 99900,
    stock: 10,
  });
  const product = result.body;
  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Audit Product Page",
    slug: "audit-page",
    body: "Audit product page",
  });
  const page = result.body;
  await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  return { store, product, page };
}

const tinyPngDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("published rating stars match the real approved average", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);

  const review = await call(
    base,
    `/api/stores/${store.id}/reviews`,
    "POST",
    {
      productId: product.id,
      customerName: "Asha Patel",
      rating: 4,
      title: "Authentic four-star review",
      text: "This is authentic customer feedback for the rating audit.",
      status: "approved",
      authenticityConfirmed: true,
    },
  );
  assert.equal(review.response.status, 201);

  const published = await call(base, "/s/audit-store/audit-page");
  assert.equal(published.response.status, 200);
  assert.match(
    published.body,
    /aria-label="4\.0 out of 5 stars">★★★★☆<\/span>/,
  );
  assert.doesNotMatch(
    published.body,
    /aria-label="4\.0 out of 5 stars">★★★★★<\/span>/,
  );
});

test("visual builder media blocks survive save and render safely", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, page } = await setup(base);

  const update = await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}`,
    "PATCH",
    {
      editorSections: [
        { id: "image-audit", type: "image", visible: true },
        {
          id: "image-text-audit",
          type: "image-with-text",
          visible: true,
        },
      ],
      sections: [
        {
          id: "image-audit",
          type: "image",
          title: "Product detail image",
          mediaDataUrl: tinyPngDataUrl,
          mediaType: "image/png",
          mediaLink: "https://example.com/details",
          mediaWidth: 80,
          visible: true,
          editorCustom: true,
        },
        {
          id: "image-text-audit",
          type: "image-with-text",
          title: "Ingredient story",
          body: "A real image and its supporting product copy.",
          mediaDataUrl: tinyPngDataUrl,
          mediaType: "image/png",
          mediaLink: "javascript:alert(1)",
          mediaPosition: "right",
          visible: true,
          editorCustom: true,
        },
      ],
    },
  );
  assert.equal(update.response.status, 200);

  await call(base, `/api/stores/${store.id}/pages/${page.id}/publish`, "POST", {});
  const published = await call(base, "/s/audit-store/audit-page");
  assert.equal(published.response.status, 200);
  assert.match(published.body, /class="landing-section-media"/);
  assert.match(published.body, /class="landing-section-media-link" href="https:\/\/example\.com\/details"/);
  assert.match(published.body, /section-image-with-text media-right/);
  assert.match(published.body, /Ingredient story/);
  assert.doesNotMatch(published.body, /javascript:alert/);
});
