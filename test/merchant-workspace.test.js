import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { matchingDestinations, overviewMarkup, workspaceDestinations } from '../public/merchant-workspace.js';
import { createDatabase } from '../src/database.js';
import { createApp } from '../src/server.js';

test('page finder searches familiar task names without fabricating results', () => {
  assert.equal(matchingDestinations('  DOMAIN ')[0].path, '/settings/domain');
  assert.equal(matchingDestinations('password')[0].path, '/account');
  assert.equal(matchingDestinations('manage deliveries')[0].path, '/orders');
  assert.deepEqual(matchingDestinations('not-an-existing-page'), []);
  assert.equal(matchingDestinations('').length, workspaceDestinations.length);
  for (const item of workspaceDestinations) assert.ok(existsSync(new URL(`../public/icons/${item.icon}.svg`,import.meta.url)));
});

const esc = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
function markup(overrides = {}) {
  return overviewMarkup({data:{store:{id:1,name:'Test <store>',currency:'INR'},metrics:{totalSalesPaise:10000,orders:2},products:[],pages:[],abandoned:[],...overrides},esc,money:n=>`INR ${n/100}`,storeUrl:()=> 'https://test.example',ordersHtml:'<table><tr><td>Order fixture</td></tr></table>'});
}
test('overview uses real counts, never invents trends, and preserves draft/live separation', () => {
  const html = markup({pixels:{funnel:{productPageViews:10,addToCart:4,orders:2,conversionRate:20}}});
  assert.match(html,/INR 100/);
  assert.match(html,/width:40%/);
  assert.match(html,/20%/);
  assert.match(html,/Test &lt;store>/);
  assert.match(html,/\/api\/stores\/1\/storefront\/preview\/open/);
  assert.doesNotMatch(html,/NaN|Infinity|View live store|\+12%/);
  assert.match(html,/data-workspace-go="\/abandoned"/);
  assert.match(html,/Order fixture/);
  assert.match(markup({storefrontPublication:{live:true}}),/href="https:\/\/test.example"[^>]*>.*View live store/);
});
test('merchant styles remain separate from customer storefront and preserve accessible motion', () => {
  const index=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../public/merchant-ui.css',import.meta.url),'utf8');
  const server=readFileSync(new URL('../src/server.js',import.meta.url),'utf8');
  assert.match(index,/merchant-ui\.css/);
  assert.doesNotMatch(server.slice(server.indexOf('function storefrontHomePage'), server.indexOf('export function createApp')),/merchant-ui\.css/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(index,/id="workspace-search".*aria-label="Find a page"/);
});

test('merchant scripts, styles and icons are served with correct types and missing icons return 404', async t => {
  const app = createApp({db:createDatabase(':memory:'),port:0});
  await app.start('127.0.0.1'); t.after(() => app.stop());
  const base = `http://127.0.0.1:${app.port}`;
  for (const [path,type] of [['/merchant-workspace.js','text/javascript'],['/merchant-ui.css','text/css'],['/icons/search.svg','image/svg+xml']]) {
    const response = await fetch(base+path);
    assert.equal(response.status,200,path);
    assert.ok(response.headers.get('content-type').startsWith(type));
  }
  assert.equal((await fetch(base+'/icons/not-an-icon.svg')).status,404);
  assert.equal((await fetch(base+'/icons/LICENSE')).status,404);
});
