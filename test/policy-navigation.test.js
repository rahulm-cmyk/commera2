import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Policy overview exposes written content publishing and explains missing storefront links', () => {
  const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const index = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(index, /data-view="policies"><img[^>]*>Store policies<\/button>/);
  assert.doesNotMatch(index, /data-view="policies">Policy<\/button>/);
  const overview = script.slice(script.indexOf('function policyOverviewView()'), script.indexOf('function policyRulesView()'));
  assert.match(overview, /id="manage-written-policy"/);
  assert.match(overview, /navigateTo\('\/policy\/written'\)/);
  assert.match(overview, /!written.some\(policy => policy.status === 'published'\)/);
  assert.match(overview, /No policies published yet/);
  assert.doesNotMatch(overview, /method:\s*['"]POST/);
});
