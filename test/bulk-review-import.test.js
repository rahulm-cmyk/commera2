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
  let r = await call(base, "/api/stores", "POST", {
      name: "Nivkara",
      slug: "nivkara",
    }),
    store = r.body;
  r = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock: 10,
  });
  return { store, product: r.body };
}
const header =
  "product_handle*,rating*,author*,title,content,author_country,author_email,commented_at*,reply,reply_at,verify_purchase,feature,publish,item_type,photo_url_1,photo_url_2,photo_url_3,photo_url_4,photo_url_5,video_url";
const csv = [
  header,
  "hair-oil,5,Rahul,Great,Authentic review text,India,rahul@example.com,01/05/   %2026,Thank you,2026-08-26,yes,yes,yes,review,https://cdn.example/one.png,,,,,https://cdn.example/review.mp4",
  "missing-product,4,Priya,Good,Review text,India,,2026-08-24,,,no,no,no,review,,,,,,",
  "hair-oil,7,Amit,Invalid,,India,bad-email,2026-02-31,,,no,no,no,review,,,,,,",
  "hair-oil,4,Neha,Useful,Authentic review with unavailable image,India,,2026-08-23,,,yes,no,no,review,https://cdn.example/missing.png,,,,,",
].join("\n");
const media = async (url, kind) => {
  if (url.includes("missing")) throw Error("Image URL could not be loaded");
  if (kind === "Video") return { type: "video/mp4", url };
  return {
    type: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  };
};

test("bulk review CSV template and validation produce a non-importing row preview", async (t) => {
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    reviewImportOptions: { fetchMedia: media },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await setup(base);
  let r = await call(base, `/api/stores/${store.id}/review-imports/template`);
  assert.equal(r.response.status, 200);
  assert.match(r.body, /product_handle,rating,author/);
  assert.match(r.body, /photo_url_5,video_url/);
  r = await call(
    base,
    `/api/stores/${store.id}/review-imports/validate`,
    "POST",
    { fileName: "trustoo-reviews.csv", csv },
  );
  assert.equal(r.response.status, 201);
  assert.equal(r.body.totalRows, 4);
  assert.equal(r.body.validRows, 1);
  assert.equal(r.body.warningRows, 1);
  assert.equal(r.body.errorRows, 2);
  assert.equal(r.body.rows[0].status, "ready");
  assert.equal(r.body.rows[0].reviewDate, "2026-01-05");
  assert.equal(r.body.rows[1].status, "error");
  assert.match(r.body.rows[1].errors.join(" "), /Product handle not found/);
  assert.match(
    r.body.rows[2].errors.join(" "),
    /Invalid rating.*Invalid review date.*Invalid email/i,
  );
  assert.equal(r.body.rows[3].status, "warning");
  assert.match(
    r.body.rows[3].warnings.join(" "),
    /Image URL could not be loaded/,
  );
  r = await call(base, `/api/stores/${store.id}/reviews`);
  assert.equal(r.body.length, 0);
});

test("bulk import applies approval mode, imported verification source, media, and blocking-error rules", async (t) => {
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    reviewImportOptions: { fetchMedia: media },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, product } = await setup(base);
  let pageResponse = await call(base, `/api/stores/${store.id}/pages`, "POST", {
      productId: product.id,
      title: "Hair Ritual",
      slug: "ritual",
      body: "Daily ritual",
    }),
    page = pageResponse.body;
  await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  let r = await call(
      base,
      `/api/stores/${store.id}/review-imports/validate`,
      "POST",
      { fileName: "trustoo-reviews.csv", csv },
    ),
    batch = r.body;
  r = await call(
    base,
    `/api/stores/${store.id}/review-imports/${batch.id}/import`,
    "POST",
    { mode: "use_csv", importValidOnly: false, authenticityConfirmed: true },
  );
  assert.equal(r.response.status, 400);
  assert.match(r.body.error, /blocking errors/i);
  r = await call(
    base,
    `/api/stores/${store.id}/review-imports/${batch.id}/import`,
    "POST",
    { mode: "use_csv", importValidOnly: true, authenticityConfirmed: true },
  );
  assert.equal(r.response.status, 200);
  assert.equal(r.body.totalRows, 4);
  assert.equal(r.body.imported, 2);
  assert.equal(r.body.skipped, 2);
  assert.equal(r.body.failed, 0);
  r = await call(base, `/api/stores/${store.id}/reviews`);
  assert.equal(r.body.length, 2);
  assert.ok(r.body.every((review) => review.source === "bulk"));
  r = await call(base, `/api/stores/${store.id}/reviews?source=bulk`);
  assert.equal(r.body.length, 2);
  const approved = r.body.find((review) => review.status === "approved"),
    pending = r.body.find((review) => review.status === "pending");
  assert.ok(approved);
  assert.ok(pending);
  assert.equal(approved.verifiedPurchase, true);
  assert.equal(approved.verificationSource, "imported");
  assert.equal(approved.featured, true);
  assert.equal(approved.images.length, 1);
  assert.equal(approved.videoUrl, "https://cdn.example/review.mp4");
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 1);
  assert.equal(r.body.reviews[0].source, "bulk");
  r = await call(base, "/s/nivkara/ritual");
  assert.match(r.body, /Verified Purchase · Imported/);
  assert.match(r.body, /Featured Review/);
  assert.match(r.body, /<video[^>]+review\.mp4/);
  assert.match(r.body, /Merchant reply[\s\S]*Thank you/);
  r = await call(
    base,
    `/api/stores/${store.id}/reviews/${pending.id}/status`,
    "PATCH",
    { status: "approved" },
  );
  assert.equal(r.response.status, 200);
  assert.equal(r.body.status, "approved");
  r = await call(
    base,
    `/api/public/stores/${store.id}/products/${product.id}/reviews`,
  );
  assert.equal(r.body.summary.count, 2);
  r = await call(
    base,
    `/api/stores/${store.id}/reviews/${approved.id}/imported`,
    "PATCH",
    { featured: false, reply: "Updated merchant reply" },
  );
  assert.equal(r.response.status, 200);
  assert.equal(r.body.featured, false);
  assert.equal(r.body.merchantReply, "Updated merchant reply");
  r = await call(
    base,
    `/api/stores/${store.id}/review-imports/${batch.id}/errors.csv`,
  );
  assert.equal(r.response.status, 200);
  assert.match(r.body, /Product handle not found/);
  assert.match(r.body, /Invalid rating/);
});

