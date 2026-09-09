import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('builder action controls fit their grid and long section labels wrap',async()=>{
  const css=await readFile(new URL('../public/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.builder-section-item > \.builder-more \{[^}]*width: 100%;[^}]*min-width: 0;/);
  assert.match(css,/\.builder-section-item > \.builder-more > summary \{[^}]*padding: 0;/);
  assert.match(css,/\.builder-section-item \.builder-section-select strong \{[^}]*white-space: normal;/);
  assert.match(css,/\.builder-section-item:not\(\[draggable\]\) \.builder-section-select \{[^}]*grid-column: 2 \/ -1;/);
});
