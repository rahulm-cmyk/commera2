import { mkdir, copyFile } from 'node:fs/promises';

const names = ['house','store','package','shopping-bag','users','panels-top-left','star','chart-no-axes-combined','shield-check','settings-2','search','arrow-up-right','arrow-right','plus','log-out','menu','x','globe','check','circle-check','circle','credit-card','mouse-pointer-2','activity','paintbrush','chevron-right','chevron-left','chevron-up','chevron-down','mail','eye','eye-off','file-text','monitor','smartphone','undo-2','redo-2','ellipsis','code-xml','grip-vertical'];
const target = new URL('../public/icons/', import.meta.url);
names.push('copy', 'pencil', 'trash-2', 'file-spreadsheet');
names.push('type', 'link', 'align-left', 'image', 'list-collapse', 'quote', 'truck');
names.push('columns-2', 'list-checks');
names.push('layout-grid', 'images', 'rows-3', 'message-square', 'play', 'newspaper', 'file', 'megaphone', 'timer', 'move-horizontal', 'panel-top', 'badge-check', 'gallery-horizontal');
names.push('bold', 'italic', 'underline', 'rotate-ccw');
await mkdir(target, { recursive: true });
for (const name of names) await copyFile(new URL(`../node_modules/lucide-static/icons/${name}.svg`, import.meta.url), new URL(`${name}.svg`, target));
await copyFile(new URL('../node_modules/lucide-static/LICENSE', import.meta.url), new URL('LICENSE', target));
console.log(`Copied ${names.length} Lucide icons.`);
