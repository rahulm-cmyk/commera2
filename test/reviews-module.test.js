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
async function setup(base, slug = "nivkara") {
  let r = await call(base, "/api/stores", "POST", { name: slug, slug }),
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
    body: "Daily ritual",
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
const tinyPng = {
  name: "result.png",
  type: "image/png",
  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
};

test("consumer review stays pending until approval and only approved reviews affect the public rating", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);
  const other = await setup(base, "other");
  let r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
    "POST",
    {
      customerName: "Rahul Sharma",
      rating: 5,
      title: "Great results",
      text: "My genuine experience after using this product consistently.",
      images: [tinyPng],
    },
  );
  assert.equal(r.response.status, 201);
  const review = r.body;
  assert.equal(review.status, "pending");
  assert.equal(review.source, "consumer");
  assert.equal(review.images.length, 1);
  r = await call(base, "/s/nivkara/ritual");
  assert.doesNotMatch(r.body, /My genuine experience/);
  assert.match(r.body, /Write Review/);
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 0);
  assert.equal(r.body.reviews.length, 0);
  r = await call(
    base,
    `/api/stores/${store.id}/reviews/${review.id}/status`,
    "PATCH",
    { status: "approved" },
  );
  assert.equal(r.body.status, "approved");
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 1);
  assert.equal(r.body.summary.average, 5);
  assert.equal(r.body.summary.breakdown["5"], 1);
  assert.equal(
    r.body.reviews[0].text,
    "My genuine experience after using this product consistently.",
  );
  r = await call(base, "/s/nivkara/ritual");
  assert.match(r.body, /My genuine experience/);
  assert.match(r.body, /5\.0/);
  assert.match(r.body, /1 Review/);
  r = await call(
    base,
    `/api/stores/${other.store.id}/reviews/${review.id}/status`,
    "PATCH",
    { status: "approved" },
  );
  assert.equal(r.response.status, 404);
  r = await call(
    base,
    `/api/stores/${store.id}/reviews/${review.id}/status`,
    "PATCH",
    { status: "disapproved" },
  );
  assert.equal(r.body.status, "disapproved");
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 0);
  assert.equal(r.body.reviews.length, 0);
});

test("manual authentic reviews support draft/approved lifecycle, image replacement, editing, and deletion", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);
  let future = await call(base, `/api/stores/${store.id}/reviews`, "POST", {
    productId: product.id,
    customerName: "Future Customer",
    rating: 4,
    title: "Impossible future review",
    text: "This review date must not be accepted by the platform.",
    reviewDate: "8999-09-08",
    status: "approved",
    authenticityConfirmed: true,
  });
  assert.equal(future.response.status, 400);
  assert.match(future.body.error, /cannot be in the future/i);
  let r = await call(base, `/api/stores/${store.id}/reviews`, "POST", {
    productId: product.id,
    customerName: "Amit Patel",
    rating: 4,
    title: "Imported verified feedback",
    text: "Authentic feedback supplied by this customer.",
    images: [tinyPng],
    reviewDate: "2026-08-25",
    status: "draft",
    authenticityConfirmed: true,
  });
  assert.equal(r.response.status, 201);
  const draft = r.body;
  assert.equal(draft.source, "manual");
  assert.equal(draft.status, "draft");
  assert.equal(draft.reviewDate, "2026-08-25");
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 0);
  r = await call(base, `/api/stores/${store.id}/reviews/${draft.id}`, "PATCH", {
    customerName: "Amit Patel",
    rating: 5,
    title: "Updated authentic feedback",
    text: "Updated wording from the original authentic customer feedback.",
    images: [tinyPng, tinyPng],
    reviewDate: "2026-08-24",
    status: "approved",
    authenticityConfirmed: true,
  });
  assert.equal(r.response.status, 200);
  assert.equal(r.body.status, "approved");
  assert.equal(r.body.rating, 5);
  assert.equal(r.body.images.length, 2);
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 1);
  assert.equal(r.body.reviews[0].title, "Updated authentic feedback");
  r = await call(base, `/api/stores/${store.id}/reviews`);
  assert.equal(r.body[0].source, "manual");
  assert.equal(r.body[0].productName, "Hair Oil");
  r = await call(base, `/api/stores/${store.id}/reviews/${draft.id}`, "DELETE");
  assert.equal(r.response.status, 200);
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 0);
  r = await call(base, `/api/stores/${store.id}/reviews`, "POST", {
    productId: product.id,
    customerName: "Fake",
    rating: 5,
    text: "Unattested",
    status: "approved",
  });
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /authentic customer feedback/i);
});

