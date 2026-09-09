import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

// Execute the actual served scripts against a small DOM double, including reset
// and reopen events. No reviews are written to the merchant's database.
function mount(html, fetchImpl) {
  const nodes = new Map();
  const node = (id) => {
    const handlers = new Map();
    const element = {
      hidden: false, disabled: false, textContent: "", innerHTML: "", files: [],
      focus() { element.focused = true; },
      scrollIntoView() {},
      addEventListener(type, handler) {
        handlers.set(type, [...(handlers.get(type) || []), handler]);
      },
      async emit(type) {
        for (const handler of handlers.get(type) || [])
          await handler({ preventDefault() {} });
      },
    };
    nodes.set(id, element);
    return element;
  };
  for (const id of ["review-form", "review-status", "review-images",
    "review-image-preview", "open-review-form", "close-review-form", "cancel-review", "submit-review"])
    node(id);
  const form = nodes.get("review-form");
  form.resetCount = 0;
  form.querySelector = (selector) => selector === '[name="images"]'
    ? nodes.get("review-images") : selector === '[type="submit"]' ? nodes.get("submit-review") : null;
  form.reset = () => {
    form.resetCount++;
    nodes.get("review-images").files = [];
    void form.emit("reset");
  };
  const context = {
    document: { querySelector: (selector) => nodes.get(selector.slice(1)) || null, querySelectorAll: () => [] },
    window: {}, fetch: fetchImpl,
    setTimeout(callback) { callback(); },
    FormData: class { *[Symbol.iterator]() {
      yield* Object.entries({ customerName: "Browser Test", rating: "4", text: "Review submission fixture." });
    } },
  };
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  for (const marker of ["let reviewSubmitting=false", "const showReview="]) {
    const script = scripts.find((source) => source.includes(marker));
    assert.ok(script, `missing served script: ${marker}`);
    runInNewContext(script, context);
  }
  return Object.fromEntries(nodes);
}

test("review submission closes only after success and can reopen cleanly", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  const store = app.service.createStore({ name: "Review UI Test", slug: "review-ui-test" });
  const product = app.service.createProduct(store.id, {
    name: "Review Test Product", slug: "review-test-product", pricePaise: 49900, stock: 5,
  });
  const page = app.service.createProductPage(store.id, {
    productId: product.id, title: "Review Test Page", slug: "review-test-page", body: "Test fixture",
  });
  app.service.publishPage(store.id, page.id);
  await app.start();
  t.after(() => app.stop());
  const html = await fetch(`http://127.0.0.1:${app.port}/s/review-ui-test/review-test-page`).then((response) => response.text());
  assert.doesNotMatch(html, /review-success|Review submitted for approval/);
  for (const rating of [1,2,3,4,5]) assert.match(html, new RegExp(`aria-label="${rating} ${rating === 1 ? 'star' : 'stars'}"`));

  await t.test("success closes silently and prevents duplicate submits", async () => {
    let release, requests = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    const ui = mount(html, async () => { requests++; await pending; return { ok: true, json: async () => ({ status: "pending" }) }; });
    const submission = ui["review-form"].emit("submit");
    assert.equal(ui["submit-review"].disabled, true);
    await ui["review-form"].emit("submit");
    assert.equal(requests, 1);
    assert.equal(ui["review-form"].hidden, false);
    release();
    await submission;
    assert.equal(ui["review-form"].hidden, true);
    assert.equal(ui["review-form"].resetCount, 1);
    assert.equal(ui["review-status"].textContent, "");
    assert.equal(ui["open-review-form"].focused, true);
    assert.equal(ui["submit-review"].disabled, false);
    await ui["open-review-form"].emit("click");
    assert.equal(ui["review-form"].hidden, false);
    assert.equal(ui["review-status"].textContent, "");
  });

  for (const [name, fetchImpl, message] of [
    ["server rejection", async () => ({ ok: false, json: async () => ({ error: "Please check your review." }) }), "Please check your review."],
    ["network failure", async () => { throw Error("Connection failed"); }, "Connection failed"],
  ]) await t.test(`${name} keeps the form and entered details`, async () => {
    const ui = mount(html, fetchImpl);
    await ui["review-form"].emit("submit");
    assert.equal(ui["review-form"].hidden, false);
    assert.equal(ui["review-form"].resetCount, 0);
    assert.equal(ui["review-status"].textContent, message);
    assert.equal(ui["submit-review"].disabled, false);
  });
});
