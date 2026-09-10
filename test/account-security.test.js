import test from "node:test";
import assert from "node:assert/strict";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";
import { AuthService } from "../src/auth-service.js";
import { createAccountEmailProvider } from "../src/account-email.js";

async function fixture(t, options = {}) {
  const db = createDatabase(":memory:"), auth = new AuthService(db),
    app = createApp({ db, port: 0, merchantAuth: true, ...options });
  await app.start(); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  const call = async (path, method = "GET", input, session) => {
    const response = await fetch(base + path, { method,
      headers: { "content-type": "application/json", ...(session ? {
        cookie: `commera2_session=${session.token}`, "x-csrf-token": session.csrfToken,
      } : {}) }, body: input === undefined ? undefined : JSON.stringify(input),
    });
    return { status: response.status, body: await response.json(), response };
  };
  return { db, auth, app, base, call };
}
const credentials = { email: "owner@example.com", displayName: "Store Owner", password: "oldPassword123" };

test("account identity persists, profile is required, sessions and CSRF stay account-scoped", async (t) => {
  const { auth, call } = await fixture(t), user = auth.register(credentials),
    current = auth.createSession(user.id), other = auth.createSession(user.id),
    outsider = auth.register({ ...credentials, email: "outside@example.com" }),
    outside = auth.createSession(outsider.id);
  assert.equal((await call("/api/account")).status, 401);
  const account = await call("/api/account", "GET", undefined, current);
  assert.equal(account.body.user.email, credentials.email);
  assert.equal(account.body.user.hasPassword, true);
  assert.equal(account.body.sessions.length, 2);
  assert.equal(account.body.sessions.filter(s => s.current).length, 1);
  assert.ok(!JSON.stringify(account.body).includes("token_hash"));
  assert.ok(!JSON.stringify(account.body).includes("password_hash"));
  assert.equal((await call("/api/account/profile", "PATCH", { displayName: "New Name" }, { ...current, csrfToken: "wrong" })).status, 403);
  assert.equal((await call("/api/account/profile", "PATCH", { displayName: " " }, current)).status, 400);
  assert.equal((await call("/api/account/profile", "PATCH", { displayName: "New Name", email: "hijack@example.com" }, current)).status, 200);
  assert.equal((await call("/api/auth/me", "GET", undefined, current)).body.user.displayName, "New Name");
  assert.equal(auth.getUser(user.id).email, credentials.email);
  await call(`/api/account/sessions/${auth.authenticate(outside.token).sessionId}`, "DELETE", undefined, current);
  assert.ok(auth.authenticate(outside.token));
  await call("/api/account/sessions/others", "DELETE", undefined, current);
  assert.ok(auth.authenticate(current.token)); assert.equal(auth.authenticate(other.token), null);
});

test("password changes require current password and matching confirmation, rotate sessions, and persist", async (t) => {
  const { auth, call } = await fixture(t), user = auth.register(credentials),
    current = auth.createSession(user.id), other = auth.createSession(user.id),
    input = { currentPassword: credentials.password, password: "newPassword456", confirmPassword: "newPassword456" };
  for (const invalid of [{ currentPassword: "wrong" }, { confirmPassword: "different" }, { password: "short", confirmPassword: "short" }]) {
    assert.equal((await call("/api/account/password", "POST", { ...input, ...invalid }, current)).status, 400);
  }
  const changed = await call("/api/account/password", "POST", input, current);
  assert.equal(changed.status, 200);
  assert.ok(changed.body.csrfToken);
  const token = changed.response.headers.get("set-cookie").match(/commera2_session=([^;]+)/)[1];
  assert.ok(auth.authenticate(token));
  assert.equal(auth.authenticate(current.token), null); assert.equal(auth.authenticate(other.token), null);
  assert.throws(() => auth.login(credentials), /incorrect/);
  assert.equal(auth.login({ ...credentials, password: input.password }).id, user.id);
});

test("Google-only password setup requires a recent Google session", async (t) => {
  const { db, auth, call } = await fixture(t),
    user = auth.loginWithGoogle({ subject: "google-1", email: "google@example.com", emailVerified: true, displayName: "Google Owner" }),
    session = auth.createSession(user.id, "google"),
    input = { password: "GooglePassword123", confirmPassword: "GooglePassword123" };
  assert.equal((await call("/api/account", "GET", undefined, session)).body.canSetPassword, true);
  db.prepare("UPDATE merchant_sessions SET created_at=? WHERE user_id=?").run("2000-01-01 00:00:00", user.id);
  assert.equal((await call("/api/account/password", "POST", input, session)).status, 400);
  const fresh = auth.createSession(user.id, "google");
  const pgTimestamp = new Date(Date.now() - 1000).toISOString().replace("T", " ").replace("Z", "+00");
  assert.equal(auth.recentGoogleSession({ authMethod: "google", createdAt: pgTimestamp }), true);
  assert.equal((await call("/api/account/password", "POST", input, fresh)).status, 200);
  assert.equal(auth.login({ email: user.email, password: input.password }).googleConnected, true);
});