test("Reviews dashboard supports filters, details, and store-isolated bulk moderation", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);
  const other = await setup(base, "other");
  const first = (
    await call(
      base,
      `/api/public/stores/${store.id}/products/${product.id}/reviews`,
      "POST",
      {
        customerName: "Rahul",
        rating: 5,
        text: "First genuine consumer review.",
      },
    )
  ).body;
  const second = (
    await call(
      base,
      `/api/public/stores/${store.id}/products/${product.id}/reviews`,
      "POST",
      {
        customerName: "Anita",
        rating: 4,
        text: "Second genuine consumer review.",
      },
    )
  ).body;
  let r = await call(
    base,
    `/api/stores/${store.id}/reviews?source=consumer&status=pending`,
  );
  assert.equal(r.body.length, 2);
  r = await call(base, `/api/stores/${store.id}/reviews/${first.id}`);
  assert.equal(r.body.customerName, "Rahul");
  assert.equal(r.body.productName, "Hair Oil");
  r = await call(
    base,
    `/api/stores/${other.store.id}/reviews/bulk-status`,
    "PATCH",
    { reviewIds: [first.id, second.id], status: "approved" },
  );
  assert.equal(r.response.status, 404);
  r = await call(base, `/api/stores/${store.id}/reviews/bulk-status`, "PATCH", {
    reviewIds: [first.id, second.id],
    status: "approved",
  });
  assert.equal(r.body.length, 2);
  assert.ok(r.body.every((item) => item.status === "approved"));
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 2);
  assert.equal(r.body.summary.average, 4.5);
  const index = await call(base, "/"),
    script = await call(base, "/app.js");
  assert.match(index.body, /data-view="reviews">Reviews/);
  for (const text of [
    "Search reviews",
    "Pending",
    "Approved",
    "Disapproved",
    "Add Review",
    "Bulk Upload",
    "Customer",
    "Product",
    "Rating",
    "Review",
    "Images",
    "Source",
    "Date",
    "Status",
    "Approve",
    "Disapprove",
    "Review Detail",
    "Preview",
    "Remove",
    "Replace",
  ])
    assert.match(script.body, new RegExp(text));
  assert.match(
    script.body,
    /<th>CUSTOMER<\/th><th>PRODUCT<\/th><th>RATING<\/th><th>REVIEW<\/th><th>SOURCE<\/th><th>DATE<\/th><th>STATUS<\/th>/,
  );
  assert.match(script.body, /review-media-preview/);
  assert.match(script.body, /Image unavailable/);
  assert.match(script.body, /function reviewMobileCard/);
  assert.match(script.body, /class="review-mobile-list"/);
  assert.match(script.body, /id="review-filter-button"/);
  assert.match(script.body, /function showReviewMobileFilters/);
  assert.match(script.body, /review-card-checkbox/);
  assert.match(script.body, /Manual reviews are already approved and cannot be bulk moderated/);
  assert.match(script.body, /class="review-action-edit"/);
  assert.match(script.body, /class="review-action-status"/);
  assert.match(script.body, /class="review-action-delete danger-text"/);
  assert.match(script.body, /review\.status !== "approved"/);
  assert.match(script.body, /review\.status !== "disapproved"/);
  r = await call(
    base,
    `/api/stores/${other.store.id}/reviews/${first.id}`,
    "DELETE",
  );
  assert.equal(r.response.status, 404);
  r = await call(
    base,
    `/api/stores/${store.id}/reviews/${first.id}`,
    "DELETE",
  );
  assert.equal(r.response.status, 200);
  r = await call(base, `/api/stores/${store.id}/reviews`);
  assert.equal(r.body.length, 1);
});
