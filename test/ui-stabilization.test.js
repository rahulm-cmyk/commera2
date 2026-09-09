import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicRoot = new URL("../public/", import.meta.url);

test("merchant dashboard uses one simplified responsive UI system", async () => {
  const [index, script, styles] = await Promise.all([
    readFile(new URL("index.html", publicRoot), "utf8"),
    readFile(new URL("app.js", publicRoot), "utf8"),
    readFile(new URL("styles.css", publicRoot), "utf8"),
  ]);

  assert.match(index, /id="page-description"/);
  assert.match(index, /id="page-actions"/);
  assert.doesNotMatch(index, /MERCHANT COMMAND CENTER/);
  assert.doesNotMatch(script, /Connected commerce flow/);

  for (const pattern of [
    /Search products/,
    /Manage Pages/,
    /class="row-menu"/,
    /Search orders/,
    /Search customers/,
    /policyOverviewView/,
    /Drop CSV here/,
    /No reviews match these filters/,
    /Customer Fields/,
    /Order Summary/,
    /COD Protection/,
    /image-with-text/,
    /mediaDataUrl/,
    /product-mobile-card/,
    /product-page-mobile-card/,
  ])
    assert.match(script, pattern);

  assert.doesNotMatch(script, /Consumer Reviews status filters/);
  assert.doesNotMatch(script, /Edit Product Page/);
  assert.match(styles, /Unified merchant interface/);
  assert.match(styles, /\.status-badge/);
  assert.match(styles, /\.switch input:checked/);
  assert.match(styles, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /contain:\s*layout inline-size/);
  assert.match(styles, /\.row-menu:not\(\[open\]\)\s*>\s*div/);
  assert.match(
    styles,
    /body\.auth-screen\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s,
  );
  assert.match(
    styles,
    /body\.auth-screen\s*>\s*main\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s,
  );
});
