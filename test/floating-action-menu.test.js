import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const publicRoot = new URL("../public/", import.meta.url);

async function readFloatingUi() {
  const [index, script, styles] = await Promise.all([
    readFile(new URL("index.html", publicRoot), "utf8"),
    readFile(new URL("app.js", publicRoot), "utf8"),
    readFile(new URL("styles.css", publicRoot), "utf8"),
  ]);
  return { index, script, styles };
}

test("floating action menus use one static document-level portal", async () => {
  const { index, script, styles } = await readFloatingUi();

  assert.match(
    index,
    /<div[^>]+id=["']floating-layer-root["'][^>]*><\/div>/,
    "the application shell must provide a stable portal outside cards and tables",
  );
  assert.match(
    index,
    /<div[^>]+id=["']floating-layer-root["'][^>]+popover=["']manual["'][^>]*>/,
    "the portal must enter the top layer so menus remain usable over modal dialogs",
  );
  assert.match(script, /(?:const|let)\s+floatingLayer(?:Root)?\s*=|["']#floating-layer-root["']/);
  assert.match(
    script,
    /floatingLayer(?:Root)?\.(?:append|appendChild)\s*\(\s*(?:panel|menu)/,
    "an opened menu must be reparented into the portal",
  );
  assert.match(styles, /#floating-layer-root\s*\{[^}]*position:\s*fixed[^}]*inset:\s*0/s);
  assert.match(styles, /#floating-layer-root\s*\{[^}]*pointer-events:\s*none/s);
  for (const reset of [
    /margin:\s*0/,
    /padding:\s*0/,
    /border:\s*0/,
    /background:\s*transparent/,
  ])
    assert.match(
      styles.match(/#floating-layer-root\s*\{[^}]*}/s)?.[0] || "",
      reset,
      "the popover portal must neutralize browser-default popover chrome",
    );
  assert.match(styles, /\.floating-menu\s*\{[^}]*position:\s*fixed/s);
  assert.match(styles, /\.floating-menu\s*\{[^}]*pointer-events:\s*auto/s);
  assert.match(script, /floatingLayer\.showPopover\s*\(/);
  assert.match(script, /floatingLayer\.hidePopover\s*\(/);
});

test("shared menu wiring normalizes accessible trigger, panel, and item hooks", async () => {
  const { script } = await readFloatingUi();

  for (const functionName of [
    "wireFloatingMenus",
    "openFloatingMenu",
    "closeFloatingMenu",
    "positionFloatingMenu",
    "scheduleFloatingMenuPosition",
  ]) {
    assert.match(
      script,
      new RegExp(`function\\s+${functionName}\\s*\\(`),
      `missing shared ${functionName} function`,
    );
  }

  for (const semanticHook of [
    "data-floating-trigger",
    "data-floating-menu",
    "aria-haspopup",
    "aria-expanded",
    "aria-controls",
    'role", "menu',
    'role", "menuitem',
  ]) {
    assert.ok(
      script.includes(semanticHook),
      `shared menu wiring must apply ${semanticHook}`,
    );
  }

  assert.match(script, /classList\.add\s*\(\s*["']floating-menu["']\s*\)/);
  assert.match(script, /wireFloatingMenus\s*\(/);
});

test("only one action menu stays open and it closes outside or with Escape", async () => {
  const { script } = await readFloatingUi();

  assert.match(script, /(?:let|const)\s+(?:activeFloatingMenu|floatingMenuState)\b/);
  assert.match(
    script,
    /function\s+openFloatingMenu[\s\S]*?closeFloatingMenu\s*\(/,
    "opening a menu must close the previous active menu",
  );
  assert.match(
    script,
    /addEventListener\s*\(\s*["'](?:pointerdown|mousedown|click)["'][\s\S]*?closeFloatingMenu\s*\(/,
    "an outside pointer interaction must close the active menu",
  );
  assert.match(
    script,
    /event\.key\s*===\s*["']Escape["'][\s\S]*?closeFloatingMenu\s*\(/,
  );
  assert.match(
    script,
    /function\s+closeFloatingMenu[\s\S]*?aria-expanded[\s\S]*?focus\s*\(/,
    "closing with keyboard intent must restore focus and collapsed state",
  );
});

test("action menus expose roving keyboard navigation", async () => {
  const { script } = await readFloatingUi();

  for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) {
    assert.match(script, new RegExp(`["']${key}["']`), `missing ${key} handling`);
  }
  assert.match(
    script,
    /querySelectorAll\s*\([^)]*(?:menuitem|button|a)[^)]*\)/,
    "keyboard movement must operate on actionable menu items",
  );
  assert.match(script, /\.focus\s*\(/);
  assert.match(script, /preventDefault\s*\(/);
});

test("interactive field popovers preserve dialog semantics and form ownership", async () => {
  const { script } = await readFloatingUi();

  assert.match(script, /source\.classList\.contains\s*\(\s*["']field-row-menu["']\s*\)/);
  assert.match(
    script,
    /setAttribute\s*\(\s*["']role["']\s*,\s*isInteractivePopover\s*\?\s*["']dialog["']\s*:\s*["']menu["']\s*\)/,
  );
  assert.match(
    script,
    /setAttribute\s*\(\s*["']aria-haspopup["']\s*,\s*isInteractivePopover\s*\?\s*["']dialog["']\s*:\s*["']menu["']\s*\)/,
  );
  assert.match(script, /ownerForm\s*=\s*source\.closest\s*\(\s*["']form["']\s*\)/);
  assert.match(
    script,
    /panel\.querySelectorAll\s*\(\s*["']button, input, select, textarea["']\s*\)/,
  );
  assert.match(script, /control\.setAttribute\s*\(\s*["']form["']\s*,\s*ownerForm\.id\s*\)/);
  assert.match(
    script,
    /formAssociations\.forEach[\s\S]*?control\.(?:removeAttribute|setAttribute)\s*\(\s*["']form["']/,
    "closing must restore every control's prior form association",
  );
});

test("collision positioning flips and clamps menus inside the viewport", async () => {
  const { script, styles } = await readFloatingUi();

  assert.match(script, /getBoundingClientRect\s*\(/);
  assert.match(script, /(?:FLOATING_[A-Z_]*PADDING|viewportPadding)\s*=\s*8\b/);
  assert.match(script, /(?:FLOATING_[A-Z_]*GAP|menuGap|gap)\s*=\s*6\b/);
  assert.match(script, /(?:innerWidth|visualViewport\?\.width|viewport\.width)/);
  assert.match(script, /(?:innerHeight|visualViewport\?\.height|viewport\.height)/);
  assert.match(
    script,
    /(?:spaceBelow|availableBelow|rect\.bottom)[\s\S]*?(?:spaceAbove|availableAbove|rect\.top)/,
    "placement must compare room below and above so the menu can flip",
  );
  assert.match(script, /Math\.(?:min|max)\s*\(/);
  assert.match(script, /\.style\.left\s*=/);
  assert.match(script, /\.style\.top\s*=/);
  assert.ok(
    /\.floating-menu\s*\{[^}]*max-height:/s.test(styles) ||
      /\.style\.maxHeight\s*=/.test(script),
    "a viewport-derived maximum height must keep every menu option reachable",
  );
});

test("open menus reposition on document and visual viewport movement", async () => {
  const { script } = await readFloatingUi();

  assert.match(
    script,
    /addEventListener\s*\(\s*["']scroll["']\s*,\s*scheduleFloatingMenuPosition\s*,\s*(?:true|\{[^}]*capture:\s*true)/,
    "captured scroll events must reposition menus inside nested scrollers",
  );
  assert.match(
    script,
    /addEventListener\s*\(\s*["']resize["']\s*,\s*scheduleFloatingMenuPosition/,
  );
  assert.match(script, /visualViewport/);
  assert.match(
    script,
    /visualViewport[\s\S]*?addEventListener\s*\(\s*["'](?:scroll|resize)["']\s*,\s*scheduleFloatingMenuPosition/,
  );
  assert.match(script, /requestAnimationFrame\s*\(/);
  assert.doesNotMatch(
    script,
    /querySelectorAll\(\s*["']\.review-row-menu\[open\][\s\S]*?addEventListener\(\s*["'](?:resize|scroll)/,
    "page-specific close-on-scroll behavior must not replace global repositioning",
  );
});

test("all merchant action-menu sources are migrated to the shared row menu", async () => {
  const { script } = await readFloatingUi();

  for (const sourceHook of [
    "order-row-menu",
    "review-row-menu",
    "pixel-row-menu",
    "edit-product",
    "edit-page",
    "builder-more",
  ]) {
    assert.ok(script.includes(sourceHook), `missing menu source ${sourceHook}`);
  }

  assert.doesNotMatch(script, /const\s+reviewMenus\s*=/);
  assert.doesNotMatch(script, /const\s+orderMenus\s*=/);
  assert.match(
    script,
    /builder-more[\s\S]{0,350}class=["']row-menu|class=["']row-menu[\s\S]{0,350}builder-more/,
    "builder section actions must use the same enhanced row-menu source",
  );
  assert.match(
    script,
    /data-builder-id=["']\$\{sectionId\}["'][\s\S]{0,180}data-vb-action=/,
    "portaled builder actions must carry their section identity with them",
  );
  assert.match(
    script,
    /const\s+id\s*=\s*button\.dataset\.builderId/,
    "builder actions must not rely on a portaled button's former DOM ancestry",
  );
  assert.ok(
    (script.match(/class=["']row-menu\b/g) || []).length >= 6,
    "desktop/mobile page, product, review, order, pixel, and builder actions should share row-menu",
  );
});
