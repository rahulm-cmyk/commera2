import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';
import { ProjectService } from '../src/project-service.js';
import { normalizeBlocks, renderBlocks, blockSectionStyle } from '../public/page-blocks.js';

test('published page draft is private until atomic publish, including blocks and URL', async t => {
  const db = createDatabase(':memory:'), app = createApp({ db, port: 0 });
  await app.start(); t.after(() => app.stop());
  const projects = new ProjectService(db), service = app.service;
  const store = service.createStore({ name: 'Draft Test', slug: 'draft-test' });
  const product = service.createProduct(store.id, { name: 'Draft Product', slug: 'draft-product', pricePaise: 99900, stock: 10 });
  const project = projects.createProject(store.id, { productId: product.id, name: 'Draft Project', slug: 'draft-project' });
  const page = projects.createBlankPage(store.id, { projectId: project.id, productId: product.id, title: 'Original page', slug: 'original-page' });
  projects.publishPage(store.id, page.id);
  const original = service.getPage(store.id, page.id), base = `http://127.0.0.1:${app.port}`;
  const patch = { slug: 'edited-page', hero: { headline: 'Draft headline' },
    editorSections: [{ id: 'story', type: 'blocks' }],
    sectionSettings: { story: { mobile: false, alignment: 'center', paddingTop: 30, blocks: [{ id: 'heading', type: 'heading', text: 'Draft block heading' }] } },
    sections: [{ id: 'story', type: 'blocks', editorCustom: true, blocks: [{ id: 'heading', type: 'heading', text: 'Draft block heading' }] }] };
  const draft = projects.updatePageContent(store.id, page.id, patch);
  assert.equal(draft.liveSlug, 'original-page');
  assert.equal(draft.hasUnpublishedChanges, true);
  assert.equal(projects.listPages(store.id)[0].slug, 'edited-page');
  // A new service instance still sees the saved draft; public reads see live columns.
  assert.equal(new ProjectService(db).getPage(store.id, page.id).slug, 'edited-page');
  assert.equal(service.getPage(store.id, page.id).contentJson, original.contentJson);
  assert.doesNotMatch(await (await fetch(base + '/s/draft-test/original-page')).text(), /Draft block heading|Draft headline/);
  assert.equal((await fetch(base + '/s/draft-test/edited-page')).status, 404);
  const preview = await fetch(base + `/api/stores/${store.id}/pages/${page.id}/preview`);
  assert.equal(preview.status, 200);
  const previewHtml = await preview.text();
  assert.match(previewHtml, /Draft block heading/);
  assert.match(previewHtml, /blocks-hide-mobile/);
  assert.match(previewHtml, /text-align:center;padding:30px/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM orders').get().n, 0);
  const other = service.createStore({ name: 'Other Test', slug: 'other-test' });
  assert.throws(() => projects.publishPage(other.id, page.id), /not found/i);
  const published = projects.publishPage(store.id, page.id);
  assert.equal(published.hasUnpublishedChanges, false);
  assert.equal(published.draftJson, null);
  assert.match(await (await fetch(base + '/s/draft-test/edited-page')).text(), /Draft block heading/);
  projects.updatePageContent(store.id, page.id, { hero: { headline: 'Second draft' } });
  projects.unpublishPage(store.id, page.id);
  assert.equal((await fetch(base + '/s/draft-test/edited-page')).status, 404);
  service.publishPage(store.id, page.id);
  assert.equal(service.getPage(store.id, page.id).title, 'Second draft');
  assert.equal(projects.getPage(store.id, page.id).hasUnpublishedChanges, false);
});

test('failed publication leaves both the live page and saved draft intact', () => {
  const db = createDatabase(':memory:'), app = createApp({ db, port: 0 }), projects = new ProjectService(db);
  try {
    const store = app.service.createStore({ name: 'Collision Test', slug: 'collision-test' });
    const product = app.service.createProduct(store.id, { name: 'Test Product', slug: 'test-product', pricePaise: 10000, stock: 10 });
    const project = projects.createProject(store.id, { productId: product.id, name: 'Test Project', slug: 'test-project' });
    const first = projects.createBlankPage(store.id, { projectId: project.id, productId: product.id, title: 'First page', slug: 'first-page' });
    projects.publishPage(store.id, first.id);
    projects.createBlankPage(store.id, { projectId: project.id, productId: product.id, title: 'Second page', slug: 'second-page' });
    projects.updatePageContent(store.id, first.id, { slug: 'second-page', hero: { headline: 'Unpublished collision' } });
    assert.throws(() => projects.publishPage(store.id, first.id), /URL is already being used/);
    assert.equal(app.service.getPage(store.id, first.id).title, 'First page');
    assert.equal(app.service.getPage(store.id, first.id).slug, 'first-page');
    assert.equal(projects.getPage(store.id, first.id).hasUnpublishedChanges, true);
  } finally { db.close(); }
});

test('blocks share safe ordered rendering, visibility and bounded validation', () => {
  const blocks = [
    { id: 'heading', type: 'heading', text: '<script>bad()</script>' },
    { id: 'hidden', type: 'text', text: 'Hidden content', visible: false },
    { id: 'copy', type: 'text', text: 'Product story' },
    { id: 'image', type: 'image', url: '/image.png', alt: 'Product "photo"' },
    { id: 'button', type: 'button', text: 'More', url: '/s/example/product' },
  ];
  const html = renderBlocks(blocks), editor = renderBlocks(blocks, { editor: true, selectedId: 'copy' });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>|Hidden content|data-builder-block/);
  assert.ok(html.indexOf('Product story') < html.indexOf('<img'));
  assert.match(html, /href="\/s\/example\/product"/);
  assert.match(editor, /is-selected" data-builder-block="copy"/);
  for (const url of ['javascript:alert(1)', '//evil.test', '/\\evil.test', 'data:text/html,test', 'java\nscript:alert(1)']) {
    assert.equal(normalizeBlocks([{ id: 'b', type: 'button', url }])[0].url, '');
  }
  assert.throws(() => normalizeBlocks(Array(41).fill(blocks[0])), /40/);
  assert.throws(() => normalizeBlocks([blocks[0], blocks[0]]), /unique/);
  assert.throws(() => normalizeBlocks([{ type: 'html' }]), /Unsupported/);
  const style = blockSectionStyle({ alignment: 'left;display:none', backgroundColor: 'url(https://evil.test)', paddingTop: Infinity, marginTop: -5 });
  assert.doesNotMatch(style, /url\(|evil|Infinity|display:none|-5px/);
});
