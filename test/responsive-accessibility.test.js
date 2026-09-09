import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicRoot = new URL("../public/", import.meta.url);

test("the mobile navigation drawer removes hidden controls from the focus order", async () => {
  const script = await readFile(new URL("app.js", publicRoot), "utf8");

  assert.match(script, /matchMedia\("\(max-width: 1023px\)"\)/);
  assert.match(script, /sidebar\.inert = sidebarMedia\.matches/);
  assert.match(script, /sidebar\.inert = !isOpen/);
  assert.match(script, /appMain\.inert = isOpen/);
  assert.match(script, /sidebarMedia\.addEventListener\?\.\("change", syncSidebarAccessibility\)/);
});

test("tab sets and settings controls expose complete keyboard and accessible names", async () => {
  const script = await readFile(new URL("app.js", publicRoot), "utf8");

  assert.match(script, /\[role='tab'\]/);
  assert.match(script, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(script, /role="tab" aria-selected="\$\{codSettingsSection === id\}"/);
  assert.match(script, /aria-label="Search products"/);
  assert.match(script, /aria-label="Search customers"/);
  assert.match(script, /aria-label="Show \$\{esc\(value\.label \|\| key\)\}"/);
  assert.match(script, /aria-label="Require \$\{esc\(value\.label \|\| key\)\}"/);
  assert.match(script, /aria-label="External event name for/);
  assert.match(script, /aria-label="Enable mapping for/);
});

test("dialogs use their visible heading as the accessible name", async () => {
  const [index, script] = await Promise.all([
    readFile(new URL("index.html", publicRoot), "utf8"),
    readFile(new URL("app.js", publicRoot), "utf8"),
  ]);

  assert.match(index, /<dialog id="modal" aria-label="Application dialog">/);
  assert.match(script, /function syncModalAccessibleName\(\)/);
  assert.match(script, /title\.id = "application-dialog-title"/);
  assert.match(script, /modal\.setAttribute\("aria-labelledby", title\.id\)/);
});

test("the product-page editor has one responsive scroll owner on mobile and tablet", async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL("app.js", publicRoot), "utf8"),
    readFile(new URL("styles.css", publicRoot), "utf8"),
  ]);

  assert.doesNotMatch(script, /<main class="builder-canvas-wrap"/);
  assert.match(
    script,
    /<section class="builder-canvas-wrap"[^>]*aria-label="Live page canvas">/,
  );
  assert.match(styles, /\.visual-builder\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(styles, /\.builder-workspace\s*\{[^}]*width:\s*100%;[^}]*min-width:\s*0/s);
  assert.match(
    styles,
    /@media \(max-width: 980px\)[\s\S]*?\.builder-canvas-wrap,[\s\S]*?\.builder-settings-scroll\s*\{\s*overflow:\s*visible;/,
  );
  assert.match(styles, /\.builder-title\s*\{\s*grid-column:\s*1;\s*min-width:\s*0;/);
});

test("the product-page editor uses mobile tabs, touch sheets, sticky actions, and a tablet settings drawer", async () => {
  const [script, styles] = await Promise.all([
    readFile(new URL("app.js", publicRoot), "utf8"),
    readFile(new URL("styles.css", publicRoot), "utf8"),
  ]);

  for (const marker of [
    'document.body.classList.add("visual-builder-open")',
    'document.body.classList.remove("visual-builder-open")',
    'role="tablist" aria-label="Product Page editor panels"',
    'data-builder-tab="${id}"',
    '["sections", "Sections"]',
    '["preview", "Preview"]',
    '["settings", "Settings"]',
    'data-builder-panel="sections"',
    'data-builder-panel="preview"',
    'data-builder-panel="settings"',
    'class="builder-mobile-actions"',
    'id="builder-section-sheet-layer"',
    'builder-section-picker-dialog',
    "You have unsaved changes.",
    "Leave without saving",
  ])
    assert.match(script, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(script, /mobileBuilderMedia\.matches\) builder\.mobileTab = "settings"/);
  assert.match(script, /deleteDisabled = section\.connected \? " disabled" : ""/);
  assert.match(styles, /@media \(min-width: 1200px\)/);
  assert.match(styles, /body\.visual-builder-open\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(styles, /@media \(min-width: 768px\) and \(max-width: 1199px\)/);
  assert.match(styles, /@media \(max-width: 767px\)/);
  assert.match(styles, /grid-template-rows: auto auto minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.builder-section-item\s*\{[^}]*min-height:\s*58px/s);
  assert.match(styles, /\.builder-section-sheet\s*\{[^}]*border-radius:\s*18px 18px 0 0/s);
  assert.match(styles, /\.builder-mobile-actions\s*\{[^}]*display:\s*grid/s);
  assert.match(styles, /\.visual-builder\[data-tablet-settings="true"\][\s\S]*?transform:\s*translateX\(0\)/);
  assert.match(styles, /\.visual-builder-settings\s*\{[\s\S]*?visibility:\s*hidden;[\s\S]*?pointer-events:\s*none;/);
});
