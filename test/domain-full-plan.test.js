import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
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

function withHost(base, host, path = "/") {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path,
        headers: { host },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function makeStore(base, name, slug) {
  const store = (await call(base, "/api/stores", "POST", { name, slug })).body;
  const product = (
    await call(base, `/api/stores/${store.id}/products`, "POST", {
      name: `${name} Product`,
      slug: "product",
      pricePaise: 99900,
      stock: 10,
    })
  ).body;
  const page = (
    await call(base, `/api/stores/${store.id}/pages`, "POST", {
      productId: product.id,
      title: `${name} Offer`,
      slug: "offer",
      body: "Connected-domain offer",
    })
  ).body;
  await call(base, `/api/stores/${store.id}/pages/${page.id}/publish`, "POST", {});
  return { store, product, page };
}

test("domain validation normalizes a simple URL and rejects unsafe hostname input", async (t) => {
  const app = createApp({ db: createDatabase(":memory:"), port: 0, domainOptions: { cnameTarget: 'edge.example.com' } });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const first = await makeStore(base, "First", "first");
  const second = await makeStore(base, "Second", "second");

  let result = await call(base, `/api/stores/${first.store.id}/domains`, "POST", {
    domainName: " HTTPS://WWW.Example.COM/ ",
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.domainName, "www.example.com");
  assert.equal(result.body.hostnameKind, "subdomain");
  assert.equal(result.body.overallStatus, "PENDING_CONFIGURATION");
  assert.deepEqual(result.body.dnsRecords.map((record) => record.type), ["CNAME"]);

  result = await call(base, `/api/stores/${second.store.id}/domains`, "POST", {
    domainName: "www.example.com",
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "This domain is already connected to another store.");

  for (const invalid of [
    "https://example.com/product",
    "example.com?test=1",
    "example.com:3000",
    "192.0.2.10",
    "*.example.com",
    "shop.shops.commera2.app",
  ]) {
    result = await call(base, `/api/stores/${second.store.id}/domains`, "POST", {
      domainName: invalid,
    });
    assert.equal(result.response.status, 400, invalid);
  }

  const audit = await call(
    base,
    `/api/stores/${first.store.id}/domains/audit-log`,
  );
  assert.equal(audit.body[0].action, "DOMAIN_ADDED");
  assert.equal(audit.body[0].details.hostname, "www.example.com");
});

test("DNS records update independently and successful verification activates SSL", async (t) => {
  let routeReady = false;
  let ownershipReady = false;
  let expectedToken = "";
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    domainOptions: {
      cnameTarget: "domains.commera2.app",
      dnsResolver: {
        async resolveCname() {
          return routeReady ? ["domains.commera2.app"] : [];
        },
        async resolveTxt() {
          return ownershipReady ? [[expectedToken]] : [];
        },
      },
      sslProvider: {
        async provisionDomain() {
          return { status: "active", hostnameId: "provider-host-1" };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await makeStore(base, "Records", "records");
  let result = await call(base, `/api/stores/${store.id}/domains`, "POST", {
    domainName: "records.example",
  });
  const id = result.body.id;
  expectedToken = result.body.txtValue;

  routeReady = true;
  result = await call(
    base,
    `/api/stores/${store.id}/domains/${id}/check-dns`,
    "POST",
    {},
  );
  assert.equal(result.body.dnsState, "partially_configured");
  assert.equal(result.body.dnsRecords[0].currentStatus, "correct");
  assert.equal(result.body.dnsRecords[1].currentStatus, "pending");

  ownershipReady = true;
  result = await call(
    base,
    `/api/stores/${store.id}/domains/${id}/verify`,
    "POST",
    {},
  );
  assert.equal(result.body.overallStatus, "ACTIVE");
  assert.equal(result.body.ownershipStatus, "verified");
  assert.equal(result.body.sslStatus, "active");
  assert.equal(result.body.routingStatus, "active");
  assert.ok(result.body.activatedAt);
  const audit = await call(base, `/api/stores/${store.id}/domains/audit-log`);
  assert.ok(audit.body.some((entry) => entry.action === "DNS_VERIFIED"));
  assert.ok(audit.body.some((entry) => entry.action === "SSL_ACTIVATED"));
});

test("subdomain custom domains verify with CNAME only", async (t) => {
  let routeReady = false;
  let txtLookups = 0;
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    domainOptions: {
      cnameTarget: "domains.commera2.app",
      dnsResolver: {
        async resolveCname() {
          return routeReady ? ["domains.commera2.app"] : [];
        },
        async resolveTxt() {
          txtLookups += 1;
          return [];
        },
      },
      sslProvider: {
        async provisionDomain() {
          return { status: "active" };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store } = await makeStore(base, "Subdomain", "subdomain");
  let result = await call(base, `/api/stores/${store.id}/domains`, "POST", {
    domainName: "shop.subdomain.example",
  });
  assert.deepEqual(result.body.dnsRecords.map((record) => record.type), ["CNAME"]);
  assert.equal(result.body.ownershipVerificationMethod, "dns_cname");

  routeReady = true;
  result = await call(
    base,
    `/api/stores/${store.id}/domains/${result.body.id}/verify`,
    "POST",
    {},
  );
  assert.equal(result.body.overallStatus, "ACTIVE");
  assert.equal(result.body.dnsReady, undefined);
  assert.equal(result.body.ownershipStatus, "verified");
  assert.equal(txtLookups, 0);
});

test("primary host serves product, checkout, policy and correct pixel while secondary preserves path and query", async (t) => {
  const tokens = new Map();
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    domainOptions: {
      cnameTarget: "domains.commera2.app",
      dnsResolver: {
        async resolveCname() {
          return ["domains.commera2.app"];
        },
        async resolveTxt(name) {
          return [[tokens.get(name)]];
        },
      },
      sslProvider: {
        async provisionDomain() {
          return { status: "active" };
        },
      },
    },
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const { store, page } = await makeStore(base, "Routing", "routing");
  await call(
    base,
    `/api/stores/${store.id}/policies/written/privacy`,
    "PATCH",
    { title: "Privacy Policy", content: "<p>Private customer data.</p>" },
  );
  await call(
    base,
    `/api/stores/${store.id}/policies/written/privacy/publish`,
    "POST",
    {},
  );
  let pixel = await call(base, `/api/stores/${store.id}/pixels`, "POST", {
    name: "Routing Meta",
    platform: "meta",
    trackingId: "123456789012345",
    browserEnabled: true,
    serverEnabled: false,
  });
  await call(base, `/api/stores/${store.id}/pixels/${pixel.body.id}/verify`, "POST", {});
  await call(base, `/api/stores/${store.id}/pixels/${pixel.body.id}/enable`, "POST", {});

  const connected = [];
  for (const hostname of ["old.routing.example", "shop.routing.example"]) {
    let result = await call(base, `/api/stores/${store.id}/domains`, "POST", {
      domainName: hostname,
    });
    tokens.set(result.body.txtName, result.body.txtValue);
    result = await call(
      base,
      `/api/stores/${store.id}/domains/${result.body.id}/verify`,
      "POST",
      {},
    );
    connected.push(result.body);
  }
  await call(
    base,
    `/api/stores/${store.id}/domains/${connected[1].id}/primary`,
    "POST",
    {},
  );

  let hosted = await withHost(
    base,
    "old.routing.example",
    "/products/offer?utm_source=ad",
  );
  assert.equal(hosted.status, 308);
  assert.equal(
    hosted.headers.location,
    "https://shop.routing.example/products/offer?utm_source=ad",
  );

  hosted = await withHost(base, "shop.routing.example", "/products/offer");
  assert.equal(hosted.status, 200);
  assert.match(hosted.body, /Routing Offer/);
  assert.match(hosted.body, /123456789012345/);
  assert.match(hosted.body, /href="\/policies\/privacy"/);
  assert.doesNotMatch(hosted.body, /\/s\/routing\/policies\/privacy/);

  const checkout = await call(
    base,
    `/api/public/${store.slug}/${page.slug}/checkouts`,
    "POST",
    { intent: "open", quantity: 1 },
  );
  hosted = await withHost(
    base,
    "shop.routing.example",
    `/checkout/${checkout.body.id}`,
  );
  assert.equal(hosted.status, 200);
  assert.match(hosted.body, /CASH ON DELIVERY/);
  hosted = await withHost(base, "shop.routing.example", "/policies/privacy");
  assert.equal(hosted.status, 200);
  assert.match(hosted.body, /Private customer data/);

  const saved = await call(base, `/api/public/checkouts/${checkout.body.id}`, "PATCH", {
    storeId: store.id, intent: "submit", quantity: 1, name: "Domain Test Buyer",
    phone: "9876543297", address: "42 Domain Test Road Bengaluru", city: "Bengaluru",
    state: "Karnataka", pincode: "560001", termsAccepted: true,
  });
  assert.equal(saved.response.status, 200);
  const order = await call(base, `/api/public/checkouts/${checkout.body.id}/order`, "POST", { storeId: store.id });
  assert.equal(order.response.status, 201);
  hosted = await withHost(base, "shop.routing.example", `/checkout/${checkout.body.id}`);
  assert.equal(hosted.status, 303);
  assert.equal(hosted.headers.location, `/thank-you/${checkout.body.id}`);
  hosted = await withHost(base, "shop.routing.example", hosted.headers.location);
  assert.equal(hosted.status, 200);
  assert.match(hosted.body, /Thank you! Your order is confirmed\./);
  assert.match(hosted.body, new RegExp(order.body.orderNumber));
  for (const asset of ["/confirmation-animation.css", "/confirmation-animation.js"]) {
    const response = await withHost(base, "shop.routing.example", asset);
    assert.equal(response.status, 200);
  }

  await call(
    base,
    `/api/stores/${store.id}/domains/${connected[1].id}`,
    "DELETE",
  );
  hosted = await withHost(base, "shop.routing.example", "/products/offer");
  assert.equal(hosted.status, 404);
  const overview = await call(base, `/api/stores/${store.id}/domains/overview`);
  assert.equal(overview.body.defaultDomain.hostname, null);
  assert.equal(overview.body.defaultDomain.openUrl, "/s/routing");
  assert.equal(overview.body.defaultDomain.status, "available_path");
  assert.equal(overview.body.defaultDomain.role, "store_link");
});
