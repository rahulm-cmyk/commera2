import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDatabase } from "../src/database.js";
import { CommerceService } from "../src/commerce-service.js";
import { ReviewService } from "../src/review-service.js";
import { createApp } from "../src/server.js";

function setup() {
  const db = createDatabase(":memory:"),
    commerce = new CommerceService(db),
    store = commerce.createStore({ name: "Review QA", slug: "review-qa" }),
    product = commerce.createProduct(store.id, {
      name: "19-Herb Bhringraj Hair Oil",
      slug: "hair-oil",
      pricePaise: 79900,
      stock: 10,
    });
  return { db, store, product, reviews: new ReviewService(db) };
}

const manual = (productId, overrides = {}) => ({
  productId,
  customerName: "Asha Patel",
  rating: 5,
  title: "Great results",
  text: "This is authentic and readable customer feedback.",
  status: "approved",
  authenticityConfirmed: true,
  ...overrides,
});

test("manual reviews reject punctuation-only content without blocking multilingual or emoji feedback", () => {
  const { db, store, product, reviews } = setup();
  try {
    assert.throws(
      () =>
        reviews.createManual(
          store.id,
          manual(product.id, { title: "", text: ";;;;;/" }),
        ),
      /readable feedback or an emoji/i,
    );
    assert.throws(
      () =>
        reviews.createManual(
          store.id,
          manual(product.id, { title: ";l" }),
        ),
      /title must contain readable text or an emoji/i,
    );

    const multilingual = reviews.createManual(
      store.id,
      manual(product.id, {
        customerName: "आरव सिंह",
        title: "बहुत अच्छा",
        text: "बालों के लिए बहुत उपयोगी",
      }),
    );
    const emoji = reviews.createManual(
      store.id,
      manual(product.id, {
        customerName: "李明",
        title: "👍",
        text: "👍",
      }),
    );

    assert.equal(multilingual.customerName, "आरव सिंह");
    assert.equal(multilingual.title, "बहुत अच्छा");
    assert.equal(multilingual.text, "बालों के लिए बहुत उपयोगी");
    assert.equal(emoji.title, "👍");
    assert.equal(emoji.text, "👍");
  } finally {
    db.close();
  }
});

test("legacy future dates are labelled for the UI without mutating the stored review", () => {
  const { db, store, product, reviews } = setup();
  try {
    const result = db
      .prepare(
        `INSERT INTO reviews
          (store_id, product_id, customer_name, rating, title, review_text, source, status, review_date)
         VALUES (?, ?, ?, ?, ?, ?, 'manual', 'approved', ?)`,
      )
      .run(store.id, product.id, "iou", 5, ";l", ";;;;;/", "8999-09-08");
    const review = reviews.get(store.id, Number(result.lastInsertRowid));
    const stored = db
      .prepare("SELECT review_date FROM reviews WHERE id = ?")
      .get(Number(result.lastInsertRowid));

    assert.equal(review.customerName, "iou");
    assert.equal(review.title, ";l");
    assert.equal(review.text, ";;;;;/");
    assert.equal(review.reviewDate, null);
    assert.equal(review.reviewDateInvalid, true);
    assert.equal(stored.review_date, "8999-09-08");
  } finally {
    db.close();
  }
});

test("review list source includes readable identity, content, media, and responsive quality states", () => {
  const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8"),
    css = readFileSync(
      new URL("../public/reviews-ui.css", import.meta.url),
      "utf8",
    ),
    html = readFileSync(
      new URL("../public/index.html", import.meta.url),
      "utf8",
    );

  assert.match(app, /review-customer-avatar/);
  assert.match(app, /No readable review text/);
  assert.match(app, /Needs editing/);
  assert.match(app, /Image unavailable/);
  assert.match(app, /reviewDateInvalid/);
  assert.match(css, /text-decoration:\s*none\s*!important/);
  assert.match(css, /-webkit-line-clamp:\s*2/);
  assert.match(css, /max-width:\s*1279px/);
  assert.match(css, /@media \(max-width: 767px\)/);
  assert.match(html, /reviews-ui\.css\?v=reviews-ui-\d+/);
  assert.match(html, /app\.js\?v=ui-overlays-\d+/);
});

test('Reviews switches to complete cards by panel width and never clips the table', () => {
  const css = readFileSync(new URL('../public/reviews-ui.css', import.meta.url), 'utf8');
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(css, /container-name:\s*reviews/);
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /max-width:\s*1440px/);
  assert.match(css, /@container reviews \(max-width: 1040px\)/);
  assert.match(css, /\.reviews-shell \.review-mobile-list \{ display: grid; grid-template-columns: repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /@container reviews \(max-width: 640px\)/);
  assert.doesNotMatch(css, /overflow-x:\s*clip/);
  const card = app.slice(app.indexOf('function reviewMobileCard('), app.indexOf('function showReviewMobileFilters('));
  for (const field of ['reviewCustomerIdentity','review.rating','reviewPreviewHtml','reviewSourceLabel','reviewDateHtml','review.status','reviewRowActions']) assert.ok(card.includes(field), field);
});

test("the dedicated Reviews stylesheet is served as CSS", async (t) => {
  const db = createDatabase(":memory:"),
    app = createApp({ db, port: 0, merchantAuth: false });
  await app.start();
  t.after(async () => {
    await app.stop();
  });

  const response = await fetch(
    `http://127.0.0.1:${app.port}/reviews-ui.css?v=reviews-ui-5`,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") || "", /^text\/css/);
  assert.match(await response.text(), /\.review-customer-identity/);
});

test("public review rating controls remain contained and keyboard accessible", () => {
  const css = readFileSync(new URL("../public/store.css", import.meta.url), "utf8");
  const ratingGroup = css.match(/\.star-rating\s*\{([^}]+)\}/)?.[1] || "";
  const ratingInput = css.match(/\.star-rating input\s*\{([^}]+)\}/)?.[1] || "";
  assert.match(ratingGroup, /position:\s*relative/, "hidden controls need a local containing block");
  for (const property of ["width", "height"])
    assert.match(ratingInput, new RegExp(`\\b${property}:\\s*1px`));
  for (const property of ["top", "left", "margin", "padding", "border"])
    assert.match(ratingInput, new RegExp(`\\b${property}:\\s*0`));
  assert.doesNotMatch(ratingInput, /display:\s*none|visibility:\s*hidden/, "native rating controls must stay focusable");
  assert.match(css, /\.star-rating input:focus-visible\s*\+\s*label\s*\{[^}]*outline:/);
});
