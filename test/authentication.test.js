import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";

async function request(base, path, {
  method = "GET",
  body,
  cookie = "",
  csrfToken = "",
} = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie ? { cookie } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    response,
    body: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0] || "",
  };
}

test("merchant sessions authorize only account stores and require CSRF for writes", async (t) => {
  const db = createDatabase(":memory:"),
    app = createApp({ db, port: 0, merchantAuth: true });
  const legacyStore = app.service.createStore({
    name: "Existing Store",
    slug: "existing-store",
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;

  let result = await request(base, "/api/stores");
  assert.equal(result.response.status, 401);

  result = await request(base, "/api/auth/register", {
    method: "POST",
    body: {
      displayName: "First Owner",
      email: "owner@example.com",
      password: "securepass123",
    },
  });
  assert.equal(result.response.status, 201);
  assert.ok(result.cookie.startsWith("commera2_session="));
  const ownerCookie = result.cookie,
    ownerCsrf = result.body.csrfToken;

  result = await request(base, "/api/stores", { cookie: ownerCookie });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.map((store) => store.id), [legacyStore.id]);

  result = await request(base, "/api/stores", {
    method: "POST",
    cookie: ownerCookie,
    body: { name: "Missing CSRF", slug: "missing-csrf" },
  });
  assert.equal(result.response.status, 403);

  result = await request(base, "/api/stores", {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: { name: "Owner Store", slug: "owner-store" },
  });
  assert.equal(result.response.status, 201);
  const ownerStore = result.body;

  result = await request(base, "/api/auth/register", {
    method: "POST",
    body: {
      displayName: "Second Merchant",
      email: "second@example.com",
      password: "anotherpass123",
    },
  });
  assert.equal(result.response.status, 201);
  const secondCookie = result.cookie;

  result = await request(base, "/api/stores", { cookie: secondCookie });
  assert.deepEqual(result.body, []);
  result = await request(base, `/api/stores/${ownerStore.id}/dashboard`, {
    cookie: secondCookie,
  });
  assert.equal(result.response.status, 403);

  result = await request(base, "/api/auth/logout", {
    method: "POST",
    cookie: ownerCookie,
    csrfToken: ownerCsrf,
    body: {},
  });
  assert.equal(result.response.status, 200);
  result = await request(base, "/api/stores", { cookie: ownerCookie });
  assert.equal(result.response.status, 401);
});

test("login rejects an invalid password and returns a fresh protected session", async (t) => {
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    merchantAuth: true,
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  await request(base, "/api/auth/register", {
    method: "POST",
    body: {
      displayName: "Merchant Owner",
      email: "merchant@example.com",
      password: "merchantpass123",
    },
  });

  let result = await request(base, "/api/auth/login", {
    method: "POST",
    body: { email: "merchant@example.com", password: "wrong-password" },
  });
  assert.equal(result.response.status, 400);
  assert.equal(result.body.error, "Email or password is incorrect");

  result = await request(base, "/api/auth/login", {
    method: "POST",
    body: { email: "merchant@example.com", password: "merchantpass123" },
  });
  assert.equal(result.response.status, 200);
  assert.ok(result.cookie);
  assert.ok(result.body.csrfToken);
  const me = await request(base, "/api/auth/me", { cookie: result.cookie });
  assert.equal(me.response.status, 200);
  assert.equal(me.body.user.email, "merchant@example.com");
  assert.equal("passwordHash" in me.body.user, false);
});

test("authentication is rate limited and health probes do not expose data", async (t) => {
  const app = createApp({
    db: createDatabase(":memory:"),
    port: 0,
    merchantAuth: true,
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  let result;
  for (let attempt = 0; attempt < 7; attempt += 1)
    result = await request(base, "/api/auth/login", {
      method: "POST",
      body: { email: "missing@example.com", password: "wrong-password" },
    });
  assert.equal(result.response.status, 429);
  assert.ok(Number(result.response.headers.get("retry-after")) > 0);

  result = await request(base, "/healthz");
  assert.deepEqual(result.body, {
    status: "ok",
    database: { mode: "sqlite", persistent: false },
  });
  assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");
  result = await request(base, "/readyz");
  assert.deepEqual(result.body, {
    status: "ready",
    database: { mode: "sqlite", persistent: false },
  });
});
