import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";
import { AuthService } from "../src/auth-service.js";
import {
  createGoogleAuthProvider,
  googleAuthConfiguration,
} from "../src/google-auth-provider.js";

const cookieValue = (response, name) => {
  const values = response.headers.getSetCookie?.() || [
    response.headers.get("set-cookie") || "",
  ];
  const match = values.join("\n").match(new RegExp(`${name}=([^;]+)`));
  return match ? `${name}=${match[1]}` : "";
};

async function beginGoogle(base) {
  const response = await fetch(`${base}/api/auth/google?returnTo=%2Foverview`, {
    redirect: "manual",
  });
  return {
    response,
    state: new URL(response.headers.get("location")).searchParams.get("state"),
    cookie: cookieValue(response, "commera2_google_oauth"),
  };
}

test("Google OAuth creates a merchant session using verified identity", async (t) => {
  let expected = null;
  const provider = {
      async begin({ state, nonce }) {
        expected = { state, nonce, codeVerifier: "test-code-verifier" };
        return {
          codeVerifier: expected.codeVerifier,
          authorizationUrl: `https://accounts.example/authorize?state=${state}`,
        };
      },
      async complete(input) {
        assert.deepEqual(input, {
          code: "google-code",
          codeVerifier: expected.codeVerifier,
          nonce: expected.nonce,
        });
        return {
          subject: "google-subject-1",
          email: "merchant@gmail.com",
          emailVerified: true,
          displayName: "Google Merchant",
          picture: "https://images.example/merchant.jpg",
        };
      },
    },
    app = createApp({
      db: createDatabase(":memory:"),
      port: 0,
      merchantAuth: true,
      googleAuthProvider: provider,
      oauthStateSecret: "test-oauth-state-secret-with-enough-entropy",
    });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;

  const status = await fetch(`${base}/api/auth/google/status`);
  assert.deepEqual(await status.json(), { enabled: true });
  const started = await beginGoogle(base);
  assert.equal(started.response.status, 302);
  assert.ok(started.cookie);

  const callback = await fetch(
    `${base}/api/auth/google/callback?code=google-code&state=${encodeURIComponent(started.state)}`,
    { headers: { cookie: started.cookie }, redirect: "manual" },
  );
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get("location"), "/overview");
  const sessionCookie = cookieValue(callback, "commera2_session");
  assert.ok(sessionCookie);

  const me = await fetch(`${base}/api/auth/me`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(me.status, 200);
  const identity = await me.json();
  assert.equal(identity.user.email, "merchant@gmail.com");
  assert.equal(identity.user.displayName, "Google Merchant");
  assert.ok(identity.csrfToken);
});

test("Google OAuth links the same verified email without creating a duplicate account", async (t) => {
  let nonce = "";
  const db = createDatabase(":memory:"),
    provider = {
      async begin(input) {
        nonce = input.nonce;
        return {
          codeVerifier: "link-verifier",
          authorizationUrl: `https://accounts.example/authorize?state=${input.state}`,
        };
      },
      async complete() {
        return {
          subject: "linked-google-subject",
          email: "owner@example.com",
          emailVerified: true,
          displayName: "Linked Owner",
          picture: "",
        };
      },
    },
    app = createApp({
      db,
      port: 0,
      merchantAuth: true,
      googleAuthProvider: provider,
      oauthStateSecret: "test-link-state-secret-with-enough-entropy",
    });
  const user = new AuthService(db).register({
    displayName: "Password Owner",
    email: "owner@example.com",
    password: "securepass123",
  });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    started = await beginGoogle(base),
    callback = await fetch(
      `${base}/api/auth/google/callback?code=link-code&state=${encodeURIComponent(started.state)}`,
      { headers: { cookie: started.cookie }, redirect: "manual" },
    );
  assert.equal(callback.status, 302);
  assert.ok(nonce);
  assert.equal(
    db.prepare("SELECT COUNT(*) count FROM merchant_users").get().count,
    1,
  );
  const linked = db
    .prepare("SELECT * FROM merchant_users WHERE id=?")
    .get(user.id);
  assert.equal(linked.google_subject, "linked-google-subject");
  assert.match(linked.password_hash, /^scrypt\$/);
});

test("Google OAuth rejects a state mismatch and stays disabled without configuration", async (t) => {
  const provider = {
      async begin({ state }) {
        return {
          codeVerifier: "state-verifier",
          authorizationUrl: `https://accounts.example/authorize?state=${state}`,
        };
      },
      async complete() {
        throw Error("must not exchange a mismatched state");
      },
    },
    app = createApp({
      db: createDatabase(":memory:"),
      port: 0,
      merchantAuth: true,
      googleAuthProvider: provider,
      oauthStateSecret: "test-mismatch-state-secret-with-enough-entropy",
    });
  await app.start();
  t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`,
    started = await beginGoogle(base),
    callback = await fetch(
      `${base}/api/auth/google/callback?code=bad&state=wrong-state`,
      { headers: { cookie: started.cookie }, redirect: "manual" },
    );
  assert.equal(callback.status, 302);
  assert.match(callback.headers.get("location"), /authError=/);

  assert.deepEqual(googleAuthConfiguration({}), {
    clientId: "",
    clientSecret: "",
    redirectUri: "",
    enabled: false,
  });
});

test("Google provider generates a minimal identity request with PKCE and nonce", async () => {
  const provider = createGoogleAuthProvider({
      enabled: true,
      clientId: "client-id.apps.googleusercontent.com",
      clientSecret: "client-secret",
      redirectUri: "https://example.com/api/auth/google/callback",
    }),
    started = await provider.begin({ state: "state-value", nonce: "nonce-value" }),
    authorization = new URL(started.authorizationUrl);
  assert.equal(authorization.origin, "https://accounts.google.com");
  assert.equal(authorization.searchParams.get("state"), "state-value");
  assert.equal(authorization.searchParams.get("nonce"), "nonce-value");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.deepEqual(
    authorization.searchParams.get("scope").split(" ").sort(),
    ["email", "openid", "profile"],
  );
  assert.ok(started.codeVerifier.length > 40);
});

test("existing SQLite merchant accounts receive Google identity columns safely", () => {
  const directory = mkdtempSync(join(tmpdir(), "commera2-google-auth-")),
    file = join(directory, "legacy.sqlite");
  try {
    const legacy = new DatabaseSync(file);
    legacy.exec(`CREATE TABLE merchant_users (
      id TEXT PRIMARY KEY,email TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    legacy.close();
    const migrated = createDatabase(file),
      columns = migrated
        .prepare("PRAGMA table_info(merchant_users)")
        .all()
        .map((column) => column.name);
    assert.ok(columns.includes("google_subject"));
    assert.ok(columns.includes("picture_url"));
    assert.ok(
      migrated
        .prepare("PRAGMA index_list(merchant_users)")
        .all()
        .some((index) => index.name === "idx_merchant_users_google_subject"),
    );
    migrated.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
