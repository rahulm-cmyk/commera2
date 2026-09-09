import { randomUUID } from 'node:crypto';
import { sanitizeImportedHtml } from './project-service.js';

export class OnlineStoreService {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS online_store_pages (
      id TEXT PRIMARY KEY, store_id INTEGER NOT NULL REFERENCES stores(id) ON DELETE CASCADE,
      slug TEXT NOT NULL, draft_json TEXT NOT NULL, published_slug TEXT, published_json TEXT,
      updated_at TEXT NOT NULL, published_at TEXT, UNIQUE(store_id,slug), UNIQUE(store_id,published_slug)
    );
    CREATE TABLE IF NOT EXISTS online_store_preferences (
      store_id INTEGER PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT ''
    );`);
  }
  store(id) {
    const store = this.db.prepare('SELECT id,name,slug FROM stores WHERE id=?').get(id);
    if (!store) throw Error('Store not found');
    return store;
  }
  output(row) {
    if (!row) throw Error('Content page not found');
    return { id: row.id, ...JSON.parse(row.draft_json), status: row.published_json ? 'published' : 'draft',
      hasUnpublishedChanges: Boolean(row.published_json && row.draft_json !== row.published_json),
      liveSlug: row.published_slug, updatedAt: row.updated_at, publishedAt: row.published_at };
  }
  list(storeId) { this.store(storeId); return this.db.prepare('SELECT * FROM online_store_pages WHERE store_id=? ORDER BY updated_at DESC,id').all(storeId).map(row=>this.output(row)); }
  get(storeId,id) { this.store(storeId); return this.output(this.db.prepare('SELECT * FROM online_store_pages WHERE store_id=? AND id=?').get(storeId,id)); }
  save(storeId,id,input) {
    this.store(storeId);
    const current = id ? this.get(storeId,id) : {};
    const title = String(input.title ?? current.title ?? '').trim(), slug = String(input.slug ?? current.slug ?? '').trim();
    if (title.length < 2 || title.length > 160) throw Error('Page title must be 2–160 characters');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) throw Error('Use a URL handle containing lowercase letters, numbers and hyphens');
    const raw = String(input.content ?? current.content ?? '');
    if (Buffer.byteLength(raw) > 100000) throw Error('Page content is too large');
    const draft = {title,slug,content:raw.trim() ? sanitizeImportedHtml(raw) : ''};
    const conflict=this.db.prepare('SELECT id FROM online_store_pages WHERE store_id=? AND (slug=? OR published_slug=?) AND id<>?').get(storeId,slug,slug,id||'');
    if (conflict) throw Error('This page URL is already in use');
    const key=id||randomUUID();
    if (id) this.db.prepare('UPDATE online_store_pages SET slug=?,draft_json=?,updated_at=? WHERE store_id=? AND id=?').run(slug,JSON.stringify(draft),new Date().toISOString(),storeId,id);
    else this.db.prepare('INSERT INTO online_store_pages(id,store_id,slug,draft_json,updated_at) VALUES(?,?,?,?,?)').run(key,storeId,slug,JSON.stringify(draft),new Date().toISOString());
    return this.get(storeId,key);
  }
  publish(storeId,id) {
    const page=this.get(storeId,id);
    if (!page.content.replace(/<[^>]+>/g,'').trim()) throw Error('Add page content before publishing');
    this.db.prepare('UPDATE online_store_pages SET published_slug=slug,published_json=draft_json,published_at=? WHERE store_id=? AND id=?').run(new Date().toISOString(),storeId,id);
    return this.get(storeId,id);
  }
  unpublish(storeId,id) {
    this.get(storeId,id);
    this.db.prepare('UPDATE online_store_pages SET published_slug=NULL,published_json=NULL,published_at=NULL WHERE store_id=? AND id=?').run(storeId,id);
    return this.get(storeId,id);
  }
  publicPage(storeId,slug) {
    this.store(storeId);
    const row=this.db.prepare('SELECT published_json FROM online_store_pages WHERE store_id=? AND published_slug=? AND published_json IS NOT NULL').get(storeId,slug);
    if (!row) throw Error('Published content page not found');
    return JSON.parse(row.published_json);
  }
  preferences(storeId) {
    const store=this.store(storeId);
    return this.db.prepare('SELECT title,description FROM online_store_preferences WHERE store_id=?').get(storeId) || {title:store.name,description:''};
  }
  savePreferences(storeId,input) {
    this.store(storeId);
    const title=String(input.title||'').trim(),description=String(input.description||'').trim();
    if (!title || title.length>160 || description.length>320) throw Error('Use a title of 1–160 characters and a description up to 320 characters');
    this.db.prepare('INSERT INTO online_store_preferences(store_id,title,description) VALUES(?,?,?) ON CONFLICT(store_id) DO UPDATE SET title=excluded.title,description=excluded.description').run(storeId,title,description);
    return this.preferences(storeId);
  }
}
