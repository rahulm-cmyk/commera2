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
  const body = type.includes("json")
    ? await response.json()
    : await response.text();
  return { response, body };
}

test("HTTP project flow creates template and safely imported live pages", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;

  let result = await call(base, "/api/stores", "POST", {
    name: "Nivkara",
    slug: "nivkara",
  });
  const store = result.body;
  result = await call(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Hair Oil",
    slug: "oil",
    pricePaise: 99900,
    stock: 10,
  });
  const product = result.body;
  result = await call(base, `/api/stores/${store.id}/projects`, "POST", {
    name: "Hair Oil Funnel",
    slug: "oil-funnel",
    productId: product.id,
  });
  const project = result.body;

  result = await call(base, "/api/page-templates");
  assert.equal(result.body.length, 4);

  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "template",
    projectId: project.id,
    productId: product.id,
    templateKey: "clinical-proof",
    title: "Proof-led Ritual",
    slug: "proof",
    socialProofType: "fake",
    urgencyType: "limited-stock",
    urgencyText: "Only 7 left in stock",
    announcementText: "Free shipping across India today",
  });
  const page = result.body;
  assert.equal(page.creationMethod, "template");
  const pageContent = JSON.parse(page.contentJson);
  assert.equal(pageContent.socialProofType, undefined);
  assert.deepEqual(pageContent.urgency, {
    enabled: true,
    type: "limited-stock",
    text: "Only 7 left in stock",
  });
  assert.equal(pageContent.announcement, "Free shipping across India today");

  await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  result = await call(base, "/s/nivkara/proof");
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Proof-led Ritual/);
  assert.match(result.body, /theme-clinical-proof/);
  assert.doesNotMatch(result.body, /Social proof|Verified social proof/i);
  assert.match(result.body, /Customer Reviews/);
  assert.match(result.body, /Only 7 left in stock/);
  assert.match(result.body, /Free shipping across India today/);
  assert.match(result.body, /data-direct-checkout="true"/);
  assert.doesNotMatch(result.body, /id="cod-form"/);

  result = await call(base, "/app.js");
  assert.match(result.body, /Announcement Bar/);
  assert.match(result.body, /announcementText/);

  result = await call(
    base,
    `/api/stores/${store.id}/pages/${page.id}`,
    "PATCH",
    {
      socialProofType: "real",
      urgency: { enabled: false, type: "none", text: "" },
    },
  );
  assert.equal(result.response.status, 200);
  const editedContent = JSON.parse(result.body.contentJson);
  assert.equal(editedContent.socialProofType, undefined);
  assert.equal(editedContent.urgency.enabled, false);
  result = await call(base, "/s/nivkara/proof");
  assert.match(result.body, /Only 7 left in stock/);
  await call(base, `/api/stores/${store.id}/pages/${page.id}/publish`, "POST", {});
  result = await call(base, "/s/nivkara/proof");
  assert.doesNotMatch(result.body, /Social proof|Verified social proof/i);
  assert.doesNotMatch(result.body, /Only 7 left in stock/);

  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "upload",
    projectId: project.id,
    productId: product.id,
    title: "Imported",
    slug: "imported",
    html: '<h1 onclick="bad()">Imported safe content</h1><script>bad()</script>',
  });
  assert.equal(result.response.status, 201);
  assert.doesNotMatch(result.body.importedHtml, /onclick|script/i);

  result = await call(base, `/api/stores/${store.id}/pages`, "POST", {
    creationMethod: "ai",
    projectId: project.id,
    productId: product.id,
    title: "AI",
    slug: "ai",
    brief: "Brief",
  });
  assert.equal(result.response.status, 400);
  assert.match(result.body.error, /not configured or authorized/i);
});