test("bulk import history persists counts and exposes only the imported reviews in its store", async (t) => {
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    reviewImportOptions: { fetchMedia: media },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await setup(base),
    other = (
      await call(base, "/api/stores", "POST", { name: "Other", slug: "other" })
    ).body,
    cleanCsv = [
      header,
      "hair-oil,5,Rahul,Great,First genuine review,India,,2026-08-25,,,yes,yes,no,review,,,,,,",
      "hair-oil,4,Priya,Good,Second genuine review,India,,2026-08-24,,,no,no,no,review,,,,,,",
    ].join("\n");
  let r = await call(
      base,
      `/api/stores/${store.id}/review-imports/validate`,
      "POST",
      { fileName: "history.csv", csv: cleanCsv },
    ),
    batch = r.body;
  r = await call(
    base,
    `/api/stores/${store.id}/review-imports/${batch.id}/import`,
    "POST",
    {
      mode: "all_approved",
      importValidOnly: false,
      authenticityConfirmed: true,
      importedBy: "Store Admin",
    },
  );
  assert.equal(r.body.imported, 2);
  r = await call(base, `/api/stores/${store.id}/review-imports`);
  assert.equal(r.body.length, 1);
  assert.equal(r.body[0].fileName, "history.csv");
  assert.equal(r.body[0].totalRows, 2);
  assert.equal(r.body[0].importedCount, 2);
  assert.equal(r.body[0].failedCount, 0);
  assert.equal(r.body[0].importedBy, "Store Admin");
  r = await call(base, `/api/stores/${store.id}/review-imports/${batch.id}`);
  assert.equal(r.body.createdReviews.length, 2);
  assert.ok(
    r.body.createdReviews.every(
      (review) => review.source === "bulk" && review.status === "approved",
    ),
  );
  r = await call(base, `/api/stores/${other.id}/review-imports`);
  assert.deepEqual(r.body, []);
  r = await call(base, `/api/stores/${other.id}/review-imports/${batch.id}`);
  assert.equal(r.response.status, 404);
});

test("merchant Reviews UI exposes the complete staged bulk upload workflow and history", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  await setup(base);
  const index = await call(base, "/"),
    script = await call(base, "/app.js");
  assert.match(index.body, /data-view="reviews"><img[^>]*>Reviews/);
  for (const text of [
    "Bulk Upload",
    "Bulk Import Reviews",
    "Download Template",
    "Drop CSV here",
    "Choose CSV File",
    "Validate CSV",
    "Preview",
    "Import Valid Reviews",
    "Import All",
    "Review Status After Import",
    "Use CSV &quot;publish&quot; value",
    "Import All as Pending",
    "Import All as Approved",
    "Import History",
    "File Name",
    "Upload Date",
    "Total Rows",
    "Imported",
    "Failed",
    "Imported By",
    "View Imported Reviews",
    "Download Error Report",
    "Bulk Import",
    "Featured Review",
    "Feature Review",
    "Unfeature Review",
  ])
    assert.match(script.body, new RegExp(text));
});
