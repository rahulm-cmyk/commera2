import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createDatabase } from "../src/database.js";
import { createApp } from "../src/server.js";
import { AuthService } from "../src/auth-service.js";

const require = createRequire(import.meta.url),
  { chromium } = require(process.env.QA_PLAYWRIGHT_PATH || "playwright"),
  db = createDatabase(":memory:"), auth = new AuthService(db),
  user = auth.register({ email: "account-qa@example.com", displayName: "Account QA", password: "originalPass123" }),
  delivered = [],
  app = createApp({ db, port: 0, merchantAuth: true,
    accountEmailProvider: { sendPasswordReset: async (mail) => delivered.push(mail) } });
await app.start("127.0.0.1");
const base = `http://127.0.0.1:${app.port}`, browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  await page.locator('[data-auth-mode="register"]').click();
  assert.ok(await page.locator('[name="confirmPassword"]').isVisible());
  await page.locator('[data-auth-mode="login"]').click();
  await page.locator('[name="email"]').fill(user.email);
  await page.locator('[name="password"]').fill("originalPass123");
  await page.locator('#auth-form [type="submit"]').click();
  await page.getByRole("heading", { name: "Create your first store" }).waitFor();
  await page.locator("#account-link").click();
  await page.locator("#account-profile").waitFor();
  assert.equal(await page.locator("#account-email").innerText(), user.email);
  await page.evaluate(() => { window.accountQaMarker = "same-document"; });
  await page.locator('#account-profile [name="displayName"]').fill("Updated Account Name");
  await page.locator('#account-profile [type="submit"]').click();
  await page.getByText("Name saved", { exact: true }).waitFor();
  assert.equal(await page.locator("#account-name").innerText(), "Updated Account Name");
  await page.locator("#brand-home").click();
  await page.getByRole("heading", { name: "Create your first store" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/overview");
  assert.equal(await page.evaluate(() => window.accountQaMarker), "same-document");
  await page.goBack();
  await page.locator("#account-password").waitFor();
  const other = auth.createSession(user.id);
  await page.reload();
  await page.locator("#signout-others").click();
  await page.waitForFunction(() => document.querySelectorAll(".account-sessions li").length === 1);
  assert.equal(auth.authenticate(other.token), null);
  await page.locator('[name="currentPassword"]').fill("originalPass123");
  await page.locator('#account-password [name="password"]').fill("updatedPass456");
  await page.locator('#account-password [name="confirmPassword"]').fill("mismatch123");
  await page.locator('#account-password [type="submit"]').click();
  await page.getByText("Passwords do not match", { exact: true }).waitFor();
  await page.locator('#account-password [name="confirmPassword"]').fill("updatedPass456");
  await page.locator('#account-password [type="submit"]').click();
  await page.getByText("Password saved. Other sessions have been signed out.", { exact: true }).waitFor();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.waitForTimeout(300);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    if (width < 1024) assert.ok(await page.locator('#app-sidebar').evaluate(el => el.getBoundingClientRect().right <= 0));
    await page.screenshot({ path: join(tmpdir(), `commera-account-${width}.png`), fullPage: true });
  }
  await page.locator("#mobile-brand-home").click();
  await page.getByRole("heading", { name: "Create your first store" }).waitFor();
  await page.locator("#mobile-account-link").click();
  await page.locator("#account-signout").click();
  await page.locator("#forgot-password").click();
  await page.locator('#recovery-form [name="email"]').fill(user.email);
  await page.locator('#recovery-form [type="submit"]').click();
  await page.waitForFunction(() => document.querySelector('#recovery-form [role="status"]')?.textContent.includes("If an account matches"));
  assert.equal(delivered.length, 1);
  await page.goto(`${base}/reset-password#token=${delivered[0].token}`);
  await page.locator('#recovery-form [name="password"]').fill("recoveredPass789");
  await page.locator('#recovery-form [name="confirmPassword"]').fill("recoveredPass789");
  assert.equal(new URL(page.url()).hash, "");
  await page.locator('#recovery-form [type="submit"]').click();
  await page.getByRole("heading", { name: "Password updated" }).waitFor();
  assert.equal(auth.login({ email: user.email, password: "recoveredPass789" }).id, user.id);
  assert.deepEqual(errors, []);
  console.log("PASS: account with no store, AJAX name save and logo navigation, back navigation, session revoke, password validation/change, desktop/mobile layouts, email reset flow.");
} finally { await browser.close(); await app.stop(); }
