import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function request(base, path, method = "GET", data, headers = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const type = response.headers.get("content-type") || "";
  return {
    response,
    body: type.includes("json") ? await response.json() : await response.text(),
  };
}
function requestWithHost(base, host) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { hostname: url.hostname, port: url.port, path: "/", headers: { host } },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ response: { status: res.statusCode }, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function storefront(base) {
  let result = await request(base, "/api/stores", "POST", {
    name: "Nivkara",
    slug: "nivkara",
  });
  const store = result.body;
  result = await request(base, `/api/stores/${store.id}/products`, "POST", {
    name: "Hair Oil",
    slug: "hair-oil",
    pricePaise: 79900,
    stock: 10,
  });
  const product = result.body;
  result = await request(base, `/api/stores/${store.id}/pages`, "POST", {
    productId: product.id,
    title: "Nivkara Hair Ritual",
    slug: "ritual",
    body: "Daily ritual",
  });
  const page = result.body;
  await request(
    base,
    `/api/stores/${store.id}/pages/${page.id}/publish`,
    "POST",
    {},
  );
  return { store, product, page };
}

test("domain flows from pending DNS through SSL active, primary, live routing, and disconnect", async (t) => {
  let ready = false;
  const sslCalls = [];
  const dnsResolver = {
    async resolveCname() {
      return ready ? ["domains.commera2.app"] : ["wrong.example"];
    },
    async resolveTxt() {
      return ready ? [[this.token]] : [["wrong-token"]];
    },
    token: "",
  };
  const sslProvider = {
    async provisionDomain(context) {
      sslCalls.push(context);
      return { status: "active" };
    },
  };
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    domainOptions: {
      dnsResolver,
      sslProvider,
      cnameTarget: "domains.commera2.app",
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await storefront(base);

  let result = await request(base, `/api/stores/${store.id}/domains`, "POST", {
    domainName: "shop.nivkara.com",
    primaryDomain: false,
  });
  assert.equal(result.response.status, 201);
  const domain = result.body;
  assert.equal(domain.domainName, "shop.nivkara.com");
  assert.equal(domain.primaryDomain, false);
  assert.equal(domain.status, "pending_verification");
  assert.equal(domain.cnameTarget, "domains.commera2.app");
  assert.match(domain.txtName, /^_commera2\./);
  assert.match(domain.txtValue, /^commera2-domain-verification=/);
  dnsResolver.token = domain.txtValue;

  result = await request(
    base,
    `/api/stores/${store.id}/domains/${domain.id}/check-dns`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.dnsReady, false);
  assert.equal(result.body.status, "pending_verification");

  ready = true;
  result = await request(
    base,
    `/api/stores/${store.id}/domains/${domain.id}/check-dns`,
    "POST",
    {},
  );
  assert.equal(result.body.dnsReady, true);
  assert.equal(result.body.status, "pending_verification");
  result = await request(
    base,
    `/api/stores/${store.id}/domains/${domain.id}/verify`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, "active");
  assert.equal(sslCalls.length, 1);

  result = await request(
    base,
    `/api/stores/${store.id}/domains/${domain.id}/primary`,
    "POST",
    {},
  );
  assert.equal(result.body.primaryDomain, true);
  result = await requestWithHost(base, "shop.nivkara.com");
  assert.equal(result.response.status, 200);
  assert.match(result.body, /Nivkara Hair Ritual/);

  result = await request(
    base,
    `/api/stores/${store.id}/domains/${domain.id}`,
    "DELETE",
  );
  assert.equal(result.response.status, 200);
  result = await request(base, `/api/stores/${store.id}/domains`);
  assert.deepEqual(result.body, []);
});

test("verified domain remains SSL Pending without an authorized SSL provider and stays store-isolated", async (t) => {
  const dnsResolver = {
    token: "",
    async resolveCname() {
      return ["domains.commera2.app"];
    },
    async resolveTxt() {
      return [[this.token]];
    },
  };
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    domainOptions: { dnsResolver, cnameTarget: "domains.commera2.app" },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await storefront(base);
  const other = (
    await request(base, "/api/stores", "POST", { name: "Other", slug: "other" })
  ).body;
  let result = await request(base, `/api/stores/${store.id}/domains`, "POST", {
    domainName: "nivkara.example",
  });
  const domain = result.body;
  dnsResolver.token = domain.txtValue;
  result = await request(
    base,
    `/api/stores/${store.id}/domains/${domain.id}/verify`,
    "POST",
    {},
  );
  assert.equal(result.body.status, "ssl_pending");
  result = await request(
    base,
    `/api/stores/${store.id}/domains/${domain.id}/primary`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 400);
  result = await request(
    base,
    `/api/stores/${other.id}/domains/${domain.id}/check-dns`,
    "POST",
    {},
  );
  assert.equal(result.response.status, 404);
});

test("merchant UI exposes domain fields, statuses, and lifecycle actions", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0 });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  let result = await request(base, "/");
  assert.match(result.body, /data-view="settings">Settings/);
  assert.doesNotMatch(result.body, /data-view="domains">Domains/);
  result = await request(base, "/app.js");
  assert.match(result.body, /\[\s*["']domain["']\s*,\s*["']Domain["']\s*\]/);
  for (const text of [
    "Domain Name",
    "Primary Domain",
    "Not Connected",
    "Pending Verification",
    "Verified",
    "SSL Pending",
    "Active",
    "Error",
    "Add Domain",
    "Check DNS",
    "Verify Domain",
    "Set Primary",
    "Disconnect",
  ])
    assert.match(result.body, new RegExp(text));
});
