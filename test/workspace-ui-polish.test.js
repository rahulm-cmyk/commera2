import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('function storeMenuRow('), source.indexOf('function setupStoreEditorControls('));
const context = vm.createContext({esc: value => String(value).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;')});
vm.runInContext(helpers, context);
const menuForm = links => ({querySelectorAll: () => links.map(link => ({querySelector: selector => ({value: selector === '[data-menu-label]' ? link.label : link.url})}))});

test('structured menu fields preserve ordering, destinations, and literal pipe characters', () => {
  const links = [{label:' Shop | Browse ',url:' #products '},{label:'Home',url:'/s/my-store'}];
  assert.equal(JSON.stringify(context.readStoreMenuLinks(menuForm(links))), JSON.stringify([{label:'Shop | Browse',url:'#products'},{label:'Home',url:'/s/my-store'}]));
  assert.equal(JSON.stringify(context.readStoreMenuLinks(menuForm([]))), '[]');
});

test('incomplete menu rows cannot silently disappear during a draft save', () => {
  for (const link of [{label:'Home',url:''},{label:'',url:'/store'},{label:' ',url:' '}]) {
    assert.throws(() => context.readStoreMenuLinks(menuForm([link])), /label and destination/);
  }
});

test('menu editor escapes saved values and exposes named reorder controls', () => {
  const html = context.storeMenuRow({label:'"<script>',url:'/s/store?q="test'});
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&quot;&lt;script>/);
  for (const label of ['Move menu item up','Move menu item down','Remove menu item']) assert.ok(html.includes(`aria-label="${label}"`));
});

test('live visitor refresh is store scoped and connection status waits for an open stream', () => {
  const live = source.slice(source.indexOf('function liveVisitorsView('), source.indexOf('function policiesView('));
  assert.match(live, /storeId !== requestedStore/);
  assert.match(live, /storeId !== streamStore/);
  assert.match(live, /liveVisitorStream\.onopen/);
  assert.match(live, /liveVisitorStream\.readyState === 1/);
  assert.match(live, /focusedFilter/);
  assert.match(live, /ArrowLeft.*ArrowRight.*Home.*End/);
});

test('editor uses a real banner preview and structured links without the raw navigation textarea', () => {
  assert.match(source, /id="store-banner-image-preview"/);
  assert.match(source, /contains\('is-mobile'\) \? 390 : 1100/);
  assert.match(source, /storePreviewResizeObserver\?\.disconnect\(\)/);
  assert.match(source, /headerLinksValue = readStoreMenuLinks\(homeForm\)/);
  assert.doesNotMatch(source, /textarea name="headerLinks"/);
  const css = readFileSync(new URL('../public/online-store.css',import.meta.url),'utf8');
  assert.match(css, /grid-template-areas:'sections' 'settings' 'preview'/);
  assert.match(css, /store-editor-panel \.form-columns \{ grid-template-columns:minmax\(0,1fr\)/);
});

test('uploaded pages render their sanitized source inside the visual-builder preview', () => {
  assert.match(source, /page\.creationMethod === "upload" && page\.importedHtml/);
  assert.match(source, /id="builder-imported-page-preview"/);
  assert.match(source, /frame\.srcdoc/);
  const css = readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(css, /#builder-imported-page-preview/);
  assert.match(css, /height: 72vh/);
});

test('form checkboxes remain compact controls instead of expanding like text fields', () => {
  const css = readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(css, /label\.field\.checkbox > input\[type="checkbox"\]/);
  assert.match(css, /flex: 0 0 18px/);
  assert.match(css, /width: 18px/);
  assert.match(css, /height: 18px/);
  assert.match(css, /min-height: 18px/);
  assert.match(css, /label\.field\.checkbox \{[\s\S]*?display: flex;[\s\S]*?width: 100%/);
  assert.match(css, /label\.field\.checkbox > span \{[\s\S]*?font-size: 14px;[\s\S]*?font-weight: 600/);
  assert.match(css, /label\.field\.checkbox > input\[type="radio"\]/);
});

test('privacy settings render each consent choice as its own compact row', () => {
  const css = readFileSync(new URL('../public/styles.css',import.meta.url),'utf8');
  const privacy = source.slice(source.indexOf('function privacySettingsView('), source.indexOf('function liveVisitorsView('));
  assert.match(privacy, /class="field checkbox privacy-toggle"/);
  assert.match(css, /#privacy-settings \.privacy-toggle/);
  assert.match(css, /justify-content: space-between/);
  assert.match(css, /min-height: 46px/);
});

test('product page creation suggests an unused URL when a product page already exists', () => {
  const pageHelpers = source.slice(
    source.indexOf('const slugify ='),
    source.indexOf('async function refreshWorkspace()'),
  );
  const pageContext = vm.createContext({
    data: {
      products: [{ id: 10, name: 'Hair Oil', slug: 'hair-oil' }],
      pages: [
        { id: 1, slug: 'hair-oil', liveSlug: 'hair-oil' },
        { id: 2, slug: 'hair-oil-2' },
      ],
    },
  });
  vm.runInContext(`${pageHelpers}; this.pageSetupDefaults = pageSetupDefaults;`, pageContext);
  assert.equal(pageContext.pageSetupDefaults(10).slug, 'hair-oil-3');
});

test('current product pages screen creates with an unused URL suggestion', () => {
  const pageHelpers = source.slice(
    source.indexOf('const makeSlug ='),
    source.indexOf('const productById ='),
  );
  const pageContext = vm.createContext({
    data: {
      pages: [
        { id: 1, slug: 'hair-oil', liveSlug: 'hair-oil' },
        { id: 2, slug: 'hair-oil-2' },
      ],
    },
  });
  vm.runInContext(`${pageHelpers}; this.availableProductPageSlug = availableProductPageSlug;`, pageContext);
  assert.equal(pageContext.availableProductPageSlug('Hair Oil'), 'hair-oil-3');
});