test("recovery responses do not reveal accounts; reset tokens are hashed, expire and work once", async (t) => {
  const delivered = [], { auth, db, call } = await fixture(t, {
    accountEmailProvider: { sendPasswordReset: async (mail) => delivered.push(mail) },
  }), user = auth.register(credentials), session = auth.createSession(user.id);
  const known = await call("/api/auth/forgot-password", "POST", { email: user.email }),
    unknown = await call("/api/auth/forgot-password", "POST", { email: "unknown@example.com" });
  assert.deepEqual(known.body, unknown.body); assert.equal(known.status, unknown.status);
  assert.equal(delivered.length, 1);
  const { token } = delivered[0], rows = db.prepare("SELECT * FROM merchant_password_resets").all();
  assert.ok(!JSON.stringify(rows).includes(token)); assert.ok(!JSON.stringify(known.body).includes(token));
  const input = { token, password: "resetPassword789", confirmPassword: "resetPassword789" };
  assert.equal((await call("/api/auth/reset-password", "POST", { ...input, confirmPassword: "bad" })).status, 400);
  assert.equal((await call("/api/auth/reset-password", "POST", input)).status, 200);
  assert.equal(auth.authenticate(session.token), null);
  assert.equal((await call("/api/auth/reset-password", "POST", input)).status, 400);
  assert.equal(auth.login({ ...credentials, password: input.password }).id, user.id);
  const expired = auth.requestPasswordReset(user.email);
  db.prepare("UPDATE merchant_password_resets SET expires_at=?").run("2000-01-01T00:00:00.000Z");
  assert.throws(() => auth.resetPassword({ ...input, token: expired.token }), /expired/);
});

test("recovery is truthful when unconfigured and rate-limited", async (t) => {
  const { call } = await fixture(t, { accountEmailProvider: null });
  assert.deepEqual((await call("/api/auth/recovery/status")).body, { enabled: false });
  assert.equal((await call("/api/auth/forgot-password", "POST", { email: credentials.email })).status, 503);
  let result;
  for (let i = 0; i < 8; i++) result = await call("/api/auth/forgot-password", "POST", { email: credentials.email });
  assert.equal(result.status, 429);
});

test("email adapter uses configured origin and fragment tokens, and rejects failed delivery", async () => {
  let request;
  const provider = createAccountEmailProvider({ RESEND_API_KEY: "fake-test-key", AUTH_EMAIL_FROM: "accounts@example.com", APP_BASE_URL: "https://platform.example.com" },
    async (url, options) => { request = { url, options }; return { ok: true }; });
  await provider.sendPasswordReset({ email: "user@example.com", token: "test-token" });
  assert.equal(request.url, "https://api.resend.com/emails");
  const mail = JSON.parse(request.options.body);
  assert.match(mail.text, /https:\/\/platform.example.com\/reset-password#token=test-token/);
  assert.deepEqual(mail.to, ["user@example.com"]);
  assert.equal(createAccountEmailProvider({}), null);
  const failed = createAccountEmailProvider({ RESEND_API_KEY: "fake-test-key", AUTH_EMAIL_FROM: "accounts@example.com", APP_BASE_URL: "https://platform.example.com" }, async () => ({ ok: false }));
  await assert.rejects(() => failed.sendPasswordReset({ email: "user@example.com", token: "test" }), /could not be sent/);
});

test("recent linked Google sign-in can recover an existing password without email", async (t) => {
  const { auth, call } = await fixture(t), user = auth.register(credentials);
  auth.loginWithGoogle({ subject: "recovery-google", email: user.email, displayName: user.displayName, emailVerified: true });
  auth.updateProfile(user.id, { displayName: "Saved Merchant Name" });
  const returning = auth.loginWithGoogle({ subject: "recovery-google", email: user.email, displayName: "Google Profile Name", emailVerified: true });
  assert.equal(returning.displayName, "Saved Merchant Name");
  const session = auth.createSession(user.id, "google");
  const result = await call("/api/account/password", "POST", { password: "googleResetPass321", confirmPassword: "googleResetPass321" }, session);
  assert.equal(result.status, 200);
  assert.equal(auth.login({ email: user.email, password: "googleResetPass321" }).id, user.id);
});

test("Google security confirmation rejects switching to a different merchant", async (t) => {
  let profile = { subject: "attacker", email: "attacker@example.com", displayName: "Other Account", emailVerified: true };
  const { auth, base } = await fixture(t, { googleAuthProvider: {
    begin: async ({ state }) => ({ codeVerifier: "test", authorizationUrl: `https://accounts.example/?state=${state}` }),
    complete: async () => profile,
  } });
  const owner = auth.loginWithGoogle({ ...profile, subject: "owner", email: "owner@example.com" }),
    session = auth.createSession(owner.id, "google");
  const verify = async () => {
    const start = await fetch(`${base}/api/auth/google?reauth=1&returnTo=%2Faccount`, {
      redirect: "manual", headers: { cookie: `commera2_session=${session.token}` },
    });
    const state = new URL(start.headers.get("location")).searchParams.get("state"),
      cookie = start.headers.getSetCookie()[0].split(";")[0];
    return fetch(`${base}/api/auth/google/callback?code=test&state=${state}`, { redirect: "manual", headers: { cookie } });
  };
  const rejected = await verify();
  assert.match(rejected.headers.get("location"), /authError/);
  assert.ok(!rejected.headers.getSetCookie().some(c => c.startsWith("commera2_session=")));
  profile = { ...profile, subject: "owner", email: "owner@example.com" };
  const accepted = await verify();
  assert.equal(accepted.headers.get("location"), "/account");
  assert.ok(accepted.headers.getSetCookie().some(c => c.startsWith("commera2_session=")));
});
