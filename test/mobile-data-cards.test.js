import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicRoot = new URL("../public/", import.meta.url);

test("remaining data-heavy merchant tables have connected mobile card views", async () => {
  const script = await readFile(new URL("app.js", publicRoot), "utf8");

  for (const cardClass of [
    "inventory-mobile-card",
    "inventory-movement-mobile-card",
    "purchase-order-mobile-card",
    "transfer-mobile-card",
    "review-import-mobile-card",
    "review-import-detail-mobile-card",
    "customer-mobile-card",
    "abandoned-mobile-card",
    "live-visitor-mobile-card",
  ]) {
    assert.ok(script.includes(cardClass), `missing ${cardClass}`);
  }

  for (const mobileListLabel of [
    "Inventory by location",
    "Inventory movement history",
    "Purchase orders",
    "Inventory transfers",
    "Review import history",
    "Customers",
    "Abandoned checkouts",
    "Live visitor sessions",
  ]) {
    assert.match(
      script,
      new RegExp(`class=["']data-mobile-list["'][^>]+aria-label=["']${mobileListLabel}["']`),
      `missing accessible mobile list for ${mobileListLabel}`,
    );
  }

  assert.match(
    script,
    /purchase-order-mobile-card[\s\S]{0,650}class="secondary receive-po"[\s\S]{0,120}data-id="\$\{po\.id\}"/,
    "mobile purchase orders must reuse the receive-stock action hook",
  );
  assert.match(
    script,
    /transfer-mobile-card[\s\S]{0,900}class="secondary receive-transfer"[\s\S]{0,120}data-id="\$\{transfer\.id\}"/,
    "mobile transfers must reuse the receive-transfer action hook",
  );
  assert.match(
    script,
    /review-import-mobile-card[\s\S]{0,450}class="secondary import-detail"[\s\S]{0,120}data-id="\$\{item\.id\}"/,
    "mobile import cards must open the real import detail",
  );
  assert.match(
    script,
    /customer-mobile-card customer-row[\s\S]{0,240}data-customer-id="\$\{customer\.id\}"/,
    "mobile customers must reuse the customer-detail hook",
  );
  assert.match(
    script,
    /live-visitor-mobile-card live-visitor-row[\s\S]{0,240}data-session-id="\$\{esc\(visitor\.sessionId\)\}"/,
    "mobile live visitors must reuse the session-detail hook",
  );
});

test("shared mobile data-card CSS keeps desktop tables and swaps at 767px", async () => {
  const styles = await readFile(new URL("styles.css", publicRoot), "utf8");

  assert.match(styles, /\.data-mobile-list\s*\{\s*display:\s*none;/s);
  const mobileRules =
    styles.match(
      /@media \(max-width:\s*767px\)\s*\{[\s\S]*?\/\* Full Pixel tracking workspace \*\//,
    )?.[0] || "";
  assert.match(mobileRules, /\.data-desktop-list\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(mobileRules, /\.data-mobile-list\s*\{[^}]*display:\s*grid/s);
  assert.match(mobileRules, /\.data-mobile-card\s*\{[^}]*min-width:\s*0/s);
  assert.match(mobileRules, /\.data-mobile-card footer button\s*\{[^}]*min-height:\s*44px/s);
  assert.match(mobileRules, /overflow-wrap:\s*anywhere/);
});
