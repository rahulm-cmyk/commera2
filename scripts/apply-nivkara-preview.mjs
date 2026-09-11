import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
import {applyStorePackage} from '../public/store-package.js';
const base='http://127.0.0.1:4192';
const api=async(path,options={})=>{const r=await fetch(base+path,{...options,headers:{'content-type':'application/json'}});const out=await r.json();if(!r.ok)throw Error(out.error);return out;};
const store=(await api('/api/stores')).find(item=>item.id===1&&item.slug==='imported-page-testing');
if(!store)throw Error('This script only updates the named local preview store.');
const folder=resolve(`data/backups/nivkara-preview-${Date.now()}`);
await mkdir(folder,{recursive:true});
const db=new DatabaseSync('data/imported-editor-preview.sqlite');
try {db.prepare('VACUUM INTO ?').run(resolve(folder,'before.sqlite'));}finally{db.close();}
const pack=JSON.parse(await readFile('data/nivkara-store-package/nivkara-store.json','utf8'));
// This stock is an isolated local checkout fixture, never part of the live import package.
pack.products[0].stock=10;
await applyStorePackage(pack,store,api,{backup:data=>writeFile(resolve(folder,'before.json'),JSON.stringify(data,null,2)),progress:console.log,hideOtherProducts:true});
await api(`/api/stores/${store.id}/storefront/home/publish`,{method:'POST',body:'{}'});
console.log(JSON.stringify({backup:folder,url:base+'/s/'+store.slug,localTestInventory:true}));
