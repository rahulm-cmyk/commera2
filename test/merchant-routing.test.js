import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

test("merchant routes serve the app shell for refresh and deep links", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const routes = [
    "/overview",
    "/store",
    "/products",
    "/products/new",
    "/products/123",
    "/products/bundles",
    "/product-pages",
    "/product-pages/456/edit",
    "/reviews",
    "/reviews/pending",
    "/orders",
    "/orders/123",
    "/customers",
    "/abandoned",
    "/policy",
    "/policy/written",
    "/settings",
    "/settings/domain",
  ];

  for (const route of routes) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get("content-type") || "", /text\/html/);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    assert.match(await response.text(), /<title>Commera2<\/title>/);
  }

  const missing = await fetch(base + "/not-a-merchant-route");
  assert.equal(missing.status, 404);
});

test("merchant navigation uses URL history and persists the selected store", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const response = await fetch(`http://127.0.0.1:${app.port}/app.js`);
  assert.match(response.headers.get("cache-control") || "", /no-cache/);
  const source = await response.text();

  assert.match(source, /function routeFromPath/);
  assert.match(source, /history\[method\]\(\{\}, "", path\)/);
  assert.match(source, /window\.addEventListener\("popstate"/);
  assert.match(source, /commera2-selected-store/);
  assert.match(source, /function storeView/);
  assert.match(source, /Store Identity/);
  assert.match(source, /Publish Store/);
  assert.match(source, /localStorage\.setItem\(selectedStoreKey/);
  assert.match(
    source,
    /\/product-pages\/\$\{Number\(button\.dataset\.id\)\}\/edit/,
  );
});
